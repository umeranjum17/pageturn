import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { matchBook, normalizeTitle, parseClippings } from '../src/lib/clippings.ts';

const require = createRequire(import.meta.url);
const PDFVIEW = require('../src/reader/web/pdfview.js');

const RULE = '==========';
const clip = (title: string, meta: string, text: string, rule = RULE) =>
  `${title}\r\n${meta}\r\n\r\n${text}\r\n\r\n${rule}\r\n`;

test('one entry parses into title, author, kind, locator and text', () => {
  const raw = clip(
    'Pride and Prejudice (Jane Austen)',
    '- Your Highlight on page 12 | Location 145-147 | Added on Friday, October 24, 2026 9:38:12 PM',
    'It is a truth universally acknowledged.',
  );
  const [c] = parseClippings(raw);
  assert.equal(c.title, 'Pride and Prejudice');
  assert.equal(c.author, 'Jane Austen');
  assert.equal(c.kind, 'highlight');
  assert.equal(c.page, 12);
  assert.equal(c.location, 145);
  assert.equal(c.locator, 'page 12 · Location 145');
  assert.equal(c.text, 'It is a truth universally acknowledged.');
  assert.equal(c.addedAt, Date.parse('October 24, 2026 9:38:12 PM'));
});

test('a title with its own parentheses keeps the last group as the author', () => {
  const [c] = parseClippings(
    clip('The Yellow Wallpaper (Dover Thrift Editions) (Charlotte Perkins Gilman)', '- Your Highlight on page 3 | Location 44', 'It is very seldom.'),
  );
  assert.equal(c.title, 'The Yellow Wallpaper (Dover Thrift Editions)');
  assert.equal(c.author, 'Charlotte Perkins Gilman');
});

test('separators the file actually contains are all tolerated', () => {
  const raw =
    clip('A (Ada)', '- Your Highlight on page 1', 'one', '='.repeat(14)) +
    clip('A (Ada)', '- Your Highlight on page 2', 'two', '=====') +
    'A (Ada)\n- Your Highlight on page 3\n\nthree\n';
  assert.deepEqual(parseClippings(raw).map((c) => c.text), ['one', 'two', 'three']);
});

test('duplicate entries collapse to one, even across a re-export', () => {
  const meta = '- Your Highlight on page 12 | Location 145-147';
  const raw = clip('B (Bo)', meta, 'same words') + clip('B (Bo)', meta, 'same words');
  assert.equal(parseClippings(raw).length, 1);
  assert.equal(parseClippings(raw + raw).length, 1);
});

test('notes, bookmarks and the clipping-limit notice are kept or dropped correctly', () => {
  const raw =
    clip('C (Cy)', '- Your Note on page 4 | Location 50', 'a note') +
    clip('C (Cy)', '- Your Bookmark on page 9 | Location 90', '') +
    clip('C (Cy)', '- Your Highlight on page 5 | Location 60', 'You have reached the clipping limit for this item.');
  const out = parseClippings(raw);
  assert.deepEqual(out.map((c) => c.kind), ['note']);
  assert.equal(out[0].text, 'a note');
});

test('a multi-line passage survives, and a byte-order mark is ignored', () => {
  const raw = '\uFEFF' + clip('D (Di)', '- Your Highlight on page 7', 'first line\n\nsecond line');
  assert.equal(parseClippings(raw)[0].text, 'first line\nsecond line');
});

test('an entry with no metadata line is still a highlight', () => {
  const [c] = parseClippings('E (Ed)\n\nbare words\n');
  assert.equal(c.kind, 'highlight');
  assert.equal(c.text, 'bare words');
  assert.equal(c.locator, null);
});

test('titles normalise and match the shelf loosely but not wrongly', () => {
  assert.equal(normalizeTitle('Pride and Prejudice: A Novel'), 'pride and prejudice');
  assert.equal(normalizeTitle('Pride & Prejudice'), 'pride and prejudice');
  const shelf = [
    { title: 'Pride and Prejudice', author: 'Jane Austen' },
    { title: 'Persuasion', author: 'Jane Austen' },
  ];
  assert.equal(matchBook({ title: 'Pride and Prejudice', author: 'Jane Austen' }, shelf)?.title, 'Pride and Prejudice');
  assert.equal(matchBook({ title: 'The Time Machine', author: 'H. G. Wells' }, shelf), null);
  // same title, different author: never attach
  assert.equal(matchBook({ title: 'Pride and Prejudice', author: 'Someone Else' }, shelf), null);
});

test('the same title twice goes to the reflowable copy, not the PDF', () => {
  const shelf = [
    { title: 'pride-and-prejudice', author: null, format: 'pdf' },
    { title: 'Pride and Prejudice', author: 'Jane Austen', format: 'epub' },
  ];
  assert.equal(matchBook({ title: 'Pride and Prejudice', author: 'Jane Austen' }, shelf)?.format, 'epub');
  // and the other way round in shelf order
  const flipped = [...shelf].reverse();
  assert.equal(matchBook({ title: 'Pride and Prejudice', author: 'Jane Austen' }, flipped)?.format, 'epub');
});

test('PDF fit keeps the whole page inside the box', () => {
  // A5 page in a 390x700 reading area with a 10px inset.
  const s = PDFVIEW.fitScale(419.53, 595.28, 390, 700, 10);
  assert.ok(s * 419.53 <= 370.0001, 'fits width');
  assert.ok(s * 595.28 <= 680.0001, 'fits height');
  assert.ok(s > 0);
  // A wide landscape page is limited by width instead.
  const wide = PDFVIEW.fitScale(1190, 842, 390, 700, 10);
  assert.ok(Math.abs(wide * 1190 - 370) < 0.5);
});

test('pan never leaves a blank gutter at any zoom', () => {
  const box = 390;
  const page = 370;
  // zoomed in: clamped to the page edges
  assert.deepEqual(PDFVIEW.clampPan(500, 0, 2, page, 500, box, 700), { x: 0, y: 0 });
  assert.deepEqual(PDFVIEW.clampPan(-9999, 0, 2, page, 500, box, 700), { x: box - page * 2, y: 0 });
  // at fit the page is centred
  assert.deepEqual(PDFVIEW.clampPan(-9999, 0, 1, page, 500, box, 700).x, Math.round((box - page) / 2));
});

test('zoom stays anchored on the point under the finger', () => {
  // A point at x=100 in the box with pan 0, zoom 1 -> content x 100.
  const t = PDFVIEW.zoomAround(100, 50, 0, 0, 1, 2);
  assert.deepEqual(t, { x: -100, y: -50 });
  // After the transform that same content point is still under the finger.
  assert.equal(t.x + 100 * 2, 100);
});

test('night invert maps paper dark and print light, never mud', () => {
  // pixels: white paper, black print, mid grey
  const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255]);
  PDFVIEW.invertPixels(data);
  const [pr, pg, pb] = [data[0], data[1], data[2]];
  const [ir, ig, ib] = [data[4], data[5], data[6]];
  // paper becomes the dark warm ground
  assert.deepEqual([pr, pg, pb], PDFVIEW.PAPER);
  // print becomes the night prose colour, not pure white
  assert.deepEqual([ir, ig, ib], PDFVIEW.INK);
  assert.ok(ir < 255, 'print is not #ffffff');
  // grey stays between the two, so nothing is crushed
  const mid = data[8];
  assert.ok(mid > PDFVIEW.PAPER[0] && mid < PDFVIEW.INK[0], 'mid tone preserved');
});

test('page progress is a fraction of the whole document', () => {
  assert.equal(PDFVIEW.pagePercent(1, 8), 0);
  assert.equal(PDFVIEW.pagePercent(8, 8), 7 / 8);
  assert.equal(PDFVIEW.pagePercent(4, 0), 0);
});
