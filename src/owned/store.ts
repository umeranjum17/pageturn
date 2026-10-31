// What the reader owns somewhere else. Two new tables in the same local SQLite
// file: no backend, no telemetry, and not one line of any existing table changed.
import * as SQLite from 'expo-sqlite';
import type { Volume } from './google';

const db = SQLite.openDatabaseSync('pageturn.db');

export const DDL = `
  -- A title he says he already bought elsewhere (Kindle): no file, no reading here.
  CREATE TABLE IF NOT EXISTS owned_elsewhere (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    cover TEXT,
    added_at INTEGER NOT NULL
  );
  -- The last My Library read, so the list is there before Google answers.
  CREATE TABLE IF NOT EXISTS google_volume (
    volume_id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    cover TEXT,
    download TEXT,
    web_reader TEXT,
    synced_at INTEGER NOT NULL
  );
`;

db.execSync(DDL);

export interface OwnedElsewhere {
  id: string;
  title: string;
  author: string | null;
  cover: string | null;
  addedAt: number;
}

export interface CachedVolume extends Volume {
  syncedAt: number;
}

export function addOwnedElsewhere(
  row: { title: string; author: string | null; cover: string | null },
  now: number = Date.now(),
): string {
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  db.runSync('INSERT INTO owned_elsewhere (id, title, author, cover, added_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    row.title,
    row.author,
    row.cover,
    now,
  ]);
  return id;
}

export function listOwnedElsewhere(): OwnedElsewhere[] {
  return db
    .getAllSync<{
      id: string;
      title: string;
      author: string | null;
      cover: string | null;
      added_at: number;
    }>('SELECT * FROM owned_elsewhere ORDER BY added_at DESC')
    .map((r) => ({ id: r.id, title: r.title, author: r.author, cover: r.cover, addedAt: r.added_at }));
}

export function dropOwnedElsewhere(id: string): void {
  db.runSync('DELETE FROM owned_elsewhere WHERE id = ?', [id]);
}

/** One full answer from Google replaces the last one: a book taken off a shelf goes too. */
export function cacheVolumes(list: Volume[], now: number = Date.now()): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM google_volume');
    for (const v of list) {
      db.runSync(
        'INSERT INTO google_volume (volume_id, title, author, cover, download, web_reader, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [v.id, v.title, v.author, v.cover, v.download, v.webReader, now],
      );
    }
  });
}

export function listCachedVolumes(): CachedVolume[] {
  return db
    .getAllSync<{
      volume_id: string;
      title: string;
      author: string | null;
      cover: string | null;
      download: string | null;
      web_reader: string | null;
      synced_at: number;
    }>('SELECT * FROM google_volume ORDER BY title COLLATE NOCASE')
    .map((r) => ({
      id: r.volume_id,
      title: r.title,
      author: r.author,
      cover: r.cover,
      download: r.download,
      webReader: r.web_reader,
      syncedAt: r.synced_at,
    }));
}
