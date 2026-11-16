// ===========================================================================
// Claude-UniMath — DOM Layer
//
// Author: Davidi Bellaire (github.com/DavidiBellaire)
//
// Consumes the pure core (core.js) and applies its decisions to the live DOM:
//   1. Rendered math  — marks KaTeX/MathJax nodes as isolated LTR islands.
//   2. Raw LaTeX text — splits text nodes into RTL prose + isolated LTR math.
//   3. Prose          — sets the base direction of each block of text.
//   4. Lists, tables  — mirrors them when most of their content is RTL, and
//                       keeps the left-to-right items inside them readable.
//   5. Code           — <pre>/<code> are always forced LTR, never treated as
//                       prose, and never scanned for "$" math.
//
// Everything is idempotent and marked with data-attributes, so re-processing
// the same node (during streaming) does no damage and no double work. Every
// inline style we change is remembered and put back if a block stops being
// RTL.
//
// Everything between the <payload> markers is copied verbatim into
// src/payload.js by scripts/build.js. Edit here, then run `npm run build`.
// ===========================================================================

'use strict';

const { containsRTL, firstStrongDir, proseDirection, segmentText } = require('./core.js');

// <payload>
const PROCESSED = 'data-unimath';        // "rtl" on RTL prose, "ltr" on LTR prose inside a mirrored list or table
const ISLAND = 'data-unimath-island';    // marks a math island
const SAVED = 'data-unimath-saved';      // the inline styles an element had before we changed them
const LIST = 'data-unimath-list';        // marks a mirrored list
const TABLE = 'data-unimath-table';      // marks a mirrored table
const QUOTE = 'data-unimath-quote';      // marks a blockquote whose bar was moved

const INPUT_SEL = '[data-testid="chat-input"]';

// While a reply is still being written, the app owns its text nodes and keeps
// rewriting them. Splitting those nodes mid-stream fights the app's own
// renderer, so raw LaTeX there is left alone until the reply is finished.
// Rendered math, prose direction, lists and tables are attribute and style
// changes only, so they stay live during streaming.
const STREAMING_SEL = '[data-is-streaming="true"]';

// Math that the app has ALREADY rendered to DOM nodes.
const RENDERED_MATH_SEL = '.katex, .katex-display, mjx-container, .MathJax, math';

const CODE_SEL = 'pre, code, .code-block__code';

// Block-level elements whose text we treat as prose.
const PROSE_SEL =
  'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, summary, label, dt, dd, figcaption';

// Text inside these never counts when deciding a block's direction.
const NOT_PROSE_SEL = CODE_SEL + ', ' + RENDERED_MATH_SEL + ', [' + ISLAND + ']';

function isInsideCode(node) {
  return !!(node.closest && node.closest(CODE_SEL));
}
function isInsideInput(node) {
  return !!(node.closest && node.closest(INPUT_SEL));
}

// Elements under `scope` matching `selector`, INCLUDING `scope` itself. The
// streaming observer usually hands us the changed paragraph itself, and a
// plain querySelectorAll would skip exactly the element that changed.
function withSelf(scope, selector) {
  const found = Array.from(scope.querySelectorAll(selector));
  if (scope.matches && scope.matches(selector)) found.unshift(scope);
  return found;
}

// --- Remembering styles ----------------------------------------------------
// Before changing an inline style we record what the app had there, so a
// block that stops being RTL can be put back exactly as it was.
function setStyles(el, styles) {
  let saved;
  try { saved = JSON.parse(el.getAttribute(SAVED) || '{}'); } catch (e) { saved = {}; }
  for (const prop in styles) {
    if (!(prop in saved)) saved[prop] = el.style[prop] || '';
    el.style[prop] = styles[prop];
  }
  el.setAttribute(SAVED, JSON.stringify(saved));
}
function restoreStyles(el) {
  const raw = el.getAttribute(SAVED);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    for (const prop in saved) el.style[prop] = saved[prop];
  } catch (e) { /* nothing to restore */ }
  el.removeAttribute(SAVED);
}

// --- 1. Isolate rendered math nodes ------------------------------------------
function isolateRenderedMath(scope) {
  for (const el of withSelf(scope, RENDERED_MATH_SEL)) {
    if (el.getAttribute(ISLAND) === 'rendered') continue;
    if (isInsideCode(el)) continue;
    el.setAttribute(ISLAND, 'rendered');
    el.style.unicodeBidi = 'isolate';
    el.style.direction = 'ltr';
  }
}

// --- 2. Split raw-LaTeX text nodes into prose + isolated math islands --------
// We walk text nodes (not innerHTML) so we never disturb event listeners or
// other elements. Only text nodes that actually contain a math delimiter are
// rewritten, and each becomes a fragment of [text, <span LTR>math</span>, …].
function isolateRawLatex(scope) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      const value = node.nodeValue;
      if (!value || (value.indexOf('$') === -1 && value.indexOf('\\') === -1)) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (isInsideCode(parent) || isInsideInput(parent)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('[' + ISLAND + ']')) return NodeFilter.FILTER_REJECT;
      if (parent.closest(STREAMING_SEL)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets = [];
  let n;
  while ((n = walker.nextNode())) targets.push(n);

  for (const textNode of targets) {
    const segments = segmentText(textNode.nodeValue);
    if (segments.length === 1 && segments[0].type === 'text') continue;

    const frag = document.createDocumentFragment();
    for (const seg of segments) {
      if (seg.type === 'math') {
        const span = document.createElement('span');
        span.setAttribute(ISLAND, 'raw');
        span.style.unicodeBidi = 'isolate';
        span.style.direction = 'ltr';
        span.textContent = seg.value;
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(seg.value));
      }
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

// --- 3. Set the base direction of prose blocks -------------------------------
// The words of a block, without its math and code. Those are full of Latin
// letters that say nothing about the language of the sentence around them.
function proseText(el) {
  if (!el.querySelector(NOT_PROSE_SEL)) return el.textContent || '';
  let text = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (parent && parent.closest(NOT_PROSE_SEL)) continue;
    text += node.nodeValue;
  }
  return text;
}

function applyProseDirection(scope) {
  for (const el of withSelf(scope, PROSE_SEL)) {
    if (isInsideCode(el) || isInsideInput(el)) continue;

    const rtl = containsRTL(el.textContent || '') && proseDirection(proseText(el)) === 'rtl';
    if (!rtl) {
      // Not RTL (any more): undo anything we did to this block earlier.
      if (el.getAttribute(PROCESSED) === 'rtl') {
        restoreStyles(el);
        el.removeAttribute(PROCESSED);
        el.removeAttribute(QUOTE);
      }
      continue;
    }

    if (el.getAttribute(PROCESSED) !== 'rtl' || el.style.direction !== 'rtl') {
      el.setAttribute(PROCESSED, 'rtl');
      setStyles(el, { direction: 'rtl', textAlign: 'start' });
    }

    // Isolate inline atoms (citation chips, badges, buttons) embedded in
    // RTL prose. Without this, an inline-block element sandwiched between
    // Hebrew/Arabic words is positioned by the BiDi algorithm as if the
    // surrounding direction were LTR, so it jumps to the wrong side of the
    // line. `unicode-bidi: isolate` makes it a neutral atom that sits
    // correctly in the RTL flow.
    isolateInlineAtoms(el);

    if (el.tagName === 'BLOCKQUOTE') mirrorQuote(el);
  }
}

// A quote is usually drawn with a bar on its left edge. In RTL that bar
// belongs on the right, where the line starts.
function mirrorQuote(el) {
  if (el.getAttribute(QUOTE)) return;
  el.setAttribute(QUOTE, '1');
  const cs = getComputedStyle(el);
  const left = parseFloat(cs.borderLeftWidth) || 0;
  const right = parseFloat(cs.borderRightWidth) || 0;
  if (left > 0 && right === 0) {
    setStyles(el, {
      borderRight: cs.borderLeftWidth + ' ' + cs.borderLeftStyle + ' ' + cs.borderLeftColor,
      borderLeftWidth: '0px',
      paddingRight: cs.paddingLeft,
      paddingLeft: cs.paddingRight,
      marginRight: cs.marginLeft,
      marginLeft: cs.marginRight,
    });
  }
}

// Within an RTL prose element, find inline atoms that need isolation. An
// "atom" is a direct-child element that renders inline-ish and does NOT
// itself contain prose text we flow. Citation chips, footnote markers, and
// small badges are the main case: they sit between RTL words and, without
// isolation, the BiDi algorithm drops them on the wrong side of the line.
//
// Detection is robust to how `display` is set (class vs inline style):
//   - explicit inline-block/inline-flex computed display, OR
//   - tags that are inherently atom-like (BUTTON/SUP/SUB), OR
//   - an element whose text is short (chip-like), which catches class-styled
//     citation chips even when computed display is unavailable.
// We never isolate an element that contains block descendants, and never
// re-isolate something already handled (math islands) or a code block.
const ATOM_TAGS = /^(BUTTON|SUP|SUB)$/;
function looksLikeChip(el) {
  const txt = (el.textContent || '').trim();
  return txt.length <= 24; // icon-only, or a short label like "Chrome Web Store"
}
function isolateInlineAtoms(prose) {
  const children = prose.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.getAttribute(ISLAND)) continue;            // math island
    if (child.matches && child.matches(CODE_SEL)) continue;
    if (child.dataset && child.dataset.unimathAtom) continue;

    const hasBlockChild = child.querySelector
      ? child.querySelector('p, div, ul, ol, h1, h2, h3, h4, h5, h6, pre, table, li')
      : null;
    if (hasBlockChild) continue;

    let display = '';
    try { display = getComputedStyle(child).display; } catch (e) { display = ''; }
    const inlineish =
      display === 'inline-block' ||
      display === 'inline-flex' ||
      ATOM_TAGS.test(child.tagName) ||
      // class-styled chip whose computed display we can't read but whose
      // shape (short, label-like, an anchor or span) matches a chip:
      ((child.tagName === 'A' || child.tagName === 'SPAN') && looksLikeChip(child));

    if (!inlineish) continue;

    child.dataset.unimathAtom = '1';
    child.style.unicodeBidi = 'isolate';
  }
}

// --- 4. Lists and tables -----------------------------------------------------
// A left-to-right item inside a mirrored list or table (an English bullet, a
// cell holding "-5" or "Node.js (v20).") would inherit the RTL base direction
// and show its punctuation and minus signs on the wrong side. Marking it
// lets the stylesheet give it `unicode-bidi: plaintext`: its own text decides
// its direction while it stays lined up with its RTL neighbours.
function markLtr(el, on) {
  const state = el.getAttribute(PROCESSED);
  if (on && state !== 'rtl') {
    if (state !== 'ltr') el.setAttribute(PROCESSED, 'ltr');
  } else if (state === 'ltr') {
    el.removeAttribute(PROCESSED);
  }
}

function childItems(list) {
  const items = [];
  for (let i = 0; i < list.children.length; i++) {
    if (list.children[i].tagName === 'LI') items.push(list.children[i]);
  }
  return items;
}

// Containers under `scope`, the scope itself, and the nearest one around it
// (a changed <li> has to re-evaluate the list it belongs to).
function containers(scope, selector) {
  const found = withSelf(scope, selector);
  const outer = scope.parentElement ? scope.parentElement.closest(selector) : null;
  if (outer) found.push(outer);
  return found;
}

// A list is mirrored (bullets and numbers on the right) when at least half
// of its items are RTL.
function applyListDirection(scope) {
  for (const list of containers(scope, 'ul, ol')) {
    if (isInsideCode(list) || isInsideInput(list)) continue;
    const items = childItems(list);
    let rtl = 0;
    for (const li of items) if (li.getAttribute(PROCESSED) === 'rtl') rtl++;
    const flip = items.length > 0 && rtl * 2 >= items.length;

    if (flip) {
      if (list.getAttribute(LIST) !== 'rtl') {
        list.setAttribute(LIST, 'rtl');
        const styles = { direction: 'rtl' };
        // The app pads lists on the left to make room for bullets. Move
        // that room to the right, where the bullets now are.
        const pad = parseFloat(getComputedStyle(list).paddingLeft) || 0;
        if (pad > 0) {
          styles.paddingRight = pad + 'px';
          styles.paddingLeft = '0';
        }
        setStyles(list, styles);
      }
    } else if (list.getAttribute(LIST) === 'rtl') {
      restoreStyles(list);
      list.removeAttribute(LIST);
    }

    for (const li of items) {
      const ltr = flip && li.getAttribute(PROCESSED) !== 'rtl';
      markLtr(li, ltr);
      // "Loose" list items wrap their text in a <p>.
      for (let i = 0; i < li.children.length; i++) {
        if (li.children[i].tagName === 'P') markLtr(li.children[i], ltr);
      }
    }
  }
}

// A table's columns run right-to-left when its header row is mostly RTL
// (or, with no header row, when most of its cells are).
function applyTableDirection(scope) {
  for (const table of containers(scope, 'table')) {
    if (isInsideCode(table)) continue;
    const head = table.querySelectorAll('th');
    const deciding = head.length ? head : table.querySelectorAll('td');
    let rtl = 0;
    let counted = 0;
    for (const cell of deciding) {
      if (!(cell.textContent || '').trim()) continue;
      counted++;
      if (cell.getAttribute(PROCESSED) === 'rtl') rtl++;
    }
    const flip = counted > 0 && rtl * 2 >= counted;

    if (flip) {
      if (table.getAttribute(TABLE) !== 'rtl') {
        table.setAttribute(TABLE, 'rtl');
        setStyles(table, { direction: 'rtl' });
      }
    } else if (table.getAttribute(TABLE) === 'rtl') {
      restoreStyles(table);
      table.removeAttribute(TABLE);
    }

    for (const cell of table.querySelectorAll('th, td')) {
      markLtr(cell, flip && cell.getAttribute(PROCESSED) !== 'rtl');
    }
  }
}

// --- 5. Force code blocks LTR ------------------------------------------------
function forceCodeLTR(scope) {
  for (const el of withSelf(scope, CODE_SEL)) {
    if (el.style.direction === 'ltr' && el.dir === 'ltr') continue;
    el.dir = 'ltr';
    el.style.direction = 'ltr';
    el.style.unicodeBidi = 'isolate';
    el.style.textAlign = 'left';
  }
}

// --- 6. The chat input box ---------------------------------------------------
function applyInputDirection() {
  const inputs = document.querySelectorAll(INPUT_SEL);
  for (const input of inputs) {
    const text = input.textContent || input.value || '';
    if (firstStrongDir(text) === 'rtl') {
      input.style.direction = 'rtl';
      input.style.textAlign = 'right';
    } else {
      input.style.direction = '';
      input.style.textAlign = '';
    }
  }
}

// --- Orchestration -----------------------------------------------------------
// Order matters: isolate rendered math and raw LaTeX BEFORE setting prose
// direction, so the islands exist (and are left out of the letter count)
// when each block's direction is decided. Lists and tables come last because
// they are decided by the direction of the blocks inside them.
function processScope(scope) {
  if (!scope || scope.nodeType !== 1) scope = document.body;
  if (!scope) return;
  try {
    forceCodeLTR(scope);
    isolateRenderedMath(scope);
    isolateRawLatex(scope);
    applyProseDirection(scope);
    applyListDirection(scope);
    applyTableDirection(scope);
  } catch (e) {
    console.error('[Claude-UniMath] processScope:', e);
  }
}

function processAll() {
  processScope(document.body);
  applyInputDirection();
}
// </payload>

module.exports = {
  processScope,
  processAll,
  applyInputDirection,
  _selectors: { INPUT_SEL, CODE_SEL, PROSE_SEL, RENDERED_MATH_SEL, STREAMING_SEL },
};
