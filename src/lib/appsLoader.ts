import type { Loader } from 'astro/loaders';
import { fsList } from './firestore';

const text = (value: unknown): string => (value == null ? '' : String(value));
const find = (object: Record<string, any>, re: RegExp) => {
  const key = Object.keys(object).find((name) => re.test(name));
  return key ? object[key] : undefined;
};
const list = (value: any): string[] => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  return [];
};
const slug = (value: string) =>
  String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Builds the "apps" content from the Firestore "projects" collection. The field
// names match the old portfolio: title, description, techStack, tag,
// playStoreUrl, githubUrl, story, highlight and decisions.
//
// If Firestore is not set up, empty, or fails in any way, nothing is added and
// the site falls back to the markdown files in src/content/apps.
export function appsLoader(): Loader {
  return {
    name: 'firestore-apps',
    async load({ store, parseData, renderMarkdown, logger, generateDigest }) {
      store.clear();

      let docs: Array<Record<string, any>> | null = null;
      try {
        docs = await fsList('projects');
      } catch (e: any) {
        logger.warn(`${e.message} Using local markdown instead.`);
        return;
      }
      if (!docs?.length) return;

      try {
        const hasFeatured = docs.some((doc) => doc.featured === true);
        for (const [index, doc] of docs.entries()) {
          const play = text(doc.playStoreUrl ?? doc.playStoreURL ?? find(doc, /play.?store/i) ?? '');
          const github = text(doc.githubUrl ?? doc.githubURL ?? doc.github ?? find(doc, /git/i) ?? '');
          const image = text(doc.image ?? find(doc, /^(image|cover|screenshot|thumbnail)/i) ?? '');
          const decisions = list(doc.decisions);
          const title = text(doc.title ?? doc._id);

          const data = {
            title,
            kind: text(doc.tag ?? doc.kind ?? 'App'),
            summary: text(doc.description ?? doc.summary ?? ''),
            status: doc.status === 'live' || doc.status === 'soon' ? doc.status : play ? 'live' : 'soon',
            order: typeof doc.order === 'number' ? doc.order : index + 1,
            featured: hasFeatured ? doc.featured === true : index === 0,
            stack: list(doc.techStack ?? doc.stack),
            image: image || undefined,
            imageAlt: text(doc.imageAlt ?? `${title} screenshot`),
            tile: text(doc.tile) || undefined,
            storeUrl: play,
            githubUrl: github,
          };

          const body = [
            doc.story ? `## The story\n\n${text(doc.story)}` : '',
            doc.highlight ? `## Highlight\n\n${text(doc.highlight)}` : '',
            decisions.length ? `## Key decisions\n\n${decisions.map((item) => `- ${item}`).join('\n')}` : '',
          ].filter(Boolean).join('\n\n');

          const id = slug(title) || slug(text(doc._id)) || `app-${index + 1}`;
          store.set({
            id,
            data: await parseData({ id, data }),
            body,
            rendered: { html: (await renderMarkdown(body)).html },
            digest: generateDigest({ data, body }),
          });
        }
        logger.info(`Loaded ${docs.length} apps from Firestore`);
      } catch (e: any) {
        store.clear();
        logger.warn(`[firestore] ${e.message} Using local markdown instead.`);
      }
    },
  };
}
