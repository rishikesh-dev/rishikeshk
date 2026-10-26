import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEligible,
  isFeatured,
  normalizeProject,
  normalizeProjects,
  slugify,
  splitProjectGroups,
  toList,
} from '../src/lib/projectData.ts';

const mapped = normalizeProject({
  title: 'Journeo',
  description: 'A calm journal.',
  techStack: ['Flutter', 'Hive'],
  tag: 'Journaling app',
  playStoreUrl: 'https://play.google.com/store/apps/details?id=example',
  githubUrl: 'https://github.com/acme/journeo',
  story: 'Built for daily writing.',
  highlight: 'Mood tracking.',
  decisions: ['Use BLoC', 'Keep it offline'],
  image: '/images/journeo.jpg',
  featured: true,
});

test('maps existing Firestore fields to the content schema', () => {
  assert.ok(mapped);
  assert.equal(mapped.title, 'Journeo');
  assert.equal(mapped.summary, 'A calm journal.');
  assert.equal(mapped.kind, 'Journaling app');
  assert.equal(mapped.status, 'live');
  assert.deepEqual(mapped.stack, ['Flutter', 'Hive']);
  assert.equal(mapped.storeUrl, 'https://play.google.com/store/apps/details?id=example');
  assert.equal(mapped.githubUrl, 'https://github.com/acme/journeo');
  assert.equal(mapped.image, '/images/journeo.jpg');
  assert.equal(mapped.imageAlt, 'Journeo screenshot');
  assert.equal(mapped.featured, true);
  assert.match(mapped.body, /## The story/);
  assert.match(mapped.body, /## Highlight/);
  assert.match(mapped.body, /## Key decisions/);
});

test('featured only accepts the boolean true', () => {
  for (const value of [undefined, null, false, 'true', 1, 'yes', {}]) {
    const project = normalizeProject({ title: 'Demo', featured: value });
    assert.equal(project?.featured, false, `featured=${JSON.stringify(value)}`);
  }
  assert.equal(normalizeProject({ title: 'Demo', featured: true })?.featured, true);
});

test('missing and invalid featured values never auto-feature a project', () => {
  const projects = normalizeProjects([
    { title: 'One', description: 'First' },
    { title: 'Two', featured: 'true' },
    { title: 'Three', featured: true },
  ]);
  assert.deepEqual(projects.map((project) => project.featured), [false, false, true]);
});

test('project groups use featured === true and status soon from Firestore', () => {
  const projects = [
    { id: 'a', data: { featured: true, status: 'soon' } },
    { id: 'b', data: { featured: false, status: 'live' } },
    { id: 'c', data: { status: 'soon' } },
    { id: 'd', data: { featured: 'true', status: 'live' } },
    { id: 'e', data: {} },
  ];
  const { featured, upcoming, others } = splitProjectGroups(projects);
  assert.deepEqual(featured.map((item) => item.id), ['a']);
  assert.deepEqual(upcoming.map((item) => item.id), ['c']);
  assert.deepEqual(others.map((item) => item.id), ['b', 'd', 'e']);
  assert.equal(isFeatured(projects[0]), true);
  assert.equal(isFeatured(projects[1]), false);
});

test('unpublished and draft projects are not eligible, but featured is independent', () => {
  assert.equal(isEligible({ published: false }), false);
  assert.equal(isEligible({ draft: true }), false);
  assert.equal(isEligible({ published: true, featured: false }), true);
  assert.equal(isEligible({}), true);

  const projects = normalizeProjects([
    { title: 'Published', published: true },
    { title: 'Hidden', published: false },
    { title: 'Draft', draft: true },
  ]);
  assert.deepEqual(projects.map((project) => project.title), ['Published']);
});

test('malformed documents are skipped without hiding valid projects', () => {
  const projects = normalizeProjects([
    null,
    'not a document',
    { description: 'No title' },
    { title: 'Good', description: 'Survives' },
    { title: '   ' },
  ]);
  assert.deepEqual(projects.map((project) => project.title), ['Good']);
});

test('duplicate titles receive unique, stable slugs', () => {
  const projects = normalizeProjects([
    { title: 'Same Name' },
    { title: 'Same Name' },
    { title: 'Same Name!' },
    { title: 'Other' },
  ]);
  assert.deepEqual(projects.map((project) => project.id), [
    'same-name',
    'same-name-2',
    'same-name-3',
    'other',
  ]);
  assert.equal(new Set(projects.map((project) => project.id)).size, projects.length);
});

test('falls back to the document id and then a generated slug', () => {
  assert.equal(normalizeProjects([{ _id: 'legacy-doc' }])[0].id, 'legacy-doc');
  assert.equal(normalizeProjects([{ _id: '!!!' }])[0].id, 'project-1');
  assert.equal(slugify('  Héllo, World!  '), 'hello-world');
});

test('list fields accept arrays and comma/newline strings', () => {
  assert.deepEqual(toList([' Flutter ', '', 'Hive']), ['Flutter', 'Hive']);
  assert.deepEqual(toList('Flutter, Hive\nBLoC'), ['Flutter', 'Hive', 'BLoC']);
  assert.deepEqual(toList(42), []);
});

test('status and order are normalised defensively', () => {
  assert.equal(normalizeProject({ title: 'Soon' })?.status, 'soon');
  assert.equal(normalizeProject({ title: 'Soon', status: 'soon', playStoreUrl: 'x' })?.status, 'soon');
  assert.equal(normalizeProject({ title: 'Live', playStoreUrl: 'x' })?.status, 'live');
  assert.equal(normalizeProject({ title: 'Bad', status: 'unknown' })?.status, 'soon');
  assert.equal(normalizeProject({ title: 'Order', order: '4' })?.order, 4);
  assert.equal(normalizeProject({ title: 'Order', order: 0 })?.order, 0);
  assert.equal(normalizeProject({ title: 'Order', order: -2 }, 5)?.order, -2);
  assert.equal(normalizeProject({ title: 'Order', order: 'not-a-number' }, 5)?.order, 6);
});
