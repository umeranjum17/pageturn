# pageturn

[![Follow @umership on X](https://img.shields.io/badge/X-%40umership-000000?logo=x&logoColor=white)](https://x.com/umership)

A book reader for Android built to be as hard to put down as a social feed.
It opens straight into your book at the sentence you stopped on, scrolls
through chapters without ever hitting an end wall, and keeps your place.
PDFs open as the page they were printed as, and the highlights you marked on a
Kindle show up in the book they belong to.

- **The page is home.** Full-bleed text, a calm strip with progress, time left
  in the book and chapter, a small streak mark, and a quiet way to the library.
- **Night and paper.** OLED night after 7 pm, warm paper in the day, or pick one.
- **Comfort controls.** Brightness, text size, line spacing, margins, alignment,
  and the book's own table of contents, one tap on the middle of the page away.
- **An easy way back in.** After a long gap, a card shows the cover, the last
  sentence you read and one Continue button.
- **A gentle streak.** Minutes read per day, one automatic rest day each week.
- **Your own lines.** Import `My Clippings.txt` from a Kindle and each passage
  is attached to the matching book, newest first, one tap from its place in the
  text.
- **PDF.** One printed page at a time, pinch or double-tap to zoom, and a night
  invert that keeps print readable instead of flooding the room.
- **A shelf you can fill.** Books come from the public-domain catalogue instead
  of a store: whole, free to read, downloaded with their covers and their
  catalogue page remembered. That download is the only request the app makes.
- **Private.** Your shelf, your place and your highlights stay on the phone in
  SQLite. No account, no backend, no telemetry.

Import any DRM-free `.epub`, any `.pdf`, or your Kindle `My Clippings.txt` with
the system file picker. A Kindle book's own text is DRM-protected and has no
public API, so it is never fetched, scraped or decrypted; only the clippings file
you copy off the device is read.

## How it works

The reader page is one `react-native-webview` running [epub.js](https://github.com/futurepress/epub.js)
in continuous-scroll mode for EPUB, and [pdf.js](https://mozilla.github.io/pdf.js/)
for PDF. epub.js, pdf.js, the zip library, the book fonts and our reader runtime
are assembled into one HTML document at build time (`scripts/build-engine.mjs`)
and shipped as an app asset, so nothing is fetched from a CDN and the JS bundle
stays small. React Native drives it over one small typed protocol
(`src/reader/protocol.ts`) and never parses book HTML. Our stylesheet is applied
last over each book's own CSS, and the page's content security policy stops book
scripts and any network request. A PDF page is inverted in night mode by mapping
luminance between a dark warm sheet and warm print, so text never turns to mud.

## Build a debug APK

Needs Node 20+, JDK 17+ and the Android SDK (with `ANDROID_HOME` set).

```sh
npm install           # also generates the bundled reader engine asset
npm test              # streak, theme, time-left and catalogue parsing
npm run probe:catalog # asks the live catalogue a question per endpoint
npm run typecheck
npm run apk           # engine + expo prebuild + ./gradlew assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is arm64-v8a only and carries its JavaScript bundle, so it runs
on a phone without a dev server; a clean build is about 28 MB. No cloud build
service or account is needed.

## Sources and licence

Books are downloaded from [Project Gutenberg](https://www.gutenberg.org), the
oldest public-domain library on the open web: whole books, free to read, in the
formats its OPDS catalogue publishes. The app reads the catalogue's public
list, search and book feeds, and picks the smallest plain-text EPUB it offers —
a phone does not need a 24 MB illustrated edition. Nothing there is paid, and
nothing here touches a store's DRM.

Cataloguing metadata comes from Project Gutenberg; each downloaded book keeps
its own licence line and its catalogue page address on the shelf.

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for bundled
components and fonts.
