import { getCollection } from 'astro:content';
import { firebaseConfigured } from './firestore.ts';
import { splitProjectGroups } from './projectData.ts';

// Projects come only from Firestore. If it is not configured, empty, or fails,
// the build still succeeds with an empty project list.
export async function getApps() {
  const list = firebaseConfigured() ? await getCollection('apps') : [];
  return list.sort((a, b) => a.data.order - b.data.order);
}

/** Featured Work, upcoming apps and the regular listing all come from Firestore. */
export async function getProjectGroups() {
  const projects = await getApps();
  return { projects, ...splitProjectGroups(projects) };
}
