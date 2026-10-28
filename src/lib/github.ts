// Reads public GitHub data at build time. In GitHub Actions, GITHUB_TOKEN raises
// the rate limit. The token is only ever sent in a server-side request header.
import { processReadme, type Readme, type RepoBases } from './markdown.ts';

const metaEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
const env = (key: string): string | undefined => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
  if (metaEnv && metaEnv[key]) return metaEnv[key];
  return undefined;
};
const api = () => env('GITHUB_API_BASE') ?? 'https://api.github.com';
const TIMEOUT_MS = 10_000;
const cache = new Map<string, Promise<any>>();

export type RepoRef = { owner: string; repo: string; htmlUrl: string };

/**
 * Strictly parses a configured GitHub repository URL. Only github.com (or
 * www.github.com) URLs with an owner and repository are accepted.
 */
export function parseRepo(url?: string): RepoRef | null {
  if (typeof url !== 'string') return null;

  let value = url.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    if (!/^github\.com\//i.test(value)) return null;
    value = `https://${value}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  let owner: string;
  let repo: string;
  try {
    owner = decodeURIComponent(parts[0]);
    repo = decodeURIComponent(parts[1]).replace(/\.git$/i, '');
  } catch {
    return null;
  }
  if (!/^[a-z0-9_.-]+$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(repo)) return null;
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') return null;
  if (parts[1].includes('%2f') || parts[1].includes('%5c')) return null;

  return { owner, repo, htmlUrl: `https://github.com/${owner}/${repo}` };
}

export function repoBases(repo: RepoRef): RepoBases {
  return {
    rawBase: `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/`,
    blobBase: `https://github.com/${repo.owner}/${repo.repo}/blob/HEAD/`,
  };
}

function headers(accept: string): Record<string, string> {
  const result: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'portfolio-build',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = env('GITHUB_TOKEN');
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

function githubFetch(url: string, accept: string): Promise<Response> {
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  return fetch(url, { headers: headers(accept), signal });
}

function once<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  if (!cache.has(key)) {
    cache.set(
      key,
      fn().catch(() => {
        return null;
      }),
    );
  }
  return cache.get(key)!;
}

/** Exposed so tests and rebuild tools can avoid sharing stale in-process data. */
export function clearGithubCache(): void {
  cache.clear();
}

const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en', { month: 'short', year: 'numeric' });
};

export type RepoStats = {
  owner: string;
  repo: string;
  name: string;
  fullName: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  topics: string[];
  updated: string;
  updatedAt: string;
  htmlUrl: string;
};

/** Repository metadata for a valid GitHub URL, or null on any failure. */
export function getRepo(url?: string): Promise<RepoStats | null> {
  const repo = parseRepo(url);
  if (!repo) return Promise.resolve(null);

  return once(`repo:${repo.owner}/${repo.repo}`, async () => {
    const response = await githubFetch(
      `${api()}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,
      'application/vnd.github+json',
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const json: any = await response.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new Error('unexpected repository response');
    }

    const updatedAt = asText(json.pushed_at) || asText(json.updated_at);
    return {
      owner: repo.owner,
      repo: repo.repo,
      name: asText(json.name) || repo.repo,
      fullName: asText(json.full_name) || `${repo.owner}/${repo.repo}`,
      description: asText(json.description),
      stars: asNumber(json.stargazers_count),
      forks: asNumber(json.forks_count),
      language: asText(json.language),
      topics: Array.isArray(json.topics)
        ? json.topics.map(asText).filter(Boolean)
        : [],
      updated: formatDate(updatedAt),
      updatedAt,
      htmlUrl: repo.htmlUrl,
    };
  });
}

function readmeBody(text: string, contentType: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const isJsonContentType = contentType.includes('application/json') || contentType.includes('+json');
  // If it's markdown/text content type, don't try to parse as JSON
  if (contentType.includes('text/markdown') || contentType.includes('text/plain')) {
    return text;
  }
  if (!isJsonContentType) {
    return text;
  }
  const looksJson = /^[{[]/.test(trimmed);
  if (!looksJson) return text;

  try {
    const json: any = JSON.parse(trimmed);
    if (json && typeof json.content === 'string') {
      return Buffer.from(json.content.replace(/\s+/g, ''), 'base64').toString('utf8');
    }
    if (json && typeof json.message === 'string') {
      throw new Error(`GitHub: ${json.message}`);
    }
    if (typeof json === 'string') return json;
  } catch (error) {
    if (isJsonContentType) throw error;
  }

  return text;
}

/**
 * Fetches and processes a README. Missing files, private repositories, rate
 * limits and invalid URLs all resolve to null instead of failing the build.
 */
export function getReadme(url?: string): Promise<Readme | null> {
  const repo = parseRepo(url);
  if (!repo) return Promise.resolve(null);

  return once(`readme:${repo.owner}/${repo.repo}`, async () => {
    const response = await githubFetch(
      `${api()}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/readme`,
      'application/vnd.github.raw+json',
    );

    if (!response.ok) {
      if ([403, 404, 410, 429].includes(response.status)) return null;
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      const body = await response.text();
      const markdown = readmeBody(body, contentType);
      if (!markdown.trim()) return null;
      return processReadme(markdown, repoBases(repo));
    }
    const body = await response.text();
    if (!body.trim()) return null;
    return processReadme(body, repoBases(repo));
  });
}

/** Backwards-compatible HTML accessor used by the case-study page. */
export async function getReadmeHtml(url?: string): Promise<string | null> {
  const readme = await getReadme(url);
  return readme?.html ?? null;
}


// ---- Minimal Firestore enrichment helpers ----
const enrichCache = new Map<string, unknown>();

function enrichHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'rishikeshk-portfolio',
  };
  const token = env('GITHUB_TOKEN');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function enrichFetchJson<T>(url: string): Promise<T> {
  if (enrichCache.has(url)) {
    return enrichCache.get(url) as T;
  }
  const res = await fetch(url, { headers: enrichHeaders() });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json') || contentType.includes('+json');
  const data = isJson ? ((await res.json()) as T) : ((await res.text()) as unknown as T);
  enrichCache.set(url, data);
  return data;
}

function parseRepoPathSimple(githubUrl: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(githubUrl);
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    let repo = parts[1];
    if (repo.endsWith('.git')) repo = repo.slice(0, -4);
    return { owner, repo };
  } catch {
    return null;
  }
}

function prettifyRepoNameSimple(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

export type RepoMetaSimple = {
  title: string;
  description: string;
  created_at?: string;
  topics?: string[];
};

export async function fetchRepoMeta(githubUrl: string): Promise<RepoMetaSimple | null> {
  const parsed = parseRepoPathSimple(githubUrl);
  if (!parsed) return null;
  try {
    const repo = await enrichFetchJson<any>(`${api()}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
    return {
      title: repo?.name ? prettifyRepoNameSimple(repo.name) : '',
      description: repo?.description || '',
      created_at: repo?.created_at,
      topics: Array.isArray(repo?.topics) ? repo.topics : [],
    };
  } catch {
    return null;
  }
}

export async function fetchRepoLanguages(githubUrl: string): Promise<string[]> {
  const parsed = parseRepoPathSimple(githubUrl);
  if (!parsed) return [];
  try {
    const langs = await enrichFetchJson<Record<string, number>>(`${api()}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/languages`);
    const entries = Object.entries(langs || {}).sort((a, b) => b[1] - a[1]);
    return entries.map(([name]) => name);
  } catch {
    return [];
  }
}

export async function fetchRateLimit(): Promise<any> {
  try {
    const res = await fetch(`${api()}/rate_limit`, { headers: enrichHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchRepoReadmeRaw(githubUrl: string): Promise<string> {
  const parsed = parseRepoPathSimple(githubUrl);
  if (!parsed) return '';
  try {
    const res = await fetch(`${api()}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/readme`, {
      headers: {
        ...enrichHeaders(),
        'Accept': 'application/vnd.github.raw+json',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || '';
    let text = '';
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      try {
        const json: any = await res.json();
        if (json && typeof json.content === 'string') {
          text = Buffer.from(json.content.replace(/\s+/g, ''), 'base64').toString('utf8');
        } else if (typeof json === 'string') {
          text = json;
        } else {
          text = '';
        }
      } catch {
        text = await res.text();
      }
    } else {
      text = await res.text();
    }
    enrichCache.set(`${api()}/repos/${parsed.owner}/${parsed.repo}/readme`, text);
    return text || '';
  } catch {
    return '';
  }
}

export { fetchRepoReadmeRaw as fetchRepoReadme };

const KNOWN_TAGS_ENRICH = new Set([
  'utility',
  'utilities',
  'productivity',
  'health',
  'fitness',
  'finance',
  'education',
  'social',
  'game',
  'games',
  'travel',
  'news',
  'shopping',
  'entertainment',
  'tools',
  'tool',
]);

export function pickTag(topics: string[] = []): string {
  for (const t of topics) {
    const lower = String(t).toLowerCase();
    if (KNOWN_TAGS_ENRICH.has(lower)) {
      if (lower === 'utilities') return 'Utility';
      if (lower === 'tools') return 'Tools';
      if (lower === 'tool') return 'Tool';
      if (lower === 'games') return 'Game';
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
  }
  if (topics.length > 0) {
    const first = String(topics[0]);
    return first.charAt(0).toUpperCase() + first.slice(1).replace(/[-_]+/g, ' ');
  }
  return 'App';
}

function extractSectionSimple(readme: string, heading: string): string {
  if (!readme) return '';
  // Restrict to exact headings: Story, Decisions, Highlight (case-insensitive)
  const allowed = new Set(['story', 'decisions', 'highlight']);
  if (!allowed.has(heading.toLowerCase())) return '';
  const regex = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im');
  const match = readme.match(regex);
  if (!match || match.index === undefined) return '';
  const start = match.index + match[0].length;
  const rest = readme.slice(start);
  const nextHeading = rest.match(/^##\s+/m);
  const section = nextHeading && nextHeading.index !== undefined ? rest.slice(0, nextHeading.index) : rest;
  return section.replace(/\r\n/g, '\n').trim();
}

export function parseReadmeSections(readme: string) {
  const story = extractSectionSimple(readme, 'Story');
  const highlightSection = extractSectionSimple(readme, 'Highlight');
  const decisionsSection = extractSectionSimple(readme, 'Decisions');
  const decisions: string[] = [];
  if (decisionsSection) {
    const lines = decisionsSection.split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*[-*+]\s+(.+)$/);
      if (m) {
        decisions.push(m[1].trim());
      }
    }
  }
  return {
    story,
    highlight: highlightSection,
    decisions,
  };
}
