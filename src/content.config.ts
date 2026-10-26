import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { appsLoader } from './lib/appsLoader';

const schema = z.object({
  title: z.string(),
  kind: z.string(),
  summary: z.string(),
  status: z.enum(['live', 'soon']),
  order: z.number().default(10),
  featured: z.boolean().default(false),
  stack: z.array(z.string()),
  image: z.string().optional(),
  imageAlt: z.string().default(''),
  tile: z.string().optional(),
  storeUrl: z.string().default(''),
  githubUrl: z.string().default(''),
});

// Local markdown: the fallback and the easiest place to start.
const apps = defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/apps' }), schema });
// Firestore "projects" collection, read at build time through the public REST API.
const appsRemote = defineCollection({ loader: appsLoader(), schema });

export const collections = { apps, appsRemote };
