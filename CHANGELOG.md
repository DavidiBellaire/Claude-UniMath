# Changelog

## 1.1.0

### Smarter direction

- A block's direction now follows its language instead of the first RTL character found. It is RTL when it starts with an RTL letter, or when RTL letters make up at least 30% of its letters. Hebrew that opens with "React" or a number is RTL. English that quotes one Hebrew word stays LTR.
- Math and code are left out of that count, so a long formula never outvotes the sentence around it.
- Greek, Cyrillic, accented Latin and CJK letters are recognised as left-to-right. Before, only A to Z counted, so `Привет שלום` was read as RTL.

### Better math detection

- Plain inline math such as `$x$`, `$n+1$` and `$f(x) = 2x + 1$` is isolated. Before, a formula needed a LaTeX command or one of `^ _ { }` to be recognised.
- Currency detection is stricter in the other direction: an English word that happens to be a TeX name (`bar`, `pi`, `log`) no longer turns a sentence with two prices into "math".
- Raw `\begin{…} … \end{…}` environments are isolated.

### Lists, tables and quotes

- Tables run right-to-left when their header row is mostly RTL.
- Lists are mirrored when at least half of their items are RTL, instead of whenever one item is.
- Left-to-right items inside a mirrored list or table (an English bullet, a cell holding `-5`) keep their punctuation and minus sign in the right place.
- The bar of a quote moves to the right edge.

### The box you type in

- Every line finds its own direction.

### Fixes

- The paragraph that changed during streaming was skipped by the scoped pass, so its direction was only set by a later full pass. It is now included.
- If the script is loaded into the same window more than once, only the first copy runs. Before, each copy started its own observer.
- While the app marks a reply as still streaming (`data-is-streaming="true"`), its text nodes are no longer rewritten under the app's renderer. Raw LaTeX is isolated when the reply completes. Where the app does not set that marker, behaviour is as before.
- Styles the patch changes are remembered and restored exactly if a block stops being RTL.

### Project

- `src/payload.js` is now generated from `src/core.js`, `src/dom.js` and `src/runtime.js` by `scripts/build.js`. The tests fail if it is out of date, and run the generated file itself in a simulated page.
- Tests grew from 54 to 144 assertions.
- `demo/index.html` shows the patch in any browser without installing.
- Installer: `--version`, and `--status` says when Claude has been updated since the patched copy was built.

## 1.0.0

- First release: isolated math in RTL prose for Claude Desktop on macOS, currency-aware LaTeX detection, every RTL Unicode script, streaming support, non-destructive installer.
