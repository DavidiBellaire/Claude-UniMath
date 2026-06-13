// Test suite for Claude-UniMath core engine.
// Run with: node test/core.test.js
'use strict';

const core = require('../src/core.js');

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log('  PASS  ' + label);
  } else {
    failed++;
    console.log('  FAIL  ' + label);
    console.log('        expected: ' + e);
    console.log('        actual:   ' + a);
  }
}

function ranges(text) {
  return core.findLatexRanges(text).map((r) => text.slice(r.start, r.end));
}
function segs(text) {
  return core.segmentText(text).map((s) => s.type[0] + ':' + s.value);
}

console.log('\n== RTL detection across scripts ==');
assert('Hebrew is RTL', core.containsRTL('שלום'), true);
assert('Arabic is RTL', core.containsRTL('مرحبا'), true);
assert('Persian is RTL', core.containsRTL('سلام'), true);
assert('Syriac is RTL', core.containsRTL('ܫܠܡܐ'), true);
assert('Thaana is RTL', core.containsRTL('ދިވެހި'), true);
assert('NKo is RTL', core.containsRTL('ߒߞߏ'), true);
assert('Adlam (astral) is RTL', core.containsRTL('𞤀𞤣𞤤𞤢𞤥'), true);
assert('English is not RTL', core.containsRTL('hello world'), false);
assert('Digits are not RTL', core.containsRTL('12345'), false);
assert('Empty is not RTL', core.containsRTL(''), false);

console.log('\n== first-strong direction ==');
assert('Hebrew-first -> rtl', core.firstStrongDir('שלום world'), 'rtl');
assert('English-first -> ltr', core.firstStrongDir('hello שלום'), 'ltr');
assert('Digits then Hebrew -> rtl', core.firstStrongDir('123 שלום'), 'rtl');
assert('Only digits -> null', core.firstStrongDir('123 456'), null);

console.log('\n== math island detection ==');
assert('inline LaTeX in Hebrew',
  ranges('הערך העצמי הוא $\\lambda = 3$ עם ריבוי $2$'),
  ['$\\lambda = 3$']);
assert('display math $$',
  ranges('הנוסחה היא: $$\\frac{1}{2}$$ וזהו'),
  ['$$\\frac{1}{2}$$']);
assert('currency only -> none',
  ranges('המחיר הוא $5 ולא $10'),
  []);
assert('currency THEN real math',
  ranges('שילמתי $20 עבור $x^2 + 1$'),
  ['$x^2 + 1$']);
assert('backslash-paren inline',
  ranges('נתון כי \\(a^2 + b^2 = c^2\\) במשולש'),
  ['\\(a^2 + b^2 = c^2\\)']);
assert('backslash-bracket display',
  ranges('נתון \\[E = mc^2\\] לפי איינשטיין'),
  ['\\[E = mc^2\\]']);
assert('two separate inline maths',
  ranges('אם $x^2$ אז $y_1$ נכון'),
  ['$x^2$', '$y_1$']);
assert('escaped dollar ignored',
  ranges('מחיר \\$5 והנוסחה $a^2$'),
  ['$a^2$']);
assert('plain Hebrew -> none',
  ranges('שלום עולם מה שלומך'),
  []);
assert('Arabic with math',
  ranges('القيمة هي $\\alpha + \\beta$ هنا'),
  ['$\\alpha + \\beta$']);

console.log('\n== segmentation (text vs math ordering) ==');
assert('segments interleave correctly',
  segs('הערך הוא $x^2$ סוף'),
  ['t:הערך הוא ', 'm:$x^2$', 't: סוף']);
assert('leading math segment',
  segs('$x^2$ הוא ריבוע'),
  ['m:$x^2$', 't: הוא ריבוע']);
assert('no-math is single text segment',
  segs('שלום עולם'),
  ['t:שלום עולם']);

console.log('\n----------------------------------------');
console.log('  ' + passed + ' passed, ' + failed + ' failed');
console.log('----------------------------------------\n');
process.exit(failed === 0 ? 0 : 1);
