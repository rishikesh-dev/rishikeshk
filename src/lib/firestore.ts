// Reads public Firestore data at build time through the REST API.
// No private key is needed: it uses the public web API key and Firestore security rules.
const metaEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
const env = (key: string): string | undefined => process.env[key] ?? metaEnv[key];
const TIMEOUT_MS = 10_000;

const base = () => (env('FIRESTORE_BASE') ?? 'https://firestore.googleapis.com/v1').replace(/\/+$/, '');
const root = () => `${base()}/projects/${env('PUBLIC_FIREBASE_PROJECT_ID')}/databases/(default)/documents`;

export const firebaseConfigured = () =>
  Boolean(env('PUBLIC_FIREBASE_PROJECT_ID') && env('PUBLIC_FIREBASE_API_KEY'));

function fromFs(value: any): any {
  if (value == null || 'nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(fromFs);
  if ('mapValue' in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, fromFs(item)]),
    );
  }
  return null;
}

const fields = (value: any) => fromFs({ mapValue: { fields: value ?? {} } });

function request(url: string): Promise<Response> {
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  return fetch(url, { signal });
}

export async function fsList(collection: string): Promise<Array<Record<string, any>> | null> {
  if (!firebaseConfigured()) return null;
  const out: Array<Record<string, any>> = [];
  const seenTokens = new Set<string>();
  let token = '';

  do {
    const query = new URLSearchParams({ pageSize: '100', key: env('PUBLIC_FIREBASE_API_KEY') ?? '' });
    if (token) query.set('pageToken', token);
    const url = `${root()}/${encodeURIComponent(collection)}?${query.toString()}`;

    const res = await request(url);
    if (!res.ok) {
      throw new Error(`Firestore ${res.status} reading "${collection}". Check your security rules.`);
    }

    const json: any = await res.json();
    const documents = json?.documents;
    if (documents != null && !Array.isArray(documents)) {
      throw new Error(`Firestore returned malformed documents for "${collection}".`);
    }

    for (const doc of documents ?? []) {
      if (!doc || typeof doc.name !== 'string') continue;
      try {
        out.push({ _id: doc.name.split('/').pop(), ...fields(doc.fields) });
      } catch {
        // One malformed document must not hide the rest of the collection.
      }
    }

    const next = typeof json?.nextPageToken === 'string' ? json.nextPageToken : '';
    token = next && !seenTokens.has(next) ? next : '';
    if (token) seenTokens.add(token);
  } while (token);

  return out;
}

export async function fsDoc(path: string): Promise<Record<string, any> | null> {
  if (!firebaseConfigured()) return null;
  try {
    const res = await request(
      `${root()}/${path}?key=${encodeURIComponent(env('PUBLIC_FIREBASE_API_KEY') ?? '')}`,
    );
    if (!res.ok) throw new Error(String(res.status));
    return fields((await res.json()).fields);
  } catch (e: any) {
    console.warn(`[firestore] could not read ${path}: ${e.message}`);
    return null;
  }
}
