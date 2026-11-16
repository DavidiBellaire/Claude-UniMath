// ===========================================================================
// Claude-UniMath — Browser Payload
//
// Author: Davidi Bellaire (github.com/DavidiBellaire)
//
// GENERATED FILE. Do not edit it by hand.
// It is built from src/core.js, src/dom.js and src/runtime.js by
// scripts/build.js. Change those files, then run:  npm run build
//
// This is the self-contained script injected into Claude Desktop's renderer.
// Safe to prepend to any bundle: it bails out if `document` is undefined,
// keeps everything inside one function, and is wrapped in marker comments
// so the installer can detect an already-patched file and skip it.
// ===========================================================================

// --- CLAUDE-UNIMATH START ---
;(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  try {
    // =====================================================================
    // from src/core.js
    // =====================================================================
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

    // =====================================================================
    // from src/dom.js
    // =====================================================================
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

    // =====================================================================
    // from src/runtime.js
    // =====================================================================
    const VERSION = '1.1.0';
    const ACTIVE = 'data-unimath-active';

    // A changed node is re-processed together with the list, table or quote it
    // lives in, because those are decided by all of their items together.
    const CONTAINER_SEL = 'ul, ol, table, blockquote, dl';

    // --- Base stylesheet ---------------------------------------------------------
    // The script also sets inline styles. These rules are the safety net for the
    // moments in between, and they win over the app's own classes.
    function injectStyles() {
      if (document.getElementById('claude-unimath-styles')) return;
      const style = document.createElement('style');
      style.id = 'claude-unimath-styles';
      style.textContent = [
        // Math is always an upright left-to-right island.
        '[data-unimath-island]{unicode-bidi:isolate!important;direction:ltr!important}',
        // Code never flips.
        'pre,code,.code-block__code{unicode-bidi:isolate!important;direction:ltr!important;text-align:left!important}',
        // RTL prose.
        '[data-unimath="rtl"]{direction:rtl!important;text-align:start!important}',
        // A left-to-right item inside a mirrored list or table: its own text
        // decides its direction, and it stays lined up with its neighbours.
        '[data-unimath="ltr"]{unicode-bidi:plaintext!important;text-align:right!important}',
        // In the box you type in, every line finds its own direction.
        INPUT_SEL + ' p{unicode-bidi:plaintext;text-align:start}',
      ].join('');
      (document.head || document.documentElement).appendChild(style);
    }

    // The element to re-process for a changed node: the outermost list, table or
    // quote around it, else its own block of prose, else the node itself.
    function scopeFor(el) {
      let top = null;
      let cursor = el.closest ? el.closest(CONTAINER_SEL) : null;
      while (cursor) {
        top = cursor;
        cursor = cursor.parentElement ? cursor.parentElement.closest(CONTAINER_SEL) : null;
      }
      if (top) return top;
      return (el.closest && el.closest(PROSE_SEL)) || el;
    }

    function applyFieldDirection(field) {
      const text = field.textContent || field.value || '';
      if (firstStrongDir(text) === 'rtl') {
        field.style.direction = 'rtl';
        field.style.textAlign = 'right';
      } else {
        field.style.direction = '';
        field.style.textAlign = '';
      }
    }

    function init() {
      // The installer adds this script to several of the app's files, and more
      // than one of them can load into the same window. The marker lives on the
      // page itself, so it is seen across script contexts and only the first
      // copy runs.
      const page = document.documentElement;
      if (!page || page.hasAttribute(ACTIVE)) return;
      page.setAttribute(ACTIVE, VERSION);

      injectStyles();
      processAll();

      document.addEventListener('input', function (event) {
        const target = event.target;
        if (!target) return;
        if (target.matches && target.matches(INPUT_SEL)) { applyInputDirection(); return; }
        if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
          applyFieldDirection(target);
        }
      }, true);

      // Replies arrive in many small changes. They are collected for a moment
      // and handled together, and only the blocks that changed are re-processed.
      let pending = [];
      let timer = null;

      function flush() {
        timer = null;
        const batch = pending;
        pending = [];
        const roots = new Set();
        for (const mutation of batch) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1) roots.add(node);
            else if (node.nodeType === 3 && node.parentElement) roots.add(node.parentElement);
          }
          if (mutation.type === 'characterData' && mutation.target.parentElement) {
            roots.add(mutation.target.parentElement);
          }
          // A reply just finished streaming: its raw LaTeX can now be isolated.
          if (mutation.type === 'attributes' && mutation.target.nodeType === 1) {
            roots.add(mutation.target);
          }
        }

        if (roots.size === 0 || roots.size > 40) {
          processAll();
          return;
        }
        const scopes = new Set();
        roots.forEach(function (root) {
          if (root.isConnected === false) return; // already removed again
          scopes.add(scopeFor(root));
        });
        scopes.forEach(processScope);
        applyInputDirection();
      }

      const observer = new MutationObserver(function (mutations) {
        let relevant = false;
        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0 || mutation.type !== 'childList') { relevant = true; break; }
        }
        if (!relevant) return;
        for (const mutation of mutations) pending.push(mutation);
        if (!timer) timer = setTimeout(flush, 60);
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-is-streaming'],
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  } catch (e) {
    console.error('[Claude-UniMath]', e);
  }
})();
// --- CLAUDE-UNIMATH END ---
