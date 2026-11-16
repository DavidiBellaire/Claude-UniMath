// ===========================================================================
// Claude-UniMath — Runtime wiring
//
// Author: Davidi Bellaire (github.com/DavidiBellaire)
//
// Connects the DOM layer (dom.js) to a live page:
//   - a base stylesheet
//   - one pass over the document at start
//   - live `input` events on the box the user types in
//   - a debounced MutationObserver for replies as they stream in
//
// This file is only meaningful inside the built payload, where core.js and
// dom.js are in the same scope. Everything between the <payload> markers is
// copied verbatim into src/payload.js by scripts/build.js.
// ===========================================================================

'use strict';

// <payload>
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
// </payload>
