/* Off/Feed — renders one finite issue from issues/<date>.json.
   Data:  issues/index.json (which issue is latest), data/touchstones.json, data/channels.json
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
  return `<button type="button" class="ph" data-play="${v.id}" aria-label="Play ${esc(v.title)}">
    <span class="ph-top"><span>${esc(v.channel)}</span><span class="ph-rt">${v.minutes} min</span></span>
    <span class="ph-play" aria-hidden="true"></span>
    <span class="ph-bot"><span class="ph-hint">Plays here</span><span>${esc(v.published)}</span></span>
  </button>`;
}

function build() {
  $("e-num").textContent = `Issue No. ${ISSUE.number}`;
  $("e-week").textContent = `Week of ${ISSUE.weekOf}`;
  $("e-next").textContent = `Next issue ${ISSUE.nextIssue}`;
  $("dek").textContent = `${ALL.length} long-form videos from people with a point of view. ${ISSUE.topics.map(t => t.name).join(", ")}. Nothing autoplays, nothing is recommended after, and the issue ends.`;

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
  $("end").classList.toggle("is-complete", complete);
  $("end-h").textContent = complete ? "You finished the issue." : "That's the whole issue.";
  $("end-p").textContent = complete
    ? `That's all ${ALL.length}. Close the tab. The next issue arrives ${ISSUE.nextIssue}.`
    : "There's no “up next.” When you finish these, you're done until the next issue.";
}

/* ---------- YouTube player: progress marks watched automatically ---------- */
let current = null, apiReady = null;
function loadApi() {
  return apiReady ??= new Promise(res => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
}
function closeCurrent() {
  if (!current) return;
  clearInterval(current.timer);
  try { current.player.destroy(); } catch {}
  const sc = $("sc-" + current.id);
  sc.innerHTML = placeholder(ALL.find(x => x.id === current.id));
  sc.closest("li").classList.remove("is-playing");
  current = null; render();
}
async function play(id) {
  closeCurrent();
  const sc = $("sc-" + id);
  sc.closest("li").classList.add("is-playing");
  sc.innerHTML = `<div class="yt" id="yt-${id}"></div>`;
  await loadApi();
  const player = new YT.Player("yt-" + id, {
    host: "https://www.youtube-nocookie.com",
    videoId: id,
    playerVars: { autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
    events: {
      onStateChange: ev => {
        if (ev.data === YT.PlayerState.PLAYING) setState(id, "started");
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
  current = { id, player, timer };
  sc.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    const [issue, seeds, pool] = await Promise.all([
      getJSON(`issues/${idx.latest}.json`), getJSON("data/touchstones.json"), getJSON("data/channels.json")
    ]);
    ISSUE = issue;
    ALL = issue.topics.flatMap(t => t.items);
    TOTAL = ALL.reduce((a, v) => a + v.minutes, 0);
    KEY = "offfeed-" + issue.date;
    load(); build();
    $("seeds").innerHTML = seeds.map(s =>
      `<li><a href="https://www.youtube.com/watch?v=${s.id}" target="_blank" rel="noopener">${esc(s.title)}</a> <small>${esc(s.channel)}</small></li>`).join("");
    $("pool").innerHTML = pool.map(c => `<li>${esc(c.name)} <span>${esc(c.topic)}</span></li>`).join("");
    wire(); route(); render();
  } catch (err) {
    $("issue").innerHTML = `<p>Couldn't load this issue (${esc(err.message)}). Start the site with <code>npm run dev</code> rather than opening the file directly.</p>`;
  }
})();
