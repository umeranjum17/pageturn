// Internet Archive: the second catalogue. Everything it holds is also published
// as a torrent, and much of it is public domain, so this is where the scanned
// books and old editions nobody sells live.
//
// Only openly licensed items are admitted. An item whose licence cannot be
// established is left out and counted, never silently dropped.
import type { CatalogueEntry } from './opds.ts';
import type { CatalogueBook } from './source.ts';

export const SOURCE = 'archive';
export const USER_AGENT = 'pageturn/1.0 (+https://github.com/umership/pageturn)';

const BASE = 'https://archive.org';

export class ArchiveError extends Error {}

/** One Archive book, as the marketplace card needs it. */
export interface ArchiveHit {
  id: string;
  title: string;
  creator: string | null;
  /** One short line, e.g. "Public domain" or "CC BY 4.0". */
  licence: string;
  cover: string | null;
  pageUrl: string;
  torrent: string;
  /** The friendliest file to read, when the item has one at all. */
  file: { url: string; bytes: number | null } | null;
}

export interface ArchiveSearch {
  hits: ArchiveHit[];
  /** How many items the search answered with. */
  found: number;
  /** Refused because the licence could not be established, or it lends. */
  skipped: number;
  /** Not a book at all: images, audio, video. */
  notBooks: number;
}

interface Doc {
  identifier?: string;
  title?: string;
  creator?: string | string[];
  licenseurl?: string;
  mediatype?: string;
  collection?: string | string[];
  'possible-copyright-status'?: string;
  'access-restricted-item'?: unknown;
}

interface MetaFile {
  name?: string;
  size?: string;
  private?: unknown;
}

interface ItemMetadata {
  metadata?: Doc;
  files?: MetaFile[];
}

export function searchUrl(query: string): string {
  const q = encodeURIComponent(query.trim()).replace(/%20/g, '+');
  return (
    `${BASE}/advancedsearch.php?q=${q}` +
    '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=mediatype&fl[]=collection' +
    '&rows=20&page=1&output=json'
  );
}

export function metadataUrl(id: string): string {
  return `${BASE}/metadata/${encodeURIComponent(id)}`;
}

export function pageUrl(id: string): string {
  return `${BASE}/details/${encodeURIComponent(id)}`;
}

export function torrentUrl(id: string): string {
  return `${BASE}/download/${encodeURIComponent(id)}/${encodeURIComponent(id)}_archive.torrent`;
}

export function coverUrl(id: string): string {
  return `${BASE}/services/img/${encodeURIComponent(id)}`;
}

/**
 * The stored file name is already URL-encoded on some items ("Aesop%27s
 * Fables.epub"), so it is encoded as a whole: `%27` becomes `%2527`, which is
 * the name the download endpoint really answers for.
 */
export function fileUrl(id: string, name: string): string {
  return `${BASE}/download/${encodeURIComponent(id)}/${encodeURIComponent(name)}`;
}

function text(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : null;
}

function collection(doc: Doc): string[] {
  const raw = doc.collection;
  return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((c) => c.toLowerCase());
}

/** Lending and print-disabled items are never ours, whatever their licence says. */
const RESTRICTED = ['inlibrary', 'printdisabled', 'lending-library', 'torrentdeleted'];

function restricted(doc: Doc): boolean {
  const flag = String(doc['access-restricted-item'] ?? '').toLowerCase();
  if (flag === 'true') return true;
  return collection(doc).some((c) => RESTRICTED.includes(c));
}

/** Collections whose items Archive publishes as public domain. */
const PUBLIC_DOMAIN = [/^gutenberg/, /^americana/, /^opensource/, /^pub_/, /^cdl/, /^universal_library/];

const LICENCES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/creativecommons\.org\/publicdomain\/zero/i, () => 'CC0 public domain'],
  [/creativecommons\.org\/publicdomain\/mark/i, () => 'Public domain mark'],
  [/creativecommons\.org\/licenses\/([a-z-]+)(?:\/([\d.]+))?/i, (m) => `CC ${m[1].toUpperCase()} ${m[2] ?? ''}`.trim()],
  [/gnu\.org\/licenses\/([a-z0-9-]+(?:\.[0-9]+)*)/i, (m) => `GNU ${m[1].toUpperCase()}`],
];

/** The licence as one short line, or null when it is not an open one. */
export function openLicence(url: string | undefined): string | null {
  if (!url) return null;
  for (const [pattern, label] of LICENCES) {
    const match = pattern.exec(url);
    if (match) return label(match);
  }
  return null;
}

/**
 * Public domain, openly licensed, or else out. `possible-copyright-status` is
 * the Archive's own statement that an item is out of copyright, so it counts.
 */
export function licenceOf(doc: Doc): string | null {
  const open = openLicence(doc.licenseurl);
  if (open) return open;
  if (collection(doc).some((c) => PUBLIC_DOMAIN.some((p) => p.test(c)))) return 'Public domain';
  if (/not_in_copyright/i.test(doc['possible-copyright-status'] ?? '')) return 'Public domain';
  return null;
}

const BOOK_MEDIA = ['texts', 'data'];

/**
 * The friendliest file the item holds: EPUB, then the text-layer PDF, then the
 * plain scan. `_text.pdf` is the smaller one a phone can actually turn pages in.
 */
export function chooseFile(files: MetaFile[]): { name: string; bytes: number | null } | null {
  const usable = files.filter(
    (f) =>
      typeof f.name === 'string' &&
      !f.private &&
      // DRM and metadata sidecars are never the book: .lcpdf, .lcp.epub, _encrypted.pdf.
      !/lcp|encrypted/i.test(f.name) &&
      !f.name.includes('_meta.'),
  );
  const ranks = [
    (n: string) => /\.epub$/i.test(n),
    (n: string) => /_text\.pdf$/i.test(n),
    (n: string) => /\.pdf$/i.test(n),
  ];
  for (const rank of ranks) {
    const found = usable.find((f) => rank(f.name!));
    if (found) {
      const size = Number(found.size);
      return { name: found.name!, bytes: Number.isFinite(size) && size > 0 ? size : null };
    }
  }
  return null;
}

/** Everything the card needs from one item's metadata, or why it is refused. */
export function itemHit(id: string, item: ItemMetadata): { hit: ArchiveHit } | { skip: 'licence' } {
  const meta = item.metadata ?? {};
  const licence = licenceOf(meta);
  if (!licence || restricted(meta)) return { skip: 'licence' };
  const files = item.files ?? [];
  const file = chooseFile(files);
  return {
    hit: {
      id,
      title: text(meta.title) ?? id,
      creator: text(meta.creator),
      licence,
      // The thumbnail is the only picture the item is sure to have.
      cover: files.some((f) => f.name === '__ia_thumb.jpg') ? coverUrl(id) : null,
      pageUrl: pageUrl(id),
      torrent: torrentUrl(id),
      file: file ? { url: fileUrl(id, file.name), bytes: file.bytes } : null,
    },
  };
}

/** The cheap filter, on the search answer alone: no item request needed. */
export function candidates(docs: Doc[]): { keep: Doc[]; skipped: number; notBooks: number } {
  let skipped = 0;
  let notBooks = 0;
  const keep: Doc[] = [];
  for (const doc of docs) {
    if (!doc.identifier) continue;
    if (!BOOK_MEDIA.includes((doc.mediatype ?? '').toLowerCase())) {
      notBooks++;
      continue;
    }
    if (!licenceOf(doc) || restricted(doc)) {
      skipped++;
      continue;
    }
    keep.push(doc);
  }
  return { keep, skipped, notBooks };
}

// Lifetime of the process only: a search repeated this session asks for nothing.
const cache = new Map<string, Promise<unknown>>();

function get<T>(url: string): Promise<T> {
  let pending = cache.get(url) as Promise<T> | undefined;
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) throw new ArchiveError(`The Archive answered ${response.status}.`);
      return (await response.json()) as T;
    })();
    cache.set(url, pending);
    // A failure is not an answer: take it out so the next try really retries.
    pending.catch(() => cache.delete(url));
  }
  return pending;
}

// Two per book at most: one search answer, one item. Enough for a phone screen.
const MAX_HITS = 12;
const MAX_ITEMS = 8;

/** One query, merged: what was found, what was admitted, what the filter refused. */
export async function searchArchive(query: string): Promise<ArchiveSearch> {
  const answer = await get<{ response?: { numFound?: number; docs?: Doc[] } }>(searchUrl(query));
  const docs = answer.response?.docs ?? [];
  const found = answer.response?.numFound ?? docs.length;
  const { keep, skipped, notBooks } = candidates(docs);

  const items = await Promise.all(
    keep.slice(0, MAX_ITEMS).map((doc) =>
      get<ItemMetadata>(metadataUrl(doc.identifier!))
        .then((item) => itemHit(doc.identifier!, item))
        .catch(() => ({ skip: 'licence' as const })),
    ),
  );

  const hits: ArchiveHit[] = [];
  let refused = skipped;
  for (const item of items) {
    if ('hit' in item) hits.push(item.hit);
    else refused++;
    if (hits.length >= MAX_HITS) break;
  }
  return { hits, found, skipped: refused, notBooks };
}

/** A search result from either catalogue: the same card, with a torrent added. */
export type Hit = CatalogueEntry & {
  licence?: string;
  torrent?: string;
  cover?: string;
  /** The direct file, ready for the shelf; null when the item only has a torrent. */
  book?: CatalogueBook | null;
};

export function hitOf(hit: ArchiveHit): Hit {
  return {
    id: hit.id,
    title: hit.title,
    author: hit.creator,
    licence: hit.licence,
    torrent: hit.torrent,
    cover: hit.cover ?? undefined,
    book: hit.file ? toCatalogueBook(hit) : null,
  };
}

/** The same book, in the shape the shelf's download already understands. */
export function toCatalogueBook(hit: ArchiveHit): CatalogueBook {
  if (!hit.file) throw new ArchiveError('That item has no file to read; take the torrent.');
  return {
    source: SOURCE,
    id: hit.id,
    title: hit.title,
    author: hit.creator,
    licence: hit.licence,
    pageUrl: hit.pageUrl,
    epub: hit.file.url,
    cover: hit.cover,
    categories: [],
  };
}
