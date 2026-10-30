// Colours and type from the approved design (option-2f): OLED night, warm paper.
import type { ThemeName } from '../lib/time';

export interface Palette {
  page: string;
  prose: string;
  secondary: string;
  surface: string;
  rule: string;
  accent: string;
  ink: string;
  scrim: string;
  cover: string;
  coverInk: string;
  coverRule: string;
  statusBar: 'light' | 'dark';
}

export const PALETTES: Record<ThemeName, Palette> = {
  night: {
    page: '#000000',
    prose: '#e6e0d5',
    secondary: '#b3b4aa',
    surface: '#161b19',
    rule: '#343c37',
    accent: '#c5ad7a',
    ink: '#15170f',
    scrim: 'rgba(0,0,0,0.72)',
    cover: '#ad7547',
    coverInk: '#fff3db',
    coverRule: '#eed1a6',
    statusBar: 'light',
  },
  paper: {
    page: '#f4ecdc',
    prose: '#302a21',
    secondary: '#655b4b',
    surface: '#fcf5e8',
    rule: '#c9bda6',
    accent: '#806330',
    ink: '#fff9ec',
    scrim: 'rgba(244,236,220,0.78)',
    cover: '#b77c48',
    coverInk: '#fff3db',
    coverRule: '#eed1a6',
    statusBar: 'dark',
  },
};

export const FONTS = {
  ui: 'Manrope-Regular',
  uiStrong: 'Manrope-SemiBold',
  book: 'Newsreader-Regular',
  bookItalic: 'Newsreader-Italic',
};

/** Minimum touch target, in dp. */
export const TAP = 48;

/** System font scaling is honoured up to this factor so the page chrome keeps its shape. */
export const TEXT_SCALE_MAX = 1.3;
