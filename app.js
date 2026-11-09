/* Off/Feed — renders one finite issue from issues/<date>.json.
   Data:  issues/index.json (which issue is latest), data/touchstones.json, data/channel-types.json
   Needs to be served over http(s) (npm run dev) so fetch() and the YouTube player work. */

const $ = id => document.getElementById(id);
const fmt = m => m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const getJSON = p => fetch(p).then(r => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });

let ISSUE, ALL = [], TOTAL = 0, KEY, state = {}, budget = 0;

/* ---------- watch state: { [videoId]: "started" | "watched" } ---------- */
function load() { try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { state = {}; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
function setState(id, s) {
  if (s === "started" && state[id] === "watched") return;
  if (s) state[id] = s; else delete state[id];
  save(); render();
}

/* ---------- placeholder screen ---------- */
function placeholder(v) {
  const thumb = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
  return `<button type="button" class="ph" data-play="${v.id}" aria-label="Play ${esc(v.title)}">
    <img class="ph-thumb" src="${thumb}" alt="" width="320" height="180" decoding="async" loading="lazy">
  </button>`;
}

function build() {
  $("e-num").textContent = `Issue No. ${ISSUE.number}`;
  $("e-week").textContent = ISSUE.weekOf;
  $("e-next").textContent = `Next issue ${ISSUE.nextIssue}`;

  $("issue").innerHTML = ISSUE.topics.map(tp => {
    const mins = tp.items.reduce((a, v) => a + v.minutes, 0);
    return `<section class="topic"><h2>${esc(tp.name)} <small>${tp.items.length} · ${fmt(mins)}</small></h2><ol class="items">` +
      tp.items.map(v => `
      <li class="item" data-id="${v.id}" data-m="${v.minutes}">
        <div class="body">
          <div class="meta"><span>${esc(v.channel)}</span><span>${v.minutes} min</span><button type="button" class="status" id="st-${v.id}" hidden></button></div>
          <h3 class="ttl">${esc(v.title)}</h3>
          <p class="why">${esc(v.why)}</p>
        </div>
        <div class="screen" id="sc-${v.id}">${placeholder(v)}</div>
      </li>`).join("") + `</ol></section>`;
  }).join("");
}

function render() {
  let left = 0, n = 0;
  document.querySelectorAll("li.item").forEach(li => {
    const id = li.dataset.id, m = +li.dataset.m, s = state[id], done = s === "watched";
    li.classList.toggle("is-done", done);
    li.classList.toggle("is-over", !done && budget > 0 && m > budget && !li.classList.contains("is-playing"));
    const chip = $("st-" + id);
    chip.hidden = !s;
    if (s) {
      chip.dataset.s = s;
      chip.textContent = done ? "Watched ✓" : "In progress";
      chip.title = done ? "Mark as not watched" : "Mark as watched";
    }
    if (done) n++; else left += m;
  });
  $("m-count").textContent = `${n} of ${ALL.length} watched`;
  $("m-time").textContent = left ? `${fmt(left)} left in this issue` : "Issue finished";
  $("m-bar").style.width = `${Math.round((TOTAL - left) / TOTAL * 100)}%`;
  const complete = n === ALL.length;
  const end = $("end");
  end.classList.toggle("is-complete", complete);
  end.setAttribute("aria-label", complete ? "Issue finished" : "End of issue");
}

/* ---------- YouTube player: thumbnail expands into a theater overlay ---------- */
let current = null, apiReady = null, closing = null;
const MOTION_MS = 580;
const MOTION_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = ms => new Promise(r => setTimeout(r, ms));
const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

function loadApi() {
  return apiReady ??= new Promise(res => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
}

function flipFromTo(el, from, to) {
  const sx = from.width / Math.max(to.width, 1);
  const sy = from.height / Math.max(to.height, 1);
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  el.style.transition = "none";
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

async function expandStage(stage, from) {
  const to = stage.getBoundingClientRect();
  if (reduceMotion() || from.width < 2) {
    stage.style.transform = "";
    return;
  }
  flipFromTo(stage, from, to);
  await frames();
  stage.style.transition = `transform ${MOTION_MS}ms ${MOTION_EASE}`;
  stage.style.transform = "none";
  await wait(MOTION_MS);
  stage.style.transition = "";
}

async function collapseStage(stage, toEl) {
  if (reduceMotion() || !toEl) return;
  const from = stage.getBoundingClientRect();
  const to = toEl.getBoundingClientRect();
  if (to.width < 2) return;
  const sx = to.width / Math.max(from.width, 1);
  const sy = to.height / Math.max(from.height, 1);
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  stage.style.transition = `transform ${MOTION_MS}ms ${MOTION_EASE}`;
  stage.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  await wait(MOTION_MS);
}

function teardownTheater(session) {
  clearInterval(session.timer);
  try { session.player?.destroy(); } catch {}
  session.theater?.remove();
  document.body.classList.remove("is-theater");
  document.removeEventListener("keydown", onTheaterKey);
  const sc = $("sc-" + session.id);
  sc?.closest("li")?.classList.remove("is-playing");
}

function onTheaterKey(e) {
  if (e.key === "Escape") closeCurrent();
}

async function closeCurrent({ animate = true } = {}) {
  if (closing) return closing;
  if (!current) return;
  const session = current;
  current = null;
  closing = (async () => {
    const cover = session.theater.querySelector(".theater-cover");
    if (cover) cover.classList.remove("is-gone");
    clearInterval(session.timer);
    try { session.player?.destroy(); } catch {}
    session.player = null;
    session.theater.classList.remove("is-open");
    const sc = $("sc-" + session.id);
    if (animate) await collapseStage(session.theater.querySelector(".theater-stage"), sc);
    else await wait(reduceMotion() ? 0 : 160);
    teardownTheater(session);
    sc?.querySelector("[data-play]")?.focus();
    render();
  })();
  try { await closing; } finally { closing = null; }
}

async function play(id) {
  if (current?.id === id) return;
  await closeCurrent({ animate: false });

  const video = ALL.find(x => x.id === id);
  const sc = $("sc-" + id);
  if (!video || !sc) return;
  const from = sc.getBoundingClientRect();
  const thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  sc.closest("li").classList.add("is-playing");

  const theater = document.createElement("div");
  theater.className = "theater";
  theater.setAttribute("role", "dialog");
  theater.setAttribute("aria-modal", "true");
  theater.setAttribute("aria-label", video.title);
  theater.innerHTML = `
    <button type="button" class="theater-backdrop" aria-label="Close video"></button>
    <div class="theater-panel">
      <button type="button" class="theater-close" aria-label="Close video">Close</button>
      <div class="theater-stage">
        <div class="yt" id="yt-${id}"></div>
        <img class="theater-cover" src="${thumb}" alt="" width="1280" height="720" decoding="async">
      </div>
    </div>`;
  document.body.appendChild(theater);
  document.body.classList.add("is-theater");
  document.addEventListener("keydown", onTheaterKey);
  theater.querySelector(".theater-backdrop").addEventListener("click", () => closeCurrent());
  theater.querySelector(".theater-close").addEventListener("click", () => closeCurrent());

  const stage = theater.querySelector(".theater-stage");
  const cover = theater.querySelector(".theater-cover");
  current = { id, player: null, timer: null, theater };

  await frames();
  theater.classList.add("is-open");
  await expandStage(stage, from);

  await loadApi();
  if (!current || current.id !== id) return; // closed during expand
  const player = new YT.Player("yt-" + id, {
    host: "https://www.youtube-nocookie.com",
    videoId: id,
    playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
    events: {
      onStateChange: ev => {
        if (ev.data === YT.PlayerState.PLAYING) {
          setState(id, "started");
          cover?.classList.add("is-gone");
        }
        if (ev.data === YT.PlayerState.ENDED) setState(id, "watched");
      }
    }
  });
  // Count as watched at 90% so skipping end credits still finishes it.
  const timer = setInterval(() => {
    try {
      const d = player.getDuration(), t = player.getCurrentTime();
      if (d > 0 && t / d >= 0.9) setState(id, "watched");
    } catch {}
  }, 5000);
  if (current?.id === id) Object.assign(current, { player, timer });
  theater.querySelector(".theater-close").focus();
}

/* ---------- events ---------- */
function wire() {
  $("issue").addEventListener("click", e => {
    const chip = e.target.closest(".status");
    if (chip) { const id = chip.closest("li").dataset.id; setState(id, state[id] === "watched" ? null : "watched"); return; }
    const b = e.target.closest("button[data-play]");
    if (b) play(b.dataset.play);
  });
  document.querySelector(".budget").addEventListener("click", e => {
    const b = e.target.closest("button[data-b]");
    if (!b) return;
    budget = +b.dataset.b;
    document.querySelectorAll(".budget button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    render();
  });
  window.addEventListener("hashchange", route);
}

function route() {
  const about = location.hash === "#about";
  $("view-issue").hidden = about;
  $("mast-issue").hidden = about;
  $("view-about").hidden = !about;
  $("nav-about").setAttribute("aria-current", about ? "page" : "false");
  $("nav-issue").setAttribute("aria-current", about ? "false" : "page");
  if (about) closeCurrent();
}

/* ---------- boot ---------- */
(async () => {
  try {
    const idx = await getJSON("issues/index.json");
    const [issue, seeds, types] = await Promise.all([
      getJSON(`issues/${idx.latest}.json`), getJSON("data/touchstones.json"), getJSON("data/channel-types.json")
    ]);
    ISSUE = issue;
    ALL = issue.topics.flatMap(t => t.items);
    TOTAL = ALL.reduce((a, v) => a + v.minutes, 0);
    KEY = "offfeed-" + issue.date;
    load(); build();
    $("seeds").innerHTML = seeds.map(s =>
      `<li><a href="https://www.youtube.com/watch?v=${s.id}" target="_blank" rel="noopener">${esc(s.title)}</a> <small>${esc(s.channel)}</small></li>`).join("");
    $("types").innerHTML = types.map(t =>
      `<li><strong>${esc(t.name)}</strong><span>${esc(t.description)}</span></li>`).join("");
    wire(); route(); render();
  } catch (err) {
    $("issue").innerHTML = `<p>Couldn't load this issue (${esc(err.message)}). Start the site with <code>npm run dev</code> rather than opening the file directly.</p>`;
  }
})();
