// Tests for the file that actually ships: src/payload.js.
// Run with: node test/payload.test.js
//
// 1. The payload must be exactly what scripts/build.js produces from the
//    sources, so the tested code and the shipped code can never drift.
// 2. The payload is then run inside a simulated page, the way Claude Desktop
//    runs it, to check the wiring: start-up, the streaming observer, the
//    typing box, and the guard against running twice.
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { build, OUT } = require('../scripts/build.js');

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label); }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const payload = fs.readFileSync(OUT, 'utf8');

function page(bodyHTML) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body>' + bodyHTML + '</body></html>', {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  return dom;
}

(async function () {
  console.log('\n== the shipped file matches its sources ==');
  check('src/payload.js is up to date with core.js, dom.js and runtime.js', payload === build());
  check('payload has exactly one start and one end marker',
    payload.split('CLAUDE-UNIMATH START').length === 2 && payload.split('CLAUDE-UNIMATH END').length === 2);
  check('payload has no module syntax left in it', !/\brequire\(|module\.exports/.test(payload));
  check('payload does nothing where there is no document (main process)',
    (function () { try { new Function(payload)(); return true; } catch (e) { return false; } })());

  console.log('\n== start-up ==');
  {
    const dom = page('<p id="a">הערך הוא $x^2$ בדיוק</p><pre><code>let a = $b$;</code></pre>');
    dom.window.eval(payload);
    await wait(40); // the payload starts once the page has finished loading
    const doc = dom.window.document;
    check('marks the page as active with its version',
      /^\d+\.\d+\.\d+$/.test(doc.documentElement.getAttribute('data-unimath-active') || ''));
    check('adds its stylesheet once', doc.querySelectorAll('#claude-unimath-styles').length === 1);
    check('processes what is already on the page',
      doc.querySelector('#a').style.direction === 'rtl' && doc.querySelectorAll('[data-unimath-island="raw"]').length === 1);
    check('leaves code alone', doc.querySelector('code').textContent === 'let a = $b$;');

    dom.window.eval(payload); // a second copy loads into the same window
    await wait(120);
    check('a second copy does not start again',
      doc.querySelectorAll('#claude-unimath-styles').length === 1 &&
      doc.querySelectorAll('[data-unimath-island="raw"]').length === 1);
  }

  console.log('\n== streaming observer ==');
  {
    const dom = page('<div id="chat"></div>');
    dom.window.eval(payload);
    await wait(40); // the payload starts once the page has finished loading
    const doc = dom.window.document;
    const chat = doc.querySelector('#chat');

    // A new paragraph arrives.
    const p = doc.createElement('p');
    p.textContent = 'הפתרון הוא';
    chat.appendChild(p);
    await wait(120);
    check('a paragraph added later is flipped to rtl', p.style.direction === 'rtl');

    // More text is appended to the same paragraph, as streaming does.
    p.appendChild(doc.createTextNode(' $x = \\frac{-b}{2a}$ בדיוק'));
    await wait(120);
    check('math appended to an existing paragraph is isolated',
      p.querySelectorAll('[data-unimath-island="raw"]').length === 1);

    // An existing text node is edited in place.
    const q = doc.createElement('p');
    q.textContent = 'hello';
    chat.appendChild(q);
    await wait(120);
    check('an English paragraph is not flipped', q.style.direction !== 'rtl');
    q.firstChild.nodeValue = 'שלום לכולם';
    await wait(120);
    check('editing a text node in place re-evaluates its paragraph', q.style.direction === 'rtl');

    // A list item arrives inside an existing list: the whole list is re-decided.
    const ul = doc.createElement('ul');
    ul.innerHTML = '<li>First</li>';
    chat.appendChild(ul);
    await wait(120);
    check('an English list is left alone', ul.style.direction !== 'rtl');
    ul.innerHTML = '<li>ראשון</li><li>שני</li><li>Third.</li>';
    await wait(120);
    check('the list mirrors once most items are RTL', ul.style.direction === 'rtl');
    check('its English item is marked ltr', ul.children[2].getAttribute('data-unimath') === 'ltr');

    // A reply that is still streaming keeps its text nodes until it is done.
    const msg = doc.createElement('div');
    msg.setAttribute('data-is-streaming', 'true');
    msg.innerHTML = '<p>כאשר $n$ זוגי</p>';
    chat.appendChild(msg);
    await wait(120);
    check('raw math is not split while the reply is streaming',
      msg.querySelectorAll('[data-unimath-island]').length === 0);
    check('direction is live during streaming', msg.querySelector('p').style.direction === 'rtl');
    msg.setAttribute('data-is-streaming', 'false');
    await wait(120);
    check('raw math is isolated when streaming ends',
      msg.querySelectorAll('[data-unimath-island="raw"]').length === 1);

    // The observer must settle: our own edits must not trigger endless work.
    const before = doc.body.innerHTML;
    await wait(250);
    check('the page is stable once processed', doc.body.innerHTML === before);
  }

  console.log('\n== the box you type in ==');
  {
    const dom = page('<div data-testid="chat-input" contenteditable="true"><p></p></div><textarea id="t"></textarea>');
    dom.window.eval(payload);
    await wait(40); // the payload starts once the page has finished loading
    const doc = dom.window.document;
    const input = doc.querySelector('[data-testid="chat-input"]');
    const fire = (el) => el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    input.querySelector('p').textContent = 'שלום, מה שלומך?';
    fire(input);
    check('typing Hebrew turns the box rtl', input.style.direction === 'rtl');
    input.querySelector('p').textContent = 'Hello there';
    fire(input);
    check('typing English turns it back', input.style.direction === '');
    input.querySelector('p').textContent = 'Привет שלום';
    fire(input);
    check('a Cyrillic start is left-to-right', input.style.direction === '');

    const area = doc.querySelector('#t');
    area.value = 'مرحبا';
    fire(area);
    check('other text fields follow what is typed', area.style.direction === 'rtl');
    check('math typed in the box is never rewritten', input.querySelectorAll('[data-unimath-island]').length === 0);
  }

  console.log('\n----------------------------------------');
  console.log('  ' + passed + ' passed, ' + failed + ' failed');
  console.log('----------------------------------------\n');
  process.exit(failed === 0 ? 0 : 1);
})();
