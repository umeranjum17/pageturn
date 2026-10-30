// The one WebView. Sends typed messages in, hands typed messages out.
import { useEffect, forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  CHUNK_SIZE,
  parseOutMessage,
  type BookFormat,
  type InMessage,
  type OutMessage,
  type ReaderStyle,
} from './protocol';

export interface OpenRequest {
  bookId: string;
  format: BookFormat;
  base64: string;
  cfi: string | null;
  page: number | null;
  locations: string | null;
  style: ReaderStyle;
}

export interface ReaderHandle {
  open(req: OpenRequest): void;
  setStyle(style: ReaderStyle): void;
  goto(target: string): void;
  setPage(page: number): void;
  find(text: string): void;
}

interface Props {
  background: string;
  onMessage(msg: OutMessage): void;
}

// The engine document ships as an APK asset; read it once per launch.
let engineHtml: Promise<string> | null = null;
function loadEngine(): Promise<string> {
  engineHtml ??= (async () => {
    const asset = Asset.fromModule(require('../../assets/reader-engine.html'));
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    return FileSystem.readAsStringAsync(uri);
  })();
  return engineHtml;
}

const ReaderView = forwardRef<ReaderHandle, Props>(function ReaderView({ background, onMessage }, ref) {
  const web = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadEngine()
      .then((text) => live && setHtml(text))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const send = useCallback((msg: InMessage) => {
    web.current?.postMessage(JSON.stringify(msg));
  }, []);

  const deliver = useCallback(
    (req: OpenRequest) => {
      const total = Math.ceil(req.base64.length / CHUNK_SIZE);
      send({ type: 'load-begin', total });
      for (let i = 0; i < total; i++) {
        send({ type: 'load-chunk', index: i, data: req.base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) });
      }
      send({
        type: 'load-end',
        bookId: req.bookId,
        format: req.format,
        cfi: req.cfi,
        page: req.page,
        locations: req.locations,
        style: req.style,
      });
    },
    [send],
  );

  useImperativeHandle(
    ref,
    () => ({
      open(req) {
        // Before the engine says 'ready' there is nothing to open into; the
        // owner re-opens the current book when 'ready' arrives.
        if (ready.current) deliver(req);
      },
      setStyle(style) {
        if (ready.current) send({ type: 'style', style });
      },
      goto(target) {
        if (ready.current) send({ type: 'goto', target });
      },
      setPage(page) {
        if (ready.current) send({ type: 'page', page });
      },
      find(text) {
        if (ready.current) send({ type: 'find', text });
      },
    }),
    [deliver, send],
  );

  const handle = useCallback(
    (e: WebViewMessageEvent) => {
      const msg = parseOutMessage(e.nativeEvent.data);
      if (!msg) return;
      // On 'ready' (first load or after a renderer restart) the owner opens
      // the current book again from its saved position.
      if (msg.type === 'ready') ready.current = true;
      onMessage(msg);
    },
    [onMessage],
  );

  // Nothing to show until the engine document is read off the APK assets.
  if (!html) return null;

  return (
    <WebView<object>
      ref={web}
      source={{ html, baseUrl: 'about:blank' }}
      originWhitelist={['about:*', 'blob:*', 'data:*']}
      onShouldStartLoadWithRequest={(r: { url: string }) => !/^https?:/i.test(r.url)}
      onMessage={handle}
      onContentProcessDidTerminate={() => web.current?.reload()}
      onRenderProcessGone={() => {
        ready.current = false;
        web.current?.reload();
      }}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      cacheEnabled={false}
      setSupportMultipleWindows={false}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
      textZoom={100}
      style={[styles.web, { backgroundColor: background }]}
      containerStyle={{ backgroundColor: background }}
      androidLayerType="hardware"
    />
  );
});

export default ReaderView;

const styles = StyleSheet.create({
  web: { flex: 1 },
});
