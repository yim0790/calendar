// 달력 위젯 앱 동작 (달력 그리기·편집·드래그·설정·로그인 화면) — 저장은 store.js의 Store가 담당
import { Store } from "./store.js";

/* =====================================================================
   1. 고정 값
   ===================================================================== */
const SYMS = ["•", "★", "V"];                          // V는 굵은 체크 모양으로 표시
const TEXT_PALETTE = ["#FF1A1A", "#0000E6", "#006666", "#5900B2", "#FFFF1A", "#FFFFFF"];
const ITEM_COLORS = ["", ...TEXT_PALETTE];              // "" = 달력 기본 글자색
const BG_COLORS = ["#283c50", "#1f2a36", "#3b4d3a", "#4a3b5c", "#5c3b3b", "#6b6b6b", "#ffffff"];
const DEFAULT_SETTINGS = { bgColor: "#283c50", bgAlpha: 0.38, textColor: "#ffffff" };
const WD = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const CHECK_SVG = `<svg class="chk" viewBox="0 0 16 16" aria-label="체크"><path d="M2 8.5l4 4L14 3.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const HEX = /^#[0-9a-fA-F]{6}$/;

/* =====================================================================
   2. 데이터 점검 (잘못된 값이 화면을 깨뜨리지 않게)
   ===================================================================== */
const isDayKey = k => /^\d{4}-\d{2}-\d{2}$/.test(k);
function cleanItem(it) {
  if (!it || typeof it.t !== "string" || !it.t.trim()) return null;
  return {
    s: SYMS.includes(it.s) ? it.s : "•",
    t: it.t.trim().slice(0, 200),
    d: it.d === true,
    c: ITEM_COLORS.includes(it.c) ? it.c : ""
  };
}
function cleanDays(raw) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const k in raw) {
      if (!isDayKey(k) || !Array.isArray(raw[k])) continue;
      const items = raw[k].map(cleanItem).filter(Boolean);
      if (items.length) out[k] = items;
    }
  }
  return out;
}
function cleanSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (raw && HEX.test(raw.bgColor)) s.bgColor = raw.bgColor;
  if (raw && typeof raw.bgAlpha === "number" && raw.bgAlpha >= 0.05 && raw.bgAlpha <= 1) s.bgAlpha = raw.bgAlpha;
  if (raw && HEX.test(raw.textColor)) s.textColor = raw.textColor;
  return s;
}
function cleanHolidays(raw) {            // { "2026": { days: { "2026-09-25": "추석" } } } → { "2026-09-25": "추석" }
  const out = {};
  if (raw && typeof raw === "object") {
    for (const y in raw) {
      const days = raw[y] && raw[y].days;
      if (!days || typeof days !== "object") continue;
      for (const k in days) if (isDayKey(k) && typeof days[k] === "string") out[k] = days[k];
    }
  }
  return out;
}

/* =====================================================================
   3. 상태
   ===================================================================== */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const symHtml = s => (s === "V" ? CHECK_SVG : esc(s));

let days = {};                           // 화면에 보이는 기간의 일정만 보관
let settings = cleanSettings({});
let holidays = {};
let user = null;
let lastSavedAt = null;
let today = new Date();
let view = new Date(today.getFullYear(), today.getMonth(), 1);

function persist(changes) {             // 화면 먼저 반영 → 저장(서버 전송은 store가 처리)
  if (!user) return;
  for (const k in changes) { if (changes[k].length) days[k] = changes[k]; else delete days[k]; }
  render();
  Store.saveDays(changes).then(ok => { if (ok) lastSavedAt = new Date(); showSync(); });
}
let syncInfo = { code: "synced", text: "" };
function showSync(st) {                  // 하단 문구 + 설정창 동기화 상태
  if (st) syncInfo = st;
  const t = lastSavedAt;
  const text = syncInfo.code === "synced"
    ? (t ? `동기화 완료 ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}` : (user ? "동기화 완료" : ""))
    : syncInfo.text;
  $("sync").textContent = text;
  $("syncState").textContent = user ? (syncInfo.text || "동기화 완료") : "로그인 후 동기화";
  $("syncState").style.color = { synced: "#1a9a4a", pending: "#777", offline: "#c77700", error: "#d33" }[syncInfo.code];
}

/* =====================================================================
   4. 달력 그리기
   ===================================================================== */
function render() {
  $("title").textContent = `오늘은 ${today.getFullYear()}년${today.getMonth() + 1}월${today.getDate()}일 ${WD[today.getDay()]}`;
  const g = $("grid");
  const start = new Date(view); start.setDate(1 - view.getDay());
  const last = new Date(view.getFullYear(), view.getMonth() + 1, 0);
  const weeks = Math.ceil((view.getDay() + last.getDate()) / 7);
  g.style.gridTemplateRows = `auto repeat(${weeks}, minmax(0, 1fr))`;
  watchRange(key(start), key(new Date(start.getFullYear(), start.getMonth(), start.getDate() + weeks * 7 - 1)));
  const tk = key(today);
  let html = WD.map(w => `<div class="wd">${w}</div>`).join("");
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = key(d);
    const hol = holidays[k] ? `<span class="hol">${esc(holidays[k])}</span>` : "";
    const label = d.getDate() === 1
      ? `<span class="d first">${d.getMonth() + 1}월${hol}</span>`
      : `<span class="d">${d.getDate()}</span>${hol}`;
    const items = (days[k] || []).map((it, idx) =>
      `<li class="${it.d ? "done" : ""}" data-i="${idx}"${it.c ? ` style="color:${it.c}"` : ""}><span class="sym">${symHtml(it.s)}</span>${esc(it.t)}</li>`).join("");
    const cls = ["cell", d.getMonth() !== view.getMonth() ? "other" : "", k === tk ? "today" : ""].join(" ").trim();
    html += `<div class="${cls}" data-k="${k}">${label}<ul>${items}</ul></div>`;
  }
  g.innerHTML = html;
}

/* =====================================================================
   5. 편집창
   ===================================================================== */
const ed = $("editor");
let editing = null, palRow = null;
const editorOpen = () => ed.style.display === "block";

function setRowColor(r, c) {
  r.dataset.c = c;
  r.querySelector(".cb").style.background = c || "#fff";
  const inp = r.querySelector("input[type=text]");
  inp.style.color = c;
  // 흰색·노랑처럼 밝은 색은 흰 편집창에서 안 보이므로 입력칸만 어둡게
  const n = c ? parseInt(c.slice(1), 16) : 0;
  const light = c && (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 200;
  inp.style.background = light ? "#555" : "";
}
function addRow(it, after) {
  const r = document.createElement("div");
  r.className = "row" + (it.d ? " done" : "");
  r.innerHTML = `<button class="sb" type="button" title="기호 바꾸기"></button><input type="text" maxlength="200"><button class="cb" type="button" title="글자색"></button><input type="checkbox" title="완료">`;
  const sb = r.querySelector(".sb"); sb.dataset.s = it.s; sb.innerHTML = symHtml(it.s);
  r.querySelector("input[type=text]").value = it.t;
  r.querySelector("input[type=checkbox]").checked = it.d;
  setRowColor(r, it.c || "");
  after ? after.after(r) : $("rows").appendChild(r);
  return r;
}
function openEditor(cell) {
  if (editorOpen()) saveEditor();
  editing = cell.dataset.k;
  const [y, m, d] = editing.split("-").map(Number);
  $("edate").textContent = `${y}년 ${m}월 ${d}일`;
  $("rows").innerHTML = "";
  (days[editing] || []).forEach(it => addRow(it));
  const blank = addRow({ s: "•", t: "", d: false, c: "" });
  // 칸 옆에 띄우되 위젯 밖으로 나가지 않게
  const w = $("widget").getBoundingClientRect(), r = cell.getBoundingClientRect();
  const W = 250, H = 300;
  let left = r.right - w.left - 60;
  if (left + W > w.width) left = r.left - w.left - W + 60;
  ed.style.left = Math.max(4, Math.min(left, w.width - W - 4)) + "px";
  ed.style.top = Math.max(40, Math.min(r.top - w.top + 30, w.height - H - 4)) + "px";
  ed.style.display = "block";
  blank.querySelector("input[type=text]").focus();
}
function closeEditor() {
  ed.style.display = "none"; $("pal").style.display = "none";
  editing = null; palRow = null;
}
function saveEditor() {
  if (!editing) return;
  const items = [...$("rows").children].map(r => cleanItem({
    s: r.querySelector(".sb").dataset.s,
    t: r.querySelector("input[type=text]").value,
    d: r.querySelector("input[type=checkbox]").checked,
    c: r.dataset.c || ""
  })).filter(Boolean);
  const k = editing;
  closeEditor();
  const before = JSON.stringify(days[k] || []);
  if (before !== JSON.stringify(items)) persist({ [k]: items });   // 바뀐 것이 있을 때만 저장
}

$("save").onclick = saveEditor;
$("pal").innerHTML = ITEM_COLORS.map(c =>
  `<span data-c="${c}" class="${c ? "" : "def"}" title="${c || "기본색"}" style="${c ? `background:${c}` : ""}"></span>`).join("");
$("pal").onclick = e => {
  if (!e.target.matches("span") || !palRow) return;
  setRowColor(palRow, e.target.dataset.c);
  $("pal").style.display = "none";
  palRow.querySelector("input[type=text]").focus();
};
$("rows").addEventListener("click", e => {
  const cb = e.target.closest(".cb");
  if (cb) {                                  // 글자색 팔레트 열기
    const pal = $("pal"), rr = cb.getBoundingClientRect(), er = ed.getBoundingClientRect();
    palRow = cb.closest(".row");
    pal.style.left = Math.max(0, Math.min(rr.left - er.left - 60, er.width - 180)) + "px";
    pal.style.top = (rr.bottom - er.top + 2) + "px";
    pal.style.display = "flex";
    return;
  }
  const sb = e.target.closest(".sb");
  if (sb) {                                  // 기호 • → ★ → ✔
    sb.dataset.s = SYMS[(SYMS.indexOf(sb.dataset.s) + 1) % SYMS.length];
    sb.innerHTML = symHtml(sb.dataset.s);
    sb.closest(".row").querySelector("input[type=text]").focus();
  }
});
$("rows").addEventListener("change", e => {
  if (e.target.type === "checkbox") e.target.closest(".row").classList.toggle("done", e.target.checked);
});
ed.addEventListener("keydown", e => {
  if (e.key === "Escape") { e.preventDefault(); closeEditor(); return; }      // 저장 없이 닫기
  if (e.target.type !== "text") return;
  const row = e.target.closest(".row");
  if (e.key === "Enter") {
    if (e.isComposing || e.keyCode === 229) return;    // 한글 조합 중 Enter 무시 (글자 잘림 방지)
    e.preventDefault();
    if (!e.shiftKey) { saveEditor(); return; }         // Enter = 저장
    addRow({ s: row.querySelector(".sb").dataset.s, t: "", d: false, c: row.dataset.c }, row)
      .querySelector("input[type=text]").focus();
  } else if (e.key === "Backspace" && e.target.value === "" && $("rows").children.length > 1) {
    e.preventDefault();
    const other = row.previousElementSibling || row.nextElementSibling;
    row.remove();
    other.querySelector("input[type=text]").focus();
  }
});
// 편집창 바깥을 누르면 저장하고 닫기 (입력한 내용이 사라지지 않게)
document.addEventListener("pointerdown", e => {
  if (!editorOpen() || ed.contains(e.target)) return;
  if (e.target.closest(".cell")) return;        // 다른 날짜 클릭은 openEditor에서 저장 후 전환
  saveEditor();
}, true);

/* =====================================================================
   6. 달력 조작: 클릭 / 더블클릭 / 드래그
   ===================================================================== */
const grid = $("grid");
let clickTimer = null, drag = null, justDragged = false;

grid.addEventListener("click", e => {
  if (justDragged) { justDragged = false; return; }
  const c = e.target.closest(".cell"); if (!c) return;
  if (e.target.closest("li")) {               // 더블클릭과 구분하려고 잠깐 대기
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => openEditor(c), 250);
  } else openEditor(c);
});
grid.addEventListener("dblclick", e => {
  const li = e.target.closest("li"); if (!li) return;
  clearTimeout(clickTimer);
  const k = li.closest(".cell").dataset.k;
  const items = days[k].map((it, i) => (i === +li.dataset.i ? { ...it, d: !it.d } : it));
  persist({ [k]: items });
});
grid.addEventListener("pointerdown", e => {
  const li = e.target.closest("li"); if (!li || e.button !== 0) return;
  drag = { from: li.closest(".cell").dataset.k, i: +li.dataset.i, x: e.clientX, y: e.clientY, on: false, text: li.textContent };
});
document.addEventListener("pointermove", e => {
  if (!drag) return;
  if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
  if (!drag.on) {
    drag.on = true;
    clearTimeout(clickTimer);
    if (editorOpen()) saveEditor();
    drag.ghost = Object.assign(document.createElement("div"), { className: "ghost", textContent: drag.text });
    document.body.appendChild(drag.ghost);
  }
  drag.ghost.style.left = (e.clientX + 10) + "px";
  drag.ghost.style.top = (e.clientY + 8) + "px";
  grid.querySelectorAll(".cell.drop").forEach(c => c.classList.remove("drop"));
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".cell");
  if (over) over.classList.add("drop");
});
function endDrag(e) {
  if (!drag) return;
  const d = drag; drag = null;
  if (!d.on) return;
  d.ghost.remove();
  grid.querySelectorAll(".cell.drop").forEach(c => c.classList.remove("drop"));
  justDragged = true; setTimeout(() => (justDragged = false), 50);
  const to = e.type === "pointerup" ? document.elementFromPoint(e.clientX, e.clientY)?.closest(".cell")?.dataset.k : null;
  if (!to || to === d.from || !days[d.from] || !days[d.from][d.i]) return;
  const fromItems = days[d.from].filter((_, i) => i !== d.i);
  const toItems = [...(days[to] || []), days[d.from][d.i]];
  persist({ [d.from]: fromItems, [to]: toItems });          // 두 날짜를 한 번에 저장
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

function goMonth(delta) {
  if (editorOpen()) saveEditor();
  view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
  render();
}
$("prev").onclick = () => goMonth(-1);
$("next").onclick = () => goMonth(1);
$("today").onclick = () => { if (editorOpen()) saveEditor(); view = new Date(today.getFullYear(), today.getMonth(), 1); render(); };

/* =====================================================================
   7. 설정: 배경색·투명도·글자색 (+ 동기화·계정 자리)
   ===================================================================== */
const rootStyle = document.documentElement.style;
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; };
function applySettings() {
  rootStyle.setProperty("--bg-rgb", rgb(settings.bgColor));
  rootStyle.setProperty("--bg-alpha", settings.bgAlpha);
  rootStyle.setProperty("--text", settings.textColor);
  rootStyle.setProperty("--sub", `rgba(${rgb(settings.textColor)},.75)`);
  $("picker").value = settings.bgColor.toLowerCase();
  $("tpicker").value = settings.textColor.toLowerCase();
  const pct = Math.round((1 - settings.bgAlpha) * 100);    // 화면에는 '투명도 %'로 표시
  $("alpha").value = pct; $("alphaTxt").textContent = pct + "%";
  document.querySelectorAll("#swatches .sw").forEach(s => s.classList.toggle("on", s.dataset.c.toLowerCase() === settings.bgColor.toLowerCase()));
  document.querySelectorAll("#tswatches .sw").forEach(s => s.classList.toggle("on", s.dataset.c.toLowerCase() === settings.textColor.toLowerCase()));
}
function changeSettings(patch) {
  settings = cleanSettings({ ...settings, ...patch });
  applySettings();
  if (user) Store.saveSettings(settings).then(ok => { if (ok) lastSavedAt = new Date(); showSync(); });
}
const swatchHtml = list => list.map(c => `<span class="sw" data-c="${c}" style="background:${c}" title="${c}"></span>`).join("");
$("swatches").innerHTML = swatchHtml(BG_COLORS);
$("tswatches").innerHTML = swatchHtml(TEXT_PALETTE);
$("swatches").onclick = e => { if (e.target.dataset.c) changeSettings({ bgColor: e.target.dataset.c }); };
$("tswatches").onclick = e => { if (e.target.dataset.c) changeSettings({ textColor: e.target.dataset.c }); };
$("picker").onchange = e => changeSettings({ bgColor: e.target.value });
$("tpicker").onchange = e => changeSettings({ textColor: e.target.value });
$("alpha").oninput = e => {                  // 끄는 동안은 화면만, 손을 떼면 저장
  $("alphaTxt").textContent = e.target.value + "%";
  rootStyle.setProperty("--bg-alpha", (100 - e.target.value) / 100);
};
$("alpha").onchange = e => changeSettings({ bgAlpha: (100 - e.target.value) / 100 });
$("menu").onclick = () => { const s = $("settings"); s.style.display = s.style.display === "block" ? "none" : "block"; };
$("closeSet").onclick = () => ($("settings").style.display = "none");
$("syncNow").onclick = () => Store.syncNow();
$("login").onclick = () => (user ? Store.signOut() : doSignIn());
$("loginBtn").onclick = doSignIn;

/* =====================================================================
   8. 로그인 · 실시간 수신 · 날짜 바뀜 감지
   ===================================================================== */
let unsubDays = null, unsubSettings = null, unsubHolidays = null, rangeKey = "";
function watchRange(startKey, endKey) {        // 보이는 기간이 바뀔 때만 다시 구독
  if (!user || rangeKey === startKey + endKey) return;
  rangeKey = startKey + endKey;
  if (unsubDays) unsubDays();
  unsubDays = Store.watchDays(startKey, endKey, incoming => {
    days = cleanDays(incoming);
    if (!editorOpen() && !(drag && drag.on)) render();   // 편집·드래그 중에는 화면을 덮어쓰지 않음
  });
}
function stopWatching() {
  [unsubDays, unsubSettings, unsubHolidays].forEach(f => f && f());
  unsubDays = unsubSettings = unsubHolidays = null; rangeKey = "";
}
async function doSignIn() {
  $("loginMsg").textContent = "로그인 중…";
  try { await Store.signIn(); }
  catch (err) {
    const msg = {
      "auth/popup-closed-by-user": "로그인 창이 닫혔어요. 다시 눌러주세요.",
      "auth/cancelled-popup-request": "로그인 창이 닫혔어요. 다시 눌러주세요.",
      "auth/unauthorized-domain": "이 주소가 Firebase 승인 도메인에 없어요. Firebase 콘솔 > Authentication > 설정 > 승인된 도메인에 추가해 주세요.",
      "auth/network-request-failed": "인터넷 연결을 확인해 주세요."
    }[err.code] || `로그인 실패 (${err.code || err.message})`;
    $("loginMsg").textContent = msg;
  }
}
function showLogin(show, msg) {
  $("loginBox").style.display = show ? "flex" : "none";
  $("loginMsg").textContent = msg || "";
}

if (Store.configError) {                        // 설정값이 잘못되면 여기서 멈춤
  showLogin(true, Store.configError);
  $("loginBtn").style.display = "none";
} else {
  Store.onSyncState(showSync);
  Store.onAuth(u => {
    user = u;
    stopWatching();
    days = {}; holidays = {}; lastSavedAt = null;
    if (!u) { settings = cleanSettings({}); applySettings(); }   // 로그아웃하면 이전 계정 설정 지움
    if (editorOpen()) closeEditor();
    $("accName").textContent = u ? (u.email || "로그인됨") : "로그인 안 됨";
    $("login").textContent = u ? "로그아웃" : "구글 로그인";
    $("login").disabled = false;
    $("syncNow").disabled = !u;
    showLogin(!u, "일정을 PC·폰에서 함께 보려면 구글 계정으로 로그인해 주세요.");
    if (u) {
      unsubSettings = Store.watchSettings(raw => { settings = cleanSettings(raw); applySettings(); });
      unsubHolidays = Store.watchHolidays(raw => { holidays = cleanHolidays(raw); if (!editorOpen()) render(); });
    }
    render();
    showSync();
  });
}

setInterval(() => {                           // 자정이 지나면 '오늘' 갱신
  const now = new Date();
  if (key(now) !== key(today)) {
    const wasThisMonth = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth();
    today = now;
    if (wasThisMonth) view = new Date(today.getFullYear(), today.getMonth(), 1);
    if (!editorOpen()) render();
  }
}, 60 * 1000);

applySettings();
render();

// 앱 설치·오프라인 실행 (인터넷 주소로 열었을 때만)
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
