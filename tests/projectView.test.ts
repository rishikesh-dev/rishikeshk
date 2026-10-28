import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProjectDetails } from '../src/lib/projectView.ts';
import type { RepoStats } from '../src/lib/github.ts';

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

test('Firestore summary and stack take precedence over GitHub', () => {
  const merged = mergeProjectDetails(
    { summary: 'Curated summary.', stack: ['Flutter', 'BLoC'] },
    repo,
  );
  assert.equal(merged.summary, 'Curated summary.');
  assert.deepEqual(merged.stack, ['Flutter', 'BLoC']);
  assert.equal(merged.repoDescription, 'Repository description.');
});

test('GitHub description and language fill missing Firestore fields', () => {
  const merged = mergeProjectDetails({ summary: '', stack: [] }, repo);
  assert.equal(merged.summary, 'Repository description.');
  assert.deepEqual(merged.stack, ['Dart', 'flutter', 'hive']);
  assert.equal(merged.repoDescription, '');
});

test('GitHub language and topics are deduplicated case-insensitively', () => {
  const merged = mergeProjectDetails(
    { summary: '', stack: [] },
    { ...repo, topics: ['Dart', 'flutter', 'hive'] },
  );
  assert.deepEqual(merged.stack, ['Dart', 'flutter', 'hive']);
});

test('a repository description identical to the summary is not repeated', () => {
  const merged = mergeProjectDetails({ summary: 'Repository description.' }, repo);
  assert.equal(merged.repoDescription, '');
});

test('missing GitHub data never prevents a merged project', () => {
  const merged = mergeProjectDetails({ summary: 'Curated.', stack: ['Flutter'] }, null);
  assert.equal(merged.summary, 'Curated.');
  assert.deepEqual(merged.stack, ['Flutter']);
  assert.equal(merged.repo, null);
});
