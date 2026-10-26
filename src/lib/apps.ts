import { getCollection } from 'astro:content';
import { firebaseConfigured } from './firestore';

// Firestore first. If it returns nothing (not configured, empty, or an error),
// use the markdown files in src/content/apps.
export async function getApps() {
  const remote = firebaseConfigured() ? await getCollection('appsRemote') : [];
  const list = remote.length ? remote : await getCollection('apps');
  return list.sort((a, b) => a.data.order - b.data.order);
}
