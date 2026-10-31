// Live check of the Google Books endpoints the Owned screen reads.
// The screen keeps its token in memory, so the token comes from the environment:
//
//   GOOGLE_BOOKS_TOKEN=<access token with the books scope> npm run probe:owned
//
// With no token it says so and exits 0. It never asks for, or carries, a password.
import { library, shelves, SCOPE } from '../src/owned/google.ts';

const token = process.env.GOOGLE_BOOKS_TOKEN ?? '';
if (!token) {
  console.log('skip        no GOOGLE_BOOKS_TOKEN set; this probe needs a token with the');
  console.log(`            ${SCOPE} scope. Nothing else here can read a private library.`);
  process.exit(0);
}

const API = 'https://www.googleapis.com/books/v1';
let failed = 0;

try {
  const res = await fetch(`${API}/mylibrary/bookshelves`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  console.log(`bookshelves ${res.status} bytes=${body.length}`);
  const list = shelves(JSON.parse(body));
  for (const shelf of list) console.log(`shelf       ${shelf.id} "${shelf.title}" volumes=${shelf.volumes}`);
  const one = list[0];
  if (one) {
    const url = `${API}/mylibrary/bookshelves/${one.id}/volumes?maxResults=40`;
    const volumesRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    console.log(`volumes     ${volumesRes.status} shelf=${one.id}`);
  }
  if (!res.ok) failed++;

  const all = await library(token);
  console.log(`library     ${all.length} volumes, ${all.filter((v) => v.download).length} downloadable here`);
  for (const v of all.slice(0, 10)) {
    console.log(`  ${v.download ? 'download' : 'open   '}  ${v.title}${v.author ? ` - ${v.author}` : ''}`);
  }
} catch (e) {
  failed++;
  console.log(`FAILED      ${e.message}`);
}

process.exit(failed ? 1 : 0);
