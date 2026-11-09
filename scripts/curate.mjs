#!/usr/bin/env node
/* Step 3 of the pipeline: apply the behavior spec to candidates and draft blurbs.
   Facts (title, length, date, channel) come only from YouTube via candidates/.
   The model only decides include/exclude and writes the `why` note.

   Usage:  npm run curate                         (latest candidates/<date>.json)
           npm run curate -- --date 2026-11-09
           npm run curate -- --publish            (also write issues/<date>.json)

   Needs ANTHROPIC_API_KEY or OPENAI_API_KEY in .env (see .env.example).
   Optional: CURATOR_PROVIDER=anthropic|openai, CURATOR_MODEL=<model id> */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { basename } from "node:path";

const MAX_INCLUDE = 15;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const TOPIC_NAME = {
  Design: "Design & the built world",
  "Film & books": "Film & books",
  History: "History",
  Workshop: "The workshop",
  Music: "Music"
};
const TOPIC_ORDER = Object.values(TOPIC_NAME);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const loadJson = async (rel) => JSON.parse(await read(rel));

async function latestCandidatesDate() {
  const files = (await readdir(new URL("../candidates", import.meta.url)))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  if (!files.length) throw new Error("No candidates/*.json yet. Run npm run collect first.");
  return basename(files.at(-1), ".json");
}

function formatPublished(iso, issueYear) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mon = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return year === issueYear ? `${mon} ${day}` : `${mon} ${day}, ${year}`;
}

function formatWeekOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function formatNextIssue(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

async function nextIssueNumber(date) {
  try {
    const existing = JSON.parse(await read(`issues/${date}.json`));
    if (typeof existing.number === "number") return existing.number;
  } catch {
    /* new date */
  }
  const files = (await readdir(new URL("../issues", import.meta.url)))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  let max = 0;
  for (const f of files) {
    const issue = JSON.parse(await read(`issues/${f}`));
    if (typeof issue.number === "number" && issue.number > max) max = issue.number;
  }
  return max + 1;
}

function buildSystemPrompt(spec, examples) {
  // curator-prompt.md with the behavior spec pasted into <spec>, plus blurb examples for voice
  return `You are the curator for Off/Feed, a daily video issue for one viewer. Your job is to decide which candidate videos belong in today's issue and to write a short factual note for each one you include.

The viewer built Off/Feed to watch YouTube without its recommendation algorithm. Act like an editor with a strict style guide, not a recommender trying to maximize watch time. A short issue is a good result. Fifteen videos is a ceiling, not a target.

<spec>
${spec.trim()}
</spec>

Working rules:
- Use only the title, channel and description given for each candidate. Don't draw on anything you remember about a channel or video; it may be wrong or out of date.
- Never change or restate a title, length or date. Code fills those in.
- If a description is mostly sponsorship or links, write the note from the title alone and keep it short, or exclude the video if the title is unclear.
- Choose at most one video per channel. If a channel has several candidates, pick the one that best fits the spec and record why.
- Return only the JSON array described under "Output." Give every candidate a decision.

<blurb-examples>
${examples.trim()}
</blurb-examples>`;
}

function buildUserMessage(candidates, touchstones) {
  const slim = candidates.map((v) => ({
    id: v.id,
    channel: v.channel,
    topic: v.topic,
    title: v.title,
    description: v.description
  }));
  return `Touchstones (taste signal — may mention in a blurb when the connection is factual):
${JSON.stringify(touchstones, null, 2)}

Candidates (decide include or exclude for every id):
${JSON.stringify(slim, null, 2)}

Respond by calling submit_decisions with one decision object per candidate. No other text.`;
}

function extractJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error("Model response did not contain a JSON array.");
  return JSON.parse(raw.slice(start, end + 1));
}

const DECISIONS_TOOL = {
  name: "submit_decisions",
  description: "Submit an include/exclude decision and optional blurb for every candidate video.",
  input_schema: {
    type: "object",
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            decision: { type: "string", enum: ["include", "exclude"] },
            rule: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            topic: { type: "string" },
            why: { type: "string", description: "Blurb if include; empty string if exclude" }
          },
          required: ["id", "decision", "rule", "confidence", "why"]
        }
      }
    },
    required: ["decisions"]
  }
};

async function callAnthropic(system, user) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Set ANTHROPIC_API_KEY in .env (see .env.example).");
  const model = process.env.CURATOR_MODEL || "claude-sonnet-4-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 16384,
      system,
      tools: [DECISIONS_TOOL],
      tool_choice: { type: "tool", name: "submit_decisions" },
      messages: [{ role: "user", content: user }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const tool = (data.content || []).find((b) => b.type === "tool_use" && b.name === "submit_decisions");
  if (tool?.input?.decisions) {
    return { model, text: JSON.stringify({ decisions: tool.input.decisions }), stopReason: data.stop_reason };
  }
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return { model, text, stopReason: data.stop_reason };
}

async function callOpenAI(system, user) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Set OPENAI_API_KEY in .env (see .env.example).");
  const model = process.env.CURATOR_MODEL || "gpt-4.1";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system + "\n\nWrap the array as {\"decisions\": [...]}." },
        { role: "user", content: user }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return { model, text };
}

async function complete(system, user) {
  const provider =
    process.env.CURATOR_PROVIDER ||
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "anthropic");
  if (provider === "openai") return { provider, stopReason: null, ...(await callOpenAI(system, user)) };
  if (provider === "anthropic") return { provider, ...(await callAnthropic(system, user)) };
  throw new Error(`Unknown CURATOR_PROVIDER="${provider}" (use anthropic or openai).`);
}

function parseDecisions(text) {
  // Anthropic returns a bare array; OpenAI returns {"decisions":[...]}
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.decisions)) return parsed.decisions;
  } catch {
    /* fall through to fence/slice parser */
  }
  const arr = extractJsonArray(text);
  return arr;
}

function assembleIssue({ date, number, candidates, decisions }) {
  const byId = new Map(candidates.map((v) => [v.id, v]));
  const issueYear = Number(date.slice(0, 4));
  const seenChannels = new Set();
  const included = [];
  const review = [];

  for (const d of decisions) {
    const v = byId.get(d.id);
    if (!v) {
      review.push({ id: d.id, note: "unknown id from model — ignored" });
      continue;
    }
    const decision = d.decision === "include" ? "include" : "exclude";
    const confidence = d.confidence || "low";
    if (decision === "include" && confidence === "low") {
      review.push({ id: d.id, channel: v.channel, title: v.title, note: "low confidence include → treated as exclude", rule: d.rule });
      continue;
    }
    if (decision !== "include") continue;
    if (seenChannels.has(v.channel)) {
      review.push({ id: d.id, channel: v.channel, title: v.title, note: "second pick from same channel — dropped", rule: d.rule });
      continue;
    }
    if (included.length >= MAX_INCLUDE) {
      review.push({ id: d.id, channel: v.channel, title: v.title, note: "over 15-video ceiling — dropped", rule: d.rule });
      continue;
    }
    const why = typeof d.why === "string" ? d.why.trim() : "";
    if (!why) {
      review.push({ id: d.id, channel: v.channel, title: v.title, note: "include without blurb — dropped", rule: d.rule });
      continue;
    }
    seenChannels.add(v.channel);
    included.push({
      id: v.id,
      channel: v.channel,
      title: v.title,
      minutes: v.minutes,
      published: formatPublished(v.published, issueYear),
      why,
      topic: TOPIC_NAME[v.topic] || v.topic,
      _rule: d.rule,
      _confidence: confidence,
      _topicLabel: d.topic
    });
  }

  const byTopic = new Map(TOPIC_ORDER.map((name) => [name, []]));
  for (const item of included) {
    const topic = item.topic;
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push({
      id: item.id,
      channel: item.channel,
      title: item.title,
      minutes: item.minutes,
      published: item.published,
      why: item.why
    });
  }

  const topics = [...byTopic.entries()]
    .filter(([, items]) => items.length)
    .map(([name, items]) => ({ name, items }));

  return {
    issue: {
      number,
      date,
      weekOf: formatWeekOf(date),
      nextIssue: formatNextIssue(date),
      topics
    },
    included,
    review
  };
}

async function publishIssue(issue) {
  await writeFile(
    new URL(`../issues/${issue.date}.json`, import.meta.url),
    JSON.stringify(issue, null, 2) + "\n"
  );
  const indexPath = new URL("../issues/index.json", import.meta.url);
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  if (!index.issues.includes(issue.date)) index.issues.push(issue.date);
  index.issues.sort();
  index.latest = issue.date;
  await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
}

// --- main ---
const date = opt("--date") || await latestCandidatesDate();
const publish = flag("--publish");

const candidatesFile = JSON.parse(await read(`candidates/${date}.json`));
const candidates = candidatesFile.kept;
if (!candidates?.length) throw new Error(`candidates/${date}.json has no kept videos.`);

const [spec, examples, touchstones] = await Promise.all([
  read("spec/behavior-spec.md"),
  read("spec/blurb-examples.md"),
  loadJson("data/touchstones.json")
]);

console.log(`Curating ${candidates.length} candidates from candidates/${date}.json …`);
const { provider, model, text, stopReason } = await complete(
  buildSystemPrompt(spec, examples),
  buildUserMessage(candidates, touchstones)
);
let decisions;
try {
  decisions = parseDecisions(text);
} catch (err) {
  await mkdir(new URL("../drafts", import.meta.url), { recursive: true });
  await writeFile(
    new URL(`../drafts/${date}.raw.txt`, import.meta.url),
    `stop_reason=${stopReason || "?"}\n\n${text}`
  );
  throw new Error(`${err.message} (raw response saved to drafts/${date}.raw.txt)`);
}
if (!Array.isArray(decisions) || !decisions.length) {
  throw new Error("Model returned no decisions.");
}

const number = await nextIssueNumber(date);
const { issue, included, review } = assembleIssue({ date, number, candidates, decisions });

await mkdir(new URL("../drafts", import.meta.url), { recursive: true });
await mkdir(new URL("../evals/runs", import.meta.url), { recursive: true });

const draft = {
  ...issue,
  _draft: {
    generated: new Date().toISOString(),
    provider,
    model,
    candidates: candidates.length,
    included: included.length,
    decisions,
    review
  }
};
await writeFile(
  new URL(`../drafts/${date}.json`, import.meta.url),
  JSON.stringify(draft, null, 2) + "\n"
);

const runName = `${date}-curate`;
await writeFile(
  new URL(`../evals/runs/${runName}.json`, import.meta.url),
  JSON.stringify({
    _note: `Curator run for ${date}`,
    generated: draft._draft.generated,
    provider,
    model,
    decisions,
    review
  }, null, 2) + "\n"
);

if (publish) {
  await publishIssue(issue);
  console.log(`Published issues/${date}.json and updated issues/index.json.`);
}

const counts = Object.fromEntries(
  issue.topics.map((t) => [t.name, t.items.length])
);
console.log(`Draft: drafts/${date}.json (${included.length} videos).`);
console.log(`Run log: evals/runs/${runName}.json`);
console.log(`By topic:`, counts);
if (review.length) console.log(`Needs review (${review.length}):`, review.map((r) => r.id).join(", "));
if (!publish) console.log(`Next: open the draft, then npm run curate -- --date ${date} --publish`);
