// Find books in the free catalogue or online, and put a whole free one on the shelf.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { downloadCatalogueBook } from '../catalog/download';
import type { CatalogueEntry } from '../catalog/opds';
import { SOURCE, bookPage, feed, listUrl, type SortOrder } from '../catalog/source';
import { freeEntry, readDescription, searchBooks, type ResultEntry } from '../catalog/websearch';
import * as db from '../db';
import Cover from './Cover';
import { FONTS, TAP, type Palette, TEXT_SCALE_MAX } from './tokens';

const GAP = 16;
const CARD_COVERS = 12;
const COVER_LIMIT = 4;
const SEARCH_DEBOUNCE_MS = 300;
const FAILED_DOWNLOAD = 'That download did not finish. Tap the book to try again.';

const ROWS: { key: SortOrder; label: string }[] = [
  { key: 'downloads', label: 'Popular' },
  { key: 'release_date', label: 'Latest' },
  { key: 'random', label: 'Random' },
];

const VIEWABILITY = { itemVisiblePercentThreshold: 20 };

interface Props {
  visible: boolean;
  palette: Palette;
  onOpen(bookId: string): void;
  onShelved(): void;
  onClose(): void;
}

interface CardState {
  busy?: boolean;
  failed?: boolean;
  shelf?: boolean;
}

interface Loaded {
  entries: ResultEntry[];
  failed: boolean;
}

// Covers are asked for by the cards the list actually draws, four at a time,
// and kept on disk by catalogue number so a second visit asks for nothing.
const coverFiles = new Map<string, string | null>();
const coverJobs = new Map<string, Promise<string | null>>();
let coverSlots = 0;
const coverQueue: (() => void)[] = [];

function loadCover(id: string): Promise<string | null> {
  const known = coverFiles.get(id);
  if (known !== undefined) return Promise.resolve(known);
  const running = coverJobs.get(id);
  if (running) return running;
  const job = (async () => {
    if (coverSlots >= COVER_LIMIT) await new Promise<void>((go) => coverQueue.push(go));
    coverSlots += 1;
    try {
      const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!dir) return null;
      const file = `${dir}cover-${id}.jpg`;
      if ((await FileSystem.getInfoAsync(file)).exists) return file;
      // The list feed only carries 22 px thumbnails; the book page has the cover.
      const page = await bookPage(id).catch(() => null);
      if (!page?.cover) return null;
      const got = await FileSystem.downloadAsync(page.cover, file);
      if (got.status !== 200) {
        await FileSystem.deleteAsync(got.uri, { idempotent: true }).catch(() => undefined);
        return null;
      }
      return got.uri;
    } finally {
      coverSlots -= 1;
      coverQueue.shift()?.();
    }
  })().catch(() => null);
  coverJobs.set(id, job);
  return job.then((uri) => {
    coverJobs.delete(id);
    coverFiles.set(id, uri);
    return uri;
  });
}

interface CardProps {
  entry: ResultEntry;
  palette: Palette;
  width: number;
  state: CardState;
  onPress(): void;
}

function BookCard({ entry, palette, width, state, onPress }: CardProps) {
  const [cover, setCover] = useState<string | null>(null);
  const [shelved, setShelved] = useState(false);
  const [blurb, setBlurb] = useState(entry.description);

  useEffect(() => {
    let live = true;
    setShelved(db.findBookBySource(SOURCE, entry.id) !== null);
    if (!entry.description && entry.descriptionUrl) readDescription(entry.descriptionUrl).then((text) => live && setBlurb(text));
    (entry.free ? loadCover(entry.id) : Promise.resolve(entry.cover)).then((uri) => {
      if (live && uri) setCover(uri);
    });
    return () => {
      live = false;
    };
  }, [entry.id]);

  const onShelf = state.shelf || shelved;
  const line = state.failed ? FAILED_DOWNLOAD : state.busy ? 'Downloading…' : onShelf ? 'On your shelf · tap to open' : null;

  return (
    <Pressable
      onPress={() => (entry.free ? onPress() : Linking.openURL(entry.store).catch(() => undefined))}
      disabled={state.busy}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}${entry.author ? `, ${entry.author}` : ''}`}
      accessibilityHint={entry.free ? (onShelf ? 'Opens this book' : 'Downloads this book') : 'Opens the store page'}
    >
      {/* The designed cover is drawn at once; the picture drops in on top of it. */}
      <View style={{ width, height: width * 1.5 }}>
        <Cover title={entry.title} author={entry.author} palette={palette} width={width} />
        {cover ? <Image source={{ uri: cover }} style={styles.coverImage} accessibilityIgnoresInvertColors /> : null}
      </View>
      <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} numberOfLines={2} style={[styles.cardTitle, { color: palette.prose }]}>
        {entry.title}
      </Text>
      {entry.author ? (
        <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} numberOfLines={1} style={[styles.cardSmall, { color: palette.secondary }]}>
          {entry.author}
        </Text>
      ) : null}
      {line ? (
        <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} numberOfLines={2} style={[styles.cardSmall, { color: state.failed ? palette.prose : palette.accent }]}>
          {line}
        </Text>
      ) : null}
      {entry.free ? null : (
        <Pressable onPress={() => Linking.openURL(entry.preview).catch(() => undefined)} hitSlop={14} accessibilityRole="link" accessibilityLabel={`Preview ${entry.title}`}>
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} numberOfLines={4} style={[styles.cardSmall, { color: palette.secondary }]}>
            {[blurb ?? entry.year, 'A copy bought there cannot be read in this app.'].filter(Boolean).join('\n')}
            <Text style={{ color: palette.accent }}>{'\nPreview'}</Text>
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

export default function Marketplace({ visible, palette, onOpen, onShelved, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(72, Math.floor((width - 48 - 2 * GAP) / 3));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Loaded | null>(null);
  const [sections, setSections] = useState<Partial<Record<SortOrder, Loaded>>>({});
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const started = useRef(new Set<string>());
  const term = query.trim();

  const load = useCallback((key: SortOrder) => {
    if (started.current.has(key)) return;
    started.current.add(key);
    feed(listUrl(key))
      .then((got) => setSections((s) => ({ ...s, [key]: { entries: got.entries.slice(0, CARD_COVERS).map(freeEntry), failed: false } })))
      .catch(() => {
        started.current.delete(key);
        setSections((s) => ({ ...s, [key]: { entries: [], failed: true } }));
      });
  }, []);

  // The first row loads on open; the others wait until they are on screen.
  useEffect(() => {
    if (visible) load('downloads');
    else {
      setQuery('');
      setResults(null);
    }
  }, [visible, load]);

  const onViewable = useRef((info: { viewableItems: { index?: number | null }[] }) => {
    for (const item of info.viewableItems) {
      const row = ROWS[item.index ?? -1];
      if (row) load(row.key);
    }
  }).current;

  // One request per query, once typing stops.
  useEffect(() => {
    if (!term) {
      setResults(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      searchBooks(term)
        .then((got) => {
          if (live) setResults({ entries: got.entries, failed: false });
        })
        .catch(() => {
          if (live) setResults({ entries: [], failed: true });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  const tap = useCallback(
    async (entry: CatalogueEntry) => {
      const known = db.findBookBySource(SOURCE, entry.id);
      if (known) {
        onOpen(known);
        return;
      }
      if (cards[entry.id]?.busy) return;
      setCards((c) => ({ ...c, [entry.id]: { busy: true } }));
      try {
        await downloadCatalogueBook(entry.id);
        setCards((c) => ({ ...c, [entry.id]: { shelf: true } }));
        onShelved();
      } catch {
        setCards((c) => ({ ...c, [entry.id]: { failed: true } }));
      }
    },
    [cards, onOpen, onShelved],
  );

  const card = (entry: ResultEntry) => (
    <BookCard entry={entry} palette={palette} width={cardWidth} state={cards[entry.id] ?? {}} onPress={() => tap(entry)} />
  );
  const muted = [styles.small, { color: palette.secondary }];
  const rowHeight = Math.round(cardWidth * 1.5) + 80;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.screen, { backgroundColor: palette.page, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.heading, { color: palette.prose }]}>
            Find books
          </Text>
          <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <View style={[styles.chevron, { borderColor: palette.secondary, transform: [{ rotate: '45deg' }] }]} />
          </Pressable>
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by title or author"
          placeholderTextColor={palette.secondary}
          maxFontSizeMultiplier={TEXT_SCALE_MAX}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search for a book"
          style={[styles.search, { color: palette.prose, borderBottomColor: palette.rule }]}
        />
        {term ? (
          <FlatList
            key="results"
            data={results?.entries ?? []}
            keyExtractor={(e) => e.id}
            numColumns={3}
            columnWrapperStyle={styles.grid}
            contentContainerStyle={styles.gridContent}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => card(item)}
            ListEmptyComponent={
              <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[...muted, styles.empty]}>
                {results?.failed
                  ? 'That search did not finish. Try again in a moment.'
                  : results
                    ? 'Nothing found. Try another spelling, or just the author.'
                    : 'Searching…'}
              </Text>
            }
          />
        ) : (
          <FlatList
            key="browse"
            data={ROWS}
            keyExtractor={(row) => row.key}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={VIEWABILITY}
            contentContainerStyle={styles.rows}
            renderItem={({ item }) => {
              const loaded = sections[item.key];
              return (
                <View style={styles.section}>
                  <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.sectionLabel, { color: palette.prose }]}>
                    {item.label}
                  </Text>
                  {loaded && loaded.entries.length ? (
                    <FlatList
                      horizontal
                      data={loaded.entries}
                      keyExtractor={(e) => e.id}
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.strip}
                      renderItem={({ item: e }) => card(e)}
                    />
                  ) : (
                    <View style={{ minHeight: rowHeight, justifyContent: 'center' }}>
                      <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={muted}>
                        {loaded?.failed ? 'Those books did not load.' : 'Loading…'}
                      </Text>
                    </View>
                  )}
                </View>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TAP, marginBottom: 4 },
  heading: { fontFamily: FONTS.book, fontSize: 30 },
  close: { width: TAP, height: TAP, alignItems: 'flex-end', justifyContent: 'center' },
  chevron: { width: 12, height: 12, borderLeftWidth: 1.5, borderBottomWidth: 1.5, marginRight: 4 },
  search: { fontFamily: FONTS.ui, fontSize: 15, minHeight: TAP, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth * 2, marginBottom: 8 },
  rows: { paddingBottom: 24 },
  section: { paddingTop: 16, gap: 10 },
  sectionLabel: { fontFamily: FONTS.book, fontSize: 20 },
  strip: { gap: GAP, paddingBottom: 4 },
  grid: { gap: GAP },
  gridContent: { gap: GAP * 1.25, paddingTop: 8, paddingBottom: 24 },
  cardTitle: { fontFamily: FONTS.book, fontSize: 15, lineHeight: 19, marginTop: 6 },
  cardSmall: { fontFamily: FONTS.ui, fontSize: 12, lineHeight: 17 },
  coverImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 2 },
  small: { fontFamily: FONTS.ui, fontSize: 13, lineHeight: 19 },
  empty: { textAlign: 'center', marginTop: 32 },
});
