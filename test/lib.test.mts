import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streakLength, dayKey } from '../src/lib/streak.ts';
import { autoTheme, formatMinutes, minutesFor, resolveTheme, shouldShowResume, splitTail, RESUME_GAP_MS } from '../src/lib/time.ts';

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
