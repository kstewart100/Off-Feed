#!/usr/bin/env node
/* Steps 1–2 of the pipeline: collect recent uploads from the working channel pool
   (data/channels.json — expandable examples of the channel types), then apply the
   hard rules in code. Output: candidates/<date>.json for the curator (step 3) and for your review.

   Usage:  YT_API_KEY=... npm run collect            (default: last 21 days)
           YT_API_KEY=... npm run collect -- --days 30

   - Collection uses the YouTube Data API (channels.list → uploads playlist → playlistItems.list).
     Public channel RSS feeds currently 404 from some networks, so they are not used.
   - Lengths and embeddability come from videos.list (1 quota unit per call of up to 50 videos;
     default daily quota is 10,000 units). Get a key in Google Cloud Console → APIs & Services →
     enable "YouTube Data API v3" → Credentials. Put it in .env, never in git.
   - Facts (title, length, date) come only from YouTube. The model never supplies them. */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";

const MIN_SECONDS = 600; // House rule 2: ten minutes or longer
const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 21;
const KEY = process.env.YT_API_KEY;
if (!KEY) { console.error("Set YT_API_KEY (see README)."); process.exit(1); }

const api = async (path, params = {}) => {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  url.searchParams.set("key", KEY);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
};

const channels = JSON.parse(await readFile("data/channels.json", "utf8"));

// Videos already used in past issues (never repeat)
const used = new Set();
for (const f of (await readdir("issues")).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
  const issue = JSON.parse(await readFile(`issues/${f}`, "utf8"));
  issue.topics.flatMap(t => t.items).forEach(v => used.add(v.id));
}

const since = Date.now() - days * 864e5;

// 1. Collect — resolve each channel's uploads playlist, then walk recent items
const uploads = {};
for (let i = 0; i < channels.length; i += 50) {
  const batch = channels.slice(i, i + 50);
  const data = await api("channels", {
    part: "contentDetails",
    id: batch.map(c => c.channelId).join(",")
  });
  for (const it of data.items || []) {
    uploads[it.id] = it.contentDetails.relatedPlaylists.uploads;
  }
  for (const ch of batch) {
    if (!uploads[ch.channelId]) console.warn(`! ${ch.name}: channel not returned by API`);
  }
}

const pool = [];
for (const ch of channels) {
  const playlistId = uploads[ch.channelId];
  if (!playlistId) continue;
  let pageToken, stopped = false, pages = 0;
  while (!stopped && pages < 3) {
    pages++;
    const data = await api("playlistItems", {
      part: "contentDetails,snippet",
      playlistId,
      maxResults: "50",
      pageToken
    });
    for (const it of data.items || []) {
      const id = it.contentDetails?.videoId;
      const published = it.contentDetails?.videoPublishedAt || it.snippet?.publishedAt;
      if (!id || !published) continue;
      if (Date.parse(published) < since) { stopped = true; break; }
      if (used.has(id)) continue;
      pool.push({ id, channel: ch.name, topic: ch.topic, published });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
}

// 2. Filter with YouTube's own data
const iso = d => { const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };
const details = {};
for (let i = 0; i < pool.length; i += 50) {
  const ids = pool.slice(i, i + 50).map(v => v.id).join(",");
  const data = await api("videos", { part: "snippet,contentDetails,status", id: ids });
  for (const it of data.items || []) details[it.id] = it;
}

const kept = [], dropped = [];
for (const v of pool) {
  const d = details[v.id];
  const reason =
    !d ? "not returned by API (private or removed)" :
    !d.status.embeddable ? "not embeddable" :
    d.snippet.liveBroadcastContent !== "none" ? "live or upcoming" :
    iso(d.contentDetails.duration) < MIN_SECONDS ? "under 10 minutes" : null;
  if (reason) { dropped.push({ ...v, reason }); continue; }
  kept.push({
    ...v,
    title: d.snippet.title,
    minutes: Math.round(iso(d.contentDetails.duration) / 60),
    description: d.snippet.description.slice(0, 1500) // the only source a blurb may draw from
  });
}

const today = new Date().toISOString().slice(0, 10);
await mkdir("candidates", { recursive: true });
await writeFile(`candidates/${today}.json`, JSON.stringify({ generated: today, days, kept, dropped }, null, 2));
console.log(`${pool.length} recent uploads → ${kept.length} pass the hard rules, ${dropped.length} dropped.`);
console.log(`Wrote candidates/${today}.json. Next: run the curator (spec/curator-prompt.md) on it.`);
