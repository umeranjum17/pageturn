import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authUrl,
  codeFrom,
  exchange,
  library,
  playUrl,
  REDIRECT,
  SCOPE,
  shelves,
  volumes,
} from '../src/owned/google.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// A `volumes.list` answer in the shape Google publishes: one sample the account
// keeps behind its own DRM (an ACS token, so no file for us) and one purchase
// that offers a plain EPUB and says its download is not restricted. The live
// Books endpoint answered 429 quota-exceeded from this machine, so this is the
// published shape rather than a capture of the owner's own shelf.
const recorded = JSON.parse(readFileSync(join(root, 'test/fixtures/google-volumes.json'), 'utf8'));

test('a shelf answer names the book, its cover and whether it can be kept', () => {
  const [sample, bought] = volumes(recorded);
  assert.equal(sample.title, 'Pride and Prejudice');
  assert.equal(sample.author, 'Jane Austen');
  // The API still hands out http covers; the app only talks https.
  assert.match(sample.cover!, /^https:\/\/books\.google\.com\//);
  assert.equal(sample.download, null, 'an ACS token is a lock, not a file');
  assert.match(sample.webReader!, /play\.google\.com\/books\/reader/);

  assert.equal(bought.download, 'https://books.google.com/books/download/The_Yellow_Wallpaper.epub?format=epub&id=Q2ZEEAAAQBAJ&output=json');
  assert.equal(bought.author, 'Charlotte Perkins Gilman');
});

test('a restricted download is never offered as a file', () => {
  const [one] = volumes({
    items: [
      {
        id: 'x',
        volumeInfo: { title: 'Bought, but locked' },
        accessInfo: {
          epub: { isAvailable: true, downloadLink: 'https://example.test/x.epub' },
          downloadAccess: { restricted: true },
          accessViewStatus: 'FULL_PURCHASED',
        },
      },
    ],
  });
  assert.equal(one.download, null);
  assert.equal(one.cover, null);
});

test('nothing at all, or nonsense, is an empty shelf rather than a crash', () => {
  assert.deepEqual(volumes({}), []);
  assert.deepEqual(volumes(null), []);
  assert.deepEqual(volumes({ items: [{ volumeInfo: {} }] }), []);
  assert.deepEqual(volumes('nonsense'), []);
  assert.deepEqual(shelves({ items: [] }), []);
});

test('only shelves that hold something are read, with ids kept as strings', () => {
  const list = shelves({
    items: [
      { id: 0, title: 'Favorites', volumeCount: 3, access: 'PRIVATE' },
      { id: 3, title: 'Reading now', volumeCount: 0, access: 'PRIVATE' },
      { id: 4, title: 'To read', volumeCount: 12, access: 'PRIVATE' },
    ],
  });
  assert.deepEqual(list.map((s) => s.id), ['0', '4']);
});

test('the library reads every shelf, de-duplicates by volume id and sends the token', async () => {
  const seen: string[] = [];
  const f = (async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push(`${url} ${init?.headers?.Authorization ?? ''}`);
    const body = url.endsWith('/bookshelves')
      ? { items: [{ id: 0, volumeCount: 2 }, { id: 4, volumeCount: 2 }] }
      : url.includes('/bookshelves/0/')
        ? { items: [{ id: 'a', volumeInfo: { title: 'A' } }, { id: 'b', volumeInfo: { title: 'B' } }] }
        : { items: [{ id: 'b', volumeInfo: { title: 'B' } }, { id: 'c', volumeInfo: { title: 'C' } }] };
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;

  const got = await library('tok', f);
  assert.deepEqual(got.map((v) => v.id), ['a', 'b', 'c']);
  assert.equal(seen[0].endsWith('Bearer tok'), true);
  assert.match(seen[1], /bookshelves\/0\/volumes\?maxResults=40/);
});

test('the consent url asks for the books scope and nothing else, with no secret', () => {
  const url = authUrl({ clientId: 'abc.apps.googleusercontent.com', state: 'st', challenge: 'ch' });
  assert.ok(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.ok(url.includes(`scope=${encodeURIComponent(SCOPE)}`));
  assert.ok(url.includes(`redirect_uri=${encodeURIComponent(REDIRECT)}`));
  assert.ok(url.includes('code_challenge_method=S256'));
  assert.equal(url.includes('client_secret'), false);
  assert.equal(url.split('scope=')[1].split('&')[0], 'https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fbooks');
});

test('the code is only taken when it comes back with our own state', () => {
  assert.equal(codeFrom('pageturn://oauth2redirect?code=c1&state=st', 'st'), 'c1');
  assert.equal(codeFrom('pageturn://oauth2redirect?code=c1&state=other', 'st'), null);
  assert.equal(codeFrom('pageturn://oauth2redirect?error=access_denied&state=st', 'st'), null);
  assert.equal(codeFrom('pageturn://oauth2redirect', 'st'), null);
});

test('the token exchange posts the verifier and no client secret', async () => {
  let sent = '';
  const f = (async (_url: string, init: { body: string }) => {
    sent = init.body;
    return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3599 }) };
  }) as unknown as typeof fetch;

  const token = await exchange({ clientId: 'abc', code: 'c1', verifier: 'v1', fetch: f });
  assert.equal(token.access, 'at');
  assert.ok(token.expiresAt > Date.now());
  assert.ok(sent.includes('code_verifier=v1'));
  assert.ok(sent.includes('grant_type=authorization_code'));
  assert.equal(sent.includes('client_secret'), false);

  const bad = (async () => ({ ok: false, status: 400, json: async () => ({ error_description: 'Bad code' }) })) as unknown as typeof fetch;
  await assert.rejects(() => exchange({ clientId: 'abc', code: 'c1', verifier: 'v1', fetch: bad }), /Bad code/);
});

test('a play link is the store page for that volume', () => {
  assert.equal(playUrl('Q2ZEEAAAQBAJ'), 'https://play.google.com/store/books/details?id=Q2ZEEAAAQBAJ');
});

test('the owned tables are two new tables that round-trip a row', () => {
  const store = readFileSync(join(root, 'src/owned/store.ts'), 'utf8');
  const ddl = store.match(/CREATE TABLE IF NOT EXISTS \w+ \([\s\S]*?\);/g) ?? [];
  assert.equal(ddl.length, 2);
  // Never an ALTER: the existing books, highlights and settings tables are untouched.
  assert.equal(/ALTER TABLE/.test(store), false);

  const db = new DatabaseSync(':memory:');
  for (const statement of ddl) db.exec(statement);

  db.prepare('INSERT INTO owned_elsewhere (id, title, author, cover, added_at) VALUES (?, ?, ?, ?, ?)').run(
    'k1',
    'A Kindle Book',
    'An Author',
    null,
    1,
  );
  const mine = db.prepare('SELECT * FROM owned_elsewhere').get() as { title: string; author: string };
  assert.equal(mine.title, 'A Kindle Book');

  db.prepare(
    'INSERT INTO google_volume (volume_id, title, author, cover, download, web_reader, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('v1', 'Vol', null, null, null, 'https://example.test/read', 2);
  const cached = db.prepare('SELECT * FROM google_volume').get() as { volume_id: string; download: string | null };
  assert.equal(cached.volume_id, 'v1');
  assert.equal(cached.download, null);
});
