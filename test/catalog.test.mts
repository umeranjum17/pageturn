import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shelve, type Shelf } from '../src/catalog/download.ts';
import type { CatalogueBook } from '../src/catalog/source.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'pageturn-catalog-'));
const db = new DatabaseSync(join(dir, 'pageturn.db'));

// The app's own schema, read out of src/db.ts so the test cannot drift from it.
const ddl = /CREATE TABLE IF NOT EXISTS book_source \([^)]*\)/.exec(
  readFileSync(join(root, 'src/db.ts'), 'utf8'),
);
assert.ok(ddl, 'src/db.ts creates the book_source table');
db.exec(ddl[0]);

function shelf(): Shelf & { downloads: string[]; covers: string[] } {
  const downloads: string[] = [];
  const covers: string[] = [];
  return {
    downloads,
    covers,
    findBySource: (source, sourceId) =>
      (
        db
          .prepare('SELECT book_id FROM book_source WHERE source = ? AND source_id = ?')
          .get(source, sourceId) as { book_id: string } | undefined
      )?.book_id ?? null,
    recordSource: (row) =>
      db
        .prepare(
          'INSERT OR IGNORE INTO book_source (book_id, source, source_id, licence, page_url) VALUES (?, ?, ?, ?, ?)',
        )
        .run(row.bookId, row.source, row.sourceId, row.licence, row.pageUrl),
    download: async (url) => {
      downloads.push(url);
      return `${dir}/${url.split('/').pop()}`;
    },
    add: async (uri) => `book-${uri.split('/').pop()?.split('.')[0]}`,
    cover: async (url) => (url ? 'data:image/jpeg;base64,AAAA' : null),
    setCover: (bookId, cover) => covers.push(`${bookId} ${cover}`),
  };
}

const book = (id: string): CatalogueBook => ({
  source: 'gutenberg',
  id,
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  licence: 'Public domain in the USA.',
  pageUrl: `https://www.gutenberg.org/ebooks/${id}`,
  epub: `https://www.gutenberg.org/ebooks/${id}.epub.noimages`,
  cover: `https://www.gutenberg.org/cache/epub/${id}/cover.jpg`,
  categories: [],
});

test.after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a book is downloaded once, recorded, and its cover cached', async () => {
  const s = shelf();
  const bookId = await shelve(book('1342'), s);

  assert.equal(bookId, 'book-1342');
  assert.deepEqual(s.downloads, ['https://www.gutenberg.org/ebooks/1342.epub.noimages']);
  assert.deepEqual(s.covers, ['book-1342 data:image/jpeg;base64,AAAA']);
  assert.deepEqual(
    { ...db.prepare('SELECT book_id, source, source_id, licence, page_url FROM book_source').get() },
    {
      book_id: 'book-1342',
      source: 'gutenberg',
      source_id: '1342',
      licence: 'Public domain in the USA.',
      page_url: 'https://www.gutenberg.org/ebooks/1342',
    },
  );
});

test('the same source and id never downloads a second copy', async () => {
  const s = shelf();
  assert.equal(await shelve(book('1342'), s), 'book-1342');
  assert.deepEqual(s.downloads, []);

  const rows = db.prepare('SELECT COUNT(*) AS n FROM book_source').get() as { n: number };
  assert.equal(rows.n, 1);
});

test('another book is another download', async () => {
  const s = shelf();
  assert.equal(await shelve(book('84'), s), 'book-84');
  assert.equal(s.downloads.length, 1);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM book_source').get() as { n: number };
  assert.equal(rows.n, 2);
});

test('a cover that will not download still leaves the book shelved', async () => {
  const s = shelf();
  s.cover = async () => {
    throw new Error('offline');
  };
  const bookId = await shelve(book('2701'), s);
  assert.equal(bookId, 'book-2701');
  assert.deepEqual(s.covers, [], 'no cover written');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM book_source').get() as { n: number }).n,
    3,
  );
});
