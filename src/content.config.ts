import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

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

// Local markdown is the only content source for now.
const apps = defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/apps' }), schema });

export const collections = { apps };
