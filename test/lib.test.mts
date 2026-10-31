import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streakLength, dayKey } from '../src/lib/streak.ts';
import { autoTheme, formatMinutes, minutesFor, resolveTheme, shouldShowResume, splitTail, fitLine, RESUME_GAP_MS } from '../src/lib/time.ts';
import { carryOnLine, chapterLine, minutesTodayLine, nextUp } from '../src/lib/habit.ts';
import type { Book } from '../src/db.ts';

const day = (s: string) => new Date(`${s}T12:00:00`);
const read = (...days: string[]) => Object.fromEntries(days.map((d) => [d, 600]));

test('dayKey uses local calendar date', () => {
  assert.equal(dayKey(new Date(2026, 9, 3, 23, 59)), '2026-10-03');
});

test('no reading means no streak', () => {
  assert.equal(streakLength({}, day('2026-10-30')), 0);
});

test('consecutive days count, today not read yet does not break it', () => {
  // Thu 2026-10-29 back to Mon 2026-10-26
  assert.equal(streakLength(read('2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'), day('2026-10-30')), 4);
  assert.equal(streakLength(read('2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'), day('2026-10-30')), 4);
});

test('one missed day a week is a rest day', () => {
  // Wed 28 missed, rest that week
  assert.equal(streakLength(read('2026-10-26', '2026-10-27', '2026-10-29', '2026-10-30'), day('2026-10-30')), 4);
});

test('two missed days in one week end the streak', () => {
  assert.equal(streakLength(read('2026-10-26', '2026-10-29', '2026-10-30'), day('2026-10-30')), 2);
});

test('rest days are per week', () => {
  // Sun 25 missed (week of 19th), Wed 28 missed (week of 26th)
  const days = read('2026-10-22', '2026-10-23', '2026-10-24', '2026-10-26', '2026-10-27', '2026-10-29');
  assert.equal(streakLength(days, day('2026-10-29')), 6);
});

test('under a minute does not count as a read day', () => {
  assert.equal(streakLength({ '2026-10-29': 30, '2026-10-30': 600 }, day('2026-10-30')), 1);
});

test('auto theme is night in the evening and early morning', () => {
  assert.equal(autoTheme(new Date(2026, 9, 30, 22)), 'night');
  assert.equal(autoTheme(new Date(2026, 9, 30, 5)), 'night');
  assert.equal(autoTheme(new Date(2026, 9, 30, 7)), 'paper');
  assert.equal(autoTheme(new Date(2026, 9, 30, 18, 59)), 'paper');
  assert.equal(resolveTheme('paper', new Date(2026, 9, 30, 23)), 'paper');
});

test('time left formats', () => {
  assert.equal(formatMinutes(0), 'under a minute');
  assert.equal(formatMinutes(12), '12 min');
  assert.equal(formatMinutes(252), '4h 12m');
  assert.equal(formatMinutes(120), '2h');
  assert.equal(minutesFor(13000), 10);
});

test('resume card after a long gap only', () => {
  assert.equal(shouldShowResume(null, 1e12), false);
  assert.equal(shouldShowResume(1e12, 1e12 + RESUME_GAP_MS - 1), false);
  assert.equal(shouldShowResume(1e12, 1e12 + RESUME_GAP_MS), true);
});

test('splitTail keeps the last words for the accent', () => {
  assert.deepEqual(splitTail('I did not expect such a compliment.'), ['I did not expect ', 'such a compliment.']);
  assert.deepEqual(splitTail('Hello there'), ['', 'Hello there']);
});

test('fitLine trims to whole words and keeps the ending', () => {
  const s = 'Why, my dear, you must know, Mrs. Long says that Netherfield is taken by a young man of large fortune.';
  const out = fitLine(s, 40);
  assert.ok(out.length <= 41, out);
  assert.ok(out.startsWith('…') && out.endsWith('large fortune.'), out);
  assert.ok(s.includes(out.slice(1)) && s.includes(` ${out.slice(1)}`), 'starts at a word boundary');
  assert.equal(fitLine('This was invitation enough.', 40), 'This was invitation enough.');
});

test('fitLine drops dangling brackets and never cuts inside a number', () => {
  assert.equal(fitLine('Copyright 1894 by George Allen.]', 60), 'Copyright 1894 by George Allen.');
  assert.equal(fitLine('[He came down to see the place', 60), 'He came down to see the place');
  assert.equal(fitLine('She said (quietly) no.', 60), 'She said (quietly) no.');
  assert.equal(fitLine('…on the 1894 edition by George Allen.', 22), '…by George Allen.');
  assert.ok(!/…\d/.test(fitLine('In 1894 there were 3000000 copies sold by then.', 30)));
});

const book = (over: Partial<Book> & { id: string }): Book => ({
  path: '', format: 'epub', pages: null, page: null, title: over.id, author: null, cover: null,
  addedAt: 0, openedAt: null, cfi: null, percent: null, chapter: null, lastLine: null, locations: null,
  ...over,
});

test('the way back in waits about two hours, not a day', () => {
  assert.equal(RESUME_GAP_MS, 2 * 60 * 60 * 1000);
  assert.equal(shouldShowResume(1e12, 1e12 + 2 * 60 * 60 * 1000), true);
  assert.equal(shouldShowResume(1e12, 1e12 + 119 * 60 * 1000), false);
});

test('next up is the book he left unfinished, with its own reason', () => {
  const up = nextUp([
    book({ id: 'old', openedAt: 100, percent: 0.1 }),
    book({ id: 'recent', openedAt: 900, percent: 0.4, title: 'Middlemarch' }),
    book({ id: 'done', openedAt: 950, percent: 1 }),
  ]);
  assert.equal(up?.book.id, 'recent');
  assert.equal(up?.reason, 'You are 40 percent in');
});

test('next up falls to the newest unopened book, then to the shortest', () => {
  const unopened = nextUp([
    book({ id: 'done', openedAt: 1, percent: 1 }),
    book({ id: 'older', addedAt: 10 }),
    book({ id: 'newest', addedAt: 20 }),
  ]);
  assert.equal(unopened?.book.id, 'newest');
  assert.equal(unopened?.reason, 'Not started yet');

  const shortest = nextUp([
    book({ id: 'long', openedAt: 1, percent: 1, pages: 900 }),
    book({ id: 'short', openedAt: 2, percent: 1, pages: 120 }),
  ]);
  assert.equal(shortest?.book.id, 'short');
  assert.equal(shortest?.reason, 'Shortest on your shelf');
  assert.equal(nextUp([]), null);
});

test('next up skips the first shelf row, and says started only for an opened book', () => {
  // Real rows in the order listBooks() returns them: COALESCE(opened_at, added_at)
  // DESC puts the newest or most recently opened book in the row under the card.
  const shelf = [
    book({ id: 'frankenstein', addedAt: 500, pages: 280 }),
    book({ id: 'middlemarch', openedAt: 400, addedAt: 100, percent: 0.37 }),
    book({ id: 'kidnapped', openedAt: 300, addedAt: 60, pages: 120 }),
  ];
  const up = nextUp(shelf);
  assert.notEqual(up?.book.id, shelf[0].id);
  assert.equal(up?.book.id, 'middlemarch');
  assert.equal(up?.reason, 'You are 37 percent in');

  // Opened, no page turned yet: the one book that has earned the started line.
  const opened = nextUp([shelf[0], shelf[2]]);
  assert.equal(opened?.book.id, 'kidnapped');
  assert.equal(opened?.reason, 'You started this one');

  // Opened and the reader stored a zero: the card says the stored number.
  assert.equal(nextUp([shelf[0], book({ id: 'moby', openedAt: 200, percent: 0 })])?.reason, 'You are 0 percent in');

  // Never opened: a short one, or plainly not started - never 'started this one'.
  const fresh = nextUp([shelf[0], book({ id: 'kidnapped', addedAt: 60, pages: 120 })]);
  assert.equal(fresh?.book.id, 'kidnapped');
  assert.equal(fresh?.reason, 'A short one to start');
  assert.equal(nextUp([book({ id: 'kidnapped', addedAt: 60, pages: 120 }), shelf[0]])?.reason, 'Not started yet');

  // Only the first shelf row left: no honest candidate, so no card at all.
  assert.equal(nextUp([shelf[0]]), null);
  assert.equal(nextUp([]), null);
});

test('the chapter line says what is left, in plain words', () => {
  assert.equal(chapterLine(0), 'under a minute left in this chapter');
  assert.equal(chapterLine(3 * 1300), '3 min left in this chapter');
  assert.equal(chapterLine(90 * 1300), '1h 30m left in this chapter');
});

test("today's minutes show only once he has read today", () => {
  assert.equal(minutesTodayLine(0), null);
  assert.equal(minutesTodayLine(59), null);
  assert.equal(minutesTodayLine(60), '1 minute today');
  assert.equal(minutesTodayLine(12 * 60), '12 minutes today');
});

test('with no last line the card still offers a way in', () => {
  assert.equal(carryOnLine(null), 'Carry on from where you stopped');
  assert.equal(carryOnLine(0.4), 'Carry on from where you stopped · 40%');
});
