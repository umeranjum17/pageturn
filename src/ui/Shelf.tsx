// The shelf: reachable from the page, never the landing screen.
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Book } from '../db';
import Cover from './Cover';
import { FONTS, TAP, type Palette, TEXT_SCALE_MAX } from './tokens';

interface Props {
  visible: boolean;
  palette: Palette;
  books: Book[];
  currentId: string | null;
  importing: boolean;
  notice: string | null;
  onOpen(id: string): void;
  onImport(): void;
  onClose(): void;
}

export default function Shelf(p: Props) {
  const { palette } = p;
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={p.visible} animationType="slide" onRequestClose={p.onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.screen, { backgroundColor: palette.page, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.heading, { color: palette.prose }]}>Library</Text>
          {p.currentId ? (
            <Pressable onPress={p.onClose} style={styles.back} accessibilityRole="button">
              <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, { color: palette.secondary }]}>Back to page</Text>
            </Pressable>
          ) : null}
        </View>
        <FlatList
          data={p.books}
          keyExtractor={(b) => b.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const pct = Math.round((item.percent ?? 0) * 100);
            const reading = item.id === p.currentId;
            return (
              <Pressable
                onPress={() => p.onOpen(item.id)}
                style={({ pressed }) => [styles.row, { borderBottomColor: palette.rule, opacity: pressed ? 0.7 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}${item.author ? `, ${item.author}` : ''}, ${pct} percent read`}
              >
                <Cover title={item.title} author={item.author} palette={palette} width={56} />
                <View style={styles.details}>
                  <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.title, { color: palette.prose }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {item.author ? (
                    <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, { color: palette.secondary }]} numberOfLines={1}>
                      {item.author}
                    </Text>
                  ) : null}
                  <View style={[styles.bar, { backgroundColor: palette.rule }]}>
                    <View style={[styles.fill, { width: `${pct}%`, backgroundColor: palette.accent }]} />
                  </View>
                  <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, { color: palette.secondary }]}>
                    {reading ? `Reading now · ${pct}%` : item.cfi ? `${pct}% read` : 'Not started'}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.empty, { color: palette.secondary }]}>Your books will live here.</Text>
          }
        />
        {p.notice ? <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.notice, { color: palette.secondary }]}>{p.notice}</Text> : null}
        <Pressable
          onPress={p.onImport}
          disabled={p.importing}
          style={({ pressed }) => [styles.import, { backgroundColor: palette.accent, opacity: pressed || p.importing ? 0.75 : 1 }]}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.importText, { color: palette.ink }]}>{p.importing ? 'Importing…' : 'Import EPUB'}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TAP, marginBottom: 8 },
  heading: { fontFamily: FONTS.book, fontSize: 30 },
  back: { minHeight: TAP, justifyContent: 'center', paddingLeft: 16 },
  list: { paddingBottom: 16 },
  row: { flexDirection: 'row', gap: 16, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  details: { flex: 1, justifyContent: 'center', gap: 4 },
  title: { fontFamily: FONTS.book, fontSize: 20, lineHeight: 25 },
  small: { fontFamily: FONTS.ui, fontSize: 13, lineHeight: 19 },
  bar: { height: 2, borderRadius: 1, marginTop: 8, marginBottom: 2, overflow: 'hidden' },
  fill: { height: 2 },
  empty: { fontFamily: FONTS.ui, fontSize: 14, textAlign: 'center', marginTop: 48 },
  notice: { fontFamily: FONTS.ui, fontSize: 13, textAlign: 'center', marginBottom: 12 },
  import: { minHeight: 52, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  importText: { fontFamily: FONTS.uiStrong, fontSize: 15 },
});
