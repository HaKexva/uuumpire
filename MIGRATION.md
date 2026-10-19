# Two-repo split: private source, public deploy

Goal: keep the source **private** for free while the game keeps serving at the **same URL**
`https://hakexva.github.io/uuumpire`.

## How it works

- **Private repo** (`HaKexva/uuumpire-source`, new) — all development happens here: readable source,
  full history, comments, `server/`, `tools/`, this build setup.
- **Public repo** (`HaKexva/uuumpire`, the current one) — holds **only the minified build output**
  and keeps serving GitHub Pages at the unchanged URL.
- On every push to `main` in the private repo, the `deploy-pages` workflow runs the core tests,
  builds `dist/` (the five game JS files minified in place, everything else copied), and force-pushes
  `dist/` to the public repo's `main`. The Railway API keeps deploying from `deploy-api.yml`.

`index.html` loads the JS by fixed filename (`i18n/sprites/music/core/game.js`) with a `?v=` stamp,
so minifying in place changes nothing about paths — the build was verified to run identically.

## What actually gets protected

Only the **source form** (readable code, comments, history, dev-only files). The *running* JS is still
downloaded by the browser — minification obscures it, it does not hide it. Your anti-cheat does not
depend on hiding code (the server's `replayRun` is the trust boundary), so this is purely about keeping
your repo private.

> ⚠️ **Decision — past history is already public.** The current `HaKexva/uuumpire` has your full source
> in its public git history right now. Going private from here protects *future* work. If you also want
> the *past* hidden, the public repo needs a clean history — `force_orphan: true` in the workflow already
> makes every deploy a single fresh commit, so once the first deploy runs, the old public history is
> replaced. (Forks/clones already taken cannot be recalled.)

## One-time setup (your account — these need credentials/admin I can't do)

1. **Create the private repo** `HaKexva/uuumpire-source` (empty, private).
2. **Push the current repo there** as the new origin:
   ```bash
   git remote add source git@github.com:HaKexva/uuumpire-source.git
   git push source main        # (and push this branch / open the PR there)
   ```
3. **Make a deploy token**: GitHub → Settings → Developer settings → Fine-grained PAT
   - Resource owner: `HaKexva`, repository access: only `HaKexva/uuumpire`
   - Permissions: **Contents: Read and write**
4. **Add it as a secret** in `uuumpire-source` → Settings → Secrets and variables → Actions →
   `DEPLOY_TOKEN` = that PAT.
5. **Move the Railway secret**: add `RAILWAY_TOKEN` as a secret in `uuumpire-source` too (so
   `deploy-api.yml` keeps deploying the API from the private repo).
6. **Public repo Pages**: `HaKexva/uuumpire` → Settings → Pages → Source = *Deploy from a branch*,
   `main` / `(root)` (unchanged). Make `uuumpire` **public**.
7. **First deploy**: push to `main` in `uuumpire-source` (or run the workflow manually). Confirm
   `https://hakexva.github.io/uuumpire` serves the new build.
8. Once verified, development continues in `uuumpire-source`; the public repo is deploy-only.

## Local build

```bash
npm ci          # installs esbuild (pinned)
npm run build   # writes dist/  (minified JS + copied assets)
npm test        # core tests
```
