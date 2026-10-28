// Field-precedence rules for combining curated Firestore content with GitHub
// repository metadata. The full README is rendered separately on the page.
import type { RepoStats } from './github.ts';

export type ProjectData = {
  title?: string;
  summary?: string;
  stack?: string[];
  githubUrl?: string;
};

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

export type MergedProject = {
  summary: string;
  stack: string[];
  repo: RepoStats | null;
  repoDescription: string;
};

/**
 * Firestore values first; GitHub fills only what is missing. Repository
 * descriptions are only surfaced when they add something beyond the curated
 * summary.
 */
export function mergeProjectDetails(data: ProjectData, repo: RepoStats | null): MergedProject {
  const curatedSummary = (data.summary ?? '').trim();
  const summary = curatedSummary || repo?.description || '';
  const curatedStack = (data.stack ?? []).filter(Boolean);
  const githubStack = [repo?.language ?? '', ...(repo?.topics ?? [])]
    .filter(Boolean)
    .filter((value, index, all) => all.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index);
  const stack = curatedStack.length ? curatedStack : githubStack.slice(0, 6);
  const repoDescription =
    repo?.description && normalize(repo.description) !== normalize(summary)
      ? repo.description
      : '';

  return {
    summary,
    stack,
    repo,
    repoDescription,
  };
}
