#!/usr/bin/env node
/* Steps 1–2 of the pipeline: collect recent uploads from the channel allowlist, then apply the
   hard rules in code. Output: candidates/<date>.json for the curator (step 3) and for your review.

   Usage:  YT_API_KEY=... npm run collect            (default: last 21 days)
           YT_API_KEY=... npm run collect -- --days 30

   - Channel RSS feeds need no key. Each returns that channel's 15 latest uploads.
   - Lengths and embeddability come from the YouTube Data API (videos.list, 1 quota unit per
     call of up to 50 videos; the default daily quota is 10,000 units). Get a key in Google Cloud
     Console → APIs & Services → enable "YouTube Data API v3" → Credentials. Put it in .env, never in git.
   - Facts (title, length, date) come only from YouTube. The model never supplies them. */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";

const MIN_SECONDS = 600; // House rule 2: ten minutes or longer
const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 21;
const KEY = process.env.YT_API_KEY;
if (!KEY) { console.error("Set YT_API_KEY (see README)."); process.exit(1); }

const channels = JSON.parse(await readFile("data/channels.json", "utf8"));

// Videos already used in past issues (never repeat)
const used = new Set();
for (const f of (await readdir("issues")).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
  const issue = JSON.parse(await readFile(`issues/${f}`, "utf8"));
  issue.topics.flatMap(t => t.items).forEach(v => used.add(v.id));
}

const since = Date.now() - days * 864e5;
const tag = (xml, name) => [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "g"))].map(m => m[1]);

// 1. Collect
const pool = [];
for (const ch of channels) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`);
  if (!res.ok) { console.warn(`! ${ch.name}: RSS ${res.status}`); continue; }
  for (const entry of tag(await res.text(), "entry")) {
    const id = tag(entry, "yt:videoId")[0];
    const published = tag(entry, "published")[0];
    const isShort = /\/shorts\//.test(entry);
    if (!id || isShort || used.has(id) || Date.parse(published) < since) continue;
    pool.push({ id, channel: ch.name, topic: ch.topic, published });
  }
}

// 2. Filter with YouTube's own data
const iso = d => { const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0); };
const details = {};
for (let i = 0; i < pool.length; i += 50) {
  const ids = pool.slice(i, i + 50).map(v => v.id).join(",");
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${ids}&key=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`YouTube API ${res.status}: ${await res.text()}`); process.exit(1); }
  for (const it of (await res.json()).items) details[it.id] = it;
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
