// The minimal overlay revealed by tapping the middle of the page.
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Prefs } from '../db';
import type { ThemeMode } from '../lib/time';
import type { Justify } from '../reader/protocol';
import Sheet from './Sheet';
import Slider from './Slider';
import { FONTS, TAP, type Palette, TEXT_SCALE_MAX } from './tokens';

interface Props {
  visible: boolean;
  palette: Palette;
  prefs: Prefs;
  brightness: number;
  brightnessFollowsSystem: boolean;
  onBrightness(v: number): void;
  onSystemBrightness(): void;
  onPrefs(p: Prefs): void;
  isPdf: boolean;
  onContents(): void;
  onHighlights(): void;
  onRecap(): void;
  onClose(): void;
}

export const FONT_MIN = 15;
export const FONT_MAX = 32;
const LINE_HEIGHTS: [string, number][] = [['Snug', 1.45], ['Even', 1.6], ['Airy', 1.8]];
const MARGINS: [string, number][] = [['Slim', 12], ['Mid', 20], ['Wide', 34]];

function Choice<T>({
  options,
  value,
  palette,
  onPick,
}: {
  options: [string, T][];
  value: T;
  palette: Palette;
  onPick(v: T): void;
}) {
  return (
    <View style={styles.group}>
      {options.map(([label, v]) => {
        const on = v === value;
        return (
          <Pressable
            key={label}
            onPress={() => onPick(v)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.choice, { borderColor: on ? palette.secondary : palette.rule, backgroundColor: palette.page }]}
          >
            <Text
              maxFontSizeMultiplier={TEXT_SCALE_MAX}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.choiceText, { color: on ? palette.prose : palette.secondary }]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Row({ label, palette, children }: { label: string; palette: Palette; children: ReactNode }) {
  return (
    <View style={[styles.row, { borderTopColor: palette.rule }]}>
      <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.label, { color: palette.secondary }]}>{label}</Text>
      {children}
    </View>
  );
}

export default function Controls(p: Props) {
  const { palette, prefs } = p;
  const set = (patch: Partial<Prefs>) => p.onPrefs({ ...prefs, ...patch });
  return (
    <Sheet visible={p.visible} palette={palette} onClose={p.onClose}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
      <View style={styles.top}>
        <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.label, { color: palette.prose }]}>Brightness</Text>
        <Pressable onPress={p.onClose} hitSlop={12} style={styles.done} accessibilityRole="button">
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, { color: palette.secondary }]}>Done</Text>
        </Pressable>
      </View>
      <Slider label="Brightness" value={p.brightness} min={0.02} max={1} palette={palette} onChange={p.onBrightness} />
      <Pressable
        onPress={p.onSystemBrightness}
        disabled={p.brightnessFollowsSystem}
        style={styles.system}
        accessibilityRole="button"
        accessibilityState={{ selected: p.brightnessFollowsSystem }}
      >
        <Text
          maxFontSizeMultiplier={TEXT_SCALE_MAX}
          style={[styles.small, { color: p.brightnessFollowsSystem ? palette.secondary : palette.prose }]}
        >
          {p.brightnessFollowsSystem ? 'Using phone brightness' : 'Use phone brightness'}
        </Text>
      </Pressable>
      <Row label="Text size" palette={palette}>
        <View style={styles.group}>
          <Pressable
            accessibilityLabel="Decrease text size"
            onPress={() => set({ fontSize: Math.max(FONT_MIN, prefs.fontSize - 1) })}
            style={[styles.choice, { borderColor: palette.rule, backgroundColor: palette.page }]}
          >
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.choiceText, { color: palette.prose }]}>A−</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Increase text size"
            onPress={() => set({ fontSize: Math.min(FONT_MAX, prefs.fontSize + 1) })}
            style={[styles.choice, { borderColor: palette.rule, backgroundColor: palette.page }]}
          >
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.choiceText, { color: palette.prose }]}>A+</Text>
          </Pressable>
        </View>
      </Row>
      <Row label="Theme" palette={palette}>
        <Choice<ThemeMode>
          options={[['Auto', 'auto'], ['Night', 'night'], ['Paper', 'paper']]}
          value={prefs.themeMode}
          palette={palette}
          onPick={(themeMode) => set({ themeMode })}
        />
      </Row>
      <Row label="Lines" palette={palette}>
        <Choice options={LINE_HEIGHTS} value={prefs.lineHeight} palette={palette} onPick={(lineHeight) => set({ lineHeight })} />
      </Row>
      <Row label="Margins" palette={palette}>
        <Choice options={MARGINS} value={prefs.margin} palette={palette} onPick={(margin) => set({ margin })} />
      </Row>
      <Row label="Align" palette={palette}>
        <Choice<Justify>
          options={[['Left', 'left'], ['Justify', 'justify']]}
          value={prefs.justify}
          palette={palette}
          onPick={(justify) => set({ justify })}
        />
      </Row>
      <View style={[styles.links, { borderTopColor: palette.rule }]}>
        <Pressable onPress={p.onHighlights} style={styles.link} accessibilityRole="button">
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.linkText, { color: palette.prose }]}>Highlights</Text>
        </Pressable>
        {!p.isPdf ? (
          <Pressable onPress={p.onContents} style={styles.link} accessibilityRole="button">
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.linkText, { color: palette.prose }]}>Contents</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={p.onRecap} style={styles.link} accessibilityRole="button">
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.linkText, { color: palette.prose }]}>Where you left off</Text>
        </Pressable>
      </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  system: { minHeight: 36, justifyContent: 'center', marginBottom: 4 },
  done: { minHeight: TAP - 8, justifyContent: 'center', paddingLeft: 16 },
  // Caption above, choices across the full width: fits narrow screens and large system text.
  row: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth * 2, gap: 6 },
  label: { fontFamily: FONTS.ui, fontSize: 13 },
  small: { fontFamily: FONTS.ui, fontSize: 13 },
  group: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    minHeight: TAP,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontFamily: FONTS.ui, fontSize: 15 },
  links: { borderTopWidth: StyleSheet.hairlineWidth * 2, marginTop: 4 },
  link: { minHeight: TAP, justifyContent: 'center' },
  linkText: { fontFamily: FONTS.ui, fontSize: 14, textDecorationLine: 'underline' },
});
