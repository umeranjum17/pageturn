import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  candidates,
  chooseFile,
  fileUrl,
  itemHit,
  licenceOf,
  openLicence,
  searchUrl,
  toCatalogueBook,
  torrentUrl,
  type ArchiveHit,
} from '../src/catalog/archive.ts';

// Real responses, fetched with curl on 2026-10-31 and committed byte for byte.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const json = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
const docs = () => json('archive-search.json').response.docs as never[];

test('the query is spelled out plainly and asks for the licence', () => {
  const url = searchUrl('pride and prejudice');
  assert.match(url, /advancedsearch\.php\?q=pride\+and\+prejudice&/);
  assert.match(url, /fl\[\]=licenseurl/);
  assert.match(url, /rows=20/);
});

test('a lending item is refused even though it carries an EPUB', () => {
  const item = itemHit('prideprejudice0000aust_e1w4', json('archive-item-lending.json'));
  assert.deepEqual(item, { skip: 'licence' });
});

test('no licence anywhere means the item is left out', () => {
  // bell_literature is no public-domain collection and the item states no licence.
  assert.equal(licenceOf(json('archive-item-bell.json').metadata), null);
  assert.deepEqual(itemHit('AesopsFables_201303', json('archive-item-bell.json')), { skip: 'licence' });
});

test('out of copyright scans are admitted, with the EPUB preferred', () => {
  const { hit } = itemHit('lucretiusonnatu00carugoog', json('archive-item-americana.json')) as { hit: ArchiveHit };
  assert.equal(hit.licence, 'Public domain');
  assert.equal(hit.title, 'Lucretius: On the nature of things');
  assert.equal(hit.file?.url, `${torrentUrl('lucretiusonnatu00carugoog').replace(/\/[^/]+$/, '')}/lucretiusonnatu00carugoog.epub`);
  assert.equal(hit.torrent, 'https://archive.org/download/lucretiusonnatu00carugoog/lucretiusonnatu00carugoog_archive.torrent');
  assert.equal(hit.cover, 'https://archive.org/services/img/lucretiusonnatu00carugoog');
  assert.ok((hit.file?.bytes ?? 0) > 1_000_000);
});

test('the text-layer PDF beats the bigger scan when there is no EPUB', () => {
  const { hit } = itemHit('aesopnee-balvartao', json('archive-item-opensource.json')) as { hit: ArchiveHit };
  assert.equal(hit.licence, 'Public domain');
  assert.match(hit.file!.url, /Aesopnee%20Balvartao_text\.pdf$/);
});

test('an encrypted or private file is never the file we hand over', () => {
  const files = json('archive-item-lending.json').files as { name: string }[];
  assert.ok(files.some((f) => /_lcp\.epub$/.test(f.name)));
  // Every readable copy of this one is private or encrypted, so there is none.
  assert.equal(chooseFile(files), null);
  // An encrypted copy never wins over a plain one either.
  assert.equal(chooseFile([...files, { name: 'plain.epub' }])?.name, 'plain.epub');
});

test('a stored name that is already encoded is encoded again, once', () => {
  // The Archive keeps "Aesop%27s Fables.epub"; the endpoint answers for %2527.
  assert.match(fileUrl('AesopsFables_201303', 'Aesop%27s Fables.epub'), /Aesop%2527s%20Fables\.epub$/);
});

test('an open licence is read as one short line', () => {
  assert.equal(openLicence('http://creativecommons.org/licenses/by-nc-nd/3.0/'), 'CC BY-NC-ND 3.0');
  assert.equal(openLicence('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0 public domain');
  assert.equal(openLicence('http://www.gnu.org/licenses/gpl-3.0.html'), 'GNU GPL-3.0');
  assert.equal(openLicence('https://example.org/all-rights-reserved'), null);
});

test('the search answer is filtered and counted, not silently cut', () => {
  const { keep, skipped, notBooks } = candidates(docs());
  const kept = keep.map((d) => d.identifier);
  // Nothing lending survives, though this answer is mostly library scans.
  assert.ok(!kept.includes('prideprejudice0000aust_e1w4'));
  assert.ok(!kept.includes('balancingactswom0000unse'));
  assert.ok(!kept.includes('bdrc-W8LS76430'));
  assert.ok(kept.includes('prideandprejudi01austgoog'));
  // americana, but the Archive also marks it print-disabled: still a lending book.
  assert.ok(!kept.includes('presumption00barr'));
  assert.ok(kept.includes('mindy-m-morton-procopio-brigid-heid-mary-wright-oriet-cohen-supple-gregory-y-lievers-20211021-0914'));
  // Audio and film are neither a book nor a licence question.
  assert.ok(!kept.includes('05joorsivfeyrfzblgym63yxtxwkxubwmr4la8pa'));
  assert.equal(skipped, 13);
  assert.equal(notBooks, 5);
  assert.equal(skipped + notBooks + keep.length, docs().length);
});

test('a hit becomes the book the shelf already knows how to download', () => {
  const { hit } = itemHit('aesopnee-balvartao', json('archive-item-opensource.json')) as { hit: ArchiveHit };
  const book = toCatalogueBook(hit);
  assert.equal(book.source, 'archive');
  assert.equal(book.id, 'aesopnee-balvartao');
  assert.equal(book.pageUrl, 'https://archive.org/details/aesopnee-balvartao');
  assert.equal(book.epub, hit.file!.url);
  // An item with a torrent but no readable file cannot go through the shelf.
  assert.throws(() => toCatalogueBook({ ...hit, file: null }));
});
