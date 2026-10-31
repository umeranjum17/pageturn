// Live check of the Internet Archive source: what one query finds, what the
// licence filter admits, and what it refused. Nothing is swallowed: a network
// failure is printed and makes the run exit non-zero.
import { searchArchive } from '../src/catalog/archive.ts';

const QUERIES = ['pride and prejudice', 'aesop fables', 'meditations aurelius'];

let failed = 0;

for (const query of QUERIES) {
  const label = `"${query}"`.padEnd(26);
  try {
    const { hits, found, skipped, notBooks } = await searchArchive(query);
    const first = hits[0];
    console.log(
      `${label} found=${found} included=${hits.length} skipped-by-licence=${skipped} ` +
        `not-a-book=${notBooks}`,
    );
    if (first) {
      console.log(`  ${first.licence} · "${first.title}" · file=${first.file ? first.file.url.split('%2F').pop() : 'none'}`);
      console.log(`  torrent=${first.torrent}`);
    }
  } catch (e) {
    failed++;
    console.log(`${label} FAILED ${e.message}`);
  }
}

process.exit(failed ? 1 : 0);
