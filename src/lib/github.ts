// Reads public GitHub data at build time. In GitHub Actions, GITHUB_TOKEN raises the rate limit.
import { Marked } from 'marked';

const env = (key: string): string | undefined =>
  process.env[key] ?? (import.meta.env as Record<string, string | undefined>)[key];
const api = () => env('GITHUB_API_BASE') ?? 'https://api.github.com';
const cache = new Map<string, Promise<any>>();

export function parseRepo(url?: string) {
  const match = url?.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  return match ? { owner: match[1], repo: match[2].replace(/\.git$/, '') } : null;
}

function headers(accept: string) {
  const result: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'portfolio-build',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = env('GITHUB_TOKEN');
  if (token) result.Authorization = `Bearer ${token}`;
  return result;
}

function once<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  if (!cache.has(key)) {
    cache.set(
      key,
      fn().catch((e) => {
        console.warn(`[github] ${key}: ${e.message}`);
        return null;
      }),
    );
  }
  return cache.get(key)!;
}

export type RepoStats = { stars: number; forks: number; language: string; updated: string };

export function getRepo(url?: string): Promise<RepoStats | null> {
  const repo = parseRepo(url);
  if (!repo) return Promise.resolve(null);
  return once(`repo:${repo.owner}/${repo.repo}`, async () => {
    const res = await fetch(`${api()}/repos/${repo.owner}/${repo.repo}`, {
      headers: headers('application/vnd.github+json'),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return {
      stars: json.stargazers_count,
      forks: json.forks_count,
      language: json.language ?? '',
      updated: new Date(json.pushed_at).toLocaleDateString('en', {
        month: 'short',
        year: 'numeric',
      }),
    };
  });
}

export function getReadmeHtml(url?: string): Promise<string | null> {
  const repo = parseRepo(url);
  if (!repo) return Promise.resolve(null);
  return once(`readme:${repo.owner}/${repo.repo}`, async () => {
    const res = await fetch(`${api()}/repos/${repo.owner}/${repo.repo}/readme`, {
      headers: headers('application/vnd.github.raw+json'),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const markdown = (await res.text()).replace(/^\s*#\s+.*\n/, ''); // the page already has the app title
    const raw = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/`;
    const blob = `https://github.com/${repo.owner}/${repo.repo}/blob/HEAD/`;
    const fix = (href: string, to: string) =>
      /^([a-z]+:|#|\/\/)/i.test(href) ? href : to + href.replace(/^\.?\//, '');
    const marked = new Marked({
      walkTokens(token: any) {
        if (token.type === 'image') token.href = fix(token.href, raw);
        else if (token.type === 'link') token.href = fix(token.href, blob);
      },
    });
    return (marked.parse(markdown, { async: false }) as string)
      .replace(/<(script|iframe|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '');
  });
}
