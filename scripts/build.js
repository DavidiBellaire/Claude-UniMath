#!/usr/bin/env node
// ===========================================================================
// Claude-UniMath — payload builder
//
// The installer injects ONE self-contained file, src/payload.js, into Claude
// Desktop. This script generates that file from the real sources, so the
// code that is tested is exactly the code that ships:
//
//   src/core.js  +  src/dom.js  +  src/runtime.js   ->   src/payload.js
//
// From each source it takes the code between the "// <payload>" and
// "// </payload>" markers and wraps the three pieces in one function.
//
//   node scripts/build.js           write src/payload.js
//   node scripts/build.js --check   fail if src/payload.js is out of date
// ===========================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(SRC, 'payload.js');
const PARTS = ['core.js', 'dom.js', 'runtime.js'];

function payloadRegion(file) {
  const text = fs.readFileSync(path.join(SRC, file), 'utf8');
  const match = /^\/\/ <payload>\n([\s\S]*?)^\/\/ <\/payload>$/m.exec(text);
  if (!match) throw new Error(file + ': missing "// <payload>" … "// </payload>" markers');
  return match[1].replace(/\s+$/, '');
}

function indent(code) {
  return code.split('\n').map((line) => (line ? '    ' + line : line)).join('\n');
}

function build() {
  const banner = (file) =>
    '    // =====================================================================\n' +
    '    // from src/' + file + '\n' +
    '    // =====================================================================\n';

  const body = PARTS.map((file) => banner(file) + indent(payloadRegion(file))).join('\n\n');

  return [
    '// ===========================================================================',
    '// Claude-UniMath — Browser Payload',
    '//',
    '// Author: Davidi Bellaire (github.com/DavidiBellaire)',
    '//',
    '// GENERATED FILE. Do not edit it by hand.',
    '// It is built from src/core.js, src/dom.js and src/runtime.js by',
    '// scripts/build.js. Change those files, then run:  npm run build',
    '//',
    "// This is the self-contained script injected into Claude Desktop's renderer.",
    '// Safe to prepend to any bundle: it bails out if `document` is undefined,',
    '// keeps everything inside one function, and is wrapped in marker comments',
    '// so the installer can detect an already-patched file and skip it.',
    '// ===========================================================================',
    '',
    '// --- CLAUDE-UNIMATH START ---',
    ';(function () {',
    "  'use strict';",
    "  if (typeof document === 'undefined') return;",
    '',
    '  try {',
    body,
    '  } catch (e) {',
    "    console.error('[Claude-UniMath]', e);",
    '  }',
    '})();',
    '// --- CLAUDE-UNIMATH END ---',
    '',
  ].join('\n');
}

if (require.main === module) {
  const built = build();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== built) {
      console.error('src/payload.js is out of date. Run: npm run build');
      process.exit(1);
    }
    console.log('src/payload.js is up to date.');
  } else {
    fs.writeFileSync(OUT, built);
    console.log('Built src/payload.js (' + built.length + ' bytes) from ' + PARTS.join(', '));
  }
}

module.exports = { build, OUT };
