# Off/Feed

A finite daily issue of hand-picked, long-form videos about design, film and books, history, the workshop, and music. Nothing autoplays, nothing is recommended after, and the issue ends.

## Run it

```bash
npm run dev          # serves the site at http://localhost:3000
```

The page has to be served over http. If you open `index.html` directly from disk, YouTube's player refuses to load (Error 153) and the issue data can't be fetched.

## How it's built

| Step | What happens | Where |
|---|---|---|
| 1. Collect | Recent uploads from the working channel pool (Data API) | `scripts/collect.mjs` |
| 2. Filter | Hard rules in code: 10+ min, embeddable, not live, not already used | `scripts/collect.mjs` |
| 3. Judge | A model applies the behavior spec and drafts blurbs | `scripts/curate.mjs`, `spec/` |
| 4. Review | You approve or swap picks | `drafts/` → `issues/` |
| 5. Publish | Static site with one JSON file per issue | `issues/`, `index.html` |
| 6. Feedback | Watched, skipped, "not for me" | (to build) |

Plain code handles every rule it can. The model only makes judgment calls, and it never supplies facts like titles, lengths or dates.

## Files

```
index.html, styles.css, app.js   the page
issues/index.json                points at the latest issue
issues/2026-11-08.json           Issue No. 1
data/channel-types.json          the kinds of channels issues draw from
data/channels.json               working example pool (name, topic, YouTube channel ID)
data/touchstones.json            the 9 videos the taste was set from
scripts/collect.mjs              steps 1–2
scripts/curate.mjs               step 3 — judge + draft blurbs
drafts/                          curated draft issues (gitignored)
spec/                            behavior spec, curator prompt, blurb examples
evals/                           golden set, rubric, run results
log/failures.md                  what broke and what changed
```

## Make a new issue

1. Copy `.env.example` to `.env`. Add a YouTube Data API key and an Anthropic or OpenAI key.
2. `npm run collect` writes `candidates/<date>.json`.
3. `npm run curate` runs the behavior spec, drafts blurbs, and writes `drafts/<date>.json` (plus a run log under `evals/runs/`).
4. Open the draft, swap or drop anything that feels off.
5. `npm run curate -- --date <date> --publish` writes `issues/<date>.json` and updates `issues/index.json`.

To curate by hand instead, pick up to 15 videos from the candidates file and save them in the same shape as Issue No. 1.

## Deploy

Any static host works: Vercel, Netlify or GitHub Pages. No build step is needed.
