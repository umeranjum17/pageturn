// A plain, thumb-sized slider. Built here so the app carries no extra native module.
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { Palette } from './tokens';

interface Props {
  value: number;
  min: number;
  max: number;
  palette: Palette;
  label: string;
  onChange(v: number): void;
}

export default function Slider({ value, min, max, palette, label, onChange }: Props) {
  const [width, setWidth] = useState(1);
  const widthRef = useRef(1);
  const change = useRef(onChange);
  change.current = onChange;

  const at = (x: number) => {
    const t = Math.min(1, Math.max(0, x / widthRef.current));
    change.current(min + t * (max - min));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => at(e.nativeEvent.locationX),
      onPanResponderMove: (e) => at(e.nativeEvent.locationX),
    }),
  ).current;

  const t = (value - min) / (max - min);
  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };
  const step = (max - min) / 10;

  return (
    <View
      style={styles.hit}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(t * 100) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        onChange(Math.min(max, Math.max(min, value + (e.nativeEvent.actionName === 'increment' ? step : -step))))
      }
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: palette.rule }]}>
        <View style={[styles.fill, { width: t * width, backgroundColor: palette.secondary }]} />
      </View>
      <View
        pointerEvents="none"
        style={[styles.thumb, { left: Math.min(Math.max(t * width - 11, 0), width - 22), backgroundColor: palette.accent, borderColor: palette.surface }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 48, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3 },
  thumb: { position: 'absolute', top: 13, width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
});
