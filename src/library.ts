// Import: system file picker, copy into app storage, register on the shelf.
// Title, author and cover come from the EPUB itself once the reader opens it.
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { addBook, listBooks } from './db';

const BOOKS_DIR = `${FileSystem.documentDirectory}books/`;
// The zip central directory sits at the end of the file and names every entry.
const TAIL_BYTES = 256 * 1024;

export class ImportError extends Error {}

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

export async function importEpub(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const dropPicked = () => FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => undefined);

  try {
    const size = await sizeOf(asset.uri);
    if (!(await looksLikeEpub(asset.uri, size))) throw new ImportError('That file is not an EPUB.');
    const existing = await findExisting(asset.uri, size);
    if (existing) return existing;

    await FileSystem.makeDirectoryAsync(BOOKS_DIR, { intermediates: true });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const path = `${BOOKS_DIR}${id}.epub`;
    try {
      await FileSystem.copyAsync({ from: asset.uri, to: path });
      const fallbackTitle = (asset.name ?? 'Untitled').replace(/\.epub$/i, '');
      addBook(id, path, fallbackTitle, Date.now());
    } catch (e) {
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
      throw e;
    }
    return id;
  } finally {
    await dropPicked();
  }
}

export function readBookBase64(path: string): Promise<string> {
  return FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
}
