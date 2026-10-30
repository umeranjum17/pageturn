// Table of contents from the EPUB nav document.
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TocEntry } from '../reader/protocol';
import Sheet from './Sheet';
import { FONTS, TAP, type Palette, TEXT_SCALE_MAX } from './tokens';

interface Props {
  visible: boolean;
  palette: Palette;
  toc: TocEntry[];
  current: string | null;
  onPick(href: string): void;
  onClose(): void;
}

export default function Contents({ visible, palette, toc, current, onPick, onClose }: Props) {
  const index = Math.max(0, toc.findIndex((t) => t.label === current));
  return (
    <Sheet visible={visible} palette={palette} onClose={onClose} tall>
      <View style={styles.top}>
        <Text maxFontSizeMultiplier={1.1} style={[styles.heading, { color: palette.prose }]}>Contents</Text>
        <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button">
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, { color: palette.secondary }]}>Back to page</Text>
        </Pressable>
      </View>
      {toc.length === 0 ? (
        <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, { color: palette.secondary }]}>This book has no table of contents.</Text>
      ) : (
        <FlatList
          data={toc}
          initialScrollIndex={index > 3 ? index - 3 : 0}
          getItemLayout={(_, i) => ({ length: TAP + 4, offset: (TAP + 4) * i, index: i })}
          keyExtractor={(t, i) => `${i}:${t.href}`}
          renderItem={({ item }) => {
            const on = item.label === current;
            return (
              <Pressable
                onPress={() => onPick(item.href)}
                style={[styles.item, { paddingLeft: item.depth * 16, borderBottomColor: palette.rule }]}
                accessibilityRole="button"
              >
                <Text maxFontSizeMultiplier={1.1} numberOfLines={1} style={[styles.entry, { color: on ? palette.accent : palette.prose }]}>
                  {item.label || 'Untitled section'}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  heading: { fontFamily: FONTS.book, fontSize: 22, flexShrink: 1 },
  close: { minHeight: TAP, justifyContent: 'center' },
  small: { fontFamily: FONTS.ui, fontSize: 13 },
  item: { height: TAP + 4, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  entry: { fontFamily: FONTS.book, fontSize: 18 },
});
