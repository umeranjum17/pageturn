// Live check of every public-domain catalogue endpoint this app reads.
// One line each: status, entries, next page. Network failures are printed, not
// swallowed, and make the run exit non-zero.
import { ENTRY_URL, USER_AGENT, bookshelfUrl, bookPage, listUrl, searchUrl, subjectUrl } from '../src/catalog/source.ts';
import { parseFeed } from '../src/catalog/opds.ts';

let failed = 0;

async function feed(name, url) {
  const label = name.padEnd(11);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    const body = await res.text();
    const feed = parseFeed(body);
    const first = feed.entries[0];
    console.log(
      `${label} ${res.status} entries=${feed.entries.length} next=${feed.next ? 'yes' : 'no'} ` +
        `first=${first ? `${first.title} (${first.id})` : '-'}`,
    );
    if (!res.ok) failed++;
    return feed;
  } catch (e) {
    failed++;
    console.log(`${label} FAILED ${e.message}`);
    return null;
  }
}

await feed('entry', ENTRY_URL);
await feed('popular', listUrl('downloads'));
await feed('latest', listUrl('release_date'));
await feed('random', listUrl('random'));
await feed('search', searchUrl('pride and prejudice'));
await feed('subjects', subjectUrl('science fiction'));
await feed('bookshelves', bookshelfUrl('best books'));

try {
  const book = await bookPage('1342');
  console.log(
    `book        1342 "${book.title}" by ${book.author} epub=${book.epub.split('/').pop()} ` +
      `cover=${book.cover ? 'yes' : 'no'} subjects=${book.categories.length} licence="${book.licence}"`,
  );
} catch (e) {
  failed++;
  console.log(`book        1342 FAILED ${e.message}`);
}

process.exit(failed ? 1 : 0);
