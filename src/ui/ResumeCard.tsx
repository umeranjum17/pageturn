// Shown when the app opens after a long gap: an easy way back into the sentence.
import { Modal, PixelRatio, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Book } from '../db';
import { fitLine, splitTail } from '../lib/time';
import Cover from './Cover';
import { FONTS, type Palette } from './tokens';

// The card must fit one screen even at the largest system text size.
const CARD_SCALE_MAX = 1.1;
// Card inset (16 each side), padding (24 each side) and border.
const CARD_CHROME = 82;
const TRACE_SIZE = 18;
// Average glyph width of the italic serif (measured about 0.30em), with room to spare.
const TRACE_EM = 0.34;

interface Props {
  visible: boolean;
  palette: Palette;
  book: Book;
  minutesToday: number;
  onContinue(): void;
}

function context(chapter: string | null): string {
  if (!chapter) return 'You stopped mid-chapter.';
  const short = chapter.replace(/\s+/g, ' ').trim();
  return short.length <= 24 ? `You stopped in ${short}` : 'You stopped mid-chapter.';
}

export default function ResumeCard({ visible, palette, book, minutesToday, onContinue }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const size = TRACE_SIZE * Math.min(PixelRatio.getFontScale(), CARD_SCALE_MAX);
  const line = fitLine(book.lastLine ?? '', Math.floor((width - CARD_CHROME) / (size * TRACE_EM)));
  const [lead, tail] = splitTail(line);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onContinue} statusBarTranslucent navigationBarTranslucent>
      <View style={[styles.scrim, { backgroundColor: palette.scrim }]} />
      <View
        style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.rule, bottom: insets.bottom + 40 }]}
        accessibilityViewIsModal
      >
        <View style={styles.identity}>
          <Cover title={book.title} author={book.author} palette={palette} width={64} />
          <View style={styles.details}>
            <Text maxFontSizeMultiplier={CARD_SCALE_MAX} style={[styles.title, { color: palette.prose }]} numberOfLines={3}>
              {book.title}
            </Text>
            {book.author ? (
              <Text maxFontSizeMultiplier={CARD_SCALE_MAX} style={[styles.author, { color: palette.secondary }]} numberOfLines={1}>
                {book.author}
              </Text>
            ) : null}
          </View>
        </View>
        <Text maxFontSizeMultiplier={CARD_SCALE_MAX} style={[styles.h1, { color: palette.prose }]}>Welcome back.</Text>
        <Text maxFontSizeMultiplier={CARD_SCALE_MAX} style={[styles.context, { color: palette.secondary }]} numberOfLines={1}>
          {context(book.chapter)}
        </Text>
        {book.lastLine ? (
          <Text maxFontSizeMultiplier={CARD_SCALE_MAX}
            style={[styles.trace, { color: palette.secondary, borderTopColor: palette.rule }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            accessibilityLabel={`Last sentence read: ${book.lastLine}`}
          >
            {lead}
            <Text maxFontSizeMultiplier={CARD_SCALE_MAX} style={{ color: palette.accent }}>{tail}</Text>
          </Text>
        ) : (
          <View style={[styles.spacer, { borderTopColor: palette.rule }]} />
        )}
        <Pressable
          onPress={onContinue}
          style={({ pressed }) => [styles.continue, { backgroundColor: palette.accent, opacity: pressed ? 0.85 : 1 }]}
          accessibilityRole="button"
        >
          <Text maxFontSizeMultiplier={CARD_SCALE_MAX} style={[styles.continueText, { color: palette.ink }]}>Continue</Text>
        </Pressable>
        <Text maxFontSizeMultiplier={CARD_SCALE_MAX} style={[styles.daily, { color: palette.secondary }]}>
          {minutesToday > 0 ? `You have read ${minutesToday} min today` : 'Your first page of the day'}
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill },
  card: {
    position: 'absolute',
    left: 16,
    right: 16,
    padding: 24,
    borderWidth: 1,
    borderRadius: 12,
    elevation: 16,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  details: { flex: 1, minWidth: 0 },
  title: { fontFamily: FONTS.book, fontSize: 23, lineHeight: 28, marginBottom: 8 },
  author: { fontFamily: FONTS.ui, fontSize: 12, lineHeight: 18 },
  h1: { fontFamily: FONTS.uiStrong, fontSize: 24, lineHeight: 30, letterSpacing: -0.6, marginBottom: 8 },
  context: { fontFamily: FONTS.ui, fontSize: 14, lineHeight: 21 },
  trace: {
    fontFamily: FONTS.bookItalic,
    fontSize: TRACE_SIZE,
    lineHeight: 27,
    marginTop: 20,
    marginBottom: 28,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  spacer: { marginTop: 20, marginBottom: 28, borderTopWidth: 1 },
  continue: { minHeight: 52, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  continueText: { fontFamily: FONTS.uiStrong, fontSize: 15 },
  daily: { fontFamily: FONTS.ui, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 16 },
});
