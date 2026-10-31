// Where the public-domain catalogue lives, and how to read one book's page.
import { parseBookPage, parseFeed, type Acquisition, type CatalogueFeed } from './opds.ts';

/** Recorded against every shelved book, so provenance survives a re-install. */
export const SOURCE = 'gutenberg';
export const USER_AGENT = 'pageturn/1.0 (+https://github.com/umership/pageturn)';

const BASE = 'https://www.gutenberg.org';

export class CatalogueError extends Error {}

export const ENTRY_URL = `${BASE}/ebooks.opds/`;

export type SortOrder = 'downloads' | 'release_date' | 'random';

export function listUrl(sort: SortOrder): string {
  return `${BASE}/ebooks/search.opds/?sort_order=${sort}`;
}

export function searchUrl(query: string): string {
  return `${BASE}/ebooks/search.opds/?query=${words(query)}`;
}

// The two browse-search paths below are part of the catalogue's published shape,
// but they answered 403 (an anti-automation block) to every request from this
// machine on 2026-10-31, while the concrete /ebooks/subject/<n>.opds and
// /ebooks/bookshelf/<n>.opds feeds answered 200. Checked by `npm run probe:catalog`.
export function subjectUrl(term: string): string {
  return `${BASE}/ebooks/subjects/search.opds/?query=${words(term)}`;
}

export function bookshelfUrl(term: string): string {
  return `${BASE}/ebooks/bookshelves/search.opds/?query=${words(term)}`;
}

export function bookPageUrl(id: string): string {
  return `${BASE}/ebooks/${id}.opds`;
}

/** What a reader would paste into a browser, for the book's credit line. */
export function bookWebUrl(id: string): string {
  return `${BASE}/ebooks/${id}`;
}

// The catalogue returns relative hrefs; every link we keep is absolute.
export function absolute(href: string): string {
  return /^https?:/i.test(href) ? href : `${BASE}${href.startsWith('/') ? '' : '/'}${href}`;
}

// A search box hands over words, not a query string.
function words(text: string): string {
  return encodeURIComponent(text.trim()).replace(/%20/g, '+');
}

// Lifetime of the process only: a feed read once is not read again this session.
const feeds = new Map<string, Promise<string>>();

async function text(url: string): Promise<string> {
  let pending = feeds.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) throw new CatalogueError(`The catalogue answered ${response.status}.`);
      return response.text();
    })();
    feeds.set(url, pending);
    // A failure is not an answer: take it out so the next try really retries.
    pending.catch(() => feeds.delete(url));
  }
  return pending;
}

export async function feed(url: string): Promise<CatalogueFeed> {
  const parsed = parseFeed(await text(url));
  return { entries: parsed.entries, next: parsed.next ? absolute(parsed.next) : null };
}

/** One catalogue book, as the shelf needs it. */
export interface CatalogueBook {
  source: string;
  id: string;
  title: string;
  author: string | null;
  licence: string | null;
  pageUrl: string;
  /** The EPUB to download: smallest plain-text edition. */
  epub: string;
  cover: string | null;
  categories: string[];
}

export async function bookPage(id: string): Promise<CatalogueBook> {
  const page = parseBookPage(await text(bookPageUrl(id)));
  const epub: Acquisition | null = page.epub;
  if (!epub) throw new CatalogueError('That book has no EPUB to download.');
  return {
    source: SOURCE,
    id,
    title: page.title,
    author: page.author,
    licence: page.licence,
    pageUrl: bookWebUrl(id),
    epub: absolute(epub.href),
    cover: page.cover ? absolute(page.cover) : null,
    categories: page.categories,
  };
}
