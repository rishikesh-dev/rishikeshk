import type { Loader } from 'astro/loaders';
import { fsList } from './firestore.ts';
import { normalizeProjects } from './projectData.ts';

// Builds the "apps" content from the Firestore "projects" collection. The field
// names match the old portfolio: title, description, techStack, tag,
// playStoreUrl, githubUrl, story, highlight, decisions, image and featured.
//
// Firestore is the only project source. If it is not set up, empty, or fails,
// nothing is added and the site renders its empty state.
export function appsLoader(): Loader {
  return {
    name: 'firestore-apps',
    async load({ store, parseData, renderMarkdown, logger, generateDigest }) {
      store.clear();

      let docs: Array<Record<string, any>> | null = null;
      try {
        docs = await fsList('projects');
      } catch (e: any) {
        logger.warn(`${e.message} No projects will be shown.`);
        return;
      }
      if (!docs) {
        logger.info('Firestore is not configured. No projects will be shown.');
        return;
      }
      if (!docs.length) {
        logger.info('No projects found in Firestore.');
        return;
      }

      const projects = normalizeProjects(docs);
      let loaded = 0;

      for (const project of projects) {
        try {
          const data = {
            title: project.title,
            kind: project.kind,
            summary: project.summary,
            status: project.status,
            order: project.order,
            featured: project.featured,
            stack: project.stack,
            image: project.image,
            imageAlt: project.imageAlt,
            tile: project.tile,
            storeUrl: project.storeUrl,
            githubUrl: project.githubUrl,
          };

          const parsed = await parseData({ id: project.id, data });
          let html = '';
          try {
            html = project.body ? (await renderMarkdown(project.body)).html : '';
          } catch (error: any) {
            logger.warn(`[firestore] could not render "${project.title}": ${error.message}`);
          }

          store.set({
            id: project.id,
            data: parsed,
            body: project.body,
            rendered: { html },
            digest: generateDigest({ data: parsed, body: project.body }),
          });
          loaded += 1;
        } catch (error: any) {
          // One malformed document should never hide the other projects.
          logger.warn(`[firestore] skipped "${project.title || 'untitled'}": ${error.message}`);
        }
      }

      if (loaded) logger.info(`Loaded ${loaded} apps from Firestore`);
      else logger.warn('No eligible Firestore projects were loaded.');
    },
  };
}
