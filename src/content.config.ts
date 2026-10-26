import { defineCollection } from 'astro:content';
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

// Firestore "projects" collection, read at build time through the public REST API.
const apps = defineCollection({ loader: appsLoader(), schema });

export const collections = { apps };
