# Off/Feed

A finite weekly issue of hand-picked, long-form videos about design, film and books, history, the workshop, and music. Nothing autoplays, nothing is recommended after, and the issue ends.

## Run it

```bash
npm run dev          # serves the site at http://localhost:3000
```

The page has to be served over http. If you open `index.html` directly from disk, YouTube's player refuses to load (Error 153) and the issue data can't be fetched.

## How it's built

| Step | What happens | Where |
|---|---|---|
| 1. Collect | Recent uploads from the channel allowlist (RSS, no key) | `scripts/collect.mjs` |
| 2. Filter | Hard rules in code: 10+ min, embeddable, not live, not already used | `scripts/collect.mjs` |
| 3. Judge | A model applies the behavior spec and drafts blurbs | `spec/` (to build) |
| 4. Review | You approve or swap picks | `candidates/` → `issues/` |
| 5. Publish | Static site with one JSON file per issue | `issues/`, `index.html` |
| 6. Feedback | Watched, skipped, "not for me" | (to build) |

Plain code handles every rule it can. The model only makes judgment calls, and it never supplies facts like titles, lengths or dates.

## Files

```
index.html, styles.css, app.js   the page
issues/index.json                points at the latest issue
issues/2026-11-08.json           Issue No. 1
data/channels.json               the allowlist (name, topic, YouTube channel ID)
data/touchstones.json            the 9 videos the taste was set from
scripts/collect.mjs              steps 1–2
spec/                            behavior spec, curator prompt, blurb examples
evals/                           golden set, rubric, run results
log/failures.md                  what broke and what changed
```

## Make a new issue (by hand, for now)

1. Copy `.env.example` to `.env` and add a YouTube Data API key.
2. `npm run collect` writes `candidates/<date>.json`.
3. Pick up to 15 videos (at most one per channel), write the blurbs, and save them as `issues/<date>.json` in the same shape as Issue No. 1.
4. Add the date to `issues/index.json` and set `latest`.

## Deploy

Any static host works: Vercel, Netlify or GitHub Pages. No build step is needed.
