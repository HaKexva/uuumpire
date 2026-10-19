#!/usr/bin/env node
/* Builds the public deploy bundle into dist/: the game's JS is minified in place (same filenames, so
   index.html and every fetch path are untouched), everything else is copied verbatim. The private
   source repo keeps the readable originals; only this minified output is pushed to the public repo.
   Run: node tools/build.js   (needs esbuild; `npm ci` installs it) */
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');

// the game's client JS, loaded as classic scripts by fixed name in index.html -> minify in place
const MINIFY = ['core.js', 'game.js', 'i18n.js', 'music.js', 'sprites.js'];
// shipped as-is (the browser needs these at their exact paths)
const COPY = ['index.html', 'style.css', 'version.json', 'favicon.ico', 'assets', 'fonts'];

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const name of MINIFY) {
    const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
    // transform (not bundle): esbuild keeps top-level names, so the cross-file globals these
    // classic scripts share (window.UU_CORE, I18N, ...) still resolve after minification.
    const { code } = await esbuild.transform(src, { minify: true, legalComments: 'none', target: 'es2019' });
    fs.writeFileSync(path.join(OUT, name), code);
  }

  for (const name of COPY) {
    const from = path.join(ROOT, name);
    if (!fs.existsSync(from)) { console.warn('skip (missing):', name); continue; }
    fs.cpSync(from, path.join(OUT, name), { recursive: true });
  }

  const n = MINIFY.length + COPY.length;
  console.log(`built dist/ (${MINIFY.length} minified, ${COPY.length} copied, ${n} entries)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
