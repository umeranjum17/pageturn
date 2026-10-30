// Your own lines from a book, newest first, each one a way back to its passage.
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Highlight } from '../db';
import { FONTS, TAP, type Palette, TEXT_SCALE_MAX } from './tokens';

interface Props {
  visible: boolean;
  palette: Palette;
  bookTitle: string;
  highlights: Highlight[];
  canJump(h: Highlight): boolean;
  onJump(h: Highlight): void;
  onClose(): void;
}

const CHEVRON = '›';

export default function Highlights(p: Props) {
  const { palette } = p;
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={p.visible} transparent statusBarTranslucent navigationBarTranslucent onRequestClose={p.onClose} animationType="fade">
      <Pressable style={styles.backdrop} onPress={p.onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.rule, bottom: insets.bottom + 16 }]}>
        <View style={[styles.grab, { backgroundColor: palette.rule }]} />
        <View style={styles.head}>
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} numberOfLines={1} style={[styles.heading, { color: palette.prose }]}>
            Highlights
          </Text>
          <Pressable onPress={p.onClose} style={styles.done} accessibilityRole="button">
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, { color: palette.secondary }]}>Done</Text>
          </Pressable>
        </View>
        <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} numberOfLines={1} style={[styles.count, { color: palette.secondary }]}>
          {p.highlights.length === 0
            ? 'No lines marked in this book'
            : `${p.highlights.length} ${p.highlights.length === 1 ? 'line' : 'lines'} from ${p.bookTitle} · newest first`}
        </Text>
        {p.highlights.length === 0 ? (
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.empty, { color: palette.secondary }]}>
            Import your Kindle clippings and they land here, attached to this book.
          </Text>
        ) : (
          <FlatList
            data={p.highlights}
            keyExtractor={(h) => h.id}
            bounces={false}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const jump = p.canJump(item);
              return (
                <Pressable
                  onPress={() => (jump ? p.onJump(item) : undefined)}
                  disabled={!jump}
                  style={[styles.row, { borderTopColor: palette.rule }]}
                  accessibilityRole="button"
                  accessibilityLabel={jump ? `Jump to this highlight: ${item.text.slice(0, 60)}` : item.text.slice(0, 60)}
                >
                  <View style={styles.rowMain}>
                    <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} numberOfLines={3} style={[styles.quote, { color: palette.prose }]}>
                      {item.text}
                    </Text>
                    <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} numberOfLines={1} style={[styles.locator, { color: palette.secondary }]}>
                      {item.locator ?? item.kind}
                      {jump ? '' : ' · not in this copy'}
                    </Text>
                  </View>
                  {jump ? <Text maxFontSizeMultiplier={1} style={[styles.go, { color: palette.secondary }]}>{CHEVRON}</Text> : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    position: 'absolute',
    left: 16,
    right: 16,
    maxHeight: '82%',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingBottom: 8,
    elevation: 12,
  },
  grab: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: 10, marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  heading: { fontFamily: FONTS.book, fontSize: 22 },
  // Main's review: this control was under 48px wide.
  done: { minWidth: TAP, minHeight: TAP, alignItems: 'flex-end', justifyContent: 'center' },
  small: { fontFamily: FONTS.ui, fontSize: 13 },
  count: { fontFamily: FONTS.ui, fontSize: 13, marginBottom: 4 },
  empty: { fontFamily: FONTS.book, fontSize: 18, lineHeight: 26, paddingVertical: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: TAP, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth * 2 },
  rowMain: { flex: 1, gap: 2 },
  quote: { fontFamily: FONTS.book, fontSize: 18, lineHeight: 26 },
  locator: { fontFamily: FONTS.ui, fontSize: 12 },
  go: { fontSize: 24, lineHeight: 26 },
});
