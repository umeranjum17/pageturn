// A bottom sheet over the page: tap outside or press back to close.
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Palette } from './tokens';

interface Props {
  visible: boolean;
  palette: Palette;
  onClose(): void;
  children: ReactNode;
  tall?: boolean;
}

export default function Sheet({ visible, palette, onClose, children, tall }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      <View
        style={[
          styles.sheet,
          tall && styles.tall,
          { backgroundColor: palette.surface, borderColor: palette.rule, bottom: insets.bottom + 16 },
          !tall && { maxHeight: '86%' },
        ]}
      >
        {children}
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
    bottom: 0,
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    elevation: 12,
  },
  tall: { top: 72 },
});
