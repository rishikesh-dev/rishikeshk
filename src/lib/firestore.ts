// Reads public Firestore data at build time through the REST API.
// No private key is needed: it uses the public web API key and Firestore security rules.
const env = (key: string): string | undefined =>
  process.env[key] ?? (import.meta.env as Record<string, string | undefined>)[key];

const base = () => env('FIRESTORE_BASE') ?? 'https://firestore.googleapis.com/v1';
const root = () => `${base()}/projects/${env('PUBLIC_FIREBASE_PROJECT_ID')}/databases/(default)/documents`;

export const firebaseConfigured = () =>
  Boolean(env('PUBLIC_FIREBASE_PROJECT_ID') && env('PUBLIC_FIREBASE_API_KEY'));

function fromFs(value: any): any {
  if (value == null || 'nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
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

export async function fsList(collection: string): Promise<Array<Record<string, any>> | null> {
  if (!firebaseConfigured()) return null;
  const out: Array<Record<string, any>> = [];
  let token = '';
  do {
    const url = `${root()}/${collection}?pageSize=100&key=${env('PUBLIC_FIREBASE_API_KEY')}${token ? `&pageToken=${token}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Firestore ${res.status} reading "${collection}". Check your security rules.`);
    }
    const json = await res.json();
    for (const doc of json.documents ?? []) {
      out.push({ _id: doc.name.split('/').pop(), ...fields(doc.fields) });
    }
    token = json.nextPageToken ?? '';
  } while (token);
  return out;
}

export async function fsDoc(path: string): Promise<Record<string, any> | null> {
  if (!firebaseConfigured()) return null;
  try {
    const res = await fetch(`${root()}/${path}?key=${env('PUBLIC_FIREBASE_API_KEY')}`);
    if (!res.ok) throw new Error(String(res.status));
    return fields((await res.json()).fields);
  } catch (e: any) {
    console.warn(`[firestore] could not read ${path}: ${e.message}`);
    return null;
  }
}
