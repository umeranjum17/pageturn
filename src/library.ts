// Import: system file picker, copy into app storage, register on the shelf.
// Title, author and cover come from the EPUB itself once the reader opens it.
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { addBook } from './db';

const BOOKS_DIR = `${FileSystem.documentDirectory}books/`;

export class ImportError extends Error {}

export async function importEpub(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];

  // Every EPUB is a zip; its first bytes are "PK\x03\x04" (base64 "UEsDBA").
  const head = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 4,
  });
  if (!head.startsWith('UEsDB')) {
    throw new ImportError('That file is not an EPUB.');
  }

  await FileSystem.makeDirectoryAsync(BOOKS_DIR, { intermediates: true });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `${BOOKS_DIR}${id}.epub`;
  await FileSystem.copyAsync({ from: asset.uri, to: path });
  await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => undefined);

  const fallbackTitle = (asset.name ?? 'Untitled').replace(/\.epub$/i, '');
  addBook(id, path, fallbackTitle, Date.now());
  return id;
}

export function readBookBase64(path: string): Promise<string> {
  return FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
}
