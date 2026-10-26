#!/usr/bin/env node
// End-to-end build verification against local Firestore and GitHub mock servers.
// No production data is read or written. Run with: npm run verify
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const secret = 'verification-github-token-never-in-dist';
const state = { featured: true, firestoreFail: false, githubFail: false };

const stringValue = (value) => ({ stringValue: value });
const booleanValue = (value) => ({ booleanValue: value });
const arrayValue = (values) => ({ arrayValue: { values } });
const document = (id, fields) => ({
  name: `projects/test/databases/(default)/documents/projects/${id}`,
  fields,
});

function projectDocuments() {
  return [
    document('focus-ledger', {
      title: stringValue('Focus Ledger'),
      description: stringValue('A focused ledger for deep work.'),
      techStack: arrayValue([stringValue('Flutter'), stringValue('Hive')]),
      tag: stringValue('Productivity app'),
      playStoreUrl: stringValue('https://play.google.com/store/apps/details?id=mock.focus'),
      githubUrl: stringValue('https://github.com/mock/focus-ledger'),
      story: stringValue('Curated story marker for Focus Ledger.'),
      highlight: stringValue('Curated highlight marker.'),
      decisions: arrayValue([stringValue('Curated decision marker.')]),
      featured: booleanValue(state.featured),
      order: { integerValue: '1' },
    }),
    document('quiet-notes', {
      title: stringValue('Quiet Notes'),
      description: stringValue('Notes without the noise.'),
      techStack: arrayValue([stringValue('Flutter')]),
      tag: stringValue('Notes app'),
      githubUrl: stringValue('https://github.com/mock/quiet-notes'),
      status: stringValue('live'),
      featured: booleanValue(false),
      order: { integerValue: '2' },
    }),
    document('brand-new-project', {
      title: stringValue('Brand New Project'),
      description: stringValue('Brand new curated description.'),
      techStack: arrayValue([stringValue('Flutter'), stringValue('BLoC')]),
      tag: stringValue('New app'),
      githubUrl: stringValue('https://github.com/mock/missing-readme'),
      status: stringValue('live'),
      order: { integerValue: '3' },
    }),
    document('pocket-atlas', {
      title: stringValue('Pocket Atlas'),
      description: stringValue('An offline map notebook.'),
      techStack: arrayValue([stringValue('Flutter')]),
      tag: stringValue('Travel app'),
      status: stringValue('soon'),
      featured: booleanValue(false),
      order: { integerValue: '4' },
    }),
    // A malformed document must not break the rest of the collection.
    { fields: { title: stringValue('No document name') } },
  ];
}

function repoJson(owner, repo) {
  return {
    name: repo,
    full_name: `${owner}/${repo}`,
    description: `Repository description for ${repo}.`,
    stargazers_count: repo === 'focus-ledger' ? 21 : 7,
    forks_count: 3,
    language: 'Dart',
    topics: ['flutter'],
    pushed_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-02T12:00:00Z',
  };
}

function readmeFor(repo) {
  if (repo === 'focus-ledger') {
    return `# Focus Ledger

## Overview

README overview marker for Focus Ledger.

## Features

README features marker.

## Architecture

Architecture marker for Focus Ledger.

\`\`\`dart
void main() {}
\`\`\`

## Setup

Setup marker for Focus Ledger.

<script>alert('README')</script>

[bad link](javascript:alert('x'))
`;
  }
  if (repo === 'quiet-notes') {
    return `# Quiet Notes

## Overview

Quiet notes README overview marker.

## Architecture

Architecture marker for Quiet Notes.
`;
  }
  return '';
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (process.env.VERBOSE_BUILD) console.log(`  mock ${request.method} ${url.pathname}`);
  response.setHeader('access-control-allow-origin', '*');

  if (url.pathname.startsWith('/v1/')) {
    if (state.firestoreFail) {
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: { message: 'mock Firestore outage' } }));
      return;
    }
    if (url.pathname.endsWith('/documents/portfolio/bio')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ fields: { liveApps: { integerValue: '3' } } }));
      return;
    }
    if (url.pathname.includes('/documents/projects')) {
      response.setHeader('content-type', 'application/json');
      const body = JSON.stringify({ documents: projectDocuments() });
      response.end(body, () => {
        if (process.env.VERBOSE_BUILD) console.log(`  mock sent ${body.length} bytes`);
      });
      return;
    }
    response.statusCode = 404;
    response.end('{}');
    return;
  }

  if (url.pathname.startsWith('/github/')) {
    if (state.githubFail) {
      response.statusCode = 500;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ message: 'mock GitHub outage' }));
      return;
    }
    const match = url.pathname.match(/^\/github\/repos\/([^/]+)\/([^/]+)(\/readme)?$/);
    if (!match) {
      response.statusCode = 404;
      response.end('{}');
      return;
    }
    const [, owner, repo, readme] = match;
    if (readme) {
      if (repo === 'missing-readme') {
        response.statusCode = 404;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ message: 'Not Found' }));
        return;
      }
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end(readmeFor(repo));
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(repoJson(owner, repo)));
    return;
  }

  response.statusCode = 404;
  response.end('{}');
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

const env = {
  ...process.env,
  SITE_URL: 'https://portfolio.test',
  PUBLIC_FIREBASE_PROJECT_ID: 'test',
  PUBLIC_FIREBASE_API_KEY: 'public-test-key',
  FIRESTORE_BASE: `${origin}/v1`,
  GITHUB_API_BASE: `${origin}/github`,
  GITHUB_TOKEN: secret,
};

function build(label) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [join(root, 'node_modules/astro/bin/astro.mjs'), 'build'],
      { cwd: root, env },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const output = `${stdout}\n${stderr}`;
      if (code !== 0) {
        console.error(stdout);
        console.error(stderr);
        reject(new Error(`build failed: ${label}`));
        return;
      }
      if (process.env.VERBOSE_BUILD) console.log(output);
      resolve(output);
    });
  });
}

async function read(path) {
  return readFile(join(dist, path), 'utf8');
}

async function exists(path) {
  try {
    await stat(join(dist, path));
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)],
    ),
  );
  return files.flat();
}

function workArticles(html) {
  return [...html.matchAll(/<article class="work[^"]*">([\s\S]*?)<\/article>/g)].map((match) => match[1]);
}

function indexRows(html) {
  return [...html.matchAll(/<article class="index-row">([\s\S]*?)<\/article>/g)].map((match) => match[1]);
}

function upcomingCards(html) {
  return [...html.matchAll(/<article class="ph">([\s\S]*?)<\/article>/g)].map((match) => match[1]);
}

function includes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label}: missing ${JSON.stringify(needle)}`);
}

function excludes(haystack, needle, label) {
  assert.ok(!haystack.includes(needle), `${label}: unexpected ${JSON.stringify(needle)}`);
}

async function assertNoSecret() {
  const files = await walk(dist);
  for (const file of files) {
    const info = await stat(file);
    if (!info.isFile() || info.size > 2_000_000) continue;
    if (!/\.(html|js|mjs|css|json|map|txt|xml|svg|webmanifest)$/i.test(file)) continue;
    const contents = await readFile(file, 'utf8');
    assert.ok(!contents.includes(secret), `secret leaked into ${relative(root, file)}`);
  }
}

const checks = [];
function pass(message) {
  checks.push(message);
  console.log(`  ✓ ${message}`);
}

try {
  console.log('Build 1: Firestore featured + GitHub metadata/README');
  await build('featured true');
  {
    const html = await read('index.html');
    const featured = workArticles(html);
    const rows = indexRows(html);
    assert.equal(featured.length, 1, 'featured projects should render as feature rows');
    includes(featured[0], 'Focus Ledger', 'featured row');
    includes(featured[0], 'A focused ledger for deep work.', 'featured row description');
    includes(featured[0], 'Productivity app', 'featured row tag');
    includes(featured[0], 'Flutter', 'featured row stack');
    assert.ok(
      featured.every((article) => !article.includes('Quiet Notes')),
      'non-featured projects must not render as feature rows',
    );
    assert.equal(rows.length, 2, 'non-featured live projects should render in the regular listing');
    includes(rows.join(''), 'Quiet Notes', 'regular project listing');
    includes(rows.join(''), 'Brand New Project', 'regular project listing');
    assert.ok(!rows.join('').includes('Focus Ledger'), 'featured project must not be duplicated in the index');

    const upcoming = upcomingCards(html);
    assert.equal(upcoming.length, 1, 'status:soon projects should render under More on the way');
    includes(upcoming[0], 'Pocket Atlas', 'Firestore upcoming project');
    assert.ok(!rows.join('').includes('Pocket Atlas'), 'upcoming project must not be duplicated in the index');
    includes(html, 'id="menu"', 'mobile navigation');

    const focus = await read('apps/focus-ledger/index.html');
    includes(focus, 'Curated story marker for Focus Ledger.', 'curated story');
    includes(focus, 'Curated highlight marker.', 'curated highlight');
    includes(focus, 'Curated decision marker.', 'curated decisions');
    includes(focus, 'Architecture marker for Focus Ledger.', 'README architecture');
    includes(focus, 'Setup marker for Focus Ledger.', 'README setup');
    includes(focus, '21 stars', 'GitHub stars');
    includes(focus, 'Repository description for focus-ledger.', 'GitHub description');
    includes(focus, 'Get it on Google Play', 'Play Store link');
    includes(focus, 'github.com/mock/focus-ledger', 'GitHub link');
    excludes(focus, 'README overview marker for Focus Ledger.', 'curated story suppresses README overview');
    excludes(focus, 'README features marker.', 'curated highlight suppresses README features');
    excludes(focus, 'javascript:alert', 'unsafe README link');
    excludes(focus, '<script>alert', 'README script injection');

    const quiet = await read('apps/quiet-notes/index.html');
    includes(quiet, 'Quiet notes README overview marker.', 'README fills missing overview');
    includes(quiet, 'Architecture marker for Quiet Notes.', 'correct README on correct page');
    excludes(quiet, 'Architecture marker for Focus Ledger.', 'README isolation');

    const brand = await read('apps/brand-new-project/index.html');
    includes(brand, 'Brand new curated description.', 'dynamic Firestore project page');
    assert.ok(
      (await stat(join(dist, 'apps/focus-ledger/index.html'))).isFile() &&
        (await stat(join(dist, 'apps/quiet-notes/index.html'))).isFile() &&
        (await stat(join(dist, 'apps/brand-new-project/index.html'))).isFile(),
      'all dynamic detail pages exist',
    );

    await assertNoSecret();
    pass('featured:true controls Featured Work and gets GitHub stats/README');
    pass('featured:false and missing featured stay in the regular listing');
    pass('status:soon populates More on the way from Firestore');
    pass('README sections render on the correct project with curated precedence');
    pass('README HTML is sanitized (no script, javascript: URL or handlers)');
    pass('GitHub token is absent from every dist file');
  }

  console.log('Build 2: featured flipped to false');
  state.featured = false;
  state.githubFail = false;
  await build('featured false');
  {
    const html = await read('index.html');
    assert.equal(workArticles(html).length, 0, 'no feature rows when nothing is featured');
    includes(html, 'Nothing is featured right now.', 'empty featured state');
    includes(indexRows(html).join(''), 'Focus Ledger', 'flipped project joins regular listing');
    assert.ok((await stat(join(dist, 'apps/focus-ledger/index.html'))).isFile(), 'detail page still exists');
    pass('changing featured to false removes the project from Featured Work');
    pass('zero featured projects render an honest empty state, not a placeholder card');
  }

  console.log('Build 3: Firestore failure');
  state.featured = true;
  state.firestoreFail = true;
  await build('firestore failure');
  {
    const html = await read('index.html');
    assert.equal(workArticles(html).length, 0, 'no feature rows during a Firestore outage');
    assert.equal(indexRows(html).length, 0, 'no project rows during a Firestore outage');
    includes(html, 'No projects are published yet.', 'empty project state');
    excludes(html, 'Focus Ledger', 'Firestore projects are gone during the outage');
    excludes(html, 'Journeo', 'no hardcoded Markdown project is used as fallback');
    excludes(html, 'Inveio', 'no hardcoded Markdown project is used as fallback');
    excludes(html, 'Pocket Atlas', 'no Firestore upcoming project survives the outage');
    assert.equal(await exists('apps/journeo/index.html'), false, 'no stale Markdown detail page');
    assert.equal(await exists('apps/focus-ledger/index.html'), false, 'no stale Firestore detail page');
    pass('Firestore outage builds an empty project list instead of hardcoded content');
  }

  console.log('Build 4: GitHub failure with Firestore intact');
  state.firestoreFail = false;
  state.githubFail = true;
  await build('github failure');
  {
    const html = await read('index.html');
    includes(workArticles(html).join(''), 'Focus Ledger', 'Firestore still drives Featured Work');
    const focus = await read('apps/focus-ledger/index.html');
    includes(focus, 'Curated story marker for Focus Ledger.', 'Firestore content survives GitHub failure');
    includes(focus, 'A focused ledger for deep work.', 'Firestore summary survives');
    excludes(focus, 'Architecture marker for Focus Ledger.', 'no README when GitHub fails');
    await assertNoSecret();
    pass('GitHub outage leaves Firestore project pages working without README enrichment');
    pass('GitHub token stays out of dist after the failure-path build');
  }

  console.log(`\n${checks.length} end-to-end checks passed.`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
