# Working on Off/Feed

Context for AI coding agents (Cursor, Claude, and others).

## What this is
A personal, finite daily video issue. Its design principle is **boundaries with curation**: the page exists so the owner can enjoy YouTube without the YouTube algorithm.

## Product rules (do not break these)
- No autoplay, no "up next", no recommendations, no infinite scroll. Every issue has an end.
- Players use `youtube-nocookie.com` with `rel=0`.
- Play screens show the video's YouTube thumbnail (click to play in place). Still no recommendation UI, related-video chrome, or thumbnail grids used for discovery.
- Videos come from channels that match the types in `data/channel-types.json` (design, film & books, history, workshop, music). `data/channels.json` is a working example pool for collection — expandable, not a closed roster. Still no YouTube search, recommendations or open-web discovery.
- Watch state comes from the player: "In progress" when playback starts, "Watched" at 90% or when the video ends. There's no manual checkbox; the status chip is the only way to undo.
- At most one video per channel per issue. Ten minutes or longer.

## Data rules
- Titles, lengths, dates and channel names come from YouTube (RSS or the Data API), never from a model.
- A blurb may only state what the video's own description or title supports. Factual tone, no hype, no opinion about whether the viewer should watch.
- If a fact can't be verified, leave it out.

## Code
- Plain HTML, CSS and JS. No framework or build step unless there's a clear reason.
- Colors are tokens in `styles.css` (`:root` plus dark-mode overrides). Don't add literal colors in components.
- Keep the page working at 375px wide with no sideways scrolling.
- Serve with `npm run dev`. The YouTube player won't load from `file://`.
