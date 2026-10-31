// Atom/OPDS reading for the public-domain catalogue.
// Hand-written: Hermes has no DOMParser, and one feed shape does not justify an
// XML dependency. Attribute order, self-closing tags, entities and CRLF all vary
// in the wild, so nothing here assumes a fixed layout.

export interface CatalogueEntry {
  /** The catalogue's own book number, e.g. "1342". */
  id: string;
  title: string;
  author: string | null;
}

export interface CatalogueFeed {
  entries: CatalogueEntry[];
  /** The feed's own next-page href, resolved by the caller. There is no total count. */
  next: string | null;
}

export interface Acquisition {
  type: string;
  title: string;
  /** Bytes, when the catalogue declares a size. */
  length: number | null;
  href: string;
}

export interface BookPage {
  title: string;
  author: string | null;
  licence: string | null;
  cover: string | null;
  categories: string[];
  /** The download for a phone: plain text EPUB over the illustrated edition. */
  epub: Acquisition | null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

type Attrs = Record<string, string>;

function attributes(tag: string): Attrs {
  const out: Attrs = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return out;
}

/** Every `<name ...>` tag in the text, attributes parsed; order is never assumed. */
function tags(xml: string, name: string): Attrs[] {
  return [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => attributes(m[0]));
}

/** The inner text of every `<name>...</name>` block. */
function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
}

function inner(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).trim() : null;
}

const BOOK_HREF = /\/ebooks\/(\d+)\.opds/;

export function parseFeed(xml: string): CatalogueFeed {
  const entries: CatalogueEntry[] = [];
  for (const entry of blocks(xml, 'entry')) {
    let id: string | null = null;
    for (const link of tags(entry, 'link')) {
      if (link.rel !== 'subsection' || !link.href) continue;
      const m = BOOK_HREF.exec(link.href);
      if (m) {
        id = m[1];
        break;
      }
    }
    const title = inner(entry, 'title');
    // Navigation entries point at more feeds; only a book subsection is a book.
    if (!id || !title) continue;
    const content = entry.match(/<content\b([^>]*)>([\s\S]*?)<\/content>/);
    const author =
      content && /type\s*=\s*["']text["']/.test(content[1])
        ? decodeEntities(content[2]).trim() || null
        : null;
    entries.push({ id, title, author });
  }
  return { entries, next: nextPage(xml) };
}

export function nextPage(xml: string): string | null {
  for (const link of tags(xml, 'link')) {
    if (link.rel === 'next' && link.href) return link.href;
  }
  return null;
}

export function acquisitions(xml: string): Acquisition[] {
  return tags(xml, 'link')
    .filter((l) => l.rel === 'http://opds-spec.org/acquisition' && l.type && l.href)
    .map((l) => ({
      type: l.type,
      title: l.title ?? '',
      length: l.length && /^\d+$/.test(l.length) ? Number(l.length) : null,
      href: l.href,
    }));
}

/**
 * A phone gets the plain text edition: the illustrated one is 24 MB, and the
 * catalogue marks the small ones "no images". Falls back to the smallest EPUB.
 */
export function chooseEpub(list: Acquisition[]): Acquisition | null {
  const epubs = list.filter((a) => a.type === 'application/epub+zip');
  if (!epubs.length) return null;
  const plain = epubs.filter((a) => /no images/i.test(a.title));
  const pool = plain.length ? plain : epubs;
  return pool.reduce((best, a) => ((a.length ?? Infinity) < (best.length ?? Infinity) ? a : best));
}

export function parseBookPage(xml: string): BookPage {
  // The first entry carries the plain-text editions; the feed keeps the same
  // links again outside it on some responses, so both places are read.
  const entry = blocks(xml, 'entry')[0] ?? xml;
  const authorBlock = entry.match(/<author\b[^>]*>([\s\S]*?)<\/author>/);
  const images = tags(xml, 'link').filter(
    (l) => l.rel?.startsWith('http://opds-spec.org/image') && l.href,
  );
  const cover = images.find((l) => l.rel === 'http://opds-spec.org/image') ?? images[0];
  return {
    title: inner(entry, 'title') ?? inner(xml, 'title') ?? '',
    author: authorBlock ? inner(authorBlock[1], 'name') : null,
    licence: inner(entry, 'rights') ?? inner(xml, 'rights'),
    cover: cover ? cover.href : null,
    // Subject headings the catalogue actually prints; the LCC codes are not them.
    categories: tags(entry, 'category')
      .filter((c) => (c.scheme ?? '').endsWith('/LCSH') && c.term)
      .map((c) => c.term),
    epub: chooseEpub(acquisitions(xml)),
  };
}
