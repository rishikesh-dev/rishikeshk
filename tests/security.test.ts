import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const filesIn = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)],
    ),
  );
  return nested.flat();
};

test('.env.example documents every build-time variable and no private credentials', async () => {
  const example = await readFile(join(root, '.env.example'), 'utf8');
  for (const name of [
    'PUBLIC_FIREBASE_PROJECT_ID',
    'PUBLIC_FIREBASE_API_KEY',
    'GITHUB_TOKEN',
    'FIRESTORE_BASE',
    'GITHUB_API_BASE',
    'SITE_URL',
  ]) {
    assert.match(example, new RegExp(`^${name}=`, 'm'), name);
  }
  assert.doesNotMatch(example, /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
  assert.doesNotMatch(example, /service[_-]?account/i);
  assert.doesNotMatch(example, /GITHUB_TOKEN=\S+/);
});

test('source does not use Firebase Admin SDKs, service accounts or a public token', async () => {
  const sourceFiles = await filesIn(join(root, 'src'));
  const sources = await Promise.all(sourceFiles.map((file) => readFile(file, 'utf8')));
  const combined = sources.join('\n');

  assert.doesNotMatch(combined, /firebase-admin/i);
  assert.doesNotMatch(combined, /service[_-]?account/i);
  assert.doesNotMatch(combined, /PUBLIC_GITHUB_TOKEN/);
  assert.doesNotMatch(combined, /private_key/i);
  assert.doesNotMatch(combined, /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
});

test('GITHUB_TOKEN is only read by the server-side GitHub loader', async () => {
  const sourceFiles = await filesIn(join(root, 'src'));
  const withToken: string[] = [];
  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8');
    if (source.includes('GITHUB_TOKEN')) withToken.push(file.replace(root, ''));
  }
  assert.deepEqual(withToken, ['src/lib/github.ts']);
});
