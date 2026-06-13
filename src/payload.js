// ===========================================================================
// Claude-UniMath — Browser Payload
//
// Author: Davidi Bellaire (github.com/DavidiBellaire)
//
// This is the self-contained script injected into Claude Desktop's renderer.
// It inlines the core engine and the DOM layer (no module system at runtime),
// then wires them to:
//   - initial pass over the document
//   - live `input` events on the chat box
//   - a debounced MutationObserver for streamed responses
//
// Safe to prepend to any renderer bundle: it bails out if `document` is
// undefined, runs as an IIFE, and is wrapped in marker comments so the
// installer can detect an already-patched file and skip it.
// ===========================================================================

// --- CLAUDE-UNIMATH START ---
;(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  try {
    // =====================================================================
    // Inlined core (see src/core.js — kept in sync; this is the runtime copy)
    // =====================================================================
    var RTL_RANGES = [
      [0x0590,0x05ff],[0x0600,0x06ff],[0x0700,0x074f],[0x0750,0x077f],
      [0x0780,0x07bf],[0x07c0,0x07ff],[0x0800,0x083f],[0x0840,0x085f],
      [0x0860,0x086f],[0x0870,0x089f],[0x08a0,0x08ff],[0xfb1d,0xfb4f],
      [0xfb50,0xfdff],[0xfe70,0xfeff],[0x10800,0x1083f],[0x10840,0x1085f],
      [0x10860,0x1087f],[0x10880,0x108af],[0x108e0,0x108ff],[0x10900,0x1091f],
      [0x10920,0x1093f],[0x10a00,0x10a5f],[0x10a60,0x10a7f],[0x10a80,0x10a9f],
      [0x10ac0,0x10aff],[0x10b00,0x10b3f],[0x10b40,0x10b5f],[0x10b60,0x10b7f],
      [0x10b80,0x10baf],[0x10c00,0x10c4f],[0x10c80,0x10cff],[0x10d00,0x10d3f],
      [0x10e80,0x10ebf],[0x10f00,0x10f2f],[0x10f30,0x10f6f],[0x10f70,0x10faf],
      [0x10fb0,0x10fdf],[0x10fe0,0x10fff],[0x1e800,0x1e8df],[0x1e900,0x1e95f],
      [0x1ec70,0x1ecbf],[0x1ed00,0x1ed4f],[0x1ee00,0x1eeff]
    ];

    function isStrongRTL(ch) {
      var code = ch.codePointAt(0);
      for (var i = 0; i < RTL_RANGES.length; i++) {
        if (code >= RTL_RANGES[i][0] && code <= RTL_RANGES[i][1]) return true;
      }
      return false;
    }
    function containsRTL(text) {
      if (!text) return false;
      for (var i = 0; i < text.length; i++) {
        var cp = text.codePointAt(i);
        if (cp > 0xffff) i++; // surrogate pair
        if (isStrongRTL(String.fromCodePoint(cp))) return true;
      }
      return false;
    }
    function firstStrongDir(text) {
      if (!text) return null;
      for (var i = 0; i < text.length; i++) {
        var cp = text.codePointAt(i);
        if (cp > 0xffff) i++;
        var ch = String.fromCodePoint(cp);
        if (isStrongRTL(ch)) return 'rtl';
        if (/[A-Za-z]/.test(ch)) return 'ltr';
      }
      return null;
    }

    var LATEX_SIGNAL = /[\\^_{}]|\b(frac|sqrt|sum|prod|int|lim|log|sin|cos|tan|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|cdot|times|leq|geq|neq|approx|infty|partial|nabla|vec|hat|bar|mathbb|mathcal|mathrm)\b/;
    var BRACKET_PATTERNS = [
      /\$\$([\s\S]+?)\$\$/g, /\\\[([\s\S]+?)\\\]/g, /\\\(([\s\S]+?)\\\)/g
    ];

    function findInlineDollarRanges(text, claimed) {
      var ranges = [], dollars = [];
      for (var i = 0; i < text.length; i++) {
        if (text[i] !== '$') continue;
        if (i > 0 && text[i - 1] === '\\') continue;
        if (claimed[i]) continue;
        dollars.push(i);
      }
      var k = 0;
      while (k < dollars.length - 1) {
        var open = dollars[k], close = dollars[k + 1];
        var body = text.slice(open + 1, close);
        if (body.indexOf('\n') === -1 && LATEX_SIGNAL.test(body)) {
          ranges.push({ start: open, end: close + 1 }); k += 2;
        } else { k += 1; }
      }
      return ranges;
    }

    function findLatexRanges(text) {
      if (!text) return [];
      var ranges = [], claimed = new Array(text.length).fill(false), p, m, i;
      for (p = 0; p < BRACKET_PATTERNS.length; p++) {
        var re = new RegExp(BRACKET_PATTERNS[p].source, 'g');
        while ((m = re.exec(text)) !== null) {
          var s = m.index, e = m.index + m[0].length, ov = false;
          for (i = s; i < e; i++) { if (claimed[i]) { ov = true; break; } }
          if (ov) continue;
          for (i = s; i < e; i++) claimed[i] = true;
          ranges.push({ start: s, end: e });
        }
      }
      var inl = findInlineDollarRanges(text, claimed);
      for (i = 0; i < inl.length; i++) ranges.push(inl[i]);
      ranges.sort(function (a, b) { return a.start - b.start; });
      return ranges;
    }

    function segmentText(text) {
      var ranges = findLatexRanges(text);
      if (ranges.length === 0) return [{ type: 'text', value: text }];
      var segments = [], cursor = 0;
      for (var i = 0; i < ranges.length; i++) {
        var r = ranges[i];
        if (r.start > cursor) segments.push({ type: 'text', value: text.slice(cursor, r.start) });
        segments.push({ type: 'math', value: text.slice(r.start, r.end) });
        cursor = r.end;
      }
      if (cursor < text.length) segments.push({ type: 'text', value: text.slice(cursor) });
      return segments;
    }

    // =====================================================================
    // Inlined DOM layer (see src/dom.js)
    // =====================================================================
    var PROCESSED = 'data-unimath';
    var ISLAND = 'data-unimath-island';
    var INPUT_SEL = '[data-testid="chat-input"]';
    var RENDERED_MATH_SEL = '.katex,.katex-display,mjx-container,.MathJax,math';
    var CODE_SEL = 'pre, code, .code-block__code';
    var PROSE_SEL = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, summary, label, dt, dd, figcaption';

    function insideCode(node) { return !!(node.closest && node.closest(CODE_SEL)); }
    function insideInput(node) { return !!(node.closest && node.closest(INPUT_SEL)); }

    function isolateRenderedMath(scope) {
      var nodes = scope.querySelectorAll(RENDERED_MATH_SEL);
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.getAttribute(ISLAND) === 'rendered') continue;
        if (insideCode(el)) continue;
        el.setAttribute(ISLAND, 'rendered');
        el.style.unicodeBidi = 'isolate';
        el.style.direction = 'ltr';
      }
    }

    function isolateRawLatex(scope) {
      var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
          var v = node.nodeValue;
          if (!v || (v.indexOf('$') === -1 && v.indexOf('\\(') === -1 && v.indexOf('\\[') === -1))
            return NodeFilter.FILTER_REJECT;
          var parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (insideCode(parent) || insideInput(parent)) return NodeFilter.FILTER_REJECT;
          if (parent.getAttribute(ISLAND)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var targets = [], n;
      while ((n = walker.nextNode())) targets.push(n);
      for (var t = 0; t < targets.length; t++) {
        var textNode = targets[t];
        var segments = segmentText(textNode.nodeValue);
        if (segments.length === 1 && segments[0].type === 'text') continue;
        var frag = document.createDocumentFragment();
        for (var s = 0; s < segments.length; s++) {
          var seg = segments[s];
          if (seg.type === 'math') {
            var span = document.createElement('span');
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

    function applyProseDirection(scope) {
      var blocks = scope.querySelectorAll(PROSE_SEL);
      for (var i = 0; i < blocks.length; i++) {
        var el = blocks[i];
        if (insideCode(el) || insideInput(el)) continue;
        var text = el.textContent || '';
        if (!containsRTL(text)) {
          if (el.getAttribute(PROCESSED) === 'rtl') {
            el.style.direction = ''; el.style.textAlign = '';
            el.removeAttribute(PROCESSED);
          }
          continue;
        }
        el.setAttribute(PROCESSED, 'rtl');
        el.style.direction = 'rtl';
        el.style.textAlign = 'start';
        isolateInlineAtoms(el);
        if (el.tagName === 'LI') {
          var list = el.closest('ul, ol');
          if (list && !list.dataset.unimathList) {
            list.dataset.unimathList = '1';
            list.style.direction = 'rtl';
            var pl = parseFloat(getComputedStyle(list).paddingLeft) || 0;
            if (pl > 0) { list.style.paddingRight = pl + 'px'; list.style.paddingLeft = '0'; }
          }
        }
      }
    }

    // Isolate inline atoms (citation chips, badges, buttons) inside RTL prose
    // so the BiDi algorithm places them on the correct side of the line.
    var ATOM_TAGS = /^(BUTTON|SUP|SUB)$/;
    function looksLikeChip(el) {
      var txt = (el.textContent || '').trim();
      if (txt.length === 0) return true;
      if (txt.length <= 24) return true;
      return false;
    }
    function isolateInlineAtoms(prose) {
      var children = prose.children;
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.getAttribute(ISLAND)) continue;
        if (child.matches && child.matches(CODE_SEL)) continue;
        if (child.dataset && child.dataset.unimathAtom) continue;
        var hasBlockChild = child.querySelector
          ? child.querySelector('p, div, ul, ol, h1, h2, h3, h4, h5, h6, pre, table, li')
          : null;
        if (hasBlockChild) continue;
        var display = '';
        try { display = getComputedStyle(child).display; } catch (e) { display = ''; }
        var inlineish =
          display === 'inline-block' ||
          display === 'inline-flex' ||
          ATOM_TAGS.test(child.tagName) ||
          ((child.tagName === 'A' || child.tagName === 'SPAN') && looksLikeChip(child));
        if (!inlineish) continue;
        child.dataset.unimathAtom = '1';
        child.style.unicodeBidi = 'isolate';
      }
    }

    function forceCodeLTR(scope) {
      var blocks = scope.querySelectorAll(CODE_SEL);
      for (var i = 0; i < blocks.length; i++) {
        var el = blocks[i];
        el.dir = 'ltr'; el.style.direction = 'ltr';
        el.style.unicodeBidi = 'isolate'; el.style.textAlign = 'left';
      }
    }

    function applyInputDirection() {
      var inputs = document.querySelectorAll(INPUT_SEL);
      for (var i = 0; i < inputs.length; i++) {
        var input = inputs[i];
        var text = input.textContent || input.value || '';
        if (firstStrongDir(text) === 'rtl') {
          input.style.direction = 'rtl'; input.style.textAlign = 'right';
        } else {
          input.style.direction = ''; input.style.textAlign = '';
        }
      }
    }

    function processScope(scope) {
      if (!scope || scope.nodeType !== 1) scope = document.body;
      if (!scope) return;
      try {
        forceCodeLTR(scope);
        isolateRenderedMath(scope);
        isolateRawLatex(scope);
        applyProseDirection(scope);
      } catch (e) { console.error('[Claude-UniMath] processScope:', e); }
    }

    function processAll() {
      processScope(document.body);
      applyInputDirection();
    }

    // =====================================================================
    // Base stylesheet — sensible defaults before JS runs / for safety
    // =====================================================================
    function injectStyles() {
      if (document.getElementById('claude-unimath-styles')) return;
      var s = document.createElement('style');
      s.id = 'claude-unimath-styles';
      s.textContent = [
        '[data-unimath-island]{unicode-bidi:isolate!important;direction:ltr!important}',
        'pre,code,.code-block__code{unicode-bidi:isolate!important;direction:ltr!important;text-align:left!important}',
        '[data-unimath="rtl"]{text-align:start!important}'
      ].join('');
      (document.head || document.documentElement).appendChild(s);
    }

    // =====================================================================
    // Wiring: initial pass, input events, debounced streaming observer
    // =====================================================================
    function init() {
      injectStyles();
      processAll();

      document.addEventListener('input', function (e) {
        var t = e.target;
        if (!t) return;
        if (t.matches && t.matches(INPUT_SEL)) { applyInputDirection(); return; }
        if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') {
          var text = t.textContent || t.value || '';
          if (firstStrongDir(text) === 'rtl') {
            t.style.direction = 'rtl'; t.style.textAlign = 'right';
          } else {
            t.style.direction = ''; t.style.textAlign = '';
          }
        }
      }, true);

      var pending = [];
      var timer = null;
      var observer = new MutationObserver(function (muts) {
        var relevant = false;
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].addedNodes.length > 0 || muts[i].type === 'characterData') {
            relevant = true; break;
          }
        }
        if (!relevant) return;
        for (var j = 0; j < muts.length; j++) pending.push(muts[j]);
        if (timer) return;
        timer = setTimeout(function () {
          timer = null;
          var batch = pending; pending = [];
          var roots = new Set();
          batch.forEach(function (m) {
            for (var a = 0; a < m.addedNodes.length; a++) {
              var node = m.addedNodes[a];
              if (node.nodeType === 1) roots.add(node);
              else if (node.nodeType === 3 && node.parentElement) roots.add(node.parentElement);
            }
            if (m.type === 'characterData' && m.target.parentElement) {
              roots.add(m.target.parentElement);
            }
          });
          if (roots.size === 0 || roots.size > 40) {
            processAll();
          } else {
            roots.forEach(function (r) {
              // climb to the nearest prose/list block for clean re-processing
              var block = r.closest ? r.closest(PROSE_SEL + ', ul, ol') : null;
              processScope(block || r);
            });
            applyInputDirection();
          }
        }, 60);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
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
