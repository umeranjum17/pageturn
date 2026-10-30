/* pageturn reader engine: runs inside the one WebView, drives epub.js.
 * Talks to React Native only through the messages in src/reader/protocol.ts.
 * Plain ES2017 so the Android System WebView runs it untranspiled. */
(function () {
  'use strict';

  var CHARS_PER_LOCATION = 1024;
  var book = null;
  var rendition = null;
  var bookId = null;
  var chunks = [];
  var style = null;
  var toc = [];
  var spineLocations = null; // spine index -> array of location indexes
  // Where each TOC entry starts, as sorted { loc, label }. Many books split
  // files by size, not by chapter, so chapters come from the TOC, not the spine.
  var tocMarks = null;
  var lastPosition = null;
  var fontUrls = null;
  var lastActivity = 0;
  var opening = 0;

  function post(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  }

  function fail(err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }

  function activity() {
    var now = Date.now();
    if (now - lastActivity > 5000) {
      lastActivity = now;
      post({ type: 'activity' });
    }
  }

  function b64ToBuffer(b64) {
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function fontFaces() {
    if (!fontUrls) {
      fontUrls = {};
      var fonts = window.PAGETURN_FONTS || {};
      Object.keys(fonts).forEach(function (k) {
        var blob = new Blob([b64ToBuffer(fonts[k])], { type: 'font/woff2' });
        fontUrls[k] = URL.createObjectURL(blob);
      });
    }
    var css = '';
    if (fontUrls.regular) {
      css += "@font-face{font-family:'PT Newsreader';font-style:normal;font-weight:400;src:url(" + fontUrls.regular + ") format('woff2')}";
    }
    if (fontUrls.italic) {
      css += "@font-face{font-family:'PT Newsreader';font-style:italic;font-weight:400;src:url(" + fontUrls.italic + ") format('woff2')}";
    }
    return css;
  }

  // Our stylesheet goes last and wins over the book's own CSS, hostile or not.
  function bookCss(s) {
    var align = s.justify === 'justify' ? 'justify' : 'left';
    return fontFaces() +
      'html,body{background:transparent!important;color:' + s.prose + '!important;height:auto!important;' +
      'min-height:0!important;overflow:visible!important;columns:auto!important;column-count:auto!important;' +
      'writing-mode:horizontal-tb!important;-webkit-text-size-adjust:none!important;position:static!important;' +
      'display:block!important;transform:none!important;filter:none!important;opacity:1!important;' +
      'visibility:visible!important;zoom:1!important}' +
      'html{font-size:' + s.fontSize + 'px!important}' +
      'body{margin:0 auto!important;padding:0 ' + s.margin + 'px!important;max-width:36em!important;' +
      "font-family:'PT Newsreader',Georgia,'Noto Serif',serif!important;font-size:" + s.fontSize + 'px!important;' +
      'line-height:' + s.lineHeight + '!important;text-align:' + align + '!important;' +
      'overflow-wrap:break-word;hyphens:auto;-webkit-hyphens:auto;-webkit-user-select:none;user-select:none;' +
      '-webkit-tap-highlight-color:transparent;font-optical-sizing:auto}' +
      'body *{color:inherit!important;background-color:transparent!important;background-image:none!important;' +
      'line-height:inherit!important;max-width:100%!important;position:static!important;float:none!important;' +
      'font-family:inherit!important;letter-spacing:normal!important;word-spacing:normal!important;' +
      'text-shadow:none!important;box-shadow:none!important}' +
      'p,li,dd,dt,blockquote,td,th,div,span{font-size:inherit!important}' +
      // Book-style first-line indent, except where a paragraph opens a section.
      'p{margin:0 0 .35em!important;text-indent:1.1em!important;text-align:' + align + '!important}' +
      'p:first-child,h1+p,h2+p,h3+p,h4+p,h5+p,h6+p,hr+p,blockquote+p,div+p,table+p,figure+p,' +
      'img+p,p:has(> img:only-child),[align=center] p,p[align=center]{text-indent:0!important}' +
      'h1,h2,h3,h4,h5,h6{text-align:center!important;font-weight:400!important;line-height:1.25!important;' +
      'margin:2.2em 0 1.2em!important;text-indent:0!important;letter-spacing:.02em!important}' +
      'h1{font-size:1.45em!important}h2{font-size:1.3em!important}h3,h4,h5,h6{font-size:1.1em!important}' +
      'blockquote{margin:1em 1.2em!important}' +
      // Only real links take the accent; named anchors often wrap whole chapters.
      'a[href],a[href] *{color:' + s.accent + '!important;text-decoration:none!important}' +
      'img,svg,image,video{max-width:100%!important;height:auto!important;display:block;margin:1em auto!important' +
      (s.dimImages ? ';filter:brightness(.82)' : '') + '}' +
      'hr{border:0!important;border-top:1px solid ' + s.secondary + '!important;opacity:.4;margin:2em 20%!important}' +
      'pre,code{white-space:pre-wrap!important;font-family:monospace!important;font-size:.85em!important}' +
      'table{border-collapse:collapse!important;width:auto!important}' +
      '::selection{background:transparent}';
  }

  function applyStyle(s) {
    style = s;
    document.documentElement.style.background = s.page;
    document.body.style.background = s.page;
    if (!rendition) return;
    var css = bookCss(s);
    rendition.getContents().forEach(function (c) {
      c.addStylesheetCss(css, 'pageturn');
    });
    // Layout changed: hold the reader on the same sentence.
    if (lastPosition && lastPosition.cfi) {
      var cfi = lastPosition.cfi;
      setTimeout(function () {
        if (rendition) rendition.display(cfi);
      }, 60);
    }
  }

  function flattenToc(items, depth, out) {
    (items || []).forEach(function (item) {
      out.push({ label: String(item.label || '').trim(), href: item.href, depth: depth });
      if (item.subitems && item.subitems.length) flattenToc(item.subitems, depth + 1, out);
    });
    return out;
  }

  function hrefPath(href) {
    return String(href || '').split('#')[0];
  }

  function chapterFor(href) {
    var path = hrefPath(href);
    var found = null;
    for (var i = 0; i < toc.length; i++) {
      var t = hrefPath(toc[i].href);
      if (t && (t === path || path.slice(-t.length) === t || t.slice(-path.length) === path)) {
        found = toc[i].label;
        break;
      }
    }
    return found;
  }

  function coverDataUrl() {
    return book.coverUrl().then(function (url) {
      if (!url) return null;
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var w = 240;
          var h = Math.round((img.naturalHeight / img.naturalWidth) * w) || 360;
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = function () {
          resolve(null);
        };
        img.src = url;
      });
    }).catch(function () {
      return null;
    });
  }

  function indexSpine() {
    spineLocations = {};
    var list = book.locations._locations || [];
    for (var i = 0; i < list.length; i++) {
      var pos = new ePub.CFI(list[i]).spinePos;
      (spineLocations[pos] = spineLocations[pos] || []).push(i);
    }
  }

  function firstLocationOf(section) {
    var list = spineLocations && spineLocations[section.index];
    return list && list.length ? list[0] : null;
  }

  function indexToc(current) {
    var bySection = {};
    toc.forEach(function (entry) {
      var section = book.spine.get(entry.href);
      if (!section) return;
      (bySection[section.index] = bySection[section.index] || { section: section, entries: [] }).entries.push(entry);
    });
    var marks = [];
    var chain = Promise.resolve();
    Object.keys(bySection).forEach(function (key) {
      var group = bySection[key];
      chain = chain.then(function () {
        if (current !== book) return;
        var needsDoc = group.entries.some(function (e) { return String(e.href).indexOf('#') >= 0; });
        var loaded = needsDoc ? group.section.load(book.load.bind(book)) : Promise.resolve();
        return loaded.then(function () {
          group.entries.forEach(function (entry) {
            var loc = null;
            var frag = String(entry.href).split('#')[1];
            var el = frag && group.section.document ? group.section.document.getElementById(decodeURIComponent(frag)) : null;
            if (el) loc = book.locations.locationFromCfi(group.section.cfiFromElement(el));
            if (loc == null || loc < 0) loc = firstLocationOf(group.section);
            if (loc != null && loc >= 0) marks.push({ loc: loc, label: entry.label });
          });
          if (needsDoc) group.section.unload();
        }).catch(function () { /* this entry falls back to the spine */ });
      });
    });
    return chain.then(function () {
      if (current !== book) return;
      marks.sort(function (a, b) { return a.loc - b.loc; });
      tocMarks = marks.length ? marks : null;
    });
  }

  function sentenceAt(text, offset) {
    var start = 0;
    var re = /[.!?…]["”’)\]]*\s+/g;
    var m;
    while ((m = re.exec(text))) {
      var end = m.index + m[0].length;
      if (end <= offset) start = end;
      else break;
    }
    re.lastIndex = Math.max(offset, start);
    var next = re.exec(text);
    var stop = next ? next.index + next[0].length : text.length;
    var sentence = text.slice(start, stop).trim();
    // Long sentences keep their ending: that is where the eye stops.
    if (sentence.length > 220) sentence = '…' + sentence.slice(-220).replace(/^\S*\s+/, '');
    return sentence;
  }

  function lastLineFor(cfi) {
    try {
      var range = rendition.getRange(cfi);
      if (!range) return null;
      var node = range.startContainer;
      var el = node.nodeType === 1 ? node : node.parentElement;
      var block = (el && el.closest && el.closest('p,li,blockquote,div,h1,h2,h3,h4,h5,h6,dd,td')) ||
        el || null;
      if (!block) return null;
      var pre = block.ownerDocument.createRange();
      pre.setStart(block, 0);
      pre.setEnd(range.startContainer, range.startOffset);
      // Measure the offset in the same collapsed-whitespace text we read from.
      var offset = pre.toString().replace(/\s+/g, ' ').length;
      var text = (block.textContent || '').replace(/\s+/g, ' ');
      offset = Math.min(offset, text.length);
      var s = sentenceAt(text, offset);
      return s || null;
    } catch (e) {
      return null;
    }
  }

  function positionFor(location) {
    var start = location.start;
    var cfi = start.cfi;
    var percent = null;
    var chapterLeft = null;
    var bookLeft = null;
    var chapter = chapterFor(start.href);
    var total = book.locations.length();
    if (total > 0) {
      var idx = book.locations.locationFromCfi(cfi);
      percent = book.locations.percentageFromCfi(cfi);
      bookLeft = Math.max(0, total - idx - 1) * CHARS_PER_LOCATION;
      if (tocMarks) {
        var next = total - 1;
        for (var m = 0; m < tocMarks.length; m++) {
          if (tocMarks[m].loc <= idx) chapter = tocMarks[m].label;
          else { next = tocMarks[m].loc; break; }
        }
        chapterLeft = Math.max(0, next - idx) * CHARS_PER_LOCATION;
      } else if (spineLocations && spineLocations[start.index]) {
        var inSection = spineLocations[start.index];
        var after = 0;
        for (var i = 0; i < inSection.length; i++) if (inSection[i] > idx) after++;
        chapterLeft = after * CHARS_PER_LOCATION;
      }
    } else if (book.spine && book.spine.length) {
      percent = start.index / book.spine.length;
    }
    return {
      bookId: bookId,
      cfi: cfi,
      percent: percent,
      chapter: chapter,
      chapterLeftChars: chapterLeft,
      bookLeftChars: bookLeft,
      lastLine: lastLineFor(cfi),
    };
  }

  function emitPosition(location) {
    if (!location || !location.start) return;
    var pos = positionFor(location);
    lastPosition = pos;
    post(Object.assign({ type: 'relocated' }, pos));
  }

  function attachInput(contents) {
    var doc = contents.document;
    var x0 = 0, y0 = 0, t0 = 0, moved = false;
    doc.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      x0 = t.screenX; y0 = t.screenY; t0 = Date.now(); moved = false;
      activity();
    }, { passive: true });
    doc.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (Math.abs(t.screenX - x0) > 10 || Math.abs(t.screenY - y0) > 10) moved = true;
    }, { passive: true });
    doc.addEventListener('touchend', function (e) {
      if (moved || Date.now() - t0 > 350) return;
      var target = e.target;
      if (target && target.closest && target.closest('a[href]')) return;
      var frame = contents.window.frameElement;
      var top = frame ? frame.getBoundingClientRect().top : 0;
      var touch = e.changedTouches[0];
      var y = top + touch.clientY;
      var h = window.innerHeight;
      if (y > h * 0.12 && y < h * 0.88) post({ type: 'tap' });
    }, { passive: true });
  }

  function destroy() {
    if (rendition) {
      try { rendition.destroy(); } catch (e) { /* already gone */ }
    }
    if (book) {
      try { book.destroy(); } catch (e) { /* already gone */ }
    }
    rendition = null;
    book = null;
    spineLocations = null;
    tocMarks = null;
    lastPosition = null;
    toc = [];
    document.getElementById('viewer').innerHTML = '';
  }

  function open(msg) {
    var token = ++opening;
    destroy();
    bookId = msg.bookId;
    style = msg.style;
    applyStyle(style);
    var buffer = b64ToBuffer(chunks.join(''));
    chunks = [];
    book = ePub(buffer);
    var current = book;
    rendition = book.renderTo('viewer', {
      manager: 'continuous',
      flow: 'scrolled',
      width: '100%',
      height: '100%',
      spread: 'none',
      // Book scripts still cannot run: the page CSP admits only our nonce'd
      // engine. epub.js needs allow-scripts on its frames for our listeners.
      allowScriptedContent: true,
    });
    rendition.hooks.content.register(function (contents) {
      if (style) contents.addStylesheetCss(bookCss(style), 'pageturn');
      attachInput(contents);
    });
    rendition.on('relocated', function (location) {
      if (token === opening) emitPosition(location);
    });
    rendition.on('displayError', fail);

    return book.ready.then(function () {
      if (token !== opening) return;
      var meta = book.packaging.metadata || {};
      toc = flattenToc(book.navigation && book.navigation.toc, 0, []);
      return coverDataUrl().then(function (cover) {
        if (token !== opening) return;
        post({
          type: 'opened',
          bookId: bookId,
          title: meta.title || null,
          author: meta.creator || null,
          cover: cover,
          toc: toc,
        });
        if (msg.locations) {
          try {
            book.locations.load(msg.locations);
            indexSpine();
          } catch (e) { /* regenerate below */ }
        }
        return rendition.display(msg.cfi || undefined).catch(function () {
          return rendition.display();
        });
      });
    }).then(function () {
      if (token !== opening || current !== book) return;
      var scroller = document.querySelector('.epub-container');
      if (scroller) scroller.addEventListener('scroll', activity, { passive: true });
      var ready = book.locations.length() > 0
        ? Promise.resolve()
        : book.locations.generate(CHARS_PER_LOCATION).then(function () {
          if (token !== opening) return;
          indexSpine();
          post({ type: 'locations', bookId: bookId, locations: book.locations.save() });
        });
      return ready.then(function () {
        if (token !== opening) return;
        return indexToc(current);
      }).then(function () {
        if (token !== opening) return;
        var loc = rendition.currentLocation();
        if (loc && loc.start) emitPosition(loc);
      });
    }).catch(fail);
  }

  function handle(msg) {
    switch (msg.type) {
      case 'load-begin':
        chunks = new Array(msg.total);
        break;
      case 'load-chunk':
        chunks[msg.index] = msg.data;
        break;
      case 'load-end':
        open(msg);
        break;
      case 'style':
        applyStyle(msg.style);
        break;
      case 'goto':
        if (rendition) rendition.display(msg.target).catch(fail);
        break;
    }
  }

  function onMessage(e) {
    var msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg && msg.type) {
      try { handle(msg); } catch (err) { fail(err); }
    }
  }

  window.addEventListener('message', onMessage);
  document.addEventListener('message', onMessage);
  window.onerror = function (m) { fail(m); };
  window.addEventListener('unhandledrejection', function (e) { fail(e.reason); });
  post({ type: 'ready' });
})();
