// Field-precedence rules for combining curated Firestore content with GitHub
// repository metadata and README sections.
import type { Readme, ReadmeSection, ReadmeSectionKind } from './markdown.ts';
import type { RepoStats } from './github.ts';

export type ProjectData = {
  title?: string;
  summary?: string;
  stack?: string[];
  githubUrl?: string;
};

export type CuratedContent = {
  story: boolean;
  highlight: boolean;
  decisions: boolean;
  stack: boolean;
};

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/** Which curated sections the case study already contains. */
export function curatedContent(body: string, stack: string[] = []): CuratedContent {
  return {
    story: /^##\s+The story\b/im.test(body),
    highlight: /^##\s+Highlight\b/im.test(body),
    decisions: /^##\s+Key decisions\b/im.test(body),
    stack: stack.filter(Boolean).length > 0,
  };
}

/**
 * Curated Firestore content wins. README sections fill the gaps and add
 * technical detail (architecture, setup, other notes) without repeating the
 * story, highlights or decisions already written for the project.
 */
export function selectReadmeSections(readme: Readme | null, curated: CuratedContent, body = ''): ReadmeSection[] {
  if (!readme) return [];

  const suppressed = new Set<ReadmeSectionKind>();
  if (curated.story) suppressed.add('overview');
  if (curated.highlight) suppressed.add('features');
  if (curated.decisions) suppressed.add('decisions');
  if (curated.stack) suppressed.add('stack');

  const curatedText = normalize(body);
  return readme.sections.filter((section) => {
    if (suppressed.has(section.kind)) return false;
    // Also skip a README section whose text is already present verbatim in the
    // curated case study, even if its heading has an unexpected name.
    if (section.text.length >= 60 && curatedText.includes(normalize(section.text))) return false;
    return true;
  });
}

export type MergedProject = {
  summary: string;
  stack: string[];
  repo: RepoStats | null;
  repoDescription: string;
  readmeSections: ReadmeSection[];
};

/**
 * Firestore values first; GitHub fills only what is missing. Repository
 * descriptions are only surfaced when they add something beyond the curated
 * summary.
 */
export function mergeProjectDetails(
  data: ProjectData,
  body: string,
  repo: RepoStats | null,
  readme: Readme | null,
): MergedProject {
  const curatedSummary = (data.summary ?? '').trim();
  const summary = curatedSummary || repo?.description || '';
  const curatedStack = (data.stack ?? []).filter(Boolean);
  const githubStack = [repo?.language ?? '', ...(repo?.topics ?? [])]
    .filter(Boolean)
    .filter((value, index, all) => all.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index);
  const stack = curatedStack.length ? curatedStack : githubStack.slice(0, 6);
  const curated = curatedContent(body, curatedStack);
  const repoDescription =
    repo?.description && normalize(repo.description) !== normalize(summary)
      ? repo.description
      : '';

  return {
    summary,
    stack,
    repo,
    repoDescription,
    readmeSections: selectReadmeSections(readme, curated, body),
  };
}
