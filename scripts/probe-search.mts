// The live acceptance set for the book search: the words the captain types, and
// the book that must come back for them with a cover and an author. Run it with
// `npm run probe:search`. It asks the real sources, so it needs the network and
// it is not part of `npm test`.
import { searchBooks, type ResultEntry } from '../src/catalog/websearch.ts';

interface Case {
  query: string;
  title: string;
  author: string;
}

// Verified against Open Library on 2026-10-31 (numFound): clean code 178,
// domain driven design 76, designing data intensive applications 60,
// the pragmatic programmer 133, refactoring improving the design 13.
const ACCEPTANCE: Case[] = [
  { query: 'clean code', title: 'Clean Code', author: 'Robert C. Martin' },
  { query: 'domain driven design', title: 'Domain-Driven Design', author: 'Eric Evans' },
  { query: 'designing data intensive applications', title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann' },
  { query: 'the pragmatic programmer', title: 'The Pragmatic Programmer', author: 'Andy Hunt' },
  { query: 'refactoring improving the design', title: 'Refactoring', author: 'Martin Fowler' },
];

const NONSENSE = 'zzqx qwertyuiop nonexistent';
const problems: string[] = [];

function plain(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function find(entries: ResultEntry[], wanted: Case): ResultEntry | undefined {
  return entries.find(
    (book) => plain(book.title).startsWith(plain(wanted.title)) && plain(book.author ?? '').includes(plain(wanted.author).split(' ').pop() ?? ''),
  );
}

for (const wanted of ACCEPTANCE) {
  const { entries } = await searchBooks(wanted.query);
  const book = find(entries, wanted);
  const line = `${wanted.query}: ${entries.length} found`;
  if (!book) {
    problems.push(`${line}, but not "${wanted.title}" by ${wanted.author}`);
    console.log(`${line} — MISSING ${wanted.title}`);
    continue;
  }
  const cover = book.cover ? 'cover' : 'NO COVER';
  const author = book.author ?? 'NO AUTHOR';
  console.log(`${line} — ${book.title} / ${author} / ${cover}`);
  if (!book.cover) problems.push(`"${book.title}" came back with no cover`);
  if (!book.author) problems.push(`"${book.title}" came back with no author`);
  if (book.free) problems.push(`"${book.title}" claims a found book can be downloaded here`);
}

const none = await searchBooks(NONSENSE);
console.log(`${NONSENSE}: ${none.entries.length} found`);
if (none.entries.length) {
  problems.push(`a nonsense query found ${none.entries.length} books`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log('\nsearch probe: every acceptance query answers, a nonsense one finds nothing.');
