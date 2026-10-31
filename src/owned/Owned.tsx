// Owned: the books he already owns that live in someone else's reader.
//
// A Google volume that offers a download is a real EPUB, so it comes onto the
// shelf the way a catalogue book does - same check, same importer. One that does
// not is a cover with one tap into Google's own reader. A Kindle purchase is only
// ever a title he types himself: Amazon publishes no API for a library, nothing
// here asks for a password, and a bought Kindle book is never read in this app.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deviceShelf, shelve } from '../catalog/download';
import type { CatalogueBook } from '../catalog/source';
import Cover from '../ui/Cover';
import { FONTS, TAP, type Palette, TEXT_SCALE_MAX } from '../ui/tokens';
import {
  begin,
  codeFrom,
  exchange,
  GOOGLE_SOURCE,
  library,
  playUrl,
  type SignIn,
  type Token,
} from './google';
import {
  addOwnedElsewhere,
  cacheVolumes,
  dropOwnedElsewhere,
  listCachedVolumes,
  listOwnedElsewhere,
} from './store';

/** Set at build time in app.json; empty when this build has no Google client. */
const CLIENT_ID: string = Constants.expoConfig?.extra?.GOOGLE_OAUTH_CLIENT_ID ?? '';
const NO_CLIENT = 'This build has no Google client set up, so Play Books cannot be read here.';
const KINDLE_NOTE = 'A bought Kindle book cannot be read inside this app. An entry here only opens it in Kindle.';

/** A search inside the Kindle store, which is where a bought title can be reopened. */
function kindleUrl(title: string, author: string | null): string {
  return `https://www.amazon.com/s?k=${encodeURIComponent(`${title} ${author ?? ''}`.trim())}&i=digital-text`;
}

interface Props {
  visible: boolean;
  palette: Palette;
  onClose(): void;
  /** A downloadable volume has landed on the shelf: open it. */
  onImported(bookId: string): void;
}

export default function Owned(p: Props) {
  const { palette } = p;
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState<Token | null>(null);
  const [volumes, setVolumes] = useState(() => listCachedVolumes());
  const [mine, setMine] = useState(() => listOwnedElsewhere());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  // Lifetime of the process only: signing out, or quitting, drops the token.
  const pending = useRef<SignIn | null>(null);

  const pull = useCallback(async (t: Token) => {
    const list = await library(t.access);
    cacheVolumes(list);
    setVolumes(listCachedVolumes());
    setNotice(`${list.length} ${list.length === 1 ? 'book' : 'books'} in your Play Books library.`);
  }, []);

  const finish = useCallback(
    async (url: string) => {
      const started = pending.current;
      const code = started ? codeFrom(url, started.state) : null;
      if (!started || !code) return;
      pending.current = null;
      setBusy('google');
      try {
        const got = await exchange({ clientId: CLIENT_ID, code, verifier: started.verifier });
        setToken(got);
        await pull(got);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'Google sign-in did not finish.');
      } finally {
        setBusy(null);
      }
    },
    [pull],
  );

  // The consent page comes back to this app's own scheme, and that url carries
  // the code. One listener, for as long as the screen is up.
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => void finish(url));
    return () => sub.remove();
  }, [finish]);

  const connect = useCallback(async () => {
    setNotice(null);
    if (!CLIENT_ID) {
      setNotice(NO_CLIENT);
      return;
    }
    setBusy('google');
    try {
      const started = await begin(CLIENT_ID);
      pending.current = started;
      await Linking.openURL(started.url);
      setNotice('Finish in your browser; this screen fills in when you come back.');
    } catch {
      setNotice('The browser would not open the Google page.');
    } finally {
      setBusy(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return connect();
    setBusy('google');
    setNotice(null);
    try {
      await pull(token);
    } catch (e) {
      // An hour-old token is what usually fails here: ask for the account again.
      setToken(null);
      setNotice(e instanceof Error ? e.message : 'Google could not be read.');
    } finally {
      setBusy(null);
    }
  }, [connect, pull, token]);

  /** A volume he may keep comes onto the shelf; anything else opens where Google keeps it. */
  const open = useCallback(
    async (v: ReturnType<typeof listCachedVolumes>[number]) => {
      if (!v.download) {
        Linking.openURL(v.webReader ?? playUrl(v.id)).catch(() => setNotice('No app could open that link.'));
        return;
      }
      setBusy(v.id);
      setNotice(null);
      try {
        const book: CatalogueBook = {
          source: GOOGLE_SOURCE,
          id: v.id,
          title: v.title,
          author: v.author,
          licence: null,
          pageUrl: playUrl(v.id),
          epub: v.download,
          cover: v.cover,
          categories: [],
        };
        p.onImported(await shelve(book, await deviceShelf()));
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'That book could not be imported.');
      } finally {
        setBusy(null);
      }
    },
    [p],
  );

  const own = useCallback(() => {
    const t = title.trim();
    if (!t) return;
    addOwnedElsewhere({ title: t, author: author.trim() || null, cover: null });
    setMine(listOwnedElsewhere());
    setTitle('');
    setAuthor('');
    setNotice('Added to your shelf. It opens in the Kindle app, not in this reader.');
  }, [author, title]);

  const small = { color: palette.secondary };

  return (
    <Modal visible={p.visible} animationType="slide" onRequestClose={p.onClose} statusBarTranslucent navigationBarTranslucent>
      <View
        style={[
          styles.screen,
          { backgroundColor: palette.page, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 },
        ]}
      >
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.heading, { color: palette.prose }]}>
            Owned
          </Text>
          <Pressable onPress={p.onClose} style={styles.back} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to library">
            <View style={[styles.chevron, { borderColor: palette.secondary, transform: [{ rotate: '45deg' }] }]} />
          </Pressable>
        </View>

        <View style={styles.controls}>
          <Pressable
            onPress={connect}
            disabled={busy !== null}
            style={({ pressed }) => [styles.action, { borderColor: palette.rule, opacity: pressed || busy !== null ? 0.7 : 1 }]}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.actionText, { color: palette.prose }]}>
              {busy === 'google' ? 'Reading Google…' : token ? 'Connected' : 'Connect Google'}
            </Text>
          </Pressable>
          <Pressable onPress={refresh} disabled={busy !== null} style={styles.link} accessibilityRole="button">
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, { color: palette.accent }]}>
              Refresh
            </Text>
          </Pressable>
          {token ? (
            <Pressable
              onPress={() => {
                setToken(null);
                setNotice('Signed out. The Google token is gone from this app.');
              }}
              style={styles.link}
              accessibilityRole="button"
            >
              <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, small]}>
                Sign out
              </Text>
            </Pressable>
          ) : null}
        </View>
        {notice ? (
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.notice, small]}>
            {notice}
          </Text>
        ) : null}

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {volumes.map((v) => (
            <Pressable
              key={v.id}
              onPress={() => open(v)}
              style={({ pressed }) => [styles.row, { borderBottomColor: palette.rule, opacity: pressed ? 0.7 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={`${v.title}${v.author ? `, ${v.author}` : ''}, ${v.download ? 'can be imported' : 'opens in Play Books'}`}
            >
              {v.cover ? (
                <Image source={{ uri: v.cover }} style={[styles.thumb, { borderColor: palette.rule }]} accessibilityLabel={`Cover of ${v.title}`} />
              ) : (
                <Cover title={v.title} author={v.author} palette={palette} width={56} />
              )}
              <View style={styles.details}>
                <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.title, { color: palette.prose }]} numberOfLines={2}>
                  {v.title}
                </Text>
                {v.author ? (
                  <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, small]} numberOfLines={1}>
                    {v.author}
                  </Text>
                ) : null}
                <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, small]}>
                  {busy === v.id ? 'Bringing it in…' : v.download ? 'Tap to add it to your shelf' : 'Opens in Play Books'}
                </Text>
              </View>
            </Pressable>
          ))}
          {!volumes.length ? (
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.empty, small]}>
              Connect Google to list the books you already own there.
            </Text>
          ) : null}

          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.section, { color: palette.prose }]}>
            On Kindle
          </Text>
          <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, small]}>
            {KINDLE_NOTE}
          </Text>
          {mine.map((b) => (
            <View key={b.id} style={[styles.row, { borderBottomColor: palette.rule }]}>
              {b.cover ? (
                <Image source={{ uri: b.cover }} style={[styles.thumb, { borderColor: palette.rule }]} accessibilityLabel={`Cover of ${b.title}`} />
              ) : (
                <Cover title={b.title} author={b.author} palette={palette} width={56} />
              )}
              <Pressable
                onPress={() => Linking.openURL(kindleUrl(b.title, b.author)).catch(() => undefined)}
                style={styles.details}
                accessibilityRole="button"
                accessibilityLabel={`Open ${b.title} in the Kindle app`}
              >
                <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.title, { color: palette.prose }]} numberOfLines={2}>
                  {b.title}
                </Text>
                {b.author ? (
                  <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, small]} numberOfLines={1}>
                    {b.author}
                  </Text>
                ) : null}
                <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, { color: palette.accent }]}>
                  Open in Kindle
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  dropOwnedElsewhere(b.id);
                  setMine(listOwnedElsewhere());
                }}
                style={styles.drop}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${b.title} from this shelf`}
              >
                <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.small, small]}>
                  Remove
                </Text>
              </Pressable>
            </View>
          ))}

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title you own on Kindle"
            placeholderTextColor={palette.secondary}
            maxFontSizeMultiplier={TEXT_SCALE_MAX}
            style={[styles.input, { color: palette.prose, borderColor: palette.rule }]}
            accessibilityLabel="Kindle title"
          />
          <TextInput
            value={author}
            onChangeText={setAuthor}
            placeholder="Author"
            placeholderTextColor={palette.secondary}
            maxFontSizeMultiplier={TEXT_SCALE_MAX}
            style={[styles.input, { color: palette.prose, borderColor: palette.rule }]}
            accessibilityLabel="Kindle author"
          />
          <Pressable
            onPress={own}
            style={({ pressed }) => [styles.action, { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 }]}
            accessibilityRole="button"
          >
            <Text maxFontSizeMultiplier={TEXT_SCALE_MAX} style={[styles.actionText, { color: palette.ink }]}>
              I own this
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TAP },
  heading: { fontFamily: FONTS.book, fontSize: 30 },
  back: { width: TAP, height: TAP, alignItems: 'flex-end', justifyContent: 'center' },
  chevron: { width: 12, height: 12, borderLeftWidth: 1.5, borderBottomWidth: 1.5, marginRight: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 8 },
  action: { minHeight: TAP, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 6, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: FONTS.uiStrong, fontSize: 15 },
  link: { minHeight: TAP, justifyContent: 'center' },
  small: { fontFamily: FONTS.ui, fontSize: 13, lineHeight: 19 },
  notice: { fontFamily: FONTS.ui, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  list: { paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  thumb: { width: 56, height: 84, borderWidth: StyleSheet.hairlineWidth * 2, backgroundColor: '#fff', resizeMode: 'cover' },
  details: { flex: 1, justifyContent: 'center', gap: 2, minHeight: TAP },
  title: { fontFamily: FONTS.book, fontSize: 20, lineHeight: 25 },
  empty: { fontFamily: FONTS.ui, fontSize: 14, textAlign: 'center', marginTop: 32, marginBottom: 24 },
  section: { fontFamily: FONTS.book, fontSize: 24, marginTop: 28, marginBottom: 6 },
  drop: { minHeight: TAP, justifyContent: 'center' },
  input: { minHeight: TAP, borderBottomWidth: StyleSheet.hairlineWidth * 2, fontFamily: FONTS.ui, fontSize: 15, marginTop: 12 },
});
