import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  descriptionOf,
  googleUrl,
  merge,
  openLibraryUrl,
  searchBooks,
  storeSearch,
  type ResultEntry,
} from '../src/catalog/websearch.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function entry(over: Partial<ResultEntry> & { title: string }): ResultEntry {
  return {
    id: over.title.toLowerCase().replace(/\s+/g, '-'),
    author: null,
    year: null,
    description: null,
    descriptionUrl: null,
    cover: null,
    free: false,
    preview: 'https://example.test/book',
    store: 'https://example.test/store',
    ...over,
  };
}

test('a description is a string on some works and an object on others', () => {
  assert.equal(descriptionOf('A short one.'), 'A short one.');
  assert.equal(descriptionOf({ value: 'Wrapped in a value.' }), 'Wrapped in a value.');
  assert.equal(descriptionOf(''), null);
  assert.equal(descriptionOf(undefined), null);
  assert.equal(descriptionOf({ type: '/type/text' }), null);
});

test('markdown, html and whitespace are cleaned out of a description', () => {
  assert.equal(
    descriptionOf('See [the guide](https://example.test) <b>now</b>\n\n for   more.'),
    'See the guide now for more.',
  );
  const long = descriptionOf('word '.repeat(200));
  assert.ok(long);
  assert.ok(long.length <= 241, `kept ${long.length} characters`);
  assert.ok(long.endsWith('…'));
});

test('one card per book, and the source with a cover and a description wins', () => {
  const plain = entry({ title: 'Clean Code', author: 'Robert C. Martin' });
  const bare = entry({ title: 'Clean Code', author: 'Robert C Martin', year: '2008' });
  const withCover = entry({ title: 'Clean Code', author: 'Robert C. Martin', cover: 'https://c/1.jpg' });
  const withBoth = entry({
    title: 'clean  code',
    author: 'Robert C. Martin',
    cover: 'https://c/2.jpg',
    description: 'A handbook.',
  });
  const other = entry({ title: 'Refactoring', author: 'Martin Fowler' });

  const merged = merge([[plain], [withCover, withBoth], [other, bare]]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].description, 'A handbook.');
  assert.equal(merged[1].title, 'Refactoring');
});

test('a whole free book is never replaced by a found copy of it', () => {
  const free = entry({ title: 'Pride and Prejudice', author: 'Jane Austen', free: true });
  const found = entry({
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    cover: 'https://c/1.jpg',
    description: 'A novel.',
  });
  const merged = merge([[free], [found]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].free, true);
});

test('the addresses asked for are the documented ones', () => {
  const ol = openLibraryUrl('clean code');
  assert.ok(ol.startsWith('https://openlibrary.org/search.json?q=clean%20code&fields='));
  assert.match(ol, /cover_i/);
  assert.match(ol, /limit=20$/);

  const gb = googleUrl('clean code', 'a key');
  assert.ok(gb.startsWith('https://www.googleapis.com/books/v1/volumes?q=clean%20code&maxResults=20'));
  assert.ok(gb.endsWith('&key=a%20key'));

  assert.equal(
    storeSearch('Clean Code', 'Robert C. Martin'),
    'https://play.google.com/store/search?q=Clean%20Code%20Robert%20C.%20Martin&c=books',
  );
});

/** Answers each URL with the canned body for that source; anything else 404s. */
function stub(body: { catalogue?: string; openLibrary?: string; google?: unknown[] }): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    asked.push(url);
    if (url.includes('gutenberg.org')) {
      if (!body.catalogue) return new Response('', { status: 404 });
      return new Response(body.catalogue, { status: 200 });
    }
    if (url.includes('openlibrary.org')) {
      if (!body.openLibrary) return new Response('', { status: 500 });
      return new Response(body.openLibrary, { status: 200 });
    }
    if (url.includes('googleapis.com')) {
      if (!body.google) return new Response('{"error":"quota"}', { status: 429 });
      return new Response(JSON.stringify({ items: body.google }), { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return asked;
}

const OPEN_LIBRARY_ANSWER = JSON.stringify({
  numFound: 178,
  docs: [
    {
      key: '/works/OL17618370W',
      title: 'Clean Code',
      author_name: ['Robert C. Martin'],
      first_publish_year: 2008,
      cover_i: 8065615,
      ebook_access: 'printdisabled',
      ia: ['cleancodehandboo0000unse'],
      edition_key: ['OL29220209M'],
    },
  ],
});

test('a search asks Open Library and the free catalogue, and skips Google with no key', async () => {
  const asked = stub({ openLibrary: OPEN_LIBRARY_ANSWER });
  const found = await searchBooks('clean code', '');
  assert.equal(found.entries.length, 1);
  const [book] = found.entries;
  assert.equal(book.title, 'Clean Code');
  assert.equal(book.author, 'Robert C. Martin');
  assert.equal(book.year, '2008');
  assert.equal(book.cover, 'https://covers.openlibrary.org/b/id/8065615-M.jpg');
  assert.equal(book.description, null);
  assert.equal(book.descriptionUrl, 'https://openlibrary.org/works/OL17618370W.json');
  // A scan exists: its borrow page, not a claim that the app can read it.
  assert.equal(book.preview, 'https://archive.org/details/cleancodehandboo0000unse');
  assert.equal(book.free, false);
  assert.ok(asked.some((url) => url.includes('openlibrary.org')));
  assert.ok(!asked.some((url) => url.includes('googleapis.com')));
});

test('a configured key turns the second source on', async () => {
  stub({
    google: [
      {
        id: 'abc',
        volumeInfo: {
          title: 'Clean Code',
          authors: ['Robert C. Martin'],
          description: 'A handbook of agile craftsmanship.',
          imageLinks: { thumbnail: 'http://books.google.test/cover.jpg' },
          publishedDate: '2008-08-01',
          previewLink: 'https://books.google.test/preview',
        },
      },
    ],
  });
  const found = await searchBooks('clean code', 'a key');
  const [book] = found.entries;
  assert.equal(book.id, 'gb-abc');
  assert.equal(book.year, '2008');
  assert.equal(book.description, 'A handbook of agile craftsmanship.');
  assert.equal(book.cover, 'https://books.google.test/cover.jpg');
  assert.equal(book.preview, 'https://books.google.test/preview');
  assert.equal(book.store, 'https://play.google.com/store/books/details?id=abc');
});

test('a refused second source is skipped, not shown to the reader', async () => {
  stub({ openLibrary: OPEN_LIBRARY_ANSWER });
  const found = await searchBooks('clean code', 'a key'); // Google answers 429
  assert.equal(found.entries.length, 1);
  assert.equal(found.entries[0].title, 'Clean Code');
});

test('a nonsense word finds nothing', async () => {
  stub({ openLibrary: JSON.stringify({ numFound: 0, docs: [] }), catalogue: '<feed></feed>' });
  const found = await searchBooks('zzqx qwertyuiop nonexistent', '');
  assert.deepEqual(found.entries, []);
});

test('nothing answering at all is a failure, not an empty shelf', async () => {
  stub({});
  await assert.rejects(() => searchBooks('clean code', ''), /No book source answered/);
});

test('a locked book never claims it can be read in this app', async () => {
  stub({ openLibrary: OPEN_LIBRARY_ANSWER });
  const found = await searchBooks('clean code', '');
  for (const book of found.entries) {
    assert.equal(book.free, false, `${book.title} cannot be downloaded here`);
    assert.match(book.store, /^https:\/\//);
    assert.match(book.preview, /^https:\/\//);
  }
  // The card says so too, and only for a book the catalogue does not hold.
  const card = readFileSync(join(root, 'src/ui/Marketplace.tsx'), 'utf8');
  assert.match(card, /A copy bought there cannot be read in this app\./);
  assert.match(card, /\{entry\.free \? null : \(/);
});
