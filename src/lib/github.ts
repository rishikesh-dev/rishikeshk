// Reads public GitHub data at build time. In GitHub Actions, GITHUB_TOKEN raises
// the rate limit. The token is only ever sent in a server-side request header.
import { processReadme, type Readme, type RepoBases } from './markdown.ts';

const metaEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
const env = (key: string): string | undefined => process.env[key] ?? metaEnv[key];
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
      fn().catch((error: any) => {
        console.warn(`[github] ${key}: ${error?.message ?? error}`);
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

  const looksJson = contentType.includes('json') || /^[{[]/.test(trimmed);
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
    // A JSON content type means a malformed response is an API error. A body
    // that merely starts with "{" can still be valid Markdown.
    if (contentType.includes('json')) throw error;
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

    const body = await response.text();
    const markdown = readmeBody(body, response.headers.get('content-type') ?? '');
    if (!markdown.trim()) return null;

    return processReadme(markdown, repoBases(repo));
  });
}

/** Backwards-compatible HTML accessor used by the case-study page. */
export async function getReadmeHtml(url?: string): Promise<string | null> {
  const readme = await getReadme(url);
  return readme?.html ?? null;
}
