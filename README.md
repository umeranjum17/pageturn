# pageturn

[![Follow @umership on X](https://img.shields.io/badge/X-%40umership-000000?logo=x&logoColor=white)](https://x.com/umership)

A book reader for Android built to be as hard to put down as a social feed.
It opens straight into your book at the sentence you stopped on, scrolls
through chapters without ever hitting an end wall, and keeps your place.

- **The page is home.** Full-bleed text, a calm strip with progress, time left
  in the book and chapter, a small streak mark, and a quiet way to the library.
- **Night and paper.** OLED night after 7 pm, warm paper in the day, or pick one.
- **Comfort controls.** Brightness, text size, line spacing, margins, alignment,
  and the book's own table of contents, one tap on the middle of the page away.
- **An easy way back in.** After a long gap, a card shows the cover, the last
  sentence you read and one Continue button.
- **A gentle streak.** Minutes read per day, one automatic rest day each week.
- **Private.** Everything stays on the phone in SQLite. No account, no backend,
  no network calls.

EPUB only for now. Import any DRM-free `.epub` with the system file picker.

## How it works

The reader page is one `react-native-webview` running [epub.js](https://github.com/futurepress/epub.js)
in continuous-scroll mode. The engine, its zip library and the book fonts are
bundled into the app as a string at build time (`scripts/build-engine.mjs`),
so nothing is fetched from a CDN. React Native drives it over one small typed
protocol (`src/reader/protocol.ts`) and never parses book HTML. Our stylesheet
is applied last over each book's own CSS, and the page's content security
policy stops book scripts and any network request.

## Build a debug APK

Needs Node 20+, JDK 17+ and the Android SDK (with `ANDROID_HOME` set).

```sh
npm install           # also generates the bundled reader engine
npm test              # streak, theme and time-left logic
npm run typecheck
npm run apk           # expo prebuild + ./gradlew assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is arm64-v8a only and carries its JavaScript bundle, so it runs
on a phone without a dev server. No cloud build service or account is needed.

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for bundled
components and fonts.
