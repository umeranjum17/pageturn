import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquisitions,
  chooseEpub,
  decodeEntities,
  nextPage,
  parseBookPage,
  parseFeed,
} from '../src/catalog/opds.ts';

// Real responses, fetched with curl and committed byte for byte.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (name: string) => readFileSync(join(fixtures, name), 'utf8');

test('a list feed yields books, not navigation entries', () => {
  const feed = parseFeed(read('popular.opds'));
  assert.equal(feed.entries.length, 25);
  assert.deepEqual(feed.entries[0], { id: '1342', title: 'Pride and Prejudice', author: 'Jane Austen' });
});

test('the next page comes from the feed itself, entities decoded', () => {
  const feed = parseFeed(read('popular.opds'));
  assert.equal(feed.next, '/ebooks/search.opds/?sort_order=downloads&start_index=26');
});

test('the entry point is navigation only: no books, no next page', () => {
  const feed = parseFeed(read('root.opds'));
  assert.equal(feed.entries.length, 0);
  assert.equal(feed.next, null);
});

test('a book page names its title, author, licence and cover', () => {
  const page = parseBookPage(read('book-1342.opds'));
  assert.equal(page.title, 'Pride and Prejudice');
  // The catalogue prints authors surname-first on a book page; keep it as printed.
  assert.equal(page.author, 'Austen, Jane');
  assert.equal(page.licence, 'Public domain in the USA.');
  assert.equal(page.cover, 'https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg');
  assert.ok(page.categories.includes('England -- Fiction'));
  assert.ok(!page.categories.includes('PR'), 'LCC shelf codes are not subject headings');
});

test('a phone gets the plain EPUB, never the 24 MB illustrated one', () => {
  const list = acquisitions(read('book-1342.opds'));
  const epub = chooseEpub(list);
  assert.equal(epub?.href, 'https://www.gutenberg.org/ebooks/1342.epub.noimages');
  assert.equal(epub?.length, 609138);
});

test('with no plain edition, the smallest EPUB still wins', () => {
  const epub = chooseEpub([
    { type: 'application/epub+zip', title: 'EPUB3 (E-readers)', length: 900, href: '/big' },
    { type: 'application/epub+zip', title: 'EPUB (older e-readers)', length: 400, href: '/small' },
    { type: 'application/x-mobipocket-ebook', title: 'Kindle', length: 10, href: '/kindle' },
  ]);
  assert.equal(epub?.href, '/small');
  assert.equal(chooseEpub([{ type: 'application/pdf', title: 'PDF', length: 1, href: '/p' }]), null);
});

test('attribute order, self-closing tags, CRLF and entities all read the same', () => {
  const xml =
    '<feed>\r\n' +
    '  <entry>\r\n' +
    '    <title>Ampersands &amp; &lt;Angles&gt; &#38; caf&#233;</title>\r\n' +
    '    <link href="/ebooks/84.opds" rel="subsection" type="application/atom+xml"/>\r\n' +
    '  </entry>\r\n' +
    '</feed>\r\n';
  const feed = parseFeed(xml);
  assert.deepEqual(feed.entries, [
    { id: '84', title: 'Ampersands & <Angles> & café', author: null },
  ]);
  assert.equal(nextPage(xml), null);
});

test('an entry with a subsection that is not a book is skipped', () => {
  const feed = parseFeed(
    '<feed><entry><title>Browse by subject</title>' +
      '<link type="application/atom+xml" rel="subsection" href="/ebooks/subjects/123.opds"/>' +
      '</entry></feed>',
  );
  assert.equal(feed.entries.length, 0);
});

test('entities decode without inventing characters', () => {
  assert.equal(decodeEntities('&amp;&quot;&apos;&#65;&#x42;&unknown;'), '&"\'AB&unknown;');
});
