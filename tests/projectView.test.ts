import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curatedContent, mergeProjectDetails, selectReadmeSections } from '../src/lib/projectView.ts';
import type { Readme, ReadmeSection } from '../src/lib/markdown.ts';
import type { RepoStats } from '../src/lib/github.ts';

const section = (kind: ReadmeSection['kind'], title: string, text: string): ReadmeSection => ({
  id: title.toLowerCase(),
  title,
  kind,
  text,
  html: `<p>${text}</p>`,
});

const readme: Readme = {
  markdown: '',
  html: '',
  sections: [
    section('overview', 'Overview', 'A README overview.'),
    section('features', 'Features', 'README feature list.'),
    section('architecture', 'Architecture', 'README architecture notes.'),
    section('stack', 'Tech Stack', 'README stack list.'),
    section('decisions', 'Decisions', 'README decisions.'),
    section('setup', 'Setup', 'Run the app.'),
  ],
};

const repo: RepoStats = {
  owner: 'acme',
  repo: 'demo',
  name: 'demo',
  fullName: 'acme/demo',
  description: 'Repository description.',
  stars: 12,
  forks: 3,
  language: 'Dart',
  topics: ['flutter', 'hive'],
  updated: 'Oct 2026',
  updatedAt: '2026-10-01T00:00:00Z',
  htmlUrl: 'https://github.com/acme/demo',
};

test('curated content is detected from the generated body', () => {
  const body = '## The story\n\nStory\n\n## Highlight\n\nHighlight\n\n## Key decisions\n\n- One';
  assert.deepEqual(curatedContent(body, ['Flutter']), {
    story: true,
    highlight: true,
    decisions: true,
    stack: true,
  });
  assert.deepEqual(curatedContent('', []), {
    story: false,
    highlight: false,
    decisions: false,
    stack: false,
  });
});

test('README fills missing content and keeps architecture and setup', () => {
  const sections = selectReadmeSections(
    readme,
    { story: false, highlight: false, decisions: false, stack: false },
    '',
  );
  assert.deepEqual(sections.map((item) => item.kind), [
    'overview',
    'features',
    'architecture',
    'stack',
    'decisions',
    'setup',
  ]);
});

test('README sections do not repeat curated story, highlights, decisions or stack', () => {
  const sections = selectReadmeSections(
    readme,
    { story: true, highlight: true, decisions: true, stack: true },
    '',
  );
  assert.deepEqual(sections.map((item) => item.kind), ['architecture', 'setup']);
});

test('Firestore summary and stack take precedence over GitHub', () => {
  const merged = mergeProjectDetails(
    { summary: 'Curated summary.', stack: ['Flutter', 'BLoC'] },
    '',
    repo,
    readme,
  );
  assert.equal(merged.summary, 'Curated summary.');
  assert.deepEqual(merged.stack, ['Flutter', 'BLoC']);
  assert.equal(merged.repoDescription, 'Repository description.');
});

test('GitHub description and language fill missing Firestore fields', () => {
  const merged = mergeProjectDetails({ summary: '', stack: [] }, '', repo, readme);
  assert.equal(merged.summary, 'Repository description.');
  assert.deepEqual(merged.stack, ['Dart', 'flutter', 'hive']);
  assert.equal(merged.repoDescription, '');
});

test('GitHub language and topics are deduplicated case-insensitively', () => {
  const merged = mergeProjectDetails(
    { summary: '', stack: [] },
    '',
    { ...repo, topics: ['Dart', 'flutter', 'hive'] },
    null,
  );
  assert.deepEqual(merged.stack, ['Dart', 'flutter', 'hive']);
});

test('a repository description identical to the summary is not repeated', () => {
  const merged = mergeProjectDetails(
    { summary: 'Repository description.' },
    '',
    repo,
    readme,
  );
  assert.equal(merged.repoDescription, '');
});

test('README content already present in the curated body is suppressed', () => {
  const long = 'This overview paragraph is long enough to be detected as duplicated content in the curated body.';
  const duplicate: Readme = {
    ...readme,
    sections: readme.sections.map((item) =>
      item.kind === 'overview' ? section('overview', 'Overview', long) : item,
    ),
  };
  const body = `## The story\n\n${long}`;
  const sections = selectReadmeSections(
    duplicate,
    { story: false, highlight: true, decisions: true, stack: true },
    body,
  );
  assert.equal(sections.some((item) => item.kind === 'overview'), false);
  assert.deepEqual(sections.map((item) => item.kind), ['architecture', 'setup']);
});

test('missing GitHub and README data never prevents a merged project', () => {
  const merged = mergeProjectDetails(
    { summary: 'Curated.', stack: ['Flutter'] },
    '',
    null,
    null,
  );
  assert.equal(merged.summary, 'Curated.');
  assert.deepEqual(merged.stack, ['Flutter']);
  assert.equal(merged.repo, null);
  assert.deepEqual(merged.readmeSections, []);
});
