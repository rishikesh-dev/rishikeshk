"""The documented MCP read path must match the library it replaces.

A skill reading through the Apify connector gets the actors' raw output and has
only `references/mcp-read-layer.md` to turn it into the records every other
skill expects. If that document drifts from `ApifyClient`, the connector path
starts producing a second, subtly different contract: same field names, one of
them silently absent or fed from the wrong place. Nothing at runtime would
notice, because both shapes are plain dicts.

So the mapping is checked rather than trusted: the flat fields in the table are
exactly the fields the normalizer produces, and the actor ids and input keys in
the prose are the ones the client actually sends.

Offline. No credentials, no network.
"""
from __future__ import annotations

import pathlib
import re
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib.apify_client import ApifyClient  # noqa: E402

DOC = ROOT / "references" / "mcp-read-layer.md"


def documented_post_fields() -> set[str]:
    """The flat field names in the post mapping table's first column."""
    text = DOC.read_text(encoding="utf-8")
    table = text.split("### A post", 1)[1].split("### Comments", 1)[0]
    fields = set()
    for line in table.splitlines():
        cells = [c.strip() for c in line.split("|")]
        if len(cells) < 4 or cells[1] in ("Flat field", "") or set(cells[1]) <= set("-: "):
            continue
        name = re.fullmatch(r"`([A-Za-z_][A-Za-z0-9_]*)`", cells[1])
        if name:
            fields.add(name.group(1))
    return fields


def normalizer_fields() -> set[str]:
    """What ApifyClient._normalize_post actually returns, `_raw` aside."""
    produced = ApifyClient._normalize_post({})
    return {k for k in produced if not k.startswith("_")}


class PostMapping(unittest.TestCase):
    def test_the_table_lists_every_field_the_normalizer_produces(self):
        missing = sorted(normalizer_fields() - documented_post_fields())
        self.assertEqual(missing, [], (
            "fields the library produces and the MCP table does not document, so a "
            "connector read would silently lack them:\n  " + "\n  ".join(missing)))

    def test_the_table_invents_no_field(self):
        extra = sorted(documented_post_fields() - normalizer_fields())
        self.assertEqual(extra, [], (
            "fields documented for the MCP path that the library never produces:\n  "
            + "\n  ".join(extra)))

    def test_the_mapping_is_not_empty(self):
        """A parser that silently matches nothing would pass both tests above."""
        self.assertGreaterEqual(len(documented_post_fields()), 15)


class ActorsAndInputs(unittest.TestCase):
    def setUp(self):
        self.doc = DOC.read_text(encoding="utf-8")

    def test_every_actor_the_client_calls_is_documented(self):
        """Actor ids appear as user/name in the doc and user~name in the client."""
        for attr in ("POST_ACTOR", "POST_COMMENTS_ACTOR", "PROFILE_COMMENTS_ACTOR",
                     "POST_ENGAGERS_ACTOR"):
            actor = getattr(ApifyClient, attr)
            self.assertIn(actor.replace("~", "/"), self.doc,
                          f"{attr} ({actor}) is not in the MCP connector URL or mapping")

    def test_the_documented_inputs_are_the_ones_the_client_sends(self):
        """Each real input key, and each near-miss the doc warns about.

        Matched as bare names: a key can legitimately appear in a JSON block, in
        backticks, or in prose, and the test is about presence, not markup.
        """
        for key in ("post_urls", "postIds", "limit", "sortOrder", "usernames",
                    "urls", "resultsLimit", "type"):
            self.assertIn(key, self.doc, f"input key {key} is undocumented")
        for ignored in ("maxItems", "resultLimit", "scrapeReplies"):
            self.assertIn(ignored, self.doc,
                          f"no warning about {ignored}, which is ignored and bills a run")

    def test_the_caps_match_the_client(self):
        self.assertIn("caps at 100", self.doc)
        self.assertIn("caps at 3000", self.doc)

    def test_the_sort_orders_match_the_client(self):
        for order in ApifyClient.COMMENT_SORT_ORDERS:
            self.assertIn(f'"{order}"', self.doc)

    def test_the_engager_types_match_the_client(self):
        for kind in ApifyClient.ENGAGER_TYPES:
            self.assertIn(f"`{kind}`", self.doc)

    def test_the_filtered_connector_url_is_the_documented_one(self):
        """The bare server exposes call-actor; the doc must not recommend it."""
        self.assertIn("https://mcp.apify.com?actors=", self.doc)
        self.assertIn("call-actor", self.doc)  # named, as the thing being avoided
        self.assertRegex(self.doc, r"filtered URL, not the bare one")


class RootActorTable(unittest.TestCase):
    """The bundle's own Apify section must name the actors the client calls.

    It listed `supreme_coder/linkedin-post` for months after the post reader
    moved to apimaestro, so anyone following the setup instructions signed up
    for an actor the code never calls.
    """

    #: Both documents carry the same table, and only one of them was fixed the
    #: first time. README is where a new user actually looks.
    TABLES = ("SKILL.md", "README.md")
    ACTORS = ("POST_ACTOR", "POST_COMMENTS_ACTOR", "PROFILE_COMMENTS_ACTOR",
              "POST_ENGAGERS_ACTOR")

    def tables(self):
        for name in self.TABLES:
            doc = (ROOT / name).read_text(encoding="utf-8")
            body = doc.split("| Use case | Actor", 1)
            self.assertEqual(len(body), 2, f"{name} no longer carries the actor table")
            yield name, body[1].split("\n\n", 1)[0]

    def test_the_actor_table_names_the_actors_the_client_calls(self):
        for name, table in self.tables():
            for attr in self.ACTORS:
                actor = getattr(ApifyClient, attr).replace("~", "/")
                self.assertIn(actor, table, f"{name}: {attr} ({actor}) is missing")

    def test_the_table_names_no_actor_the_client_does_not_call(self):
        called = {getattr(ApifyClient, a).replace("~", "/") for a in self.ACTORS}
        for name, table in self.tables():
            listed = set(re.findall(r"`([a-z0-9_]+/[a-z0-9-]+)`", table))
            self.assertEqual(sorted(listed - called), [],
                             f"{name} advertises actors this bundle never calls")


if __name__ == "__main__":
    unittest.main()
