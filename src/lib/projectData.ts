// Pure helpers that turn the raw Firestore "projects" documents into the shape
// the Astro content collection expects. GitHub enrichment is used as fallback.
import { fetchRepoLanguages, fetchRepoMeta, fetchRepoReadme, parseReadmeSections, pickTag } from './github';

export type ProjectStatus = 'live' | 'soon';

export type NormalizedProject = {
  title: string;
  kind: string;
  summary: string;
  status: ProjectStatus;
  order: number;
  featured: boolean;
  stack: string[];
  image?: string;
  imageAlt: string;
  tile?: string;
  storeUrl: string;
  githubUrl: string;
  body: string;
  story: string;
  highlight: string;
  decisions: string[];
};

type RawDoc = Record<string, unknown>;

const isRecord = (value: unknown): value is RawDoc =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const find = (doc: RawDoc, pattern: RegExp): unknown => {
  const key = Object.keys(doc).find((name) => pattern.test(name));
  return key ? doc[key] : undefined;
};

/** Array fields can arrive as arrays, or as comma/newline separated strings. */
export const toList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

export const slugify = (value: unknown): string =>
  text(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * A project is eligible when it is not explicitly unpublished or a draft.
 * Missing flags mean the project is eligible, matching the original behaviour.
 * `featured` is deliberately not part of this rule.
 */
export const isEligible = (doc: RawDoc): boolean =>
  doc.published !== false && doc.draft !== true;

const statusFor = (doc: RawDoc, playStoreUrl: string): ProjectStatus => {
  if (doc.status === 'live' || doc.status === 'soon') return doc.status;
  return playStoreUrl ? 'live' : 'soon';
};

const bodyFor = (story: string, highlight: string, decisions: string[]): string =>
  [
    story ? `## The story\n\n${story}` : '',
    highlight ? `## Highlight\n\n${highlight}` : '',
    decisions.length ? `## Key decisions\n\n${decisions.map((item) => `- ${item}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

/** Maps one Firestore document. Returns null when it has no usable title. */
export function normalizeProject(doc: unknown, index = 0): NormalizedProject | null {
  if (!isRecord(doc)) return null;

  const title = text(doc.title) || text(doc._id);
  if (!title) return null;

  const playStoreUrl = text(
    doc.playStoreUrl ?? doc.playStoreURL ?? find(doc, /^play.?store/i),
  );
  const githubUrl = text(doc.githubUrl ?? doc.githubURL ?? find(doc, /^github/i));
  const image = text(doc.image ?? doc.coverImage ?? find(doc, /^(image|cover|screenshot|thumbnail)/i));
  const story = text(doc.story);
  const highlight = text(doc.highlight);
  const decisions = toList(doc.decisions);
  const stack = toList(doc.techStack ?? doc.stack);
  const numericOrder = Number(doc.order);

  return {
    title,
    kind: text(doc.tag ?? doc.kind) || 'App',
    summary: text(doc.description ?? doc.summary),
    status: statusFor(doc, playStoreUrl),
    order: Number.isFinite(numericOrder) ? numericOrder : index + 1,
    // Only an actual boolean true enables Featured Work. A missing value, a
    // string such as "true", or any other malformed value is not featured.
    featured: doc.featured === true,
    stack,
    image: image || undefined,
    imageAlt: text(doc.imageAlt) || `${title} screenshot`,
    tile: text(doc.tile) || undefined,
    storeUrl: playStoreUrl,
    githubUrl,
    body: bodyFor(story, highlight, decisions),
    story,
    highlight,
    decisions,
  };
}

export type NamedProject = NormalizedProject & { id: string };

/**
 * Normalizes every eligible document, skips malformed documents instead of
 * failing the collection, and makes slugs unique so two projects can never
 * collide on `/apps/<slug>/`.
 */
export function normalizeProjects(docs: unknown): NamedProject[] {
  if (!Array.isArray(docs)) return [];

  const used = new Set<string>();
  const out: NamedProject[] = [];

  for (const [index, doc] of docs.entries()) {
    if (!isRecord(doc) || !isEligible(doc)) continue;

    let project: NormalizedProject | null = null;
    try {
      project = normalizeProject(doc, index);
    } catch {
      project = null;
    }
    if (!project) continue;

    const base = slugify(project.title) || `project-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    out.push({ id, ...project });
  }

  return out;
}

export type GroupedProject = { data: { featured?: boolean; status?: string } };

export const isFeatured = (project: GroupedProject): boolean =>
  project.data.featured === true;

/**
 * Featured placement is decided by `featured === true` only. Non-featured
 * projects are split by status so "More on the way" is driven by Firestore too.
 */
export function splitProjectGroups<T extends GroupedProject>(projects: T[]) {
  const featured: T[] = [];
  const upcoming: T[] = [];
  const others: T[] = [];
  for (const project of projects) {
    if (isFeatured(project)) featured.push(project);
    else if (project.data.status === 'soon') upcoming.push(project);
    else others.push(project);
  }
  return { featured, upcoming, others };
}
