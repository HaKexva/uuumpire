#!/usr/bin/env node
/* Writes version.json with a fresh stamp. index.html fetches it (never cached) and loads every asset
   with ?v=<stamp>, so a deploy is picked up even while GitHub Pages still serves the cached page.
   Installed as a git pre-commit hook: tools/install-hooks.sh */
const fs = require("fs");
const path = require("path");
const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const v = d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "-" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
fs.writeFileSync(path.join(__dirname, "..", "version.json"), JSON.stringify({ v }) + "\n");
console.log("version " + v);
