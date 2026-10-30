/* PDF view maths and the night invert. Plain ES5 so the Android WebView
 * runs it untranspiled, and also require-able from node for the tests. */
(function (root) {
  'use strict';

  /* Fit a page of pageW x pageH inside boxW x boxH with an even inset.
   * One page at a time, whole: the smaller of the two ratios wins. */
  function fitScale(pageW, pageH, boxW, boxH, inset) {
    var w = Math.max(1, boxW - inset * 2);
    var h = Math.max(1, boxH - inset * 2);
    if (!pageW || !pageH) return 1;
    return Math.min(w / pageW, h / pageH);
  }

  /* Keep the scaled page inside its box. Smaller than the box on an axis means
   * centred; larger means it may pan but never shows a blank gutter. */
  function axisPan(t, scaledPage, box) {
    if (scaledPage <= box) return Math.round((box - scaledPage) / 2);
    return Math.round(Math.min(0, Math.max(box - scaledPage, t)));
  }

  function clampPan(tx, ty, zoom, pageW, pageH, boxW, boxH) {
    return { x: axisPan(tx, pageW * zoom, boxW), y: axisPan(ty, pageH * zoom, boxH) };
  }

  /* Anchor a zoom change on a point in the box so the word under the finger
   * stays under the finger. */
  function zoomAround(px, py, tx, ty, from, to) {
    var k = to / from;
    return { x: px - (px - tx) * k, y: py - (py - ty) * k };
  }

  /* A night PDF is an inverted page, not a black one: paper becomes a dark warm
   * ground, print becomes the night prose colour, and every tone in between maps
   * across the same range. Pure luminance so text never turns to mud. */
  var PAPER = [0x14, 0x14, 0x0f];
  var INK = [0xe6, 0xe0, 0xd5];

  function invertPixels(data, paper, ink) {
    var p = paper || PAPER;
    var i = ink || INK;
    for (var n = 0; n < data.length; n += 4) {
      var l = (0.2126 * data[n] + 0.7152 * data[n + 1] + 0.0722 * data[n + 2]) / 255;
      // Black ink (l = 0) lands on INK, white paper (l = 1) on PAPER.
      var t = 1 - l;
      data[n] = Math.round(p[0] + (i[0] - p[0]) * t);
      data[n + 1] = Math.round(p[1] + (i[1] - p[1]) * t);
      data[n + 2] = Math.round(p[2] + (i[2] - p[2]) * t);
      data[n + 3] = 255;
    }
    return data;
  }

  /* Where the reader is, for the strip under the page. */
  function pagePercent(page, pages) {
    if (!pages || pages < 1) return 0;
    return Math.min(1, Math.max(0, (page - 1) / pages));
  }

  var api = { fitScale: fitScale, clampPan: clampPan, zoomAround: zoomAround, invertPixels: invertPixels, pagePercent: pagePercent, PAPER: PAPER, INK: INK };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PDFVIEW = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
