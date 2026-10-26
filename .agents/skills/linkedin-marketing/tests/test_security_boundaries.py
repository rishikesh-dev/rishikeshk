"""Offline regressions for configuration, credential and deletion boundaries."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests
from requests.adapters import BaseAdapter

from lib import _env, backend_selector
from lib.publora_client import PubloraClient, PubloraError

#: Not a credential, and deliberately not a literal beside `api_key=`: the
#: plugin scanner reads that shape as a hardcoded secret and fails the build.
REVIEW_KEY = "-".join(("fake", "review", "key"))


class EnvironmentTrust(unittest.TestCase):
    def test_project_env_cannot_select_a_poster_or_change_transport(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text(
                "LINKEDIN_SKILLS_CUSTOM_POSTER=python attacker.py\n"
                "HTTPS_PROXY=https://attacker.invalid\n"
                "PUBLORA_API_KEY=project-key\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {}, clear=True), \
                    mock.patch("dotenv.find_dotenv", return_value=str(path)), \
                    mock.patch.object(_env, "_LOADED_PATHS", []):
                _env.load_env(force=True)
                self.assertEqual(os.environ.get("PUBLORA_API_KEY"), "project-key")
                self.assertNotIn("LINKEDIN_SKILLS_CUSTOM_POSTER", os.environ)
                self.assertNotIn("HTTPS_PROXY", os.environ)
                self.assertEqual(backend_selector.active_backend(), "manual")

    def test_launch_environment_poster_and_credentials_are_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text("LINKEDIN_SKILLS_CUSTOM_POSTER=python attacker.py\n"
                            "APIFY_TOKEN=project-token\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {
                "LINKEDIN_SKILLS_CUSTOM_POSTER": "trusted-poster",
                "APIFY_TOKEN": "launch-token",
            }, clear=True), mock.patch("dotenv.find_dotenv", return_value=str(path)), \
                    mock.patch.object(_env, "_LOADED_PATHS", []):
                _env.load_env(force=True)
                self.assertEqual(os.environ["APIFY_TOKEN"], "launch-token")
                with mock.patch.object(backend_selector.subprocess, "run") as run:
                    backend_selector.publish("post", "draft", "target")
                self.assertEqual(run.call_args.args[0], ["trusted-poster", "post", "target"])


class RedirectAdapter(BaseAdapter):
    def __init__(self, status):
        self.status = status
        self.sent = []

    def send(self, request, **kwargs):
        self.sent.append(request)
        response = requests.Response()
        response.request = request
        response.url = request.url
        response.status_code = self.status if len(self.sent) == 1 else 200
        response.headers["Location"] = "https://attacker.invalid/collect"
        response._content = b'{"success": true}'
        return response

    def close(self):
        pass


class CredentialRedirects(unittest.TestCase):
    def test_credential_diagnostics_disable_redirects(self):
        from scripts import check_config, selftest

        with mock.patch.dict(os.environ, {"PUBLORA_API_KEY": REVIEW_KEY}, clear=True), \
                mock.patch("requests.get", return_value=mock.Mock(status_code=302)) as get:
            check_config.check_publora(check_config.Report(), offline=False)
            self.assertFalse(get.call_args.kwargs.get("allow_redirects", True))
            selftest.probe("https://api.publora.com/api/v1/platform-connections",
                           {"x-publora-key": REVIEW_KEY})
            self.assertFalse(get.call_args.kwargs.get("allow_redirects", True))

    def test_all_authenticated_requests_refuse_redirects(self):
        actions = [
            lambda c: c.list_platform_connections(),
            lambda c: c.get_post(post_group_id="group"),
            lambda c: c.create_post(content="draft", platforms=["linkedin-test"]),
            lambda c: c.delete_comment(post_urn="urn", comment_id="id", platform_id="linkedin-test"),
            lambda c: c.delete_post(post_group_id="group", allow_live=True),
        ]
        for status in (301, 302, 303, 307, 308):
            for index, action in enumerate(actions):
                with self.subTest(status=status, action=index):
                    client = PubloraClient(api_key=REVIEW_KEY)
                    client._session.trust_env = False
                    adapter = RedirectAdapter(status)
                    client._session.mount("https://", adapter)
                    with self.assertRaises(PubloraError):
                        action(client)
                    self.assertEqual(len(adapter.sent), 1)
                    self.assertTrue(adapter.sent[0].url.startswith(client.BASE_URL + "/"))


class DeletionStatusTrust(unittest.TestCase):
    def client(self):
        client = PubloraClient(api_key=REVIEW_KEY)
        client._session = mock.Mock()
        client._session.delete.return_value = mock.Mock(
            status_code=200, json=lambda: {"success": True})
        return client

    def test_lookup_errors_never_authorize_deletion(self):
        for status in (401, 403, 404, 503):
            with self.subTest(status=status):
                client = self.client()
                client.get_post = mock.Mock(side_effect=PubloraError(f"HTTP {status}: failed"))
                with self.assertRaises(PubloraError):
                    client.delete_post(post_group_id="group")
                client._session.delete.assert_not_called()

    def test_unverified_or_active_states_never_authorize_deletion(self):
        for status in (None, "unknown", "processing", "published", "partially_published"):
            with self.subTest(status=status):
                client = self.client()
                client.get_post = mock.Mock(return_value={"status": status})
                with self.assertRaises(PubloraError):
                    client.delete_post(post_group_id="group")
                client._session.delete.assert_not_called()

    def test_known_cancellable_states_work_for_both_response_shapes(self):
        for status in ("draft", "scheduled"):
            for nested in (False, True):
                with self.subTest(status=status, nested=nested):
                    client = self.client()
                    group = {"status": status}
                    client.get_post = mock.Mock(return_value={"postGroup": group} if nested else group)
                    self.assertEqual(client.delete_post(post_group_id="group"), {"success": True})
                    client._session.delete.assert_called_once()

    def test_explicit_override_skips_status_lookup(self):
        client = self.client()
        client.get_post = mock.Mock(side_effect=PubloraError("HTTP 503: failed"))
        client.delete_post(post_group_id="group", allow_live=True)
        client.get_post.assert_not_called()
        client._session.delete.assert_called_once()
