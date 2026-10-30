/* pageturn reader engine: runs inside the one WebView, drives epub.js.
 * Talks to React Native only through the messages in src/reader/protocol.ts.
 * Plain ES2017 so the Android System WebView runs it untranspiled. */
(function () {
  'use strict';

  var CHARS_PER_LOCATION = 1024;
  // The blocks a Kindle clipping can match: prose containers, nothing else.
  var BLOCKS = 'p,li,blockquote,dd,td,h1,h2,h3,h4';
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
  var showing = 0;
  var PIN_MS = 4000;
  var lastTouchAt = 0;

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

  // Resolves once the images and fonts of the shown sections have laid out,
  // or after a few seconds, whichever comes first.
  function settled() {
    var waits = [];
    rendition.getContents().forEach(function (c) {
      var doc = c.document;
      if (!doc) return;
      if (doc.fonts && doc.fonts.ready) waits.push(doc.fonts.ready);
      Array.prototype.forEach.call(doc.images, function (img) {
        if (img.complete) return;
        waits.push(new Promise(function (resolve) {
          img.addEventListener('load', resolve);
          img.addEventListener('error', resolve);
        }));
      });
    });
    return Promise.race([
      Promise.all(waits),
      new Promise(function (resolve) { setTimeout(resolve, 4000); }),
    ]);
  }

  // A DOM range for a CFI or an href ("file.html#anchor") among the shown sections.
  function rangeFor(target) {
    if (/^epubcfi\(/.test(target)) return rendition.getRange(target);
    var section = book.spine.get(target);
    if (!section) return null;
    var frag = String(target).split('#')[1];
    var found = null;
    rendition.getContents().forEach(function (c) {
      if (found || c.sectionIndex !== section.index) return;
      var el = (frag && c.document.getElementById(decodeURIComponent(frag))) || c.document.body;
      if (!el) return;
      found = c.document.createRange();
      found.selectNodeContents(el);
      found.collapse(true);
    });
    return found;
  }

  // Scroll the continuous view so the target sits at the top. epub.js only
  // scrolls relative to where it thinks the view is, which drifts when
  // sections are added above or images above the target load late.
  function scrollToTarget(target) {
    var range = rangeFor(target);
    var scroller = document.querySelector('.epub-container');
    if (!range || !scroller) return false;
    var frame = range.startContainer.ownerDocument.defaultView.frameElement;
    if (!frame) return false;
    var rects = range.getClientRects();
    var rect = rects.length ? rects[0] : range.getBoundingClientRect();
    if (!rect || (!rect.top && !rect.height)) {
      var node = range.startContainer;
      var el = node.nodeType === 1 ? node : node.parentElement;
      if (el) rect = el.getBoundingClientRect();
    }
    if (!rect) return false;
    var top = frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + rect.top;
    scroller.scrollTop = Math.max(0, Math.round(top));
    return true;
  }

  // epub.js scrolls to the target before images and fonts above it have their
  // height, so the text slides away as they load. Put it back once they have,
  // unless the reader has touched the page in the meantime.
  function show(target) {
    var token = ++showing;
    var started = Date.now();
    return rendition.display(target).then(function () {
      return settled();
    }).then(function () {
      if (target == null) return;
      // Sections added above and their images keep landing for a moment;
      // hold the target in place until they stop or the reader takes over.
      var until = Date.now() + PIN_MS;
      (function pin() {
        if (token !== showing || !rendition || blockJump || lastTouchAt > started) return;
        var ok = scrollToTarget(target);
        if (Date.now() >= until) return;
        // epub.js dropped the target's section while laying out: show it again.
        if (!ok) rendition.display(target).then(function () { setTimeout(pin, 100); }, function () {});
        else setTimeout(pin, 250);
      })();
    });
  }

  // The page ends on whole lines: a line cut by the bottom edge is covered in
  // the page colour, and a small band always separates the text from the strip.
  var EDGE_GAP = 8;
  // The same breathing room under the running head in every theme: the owner's
  // report was that the first line touched the head in night mode.
  var TOP_GAP = 14;
  var edge = null;
  var edgeTop = null;
  var edgeQueued = false;

  function queueEdge() {
    if (edgeQueued) return;
    edgeQueued = true;
    requestAnimationFrame(function () {
      edgeQueued = false;
      clipEdge();
      clipTop();
    });
  }

  // The top of the viewport is a scroll edge too: cut the half-line that
  // straddles it, so the page always opens on a whole line below the head.
  function clipTop() {
    if (!edgeTop) {
      edgeTop = document.createElement('div');
      edgeTop.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2;pointer-events:none';
      document.body.appendChild(edgeTop);
    }
    if (style) edgeTop.style.background = style.page;
    var height = TOP_GAP;
    var scroller = document.querySelector('.epub-container');
    if (scroller) {
      var top = scroller.getBoundingClientRect().top;
      var y = top + TOP_GAP;
      var frames = scroller.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        var fr = frames[i].getBoundingClientRect();
        if (fr.bottom <= y || fr.top > y) continue;
        var doc = frames[i].contentDocument;
        var r = doc && doc.body && doc.caretRangeFromPoint(doc.body.clientWidth / 2, y - fr.top);
        if (!r) break;
        var node = r.startContainer;
        if (node.nodeType === 3 && r.startOffset < node.length) r.setEnd(node, r.startOffset + 1);
        var rect = r.getClientRects()[0] || r.getBoundingClientRect();
        var lineTop = rect ? rect.top + fr.top - top : 0;
        // Only cut a line that really is cut: at a chapter opening the first line
        // starts below the gap already, and covering it would hide the heading.
        if (rect && rect.height && lineTop < TOP_GAP - 1 &&
            rect.height < 3 * style.fontSize * style.lineHeight) {
          height = Math.max(height, Math.ceil(rect.bottom + fr.top - top + 2));
        }
        break;
      }
    }
    edgeTop.style.height = height + 'px';
  }

  function clipEdge() {
    if (!edge) {
      edge = document.createElement('div');
      edge.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2;pointer-events:none';
      document.body.appendChild(edge);
    }
    if (style) edge.style.background = style.page;
    var height = EDGE_GAP;
    var scroller = document.querySelector('.epub-container');
    if (scroller) {
      var bottom = scroller.getBoundingClientRect().bottom;
      var y = bottom - EDGE_GAP;
      var frames = scroller.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        var fr = frames[i].getBoundingClientRect();
        if (fr.top > y || fr.bottom <= y) continue;
        var doc = frames[i].contentDocument;
        var r = doc && doc.body && doc.caretRangeFromPoint(doc.body.clientWidth / 2, y - fr.top);
        if (!r) break;
        var node = r.startContainer;
        if (node.nodeType === 3 && r.startOffset < node.length) r.setEnd(node, r.startOffset + 1);
        var rect = r.getClientRects()[0] || r.getBoundingClientRect();
        // Only a text line straddling the edge; images are left as they are.
        if (rect && rect.height && rect.height < 3 * style.fontSize * style.lineHeight &&
            rect.top + fr.top < y && rect.bottom + fr.top > y) {
          height = Math.max(height, Math.ceil(bottom - (rect.top + fr.top) + 2));
        }
        break;
      }
    }
    edge.style.height = height + 'px';
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
      // The first line never touches the running head: the same 10px gap in
      // every theme, so night and paper open on identical spacing.
      'body{margin:0 auto!important;padding:10px ' + s.margin + 'px 0!important;max-width:36em!important;' +
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
    queueEdge();
    if (pdfDoc && pdfEl && pdfInverted !== !!s.invert) {
      pdfRender().catch(fail);
    }
    if (!rendition) return;
    var css = bookCss(s);
    rendition.getContents().forEach(function (c) {
      c.addStylesheetCss(css, 'pageturn');
    });
    // Layout changed: hold the reader on the same sentence.
    if (lastPosition && lastPosition.cfi) {
      var cfi = lastPosition.cfi;
      setTimeout(function () {
        if (rendition) show(cfi).catch(fail);
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
    return { text: sentence, stop: stop };
  }

  // Captions, plate credits and page-number debris are not where a reader
  // stopped; the card wants a line of prose.
  function isProse(sentence) {
    var t = sentence.trim();
    if (/^[\[(].*[\])]$/.test(t)) return false;
    return (t.match(/[A-Za-z\u00C0-\u024F]{2,}/g) || []).length >= 3 && /[a-z]/.test(t);
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
      // From the saved spot, take the first sentence that reads as prose.
      var blocks = Array.prototype.slice.call(block.ownerDocument.querySelectorAll('p,li,blockquote,dd'));
      var next = 0;
      while (next < blocks.length && (blocks[next] === block || block.contains(blocks[next]) ||
        !(block.compareDocumentPosition(blocks[next]) & Node.DOCUMENT_POSITION_FOLLOWING))) next++;
      for (var tries = 0; tries < 12; tries++) {
        while (offset < text.length) {
          var s = sentenceAt(text, offset);
          if (s.text && isProse(s.text)) return s.text;
          offset = Math.max(offset + 1, s.stop);
        }
        if (next >= blocks.length) break;
        text = (blocks[next++].textContent || '').replace(/\s+/g, ' ').trim();
        offset = 0;
      }
      return null;
    } catch (e) {
      return null;
    }
  }



  // The block found above, in the section that is now displayed, at the top.
  // Measured, not computed: one scrollTop step, then re-measure, until the
  // block sits where we want it. Self-correcting whatever the frame maths are.
  function findBlockEl(info) {
    var hit = null;
    if (!rendition) return null;
    rendition.getContents().forEach(function (c) {
      if (hit) return;
      var sec = book.spine.get(c.sectionIndex);
      if (!sec || sec.cfiBase !== info.base) return;
      var blocks = c.document ? c.document.querySelectorAll(BLOCKS) : [];
      for (var i = 0; i < blocks.length; i++) {
        if (plainText(blocks[i].textContent).indexOf(info.text) >= 0) {
          hit = { el: blocks[i], frame: c.document.defaultView.frameElement };
          return;
        }
      }
    });
    return hit;
  }

  function blockOffset(info) {
    var scroller = document.querySelector('.epub-container');
    var hit = findBlockEl(info);
    if (!scroller || !hit || !hit.frame) return null;
    return Math.round(hit.el.getBoundingClientRect().top + hit.frame.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top);
  }


  // epub.js scrolls to the target before images and fonts above it have their
  // height, so the text slides away as they load. Put it back once they have,
  // unless the reader has touched the page in the meantime.
  function show(target) {
    var token = ++showing;
    var started = Date.now();
    return rendition.display(target).then(function () {
      return settled();
    }).then(function () {
      if (target == null) return;
      // Sections added above and their images keep landing for a moment;
      // hold the target in place until they stop or the reader takes over.
      var until = Date.now() + PIN_MS;
      (function pin() {
        if (token !== showing || !rendition || blockJump || lastTouchAt > started) return;
        var ok = scrollToTarget(target);
        if (Date.now() >= until) return;
        // epub.js dropped the target's section while laying out: show it again.
        if (!ok) rendition.display(target).then(function () { setTimeout(pin, 100); }, function () {});
        else setTimeout(pin, 250);
      })();
    });
  }

  // The page ends on whole lines: a line cut by the bottom edge is covered in
  // the page colour, and a small band always separates the text from the strip.
  var EDGE_GAP = 8;
  // The same breathing room under the running head in every theme: the owner's
  // report was that the first line touched the head in night mode.
  var TOP_GAP = 14;
  var edge = null;
  var edgeTop = null;
  var edgeQueued = false;

  function queueEdge() {
    if (edgeQueued) return;
    edgeQueued = true;
    requestAnimationFrame(function () {
      edgeQueued = false;
      clipEdge();
      clipTop();
    });
  }

  // The top of the viewport is a scroll edge too: cut the half-line that
  // straddles it, so the page always opens on a whole line below the head.
  function clipTop() {
    if (!edgeTop) {
      edgeTop = document.createElement('div');
      edgeTop.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2;pointer-events:none';
      document.body.appendChild(edgeTop);
    }
    if (style) edgeTop.style.background = style.page;
    var height = TOP_GAP;
    var scroller = document.querySelector('.epub-container');
    if (scroller) {
      var top = scroller.getBoundingClientRect().top;
      var y = top + TOP_GAP;
      var frames = scroller.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        var fr = frames[i].getBoundingClientRect();
        if (fr.bottom <= y || fr.top > y) continue;
        var doc = frames[i].contentDocument;
        var r = doc && doc.body && doc.caretRangeFromPoint(doc.body.clientWidth / 2, y - fr.top);
        if (!r) break;
        var node = r.startContainer;
        if (node.nodeType === 3 && r.startOffset < node.length) r.setEnd(node, r.startOffset + 1);
        var rect = r.getClientRects()[0] || r.getBoundingClientRect();
        var lineTop = rect ? rect.top + fr.top - top : 0;
        // Only cut a line that really is cut: at a chapter opening the first line
        // starts below the gap already, and covering it would hide the heading.
        if (rect && rect.height && lineTop < TOP_GAP - 1 &&
            rect.height < 3 * style.fontSize * style.lineHeight) {
          height = Math.max(height, Math.ceil(rect.bottom + fr.top - top + 2));
        }
        break;
      }
    }
    edgeTop.style.height = height + 'px';
  }

  function clipEdge() {
    if (!edge) {
      edge = document.createElement('div');
      edge.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2;pointer-events:none';
      document.body.appendChild(edge);
    }
    if (style) edge.style.background = style.page;
    var height = EDGE_GAP;
    var scroller = document.querySelector('.epub-container');
    if (scroller) {
      var bottom = scroller.getBoundingClientRect().bottom;
      var y = bottom - EDGE_GAP;
      var frames = scroller.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        var fr = frames[i].getBoundingClientRect();
        if (fr.top > y || fr.bottom <= y) continue;
        var doc = frames[i].contentDocument;
        var r = doc && doc.body && doc.caretRangeFromPoint(doc.body.clientWidth / 2, y - fr.top);
        if (!r) break;
        var node = r.startContainer;
        if (node.nodeType === 3 && r.startOffset < node.length) r.setEnd(node, r.startOffset + 1);
        var rect = r.getClientRects()[0] || r.getBoundingClientRect();
        // Only a text line straddling the edge; images are left as they are.
        if (rect && rect.height && rect.height < 3 * style.fontSize * style.lineHeight &&
            rect.top + fr.top < y && rect.bottom + fr.top > y) {
          height = Math.max(height, Math.ceil(bottom - (rect.top + fr.top) + 2));
        }
        break;
      }
    }
    edge.style.height = height + 'px';
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
      // The first line never touches the running head: the same 10px gap in
      // every theme, so night and paper open on identical spacing.
      'body{margin:0 auto!important;padding:10px ' + s.margin + 'px 0!important;max-width:36em!important;' +
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
    queueEdge();
    if (pdfDoc && pdfEl && pdfInverted !== !!s.invert) {
      pdfRender().catch(fail);
    }
    if (!rendition) return;
    var css = bookCss(s);
    rendition.getContents().forEach(function (c) {
      c.addStylesheetCss(css, 'pageturn');
    });
    // Layout changed: hold the reader on the same sentence.
    if (lastPosition && lastPosition.cfi) {
      var cfi = lastPosition.cfi;
      setTimeout(function () {
        if (rendition) show(cfi).catch(fail);
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
    return { text: sentence, stop: stop };
  }

  // Captions, plate credits and page-number debris are not where a reader
  // stopped; the card wants a line of prose.
  function isProse(sentence) {
    var t = sentence.trim();
    if (/^[\[(].*[\])]$/.test(t)) return false;
    return (t.match(/[A-Za-z\u00C0-\u024F]{2,}/g) || []).length >= 3 && /[a-z]/.test(t);
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
      // From the saved spot, take the first sentence that reads as prose.
      var blocks = Array.prototype.slice.call(block.ownerDocument.querySelectorAll('p,li,blockquote,dd'));
      var next = 0;
      while (next < blocks.length && (blocks[next] === block || block.contains(blocks[next]) ||
        !(block.compareDocumentPosition(blocks[next]) & Node.DOCUMENT_POSITION_FOLLOWING))) next++;
      for (var tries = 0; tries < 12; tries++) {
        while (offset < text.length) {
          var s = sentenceAt(text, offset);
          if (s.text && isProse(s.text)) return s.text;
          offset = Math.max(offset + 1, s.stop);
        }
        if (next >= blocks.length) break;
        text = (blocks[next++].textContent || '').replace(/\s+/g, ' ').trim();
        offset = 0;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Letters and digits only, so curly and straight quotes, dashes and line
  // breaks in the clipping cannot stop it matching the book.
  function plainText(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ').trim();
  }

  // Walk the spine looking for a block whose text contains the clipping's own
  // words. Returns where it is, not a CFI: epub.js can only scroll to a range,
  // so we scroll to the element ourselves once its section is on screen.
  function findPassage(needle) {
    var target = plainText(needle);
    if (!target || !book) return Promise.resolve(null);
    var items = (book.spine && book.spine.spineItems) || [];
    var chain = Promise.resolve(null);
    items.forEach(function (section) {
      chain = chain.then(function (found) {
        if (found) return found;
        return section.load(book.load.bind(book)).then(function () {
          var doc = section.document;
          // one pass over the section's whole text is far cheaper than
          // normalising every block, and most sections are a miss
          if (!doc || plainText(doc.body ? doc.body.textContent : '').indexOf(target) < 0) return null;
          // a long file can be split into several sections that share an href,
          // so identify the section by its own cfi base
          return { base: section.cfiBase, href: section.href, text: target };
        }).catch(function () {
          return null;
        });
      });
    });
    return chain;
  }

  // The block found above, in the section that is now displayed, at the top.
  function scrollToBlock(info) {
    var scroller = document.querySelector('.epub-container');
    if (!scroller || !rendition) return false;
    var hit = null;
    rendition.getContents().forEach(function (c) {
      if (hit) return;
      var sec = book.spine.get(c.sectionIndex);
      if (!sec || sec.cfiBase !== info.base) return;
      var blocks = c.document ? c.document.querySelectorAll(BLOCKS) : [];
      for (var i = 0; i < blocks.length; i++) {
        if (plainText(blocks[i].textContent).indexOf(info.text) >= 0) {
          hit = { el: blocks[i], frame: c.document.defaultView.frameElement };
          return;
        }
      }
    });
    if (!hit || !hit.frame) return false;
    var scrollerRect = scroller.getBoundingClientRect();
    var frameRect = hit.frame.getBoundingClientRect();
    var rect = hit.el.getBoundingClientRect();
    // Sit the block a little below the top edge so the page's whole-line cover
    // cannot swallow its first line.
    var top = frameRect.top - scrollerRect.top + scroller.scrollTop + rect.top - 40;
    scroller.scrollTop = Math.max(0, Math.round(top));
    return true;
  }

  // One authority over the scroll while a clipping jump is in flight: the
  // generic pin below must not pull the page back to the section start.
  var blockJump = null;
  var blockSettled = false;

  function jumpToBlock(info) {
    var started = Date.now();
    var until = started + 3000;
    blockJump = info;
    blockSettled = false;
    return new Promise(function (resolve) {
      (function step() {
        if (!rendition) { blockJump = null; return resolve(); }
        // the reader took over: leave it where they put it
        if (lastTouchAt > started) { blockJump = null; return resolve(); }
        scrollToBlock(info);
        if (Date.now() < until) return setTimeout(step, 180);
        // a late layout or an epub.js scroll can still move the page: hold it
        setTimeout(function () { if (lastTouchAt <= started) scrollToBlock(info); }, 800);
        setTimeout(function () {
          if (lastTouchAt <= started) scrollToBlock(info);
          blockJump = null;
          var at = blockOffset(info);
          if (at !== null && !blockSettled && at >= -8 && at <= 120) {
            blockSettled = true;
            console.log('[pageturn] jump offset', at);
          }
          if (at === null || at < -8 || at > 120) fail('not found');
          resolve();
        }, 1800);
      })();
    });
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
      lastTouchAt = t0;
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


  /* ---------------- PDF: one fixed page at a time ----------------
   * A PDF already has a design, so nothing reflows: one page, fitted whole,
   * zoomed with pinch or double-tap, and inverted in the night theme. */
  var pdfDoc = null;
  var pdfPageNo = 1;
  var pdfEl = null;
  var pdfZoom = 1;
  var pdfPan = { x: 0, y: 0 };
  var pdfBase = { w: 0, h: 0 };
  var pdfInverted = null;
  var pdfPill = null;
  var pdfPillTimer = 0;
  var tapTimer = 0;
  var lastTapAt = 0;
  var ZOOM_MAX = 4;
  var INSET = 10;

  function pdfClear() {
    if (pdfDoc) { try { pdfDoc.destroy(); } catch (e) { /* already gone */ } }
    pdfDoc = null;
    pdfEl = null;
    pdfPill = null;
    pdfZoom = 1;
    pdfPan = { x: 0, y: 0 };
    pdfInverted = null;
    lastPosition = null;
    document.getElementById('viewer').innerHTML = '';
  }

  // One clipped reading area, one stage that carries the zoom, one page canvas.
  function pdfMount() {
    var viewer = document.getElementById('viewer');
    viewer.innerHTML = '';
    if (edge) edge.style.display = 'none';
    if (edgeTop) edgeTop.style.display = 'none';
    var clip = document.createElement('div');
    clip.className = 'pdf-clip';
    var stage = document.createElement('div');
    stage.className = 'pdf-stage';
    var canvas = document.createElement('canvas');
    stage.appendChild(canvas);
    clip.appendChild(stage);
    viewer.appendChild(clip);
    pdfEl = { clip: clip, stage: stage, canvas: canvas };
    return pdfEl;
  }

  function showTextEdges() {
    if (edge) edge.style.display = '';
    if (edgeTop) edgeTop.style.display = '';
  }

  function pdfDist(a, b) {
    var dx = a.clientX - b.clientX;
    var dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy) || 1;
  }

  function pdfBox() {
    return pdfEl.clip.getBoundingClientRect();
  }

  function pdfApply() {
    if (!pdfEl) return;
    var box = pdfBox();
    var p = PDFVIEW.clampPan(pdfPan.x, pdfPan.y, pdfZoom, pdfBase.w, pdfBase.h, box.width, box.height);
    pdfPan.x = p.x;
    pdfPan.y = p.y;
    pdfEl.stage.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px) scale(' + pdfZoom + ')';
  }

  // The zoom pill is a control, not a notification: it appears while the page is
  // zoomed, says how far, and offers the way back to a whole page.
  function pdfPillShow() {
    if (!pdfEl) return;
    if (pdfZoom <= 1.02) {
      if (pdfPill) pdfPill.style.display = 'none';
      return;
    }
    if (!pdfPill) {
      pdfPill = document.createElement('div');
      pdfPill.id = 'pdf-pill';
      pdfPill.innerHTML = '<span></span><button type="button">Fit page</button>';
      pdfPill.querySelector('button').addEventListener('click', function () {
        pdfZoom = 1;
        pdfPan = { x: 0, y: 0 };
        pdfApply();
        pdfPillShow();
      });
      document.getElementById('viewer').appendChild(pdfPill);
    }
    pdfPill.querySelector('span').textContent = Math.round(pdfZoom * 100) + '%';
    pdfPill.style.display = 'flex';
    clearTimeout(pdfPillTimer);
    // long enough to read and tap, short enough to get out of the way
    pdfPillTimer = setTimeout(function () {
      if (pdfPill) pdfPill.style.display = 'none';
    }, 6000);
  }

  function pdfEmit() {
    post({
      type: 'relocated',
      bookId: bookId,
      cfi: 'page:' + pdfPageNo,
      page: pdfPageNo,
      pages: pdfDoc ? pdfDoc.numPages : null,
      percent: PDFVIEW.pagePercent(pdfPageNo, pdfDoc ? pdfDoc.numPages : 1),
      chapter: null,
      chapterLeftChars: null,
      bookLeftChars: null,
      lastLine: null,
    });
  }

  function pdfRender() {
    if (!pdfDoc || !pdfEl) return Promise.resolve();
    var pageNo = pdfPageNo;
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    return pdfDoc.getPage(pageNo).then(function (page) {
      if (!pdfEl || pageNo !== pdfPageNo) return;
      var vp1 = page.getViewport({ scale: 1 });
      var box = pdfBox();
      var fit = PDFVIEW.fitScale(vp1.width, vp1.height, box.width, box.height, INSET);
      pdfBase = { w: vp1.width * fit, h: vp1.height * fit };
      var vp = page.getViewport({ scale: fit * dpr });
      var canvas = pdfEl.canvas;
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      canvas.style.width = Math.round(pdfBase.w) + 'px';
      canvas.style.height = Math.round(pdfBase.h) + 'px';
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        if (!pdfEl || pageNo !== pdfPageNo) return;
        if (style && style.invert) {
          var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          PDFVIEW.invertPixels(img.data);
          ctx.putImageData(img, 0, 0);
        }
        pdfInverted = !!(style && style.invert);
        pdfApply();
      });
    });
  }

  function pdfGo(page) {
    if (!pdfDoc) return;
    var target = Math.max(1, Math.min(pdfDoc.numPages, page));
    if (target === pdfPageNo && pdfBase.w) return;
    pdfPageNo = target;
    pdfZoom = 1;
    pdfPan = { x: 0, y: 0 };
    pdfPillShow();
    pdfRender().then(pdfEmit).catch(fail);
  }

  // Pinch zooms; double-tap toggles fit <-> 2x on the spot; one finger pans a
  // zoomed page and turns the page when it is whole.
  function pdfInput() {
    var clip = pdfEl.clip;
    var pinch = null;
    var drag = null;

    clip.addEventListener('touchstart', function (e) {
      activity();
      if (e.touches.length === 2) {
        var r0 = pdfBox();
        pinch = {
          d: pdfDist(e.touches[0], e.touches[1]),
          zoom: pdfZoom,
          pan: { x: pdfPan.x, y: pdfPan.y },
          ax: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r0.left,
          ay: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r0.top,
        };
        drag = null;
      } else if (e.touches.length === 1) {
        drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), pan: { x: pdfPan.x, y: pdfPan.y }, moved: false };
      }
    }, { passive: true });

    clip.addEventListener('touchmove', function (e) {
      if (pinch && e.touches.length === 2) {
        var z = Math.max(1, Math.min(ZOOM_MAX, pinch.zoom * (pdfDist(e.touches[0], e.touches[1]) / pinch.d)));
        var t = PDFVIEW.zoomAround(pinch.ax, pinch.ay, pinch.pan.x, pinch.pan.y, pinch.zoom, z);
        pdfZoom = z;
        pdfPan.x = t.x;
        pdfPan.y = t.y;
        pdfApply();
        pdfPillShow();
        return;
      }
      if (!drag || e.touches.length !== 1) return;
      var dx = e.touches[0].clientX - drag.x;
      var dy = e.touches[0].clientY - drag.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) drag.moved = true;
      if (pdfZoom > 1.02) {
        pdfPan.x = drag.pan.x + dx;
        pdfPan.y = drag.pan.y + dy;
        pdfApply();
      }
    }, { passive: true });

    clip.addEventListener('touchend', function (e) {
      if (pinch) {
        if (e.touches.length < 2) pinch = null;
        if (!e.touches.length) pdfPillShow();
        return;
      }
      if (!drag) return;
      var dx = (e.changedTouches[0] ? e.changedTouches[0].clientX : drag.x) - drag.x;
      var dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : drag.y) - drag.y;
      var quick = Date.now() - drag.t < 400;
      var startX = drag.x;
      var startY = drag.y;
      drag = null;
      if (pdfZoom <= 1.02 && quick && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        pdfGo(pdfPageNo + (dx < 0 ? 1 : -1));
        return;
      }
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return;
      if (!quick) return;
      var now = Date.now();
      if (now - lastTapAt < 320) {
        lastTapAt = 0;
        clearTimeout(tapTimer);
        var r = pdfBox();
        var z = pdfZoom > 1.2 ? 1 : 2;
        var t2 = PDFVIEW.zoomAround(startX - r.left, startY - r.top, pdfPan.x, pdfPan.y, pdfZoom, z);
        pdfZoom = z;
        pdfPan.x = z === 1 ? 0 : t2.x;
        pdfPan.y = z === 1 ? 0 : t2.y;
        pdfApply();
        pdfPillShow();
        return;
      }
      lastTapAt = now;
      // A tap in the middle is the controls; wait out a possible second tap first.
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () {
        post({ type: 'tap' });
      }, 330);
    }, { passive: true });
  }

  function pdfThumb() {
    return pdfDoc.getPage(1).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: Math.min(1, 168 / vp1.width) });
      var c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        return c.toDataURL('image/jpeg', 0.7);
      });
    }).catch(function () {
      return null;
    });
  }

  function pdfOpen(msg) {
    var token = ++opening;
    destroy();
    bookId = msg.bookId;
    style = msg.style;
    applyStyle(style);
    pdfInverted = !!style.invert;
    pdfPageNo = Math.max(1, msg.page || 1);
    var bytes = new Uint8Array(b64ToBuffer(chunks.join('')));
    chunks = [];
    var loading = pdfjsLib.getDocument({
      data: bytes,
      // The main thread already carries the worker: nothing is fetched.
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    return loading.promise.then(function (doc) {
      if (token !== opening) { doc.destroy(); return; }
      pdfDoc = doc;
      pdfMount();
      pdfInput();
      return pdfDoc.getMetadata().catch(function () { return { info: {} }; }).then(function (meta) {
        if (token !== opening) return;
        var info = (meta && meta.info) || {};
        return pdfThumb().then(function (cover) {
          if (token !== opening) return;
          post({
            type: 'opened',
            bookId: bookId,
            title: info.Title || null,
            author: info.Author || null,
            cover: cover,
            toc: [],
            pages: pdfDoc.numPages,
          });
          return pdfRender().then(pdfEmit);
        });
      });
    }).catch(function (e) {
      fail(e);
    });
  }

  function destroy() {
    if (rendition) {
      try { rendition.destroy(); } catch (e) { /* already gone */ }
    }
    if (book) {
      try { book.destroy(); } catch (e) { /* already gone */ }
    }
    showTextEdges();
    rendition = null;
    book = null;
    spineLocations = null;
    tocMarks = null;
    lastPosition = null;
    toc = [];
    pdfClear();
  }

  function open(msg) {
    if (msg.format === 'pdf') return pdfOpen(msg);
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
      if (token === opening) {
        emitPosition(location);
        queueEdge();
      }
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
        return show(msg.cfi || undefined).catch(function () {
          return rendition.display();
        });
      });
    }).then(function () {
      if (token !== opening || current !== book) return;
      var scroller = document.querySelector('.epub-container');
      if (scroller) {
        scroller.addEventListener('scroll', activity, { passive: true });
        scroller.addEventListener('scroll', queueEdge, { passive: true });
      }
      queueEdge();
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
        if (rendition) show(msg.target).catch(fail);
        break;
      case 'page':
        pdfGo(msg.page);
        break;
      case 'find':
        // A Kindle clipping carries a location, not a CFI: find its own words
        // and put that block at the top of the page.
        if (rendition) {
          var token = ++showing;
          findPassage(msg.text).then(function (info) {
            if (token !== showing) return;
            if (!info) { fail('not found'); return; }
            return rendition.display(info.href).then(settled).then(function () {
              if (token !== showing) return;
              queueEdge();
              return jumpToBlock(info);
            });
          }).catch(fail);
        }
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
  window.addEventListener('resize', queueEdge);
  document.addEventListener('message', onMessage);
  window.onerror = function (m) { fail(m); };
  window.addEventListener('unhandledrejection', function (e) { fail(e.reason); });
  post({ type: 'ready' });
})();
