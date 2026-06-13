// ===========================================================================
// Claude-UniMath — DOM Layer
//
// Author: Davidi Bellaire (github.com/DavidiBellaire)
//
// Consumes the pure core (core.js) and applies its decisions to the live DOM:
//   1. Rendered math  — wraps KaTeX/MathJax nodes as isolated LTR islands.
//   2. Raw LaTeX text — splits text nodes into RTL prose + isolated LTR math.
//   3. Container dir  — sets `direction: rtl` on blocks whose prose is RTL,
//                       so the isolated islands sit in the right place.
//   4. Code           — <pre>/<code> are always forced LTR, never touched as
//                       prose, and never scanned for "$" math.
//
// Everything is idempotent and marked with data-attributes so re-processing
// the same node (during streaming) does no damage and does no double work.
// ===========================================================================

'use strict';

(function (root, factory) {
  const core =
    (typeof require !== 'undefined') ? require('./core.js') : root.UniMathCore;
  const api = factory(core);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UniMathDOM = api;
})(typeof self !== 'undefined' ? self : this, function (core) {

  const PROCESSED = 'data-unimath';        // marks a finished prose element
  const ISLAND = 'data-unimath-island';    // marks a math island we created
  const INPUT_SEL = '[data-testid="chat-input"]';

  // Selectors for math that the app has ALREADY rendered to DOM nodes.
  const RENDERED_MATH_SEL = [
    '.katex',                 // KaTeX (what Claude uses)
    '.katex-display',
    'mjx-container',          // MathJax 3
    '.MathJax',               // MathJax 2
    'math',                   // raw MathML
  ].join(',');

  const CODE_SEL = 'pre, code, .code-block__code';

  // Block-level elements whose text we treat as prose.
  const PROSE_SEL =
    'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, summary, label, dt, dd, figcaption';

  function isInsideCode(node) {
    return !!(node.closest && node.closest(CODE_SEL));
  }
  function isInsideInput(node) {
    return !!(node.closest && node.closest(INPUT_SEL));
  }

  // --- 1. Isolate rendered math nodes --------------------------------------
  function isolateRenderedMath(scope) {
    const nodes = scope.querySelectorAll(RENDERED_MATH_SEL);
    for (const el of nodes) {
      if (el.getAttribute(ISLAND) === 'rendered') continue;
      if (isInsideCode(el)) continue;
      el.setAttribute(ISLAND, 'rendered');
      el.style.unicodeBidi = 'isolate';
      el.style.direction = 'ltr';
    }
  }

  // --- 2. Split raw-LaTeX text nodes into prose + isolated math islands ----
  // We walk text nodes (not innerHTML) so we never disturb event listeners or
  // other elements. Only text nodes that actually contain a math delimiter are
  // rewritten, and each becomes a fragment of [text, <span LTR>math</span>, …].
  function isolateRawLatex(scope) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || node.nodeValue.indexOf('$') === -1 &&
            node.nodeValue.indexOf('\\(') === -1 &&
            node.nodeValue.indexOf('\\[') === -1) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (isInsideCode(parent) || isInsideInput(parent)) return NodeFilter.FILTER_REJECT;
        if (parent.getAttribute(ISLAND)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);

    for (const textNode of targets) {
      const segments = core.segmentText(textNode.nodeValue);
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

  // --- 3. Set base direction on prose blocks -------------------------------
  function applyProseDirection(scope) {
    const blocks = scope.querySelectorAll(PROSE_SEL);
    for (const el of blocks) {
      if (isInsideCode(el) || isInsideInput(el)) continue;

      // Use the textContent minus code to decide direction.
      const text = el.textContent || '';
      if (!core.containsRTL(text)) {
        // No RTL at all: clear any direction we may have set previously.
        if (el.getAttribute(PROCESSED) === 'rtl') {
          el.style.direction = '';
          el.style.textAlign = '';
          el.removeAttribute(PROCESSED);
        }
        continue;
      }

      el.setAttribute(PROCESSED, 'rtl');
      el.style.direction = 'rtl';
      el.style.textAlign = 'start';

      // Isolate inline atoms (citation chips, badges, buttons) embedded in
      // RTL prose. Without this, an inline-block element sandwiched between
      // Hebrew/Arabic words is positioned by the BiDi algorithm as if the
      // surrounding direction were LTR, so it jumps to the wrong side of the
      // line. Wrapping each in `unicode-bidi: isolate` makes it a neutral
      // atom that sits correctly in the RTL flow.
      isolateInlineAtoms(el);

      // For list items, mirror padding so bullets/numbers sit on the right.
      if (el.tagName === 'LI') {
        const list = el.closest('ul, ol');
        if (list && !list.dataset.unimathList) {
          list.dataset.unimathList = '1';
          list.style.direction = 'rtl';
          const pl = parseFloat(getComputedStyle(list).paddingLeft) || 0;
          if (pl > 0) {
            list.style.paddingRight = pl + 'px';
            list.style.paddingLeft = '0';
          }
        }
      }
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
  //   - an element whose text is short and has no spaces (chip-like), which
  //     catches class-styled citation chips even when computed display is
  //     unavailable.
  // We never isolate an element that contains block descendants, and never
  // re-isolate something already handled (math islands) or a code block.
  const ATOM_TAGS = /^(BUTTON|SUP|SUB)$/;
  function looksLikeChip(el) {
    var txt = (el.textContent || '').trim();
    if (txt.length === 0) return true;          // icon-only chip
    if (txt.length <= 24) return true;           // short label like "Chrome Web Store"
    return false;
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
        // shape (short, label-like, possibly an anchor/span) matches a chip:
        ((child.tagName === 'A' || child.tagName === 'SPAN') && looksLikeChip(child));

      if (!inlineish) continue;

      child.dataset.unimathAtom = '1';
      child.style.unicodeBidi = 'isolate';
    }
  }

  // --- 4. Force code blocks LTR --------------------------------------------
  function forceCodeLTR(scope) {
    const blocks = scope.querySelectorAll(CODE_SEL);
    for (const el of blocks) {
      el.dir = 'ltr';
      el.style.direction = 'ltr';
      el.style.unicodeBidi = 'isolate';
      el.style.textAlign = 'left';
    }
  }

  // --- 5. The chat input box -----------------------------------------------
  function applyInputDirection() {
    const inputs = document.querySelectorAll(INPUT_SEL);
    for (const input of inputs) {
      const text = input.textContent || input.value || '';
      if (core.firstStrongDir(text) === 'rtl') {
        input.style.direction = 'rtl';
        input.style.textAlign = 'right';
      } else {
        input.style.direction = '';
        input.style.textAlign = '';
      }
    }
  }

  // --- Orchestration -------------------------------------------------------
  // Order matters: isolate rendered math and raw LaTeX BEFORE setting prose
  // direction, so the islands already exist when the block flips to RTL.
  function processScope(scope) {
    if (!scope || scope.nodeType !== 1) scope = document.body;
    if (!scope) return;
    try {
      forceCodeLTR(scope);
      isolateRenderedMath(scope);
      isolateRawLatex(scope);
      applyProseDirection(scope);
    } catch (e) {
      console.error('[Claude-UniMath] processScope:', e);
    }
  }

  function processAll() {
    processScope(document.body);
    applyInputDirection();
  }

  return {
    processScope,
    processAll,
    applyInputDirection,
    _selectors: { INPUT_SEL, CODE_SEL, PROSE_SEL, RENDERED_MATH_SEL },
  };
});
