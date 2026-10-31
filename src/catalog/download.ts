// One catalogue book onto the shelf: download the EPUB to a file, import it
// through the same checks the file picker uses, and remember where it came from.
//
// The device wiring is imported lazily so this module stays loadable, and
// testable against a real SQLite file, outside the app runtime.
import type { CatalogueBook } from './source.ts';

/** Every step the download needs from the app, one call each. */
export interface Shelf {
  findBySource(source: string, sourceId: string): string | null;
  recordSource(row: {
    bookId: string;
    source: string;
    sourceId: string;
    licence: string | null;
    pageUrl: string;
  }): void;
  /** Fetch a URL to a temporary file and return its file uri. */
  download(url: string, name: string): Promise<string>;
  /** Validate, copy onto the shelf, and dispose of the temporary file. */
  add(uri: string, title: string): Promise<string>;
  /** The cover as a `data:` uri, or null when it cannot be had. */
  cover(url: string | null): Promise<string | null>;
  setCover(bookId: string, cover: string): void;
}

export class DownloadError extends Error {}

/**
 * The same source and source id already on the shelf means no second download:
 * that book id comes back instead. Anything else is downloaded, validated and
 * recorded, cover best-effort.
 */
export async function shelve(book: CatalogueBook, shelf: Shelf): Promise<string> {
  const known = shelf.findBySource(book.source, book.id);
  if (known) return known;

  const uri = await shelf.download(book.epub, book.id);
  const bookId = await shelf.add(uri, book.title);
  shelf.recordSource({
    bookId,
    source: book.source,
    sourceId: book.id,
    licence: book.licence,
    pageUrl: book.pageUrl,
  });
  // A cover that will not download must not cost us the book we already shelved.
  const cover = await shelf.cover(book.cover).catch(() => null);
  if (cover) shelf.setCover(bookId, cover);
  return bookId;
}

/** The app's own half of the seam, for anything else that puts a book on the shelf. */
export async function deviceShelf(): Promise<Shelf> {
  const FileSystem = await import('expo-file-system/legacy');
  const db = await import('../db');
  const { importDownloaded } = await import('../library');
  const temp = (name: string) => `${FileSystem.cacheDirectory}catalogue-${name}`;
  const drop = (uri: string) =>
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);

  return {
    findBySource: (source, sourceId) => db.findBookBySource(source, sourceId),
    recordSource: (row) => db.recordBookSource(row),
    download: async (url, name) => {
      const target = temp(`${name.replace(/[^a-z0-9]+/gi, '-')}.epub`);
      await drop(target);
      const { uri, status } = await FileSystem.downloadAsync(url, target);
      if (status !== 200) {
        await drop(uri);
        throw new DownloadError(`The catalogue answered ${status}.`);
      }
      return uri;
    },
    add: async (uri, title) => {
      try {
        return await importDownloaded(uri, title);
      } finally {
        await drop(uri);
      }
    },
    cover: async (url) => {
      if (!url) return null;
      const target = temp('cover.jpg');
      await drop(target);
      const { uri, status } = await FileSystem.downloadAsync(url, target);
      try {
        if (status !== 200) return null;
        // Once, and straight to base64: never through JS as a byte array.
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        return `data:image/jpeg;base64,${base64}`;
      } finally {
        await drop(uri);
      }
    },
    setCover: (bookId, cover) => db.saveMetadata(bookId, null, null, cover),
  };
}

/** Find the book by its catalogue number, then put it on the shelf. */
export async function downloadCatalogueBook(id: string, shelf?: Shelf): Promise<string> {
  const target = shelf ?? (await deviceShelf());
  const { bookPage, SOURCE } = await import('./source.ts');
  // Asked before the book page is fetched: a duplicate costs no network at all.
  const known = target.findBySource(SOURCE, id);
  if (known) return known;
  return shelve(await bookPage(id), target);
}
