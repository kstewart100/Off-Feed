# Failure log

What broke while building Off/Feed, why, and what changed. Newest first.

## 2026-11-08 — YouTube player won't run outside a real website
- **What happened:** Opened directly, YouTube's embed player showed "Video player configuration error, Error 153." Claude's published artifact pages also block third-party players.
- **Cause:** YouTube's player needs the page it's on to be served from a web address. Opening the file from disk (or from a sandboxed frame) doesn't qualify.
- **Change:** The site is served over http (`npm run dev` locally, a static host in production). The published preview links out to YouTube instead.

## 2026-11-08 — Page reader returned the wrong video for six different links
- **What happened:** An AI page-reading tool, asked about six different YouTube links, described the same Chris Young cooking video for all six.
- **Cause:** Unknown. Likely caching or a redirect in the tool. Either way, the output looked confident and was wrong.
- **Change:** Video facts now come only from YouTube's own data (oEmbed, RSS, the Data API). The spec forbids the model from supplying titles, lengths or dates.

## 2026-11-08 — Searching by video ID returned unrelated pages
- **What happened:** Web searches for each video ID returned spam pages and unrelated datasets.
- **Cause:** Video IDs are random strings that search engines don't index usefully.
- **Change:** Same as above. Use YouTube's data directly.

## 2026-11-08 — Thumbnails removed on purpose
- **Not a failure, a decision:** Thumbnails can be fetched, but they're the most click-optimized part of YouTube. The page shows a plain 16:9 screen with the channel, runtime and date instead.
