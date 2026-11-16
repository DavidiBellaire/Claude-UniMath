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
assert('Cyrillic-first -> ltr (not skipped)', core.firstStrongDir('Привет שלום'), 'ltr');
assert('Greek-first -> ltr', core.firstStrongDir('αβγ שלום'), 'ltr');
assert('Accented Latin-first -> ltr', core.firstStrongDir('école שלום'), 'ltr');
assert('CJK-first -> ltr', core.firstStrongDir('日本語 שלום'), 'ltr');
assert('Punctuation then Arabic -> rtl', core.firstStrongDir('"... مرحبا'), 'rtl');

console.log('\n== base direction of a block of prose ==');
assert('Hebrew sentence -> rtl', core.proseDirection('שלום עולם'), 'rtl');
assert('English sentence -> ltr', core.proseDirection('hello world'), 'ltr');
assert('Numbers and symbols only -> null', core.proseDirection('12 + 3 = 15'), null);
assert('Empty -> null', core.proseDirection(''), null);
assert('Hebrew that opens with an English term -> rtl',
  core.proseDirection('React היא ספרייה של פייסבוק לבניית ממשקים'), 'rtl');
assert('Hebrew that opens with a number -> rtl',
  core.proseDirection('3 דברים שכדאי לדעת'), 'rtl');
assert('English that quotes one Hebrew word -> ltr',
  core.proseDirection('The word שלום means peace in Hebrew'), 'ltr');
assert('English that quotes one Arabic word -> ltr',
  core.proseDirection('The Arabic word كتاب means book and is very common'), 'ltr');
assert('Hebrew-first with a long English tail -> rtl',
  core.proseDirection('השתמש ב-useEffect hook with a dependency array'), 'rtl');
assert('Arabic that opens with a brand name -> rtl',
  core.proseDirection('Python هي لغة برمجة سهلة التعلم'), 'rtl');
assert('Persian sentence -> rtl', core.proseDirection('این یک جمله است'), 'rtl');

console.log('\n== math island detection ==');
assert('inline LaTeX in Hebrew, including a bare number',
  ranges('הערך העצמי הוא $\\lambda = 3$ עם ריבוי $2$'),
  ['$\\lambda = 3$', '$2$']);
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

console.log('\n== plain inline math without LaTeX commands ==');
assert('single variable', ranges('יהי $x$ מספר ממשי'), ['$x$']);
assert('two variables', ranges('אם $a$ גדול מ-$b$ אז סיימנו'), ['$a$', '$b$']);
assert('simple expression', ranges('נניח ש-$n+1$ זוגי'), ['$n+1$']);
assert('equation with spaces inside', ranges('הפונקציה $f(x) = 2x + 1$ עולה'), ['$f(x) = 2x + 1$']);
assert('spaced delimiters with LaTeX still count', ranges('כאשר $ \\alpha $ קטן'), ['$ \\alpha $']);
assert('Hebrew inside \\text is still math',
  ranges('נגדיר $f(x) = 1 \\text{ אם } x > 0$ ונמשיך'),
  ['$f(x) = 1 \\text{ אם } x > 0$']);

console.log('\n== currency is never math ==');
assert('price range', ranges('בין $5 ל-$10 לחודש'), []);
assert('hyphenated range', ranges('עולה $100-$200'), []);
assert('two prices in English', ranges('it costs $20 and $30 there'), []);
assert('price, then a variable', ranges('שילמתי $20 על $x$ יחידות'), ['$x$']);
assert('Hebrew words between dollars are prose', ranges('קיבלתי $5 ועוד$ בסוף'), []);
assert('a lone dollar sign', ranges('המחיר הוא $5'), []);
assert('English word that is also a TeX name stays prose',
  ranges('שילמתי $5 at the bar ועוד $6'), []);

console.log('\n== LaTeX environments ==');
assert('raw \\begin…\\end block',
  ranges('המטריצה \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix} הפיכה'),
  ['\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}']);
assert('mismatched environment is ignored',
  ranges('טקסט \\begin{align} x \\end{cases} סוף'), []);

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
