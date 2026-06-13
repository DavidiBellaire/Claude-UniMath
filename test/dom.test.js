// DOM-layer tests for Claude-UniMath using jsdom.
// Run with: node test/dom.test.js
'use strict';

const { JSDOM } = require('jsdom');

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label); }
}

function setup(bodyHTML) {
  const dom = new JSDOM('<!DOCTYPE html><body>' + bodyHTML + '</body>', {
    pretendToBeVisual: true,
  });
  // Expose globals the DOM layer expects.
  global.window = dom.window;
  global.document = dom.window.document;
  global.NodeFilter = dom.window.NodeFilter;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.self = dom.window;
  // Fresh require of the DOM module bound to these globals.
  delete require.cache[require.resolve('../src/dom.js')];
  delete require.cache[require.resolve('../src/core.js')];
  const domLayer = require('../src/dom.js');
  return { dom, domLayer, document: dom.window.document };
}

// --- Test 1: raw LaTeX inside Hebrew prose gets isolated -------------------
{
  const { domLayer, document } = setup(
    '<p>הערך העצמי הוא $\\lambda = 3$ עם ריבוי $2$</p>'
  );
  domLayer.processAll();
  const p = document.querySelector('p');
  const islands = p.querySelectorAll('[data-unimath-island="raw"]');
  check('raw math: one island created', islands.length === 1);
  check('raw math: island text correct', islands[0] && islands[0].textContent === '$\\lambda = 3$');
  check('raw math: island is isolate+ltr',
    islands[0] && islands[0].style.unicodeBidi === 'isolate' && islands[0].style.direction === 'ltr');
  check('raw math: paragraph flips to rtl', p.style.direction === 'rtl');
  check('raw math: currency "$2" NOT isolated',
    p.textContent.includes('$2') && islands.length === 1);
}

// --- Test 2: rendered KaTeX gets isolated ----------------------------------
{
  const { domLayer, document } = setup(
    '<p>נתון כי <span class="katex"><span class="katex-mathml">x^2</span></span> חיובי</p>'
  );
  domLayer.processAll();
  const katex = document.querySelector('.katex');
  check('rendered: katex marked as island', katex.getAttribute('data-unimath-island') === 'rendered');
  check('rendered: katex is isolate+ltr',
    katex.style.unicodeBidi === 'isolate' && katex.style.direction === 'ltr');
  check('rendered: paragraph flips to rtl', document.querySelector('p').style.direction === 'rtl');
}

// --- Test 3: code blocks forced LTR, never scanned for math ----------------
{
  const { domLayer, document } = setup(
    '<p>קוד: </p><pre><code>const price = $5; // not math $x$</code></pre>'
  );
  domLayer.processAll();
  const pre = document.querySelector('pre');
  const code = document.querySelector('code');
  check('code: pre forced ltr', pre.style.direction === 'ltr');
  check('code: no islands created inside code',
    code.querySelectorAll('[data-unimath-island]').length === 0);
  check('code: code text unchanged',
    code.textContent === 'const price = $5; // not math $x$');
}

// --- Test 4: pure-English paragraph is left LTR (no RTL styling) ------------
{
  const { domLayer, document } = setup('<p>the value is $x^2$ here</p>');
  domLayer.processAll();
  const p = document.querySelector('p');
  check('english: paragraph not flipped to rtl', p.style.direction !== 'rtl');
  check('english: math still isolated as ltr island',
    p.querySelectorAll('[data-unimath-island="raw"]').length === 1);
}

// --- Test 5: idempotency — processing twice changes nothing -----------------
{
  const { domLayer, document } = setup(
    '<p>הערך הוא $x^2$ סוף</p>'
  );
  domLayer.processAll();
  const htmlAfterFirst = document.body.innerHTML;
  domLayer.processAll();
  domLayer.processAll();
  const htmlAfterThird = document.body.innerHTML;
  check('idempotent: DOM identical after re-processing', htmlAfterFirst === htmlAfterThird);
  check('idempotent: still exactly one island',
    document.querySelectorAll('[data-unimath-island="raw"]').length === 1);
}

// --- Test 6: streaming simulation — process a scope as nodes get added ------
{
  const { domLayer, document } = setup('<div id="chat"></div>');
  const chat = document.querySelector('#chat');
  // First chunk arrives
  chat.innerHTML = '<p>הפתרון הוא</p>';
  domLayer.processScope(chat);
  // Second chunk replaces with fuller content (as streaming does)
  chat.innerHTML = '<p>הפתרון הוא $x = \\frac{-b}{2a}$ בדיוק</p>';
  domLayer.processScope(chat);
  const islands = chat.querySelectorAll('[data-unimath-island="raw"]');
  check('streaming: final math isolated', islands.length === 1);
  check('streaming: final paragraph rtl', document.querySelector('#chat p').style.direction === 'rtl');
}

// --- Test 7: Arabic prose also flips ----------------------------------------
{
  const { domLayer, document } = setup('<p>القيمة هي $\\alpha$ هنا</p>');
  domLayer.processAll();
  check('arabic: paragraph flips to rtl', document.querySelector('p').style.direction === 'rtl');
  check('arabic: math isolated',
    document.querySelectorAll('[data-unimath-island="raw"]').length === 1);
}

// --- Test 8: list items get RTL with mirrored direction ---------------------
{
  const { domLayer, document } = setup(
    '<ul><li>פריט ראשון $a^2$</li><li>פריט שני</li></ul>'
  );
  domLayer.processAll();
  const ul = document.querySelector('ul');
  check('list: ul direction rtl', ul.style.direction === 'rtl');
  check('list: li flipped rtl', document.querySelector('li').style.direction === 'rtl');
}

// --- Test 9: citation chip inside RTL prose gets isolated -------------------
{
  const { domLayer, document } = setup(
    '<p>זה רעיון טוב <span class="cite-chip">Chrome Web Store</span> וזהו ועוד טקסט</p>'
  );
  domLayer.processAll();
  const p = document.querySelector('p');
  const chip = document.querySelector('.cite-chip');
  check('citation: paragraph is rtl', p.style.direction === 'rtl');
  check('citation: chip isolated as atom', chip.dataset.unimathAtom === '1');
  check('citation: chip has unicode-bidi isolate', chip.style.unicodeBidi === 'isolate');
}

// --- Test 10: button atom inside RTL prose is isolated ----------------------
{
  const { domLayer, document } = setup(
    '<p>לחץ כאן <button>שמור</button> כדי להמשיך</p>'
  );
  domLayer.processAll();
  const btn = document.querySelector('button');
  check('button atom: isolated via ATOM_TAGS', btn.dataset.unimathAtom === '1');
  check('button atom: unicode-bidi isolate set', btn.style.unicodeBidi === 'isolate');
}

// --- Test 11: long-text anchor (real sentence link) is NOT wrongly isolated -
// A normal hyperlink whose text is a full phrase should flow with the prose,
// not be isolated as a chip. (Short links are treated as chips by design;
// this guards the long-text case from over-isolation.)
{
  const { domLayer, document } = setup(
    '<p>ניתן לקרוא עוד <a href="#">במאמר המקיף שפורסם לאחרונה בנושא הזה בהרחבה</a> אם רוצים</p>'
  );
  domLayer.processAll();
  const a = document.querySelector('a');
  check('long anchor: NOT isolated (flows with prose)', a.dataset.unimathAtom !== '1');
}

console.log('\n----------------------------------------');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
console.log('----------------------------------------\n');
process.exit(failed === 0 ? 0 : 1);
