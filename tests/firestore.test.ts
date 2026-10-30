import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fsDoc, fsList, firebaseConfigured } from '../src/lib/firestore.ts';
import { appsLoader } from '../src/lib/appsLoader.ts';
import { startServer } from './http.ts';

const keys = ['FIRESTORE_BASE', 'PUBLIC_FIREBASE_PROJECT_ID', 'PUBLIC_FIREBASE_API_KEY'] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.PUBLIC_FIREBASE_PROJECT_ID = 'test';
  process.env.PUBLIC_FIREBASE_API_KEY = 'public-key';
  delete process.env.FIRESTORE_BASE;
});

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const stringValue = (value: string) => ({ stringValue: value });
const booleanValue = (value: boolean) => ({ booleanValue: value });
const numberValue = (value: number) => ({ integerValue: String(value) });
const arrayValue = (values: unknown[]) => ({ arrayValue: { values } });

function document(id: string, fields: Record<string, unknown>) {
  return {
    name: `projects/test/databases/(default)/documents/projects/${id}`,
    fields,
  };
}

test('firebaseConfigured needs both the project id and public API key', () => {
  assert.equal(firebaseConfigured(), true);
  delete process.env.PUBLIC_FIREBASE_API_KEY;
  assert.equal(firebaseConfigured(), false);
});

test('fsList maps Firestore REST values, including featured, and paginates', async () => {
  const server = await startServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('pageToken');
    response.setHeader('content-type', 'application/json');
    if (!token) {
      response.end(
        JSON.stringify({
          documents: [
            document('one', {
              title: stringValue('One'),
              description: stringValue('First project'),
              featured: booleanValue(true),
              techStack: arrayValue([stringValue('Flutter'), stringValue('Hive')]),
              order: numberValue(2),
            }),
          ],
          nextPageToken: 'page-two',
        }),
      );
    } else {
      assert.equal(token, 'page-two');
      response.end(
        JSON.stringify({
          documents: [
            document('two', {
              title: stringValue('Two'),
              featured: booleanValue(false),
            }),
          ],
        }),
      );
    }
  });

  try {
    process.env.FIRESTORE_BASE = `${server.url}/v1`;
    const docs = await fsList('projects');
    assert.ok(docs);
    assert.deepEqual(docs.map((doc) => doc._id), ['one', 'two']);
    assert.equal(docs[0].title, 'One');
    assert.equal(docs[0].description, 'First project');
    assert.equal(docs[0].featured, true);
    assert.deepEqual(docs[0].techStack, ['Flutter', 'Hive']);
    assert.equal(docs[0].order, 2);
    assert.equal(docs[1].featured, false);
    assert.equal(server.requests.length, 2);
    assert.match(server.requests[0].url, /key=public-key/);
  } finally {
    await server.close();
  }
});

test('fsList tolerates malformed documents but reports an HTTP error', async () => {
  let status = 200;
  const server = await startServer((request, response) => {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    if (status !== 200) {
      response.end(JSON.stringify({ error: 'denied' }));
      return;
    }
    response.end(
      JSON.stringify({
        documents: [
          { fields: {} },
          document('good', { title: stringValue('Good') }),
          'not-a-document',
        ],
      }),
    );
  });

  try {
    process.env.FIRESTORE_BASE = `${server.url}/v1`;
    const docs = await fsList('projects');
    assert.ok(docs);
    assert.equal(docs.length, 1);
    assert.equal(docs[0]._id, 'good');

    status = 500;
    await assert.rejects(() => fsList('projects'), /Firestore 500/);
  } finally {
    await server.close();
  }
});

test('fsDoc reads a single document and returns null on failure', async () => {
  let status = 200;
  const server = await startServer((request, response) => {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.end(
      status === 200
        ? JSON.stringify(document('bio', { liveApps: numberValue(2) }))
        : JSON.stringify({ error: 'nope' }),
    );
  });

  try {
    process.env.FIRESTORE_BASE = `${server.url}/v1`;
    const bio = await fsDoc('portfolio/bio');
    assert.deepEqual(bio, { liveApps: 2 });
    status = 500;
    assert.equal(await fsDoc('portfolio/bio'), null);
  } finally {
    await server.close();
  }
});

function loaderContext(warnings: string[], failTitle = '') {
  const entries = new Map<string, any>();
  return {
    entries,
    context: {
      store: {
        clear: () => entries.clear(),
        set: (entry: any) => entries.set(entry.id, entry),
      },
      parseData: async ({ data }: any) => {
        if (failTitle && data.title === failTitle) throw new Error('schema mismatch');
        return data;
      },
      renderMarkdown: async (markdown: string) => ({ html: `<p>${markdown}</p>` }),
      logger: {
        info: () => {},
        warn: (message: string) => warnings.push(message),
      },
      generateDigest: () => 'digest',
    } as any,
  };
}

test('appsLoader maps featured and keeps valid documents when one is malformed', async () => {
  const server = await startServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        documents: [
          document('journeo', {
            title: stringValue('Journeo'),
            description: stringValue('A journal'),
            featured: booleanValue(true),
            techStack: arrayValue([stringValue('Flutter')]),
          }),
          document('broken', {
            title: stringValue('Broken'),
          }),
          document('inveio', {
            title: stringValue('Inveio'),
            description: stringValue('An invoice app'),
            featured: booleanValue(false),
          }),
        ],
      }),
    );
  });

  const warnings: string[] = [];
  const { entries, context } = loaderContext(warnings, 'Broken');

  try {
    process.env.FIRESTORE_BASE = `${server.url}/v1`;
    await appsLoader().load(context);
    assert.deepEqual([...entries.keys()], ['journeo', 'inveio']);
    assert.equal(entries.get('journeo').data.featured, true);
    assert.equal(entries.get('inveio').data.featured, false);
    assert.equal(entries.get('journeo').data.summary, 'A journal');
    assert.equal(warnings.some((message) => message.includes('skipped "Broken"')), true);
  } finally {
    await server.close();
  }
});

test('appsLoader clears the store when Firestore fails so no stale projects remain', async () => {
  const server = await startServer((request, response) => {
    response.statusCode = 500;
    response.end('down');
  });

  const warnings: string[] = [];
  const { entries, context } = loaderContext(warnings);

  try {
    process.env.FIRESTORE_BASE = `${server.url}/v1`;
    entries.set('stale', { id: 'stale' });
    await appsLoader().load(context);
    assert.equal(entries.size, 0);
    assert.equal(warnings.some((message) => message.includes('No projects will be shown')), true);
  } finally {
    await server.close();
  }
});

test('appsLoader leaves the store empty for an empty collection', async () => {
  const server = await startServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ documents: [] }));
  });

  const { entries, context } = loaderContext([]);
  try {
    process.env.FIRESTORE_BASE = `${server.url}/v1`;
    await appsLoader().load(context);
    assert.equal(entries.size, 0);
  } finally {
    await server.close();
  }
});
