import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearGithubCache, getReadme, getReadmeHtml, getRepo, parseRepo } from '../src/lib/github.ts';
import { startServer } from './http.ts';

const originalBase = process.env.GITHUB_API_BASE;
const originalToken = process.env.GITHUB_TOKEN;

beforeEach(() => {
  clearGithubCache();
  delete process.env.GITHUB_API_BASE;
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  clearGithubCache();
  if (originalBase === undefined) delete process.env.GITHUB_API_BASE;
  else process.env.GITHUB_API_BASE = originalBase;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

test('parseRepo accepts repository URLs and rejects invalid ones', () => {
  assert.deepEqual(parseRepo('https://github.com/acme/demo'), {
    owner: 'acme',
    repo: 'demo',
    htmlUrl: 'https://github.com/acme/demo',
  });
  assert.equal(parseRepo('https://github.com/acme/demo.git')?.repo, 'demo');
  assert.equal(parseRepo('https://www.github.com/acme/demo/tree/main')?.repo, 'demo');
  assert.equal(parseRepo('github.com/acme/demo')?.owner, 'acme');
  assert.equal(parseRepo('http://github.com/acme/demo')?.owner, 'acme');

  for (const invalid of [
    '',
    'not a url',
    'https://gitlab.com/acme/demo',
    'https://github.com/acme',
    'https://github.com/',
    'https://evil.example/github.com/acme/demo',
    'javascript://github.com/acme/demo',
    'ftp://github.com/acme/demo',
    'https://github.com/acme/demo%2fextra',
    'https://github.com/../demo',
    'https://github.com/acme/%E0%A4%A',
  ]) {
    assert.equal(parseRepo(invalid), null, invalid);
  }
  assert.equal(parseRepo(undefined), null);
});

test('getRepo maps repository metadata and sends the token only in the request header', async () => {
  process.env.GITHUB_TOKEN = 'top-secret-token';
  const server = await startServer((request, response) => {
    assert.equal(request.url, '/repos/acme/demo');
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        name: 'demo',
        full_name: 'acme/demo',
        description: 'A demo repository.',
        stargazers_count: 42,
        forks_count: 7,
        language: 'Dart',
        topics: ['flutter', 'hive'],
        pushed_at: '2026-10-01T12:00:00Z',
        updated_at: '2026-10-02T12:00:00Z',
        html_url: 'https://github.com/acme/demo',
      }),
    );
  });

  try {
    process.env.GITHUB_API_BASE = server.url;
    const repo = await getRepo('https://github.com/acme/demo');
    assert.ok(repo);
    assert.equal(repo.name, 'demo');
    assert.equal(repo.fullName, 'acme/demo');
    assert.equal(repo.description, 'A demo repository.');
    assert.equal(repo.stars, 42);
    assert.equal(repo.forks, 7);
    assert.equal(repo.language, 'Dart');
    assert.deepEqual(repo.topics, ['flutter', 'hive']);
    assert.equal(repo.updated, 'Oct 2026');
    assert.equal(repo.updatedAt, '2026-10-01T12:00:00Z');
    assert.equal(server.requests[0].headers.authorization, 'Bearer top-secret-token');
    assert.doesNotMatch(JSON.stringify(repo), /top-secret-token/);
  } finally {
    await server.close();
    delete process.env.GITHUB_TOKEN;
  }
});

test('getRepo returns null on API errors, rate limits and invalid URLs', async () => {
  const server = await startServer((request, response) => {
    response.statusCode = request.url.includes('/rate') ? 403 : 500;
    response.end(JSON.stringify({ message: 'nope' }));
  });

  try {
    process.env.GITHUB_API_BASE = server.url;
    assert.equal(await getRepo('https://github.com/acme/demo'), null);
    assert.equal(await getRepo('not-a-repository-url'), null);
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test('getReadme parses raw Markdown and exposes sections and HTML', async () => {
  const server = await startServer((request, response) => {
    assert.equal(request.url, '/repos/acme/demo/readme');
    response.setHeader('content-type', 'text/plain; charset=utf-8');
    response.end('# Demo\n\n## Features\n\n- Fast\n\n## Setup\n\nRun it.');
  });

  try {
    process.env.GITHUB_API_BASE = server.url;
    const readme = await getReadme('https://github.com/acme/demo');
    assert.ok(readme);
    assert.deepEqual(readme.sections.map((section) => section.kind), ['features', 'setup']);
    assert.match(readme.html, /<li>Fast<\/li>/);
    assert.equal(await getReadmeHtml('https://github.com/acme/demo'), readme.html);
  } finally {
    await server.close();
  }
});

test('getReadme accepts a base64-encoded JSON API response', async () => {
  const markdown = '# Demo\n\n## Overview\n\nFrom JSON.';
  const server = await startServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ content: Buffer.from(markdown).toString('base64'), encoding: 'base64' }));
  });

  try {
    process.env.GITHUB_API_BASE = server.url;
    const readme = await getReadme('https://github.com/acme/demo');
    assert.ok(readme);
    assert.match(readme.html, /From JSON\./);
  } finally {
    await server.close();
  }
});

test('getReadme handles missing, empty, rate-limited and invalid READMEs', async () => {
  let mode: 'missing' | 'empty' | 'rate' | 'error' = 'missing';
  const server = await startServer((request, response) => {
    if (mode === 'missing') response.statusCode = 404;
    else if (mode === 'rate') response.statusCode = 403;
    else if (mode === 'error') response.statusCode = 500;
    else {
      response.statusCode = 200;
      response.end('   ');
      return;
    }
    response.end(JSON.stringify({ message: 'nope' }));
  });

  try {
    process.env.GITHUB_API_BASE = server.url;
    assert.equal(await getReadme('https://github.com/acme/demo'), null);
    mode = 'rate';
    clearGithubCache();
    assert.equal(await getReadme('https://github.com/acme/demo'), null);
    mode = 'error';
    clearGithubCache();
    assert.equal(await getReadme('https://github.com/acme/demo'), null);
    mode = 'empty';
    clearGithubCache();
    assert.equal(await getReadme('https://github.com/acme/demo'), null);
    assert.equal(await getReadme('invalid'), null);
  } finally {
    await server.close();
  }
});

test('README failures are cached as null and do not throw', async () => {
  const server = await startServer((request, response) => {
    response.statusCode = 500;
    response.end('boom');
  });

  try {
    process.env.GITHUB_API_BASE = server.url;
    assert.equal(await getReadme('https://github.com/acme/demo'), null);
    assert.equal(await getReadme('https://github.com/acme/demo'), null);
    assert.equal(server.requests.length, 1);
  } finally {
    await server.close();
  }
});
