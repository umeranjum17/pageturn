// Kindle "My Clippings.txt": one plain-text log the reader copies off the device.
// Entries are separated by a run of "="; the first line is "Title (Author)", the
// second is the metadata ("- Your Highlight on page 12 | Location 145-147 | Added
// on ..."), then a blank line, then the passage. The file is inconsistent: mixed
// line endings, byte-order marks, entries with no metadata line, and duplicates
// from re-clipping the same passage. Parse it tolerantly; never fetch anything.

export type ClippingKind = 'highlight' | 'note' | 'bookmark';

export interface Clipping {
  title: string;
  author: string | null;
  kind: ClippingKind;
  /** "page 12 · Location 145-147" as written by the device, or null. */
  locator: string | null;
  page: number | null;
  location: number | null;
  text: string;
  addedAt: number | null;
}

const SEPARATOR = /^[ \t]*={5,}[ \t]*$/m;
const BOM = /^\uFEFF/;
const CLIPPING_LIMIT = /you have reached the clipping limit/i;

function num(pattern: RegExp, s: string): number | null {
  const m = s.match(pattern);
  return m ? Number(m[1]) : null;
}

// "Title (Author)" — the author is the LAST parenthesised group, so a title that
// carries its own parentheses or a subtitle still parses.
function splitHeading(line: string): [string, string | null] {
  const m = line.match(/^(.*)\(([^()]*)\)\s*$/);
  if (!m) return [line.trim(), null];
  const title = m[1].trim();
  const author = m[2].trim();
  return [title || line.trim(), author || null];
}

function kindOf(meta: string): ClippingKind | null {
  if (/\bhighlight\b/i.test(meta)) return 'highlight';
  if (/\bnote\b/i.test(meta)) return 'note';
  if (/\bbookmark\b/i.test(meta)) return 'bookmark';
  return null;
}

function addedAt(meta: string): number | null {
  const m = meta.match(/Added on\s+(.+?)\s*$/i);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isNaN(t) ? null : t;
}

function locatorOf(meta: string): { label: string | null; page: number | null; location: number | null } {
  const page = num(/\bpage\s+(\d+)/i, meta);
  const location = num(/\bLocation\s+(\d+)/i, meta);
  const parts: string[] = [];
  if (page !== null) parts.push(`page ${page}`);
  if (location !== null) parts.push(`Location ${location}`);
  return { label: parts.length ? parts.join(' · ') : null, page, location };
}

/** Same passage clipped twice collapses to one, even across separate exports. */
function keyOf(c: Clipping): string {
  return [c.title.toLowerCase(), c.kind, c.locator ?? '', c.text.toLowerCase().replace(/\s+/g, ' ')].join('\u0000');
}

export function parseClippings(raw: string): Clipping[] {
  const text = raw.replace(BOM, '').replace(/\r\n?/g, '\n');
  // Split on the device's "=" rule, keeping blocks even when it is missing.
  const blocks = text.split(SEPARATOR);
  const out: Clipping[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''));
    while (lines.length && lines[0] === '') lines.shift();
    if (!lines.length) continue;

    const [title, author] = splitHeading(lines[0]);
    if (!title) continue;

    let meta = '';
    let body = lines.slice(1);
    if (body.length && /^[-\u2013\u2014]/.test(body[0])) {
      meta = body[0];
      body = body.slice(1);
    }
    const kind = kindOf(meta) ?? 'highlight';
    const passage = body.join('\n').replace(/\n{2,}/g, '\n').trim();
    // A publisher's clipping-limit notice is not a passage the reader kept.
    if (!passage || CLIPPING_LIMIT.test(passage)) continue;

    const loc = locatorOf(meta);
    const clipping: Clipping = {
      title,
      author,
      kind,
      locator: loc.label,
      page: loc.page,
      location: loc.location,
      text: passage,
      addedAt: addedAt(meta),
    };
    const key = keyOf(clipping);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clipping);
  }
  return out;
}

/** "Pride and Prejudice" / "pride & prejudice: a novel" -> "pride and prejudice". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(a novel|the novel|a penguin classic|penguin classics)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * The shelf book a clipping belongs to, or null when the book is not imported.
 * When the same title is on the shelf twice, the reflowable copy wins: a Kindle
 * locator can only be resolved by finding the passage, and a fixed-layout PDF
 * has nowhere to find it.
 */
export function matchBook<T extends { title: string; author: string | null; format?: string }>(
  clipping: Pick<Clipping, 'title' | 'author'>,
  books: T[],
): T | null {
  const want = normalizeTitle(clipping.title);
  if (!want) return null;
  let exact: T | null = null;
  let loose: T | null = null;
  for (const book of books) {
    const have = normalizeTitle(book.title);
    if (!have) continue;
    const sameAuthor =
      !clipping.author || !book.author || normalizeTitle(book.author) === normalizeTitle(clipping.author);
    if (!sameAuthor) continue;
    if (have === want) {
      if (!exact || (exact.format === 'pdf' && book.format === 'epub')) exact = book;
    } else if ((have.startsWith(want) || want.startsWith(have)) && !loose) {
      loose = book;
    }
  }
  return exact ?? loose;
}
