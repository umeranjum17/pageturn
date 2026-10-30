import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Brightness from 'expo-brightness';
import { useFonts } from 'expo-font';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as NavigationBar from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as db from './src/db';
import { importEpub, ImportError, readBookBase64 } from './src/library';
import { dayKey, streakLength } from './src/lib/streak';
import { formatMinutes, minutesFor, resolveTheme, shouldShowResume } from './src/lib/time';
import type { OutMessage, Position, ReaderStyle, TocEntry } from './src/reader/protocol';
import ReaderView, { type ReaderHandle } from './src/reader/ReaderView';
import Contents from './src/ui/Contents';
import Controls from './src/ui/Controls';
import ResumeCard from './src/ui/ResumeCard';
import Shelf from './src/ui/Shelf';
import { FONTS, PALETTES, TAP, TEXT_SCALE_MAX } from './src/ui/tokens';

const TICK_MS = 15_000;
const ACTIVE_WINDOW_MS = 90_000;
const AWAKE_WINDOW_MS = 3 * 60_000;
// The bottom strip stays one calm line each, even at large system text sizes.
const STRIP_SCALE_MAX = 1.15;

export default function App() {
  const [fontsLoaded] = useFonts({
    'Manrope-Regular': require('./assets/fonts/Manrope-Regular.ttf'),
    'Manrope-SemiBold': require('./assets/fonts/Manrope-SemiBold.ttf'),
    'Newsreader-Regular': require('./assets/fonts/Newsreader-Regular.ttf'),
    'Newsreader-Italic': require('./assets/fonts/Newsreader-Italic.ttf'),
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  return (
    <SafeAreaProvider>
      <Reader />
    </SafeAreaProvider>
  );
}

function Reader() {
  const insets = useSafeAreaInsets();
  const reader = useRef<ReaderHandle>(null);
  const [books, setBooks] = useState<db.Book[]>(() => db.listBooks());
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const id = db.getCurrentBookId();
    return id && db.getBook(id) ? id : null;
  });
  const [prefs, setPrefsState] = useState<db.Prefs>(() => db.getPrefs());
  const [now, setNow] = useState(() => new Date());
  const [position, setPosition] = useState<Position | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [controls, setControls] = useState(false);
  const [contents, setContents] = useState(false);
  const [shelf, setShelf] = useState(false);
  const [resume, setResume] = useState(() => shouldShowResume(db.getLastReadAt(), Date.now()));
  const [brightness, setBrightness] = useState(prefs.brightness ?? 0.5);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(() => db.readingDays());

  const lastActivity = useRef(0);
  const awake = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookRef = useRef<string | null>(currentId);
  bookRef.current = currentId;

  const book = useMemo(() => books.find((b) => b.id === currentId) ?? null, [books, currentId]);
  const themeName = resolveTheme(prefs.themeMode, now);
  const palette = PALETTES[themeName];

  const style: ReaderStyle = useMemo(
    () => ({
      page: palette.page,
      prose: palette.prose,
      secondary: palette.secondary,
      accent: palette.accent,
      fontSize: prefs.fontSize,
      lineHeight: prefs.lineHeight,
      margin: prefs.margin,
      justify: prefs.justify,
      dimImages: themeName === 'night',
    }),
    [palette, prefs.fontSize, prefs.lineHeight, prefs.margin, prefs.justify, themeName],
  );
  const styleRef = useRef(style);
  styleRef.current = style;

  const refreshBooks = useCallback(() => setBooks(db.listBooks()), []);

  const openCurrent = useCallback(async () => {
    const id = bookRef.current;
    if (!id) return;
    const b = db.getBook(id);
    if (!b) return;
    setError(null);
    try {
      const base64 = await readBookBase64(b.path);
      if (bookRef.current !== id) return;
      reader.current?.open({ bookId: id, base64, cfi: b.cfi, locations: b.locations, style: styleRef.current });
      db.markOpened(id, Date.now());
    } catch {
      setError('This book could not be opened.');
    }
  }, []);

  // Open whenever the current book changes (the WebView reopens on 'ready' too).
  useEffect(() => {
    setPosition(null);
    setToc([]);
    if (currentId) openCurrent();
  }, [currentId, openCurrent]);

  useEffect(() => {
    reader.current?.setStyle(style);
  }, [style]);

  // Theme follows the clock when on auto; the clock also rolls the reading day.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palette.page).catch(() => undefined);
    try {
      NavigationBar.setStyle(themeName === 'night' ? 'dark' : 'light');
    } catch {
      // older Android: nothing to style
    }
  }, [palette.page, themeName]);

  useEffect(() => {
    if (prefs.brightness !== null) Brightness.setBrightnessAsync(prefs.brightness).catch(() => undefined);
    else Brightness.getBrightnessAsync().then(setBrightness).catch(() => undefined);
    // apply the stored value once on launch only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
    if (!awake.current) {
      awake.current = true;
      activateKeepAwakeAsync('reading').catch(() => undefined);
    }
  }, []);

  // Minutes read per day: count time while the app is open and the reader is
  // actually moving through the book.
  useEffect(() => {
    const t = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (awake.current && idle > AWAKE_WINDOW_MS) {
        awake.current = false;
        deactivateKeepAwake('reading');
      }
      if (AppState.currentState !== 'active' || !bookRef.current || idle > ACTIVE_WINDOW_MS) return;
      db.addReadingSeconds(new Date(), TICK_MS / 1000);
      setDays(db.readingDays());
    }, TICK_MS);
    return () => clearInterval(t);
  }, []);

  // Coming back after a long gap shows the resume card.
  useEffect(() => {
    let leftAt = Date.now();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        setNow(new Date());
        if (bookRef.current && shouldShowResume(Math.max(db.getLastReadAt() ?? 0, leftAt), Date.now())) {
          refreshBooks();
          setResume(true);
        }
      } else {
        leftAt = Date.now();
      }
    });
    return () => sub.remove();
  }, [refreshBooks]);

  const onMessage = useCallback(
    (msg: OutMessage) => {
      switch (msg.type) {
        case 'ready':
          openCurrent();
          break;
        case 'opened':
          if (msg.bookId !== bookRef.current) return;
          db.saveMetadata(msg.bookId, msg.title, msg.author, msg.cover);
          setToc(msg.toc);
          refreshBooks();
          break;
        case 'locations':
          db.saveLocations(msg.bookId, msg.locations);
          break;
        case 'relocated': {
          if (msg.bookId !== bookRef.current) return;
          setPosition(msg);
          markActive();
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            db.savePosition(msg.bookId, msg);
          }, 400);
          break;
        }
        case 'activity':
          markActive();
          break;
        case 'tap':
          markActive();
          setControls((v) => !v);
          break;
        case 'error':
          // Book quirks surface here; the reader keeps going.
          break;
      }
    },
    [markActive, openCurrent, refreshBooks],
  );

  const updatePrefs = useCallback((p: db.Prefs) => {
    setPrefsState(p);
    db.setPrefs(p);
  }, []);

  const onBrightness = useCallback(
    (v: number) => {
      setBrightness(v);
      Brightness.setBrightnessAsync(v).catch(() => undefined);
      updatePrefs({ ...db.getPrefs(), brightness: v });
    },
    [updatePrefs],
  );

  const openBook = useCallback(
    (id: string) => {
      setShelf(false);
      if (id === bookRef.current) return;
      db.setCurrentBookId(id);
      setCurrentId(id);
    },
    [],
  );

  const doImport = useCallback(async () => {
    setNotice(null);
    setImporting(true);
    try {
      const id = await importEpub();
      if (id) {
        refreshBooks();
        openBook(id);
      }
    } catch (e) {
      setNotice(e instanceof ImportError ? e.message : 'That file could not be imported.');
    } finally {
      setImporting(false);
    }
  }, [openBook, refreshBooks]);

  const today = dayKey(now);
  const minutesToday = Math.floor((days[today] ?? 0) / 60);
  const streak = streakLength(days, now);
  const percent = position?.percent ?? book?.percent ?? null;
  const bookLeft = position?.bookLeftChars;
  const chapterLeft = position?.chapterLeftChars;

  const meta = [
    percent !== null ? `${Math.round(percent * 100)}%` : null,
    bookLeft != null ? `${formatMinutes(minutesFor(bookLeft))} left` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const chapterMeta = chapterLeft != null ? `${formatMinutes(minutesFor(chapterLeft))} in chapter` : '';

  if (!book) {
    return (
      <View style={[styles.screen, { backgroundColor: palette.page, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <StatusBar style={palette.statusBar} />
        <View style={styles.first}>
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.wordmark, { color: palette.prose }]}>pageturn</Text>
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.firstCopy, { color: palette.secondary }]}>
            Bring a book in and it opens right here, at the first sentence.
          </Text>
          {notice ? <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.firstCopy, { color: palette.secondary }]}>{notice}</Text> : null}
          <Pressable
            onPress={doImport}
            disabled={importing}
            style={({ pressed }) => [styles.primary, { backgroundColor: palette.accent, opacity: pressed || importing ? 0.8 : 1 }]}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.primaryText, { color: palette.ink }]}>{importing ? 'Importing…' : 'Import an EPUB'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.page, paddingTop: insets.top }]}>
      <StatusBar style={palette.statusBar} />
      <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.runningHead, { color: palette.secondary }]} numberOfLines={1}>
        {book.title.toUpperCase()}
      </Text>
      <View style={styles.page}>
        <ReaderView ref={reader} background={palette.page} onMessage={onMessage} />
        {error ? (
          <View style={[styles.errorBox, { backgroundColor: palette.page }]}>
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.firstCopy, { color: palette.secondary }]}>{error}</Text>
          </View>
        ) : null}
      </View>
      <View style={[styles.colophon, { paddingBottom: insets.bottom }]}>
        <View
          style={[styles.progress, { backgroundColor: palette.rule }]}
          accessibilityRole="progressbar"
          accessibilityLabel="Book progress"
          accessibilityValue={{ min: 0, max: 100, now: Math.round((percent ?? 0) * 100) }}
        >
          <View style={{ width: `${(percent ?? 0) * 100}%`, height: 1, backgroundColor: palette.accent }} />
        </View>
        <Text maxFontSizeMultiplier={STRIP_SCALE_MAX} style={[styles.meta, { color: palette.secondary }]} numberOfLines={1}>
          {meta || ' '}
        </Text>
        <View style={styles.bottomLine}>
          {streak > 0 ? (
            <View style={styles.streak} accessibilityLabel={`${streak} day reading streak`}>
              <View style={[styles.streakDot, { backgroundColor: palette.accent }]} />
              <Text maxFontSizeMultiplier={STRIP_SCALE_MAX} style={[styles.streakText, { color: palette.accent }]}>{streak}</Text>
            </View>
          ) : (
            <View />
          )}
          <Text maxFontSizeMultiplier={STRIP_SCALE_MAX} style={[styles.meta, styles.chapterMeta, { color: palette.secondary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {chapterMeta}
          </Text>
          <Pressable onPress={() => setShelf(true)} style={styles.libraryLink} accessibilityRole="button" accessibilityLabel="Library">
            <Text maxFontSizeMultiplier={STRIP_SCALE_MAX} style={[styles.meta, { color: palette.secondary }]}>library</Text>
          </Pressable>
        </View>
      </View>

      <Controls
        visible={controls}
        palette={palette}
        prefs={prefs}
        brightness={brightness}
        onBrightness={onBrightness}
        onPrefs={updatePrefs}
        onContents={() => {
          setControls(false);
          setContents(true);
        }}
        onRecap={() => {
          setControls(false);
          refreshBooks();
          setResume(true);
        }}
        onClose={() => setControls(false)}
      />
      <Contents
        visible={contents}
        palette={palette}
        toc={toc}
        current={position?.chapter ?? null}
        onPick={(href) => {
          setContents(false);
          reader.current?.goto(href);
        }}
        onClose={() => setContents(false)}
      />
      <Shelf
        visible={shelf}
        palette={palette}
        books={books}
        currentId={currentId}
        importing={importing}
        notice={notice}
        onOpen={openBook}
        onImport={doImport}
        onClose={() => setShelf(false)}
      />
      <ResumeCard
        visible={resume && !shelf}
        palette={palette}
        book={book}
        minutesToday={minutesToday}
        onContinue={() => {
          setResume(false);
          markActive();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  runningHead: {
    fontFamily: FONTS.book,
    fontSize: 11,
    letterSpacing: 1.2,
    textAlign: 'center',
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: 24,
  },
  page: { flex: 1 },
  errorBox: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 32 },
  colophon: { paddingHorizontal: 32, paddingTop: 10 },
  progress: { height: 1, marginBottom: 10, overflow: 'hidden' },
  meta: { fontFamily: FONTS.ui, fontSize: 13, lineHeight: 19 },
  bottomLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TAP },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, minWidth: 32 },
  streakDot: { width: 6, height: 6, borderRadius: 3 },
  streakText: { fontFamily: FONTS.uiStrong, fontSize: 13 },
  chapterMeta: { flex: 1, textAlign: 'center', paddingHorizontal: 8 },
  libraryLink: { minHeight: TAP, minWidth: TAP, alignItems: 'flex-end', justifyContent: 'center' },
  first: { flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 20 },
  wordmark: { fontFamily: FONTS.book, fontSize: 40, letterSpacing: -1.6 },
  firstCopy: { fontFamily: FONTS.ui, fontSize: 15, lineHeight: 23 },
  primary: { minHeight: 52, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryText: { fontFamily: FONTS.uiStrong, fontSize: 15 },
});
