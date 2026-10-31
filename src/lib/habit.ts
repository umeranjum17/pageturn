// The habit layer's choices, as pure functions: what to read next, what the
// quiet strip says, and how the way back in is worded. Nothing here touches
// React or the database, so the phone shows exactly what a test can check.
import type { Book } from '../db';
import { formatMinutes, minutesFor } from './time.ts';

/** A book counts as done this far in; a hair short of the last page still pulls. */
export const FINISHED_AT = 0.99;

export interface NextUp {
  book: Book;
  /** Why this book, in his own data. Never a reason he cannot check. */
  reason: string;
}

const percentIn = (b: Book) => Math.round((b.percent ?? 0) * 100);

/** Printed pages when the book has them, else the engine's own location count. */
function lengthOf(b: Book): number {
  if (b.pages) return b.pages;
  try {
    const saved = JSON.parse(b.locations ?? '[]');
    return Array.isArray(saved) && saved.length ? saved.length : Infinity;
  } catch {
    return Infinity;
  }
}

/** Short enough to be a gentle first read: an evening or two, not a term. */
const SHORT_PAGES = 150;

/** Why this book, said only from what its own row records. */
function reasonFor(b: Book): string {
  if (b.openedAt === null) return lengthOf(b) <= SHORT_PAGES ? 'A short one to start' : 'Not started yet';
  return b.percent == null ? 'You started this one' : `You are ${percentIn(b)} percent in`;
}

/**
 * The one book most likely to be read next: the one he left unfinished, else
 * the newest unopened, else the shortest. Null when there is nothing to offer.
 *
 * The shelf lists the same books, and its top row is already the newest or most
 * recently opened one - the very book these tiers would pick. The card sits
 * directly above that row, so offering it there shows one book twice; the first
 * shelf row is out of the running.
 */
export function nextUp(books: Book[]): NextUp | null {
  const pool = books.filter((b) => b.id !== books[0]?.id);
  if (!pool.length) return null;

  const unfinished = pool
    .filter((b) => b.openedAt !== null && (b.percent ?? 0) < FINISHED_AT)
    .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
  const b = unfinished[0];
  if (b) return { book: b, reason: reasonFor(b) };

  const unopened = pool.filter((b) => b.openedAt === null).sort((a, b) => b.addedAt - a.addedAt);
  if (unopened.length) return { book: unopened[0], reason: reasonFor(unopened[0]) };

  const shortest = [...pool].sort((a, b) => lengthOf(a) - lengthOf(b) || a.addedAt - b.addedAt)[0];
  return shortest ? { book: shortest, reason: 'Shortest on your shelf' } : null;
}

/** What is left of the chapter, in plain words. */
export function chapterLine(chars: number): string {
  return `${formatMinutes(minutesFor(chars))} left in this chapter`;
}

/** Today's minutes, and nothing at all on a day he has not read. */
export function minutesTodayLine(seconds: number): string | null {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return null;
  return minutes === 1 ? '1 minute today' : `${minutes} minutes today`;
}

/** Card line when the exact last sentence is not known, with the percentage he is at. */
export function carryOnLine(percent: number | null): string {
  return percent ? `Carry on from where you stopped · ${Math.round(percent * 100)}%` : 'Carry on from where you stopped';
}
