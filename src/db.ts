// Local storage only: one SQLite file, no backend, no network.
import * as SQLite from 'expo-sqlite';
import { dayKey } from './lib/streak';
import type { ThemeMode } from './lib/time';
import type { Justify } from './reader/protocol';

export interface Book {
  id: string;
  path: string;
  title: string;
  author: string | null;
  cover: string | null;
  addedAt: number;
  openedAt: number | null;
  cfi: string | null;
  percent: number | null;
  chapter: string | null;
  lastLine: string | null;
  locations: string | null;
}

export interface Prefs {
  themeMode: ThemeMode;
  fontSize: number;
  lineHeight: number;
  margin: number;
  justify: Justify;
  brightness: number | null;
}

export const DEFAULT_PREFS: Prefs = {
  themeMode: 'auto',
  fontSize: 19,
  lineHeight: 1.6,
  margin: 20,
  justify: 'left',
  brightness: null,
};

const db = SQLite.openDatabaseSync('pageturn.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY NOT NULL,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    cover TEXT,
    added_at INTEGER NOT NULL,
    opened_at INTEGER,
    cfi TEXT,
    percent REAL,
    chapter TEXT,
    last_line TEXT,
    locations TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS reading_days (day TEXT PRIMARY KEY NOT NULL, seconds INTEGER NOT NULL DEFAULT 0);
`);

interface BookRow {
  id: string;
  path: string;
  title: string;
  author: string | null;
  cover: string | null;
  added_at: number;
  opened_at: number | null;
  cfi: string | null;
  percent: number | null;
  chapter: string | null;
  last_line: string | null;
  locations: string | null;
}

function toBook(r: BookRow): Book {
  return {
    id: r.id,
    path: r.path,
    title: r.title,
    author: r.author,
    cover: r.cover,
    addedAt: r.added_at,
    openedAt: r.opened_at,
    cfi: r.cfi,
    percent: r.percent,
    chapter: r.chapter,
    lastLine: r.last_line,
    locations: r.locations,
  };
}

export function listBooks(): Book[] {
  return db
    .getAllSync<BookRow>('SELECT * FROM books ORDER BY COALESCE(opened_at, added_at) DESC')
    .map(toBook);
}

export function getBook(id: string): Book | null {
  const row = db.getFirstSync<BookRow>('SELECT * FROM books WHERE id = ?', [id]);
  return row ? toBook(row) : null;
}

export function addBook(id: string, path: string, title: string, now: number): void {
  db.runSync('INSERT INTO books (id, path, title, added_at) VALUES (?, ?, ?, ?)', [id, path, title, now]);
}

export function saveMetadata(id: string, title: string | null, author: string | null, cover: string | null): void {
  db.runSync(
    'UPDATE books SET title = COALESCE(?, title), author = COALESCE(?, author), cover = COALESCE(?, cover) WHERE id = ?',
    [title, author, cover, id],
  );
}

export function savePosition(
  id: string,
  p: { cfi: string; percent: number | null; chapter: string | null; lastLine: string | null },
): void {
  db.runSync(
    'UPDATE books SET cfi = ?, percent = COALESCE(?, percent), chapter = ?, last_line = COALESCE(?, last_line) WHERE id = ?',
    [p.cfi, p.percent, p.chapter, p.lastLine, id],
  );
}

export function saveLocations(id: string, locations: string): void {
  db.runSync('UPDATE books SET locations = ? WHERE id = ?', [locations, id]);
}

export function markOpened(id: string, now: number): void {
  db.runSync('UPDATE books SET opened_at = ? WHERE id = ?', [now, id]);
}

function getSetting(key: string): string | null {
  return db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])?.value ?? null;
}

function setSetting(key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

export function getPrefs(): Prefs {
  const raw = getSetting('prefs');
  if (!raw) return DEFAULT_PREFS;
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setPrefs(prefs: Prefs): void {
  setSetting('prefs', JSON.stringify(prefs));
}

export function getCurrentBookId(): string | null {
  return getSetting('currentBookId');
}

export function setCurrentBookId(id: string): void {
  setSetting('currentBookId', id);
}

export function getLastReadAt(): number | null {
  const v = getSetting('lastReadAt');
  return v ? Number(v) : null;
}

export function addReadingSeconds(now: Date, seconds: number): void {
  db.runSync(
    'INSERT INTO reading_days (day, seconds) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET seconds = seconds + excluded.seconds',
    [dayKey(now), seconds],
  );
  setSetting('lastReadAt', String(now.getTime()));
}

export function readingDays(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of db.getAllSync<{ day: string; seconds: number }>('SELECT day, seconds FROM reading_days')) {
    out[r.day] = r.seconds;
  }
  return out;
}
