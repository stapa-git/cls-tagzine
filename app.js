/* CLS TAG ZINE（非公式） — ハッシュタグ・ボード（CLS高知 向けプロトタイプ）
 * 外部ライブラリなし。X の公式埋め込み（oEmbed / widgets.js）だけを使います。
 * 投稿の日時は投稿ID（Snowflake）から計算するので、通信なしで期間の絞り込みができます。
 * 本文は「カードが画面に入ったとき」に順番に読み込みます（1,500件規模でも重くならないように）。
 */
(() => {
'use strict';

/* ==========================================================
 * イベント用の設定（ここを書き換えればタグ・期間ボタンを変えられます）
 * ========================================================== */
const PRESETS = {
  defaultTag: 'CLS高知',
  tags: ['CLS高知', 'きっかけはCLS', 'CLSごはん', 'CLS高知初参加'],
  // date：開催日、around：前後に含める日数（7 なら開催日の前後1週間）
  periods: [
    { label: 'on 東京（2026/10/3）', date: '2026-10-03', around: 7 },
    { label: '2026初鰹編（2026/5/16）', date: '2026-05-16', around: 7 }
  ]
};
// 開催日と前後の日数から、いつから〜いつまで を計算
function periodRange(p) {
  if (!p.date) return { from: p.from, to: p.to };
  const d = new Date(p.date + 'T00:00:00'), f = new Date(d), t = new Date(d);
  f.setDate(d.getDate() - (p.around || 0)); t.setDate(d.getDate() + (p.around || 0));
  const fmt = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { from: fmt(f), to: fmt(t) };
}
const SCREEN_SECONDS = 8; // スクリーンモードの切り替え間隔（秒）
const BOARD_CHUNK = 120;  // ボードに一度に並べる枚数

/* ---------- 小道具 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PALETTE = ['#1e73be', '#ff6a2b', '#ffd23f', '#ff5fa2', '#29d9a0', '#8be3ff', '#8a63ff', '#4aa8ff'];
const SPLASH = ['#1e73be', '#4aa8ff', '#8be3ff', '#ffffff', '#dfe8f2'];
const EPOCH = 1288834974657n;
const STORE_KEY = 'tagzine_v1';
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const colorOf = user => PALETTE[hash(String(user).toLowerCase()) % PALETTE.length];
const idToTime = id => { try { return Number((BigInt(id) >> 22n) + EPOCH); } catch { return 0; } };
const timeToId = ms => String((BigInt(Math.floor(ms)) - EPOCH) << 22n);
const fmtDate = ms => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const fmtDay = ms => { const d = new Date(ms); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`; };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* 鰹（オリジナルのイラスト） */
const KATSUO_SVG = `<svg viewBox="0 0 124 50" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M18 25 L3 6 Q10 25 3 44 Z" fill="#1b3a63" stroke="#0d2240" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M52 10 L60 1 L68 9 Z" fill="#1b3a63" stroke="#0d2240" stroke-width="2" stroke-linejoin="round"/>
  <path d="M16 25 C32 6 72 4 102 14 Q118 20 121 25 Q118 30 102 36 C72 46 32 44 16 25 Z" fill="#dfe8f2" stroke="#0d2240" stroke-width="2.5"/>
  <path d="M16 25 C32 6 72 4 102 14 Q118 20 121 25 C96 22 60 20 16 25 Z" fill="#1e3f6e"/>
  <path d="M40 30 Q70 33 100 28 M38 34 Q66 38 94 33 M46 38 Q68 41 88 37" stroke="#4d6b8c" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M80 27 L68 34 L82 31 Z" fill="#1b3a63"/>
  <path d="M28 30 l4 -3 M33 32 l4 -3" stroke="#0d2240" stroke-width="1.5"/>
  <circle cx="106" cy="21" r="3.6" fill="#fff" stroke="#0d2240" stroke-width="1.5"/><circle cx="106.8" cy="21" r="1.8" fill="#0d2240"/>
  <path d="M114 27 Q117 28 120 26" stroke="#0d2240" stroke-width="1.5" fill="none"/>
</svg>`;

/* ---------- 状態 ---------- */
const state = { tag: '', from: '', to: '', photoOnly: false, posts: {}, pins: [] };
let shuffleOrder = null;

function save() {
  try {
    // 本文は保存せず、URL・ピン・設定だけを保存（本文は開くたびに X から取得）
    const posts = Object.values(state.posts).map(p => p.demo
      ? { id: p.id, user: p.user, demo: true, name: p.name, text: p.text, photo: p.photo, status: 'ok' }
      : { id: p.id, user: p.user });
    localStorage.setItem(STORE_KEY, JSON.stringify({ tag: state.tag, from: state.from, to: state.to, photoOnly: state.photoOnly, pins: state.pins, posts }));
  } catch { /* 保存できない環境でも動く */ }
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    Object.assign(state, { tag: d.tag || '', from: d.from || '', to: d.to || '', photoOnly: !!d.photoOnly, pins: d.pins || [] });
    state.posts = {};
    (d.posts || []).forEach(p => addPost(p.user, p.id, p.demo ? p : null));
    return true;
  } catch { return false; }
}

/* ---------- 投稿の登録 ---------- */
const URL_RE = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/g;
function addPost(user, id, demo) {
  if (state.posts[id]) return false;
  const p = demo ? { ...demo } : { status: 'pending' };
  p.id = id; p.user = user; p.ts = idToTime(id);
  state.posts[id] = p;
  return true;
}
function addFromText(text) {
  let added = 0, dup = 0;
  for (const m of text.matchAll(URL_RE)) addPost(m[1], m[2]) ? added++ : dup++;
  return { added, dup };
}

/* ---------- oEmbed（JSONP）で本文を取得：必要になった分だけ ---------- */
let jsonpN = 0;
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = `__tz${++jsonpN}`;
    const s = document.createElement('script');
    const done = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
    const timer = setTimeout(() => { done(); reject(new Error('timeout')); }, 12000);
    window[cb] = d => { done(); resolve(d); };
    s.onerror = () => { done(); reject(new Error('network')); };
    s.src = `${url}&callback=${cb}`;
    document.head.appendChild(s);
  });
}
const queue = [];
let running = 0;
function need(p) {
  if (!p || p.status !== 'pending' || p.queued) return;
  p.queued = true; queue.push(p); pump();
}
function pump() {
  while (running < 4 && queue.length) {
    const p = queue.shift();
    if (!state.posts[p.id]) continue;
    running++;
    fetchEmbed(p).finally(() => { running--; pump(); refreshCard(p.id); scheduleRender(); });
  }
}
async function fetchEmbed(p) {
  const url = `https://publish.twitter.com/oembed?url=${encodeURIComponent(`https://twitter.com/${p.user}/status/${p.id}`)}&omit_script=1&dnt=true&lang=ja`;
  try {
    const d = await jsonp(url);
    const doc = new DOMParser().parseFromString(d.html || '', 'text/html');
    const para = doc.querySelector('blockquote p');
    let photo = false;
    if (para) {
      para.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      para.querySelectorAll('a').forEach(a => { if (/^pic\.(twitter|x)\.com/.test(a.textContent)) { photo = true; a.remove(); } });
    }
    p.text = (para ? para.textContent : '').trim();
    p.name = d.author_name || p.user;
    const m = (d.author_url || '').match(/\.com\/([A-Za-z0-9_]+)/);
    if (m) p.user = m[1];
    p.photo = photo;
    p.status = 'ok';
  } catch {
    p.status = 'err'; // 削除・非公開など。公式表示ボタンは残す
  }
}
// カードが画面に近づいたら本文を読み込む
const seenIO = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if (!en.isIntersecting) return;
    need(state.posts[en.target.dataset.id]);
    seenIO.unobserve(en.target);
  });
}, { rootMargin: '600px' });
function loadAll() {
  const list = visiblePosts().filter(p => p.status === 'pending');
  if (!list.length) { toast('本文はすべて読み込み済みです'); return; }
  list.forEach(need);
  toast(`${list.length} 件の本文を読み込みます`);
}
$('#loadAllBtn').onclick = loadAll;
$('#loadAllBtn2').onclick = loadAll;

/* ---------- 絞り込み ---------- */
function visiblePosts() {
  const from = state.from ? new Date(state.from + 'T00:00:00').getTime() : -Infinity;
  const to = state.to ? new Date(state.to + 'T23:59:59.999').getTime() : Infinity;
  const tag = state.tag.trim().replace(/^[#＃]/, '').toLowerCase();
  return Object.values(state.posts).filter(p => {
    if (p.ts < from || p.ts > to) return false;
    if (state.photoOnly && p.photo === false) return false;
    if (tag && p.text) {
      const t = p.text.toLowerCase();
      if (!t.includes('#' + tag) && !t.includes('＃' + tag)) return false;
    }
    return true;
  });
}

/* ---------- カード ---------- */
function decorate(text) {
  return esc(text)
    .replace(/(^|[\s　(（])([#＃][^\s#＃@、。,.!?！？「」()（）]+)/g, '$1<span class="ht">$2</span>')
    .replace(/(^|[^A-Za-z0-9_])(@[A-Za-z0-9_]{1,15})/g, '$1<span class="mt">$2</span>');
}
function cardHTML(p) {
  const name = p.name || '@' + p.user;
  const pinned = state.pins.includes(p.id);
  let body;
  if (p.status === 'pending') body = `<div class="body loading">…</div>`;
  else if (p.status === 'err') body = `<div class="body"><i>本文を読み込めませんでした（削除・非公開の可能性）。◎ で公式表示を試せます。</i></div>`;
  else body = `<div class="body">${decorate(p.text || '')}</div>`;
  const photo = p.photo ? `<div class="photo" data-act="embed"><span>写真あり — タップで表示</span></div>` : '';
  return `<div class="tape"></div>
    <div class="head"><div class="avatar">${esc((name.replace(/^@/, '')[0] || '?').toUpperCase())}</div>
      <div class="who"><b>${esc(name)}</b><span>@${esc(p.user)}</span></div></div>
    ${body}${photo}
    <div class="foot"><span class="date">${fmtDate(p.ts)}</span>
      <button class="icon pin ${pinned ? 'on' : ''}" data-act="pin" title="ピックアップ">★</button>
      <button class="icon" data-act="embed" title="公式表示（写真・動画つき）">◎</button>
      <a class="icon" href="${esc(p.demo ? '#' : `https://x.com/${p.user}/status/${p.id}`)}" target="_blank" rel="noopener" title="Xでひらく" ${p.demo ? 'data-act="demo"' : ''}>↗</a>
      <button class="icon" data-act="del" title="ボードから外す">×</button></div>`;
}
function makeCard(p, i = 0) {
  const el = document.createElement('article');
  el.className = 'card' + (p.demo ? ' demo' : '');
  el.dataset.id = p.id;
  el.style.setProperty('--c', colorOf(p.user));
  el.style.setProperty('--rot', `${((hash(p.id) % 9) - 4) * 0.7}deg`);
  el.style.setProperty('--d', `${Math.min(i, 24) * 0.04}s`);
  el.innerHTML = cardHTML(p);
  if (p.status === 'pending') seenIO.observe(el);
  return el;
}
function refreshCard(id) {
  const p = state.posts[id];
  if (!p) return;
  $$(`.card[data-id="${id}"]`).forEach(el => { el.innerHTML = cardHTML(p); el.style.setProperty('--c', colorOf(p.user)); });
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.card');
  const id = card?.dataset.id;
  const act = btn.dataset.act;
  if (act === 'demo') { e.preventDefault(); toast('デモの投稿は X にはありません'); return; }
  if (!id) return;
  if (act === 'pin') togglePin(id, btn);
  if (act === 'embed') openEmbed(id);
  if (act === 'del') {
    $$(`.card[data-id="${id}"]`).forEach(el => el.classList.add('gone'));
    setTimeout(() => { delete state.posts[id]; state.pins = state.pins.filter(x => x !== id); save(); render(); }, 330);
  }
});
function togglePin(id, btn) {
  if (state.pins.includes(id)) { state.pins = state.pins.filter(x => x !== id); toast('ピックアップから外しました'); }
  else {
    state.pins.push(id); toast('★ ピックアップしました！');
    const r = btn.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2, 40);
  }
  save();
  $$(`.card[data-id="${id}"] .pin`).forEach(b => b.classList.toggle('on', state.pins.includes(id)));
  $('#pinCount').textContent = state.pins.filter(x => state.posts[x]).length;
  if (current === 'pick') renderPickGrid();
}

/* ---------- 公式表示（写真・動画） ---------- */
let widgetsPromise = null;
function loadWidgets() {
  if (window.twttr?.widgets) return Promise.resolve(window.twttr);
  widgetsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://platform.twitter.com/widgets.js';
    s.async = true;
    s.onload = () => (window.twttr?.ready ? window.twttr.ready(resolve) : resolve(window.twttr));
    s.onerror = () => { widgetsPromise = null; reject(new Error('widgets')); };
    document.head.appendChild(s);
  });
  return widgetsPromise;
}
async function embedInto(holder, p) {
  const tw = await loadWidgets();
  return tw.widgets.createTweet(p.id, holder, { lang: 'ja', dnt: true, align: 'center' });
}
let embedToken = 0;
async function openEmbed(id) {
  const p = state.posts[id];
  const body = $('#modalBody');
  $('#modal').hidden = false;
  if (p.demo) {
    body.innerHTML = '';
    const c = makeCard(p); c.style.setProperty('--rot', '0deg'); body.appendChild(c);
    body.insertAdjacentHTML('beforeend', '<p class="embed-note">デモの投稿なので、ここでは本物の埋め込みのかわりにカードを表示しています。</p>');
    return;
  }
  // 埋め込みは「画面に置いた箱」の中で作らないと中身が描画されないので、先に箱を置く
  const token = ++embedToken;
  body.innerHTML = '';
  const loading = Object.assign(document.createElement('div'), { className: 'body loading' });
  loading.style.height = '200px';
  const holder = document.createElement('div');
  body.append(loading, holder);
  try {
    const el = await embedInto(holder, p);
    if (token !== embedToken) return; // 別の投稿を開き直した・閉じた
    loading.remove();
    if (!el) holder.innerHTML = '<p>この投稿は表示できませんでした（削除・非公開の可能性）。</p>';
    body.insertAdjacentHTML('beforeend', `<p class="embed-note">X の公式埋め込みで表示しています。<a href="https://x.com/${esc(p.user)}/status/${esc(id)}" target="_blank" rel="noopener">X でひらく ↗</a></p>`);
  } catch {
    if (token !== embedToken) return;
    body.innerHTML = `<p>X の埋め込みを読み込めませんでした。広告ブロッカーなどで止められている可能性があります。</p><p><a href="https://x.com/${esc(p.user)}/status/${esc(id)}" target="_blank" rel="noopener">X でひらく ↗</a></p>`;
  }
}
$('#modalClose').onclick = () => { embedToken++; $('#modal').hidden = true; $('#modalBody').innerHTML = ''; };
$$('.modal').forEach(m => m.addEventListener('click', e => {
  if (e.target === m || e.target.dataset.close) { m.hidden = true; if (m.id === 'modal') { embedToken++; $('#modalBody').innerHTML = ''; } }
}));

/* ---------- 描画 ---------- */
let current = 'board';
let renderTimer = 0;
function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderLight, 250); }
function renderLight() {
  updateStat();
  // 本文の読み込み後にハッシュタグ不一致などが分かったカードは隠す
  const vis = new Set(visiblePosts().map(p => p.id));
  $$('#board .card, #timeline .tl-item').forEach(el => {
    const id = el.dataset.id || el.querySelector('.card')?.dataset.id;
    el.style.display = vis.has(id) ? '' : 'none';
  });
  if (current === 'graph') buildGraph();
}
function render() {
  updateStat();
  syncFishing();
  if (current === 'board') renderBoard();
  if (current === 'pick') renderPickGrid();
  if (current === 'time') renderTime();
  if (current === 'graph') buildGraph(true);
}
function updateStat() {
  const vis = visiblePosts();
  const all = Object.keys(state.posts).length;
  const pending = vis.filter(p => p.status === 'pending').length;
  const busy = running + queue.length;
  $('#stat').textContent = `表示 ${vis.length} / 登録 ${all} 件${busy ? ` ・本文読み込み中 残り${busy}` : ''}`;
  $('#loadAllBtn').hidden = !pending;
  $('#pinCount').textContent = state.pins.filter(x => state.posts[x]).length;
  $('#emptyBoard').style.display = all ? 'none' : '';
  const t = state.tag ? `#${state.tag}` : 'CLS TAG ZINE（非公式）';
  const range = state.from || state.to ? `${state.from || '…'} → ${state.to || '…'}` : 'いつでも';
  const unit = `<b>●</b>${esc(t)}<b>◆</b>${esc(range)}<b>★</b>${vis.length} POSTS<b>◎</b>つながりを、ならべて眺めよう`;
  $('#ticker').innerHTML = unit.repeat(6);
  $$('#tagChips .chip').forEach(c => c.classList.toggle('on', c.dataset.tag === state.tag));
  $$('#periodChips .chip').forEach(c => c.classList.toggle('on', c.dataset.from === state.from && c.dataset.to === state.to));
}
function sortedVisible() {
  const q = $('#search').value.trim().toLowerCase();
  let list = visiblePosts().filter(p => !q || [p.text, p.name, '@' + p.user].join(' ').toLowerCase().includes(q));
  const mode = $('#sortSel').value;
  if (shuffleOrder) list.sort((a, b) => (shuffleOrder[a.id] ?? 0) - (shuffleOrder[b.id] ?? 0));
  else if (mode === 'old') list.sort((a, b) => a.ts - b.ts);
  else if (mode === 'author') list.sort((a, b) => a.user.localeCompare(b.user) || a.ts - b.ts);
  else list.sort((a, b) => b.ts - a.ts);
  return list;
}

/* ボード：少しずつ並べる */
let boardList = [], boardShown = 0;
function renderBoard() {
  $('#board').innerHTML = '';
  boardList = sortedVisible(); boardShown = 0;
  moreBoard();
}
function moreBoard() {
  const frag = document.createDocumentFragment();
  boardList.slice(boardShown, boardShown + BOARD_CHUNK).forEach((p, i) => frag.appendChild(makeCard(p, i)));
  boardShown += BOARD_CHUNK;
  $('#board').appendChild(frag);
}
new IntersectionObserver(es => {
  if (es[0].isIntersecting && current === 'board' && boardShown < boardList.length) moreBoard();
}, { rootMargin: '900px' }).observe($('#sentinel'));

/* ---------- ピックアップ・一本釣り ---------- */
function renderPickGrid() {
  const grid = $('#pickGrid');
  grid.innerHTML = '';
  const pins = state.pins.map(id => state.posts[id]).filter(Boolean);
  if (!pins.length) grid.innerHTML = '<div class="empty"><div class="empty-sticker">★を押して<br>集めよう</div></div>';
  pins.forEach((p, i) => grid.appendChild(makeCard(p, i)));
}
let fishingBusy = false, fishToken = 0;
// 釣り場を最初の状態に戻す（全部消す・削除・デモ読み込みなどのとき）
// 釣り上げたカードが長いときは、釣り場の高さをカードに合わせてのばす（★などのボタンが隠れないように）
function fitFishing() {
  const f = $('#fishing'), c = $('#catch .card'), line = $('#rodLine');
  if (!c) { f.style.height = ''; return; }
  const base = matchMedia('(max-width:700px)').matches ? 480 : 440; // style.css の .fishing の高さ
  const h = Math.max(base, c.offsetHeight + 56);
  f.style.height = h + 'px';
  if (!fishingBusy) { // 糸の先をカードの上端にそろえる
    line.getAnimations().forEach(a => a.cancel());
    line.style.height = Math.max(10, (h - c.offsetHeight) / 2 + 4) + 'px';
  }
}
const fishRO = new ResizeObserver(() => fitFishing());
function resetFishing() {
  fishToken++; fishingBusy = false;
  fishRO.disconnect();
  $('#fishing').style.height = ''; $('#rodLine').style.height = '';
  $('#catch').innerHTML = '<p class="idle">糸を垂らして、1枚 釣り上げよう</p>';
  $('#under').innerHTML = '';
  $('#rodLine').getAnimations().forEach(a => a.cancel());
}
// 釣り上げたカードの投稿が消えていたら釣り場を片付ける
function syncFishing() {
  const shown = [...$$('#catch .card, #under .card')];
  if (shown.some(el => !state.posts[el.dataset.id])) resetFishing();
}
$('#lotteryBtn').onclick = () => fishOnce().catch(() => {}); // 途中で片付けられたときのアニメ中断は無視
async function fishOnce() {
  const list = visiblePosts();
  if (!list.length) { toast('表示中の投稿がありません'); return; }
  if (fishingBusy) return;
  fishingBusy = true;
  const my = ++fishToken;
  const alive = () => my === fishToken; // 途中で「全部消す」などされたら中止
  const fishing = $('#fishing'), line = $('#rodLine'), catchEl = $('#catch'), under = $('#under');
  const pick = () => list[Math.floor(Math.random() * list.length)];
  const chosen = pick();
  need(chosen);
  fishRO.disconnect(); fishing.style.height = '';
  catchEl.innerHTML = ''; under.innerHTML = '';
  // 糸を垂らす
  await line.animate([{ height: '0px' }, { height: `${fishing.clientHeight * 0.8}px` }], { duration: reduced() ? 1 : 700, easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'forwards' }).finished;
  if (!alive()) return;
  // 水の中で魚（カード）が寄ってくる
  const rounds = reduced() ? 1 : 14;
  for (let n = 0; n < rounds; n++) {
    const p = n === rounds - 1 ? chosen : pick();
    under.innerHTML = '';
    const c = makeCard(p);
    c.style.setProperty('--rot', `${(Math.random() - .5) * 20}deg`);
    under.appendChild(c);
    const dir = n % 2 ? 1 : -1;
    c.animate([{ transform: `translateX(${dir * 90}px) rotate(${dir * 8}deg)`, opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 160, easing: 'ease-out' });
    await sleep(60 + n * 14);
    if (!alive()) return;
  }
  // ぐいっと引く
  await line.animate([{ height: `${fishing.clientHeight * 0.8}px` }, { height: `${fishing.clientHeight * 0.86}px` }, { height: `${fishing.clientHeight * 0.8}px` }], { duration: 320, fill: 'forwards' }).finished;
  if (!alive() || !state.posts[chosen.id]) { resetFishing(); return; }
  under.innerHTML = '';
  const c = makeCard(chosen);
  c.style.setProperty('--rot', '0deg');
  catchEl.appendChild(c);
  fitFishing();
  const top = Math.max(10, (parseFloat(fishing.style.height) - c.offsetHeight) / 2 + 4);
  line.animate([{ height: `${fishing.clientHeight * 0.8}px` }, { height: `${top}px` }], { duration: reduced() ? 1 : 800, easing: 'cubic-bezier(.5,0,.3,1.3)', fill: 'forwards' });
  await c.animate([
    { transform: 'translateY(240px) rotate(16deg) scale(.6)', opacity: .5 },
    { transform: 'translateY(-36px) rotate(-6deg) scale(1.06)', opacity: 1, offset: .7 },
    { transform: 'translateY(0) rotate(0) scale(1)' }
  ], { duration: reduced() ? 1 : 900, easing: 'ease-out' }).finished;
  if (!alive()) return;
  const r = fishing.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + r.height * 0.34, 90, 'splash');
  confetti(r.left + r.width / 2, r.top + top, 70);
  toast('釣れた！ ★ でピックアップに追加できます');
  fishingBusy = false;
  fishRO.observe(c); // 本文があとから読み込まれて長くなっても追従
  fitFishing();
}

/* ---------- タイムライン ---------- */
let playing = null;
function renderTime() {
  stopPlay();
  const list = visiblePosts().sort((a, b) => a.ts - b.ts);
  const histo = $('#histo'), tl = $('#timeline');
  histo.innerHTML = ''; tl.innerHTML = '';
  if (!list.length) { tl.innerHTML = '<div class="empty"><div class="empty-sticker">投稿が<br>ありません</div></div>'; histo.style.display = 'none'; return; }
  histo.style.display = '';
  const dayKey = ms => ymd(new Date(ms));
  const counts = {};
  list.forEach(p => { const k = dayKey(p.ts); counts[k] = (counts[k] || 0) + 1; });
  const start = new Date(list[0].ts); start.setHours(0, 0, 0, 0);
  const end = new Date(list.at(-1).ts);
  const days = [];
  for (let d = new Date(start); d <= end && days.length < 400; d.setDate(d.getDate() + 1)) days.push(ymd(d));
  const max = Math.max(...Object.values(counts));
  days.forEach((k, i) => {
    const n = counts[k] || 0;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = n ? `${12 + (n / max) * 78}%` : '3%';
    bar.style.setProperty('--c', n ? PALETTE[i % PALETTE.length] : '#dde6f0');
    bar.style.setProperty('--d', `${Math.min(i, 40) * 0.025}s`);
    bar.title = `${k}：${n}件`;
    const [, m, dd] = k.split('-');
    bar.innerHTML = `${n ? `<b>${n}</b>` : ''}${(i % Math.ceil(days.length / 14) === 0) ? `<i>${+m}/${+dd}</i>` : ''}`;
    bar.onclick = () => document.getElementById('day-' + k)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    histo.appendChild(bar);
  });
  let last = '', side = 0;
  const frag = document.createDocumentFragment();
  list.forEach((p, i) => {
    const k = dayKey(p.ts);
    if (k !== last) {
      last = k;
      const day = document.createElement('div');
      day.className = 'day'; day.id = 'day-' + k;
      day.innerHTML = `<span>${fmtDay(p.ts)}</span>`;
      frag.appendChild(day);
    }
    const item = document.createElement('div');
    item.className = `tl-item ${side++ % 2 ? 'r' : 'l'}`;
    item.style.setProperty('--c', colorOf(p.user));
    item.innerHTML = `<div class="tl-time">${pad(new Date(p.ts).getHours())}:${pad(new Date(p.ts).getMinutes())}</div>`;
    item.appendChild(makeCard(p, i));
    frag.appendChild(item);
  });
  tl.appendChild(frag);
}
function stopPlay() {
  if (!playing) return;
  clearTimeout(playing); playing = null;
  $$('.tl-item.hide').forEach(x => x.classList.remove('hide'));
  $('#playBtn').textContent = '▶ 時系列で再生';
}
$('#playBtn').onclick = () => {
  if (playing) { stopPlay(); return; }
  const items = $$('.tl-item').filter(x => x.style.display !== 'none');
  if (!items.length) return;
  items.forEach(x => x.classList.add('hide'));
  $('#playBtn').textContent = '■ 止める';
  let i = 0;
  const step = () => {
    const it = items[i];
    it.classList.remove('hide');
    it.classList.add('flash');
    it.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => it.classList.remove('flash'), 800);
    if (++i < items.length) playing = setTimeout(step, 900);
    else { playing = null; $('#playBtn').textContent = '▶ もう一度再生'; confetti(innerWidth / 2, innerHeight / 3, 120); }
  };
  playing = setTimeout(step, 200);
};

/* ---------- つながり（メンション図） ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
let graph = { nodes: [], edges: [], raf: 0, key: '' };
function buildGraph(force = false) {
  const vis = visiblePosts();
  const list = vis.filter(p => p.status !== 'pending');
  const nodeMap = new Map(), edgeMap = new Map();
  const node = u => {
    const k = u.toLowerCase();
    if (!nodeMap.has(k)) nodeMap.set(k, { id: k, user: u, name: '', posts: 0, inDeg: 0, outDeg: 0 });
    return nodeMap.get(k);
  };
  list.forEach(p => {
    const a = node(p.user); a.posts++; if (p.name) a.name = p.name;
    const ms = new Set([...(p.text || '').matchAll(/(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{1,15})/g)].map(m => m[1].toLowerCase()));
    ms.forEach(m => {
      if (m === a.id) return;
      const b = node(m);
      a.outDeg++; b.inDeg++;
      const k = a.id + '>' + b.id;
      edgeMap.set(k, { s: a.id, t: b.id, w: (edgeMap.get(k)?.w || 0) + 1 });
    });
  });
  const info = nodes => nodes.length
    ? `${nodes.filter(n => n.posts).length} 人が投稿 ／ メンション ${edgeMap.size} 本 ／ 本文読み込み済み ${list.length} / ${vis.length} 件から描画（点線の丸は、投稿はないけど言及された人）`
    : (vis.length ? '本文を読み込むと描けます。「本文を全部読み込む」を押してください' : '表示中の投稿がありません');
  const key = [...nodeMap.keys()].join() + '|' + [...edgeMap.keys()].join();
  if (!force && key === graph.key) { $('#graphInfo').textContent = info(graph.nodes); return; }
  graph.key = key;
  const svg = $('#graph');
  const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
  const old = new Map(graph.nodes.map(n => [n.id, n]));
  const nodes = [...nodeMap.values()].map((n, i) => {
    const o = !force && old.get(n.id);
    const a = i * 2.39996;
    return Object.assign(n, {
      x: o ? o.x : W / 2 + Math.cos(a) * (40 + i * 6), y: o ? o.y : H / 2 + Math.sin(a) * (40 + i * 6),
      vx: 0, vy: 0, r: 16 + Math.sqrt(n.posts) * 7 + Math.sqrt(n.inDeg) * 4
    });
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = [...edgeMap.values()].map(e => ({ ...e, a: byId.get(e.s), b: byId.get(e.t) }));
  graph.nodes = nodes; graph.edges = edges;

  svg.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#0d2240" opacity=".6"/></marker></defs>`;
  const gE = document.createElementNS(SVGNS, 'g'), gN = document.createElementNS(SVGNS, 'g');
  svg.append(gE, gN);
  edges.forEach(e => {
    e.el = document.createElementNS(SVGNS, 'path');
    e.el.setAttribute('class', 'edge');
    e.el.setAttribute('stroke-width', String(2 + Math.min(e.w, 5)));
    e.el.setAttribute('marker-end', 'url(#arrow)');
    gE.appendChild(e.el);
  });
  nodes.forEach((n, i) => {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'node');
    const label = n.name || '@' + n.user;
    g.innerHTML = `<circle r="${n.r}" fill="${n.posts ? colorOf(n.user) : '#fff'}" ${n.posts ? '' : 'stroke-dasharray="5 4"'}></circle>
      <text class="ini" text-anchor="middle" dy=".35em">${esc((label.replace(/^@/, '')[0] || '?').toUpperCase())}</text>
      <text text-anchor="middle" dy="${n.r + 16}">${esc(label.length > 14 ? label.slice(0, 13) + '…' : label)}</text>`;
    g.animate([{ transform: `translate(${n.x}px,${n.y}px) scale(0)` }, { transform: `translate(${n.x}px,${n.y}px) scale(1)` }],
      { duration: 500, delay: Math.min(i, 30) * 25, easing: 'cubic-bezier(.2,1.6,.4,1)' });
    n.el = g;
    gN.appendChild(g);
    dragify(n);
  });
  $('#graphInfo').textContent = info(nodes);
  heat = 1;
  cancelAnimationFrame(graph.raf);
  graph.raf = requestAnimationFrame(simulate);
}
let heat = 1, dragging = null;
function simulate() {
  const { nodes, edges } = graph;
  const svg = $('#graph');
  const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2), min = a.r + b.r + 30;
      const f = (9000 / d2) + (d < min ? (min - d) * 0.08 : 0);
      dx /= d; dy /= d;
      a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
    }
    a.vx += (W / 2 - a.x) * 0.004; a.vy += (H / 2 - a.y) * 0.004;
  }
  edges.forEach(e => {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1;
    const f = (d - (e.a.r + e.b.r + 110)) * 0.01;
    e.a.vx += dx / d * f; e.a.vy += dy / d * f; e.b.vx -= dx / d * f; e.b.vy -= dy / d * f;
  });
  nodes.forEach(n => {
    if (n === dragging) { n.vx = n.vy = 0; } else {
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx * heat; n.y += n.vy * heat;
    }
    n.x = Math.max(n.r, Math.min(W - n.r, n.x)); n.y = Math.max(n.r, Math.min(H - n.r - 18, n.y));
    n.el.setAttribute('transform', `translate(${n.x},${n.y})`);
  });
  edges.forEach(e => {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1;
    const x1 = e.a.x + dx / d * e.a.r, y1 = e.a.y + dy / d * e.a.r;
    const x2 = e.b.x - dx / d * (e.b.r + 4), y2 = e.b.y - dy / d * (e.b.r + 4);
    const mx = (x1 + x2) / 2 - dy / d * 18, my = (y1 + y2) / 2 + dx / d * 18;
    e.el.setAttribute('d', `M${x1},${y1} Q${mx},${my} ${x2},${y2}`);
  });
  heat = Math.max(0.02, heat * 0.995);
  if (current === 'graph') graph.raf = requestAnimationFrame(simulate);
}
function dragify(n) {
  const svg = $('#graph');
  const pt = e => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let moved = false;
  n.el.addEventListener('pointerdown', e => { dragging = n; moved = false; heat = Math.max(heat, 0.5); n.el.setPointerCapture(e.pointerId); });
  n.el.addEventListener('pointermove', e => { if (dragging !== n) return; [n.x, n.y] = pt(e); moved = true; heat = Math.max(heat, 0.5); });
  n.el.addEventListener('pointerup', () => {
    dragging = null;
    if (!moved && n.posts) {
      $('#search').value = '@' + n.user; shuffleOrder = null; switchView('board');
      toast(`@${n.user} の投稿にしぼりました`);
    }
  });
  n.el.addEventListener('pointerenter', () => {
    const near = new Set([n.id]);
    graph.edges.forEach(e => { if (e.s === n.id || e.t === n.id) { near.add(e.s); near.add(e.t); } });
    graph.nodes.forEach(m => m.el.classList.toggle('dim', !near.has(m.id)));
    graph.edges.forEach(e => { const on = e.s === n.id || e.t === n.id; e.el.classList.toggle('hl', on); e.el.classList.toggle('dim', !on); });
    $('#graphInfo').textContent = `${n.name || '@' + n.user}：投稿 ${n.posts} 件 ／ ${n.outDeg} 回メンションした ／ ${n.inDeg} 回メンションされた${n.posts ? '（クリックで投稿を表示）' : ''}`;
  });
  n.el.addEventListener('pointerleave', () => {
    graph.nodes.forEach(m => m.el.classList.remove('dim'));
    graph.edges.forEach(e => e.el.classList.remove('hl', 'dim'));
  });
}
$('#regraphBtn').onclick = () => buildGraph(true);

/* ---------- タブ ---------- */
function switchView(v) {
  current = v;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'view-' + v));
  if (v !== 'time') stopPlay();
  cancelAnimationFrame(graph.raf);
  render();
}
$$('#tabs button').forEach(b => b.onclick = () => switchView(b.dataset.view));

/* ---------- 入力・プリセット ---------- */
function readInputs() {
  state.tag = $('#tag').value.trim().replace(/^[#＃]/, '');
  state.from = $('#from').value; state.to = $('#to').value;
  state.photoOnly = $('#photoOnly').checked;
  save(); render();
}
function writeInputs() {
  $('#tag').value = state.tag; $('#from').value = state.from; $('#to').value = state.to; $('#photoOnly').checked = state.photoOnly;
}
['#tag', '#from', '#to', '#photoOnly'].forEach(s => $(s).addEventListener('change', readInputs));
function buildChips() {
  $('#tagChips').innerHTML = PRESETS.tags.map(t => `<button class="chip" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');
  const today = new Date(), week = new Date(); week.setDate(week.getDate() - 6);
  const periods = [...PRESETS.periods.map(p => ({ label: p.label, ...periodRange(p) })), { label: '今日', from: ymd(today), to: ymd(today) }, { label: '直近7日', from: ymd(week), to: ymd(today) }];
  $('#periodChips').innerHTML = periods.map(p => `<button class="chip" data-from="${p.from}" data-to="${p.to}" title="${p.from} 〜 ${p.to}">${esc(p.label)}</button>`).join('');
  $$('#tagChips .chip').forEach(c => c.onclick = () => { $('#tag').value = c.dataset.tag; readInputs(); bounce(c); });
  $$('#periodChips .chip').forEach(c => c.onclick = () => { $('#from').value = c.dataset.from; $('#to').value = c.dataset.to; readInputs(); bounce(c); });
}
const bounce = el => el.animate([{ transform: 'scale(1.25) rotate(-6deg)' }, { transform: 'scale(1)' }], { duration: 400, easing: 'cubic-bezier(.2,1.6,.4,1)' });

$('#search').addEventListener('input', () => { shuffleOrder = null; renderBoard(); });
$('#sortSel').addEventListener('change', () => { shuffleOrder = null; renderBoard(); });
$('#shuffleBtn').onclick = () => { shuffleOrder = {}; Object.keys(state.posts).forEach(id => { shuffleOrder[id] = Math.random(); }); renderBoard(); };

/* ロゴを押すと、文字がはねて鰹が飛び越える */
function logoJump() {
  const l = $('#logo');
  l.classList.remove('jump'); void l.offsetWidth; l.classList.add('jump');
  if (reduced()) return;
  const r = l.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'leaper'; f.innerHTML = KATSUO_SVG;
  document.body.appendChild(f);
  const x0 = r.left - 140, x1 = r.right + 20, y0 = r.bottom - 10, top = r.top - 110;
  f.animate([
    { transform: `translate(${x0}px,${y0}px) rotate(-35deg)` },
    { transform: `translate(${(x0 + x1) / 2}px,${top}px) rotate(0deg)`, offset: .5 },
    { transform: `translate(${x1}px,${y0}px) rotate(35deg)` }
  ], { duration: 1100, easing: 'linear' }).finished.then(() => { f.remove(); confetti(x1 + 60, y0, 70, 'splash'); });
  setTimeout(() => confetti(r.left + r.width / 2, r.top, 50), 450);
}
$('#logo').onclick = logoJump;
$('#logo').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); logoJump(); } };

$('#openSearch').onclick = () => {
  readInputs();
  if (!state.tag) { toast('先にハッシュタグを入れてね'); $('#tag').focus(); return; }
  const q = [`#${state.tag}`];
  if (state.from) q.push(`since:${state.from}`);
  if (state.to) { const d = new Date(state.to + 'T00:00:00'); d.setDate(d.getDate() + 1); q.push(`until:${ymd(d)}`); } // until は前日まで扱いなので +1日
  q.push('-filter:retweets');
  if (state.photoOnly) q.push('filter:images');
  window.open(`https://x.com/search?q=${encodeURIComponent(q.join(' '))}&src=typed_query&f=live`, '_blank', 'noopener');
};
$('#toggleAdd').onclick = () => { const a = $('#adder'); a.hidden = !a.hidden; if (!a.hidden) $('#urls').focus(); };
$('#addBtn').onclick = () => {
  const { added, dup } = addFromText($('#urls').value);
  $('#addMsg').textContent = added || dup ? `${added} 件追加${dup ? `（${dup} 件は登録済み）` : ''}` : '投稿URLが見つかりませんでした';
  if (added) {
    $('#urls').value = ''; save(); render(); toast(`${added} 枚のカードを貼りました！`);
    const r = $('#addBtn').getBoundingClientRect(); confetti(r.left + r.width / 2, r.top, 60);
  }
};
document.addEventListener('paste', e => {
  if (e.target.closest('input, textarea') || !$('#screen').hidden) return;
  const { added } = addFromText(e.clipboardData?.getData('text') || '');
  if (added) { save(); render(); toast(`${added} 枚のカードを貼りました！`); }
});
$('#openHelp').onclick = () => { $('#help').hidden = false; };

let clearArmed = 0;
$('#clearBtn').onclick = () => {
  const b = $('#clearBtn');
  if (!clearArmed) { clearArmed = setTimeout(() => { clearArmed = 0; b.textContent = '全部消す'; }, 3000); b.textContent = 'もう一度押すと消去'; return; }
  clearTimeout(clearArmed); clearArmed = 0; b.textContent = '全部消す';
  state.posts = {}; state.pins = []; queue.length = 0; resetFishing(); save(); render(); toast('まっさらにしました');
};

/* ---------- 書き出し・読み込み・共有 ---------- */
function snapshot() {
  return {
    app: 'tagzine', version: 1, tag: state.tag, from: state.from, to: state.to, photoOnly: state.photoOnly,
    posts: Object.values(state.posts).filter(p => !p.demo).map(p => `https://x.com/${p.user}/status/${p.id}`),
    pins: state.pins.filter(id => state.posts[id] && !state.posts[id].demo)
  };
}
function applySnapshot(d) {
  if (!d || d.app !== 'tagzine') throw new Error('format');
  Object.assign(state, { tag: d.tag || '', from: d.from || '', to: d.to || '', photoOnly: !!d.photoOnly });
  addFromText((d.posts || []).join('\n'));
  state.pins = [...new Set([...state.pins, ...(d.pins || [])])];
  writeInputs(); save(); render();
}
$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `cls-tagzine-${state.tag || 'board'}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('URLとピックアップを書き出しました');
};
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { applySnapshot(JSON.parse(await f.text())); toast('読み込みました！'); } catch { toast('このファイルは読み込めませんでした'); }
  e.target.value = '';
};
const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
$('#shareBtn').onclick = async () => {
  const s = snapshot();
  const compact = { t: s.tag, f: s.from, e: s.to, i: s.photoOnly ? 1 : 0, p: s.posts.map(u => u.replace('https://x.com/', '').replace('/status/', '/')), k: s.pins };
  const url = `${location.origin}${location.pathname}#b=${b64e(JSON.stringify(compact))}`;
  try { await navigator.clipboard.writeText(url); toast('共有リンクをコピーしました'); }
  catch { prompt('このリンクをコピーしてください', url); }
};
function loadFromHash() {
  const m = location.hash.match(/#b=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try {
    const c = JSON.parse(b64d(m[1]));
    state.posts = {}; state.pins = [];
    applySnapshot({ app: 'tagzine', tag: c.t, from: c.f, to: c.e, photoOnly: !!c.i, posts: (c.p || []).map(x => `https://x.com/${x.replace('/', '/status/')}`), pins: c.k });
    history.replaceState(null, '', location.pathname);
    toast('共有されたボードをひらきました');
    return true;
  } catch { return false; }
}

/* ---------- スクリーンモード（会場のプロジェクター用） ---------- */
const scr = { list: [], i: 0, timer: 0, paused: false, bar: null };
function screenList() {
  const src = $('#screenSrc').value;
  const vis = visiblePosts();
  if (src === 'pins') {
    const pins = state.pins.map(id => state.posts[id]).filter(p => p && vis.includes(p));
    if (pins.length) return pins;
    $('#screenSrc').value = 'all';
    toast('ピックアップが無いので、表示中すべてを流します');
  }
  if (src === 'new') return vis.sort((a, b) => b.ts - a.ts);
  if (src === 'random') return vis.sort(() => Math.random() - .5);
  return vis.sort((a, b) => a.ts - b.ts);
}
function openScreen() {
  scr.list = screenList();
  if (!scr.list.length) { toast('表示中の投稿がありません'); return; }
  $('#screen').hidden = false;
  $('#screenTag').textContent = state.tag ? `#${state.tag}` : 'CLS TAG ZINE';
  $('#screenFish').innerHTML = KATSUO_SVG;
  $('#screenStage').innerHTML = '';
  document.documentElement.requestFullscreen?.().catch(() => {});
  scr.paused = false; $('#sPlay').textContent = '❚❚';
  showSlide(0, 1);
}
function closeScreen() {
  clearTimeout(scr.timer); scr.bar?.cancel();
  $('#screen').hidden = true; $('#screenStage').innerHTML = '';
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
function showSlide(i, dir) {
  const n = scr.list.length;
  scr.i = ((i % n) + n) % n;
  const p = scr.list[scr.i];
  [0, 1, 2].forEach(k => need(scr.list[(scr.i + k) % n]));
  const stage = $('#screenStage');
  const old = stage.querySelector('.slide:not(.out)');
  if (old) {
    old.classList.add('out');
    old.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * 110}%) rotate(${-dir * 12}deg)`, opacity: 0 }], { duration: 600, easing: 'cubic-bezier(.5,0,.7,.4)', fill: 'forwards' })
      .finished.then(() => old.remove());
  }
  const slide = document.createElement('div');
  slide.className = 'slide';
  if ($('#screenEmbed').checked && !p.demo) {
    const box = document.createElement('div');
    box.className = 'embed-slide';
    slide.appendChild(box);
  } else {
    slide.appendChild(makeCard(p));
  }
  stage.appendChild(slide);
  // 埋め込みは画面に置いてから作る
  const box = slide.querySelector('.embed-slide');
  if (box) embedInto(box, p).catch(() => { box.appendChild(makeCard(p)); });
  slide.animate([
    { transform: `translateX(${dir * 110}%) rotate(${dir * 14}deg)`, opacity: 0 },
    { transform: `translateX(${-dir * 3}%) rotate(${-dir * 2}deg)`, opacity: 1, offset: .75 },
    { transform: 'none' }
  ], { duration: 800, easing: 'cubic-bezier(.2,.9,.3,1)' });
  $('#screenCount').textContent = `${scr.i + 1} / ${n}`;
  scheduleNext();
}
function scheduleNext() {
  clearTimeout(scr.timer); scr.bar?.cancel();
  if (scr.paused) return;
  scr.bar = $('#screenBar').animate([{ width: '0%' }, { width: '100%' }], { duration: SCREEN_SECONDS * 1000, fill: 'forwards' });
  scr.timer = setTimeout(() => showSlide(scr.i + 1, 1), SCREEN_SECONDS * 1000);
}
function togglePause() {
  scr.paused = !scr.paused;
  $('#sPlay').textContent = scr.paused ? '▶' : '❚❚';
  if (scr.paused) { clearTimeout(scr.timer); scr.bar?.pause(); } else scheduleNext();
}
$('#screenBtn').onclick = openScreen;
$('#sClose').onclick = closeScreen;
$('#sNext').onclick = () => showSlide(scr.i + 1, 1);
$('#sPrev').onclick = () => showSlide(scr.i - 1, -1);
$('#sPlay').onclick = togglePause;
$('#screenSrc').onchange = () => { scr.list = screenList(); if (scr.list.length) showSlide(0, 1); };
$('#screenEmbed').onchange = () => showSlide(scr.i, 1);
document.addEventListener('keydown', e => {
  if (!$('#screen').hidden) {
    if (e.key === 'ArrowRight') showSlide(scr.i + 1, 1);
    else if (e.key === 'ArrowLeft') showSlide(scr.i - 1, -1);
    else if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 'Escape') closeScreen();
    return;
  }
  if (e.key === 'Escape') $$('.modal').forEach(m => { m.hidden = true; });
});

/* ---------- デモ（架空データ） ---------- */
function loadDemo() {
  const tag = 'コミュニティまつりデモ';
  const now = new Date(); now.setHours(21, 0, 0, 0);
  const start = new Date(now); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0);
  const people = [
    ['pixel_neko', 'ぴくせる猫'], ['kochi_maker', '高知のメイカー'], ['ume_dev', 'うめ＠地域DX'], ['sora_papa', 'そらパパ'],
    ['tataki_lover', 'たたき大好き'], ['yuzu_code', 'ゆず'], ['katsuo_run', 'かつおランナー'], ['hoshi_npo', 'ほしの（NPO）'], ['mikan_art', 'みかん画伯']
  ];
  const lines = [
    '初参加！会場の熱量がすごい。知らない人と5分で友だちになれる場所 #{t}',
    '@{m} さんのセッション、「小さく始めて続ける」の一言が刺さった #{t}',
    'お昼の鰹のたたき、藁焼きの香りで優勝🐟 #{t}',
    'セッションのメモをnoteにまとめました。地域のコミュニティ運営の話が濃い #{t}',
    '休憩時間の雑談がいちばん学びが多い説 #{t}',
    '@{m} 声かけてくれてありがとう！次は一緒に何かやりましょう #{t}',
    '会場の写真。人が多すぎて全員入らない #{t}',
    'きっかけはここでした。去年の出会いから一年でプロジェクトが動いてる #{t}',
    '懇親会で @{m} さんと @{m2} さんがつながってた、この瞬間が好き #{t}',
    'スライドが手描きで最高だった。真似したい #{t}',
    '帰りの新幹線でまだ余韻。次回も絶対来る #{t}',
    '子ども連れでも楽しめた。キッズスペースありがたい #{t}'
  ];
  state.posts = {}; state.pins = []; resetFishing();
  state.tag = tag; state.from = ymd(start); state.to = ymd(now); state.photoOnly = false;
  const span = now - start;
  for (let i = 0; i < 34; i++) {
    const [user, name] = people[(i * 7 + (i >> 2)) % people.length];
    const pickP = () => people[(i * 3 + 1 + Math.floor(Math.random() * 8)) % people.length][0];
    let m = pickP(); if (m === user) m = people[(people.findIndex(p => p[0] === user) + 1) % people.length][0];
    let m2 = pickP(); if (m2 === user || m2 === m) m2 = people[(people.findIndex(p => p[0] === m) + 2) % people.length][0];
    const t = start.getTime() + span * Math.pow(Math.random(), 0.7) * 0.97 + Math.random() * 3600e3;
    const text = lines[i % lines.length].replace(/\{t\}/g, tag).replace('{m}', m).replace('{m2}', m2);
    addPost(user, timeToId(t), { demo: true, name, text, photo: i % 3 === 0, status: 'ok' });
  }
  state.pins = Object.keys(state.posts).slice(0, 3);
  writeInputs(); save(); switchView('board');
  toast('デモ（架空の投稿）を読み込みました');
}
$('#demoBtn').onclick = loadDemo;
$('#demoBtn2').onclick = loadDemo;

/* ---------- ブックマークレット（X の検索結果でURLを集める） ---------- */
function collector() {
  if (window.__tzc) { window.__tzc.click(); return; }
  const seen = new Set();
  const b = document.createElement('button');
  b.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#1e73be;color:#fff;font:900 15px sans-serif;border:3px solid #0d2240;border-radius:999px;padding:12px 18px;box-shadow:4px 4px 0 #0d2240;cursor:pointer';
  const scan = () => {
    document.querySelectorAll('article a[href*="/status/"]').forEach(a => {
      if (!a.querySelector('time')) return;
      const m = (a.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/);
      if (m) seen.add('https://x.com/' + m[1] + '/status/' + m[2]);
    });
    b.textContent = 'CLS TAG ZINE：' + seen.size + '件（クリックでコピー）';
  };
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
  b.onclick = () => {
    const text = [...seen].join('\n');
    navigator.clipboard.writeText(text).then(() => { b.textContent = seen.size + '件コピーしました！'; },
      () => { window.prompt('コピーしてください', text); });
  };
  document.body.appendChild(b);
  window.__tzc = b;
}
const bm = $('#bookmarklet');
bm.href = 'javascript:' + encodeURIComponent(`(${collector.toString()})()`);
bm.addEventListener('click', e => { e.preventDefault(); toast('このボタンをブックマークバーへドラッグしてね'); });

/* ---------- 演出：トースト・紙吹雪（四角・丸・鰹） ---------- */
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}
const cv = $('#confetti'), cx = cv.getContext('2d');
let bits = [], confettiRaf = 0;
function confetti(x, y, n = 60, mode = 'party') {
  if (reduced()) return;
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  const colors = mode === 'splash' ? SPLASH : PALETTE;
  for (let i = 0; i < n; i++) {
    const a = mode === 'splash' ? -Math.PI / 2 + (Math.random() - .5) * 2.2 : Math.random() * Math.PI * 2;
    const s = 4 + Math.random() * (mode === 'splash' ? 11 : 9);
    const shape = mode === 'splash' ? (i % 9 === 0 ? 'fish' : 'drop') : ['rect', 'rect', 'circle', 'fish'][i % 4];
    bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (mode === 'splash' ? 2 : 6), r: Math.random() * 6, vr: (Math.random() - .5) * .4,
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, c: colors[i % colors.length], life: 90 + Math.random() * 40, shape });
  }
  if (!confettiRaf) confettiRaf = requestAnimationFrame(drawConfetti);
}
function drawConfetti() {
  const k = devicePixelRatio;
  cx.clearRect(0, 0, cv.width, cv.height);
  bits = bits.filter(b => b.life-- > 0);
  bits.forEach(b => {
    b.vy += 0.35; b.vx *= 0.98; b.x += b.vx; b.y += b.vy; b.r += b.vr;
    cx.save(); cx.translate(b.x * k, b.y * k); cx.rotate(b.shape === 'fish' ? Math.atan2(b.vy, b.vx) : b.r);
    cx.globalAlpha = Math.min(1, b.life / 30);
    cx.fillStyle = b.c; cx.strokeStyle = '#0d2240'; cx.lineWidth = 1.5 * k;
    if (b.shape === 'rect') cx.fillRect(-b.w * k / 2, -b.h * k / 2, b.w * k, b.h * k);
    else if (b.shape === 'circle' || b.shape === 'drop') { cx.beginPath(); cx.arc(0, 0, (b.shape === 'drop' ? b.h * .55 : b.h * .7) * k, 0, Math.PI * 2); cx.fill(); if (b.c === '#ffffff') cx.stroke(); }
    else { // 鰹のかたち
      const L = 14 * k;
      cx.fillStyle = '#1e3f6e';
      cx.beginPath(); cx.ellipse(0, 0, L, L * .38, 0, 0, Math.PI * 2); cx.fill(); cx.stroke();
      cx.beginPath(); cx.moveTo(-L * .9, 0); cx.lineTo(-L * 1.5, -L * .45); cx.lineTo(-L * 1.5, L * .45); cx.closePath(); cx.fill(); cx.stroke();
      cx.fillStyle = '#dfe8f2'; cx.beginPath(); cx.ellipse(0, L * .14, L * .8, L * .18, 0, 0, Math.PI * 2); cx.fill();
    }
    cx.restore();
  });
  confettiRaf = bits.length ? requestAnimationFrame(drawConfetti) : 0;
  if (!bits.length) cx.clearRect(0, 0, cv.width, cv.height);
}

/* ---------- 起動 ---------- */
$('#swimmer').innerHTML = KATSUO_SVG;
buildChips();
const fromHash = loadFromHash();
const hadSaved = !fromHash && load();
if (!fromHash && !hadSaved) {
  state.tag = PRESETS.defaultTag;
  const p = PRESETS.periods[0];
  if (p) Object.assign(state, periodRange(p));
}
writeInputs();
render();

/* ---------- おすすめボード（preset.json） ----------
 * リポジトリに preset.json（「書き出し」で保存したファイル）を置くと、
 * はじめて開いた人には自動でそのボードが表示されます。
 * すでに自分のボードがある人は上書きせず、「おすすめボード」ボタンで追加できます。
 */
let presetData = null;
async function fetchPreset() {
  try {
    const res = await fetch('preset.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const d = await res.json();
    return d && d.app === 'tagzine' && Array.isArray(d.posts) && d.posts.length ? d : null;
  } catch { return null; } // ローカルで index.html を直接開いたときは読めません
}
function applyPreset(d, auto) {
  const before = Object.keys(state.posts).length;
  applySnapshot(d);
  const added = Object.keys(state.posts).length - before;
  toast(auto ? `おすすめボード（${added} 件）をひらきました` : `おすすめボードから ${added} 件追加しました`);
  const r = $('#presetBtn').getBoundingClientRect();
  if (!auto) confetti(r.left + r.width / 2, r.top, 60);
}
fetchPreset().then(d => {
  presetData = d;
  if (!d) return;
  $('#presetBtn').hidden = false;
  if (!fromHash && !hadSaved) applyPreset(d, true); // はじめての人だけ自動で表示
});
$('#presetBtn').onclick = async () => {
  const d = presetData || await fetchPreset();
  if (!d) { toast('おすすめボードを読み込めませんでした'); return; }
  applyPreset(d, false);
};
})();
