// The catalogue: browse it, search it, and put a whole book on the shelf.
// Reached from the library; one tap on a book downloads it.
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
import { SOURCE as ARCHIVE, hitOf, searchArchive, type Hit } from '../catalog/archive';
import { deviceShelf, downloadCatalogueBook, shelve } from '../catalog/download';
import type { CatalogueEntry } from '../catalog/opds';
import { SOURCE, bookPage, feed, listUrl, searchUrl, type SortOrder } from '../catalog/source';
import * as db from '../db';
import Cover from './Cover';
import { FONTS, TAP, type Palette, TEXT_SCALE_MAX } from './tokens';

const GAP = 16;
const CARD_COVERS = 12;
const COVER_LIMIT = 4;
const SEARCH_DEBOUNCE_MS = 400;
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
  entries: Hit[];
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
  entry: Hit;
  palette: Palette;
  width: number;
  state: CardState;
  onPress(): void;
}

function BookCard({ entry, palette, width, state, onPress }: CardProps) {
  const [cover, setCover] = useState<string | null>(null);
  const [shelved, setShelved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setShelved(db.findBookBySource(entry.torrent ? ARCHIVE : SOURCE, entry.id) !== null);
    loadCover(entry.id).then((uri) => {
      if (live && uri) setCover(uri);
    });
    return () => {
      live = false;
    };
  }, [entry.id, entry.torrent]);

  // The phone's own torrent client takes it, or the link is printed to copy.
  const openTorrent = () => Linking.openURL(entry.torrent!).catch(() => setNotice(`No torrent app. Copy this link: ${entry.torrent}`));

  const onShelf = state.shelf || shelved;
  const line = state.failed ? FAILED_DOWNLOAD : state.busy ? 'Downloading…' : onShelf ? 'On your shelf · tap to open' : null;

  return (
    <Pressable
      onPress={entry.torrent && !entry.book ? openTorrent : onPress}
      disabled={state.busy}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}${entry.author ? `, ${entry.author}` : ''}`}
      accessibilityHint={onShelf ? 'Opens this book' : 'Downloads this book'}
    >
      {/* The designed cover is drawn at once; the picture drops in on top of it. */}
      <View style={{ width, height: width * 1.5 }}>
        <Cover title={entry.title} author={entry.author} palette={palette} width={width} />
        {cover ?? entry.cover ? <Image source={{ uri: (cover ?? entry.cover)! }} style={styles.coverImage} accessibilityIgnoresInvertColors /> : null}
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
      {entry.licence || entry.torrent ? (
        <Pressable onPress={entry.torrent ? openTorrent : undefined} hitSlop={10} accessibilityRole={entry.torrent ? 'link' : 'text'} accessibilityLabel={entry.torrent ? `Torrent for ${entry.title}` : undefined}><Text selectable maxFontSizeMultiplier={TEXT_SCALE_MAX} numberOfLines={2} style={[styles.cardSmall, { color: palette.accent }]}>{notice ?? [entry.licence, entry.torrent && 'Torrent'].filter(Boolean).join(' · ')}</Text></Pressable>
      ) : null}
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
      .then((got) => setSections((s) => ({ ...s, [key]: { entries: got.entries.slice(0, CARD_COVERS), failed: false } })))
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
    setResults(null);
    const timer = setTimeout(() => {
      feed(searchUrl(term))
        .then((got) => {
          if (live) setResults((was) => ({ entries: [...got.entries, ...(was?.entries ?? [])], failed: false }));
        })
        .catch(() => {
          if (live) setResults({ entries: [], failed: true });
        });
      searchArchive(term).then((found) => {
        if (live && found.hits.length) setResults((was) => ({ entries: [...(was?.entries ?? []), ...found.hits.map(hitOf)], failed: false }));
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  const tap = useCallback(
    async (entry: Hit) => {
      const known = db.findBookBySource(entry.torrent ? ARCHIVE : SOURCE, entry.id);
      if (known) {
        onOpen(known);
        return;
      }
      if (cards[entry.id]?.busy) return;
      setCards((c) => ({ ...c, [entry.id]: { busy: true } }));
      try {
        await (entry.book ? shelve(entry.book, await deviceShelf()) : downloadCatalogueBook(entry.id));
        setCards((c) => ({ ...c, [entry.id]: { shelf: true } }));
        onShelved();
      } catch {
        setCards((c) => ({ ...c, [entry.id]: { failed: true } }));
      }
    },
    [cards, onOpen, onShelved],
  );

  const card = (entry: Hit) => (
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
          accessibilityLabel="Search the catalogue"
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
                    ? 'No openly licensed books matched that word.'
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
