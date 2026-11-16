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
  check('raw math: both formulas isolated', islands.length === 2);
  check('raw math: island text correct',
    islands[0] && islands[0].textContent === '$\\lambda = 3$' && islands[1].textContent === '$2$');
  check('raw math: island is isolate+ltr',
    islands[0] && islands[0].style.unicodeBidi === 'isolate' && islands[0].style.direction === 'ltr');
  check('raw math: paragraph flips to rtl', p.style.direction === 'rtl');
  check('raw math: text is unchanged', p.textContent === 'הערך העצמי הוא $\\lambda = 3$ עם ריבוי $2$');
}

// --- Test 1b: prices in Hebrew prose are never treated as math --------------
{
  const { domLayer, document } = setup('<p>המחיר הוא $5 ולא $10, ושילמתי על $x$ יחידות</p>');
  domLayer.processAll();
  const islands = document.querySelectorAll('[data-unimath-island="raw"]');
  check('currency: only the real variable is isolated',
    islands.length === 1 && islands[0].textContent === '$x$');
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

// --- Test 12: the changed paragraph ITSELF is the scope (streaming path) ----
// The observer hands processScope the paragraph that changed, not its parent.
{
  const { domLayer, document } = setup('<div><p id="a">טקסט שהגיע עכשיו $x$</p></div>');
  const p = document.querySelector('#a');
  domLayer.processScope(p);
  check('self scope: the paragraph itself flips to rtl', p.style.direction === 'rtl');
  check('self scope: its math is isolated', p.querySelectorAll('[data-unimath-island="raw"]').length === 1);
}

// --- Test 13: base direction follows the language, not one stray word -------
{
  const { domLayer, document } = setup(
    '<p id="en">The word שלום means peace in Hebrew</p>' +
    '<p id="he">React היא ספרייה של פייסבוק לבניית ממשקים</p>' +
    '<p id="math">$x^2 + y^2 = r^2$ היא משוואת המעגל</p>' +
    '<p id="code"><code>useEffect</code> רץ אחרי כל רינדור</p>' +
    '<p id="katex"><span class="katex">abcdefghijklmnopqrstuvwxyz</span> הוא ביטוי ארוך</p>'
  );
  domLayer.processAll();
  const dir = (id) => document.querySelector('#' + id).style.direction;
  check('direction: English that quotes a Hebrew word stays ltr', dir('en') !== 'rtl');
  check('direction: Hebrew that opens with an English term is rtl', dir('he') === 'rtl');
  check('direction: a leading formula does not outvote the sentence', dir('math') === 'rtl');
  check('direction: leading inline code does not outvote the sentence', dir('code') === 'rtl');
  check('direction: rendered math letters are not counted', dir('katex') === 'rtl');
}

// --- Test 14: a block that stops being RTL gets its own styles back ---------
{
  const { domLayer, document } = setup('<p style="text-align: center">שלום עולם</p>');
  const p = document.querySelector('p');
  domLayer.processAll();
  check('restore: flipped to rtl', p.style.direction === 'rtl' && p.getAttribute('data-unimath') === 'rtl');
  p.textContent = 'hello world';
  domLayer.processAll();
  check('restore: direction cleared', p.style.direction === '' && !p.hasAttribute('data-unimath'));
  check('restore: the original alignment is back', p.style.textAlign === 'center');
  check('restore: no bookkeeping left behind', !p.hasAttribute('data-unimath-saved'));
}

// --- Test 15: lists mirror by majority, and English items stay readable -----
{
  const { domLayer, document } = setup(
    '<ul id="he" style="padding-left: 24px"><li>פריט ראשון</li><li>Node.js (v20).</li><li>פריט שלישי</li></ul>' +
    '<ul id="en"><li>First item</li><li>Second item</li><li>מילה אחת</li></ul>' +
    '<ol id="loose"><li><p>פסקה בעברית</p></li><li><p>English paragraph.</p></li></ol>'
  );
  domLayer.processAll();
  const he = document.querySelector('#he');
  const en = document.querySelector('#en');
  check('list: mostly-Hebrew list is mirrored', he.style.direction === 'rtl');
  check('list: bullet padding moved to the right',
    he.style.paddingRight === '24px' && (he.style.paddingLeft === '0px' || he.style.paddingLeft === '0'));
  check('list: English item inside it is marked ltr', he.children[1].getAttribute('data-unimath') === 'ltr');
  check('list: Hebrew items are rtl', he.children[0].getAttribute('data-unimath') === 'rtl');
  check('list: mostly-English list is left alone', en.style.direction !== 'rtl');
  check('list: its one Hebrew item is still rtl', en.children[2].style.direction === 'rtl');
  const loose = document.querySelector('#loose');
  check('list: loose item paragraph is marked ltr',
    loose.children[1].querySelector('p').getAttribute('data-unimath') === 'ltr');

  // The list turns English: everything is put back.
  he.children[0].textContent = 'First';
  he.children[2].textContent = 'Third';
  domLayer.processAll();
  check('list: un-mirrored when it stops being RTL',
    he.style.direction === '' && he.style.paddingLeft === '24px' && !he.hasAttribute('data-unimath-list'));
  check('list: ltr marks removed', !he.children[1].hasAttribute('data-unimath'));
}

// --- Test 16: tables run right-to-left when their header is RTL -------------
{
  const { domLayer, document } = setup(
    '<table id="he"><thead><tr><th>שם</th><th>Score</th><th>עיר</th></tr></thead>' +
    '<tbody><tr><td>דנה</td><td>-5</td><td>Tel Aviv.</td></tr></tbody></table>' +
    '<table id="en"><thead><tr><th>Name</th><th>City</th></tr></thead>' +
    '<tbody><tr><td>דנה</td><td>חולון</td></tr></tbody></table>'
  );
  domLayer.processAll();
  const he = document.querySelector('#he');
  const cells = he.querySelectorAll('td');
  check('table: Hebrew-headed table is mirrored', he.style.direction === 'rtl');
  check('table: Hebrew cell is rtl', cells[0].getAttribute('data-unimath') === 'rtl');
  check('table: number cell is marked ltr (so "-5" keeps its sign in place)',
    cells[1].getAttribute('data-unimath') === 'ltr');
  check('table: English cell is marked ltr', cells[2].getAttribute('data-unimath') === 'ltr');
  check('table: English-headed table keeps its column order',
    document.querySelector('#en').style.direction !== 'rtl');
}

// --- Test 17: the quote bar moves to the right in RTL -----------------------
{
  const { domLayer, document } = setup(
    '<blockquote style="border-left: 3px solid rgb(200, 200, 200); padding-left: 12px">ציטוט חשוב מאוד</blockquote>'
  );
  domLayer.processAll();
  const q = document.querySelector('blockquote');
  check('quote: direction rtl', q.style.direction === 'rtl');
  check('quote: bar moved to the right', /3px/.test(q.style.borderRight) && q.style.borderLeftWidth === '0px');
  check('quote: padding moved with it', q.style.paddingRight === '12px');
  q.textContent = 'An important quote';
  domLayer.processAll();
  check('quote: bar returns to the left when the quote turns English',
    q.style.borderLeftWidth === '3px' && q.style.paddingLeft === '12px' && q.style.direction === '');
}

// --- Test 18: a reply that is still streaming is not rewritten --------------
{
  const { domLayer, document } = setup(
    '<div id="msg" data-is-streaming="true"><p>הפתרון הוא $x = 5$ בדיוק</p></div>'
  );
  const msg = document.querySelector('#msg');
  const textNode = msg.querySelector('p').firstChild;
  domLayer.processAll();
  check('streaming: text nodes are left alone while the reply is being written',
    msg.querySelectorAll('[data-unimath-island]').length === 0 && msg.querySelector('p').firstChild === textNode);
  check('streaming: direction is still applied live', msg.querySelector('p').style.direction === 'rtl');
  msg.setAttribute('data-is-streaming', 'false');
  domLayer.processScope(msg);
  check('streaming: math is isolated once the reply is finished',
    msg.querySelectorAll('[data-unimath-island="raw"]').length === 1);
}

// --- Test 19: everything above is idempotent together -----------------------
{
  const { domLayer, document } = setup(
    '<p>React היא ספרייה, ו-$x$ משתנה</p>' +
    '<ul style="padding-left: 20px"><li>אחד</li><li>Two.</li></ul>' +
    '<table><tr><th>שם</th></tr><tr><td>7</td></tr></table>' +
    '<blockquote style="border-left: 2px solid red">ציטוט</blockquote>'
  );
  domLayer.processAll();
  const first = document.body.innerHTML;
  domLayer.processAll();
  domLayer.processScope(document.querySelector('li'));
  domLayer.processScope(document.querySelector('td'));
  check('idempotent: lists, tables and quotes are stable under re-processing',
    document.body.innerHTML === first);
}

console.log('\n----------------------------------------');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
console.log('----------------------------------------\n');
process.exit(failed === 0 ? 0 : 1);
