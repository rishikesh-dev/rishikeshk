import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySection,
  decodeEntities,
  processReadme,
  resolveReadmeUrl,
  safeUrl,
  sanitizeHtml,
  stripLeadingTitle,
} from '../src/lib/markdown.ts';

const bases = {
  rawBase: 'https://raw.githubusercontent.com/acme/demo/HEAD/',
  blobBase: 'https://github.com/acme/demo/blob/HEAD/',
};

const readme = `# Demo

[![build](https://img.shields.io/badge/build-passing-green)](https://example.com)

## Overview

Demo is a small Flutter app.

## Features

- Offline-first
- Quick capture

## Architecture

![flow diagram](./docs/flow.png)

\`\`\`dart
void main() => runApp(App());
\`\`\`

## Tech stack

Flutter, Hive and BLoC.

## Setup

Read [the setup guide](docs/setup.md#install).

## Implementation decisions

We chose Hive for local storage.
`;

test('extracts structured README sections and drops the duplicate title', () => {
  const result = processReadme(readme, bases);
  assert.ok(result);
  assert.doesNotMatch(result.markdown, /^# Demo/m);
  assert.deepEqual(
    result.sections.map((section) => [section.title, section.kind]),
    [
      ['Overview', 'overview'],
      ['Features', 'features'],
      ['Architecture', 'architecture'],
      ['Tech stack', 'stack'],
      ['Setup', 'setup'],
      ['Implementation decisions', 'decisions'],
    ],
  );
  assert.ok(result.sections.every((section) => section.id.length > 0));
  assert.equal(new Set(result.sections.map((section) => section.id)).size, result.sections.length);
});

test('preserves lists, code blocks and headings in rendered HTML', () => {
  const result = processReadme(readme, bases);
  assert.ok(result);
  assert.match(result.html, /<ul>/);
  assert.match(result.html, /<li>Offline-first<\/li>/);
  assert.match(result.html, /<pre><code class="language-dart">/);
  assert.match(result.html, /<h2>Architecture<\/h2>/);
});

test('resolves relative README images and links against GitHub', () => {
  const result = processReadme(readme, bases);
  assert.ok(result);
  assert.match(
    result.html,
    /src="https:\/\/raw\.githubusercontent\.com\/acme\/demo\/HEAD\/docs\/flow\.png"/,
  );
  assert.match(
    result.html,
    /href="https:\/\/github\.com\/acme\/demo\/blob\/HEAD\/docs\/setup\.md#install"/,
  );
});

test('resolves root-relative, parent-relative and fragment URLs', () => {
  assert.equal(resolveReadmeUrl('/docs/a.md', bases.blobBase), `${bases.blobBase}docs/a.md`);
  assert.equal(resolveReadmeUrl('../LICENSE', bases.blobBase), 'https://github.com/acme/demo/blob/LICENSE');
  assert.equal(resolveReadmeUrl('docs/../LICENSE', bases.blobBase), `${bases.blobBase}LICENSE`);
  assert.equal(resolveReadmeUrl('#install', bases.blobBase), '#install');
  assert.equal(resolveReadmeUrl('mailto:hi@example.com', bases.blobBase), 'mailto:hi@example.com');
});

test('sanitizes scripts, event handlers and dangerous URLs', () => {
  const dirty = [
    '<script>alert(1)</script>',
    '<iframe src="https://evil.example"></iframe>',
    '<img src="https://example.com/a.png" onerror="alert(1)">',
    '<a href="javascript:alert(1)">bad</a>',
    '<a href="java&#x09;script:alert(1)">obfuscated</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">data</a>',
    '<div onclick="alert(1)">text</div>',
    '<style>body{display:none}</style>',
  ].join('\n');
  const clean = sanitizeHtml(dirty);
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /<iframe/i);
  assert.doesNotMatch(clean, /<style/i);
  assert.doesNotMatch(clean, /onerror/i);
  assert.doesNotMatch(clean, /onclick/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.doesNotMatch(clean, /data:text\/html/i);
  assert.match(clean, /<img src="https:\/\/example\.com\/a\.png"/);
  assert.match(clean, /text/);
  assert.match(clean, /bad/);
});

test('raw HTML in a README is not rendered as executable markup', () => {
  const result = processReadme(
    '# Demo\n\n## Overview\n\n<script>alert(1)</script>\n\n<a href="javascript:alert(1)" onclick="x">link text</a>',
    bases,
  );
  assert.ok(result);
  assert.doesNotMatch(result.html, /<script/i);
  assert.doesNotMatch(result.html, /onclick/i);
  assert.doesNotMatch(result.html, /javascript:/i);
  assert.match(result.html, /link text/);
});

test('safeUrl allows normal URLs and rejects obfuscated schemes', () => {
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeUrl('mailto:hi@example.com'), 'mailto:hi@example.com');
  assert.equal(safeUrl('#section'), '#section');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('java\nscript:alert(1)'), null);
  assert.equal(safeUrl('&#106;avascript:alert(1)'), null);
  assert.equal(safeUrl('ftp://example.com/a'), null);
  assert.equal(safeUrl('relative/path'), 'relative/path');
  assert.equal(safeUrl('relative/path', true), null);
  assert.equal(safeUrl('/image.png', true), '/image.png');
});

test('decodeEntities handles named and numeric entities', () => {
  assert.equal(decodeEntities('&amp;&lt;&#58;&#x2f;'), '&<:/');
});

test('empty READMEs and title-only READMEs return null', () => {
  assert.equal(processReadme('', bases), null);
  assert.equal(processReadme('   \n\n', bases), null);
  assert.equal(processReadme('# Only a title\n', bases), null);
});

test('READMEs without headings are treated as an overview', () => {
  const result = processReadme('Just a paragraph about the app.', bases);
  assert.ok(result);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].title, 'Overview');
  assert.equal(result.sections[0].kind, 'overview');
});

test('headings inside fenced code blocks do not create sections', () => {
  const result = processReadme(
    '# Demo\n\n## Usage\n\n```md\n## Not a section\n```\n\nReal text.',
    bases,
  );
  assert.ok(result);
  assert.deepEqual(result.sections.map((section) => section.title), ['Usage']);
  assert.match(result.sections[0].html, /## Not a section/);
});

test('classifies common README headings', () => {
  assert.equal(classifySection('Getting Started'), 'setup');
  assert.equal(classifySection('Architecture'), 'architecture');
  assert.equal(classifySection('Tech Stack'), 'stack');
  assert.equal(classifySection('Trade-offs'), 'decisions');
  assert.equal(classifySection('What it does'), 'features');
  assert.equal(classifySection('About'), 'overview');
  assert.equal(classifySection('Screenshots'), 'other');
});

test('stripLeadingTitle removes the document title but keeps later headings', () => {
  assert.equal(stripLeadingTitle('# Title\n\n## Body\n\nText'), '## Body\n\nText');
  assert.equal(stripLeadingTitle('Intro\n\n# Title\n\n## Body'), 'Intro\n\n## Body');
  assert.equal(stripLeadingTitle('## Body\n\n# Later'), '## Body\n\n# Later');
  assert.equal(stripLeadingTitle('# Title\n\n# Another'), '# Another');
});
