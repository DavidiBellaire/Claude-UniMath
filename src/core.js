// ===========================================================================
// Claude-UniMath — BiDi Core Engine
//
// Author: Davidi Bellaire (github.com/DavidiBellaire)
//
// The problem every existing RTL patch leaves unsolved:
//   When an RTL language (Hebrew, Arabic, Persian, Urdu, …) is mixed with
//   English and with mathematics, naive "detect RTL -> align the whole line
//   right" flips everything and scatters the math. A line such as
//
//       הערך העצמי הוא $\lambda = 3$ עם ריבוי אלגברי $2$
//
//   becomes unreadable: the formula lands in the wrong place and its symbols
//   reverse. The same happens to inline English and to rendered KaTeX.
//
// Our approach is fundamentally different:
//   We do NOT force a direction on whole lines. We let the browser's native
//   Unicode BiDi algorithm do its job, and we ISOLATE each island of math
//   (rendered KaTeX nodes *and* raw LaTeX text) as an atomic left-to-right
//   unit via `unicode-bidi: isolate`. The RTL prose then flows right-to-left
//   naturally around math that stays intact.
//
// This file is the pure, DOM-free core so it can be unit-tested directly.
// The DOM layer (dom.js) and the runtime wiring (runtime.js) build on it.
//
// Everything between the <payload> markers is copied verbatim into
// src/payload.js by scripts/build.js. Edit here, then run `npm run build`.
// ===========================================================================

'use strict';

// <payload>
// --- Strong-RTL detection across ALL right-to-left Unicode scripts ----------
// BiDi is defined by Unicode block, not by "language", so generalizing to
// every RTL script is just a matter of listing the blocks. These are the
// ranges Unicode assigns a strong right-to-left directional property (R or
// AL). Auditable at a glance, deliberately not hidden behind a mega-regex.
const RTL_RANGES = [
  [0x0590, 0x05ff], // Hebrew
  [0x0600, 0x06ff], // Arabic
  [0x0700, 0x074f], // Syriac
  [0x0750, 0x077f], // Arabic Supplement
  [0x0780, 0x07bf], // Thaana (Dhivehi/Maldivian)
  [0x07c0, 0x07ff], // NKo
  [0x0800, 0x083f], // Samaritan
  [0x0840, 0x085f], // Mandaic
  [0x0860, 0x086f], // Syriac Supplement
  [0x0870, 0x089f], // Arabic Extended-B
  [0x08a0, 0x08ff], // Arabic Extended-A
  [0xfb1d, 0xfb4f], // Hebrew Presentation Forms
  [0xfb50, 0xfdff], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff], // Arabic Presentation Forms-B
  // Astral (supplementary plane) RTL scripts:
  [0x10800, 0x1083f], // Cypriot Syllabary
  [0x10840, 0x1085f], // Imperial Aramaic
  [0x10860, 0x1087f], // Palmyrene
  [0x10880, 0x108af], // Nabataean
  [0x108e0, 0x108ff], // Hatran
  [0x10900, 0x1091f], // Phoenician
  [0x10920, 0x1093f], // Lydian
  [0x10a00, 0x10a5f], // Kharoshthi
  [0x10a60, 0x10a7f], // Old South Arabian
  [0x10a80, 0x10a9f], // Old North Arabian
  [0x10ac0, 0x10aff], // Manichaean
  [0x10b00, 0x10b3f], // Avestan
  [0x10b40, 0x10b5f], // Inscriptional Parthian
  [0x10b60, 0x10b7f], // Inscriptional Pahlavi
  [0x10b80, 0x10baf], // Psalter Pahlavi
  [0x10c00, 0x10c4f], // Old Turkic
  [0x10c80, 0x10cff], // Old Hungarian
  [0x10d00, 0x10d3f], // Hanifi Rohingya
  [0x10e80, 0x10ebf], // Yezidi
  [0x10f00, 0x10f2f], // Old Sogdian
  [0x10f30, 0x10f6f], // Sogdian
  [0x10f70, 0x10faf], // Old Uyghur
  [0x10fb0, 0x10fdf], // Chorasmian
  [0x10fe0, 0x10fff], // Elymaic
  [0x1e800, 0x1e8df], // Mende Kikakui
  [0x1e900, 0x1e95f], // Adlam
  [0x1ec70, 0x1ecbf], // Indic Siyaq Numbers
  [0x1ed00, 0x1ed4f], // Ottoman Siyaq Numbers
  [0x1ee00, 0x1eeff], // Arabic Mathematical Alphabetic Symbols
];

function isStrongRTL(ch) {
  const code = ch.codePointAt(0);
  // Fast exits. Nearly every character on screen is below the first RTL
  // block (ASCII, Latin, Greek, Cyrillic) or in the long gap between the
  // Arabic blocks and the presentation forms (CJK, symbols, emoji).
  if (code < 0x0590) return false;
  if (code > 0x08ff && code < 0xfb1d) return false;
  for (let i = 0; i < RTL_RANGES.length; i++) {
    if (code >= RTL_RANGES[i][0] && code <= RTL_RANGES[i][1]) return true;
  }
  return false;
}

// A character with a strong left-to-right direction: any letter, in any
// script, that is not RTL. Latin, Greek, Cyrillic, CJK and the rest all count.
const ANY_LETTER = /\p{L}/u;
function isStrongLTR(ch) {
  const code = ch.codePointAt(0);
  if (code < 0x80) return (code | 32) >= 97 && (code | 32) <= 122; // a-z, A-Z
  return ANY_LETTER.test(ch) && !isStrongRTL(ch);
}

// Does the text contain ANY strong-RTL character?
function containsRTL(text) {
  if (!text) return false;
  for (const ch of text) {
    if (isStrongRTL(ch)) return true;
  }
  return false;
}

// First-strong heuristic: returns 'rtl', 'ltr', or null based on the first
// character with a strong direction. Used for the box the user types in.
function firstStrongDir(text) {
  if (!text) return null;
  for (const ch of text) {
    if (isStrongRTL(ch)) return 'rtl';
    if (isStrongLTR(ch)) return 'ltr';
  }
  return null;
}

// --- Base direction of a block of prose --------------------------------------
// Neither of the two obvious rules is good enough for real mixed text:
//
//   "any RTL character -> RTL"   flips an English paragraph that merely
//                                quotes one Hebrew word.
//   "first strong character"     leaves a Hebrew paragraph left-to-right
//                                because it opens with "React" or "Python".
//
// So a block is RTL when it starts with an RTL letter, OR when RTL letters
// make up a meaningful share of its letters. Math and code are removed by
// the caller before counting, so a formula full of Latin letters never
// outvotes the sentence around it.
const RTL_SHARE = 0.3;
function proseDirection(text) {
  if (!text) return null;
  let rtl = 0;
  let ltr = 0;
  let first = null;
  for (const ch of text) {
    if (isStrongRTL(ch)) {
      rtl++;
      if (!first) first = 'rtl';
    } else if (isStrongLTR(ch)) {
      ltr++;
      if (!first) first = 'ltr';
    }
  }
  if (rtl === 0) return ltr > 0 ? 'ltr' : null;
  if (first === 'rtl') return 'rtl';
  return rtl / (rtl + ltr) >= RTL_SHARE ? 'rtl' : 'ltr';
}

// --- LaTeX detection: real math versus a stray currency "$" ------------------
// Characters that only appear in LaTeX source. A "$…$" body containing one is
// math no matter how it is spaced.
const LATEX_SIGNAL = /[\\^_{}]/;

// Unambiguous delimiters (no currency collision). Non-greedy.
const BRACKET_PATTERNS = [
  /\$\$([\s\S]+?)\$\$/g,                             // $$ ... $$   display
  /\\\[([\s\S]+?)\\\]/g,                             // \[ ... \]   display
  /\\\(([\s\S]+?)\\\)/g,                             // \( ... \)   inline
  /\\begin\{([a-zA-Z*]+)\}[\s\S]+?\\end\{\1\}/g,     // \begin{env} ... \end{env}
];

// Is the text between two "$" signs math?
//
// Bodies with LaTeX structure are always math. For plain bodies such as
// "$x$", "$n+1$" or "$f(x) = 2x$" we apply the delimiter rule TeX-aware
// Markdown parsers use: the opening "$" hugs its content, the closing "$"
// hugs its content and is not followed by a digit. That is what tells
// "$x$" apart from "$20 and $30". Words in an RTL script are prose, never a
// formula, so a body containing them is rejected.
function isInlineMath(text, open, close) {
  const body = text.slice(open + 1, close);
  if (body.length === 0 || body.indexOf('\n') !== -1) return false;
  if (LATEX_SIGNAL.test(body)) return true;
  if (/\s/.test(body[0]) || /\s/.test(body[body.length - 1])) return false;
  const after = text[close + 1];
  if (after !== undefined && after >= '0' && after <= '9') return false;
  if (containsRTL(body)) return false;
  return true;
}

// Single-$ inline math is ambiguous with currency, so a plain "first matching
// pair" regex is unsafe: a stray "$" (e.g. "$20") would steal the closing
// delimiter of real math later in the same line. We instead scan dollar
// positions and test each neighbouring pair; a rejected opening "$" is
// skipped individually so it cannot consume a later real delimiter.
function findInlineDollarRanges(text, claimed) {
  const ranges = [];
  const dollars = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '$') continue;
    if (i > 0 && text[i - 1] === '\\') continue; // escaped \$
    if (claimed[i]) continue;                     // already inside $$...$$
    dollars.push(i);
  }

  let k = 0;
  while (k < dollars.length - 1) {
    const open = dollars[k];
    const close = dollars[k + 1];
    if (isInlineMath(text, open, close)) {
      ranges.push({ start: open, end: close + 1 });
      k += 2;
    } else {
      k += 1;
    }
  }
  return ranges;
}

// Return non-overlapping, sorted {start,end} ranges of `text` that are math.
function findLatexRanges(text) {
  if (!text) return [];
  const ranges = [];
  const claimed = new Array(text.length).fill(false);

  // Pass 1: unambiguous delimiters (display first).
  for (let p = 0; p < BRACKET_PATTERNS.length; p++) {
    const re = new RegExp(BRACKET_PATTERNS[p].source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      let overlaps = false;
      for (let i = start; i < end; i++) {
        if (claimed[i]) { overlaps = true; break; }
      }
      if (overlaps) continue;
      for (let i = start; i < end; i++) claimed[i] = true;
      ranges.push({ start, end });
    }
  }

  // Pass 2: ambiguous single-$ inline, currency-aware.
  const inline = findInlineDollarRanges(text, claimed);
  for (const r of inline) ranges.push(r);

  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

// Segment text into ordered pieces tagged as 'math' or 'text'. This is what
// the DOM layer uses to rebuild a text node as a mix of isolated-LTR math
// spans and plain RTL-flowing text.
function segmentText(text) {
  const ranges = findLatexRanges(text);
  if (ranges.length === 0) return [{ type: 'text', value: text }];

  const segments = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, r.start) });
    }
    segments.push({ type: 'math', value: text.slice(r.start, r.end) });
    cursor = r.end;
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) });
  }
  return segments;
}
// </payload>

module.exports = {
  RTL_RANGES,
  RTL_SHARE,
  isStrongRTL,
  isStrongLTR,
  containsRTL,
  firstStrongDir,
  proseDirection,
  findLatexRanges,
  segmentText,
  LATEX_SIGNAL,
};
