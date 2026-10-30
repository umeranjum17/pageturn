// The one protocol between React Native and the reader WebView.
// React Native never parses book HTML: it sends bytes and settings in,
// and receives metadata, positions and taps out.

export type Justify = 'left' | 'justify';

export interface ReaderStyle {
  page: string;
  prose: string;
  secondary: string;
  accent: string;
  fontSize: number;
  lineHeight: number;
  margin: number;
  justify: Justify;
  dimImages: boolean;
}

export interface TocEntry {
  label: string;
  href: string;
  depth: number;
}

// React Native -> WebView
export type InMessage =
  | { type: 'load-begin'; total: number }
  | { type: 'load-chunk'; index: number; data: string }
  | {
      type: 'load-end';
      bookId: string;
      cfi: string | null;
      locations: string | null;
      style: ReaderStyle;
    }
  | { type: 'style'; style: ReaderStyle }
  | { type: 'goto'; target: string };

export interface Position {
  bookId: string;
  cfi: string;
  percent: number | null;
  chapter: string | null;
  chapterLeftChars: number | null;
  bookLeftChars: number | null;
  lastLine: string | null;
}

// WebView -> React Native
export type OutMessage =
  | { type: 'ready' }
  | {
      type: 'opened';
      bookId: string;
      title: string | null;
      author: string | null;
      cover: string | null;
      toc: TocEntry[];
    }
  | { type: 'locations'; bookId: string; locations: string }
  | ({ type: 'relocated' } & Position)
  | { type: 'tap' }
  | { type: 'activity' }
  | { type: 'error'; message: string };

export const CHUNK_SIZE = 256 * 1024;
export const CHARS_PER_LOCATION = 1024;

export function parseOutMessage(raw: string): OutMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (msg && typeof msg.type === 'string') return msg as OutMessage;
  } catch {
    // ignore malformed frames
  }
  return null;
}
