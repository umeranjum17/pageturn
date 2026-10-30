// Import: system file picker, copy into app storage, register on the shelf.
// Title, author and cover come from the EPUB itself once the reader opens it.
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { addBook, addHighlight, listBooks, orphanHighlights, setHighlightBook } from './db';
import { matchBook, parseClippings } from './lib/clippings';

const BOOKS_DIR = `${FileSystem.documentDirectory}books/`;
// The zip central directory sits at the end of the file and names every entry.
const TAIL_BYTES = 256 * 1024;

export class ImportError extends Error {}

/** What a finished import produced, for the shelf's one-line notice. */
export interface Imported {
  bookId: string | null;
  highlights: number;
  attached: number;
}

function readBytes(uri: string, position: number, length: number): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64, position, length });
}

async function sizeOf(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && !info.isDirectory ? info.size : 0;
}

async function tailOf(uri: string, size: number): Promise<string> {
  const length = Math.min(size, TAIL_BYTES);
  return readBytes(uri, size - length, length);
}

// An EPUB is a zip that declares itself: a stored "mimetype" entry first, or at
// least a META-INF/container.xml listed in the central directory.
async function looksLikeEpub(uri: string, size: number): Promise<boolean> {
  if (size < 22) return false;
  const head = atob(await readBytes(uri, 0, 58));
  if (!head.startsWith('PK\x03\x04')) return false;
  if (head.slice(30, 38) === 'mimetype' && head.slice(38, 58) === 'application/epub+zip') return true;
  return atob(await tailOf(uri, size)).includes('META-INF/container.xml');
}

// Same size and the same central directory (which carries every entry's CRC)
// means the same book.
async function findExisting(uri: string, size: number): Promise<string | null> {
  let tail: string | null = null;
  for (const book of listBooks()) {
    if ((await sizeOf(book.path).catch(() => 0)) !== size) continue;
    tail ??= await tailOf(uri, size);
    if ((await tailOf(book.path, size).catch(() => null)) === tail) return book.id;
  }
  return null;
}

// A PDF always starts with this; the rest of the header is version noise.
async function looksLikePdf(uri: string): Promise<boolean> {
  return atob(await readBytes(uri, 0, 5)) === '%PDF-';
}

async function copyIn(uri: string, ext: string, title: string, format: 'epub' | 'pdf'): Promise<string> {
  await FileSystem.makeDirectoryAsync(BOOKS_DIR, { intermediates: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `${BOOKS_DIR}${id}.${ext}`;
  try {
    await FileSystem.copyAsync({ from: uri, to: path });
    addBook(id, path, title, Date.now(), format);
  } catch (e) {
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
    throw e;
  }
  return id;
}

/** Kindle clippings, matched onto whatever is already on the shelf. */
async function importClippings(uri: string): Promise<Imported> {
  const raw = await FileSystem.readAsStringAsync(uri);
  const clippings = parseClippings(raw);
  if (!clippings.length) throw new ImportError('No highlights found in that file.');
  const books = listBooks();
  const now = Date.now();
  let attached = 0;
  clippings.forEach((c, i) => {
    const book = matchBook(c, books);
    if (book) attached++;
    addHighlight({
      bookId: book?.id ?? null,
      title: c.title,
      author: c.author,
      kind: c.kind,
      locator: c.locator,
      page: c.page,
      text: c.text,
      addedAt: c.addedAt,
      // Keep the device's own order for ties: later lines stay later.
      createdAt: now + i,
    });
  });
  return { bookId: null, highlights: clippings.length, attached };
}

export async function importFile(): Promise<Imported | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'application/epub+zip',
      'application/pdf',
      'text/plain',
      'application/octet-stream',
      '*/*',
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const dropPicked = () => FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => undefined);
  const name = asset.name ?? '';
  const lower = name.toLowerCase();

  try {
    // The picker hands over a copy in the cache; the extension is the first
    // signal, the bytes are the authority.
    if (lower.endsWith('.txt')) return await importClippings(asset.uri);

    const size = await sizeOf(asset.uri);
    const isPdf = lower.endsWith('.pdf') || (!lower.endsWith('.epub') && !(await looksLikeEpub(asset.uri, size)));
    if (isPdf) {
      if (!(await looksLikePdf(asset.uri))) throw new ImportError('That file is not a PDF.');
      const existing = await findExisting(asset.uri, size);
      if (existing) return { bookId: existing, highlights: 0, attached: 0 };
      const title = name.replace(/\.pdf$/i, '') || 'Untitled';
      return { bookId: await copyIn(asset.uri, 'pdf', title, 'pdf'), highlights: 0, attached: 0 };
    }

    if (!(await looksLikeEpub(asset.uri, size))) throw new ImportError('That file is not an EPUB or a PDF.');
    const existing = await findExisting(asset.uri, size);
    if (existing) return { bookId: existing, highlights: 0, attached: 0 };
    const title = (name || 'Untitled').replace(/\.epub$/i, '');
    return { bookId: await copyIn(asset.uri, 'epub', title, 'epub'), highlights: 0, attached: 0 };
  } finally {
    await dropPicked();
  }
}

/** Attach clippings that arrived before their book did. */
export function reconcileHighlights(): number {
  const books = listBooks();
  let moved = 0;
  for (const orphan of orphanHighlights()) {
    const book = matchBook(orphan, books);
    if (!book) continue;
    setHighlightBook(orphan.id, book.id);
    moved++;
  }
  return moved;
}

export function readBookBase64(path: string): Promise<string> {
  return FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
}
