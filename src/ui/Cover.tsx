// A designed typographic cover in the warm palette, drawn from title and author.
import { StyleSheet, Text, View } from 'react-native';
import { FONTS, type Palette } from './tokens';

interface Props {
  title: string;
  author: string | null;
  palette: Palette;
  width?: number;
}

export default function Cover({ title, author, palette, width = 80 }: Props) {
  const k = width / 80;
  const words = title.toUpperCase().split(/\s+/).slice(0, 6);
  const longest = Math.max(...words.map((w) => w.length), 1);
  const titleSize = Math.min(12, 60 / longest) * k;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`${title}${author ? ` by ${author}` : ''}`}
      style={[styles.ground, { width, height: width * 1.5, backgroundColor: palette.cover }]}
    >
      <View style={[styles.spine, { left: 6 * k, borderColor: palette.coverRule }]} />
      <View
        style={[
          styles.frame,
          { top: 12 * k, bottom: 12 * k, left: 13 * k, right: 11 * k, borderColor: palette.coverRule },
        ]}
      >
        <View style={[styles.diamond, { width: 8 * k, height: 8 * k, borderColor: palette.coverRule, marginTop: 6 * k }]} />
        <View style={styles.titleBox}>
          {words.map((w, i) => (
            <Text maxFontSizeMultiplier={1}
              key={i}
              numberOfLines={1}
              style={{ fontFamily: FONTS.book, color: palette.coverInk, fontSize: titleSize, letterSpacing: 0.6 * k, lineHeight: titleSize * 1.25 }}
            >
              {w}
            </Text>
          ))}
        </View>
        <View style={[styles.rule, { backgroundColor: palette.coverRule, width: 42 * k }]} />
        {author ? (
          <Text maxFontSizeMultiplier={1}
            numberOfLines={2}
            style={{
              fontFamily: FONTS.book,
              color: palette.coverInk,
              fontSize: 5.6 * k,
              letterSpacing: 0.6 * k,
              textAlign: 'center',
              marginTop: 4 * k,
              marginBottom: 6 * k,
              paddingHorizontal: 3 * k,
            }}
          >
            {author.toUpperCase()}
          </Text>
        ) : (
          <View style={{ height: 10 * k }} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { borderRadius: 2, overflow: 'hidden' },
  spine: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: StyleSheet.hairlineWidth * 2 },
  frame: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth * 2, alignItems: 'center' },
  diamond: { transform: [{ rotate: '45deg' }], borderWidth: StyleSheet.hairlineWidth * 2 },
  titleBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  rule: { height: StyleSheet.hairlineWidth * 2 },
});
