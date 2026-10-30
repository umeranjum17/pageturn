// Bundles JSZip, epub.js, pdf.js, the book fonts and our reader runtime into one
// HTML document, so the reader works offline and never touches a CDN.
// Output: assets/reader-engine.html (generated, not committed). It is loaded once
// at launch from the app's own assets: the JS bundle stays small.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const read = (p) => readFileSync(p, 'utf8');

const jszip = read(require.resolve('jszip/dist/jszip.min.js'));
const epub = read(require.resolve('epubjs/dist/epub.min.js'));
// pdf.js, bundled the same way: a fixed-layout PDF never leaves the phone either.
const pdf = read(require.resolve('pdfjs-dist/build/pdf.min.js'));
// The worker runs on the main thread: the page CSP allows no network and no
// blob worker, so the main-thread handler is inlined instead of fetched.
const pdfWorker = read(require.resolve('pdfjs-dist/build/pdf.worker.min.js'));
const pdfView = read(join(root, 'src/reader/web/pdfview.js'));
const runtime = read(join(root, 'src/reader/web/reader.js'));
const fonts = {
  regular: readFileSync(join(root, 'assets/fonts/web/Newsreader-normal.woff2')).toString('base64'),
  italic: readFileSync(join(root, 'assets/fonts/web/Newsreader-italic.woff2')).toString('base64'),
};

// Book content inherits this policy: only scripts carrying the nonce run,
// and nothing may reach the network.
const nonce = randomBytes(16).toString('base64');
const csp = [
  "default-src 'none'",
  `script-src 'nonce-${nonce}'`,
  "style-src 'unsafe-inline' blob: data:",
  'img-src blob: data:',
  'font-src blob: data:',
  'media-src blob: data:',
  'frame-src blob: data: about:',
  'child-src blob: data: about:',
  'connect-src blob: data:',
].join('; ');

// A literal "</script" inside a library would end our tag early.
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#000}#viewer{position:absolute;inset:0}
.epub-container{scrollbar-width:none;-webkit-overflow-scrolling:touch}.epub-container::-webkit-scrollbar{display:none}
/* PDF: the reading area clips, the stage carries the zoom, the strip never moves. */
.pdf-clip{position:absolute;inset:0;overflow:hidden;touch-action:none;-webkit-tap-highlight-color:transparent}
.pdf-stage{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}
.pdf-stage canvas{display:block}
#pdf-pill{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);display:none;align-items:center;gap:4px;
height:56px;padding:0 4px 0 18px;border:1px solid rgba(128,128,128,.45);border-radius:24px;background:rgba(22,27,25,.92);
color:#e6e0d5;font:600 13px/19px system-ui,sans-serif;z-index:3}
#pdf-pill span{min-width:44px;text-align:center}
#pdf-pill button{min-width:64px;min-height:48px;padding:0 12px;border:0;border-left:1px solid rgba(128,128,128,.45);
background:transparent;color:#e6e0d5;font:600 13px/19px system-ui,sans-serif}</style>
</head><body><div id="viewer"></div>
<script nonce="${nonce}">window.PAGETURN_FONTS=${JSON.stringify(fonts)};</script>
<script nonce="${nonce}">${safe(jszip)}</script>
<script nonce="${nonce}">${safe(epub)}</script>
<script nonce="${nonce}">${safe(pdfWorker)}</script>
<script nonce="${nonce}">${safe(pdf)}</script>
<script nonce="${nonce}">${safe(pdfView)}</script>
<script nonce="${nonce}">${safe(runtime)}</script>
</body></html>`;

writeFileSync(join(root, 'assets/reader-engine.html'), html);
console.log(`reader engine: ${(html.length / 1024).toFixed(0)} KB -> assets/reader-engine.html`);
