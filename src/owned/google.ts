// Google Books "My Library": the installed-app sign-in and the shelf reads.
// Nothing here touches the phone - the browser and the download live in
// ./Owned.tsx - so every parser below loads in a plain node test.

export const SCOPE = 'https://www.googleapis.com/auth/books';
export const REDIRECT = 'pageturn://oauth2redirect';
/** Recorded against a volume that came from Google, so it is never fetched twice. */
export const GOOGLE_SOURCE = 'google-books';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/books/v1';

export class GoogleError extends Error {}

/** One book on the account's shelves, as the shelf screen needs it. */
export interface Volume {
  /** Google's own volume id: stable across shelves and in the store link. */
  id: string;
  title: string;
  author: string | null;
  cover: string | null;
  /** An EPUB we may keep: only when Google offers it and does not restrict it. */
  download: string | null;
  /** Where Google's own reader shows this book. */
  webReader: string | null;
}

export interface Bookshelf {
  id: string;
  title: string;
  volumes: number;
}

export interface SignIn {
  /** The consent page to open. */
  url: string;
  verifier: string;
  state: string;
}

export interface Token {
  access: string;
  expiresAt: number;
}

type Json = Record<string, any>;

/** Where the store page for a volume is: one tap when it cannot come here. */
export function playUrl(id: string): string {
  return `https://play.google.com/store/books/details?id=${encodeURIComponent(id)}`;
}

function items(json: unknown): Json[] {
  const list = (json as Json | null)?.items;
  return Array.isArray(list) ? (list as Json[]) : [];
}

/**
 * Volumes out of a `volumes.list` answer. A book is only a file we may keep when
 * Google offers a download and its own download access says it is unrestricted;
 * every other volume is a cover with a way into Google's reader.
 */
export function volumes(json: unknown): Volume[] {
  return items(json).flatMap((v) => {
    const info = (v.volumeInfo ?? {}) as Json;
    const access = (v.accessInfo ?? {}) as Json;
    if (typeof v.id !== 'string' || typeof info.title !== 'string') return [];
    const epub = access.epub as Json | undefined;
    const thumb = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail;
    const free = access.downloadAccess?.restricted === false && typeof epub?.downloadLink === 'string';
    return [
      {
        id: v.id,
        title: info.title,
        author: Array.isArray(info.authors) && info.authors.length ? String(info.authors[0]) : null,
        // The API still hands out http covers; the app only talks https.
        cover: typeof thumb === 'string' ? thumb.replace(/^http:/, 'https:') : null,
        download: free ? String(epub?.downloadLink) : null,
        webReader: typeof access.webReaderLink === 'string' ? access.webReaderLink : null,
      },
    ];
  });
}

/** The shelves worth asking: the ones that hold something. */
export function shelves(json: unknown): Bookshelf[] {
  return items(json)
    .filter((s) => Number(s.volumeCount) > 0)
    .map((s) => ({ id: String(s.id), title: String(s.title ?? ''), volumes: Number(s.volumeCount) }));
}

async function get(url: string, token: string, f: typeof fetch): Promise<unknown> {
  const res = await f(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new GoogleError('Google asked for the account again.');
  if (!res.ok) throw new GoogleError(`Google answered ${res.status}.`);
  return (await res.json()) as unknown;
}

/**
 * Every volume on the account's shelves, once each. A purchase can appear on
 * more than one shelf, so duplicates collapse by volume id, first shelf winning.
 */
export async function library(token: string, f: typeof fetch = fetch): Promise<Volume[]> {
  const out: Volume[] = [];
  const seen = new Set<string>();
  for (const shelf of shelves(await get(`${API}/mylibrary/bookshelves`, token, f)).slice(0, 12)) {
    const url = `${API}/mylibrary/bookshelves/${encodeURIComponent(shelf.id)}/volumes?maxResults=40`;
    for (const v of volumes(await get(url, token, f))) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
  }
  return out;
}

// The query is built by hand: it has to be exact, and Hermes' URLSearchParams is
// not the place to find out at runtime. No client secret: this is an installed app.
export function authUrl(o: { clientId: string; state: string; challenge: string; redirect?: string }): string {
  const pairs: [string, string][] = [
    ['client_id', o.clientId],
    ['redirect_uri', o.redirect ?? REDIRECT],
    ['response_type', 'code'],
    ['scope', SCOPE],
    ['code_challenge', o.challenge],
    ['code_challenge_method', 'S256'],
    ['state', o.state],
  ];
  return `${AUTH}?${pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

function query(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const at = url.indexOf('?');
  if (at < 0) return out;
  for (const part of url.slice(at + 1).split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = decodeURIComponent(eq < 0 ? part : part.slice(0, eq));
    out[key] = decodeURIComponent((eq < 0 ? '' : part.slice(eq + 1)).replace(/\+/g, ' '));
  }
  return out;
}

/** The code Google sent back, but only for the state this sign-in started. */
export function codeFrom(url: string, state: string): string | null {
  const q = query(url);
  return q.code && q.state === state ? q.code : null;
}

/** Starts PKCE: a fresh verifier, its S256 challenge, and the consent page. */
export async function begin(clientId: string): Promise<SignIn> {
  const Crypto = await import('expo-crypto');
  // Two uuids of hex, minus the dashes: 64 unreserved characters, 244 random bits.
  const verifier = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, '');
  const state = Crypto.randomUUID().replace(/-/g, '');
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const challenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { url: authUrl({ clientId, state, challenge }), verifier, state };
}

/** The code for a token, still without a secret. */
export async function exchange(o: {
  clientId: string;
  code: string;
  verifier: string;
  redirect?: string;
  fetch?: typeof fetch;
}): Promise<Token> {
  const f = o.fetch ?? fetch;
  const body = [
    ['client_id', o.clientId],
    ['code', o.code],
    ['code_verifier', o.verifier],
    ['grant_type', 'authorization_code'],
    ['redirect_uri', o.redirect ?? REDIRECT],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const res = await f(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new GoogleError(
      typeof json.error_description === 'string' ? json.error_description : `Google answered ${res.status}.`,
    );
  }
  return { access: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000 };
}
