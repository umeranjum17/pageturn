// Time-left estimates and the automatic night/paper choice.

/** Characters read per minute: about 230 words a minute of English prose. */
export const CHARS_PER_MINUTE = 1300;

export function minutesFor(chars: number, charsPerMinute = CHARS_PER_MINUTE): number {
  return Math.max(0, Math.round(chars / charsPerMinute));
}

export function formatMinutes(minutes: number): string {
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export type ThemeName = 'night' | 'paper';
export type ThemeMode = 'auto' | ThemeName;

/** Night from 7 pm to 7 am local time, warm paper through the day. */
export function autoTheme(now: Date): ThemeName {
  const h = now.getHours();
  return h >= 19 || h < 7 ? 'night' : 'paper';
}

export function resolveTheme(mode: ThemeMode, now: Date): ThemeName {
  return mode === 'auto' ? autoTheme(now) : mode;
}

/** A gap longer than this brings back the way in, not a scolding. */
export const RESUME_GAP_MS = 2 * 60 * 60 * 1000;

export function shouldShowResume(lastReadAt: number | null, now: number): boolean {
  return lastReadAt !== null && now - lastReadAt >= RESUME_GAP_MS;
}

/** Split a sentence so its last few words can be set in the accent colour. */
export function splitTail(sentence: string, words = 3): [string, string] {
  const parts = sentence.trim().split(/\s+/);
  if (parts.length <= words) return ['', parts.join(' ')];
  return [parts.slice(0, -words).join(' ') + ' ', parts.slice(-words).join(' ')];
}

/**
 * The resume card's one line of prose: whole words only, the ending kept,
 * stray brackets dropped. Trimmed lines lead with an ellipsis before a whole word.
 */
export function fitLine(sentence: string, maxChars: number): string {
  let text = sentence.replace(/\s+/g, ' ').trim();
  if (text.startsWith('…')) text = text.slice(1).trim();
  // Brackets that open or close outside the excerpt are debris.
  text = text.replace(/^[[(]\s*(?![^[(]*[\])])/, '').replace(/(?<![[(][^\])]*)\s*[\])]$/, '');
  if (text.length <= maxChars) return text;
  const words = text.split(' ');
  let out = words[words.length - 1];
  for (let i = words.length - 2; i >= 0 && out.length + words[i].length + 2 <= maxChars; i--) {
    out = `${words[i]} ${out}`;
  }
  // Open on a word, never on a number or punctuation left over from the cut.
  out = out.replace(/^(?:[^\p{L}“"‘']*\p{N}[^ ]* )+/u, '').replace(/^[^\p{L}\p{N}“"‘']+/u, '');
  return `…${out}`;
}
