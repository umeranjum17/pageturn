// The one WebView. Sends typed messages in, hands typed messages out.
import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { READER_HTML } from './engine.generated';
import { CHUNK_SIZE, parseOutMessage, type InMessage, type OutMessage, type ReaderStyle } from './protocol';

export interface OpenRequest {
  bookId: string;
  base64: string;
  cfi: string | null;
  locations: string | null;
  style: ReaderStyle;
}

export interface ReaderHandle {
  open(req: OpenRequest): void;
  setStyle(style: ReaderStyle): void;
  goto(target: string): void;
}

interface Props {
  background: string;
  onMessage(msg: OutMessage): void;
}

const ReaderView = forwardRef<ReaderHandle, Props>(function ReaderView({ background, onMessage }, ref) {
  const web = useRef<WebView<object>>(null);
  const ready = useRef(false);

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
      send({ type: 'load-end', bookId: req.bookId, cfi: req.cfi, locations: req.locations, style: req.style });
    },
    [send],
  );

  useImperativeHandle(
    ref,
    () => ({
      open(req) {
        if (ready.current) deliver(req);
      },
      setStyle(style) {
        if (ready.current) send({ type: 'style', style });
      },
      goto(target) {
        if (ready.current) send({ type: 'goto', target });
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

  return (
    <WebView<object>
      ref={web}
      source={{ html: READER_HTML, baseUrl: 'about:blank' }}
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
