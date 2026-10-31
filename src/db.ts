// Local storage only: one SQLite file, no backend, no network.
import * as SQLite from 'expo-sqlite';
import { dayKey } from './lib/streak';
import type { ThemeMode } from './lib/time';
import type { Justify } from './reader/protocol';

export type Format = 'epub' | 'pdf';

export interface Book {
  id: string;
  path: string;
  format: Format;
  pages: number | null;
  page: number | null;
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
  CREATE TABLE IF NOT EXISTS highlights (
    id TEXT PRIMARY KEY NOT NULL,
    book_id TEXT,
    title TEXT NOT NULL,
    author TEXT,
    kind TEXT NOT NULL,
    locator TEXT,
    page INTEGER,
    location INTEGER,
    text TEXT NOT NULL,
    added_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS highlights_by_book ON highlights (book_id, created_at DESC);
  -- Re-importing the same export must not double up.
  CREATE UNIQUE INDEX IF NOT EXISTS highlights_once ON highlights (title, kind, COALESCE(locator, ''), text);
  -- Where a downloaded book came from, so it is never fetched twice.
  CREATE TABLE IF NOT EXISTS book_source (book_id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL, licence TEXT, page_url TEXT);
`);

// Added after the first release, so existing shelves keep their books.
for (const [column, decl] of [
  ['format', "TEXT NOT NULL DEFAULT 'epub'"],
  ['pages', 'INTEGER'],
  ['page', 'INTEGER'],
] as const) {
  try {
    db.execSync(`ALTER TABLE books ADD COLUMN ${column} ${decl}`);
  } catch {
    // already there
  }
}

interface BookRow {
  id: string;
  path: string;
  format: Format;
  pages: number | null;
  page: number | null;
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
    format: r.format === 'pdf' ? 'pdf' : 'epub',
    pages: r.pages,
    page: r.page,
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

export function addBook(id: string, path: string, title: string, now: number, format: Format = 'epub'): void {
  db.runSync('INSERT INTO books (id, path, title, added_at, format) VALUES (?, ?, ?, ?, ?)', [
    id,
    path,
    title,
    now,
    format,
  ]);
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

export function savePage(id: string, page: number, percent: number, pages: number | null): void {
  db.runSync('UPDATE books SET page = ?, percent = ?, pages = COALESCE(?, pages) WHERE id = ?', [
    page,
    percent,
    pages,
    id,
  ]);
}

export function savePages(id: string, pages: number): void {
  db.runSync('UPDATE books SET pages = ? WHERE id = ?', [pages, id]);
}

export function saveLocations(id: string, locations: string): void {
  db.runSync('UPDATE books SET locations = ? WHERE id = ?', [locations, id]);
}

export function markOpened(id: string, now: number): void {
  db.runSync('UPDATE books SET opened_at = ? WHERE id = ?', [now, id]);
}

/** The book already on the shelf for this catalogue entry, if any. */
export function findBookBySource(source: string, sourceId: string): string | null {
  return (
    db.getFirstSync<{ book_id: string }>(
      'SELECT book_id FROM book_source WHERE source = ? AND source_id = ?',
      [source, sourceId],
    )?.book_id ?? null
  );
}

export function recordBookSource(row: {
  bookId: string;
  source: string;
  sourceId: string;
  licence: string | null;
  pageUrl: string | null;
}): void {
  db.runSync(
    'INSERT OR IGNORE INTO book_source (book_id, source, source_id, licence, page_url) VALUES (?, ?, ?, ?, ?)',
    [row.bookId, row.source, row.sourceId, row.licence, row.pageUrl],
  );
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

export function setLastReadAt(now: number): void {
  setSetting('lastReadAt', String(now));
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


export interface Highlight {
  id: string;
  bookId: string | null;
  title: string;
  author: string | null;
  kind: string;
  locator: string | null;
  page: number | null;
  text: string;
  addedAt: number | null;
  createdAt: number;
}

interface HighlightRow {
  id: string;
  book_id: string | null;
  title: string;
  author: string | null;
  kind: string;
  locator: string | null;
  page: number | null;
  location: number | null;
  text: string;
  added_at: number | null;
  created_at: number;
}

function toHighlight(r: HighlightRow): Highlight {
  return {
    id: r.id,
    bookId: r.book_id,
    title: r.title,
    author: r.author,
    kind: r.kind,
    locator: r.locator,
    page: r.page,
    text: r.text,
    addedAt: r.added_at,
    createdAt: r.created_at,
  };
}

export function addHighlight(h: Omit<Highlight, 'id'>): void {
  db.runSync(
    `INSERT OR IGNORE INTO highlights (id, book_id, title, author, kind, locator, page, location, text, added_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      `${h.createdAt.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      h.bookId,
      h.title,
      h.author,
      h.kind,
      h.locator,
      h.page,
      h.text,
      h.addedAt,
      h.createdAt,
    ],
  );
}

/** Newest first: the device's own "Added on" stamp, else when it was imported. */
export function listHighlights(bookId: string): Highlight[] {
  return db
    .getAllSync<HighlightRow>(
      'SELECT * FROM highlights WHERE book_id = ? ORDER BY COALESCE(added_at, created_at) DESC, created_at DESC',
      [bookId],
    )
    .map(toHighlight);
}

export function countHighlights(bookId: string): number {
  return (
    db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM highlights WHERE book_id = ?', [bookId])?.n ?? 0
  );
}

/** Clippings that arrived before their book did, waiting to be attached. */
export function orphanHighlights(): Pick<Highlight, 'id' | 'title' | 'author'>[] {
  return db
    .getAllSync<{ id: string; title: string; author: string | null }>(
      'SELECT id, title, author FROM highlights WHERE book_id IS NULL',
    )
    .map((r) => ({ id: r.id, title: r.title, author: r.author }));
}

export function setHighlightBook(id: string, bookId: string): void {
  db.runSync('UPDATE highlights SET book_id = ? WHERE id = ?', [bookId, id]);
}

export function highlightCountForBook(bookId: string): number {
  return db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM highlights WHERE book_id = ?', [bookId])?.n ?? 0;
}
