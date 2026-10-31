// Finding any book online, not just the ones the free catalogue holds.
//
// The public-domain catalogue is asked first, so a whole free book keeps its
// one-tap download. Open Library needs no key and is always asked. Google Books
// answers only when the app's own config carries a key: without one it is not
// asked at all, because a keyless request is refused with a quota error and that
// refusal is not the reader's problem.
//
// Nothing here reads a bought book. A card carries the book's own page and a
// store page, and says plainly that a copy bought there stays in its own app.
import type { CatalogueEntry } from './opds.ts';
import { USER_AGENT, bookWebUrl, feed, searchUrl } from './source.ts';

const OPEN_LIBRARY = 'https://openlibrary.org';
const COVERS = 'https://covers.openlibrary.org/b/id';
const VOLUMES = 'https://www.googleapis.com/books/v1/volumes';
const PLAY = 'https://play.google.com/store';
const LIMIT = 20;
/** Descriptions asked for by the cards on screen, no more, four at a time. */
const DESCRIPTIONS = 4;
/** Enough to fill two short lines on a phone card. */
const BLURB = 240;

/** One card in the results list, whichever source answered. */
export interface ResultEntry {
  /** Unique in the list, and the card's key. A free book keeps its catalogue number. */
  id: string;
  title: string;
  author: string | null;
  year: string | null;
  description: string | null;
  /** Where to read the description when the search answer carried none. */
  descriptionUrl: string | null;
  cover: string | null;
  /** The catalogue holds this whole book: a tap downloads it. */
  free: boolean;
  /** The book's own page, where reading or borrowing it can start. */
  preview: string;
  /** Where a copy can be bought. */
  store: string;
}

export interface Found {
  entries: ResultEntry[];
}

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  ia?: string[];
}

interface GoogleVolume {
  id?: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    description?: string;
    imageLinks?: { thumbnail?: string };
    publishedDate?: string;
    previewLink?: string;
    canonicalVolumeLink?: string;
  };
}

export function openLibraryUrl(term: string): string {
  const fields = 'key,title,author_name,first_publish_year,cover_i,ebook_access,ia,edition_key';
  return `${OPEN_LIBRARY}/search.json?q=${encodeURIComponent(term)}&fields=${fields}&limit=${LIMIT}`;
}

export function googleUrl(term: string, key: string): string {
  return `${VOLUMES}?q=${encodeURIComponent(term)}&maxResults=${LIMIT}&key=${encodeURIComponent(key)}`;
}

/** A store search for a copy of this book, on a phone browser. */
export function storeSearch(title: string, author: string | null): string {
  return `${PLAY}/search?q=${encodeURIComponent(`${title} ${author ?? ''}`.trim())}&c=books`;
}

/**
 * A description is a string on some works and an object with a `value` on others.
 * Markdown links keep their words, HTML tags go, and long prose is cut at a word.
 */
export function descriptionOf(value: unknown): string | null {
  const raw =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string'
        ? (value as { value: string }).value
        : '';
  const plain = raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return null;
  if (plain.length <= BLURB) return plain;
  const cut = plain.lastIndexOf(' ', BLURB);
  return `${plain.slice(0, cut > 0 ? cut : BLURB)}…`;
}

/** A catalogue book, as a card that downloads the whole book. */
export function freeEntry(entry: CatalogueEntry): ResultEntry {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.author,
    year: null,
    description: null,
    descriptionUrl: null,
    cover: null,
    free: true,
    preview: bookWebUrl(entry.id),
    store: storeSearch(entry.title, entry.author),
  };
}

function fromOpenLibrary(doc: OpenLibraryDoc): ResultEntry | null {
  const work = doc.key?.trim();
  const title = doc.title?.trim();
  if (!work || !title) return null;
  const author = doc.author_name?.[0]?.trim() || null;
  const scan = doc.ia?.[0];
  const id = work.split('/').filter(Boolean).pop() ?? work;
  return {
    id: `ol-${id}`,
    title,
    author,
    year: doc.first_publish_year ? String(doc.first_publish_year) : null,
    description: null,
    descriptionUrl: `${OPEN_LIBRARY}${work}.json`,
    cover: doc.cover_i ? `${COVERS}/${doc.cover_i}-M.jpg` : null,
    free: false,
    // A scanned copy can be borrowed and read there; a work page is the fallback.
    preview: scan ? `https://archive.org/details/${scan}` : `${OPEN_LIBRARY}${work}`,
    store: storeSearch(title, author),
  };
}

function fromGoogle(volume: GoogleVolume): ResultEntry | null {
  const id = volume.id?.trim();
  const info = volume.volumeInfo;
  const title = info?.title?.trim();
  if (!id || !title) return null;
  const author = info?.authors?.[0]?.trim() || null;
  const details = `${PLAY}/books/details?id=${encodeURIComponent(id)}`;
  return {
    id: `gb-${id}`,
    title,
    author,
    year: info?.publishedDate?.slice(0, 4) ?? null,
    description: descriptionOf(info?.description),
    descriptionUrl: null,
    // The thumbnail arrives as plain http; the same address answers https.
    cover: info?.imageLinks?.thumbnail?.replace(/^http:/, 'https:') ?? null,
    free: false,
    preview: info?.previewLink ?? info?.canonicalVolumeLink ?? details,
    store: details,
  };
}

async function json(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`The source answered ${response.status}.`);
  return response.json();
}

async function openLibrary(term: string): Promise<ResultEntry[]> {
  const body = (await json(openLibraryUrl(term))) as { docs?: OpenLibraryDoc[] };
  return (body.docs ?? []).map(fromOpenLibrary).filter((e): e is ResultEntry => e !== null);
}

async function google(term: string, key: string): Promise<ResultEntry[]> {
  const body = (await json(googleUrl(term, key))) as { items?: GoogleVolume[] };
  return (body.items ?? []).map(fromGoogle).filter((e): e is ResultEntry => e !== null);
}

/** Words only, lowercase: "Clean Code" and "clean  code" are the same book. */
function words(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function rank(entry: ResultEntry): number {
  return (entry.free ? 4 : 0) + (entry.cover ? 2 : 0) + (entry.description ? 1 : 0);
}

/**
 * One card per book, by title and author. A whole free book wins, then the
 * source that brought a cover and a description; the rest keep their order.
 */
export function merge(groups: ResultEntry[][]): ResultEntry[] {
  const order: string[] = [];
  const best = new Map<string, ResultEntry>();
  for (const entry of groups.flat()) {
    const key = `${words(entry.title)}|${words(entry.author ?? '')}`;
    const held = best.get(key);
    if (!held) {
      order.push(key);
      best.set(key, entry);
    } else if (rank(entry) > rank(held)) {
      best.set(key, entry);
    }
  }
  return order.map((key) => best.get(key) as ResultEntry);
}

// The key lives in the app's own config (expo `extra`), never in source.
async function configuredKey(): Promise<string> {
  try {
    const Constants = (await import('expo-constants')).default;
    const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
    const key = extra.GOOGLE_BOOKS_API_KEY;
    return typeof key === 'string' ? key.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Every book the sources know for this term. One source failing is not the
 * reader's problem while another answers; only a total silence throws.
 */
export async function searchBooks(term: string, key?: string): Promise<Found> {
  const googleKey = key ?? (await configuredKey());
  let failed = false;
  const keep = (job: Promise<ResultEntry[]>): Promise<ResultEntry[]> =>
    job.catch(() => {
      failed = true;
      return [];
    });
  const found = await Promise.all([
    keep(feed(searchUrl(term)).then((got) => got.entries.map(freeEntry))),
    keep(googleKey ? google(term, googleKey) : Promise.resolve([])),
    keep(openLibrary(term)),
  ]);
  const entries = merge(found);
  if (failed && !entries.length) throw new Error('No book source answered.');
  return { entries };
}

let blurbSlots = 0;
const blurbQueue: (() => void)[] = [];

/** One on-screen card's description, four at a time, kept on disk by its address. */
export async function readDescription(url: string): Promise<string | null> {
  if (blurbSlots >= DESCRIPTIONS) await new Promise<void>((go) => blurbQueue.push(go));
  blurbSlots += 1;
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    if (!dir) return null;
    const file = `${dir}desc-${url.replace(/[^a-z0-9]+/gi, '-')}.txt`;
    if ((await FileSystem.getInfoAsync(file)).exists) return await FileSystem.readAsStringAsync(file);
    const body = (await json(url)) as { description?: unknown };
    const found = descriptionOf(body.description);
    if (found) await FileSystem.writeAsStringAsync(file, found);
    return found;
  } catch {
    return null;
  } finally {
    blurbSlots -= 1;
    blurbQueue.shift()?.();
  }
}
