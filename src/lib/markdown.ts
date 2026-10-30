// README Markdown rendering, section extraction, URL resolution and HTML
// sanitization. Build-time only; no browser APIs are required.
import { Marked } from 'marked';

export type ReadmeSectionKind =
  | 'overview'
  | 'features'
  | 'architecture'
  | 'stack'
  | 'decisions'
  | 'setup'
  | 'other';

export type ReadmeSection = {
  id: string;
  title: string;
  kind: ReadmeSectionKind;
  html: string;
  text: string;
};

export type Readme = {
  markdown: string;
  html: string;
  sections: ReadmeSection[];
};

export type RepoBases = { rawBase: string; blobBase: string };

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ESCAPES[character]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
  bsol: '\\',
};

/** Decodes the entities a browser would decode inside an attribute value. */
export function decodeEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 2; pass += 1) {
    decoded = decoded.replace(/&(#x?[0-9a-f]+|[a-z]+);?/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const hex = entity[1]?.toLowerCase() === 'x';
        const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(number) && number > 0 && number <= 0x10ffff
          ? String.fromCodePoint(number)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    });
  }
  return decoded;
}

const compactScheme = (value: string): string =>
  decodeEntities(value)
    .replace(/[\u0000-\u0020\u007f]+/g, '')
    .toLowerCase();

/**
 * Returns a safe URL or null. Javascript/data/vbscript URLs and unknown
 * schemes are rejected after entity decoding and whitespace removal, which
 * also catches obfuscated forms such as `java&#x09;script:`.
 */
export function safeUrl(value: string, image = false): string | null {
  const raw = value.trim();
  if (!raw) return null;

  const compact = compactScheme(raw);
  if (!compact) return null;
  if (compact.startsWith('javascript:') || compact.startsWith('data:') || compact.startsWith('vbscript:')) {
    return null;
  }

  const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/)?.[1];
  const allowed = scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel';
  if (scheme && !allowed) return null;

  if (image) {
    if (scheme !== 'http' && scheme !== 'https' && !compact.startsWith('/')) return null;
  }

  return raw;
}

/** Resolves relative README links/images against the GitHub repository. */
export function resolveReadmeUrl(href: string, base: string): string {
  const value = href.trim();
  if (!value) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//') || value.startsWith('#')) {
    return value;
  }

  const cleaned = value.replace(/^\.?\//, '');
  try {
    return new URL(cleaned, base).href;
  } catch {
    return `${base}${cleaned}`;
  }
}

const ALLOWED_TAGS = new Set([
  'a', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong', 'del',
  's', 'sup', 'sub', 'kbd', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'th', 'td', 'img',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);
const DANGEROUS_ELEMENTS =
  /<(script|style|iframe|object|embed|form|svg|math|template|noscript|video|audio|canvas|select|textarea|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DANGEROUS_TAGS =
  /<\/?(script|style|iframe|object|embed|form|svg|math|template|noscript|video|audio|canvas|select|textarea|button|input|option|link|meta|base|source|track|picture)\b[^>]*>/gi;
const ATTRIBUTE =
  /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributeValue(match: RegExpExecArray): string {
  return match[2] ?? match[3] ?? match[4] ?? '';
}

function sanitizeAttributes(tag: string, source: string): string {
  const output: string[] = [];
  let href: string | null = null;

  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    const value = attributeValue(match as RegExpExecArray);
    let safe: string | null = null;

    if (name === 'href' && tag === 'a') {
      safe = safeUrl(value);
      if (safe) href = safe;
    } else if (name === 'src' && tag === 'img') {
      safe = safeUrl(value, true);
    } else if (name === 'alt' && tag === 'img') {
      safe = value;
    } else if (name === 'title' && (tag === 'a' || tag === 'img')) {
      safe = value;
    } else if (name === 'class' && tag === 'code') {
      safe = /^language-[a-z0-9_+-]+$/i.test(value) ? value : null;
    } else if ((name === 'colspan' || name === 'rowspan') && (tag === 'td' || tag === 'th')) {
      safe = /^\d{1,3}$/.test(value) ? value : null;
    } else if (name === 'align' && (tag === 'td' || tag === 'th')) {
      safe = /^(left|right|center)$/i.test(value) ? value.toLowerCase() : null;
    } else if (name === 'start' && tag === 'ol') {
      safe = /^-?\d{1,6}$/.test(value) ? value : null;
    }

    if (safe !== null) output.push(`${name}="${escapeHtml(safe)}"`);
  }

  if (tag === 'a') {
    if (!href) return '';
    output.push('rel="nofollow noopener noreferrer"');
  }
  if (tag === 'img') {
    if (!output.some((item) => item.startsWith('src='))) return '';
    if (!output.some((item) => item.startsWith('alt='))) output.push('alt=""');
    output.push('loading="lazy"', 'decoding="async"');
  }

  return output.length ? ` ${output.join(' ')}` : '';
}

/**
 * Allowlist sanitizer for Marked output. Raw HTML is dropped by the renderer,
 * and this pass is the belt-and-braces layer for attributes, URLs and tags.
 */
export function sanitizeHtml(html: string): string {
  let output = html.replace(/<!--[\s\S]*?-->/g, '');

  for (let pass = 0; pass < 2; pass += 1) {
    output = output.replace(DANGEROUS_ELEMENTS, '');
  }
  output = output.replace(DANGEROUS_TAGS, '');
  output = output.replace(/<!--[\s\S]*?-->/g, '');

  return output.replace(
    /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g,
    (match, closing: string, rawTag: string, rawAttributes: string, selfClosing: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';

      if (closing) return `</${tag}>`;
      if (VOID_TAGS.has(tag)) return `<${tag}${sanitizeAttributes(tag, rawAttributes)}${tag === 'img' ? ' /' : ''}>`;

      const attributes = sanitizeAttributes(tag, rawAttributes);
      if (tag === 'a' && !attributes) return '';
      return `<${tag}${attributes}${selfClosing ? ' /' : ''}>`;
    },
  );
}

const stripTags = (html: string): string =>
  decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

function renderMarkdown(markdown: string, bases: RepoBases): string {
  const marked = new Marked({
    gfm: true,
    renderer: {
      // Never render raw HTML from a README. Markdown-generated HTML goes
      // through the sanitizer below.
      html: () => '',
    },
    walkTokens(token: any) {
      if (token.type === 'image' && typeof token.href === 'string') {
        token.href = resolveReadmeUrl(token.href, bases.rawBase);
      } else if (token.type === 'link' && typeof token.href === 'string') {
        token.href = resolveReadmeUrl(token.href, bases.blobBase);
      }
    },
  });

  return sanitizeHtml(marked.parse(markdown, { async: false }) as string);
}

const plainTitle = (title: string): string =>
  title
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim();

const sectionId = (title: string, used: Set<string>): string => {
  const base = plainTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
};

export function classifySection(title: string): ReadmeSectionKind {
  const value = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/(decision|trade ?off|challenge|implementation note|lesson)/.test(value)) return 'decisions';
  if (/(feature|capabilit|highlight|what .* (do|does)|what s inside)/.test(value)) return 'features';
  if (/(architect|how it works|how .* works|structure|internals|design)/.test(value)) return 'architecture';
  if (/(tech|stack|built with|dependenc|tools|language)/.test(value)) return 'stack';
  if (/(install|setup|set up|getting started|usage|run|develop|config|build|test|contribut)/.test(value)) return 'setup';
  if (/(overview|about|introduction|description|what is|what it is|why|goal)/.test(value)) return 'overview';
  return 'other';
}

/** Removes the document's first H1 (the page already has the project title). */
export function stripLeadingTitle(markdown: string): string {
  let inFence = false;
  let sawHeading = false;
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && !sawHeading) {
      const heading = line.match(/^(#{1,6})\s+/);
      if (heading) {
        sawHeading = true;
        // Only a leading H1 is the document title. H1s after a real section
        // heading are left alone.
        if (heading[1].length === 1) continue;
      }
    }
    output.push(line);
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Splits a README into meaningful sections, keeping code fences intact. */
export function parseReadmeSections(markdown: string, bases: RepoBases): ReadmeSection[] {
  const lines = markdown.split('\n');
  const groups: Array<{ title: string; lines: string[]; intro: boolean }> = [];
  let current = { title: 'Overview', lines: [] as string[], intro: true };
  let hasHeading = false;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

    const heading = !inFence ? line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/) : null;
    if (heading) {
      if (current.lines.join('\n').trim()) groups.push(current);
      current = { title: plainTitle(heading[2]), lines: [], intro: false };
      hasHeading = true;
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.join('\n').trim()) groups.push(current);
  if (!hasHeading && !groups.length) return [];

  const rendered = groups
    .map((group) => {
      const html = renderMarkdown(group.lines.join('\n'), bases);
      const text = stripTags(html);
      return {
        title: group.title || 'Overview',
        kind: classifySection(group.title),
        html,
        text,
        intro: group.intro,
      };
    })
    // Badge-only intros (shields.io rows) are not useful prose.
    .filter((section) => {
      if (section.intro && section.text.length === 0) return false;
      return section.text.length > 0 || /<img\b/i.test(section.html);
    });

  const used = new Set<string>();
  return rendered.map(({ intro: _intro, ...section }) => ({
    ...section,
    id: sectionId(section.title, used),
  }));
}

export function processReadme(markdown: string, bases: RepoBases): Readme | null {
  const cleaned = stripLeadingTitle(markdown);
  if (!cleaned) return null;

  const sections = parseReadmeSections(cleaned, bases);
  const html = renderMarkdown(cleaned, bases);
  if (!html.trim() && !sections.length) return null;
  return { markdown: cleaned, html, sections };
}
