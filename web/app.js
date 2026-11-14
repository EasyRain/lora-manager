/* 提示词记事本 v4 —— 真目录 > 大卡片(LoRA) > 小卡片(提示词) · 无依赖 */
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = (p) => p + Math.random().toString(36).slice(2, 9);

const HIDDEN = '__hidden__';

let lib = { version: 3, root: '', cards: [], hidden: [], files: {}, civcache: {} };
let tree = { root: '', dirs: [], files: [] };
let curDir = '';
let sel = [];
let editingChild = null;
let editingCard = null;
let lastMove = null;
let saveTimer = null;

/* ---------------- 路径小工具 ---------------- */
const parentOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const nameOf = (rel) => rel.split('/').pop();
const stemOf = (rel) => nameOf(rel).replace(/\.[^.]+$/, '');
const norm = (s) => String(s || '').toLowerCase().replace(/[\s_()（）\[\]【】·・.,，、:：;；!！?？'"`~～\-—/\\]+/g, '');
const cardByPath = (rel) => lib.cards.find((c) => c.path === rel);
const isHidden = (rel) => (lib.hidden || []).includes(rel);

/* ---------------- 读写 ---------------- */
async function loadLib() {
  const r = await fetch('/api/library');
  if (!r.ok) throw new Error(t('读取 library 失败 ') + r.status);
  const d = await r.json();
  lib.cards = Array.isArray(d.cards) ? d.cards : [];
  lib.hidden = Array.isArray(d.hidden) ? d.hidden : [];
  lib.files = d.files && typeof d.files === 'object' ? d.files : {};
  lib.civcache = d.civcache && typeof d.civcache === 'object' ? d.civcache : {};
  lib.root = d.root || '';
  lib.version = d.version || 2;
  lib.savedAt = d.savedAt;
}

async function loadTree() {
  const r = await fetch('/api/tree');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || (t('目录扫描失败 ') + r.status));
  tree = { root: d.root, dirs: d.dirs || [], files: d.files || [] };
}

function touch() {
  clearTimeout(saveTimer);
  $('#saved').textContent = t('未保存…');
  saveTimer = setTimeout(() => save(), 350);
}

async function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const r = await fetch('/api/library', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: 3, root: lib.root || tree.root || '', cards: lib.cards, hidden: lib.hidden, files: lib.files, civcache: lib.civcache }),
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    $('#saved').textContent = t('已保存 ') + (d.savedAt || '').slice(11, 19);
  } catch (e) {
    $('#saved').textContent = t('保存失败');
    toast(t('保存失败：') + e.message, true);
  }
}

/* ---------------- 旧数据迁移 ---------------- */
function migrate() {
  if (lib.version >= 3) return;
  const byStem = new Map(tree.files.map((f) => [norm(f.name), f.rel]));
  let bound = 0;
  lib.cards.forEach((c) => {
    delete c.cat;
    delete c.folder;
    if (c.path) return;
    const hit = byStem.get(norm(c.title));
    if (hit) { c.path = hit; bound++; }
    else { c.path = ''; c.dir = ''; }
  });
  lib.version = 3;
  toast(t('已把 ') + bound + t(' 张卡片绑到磁盘文件'));
  touch();
}

/* 把旧数据里挂在子卡片上的「权重 0.6-1.0」标签提到卡片级别（可重复执行） */
function normalize() {
  // 把已有卡片上的匹配结果搬进按哈希的缓存，之后就不用再查了
  lib.cards.forEach((c) => {
    if (c.h && c.civitai !== undefined && !lib.civcache[c.h]) {
      lib.civcache[c.h] = { url: c.civitai, title: c.ctitle || '', at: Date.now() };
    }
  });

  let changed = false;
  lib.cards.forEach((c) => {
    const kids = c.children || [];
    // 单图 → 多图
    kids.forEach((k) => {
      if (k.img !== undefined) {
        const arr = Array.isArray(k.imgs) ? k.imgs : [];
        if (k.img && !arr.includes(k.img)) arr.unshift(k.img);
        k.imgs = arr.filter(Boolean);
        delete k.img;
        changed = true;
      } else if (!Array.isArray(k.imgs)) {
        k.imgs = [];
      }
    });
    if (!c.w) {
      for (const k of kids) {
        const t = (k.tags || []).find((x) => String(x).startsWith('权重'));
        if (t) { c.w = String(t).replace(/^权重\s*/, '').trim(); changed = true; break; }
      }
    }
    kids.forEach((k) => {
      if (k.tags) {
        const before = k.tags.length;
        k.tags = k.tags.filter((x) => !String(x).startsWith('权重'));
        if (k.tags.length !== before) changed = true;
      }
    });
  });
  if (changed) touch();
}


/* ---------------- 主题：跟随系统 / 亮色 / 暗色 ---------------- */
const THEME_KEY = 'lora.theme';
const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_LABEL = () => ({ auto: t('🌗 跟随'), light: t('☀ 亮色'), dark: t('🌙 暗色') });
const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

function themeMode() {
  const m = localStorage.getItem(THEME_KEY) || 'auto';
  return THEME_ORDER.includes(m) ? m : 'auto';
}

function applyTheme(mode) {
  const effective = mode === 'auto' ? (mql && mql.matches ? 'light' : 'dark') : mode;
  document.documentElement.dataset.theme = effective;
  const lab = $('#theme-label');
  if (lab) lab.textContent = THEME_LABEL()[mode];
  const btn = $('#btn-theme');
  if (btn) {
    btn.title = mode === 'auto'
      ? t('跟随系统（当前') + (effective === 'light' ? t('亮色') : t('暗色')) + '）'
      : t('主题：') + THEME_LABEL()[mode].slice(2);
  }
}

function cycleTheme() {
  const cur = themeMode();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  toast(t('主题：') + (next === 'auto' ? t('跟随系统') : next === 'light' ? t('亮色') : t('暗色')));
}

/* ---------------- 小工具 ---------------- */
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.hidden = true), 2200);
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(t('已复制 ') + s.length + t(' 字符'));
}

function filesIn(dir) {
  return tree.files.filter((f) => parentOf(f.rel) === dir && !isHidden(f.rel));
}
function dirsIn(dir) {
  return tree.dirs.filter((d) => d.parent === dir).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}
function cardsIn(dir) {
  return lib.cards.filter((c) => (c.path ? parentOf(c.path) === dir && !isHidden(c.path) : (c.dir || '') === dir));
}
/* 左栏：本层没有卡片就用子树的，别显示 0 */
function treeCardCount(rel) {
  const direct = dirCards(rel);
  if (direct) return direct;
  let n = 0;
  subtreeDirs(rel).forEach((d) => { n += dirCards(d); });
  return n;
}

/* 当前层没有、子文件夹里有时，用这个给出递归数量，别让文件夹看着像空的 */
function countsText(dir) {
  const direct = { lo: filesIn(dir).length, cd: cardsIn(dir).length };
  if (direct.lo || direct.cd || !dirsIn(dir).length) {
    return direct.lo + t('个 LoRA · ') + direct.cd + t(' 张卡');
  }
  const dirs = subtreeDirs(dir);
  let lo = 0, cd = 0;
  dirs.forEach((d) => {
    lo += tree.files.filter((f) => parentOf(f.rel) === d && !isHidden(f.rel)).length;
    cd += lib.cards.filter((c) => (c.path ? parentOf(c.path) === d && !isHidden(c.path) : (c.dir || '') === d)).length;
  });
  return t('含子文件夹 ') + lo + t('个 LoRA · ') + cd + t(' 张卡');
}

function dirLabel(rel) { return rel ? rel.split('/').pop() : t('根目录'); }
function dirCards(rel) { return cardsIn(rel).length; }
/* ---------------- 滚动按钮 ---------------- */
function updateScrollBtns() {
  const sc = $('#scroller');
  const box = $('#scroller-btns');
  if (!sc || !box) return;
  box.hidden = sc.scrollHeight - sc.clientHeight < 40;   // 内容不够高就不显示
}

function scrollTop() { const w = $('#scroller'); if (w) w.scrollTop = 0; }

/* ---------------- 右键菜单 ---------------- */
function showMenu(ev, items) {
  ev.preventDefault();
  ev.stopPropagation();
  const list = items.filter((it) => it.sep || it.show !== false);
  // 去掉连着/结尾的分隔
  const cleaned = [];
  list.forEach((it) => {
    if (it.sep) { if (cleaned.length && !cleaned[cleaned.length - 1].sep) cleaned.push(it); }
    else cleaned.push(it);
  });
  while (cleaned.length && cleaned[cleaned.length - 1].sep) cleaned.pop();

  const menu = $('#menu');
  menu.innerHTML = cleaned
    .map((it, i) => (it.sep ? '<div class="msep"></div>' : `<button class="mi ${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label)}</button>`))
    .join('');
  menu.hidden = false;
  menu.style.left = '0px';
  menu.style.top = '0px';
  const w = menu.offsetWidth, h = menu.offsetHeight;
  let x = ev.clientX, y = ev.clientY;
  if (x + w > window.innerWidth - 8) x = window.innerWidth - w - 8;
  if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 8;
  menu.style.left = Math.max(4, x) + 'px';
  menu.style.top = Math.max(4, y) + 'px';
  menu._items = cleaned;
}

function hideMenu() {
  const menu = $('#menu');
  menu.hidden = true;
  menu._items = null;
}

/* ---------------- 文件操作 ---------------- */
async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}

async function renamePath(rel) {
  const isDir = tree.dirs.some((d) => d.rel === rel);
  const old = isDir ? nameOf(rel) : stemOf(rel);
  const name = prompt(isDir ? t('重命名文件夹：') : t('重命名 LoRA 文件（不含扩展名）：'), old);
  if (!name || !name.trim() || name.trim() === old) return;
  try {
    const d = await postJson('/api/rename', { from: rel, name: name.trim() });
    if (!isDir) {
      const c = cardByPath(rel);
      if (c) {
        c.path = d.to;
        if (c.title === old) c.title = name.trim();
      }
    }
    if (curDir === rel) curDir = parentOf(d.to);
    await loadTree();
    touch();
    render();
    toast(t('已改名'));
  } catch (e) {
    toast(t('改名失败：') + e.message, true);
  }
}

function hidePath(rel) {
  if (!rel) return;
  if (!isHidden(rel)) lib.hidden.push(rel);
  touch();
  render();
  toast(t('已隐藏（左侧「隐藏」里能找到）'));
}

function unhidePath(rel) {
  lib.hidden = lib.hidden.filter((x) => x !== rel);
  touch();
  render();
  toast(t('已取消隐藏'));
}

async function revealPath(rel) {
  try { await postJson('/api/reveal-file', { path: rel }); }
  catch (e) { toast(e.message, true); }
}

async function newFolder() {
  const name = prompt(t('新文件夹名称（会真的在磁盘上创建）：'));
  if (!name || !name.trim()) return;
  const base = curDir === HIDDEN ? '' : curDir;
  const rel = (base ? base + '/' : '') + name.trim().replace(/[\\/:*?"<>|]/g, '_');
  try {
    const d = await postJson('/api/mkdir', { path: rel });
    await loadTree();
    curDir = d.rel;
    render();
    toast(t('已创建 ') + d.rel);
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteFolder(rel) {
  const n = filesIn(rel).length + dirsIn(rel).length;
  if (n > 0) return toast('文件夹里还有东西，先清空再删', true);
  if (!confirm(`删除空文件夹「${dirLabel(rel)}」？`)) return;
  try {
    await postJson('/api/rmdir', { path: rel });
    if (curDir === rel) curDir = parentOf(rel);
    await loadTree();
    render();
    toast(t('已删除'));
  } catch (e) {
    toast(e.message, true);
  }
}

/* ---------------- 查 Civitai 页面地址 ---------------- */
function openUrl(url) {
  // 交给 WebView2 的 NewWindowRequested，会落到系统浏览器
  window.open(url, '_blank');
}

async function openCivitai(rel, card) {
  if (!rel) return;
  if (card && card.civitai) return openUrl(card.civitai);
  return rematchOne(card, rel, { open: true });
}

/* tooltip：第一行 Civitai 标题（仅已匹配），第二行文件位置 */
function cardTip(card, path) {
  const st = civState(path || '', card);
  const lines = [];
  if (st.ctitle) lines.push(st.ctitle);
  lines.push(path || t('（没有绑定 LoRA 文件）'));
  return lines.join('\n');
}

/* 三态标记：未匹配 ↻ / 已匹配 ↗ / 无匹配 不显示 */
function civMarkHTML(key, state) {
  if (state === undefined) {
    return '<span class="civ todo" data-civ-refresh="' + esc(key) + '" title="' + t('未匹配：点一下查这个 LoRA') + '">↻</span>';
  }
  if (state) {
    return '<span class="civ" data-civ-open="' + esc(key) + '" title="' + t('已匹配：点开 Civitai 页面') + '">↗</span>';
  }
  return '';
}

/* 按哈希缓存的 Civitai 结果：{ "<sha256>": { url, title } } ；查不到存 { url: "" } */
function cacheGet(hash) {
  return hash ? lib.civcache[hash] : undefined;
}
function cachePut(hash, url, title) {
  if (!hash) return;
  lib.civcache[hash] = { url: url || '', title: title || '', at: Date.now() };
}

/* ---------------- Civitai 状态（按文件记录，和有没有卡片无关） ---------------- */
function civState(rel, card) {
  if (card) return { h: card.h, civitai: card.civitai, ctitle: card.ctitle };
  return lib.files[rel] || {};
}

function setCivState(rel, card, patch, silent) {
  if (card) {
    Object.assign(card, patch);
  } else {
    lib.files[rel] = Object.assign({}, lib.files[rel] || {}, patch);
  }
  if (!silent) touch();
}

/* 建卡时把文件上已有的匹配结果搬进卡片 */
function adoptFileState(rel, card) {
  const st = lib.files[rel];
  if (!st || !card) return;
  if (st.h && !card.h) card.h = st.h;
  if (st.civitai !== undefined && card.civitai === undefined) card.civitai = st.civitai;
  delete lib.files[rel];
}

/* ---------------- 批量匹配 Civitai ---------------- */
/* card.civitai 三种状态：
     undefined  -> 还没查过
     ""         -> 查过，Civitai 上没有（下架/非 Civitai 来源）
     "https://…" -> 查到了 */
let matchRun = null;

/* 所有需要匹配的 LoRA（含没有卡片的） */
function matchTargets() {
  return tree.files
    .filter((f) => !isHidden(f.rel))
    .map((f) => {
      const card = cardByPath(f.rel);
      return { rel: f.rel, card, st: civState(f.rel, card) };
    })
    .filter((x) => x.st.civitai === undefined || (x.st.civitai && !x.st.ctitle));
}

function setMatchLabel(txt) {
  const el = $('#match-label');
  if (el) el.textContent = txt;
}

/* 空闲时按钮上直接显示还有多少"未匹配" */
function updateMatchButton() {
  if (matchRun) return;
  const n = matchTargets().length;
  setMatchLabel(t('匹配 Civitai'));
  const btn = $('#btn-match');
  if (!btn) return;
  btn.title = n
    ? t('给还没匹配过的 LoRA 查 Civitai 页面') + ' · ' + t('还剩 ') + n + t(' 个未匹配')
    : t('全部匹配过了');
}

async function matchAll() {
  if (matchRun) { matchRun.cancelled = true; return; }   // 再点一次 = 停

  const todo = matchTargets();
  if (!todo.length) return toast(t('没有需要匹配的 LoRA 了'));

  const run = { cancelled: false, total: todo.length, done: 0, ok: 0, none: 0 };
  matchRun = run;
  setMatchLabel(t('检测连通…'));

  try {
    const p = await postJson('/api/civitai/ping', {});
    if (!p.ok) {
      toast(t('连不上 Civitai（3 秒超时），已停止'), true);
      return;
    }

    // 一次把缺的哈希都算出来
    const needHash = todo.filter((x) => !x.st.h).map((x) => x.rel);
    if (needHash.length) {
      setMatchLabel(t('计算哈希…'));
      const r = await postJson('/api/hash', { paths: needHash });
      Object.keys(r.hashes || {}).forEach((rel) => {
        setCivState(rel, cardByPath(rel), { h: r.hashes[rel] }, true);
      });
      touch();
    }

    for (const item of todo) {
      if (run.cancelled) break;
      setMatchLabel(t('匹配中 ') + (run.done + 1) + '/' + run.total);

      // 本地缓存里有结果就直接用，不联网
      const cached = cacheGet(item.st.h);
      if (cached && (item.st.civitai === undefined || cached.title)) {
        setCivState(item.rel, cardByPath(item.rel), { civitai: cached.url || '', ctitle: cached.title || '' }, true);
        cached.url ? run.ok++ : run.none++;
        run.done++;
        if (run.done % 10 === 0) touch();
        continue;
      }

      try {
        const d = await postJson('/api/civitai/lookup', { hash: item.st.h, path: item.rel });
        const url = d.found && d.url ? d.url : '';
        const h = d.hash || item.st.h;
        cachePut(h, url, d.title);
        setCivState(item.rel, cardByPath(item.rel),
          { civitai: url, ctitle: d.title || '', h }, true);
        url ? run.ok++ : run.none++;
      } catch (e) {
        setCivState(item.rel, cardByPath(item.rel), { civitai: '' }, true);
        run.none++;
      }
      run.done++;
      if (run.done % 10 === 0) touch();   // 每 10 条存一次，别刷屏也别丢数据
      await new Promise((r2) => setTimeout(r2, 250));
    }

    touch();
    render();
    const tail = run.cancelled ? t('（已中断）') : '';
    toast(t('匹配完成：') + run.ok + t(' 个有页面，') + run.none + t(' 个没有') + tail);
  } catch (e) {
    toast(t('匹配失败：') + e.message, true);
  } finally {
    matchRun = null;
    updateMatchButton();
  }
}

/* 单个强制重查。opts.open=true 时顺便打开页面（"在 Civitai 打开"没缓存时用） */
async function rematchOne(card, rel, opts) {
  const target = card || cardByPath(rel);
  const path = rel || (target && target.path);
  if (!path) return;
  toast(t('正在查 Civitai…'));
  try {
    const d = await postJson('/api/civitai/lookup', { path });
    cachePut(d.hash, d.found && d.url ? d.url : '', (d.found && d.title) || '');
    setCivState(path, target, {
      civitai: d.found && d.url ? d.url : '',
      ctitle: (d.found && d.title) || '',
      ...(d.hash ? { h: d.hash } : {}),
    });
    render();
    if (d.found && d.url) {
      if (opts && opts.open) { openUrl(d.url); toast(t('已打开模型页')); }
      else toast(t('已匹配'));
    } else {
      toast(t('无匹配：Civitai 上没有这个模型'), true);
    }
  } catch (e) {
    toast(t('查询失败：') + e.message, true);
  }
}

/* ---------------- 删除 LoRA 文件 / 导入 ---------------- */
let importDir = '';

async function deleteLoraFile(rel) {
  const name = nameOf(rel);
  if (!confirm(t('删除 LoRA 文件「') + name + t('」？会进回收站（可恢复）；这张卡片会变成不绑定文件的文本卡，提示词保留。'))) return;
  try {
    await postJson('/api/delete', { path: rel });
    const card = cardByPath(rel);
    if (card) {
      card.path = '';
      card.dir = parentOf(rel);
    }
    lib.hidden = lib.hidden.filter((x) => x !== rel);
    delete lib.files[rel];
    sel = sel.filter((k) => !k.startsWith(card ? card.id : '\u0000'));
    touch();
    await loadTree();
    render();
    toast(t('已删除 ') + name);
  } catch (e) {
    toast(t('删除失败：') + e.message, true);
  }
}

function importLora(dir) {
  importDir = dir === undefined ? curDir : dir;
  $('#file-lora').value = '';
  $('#file-lora').click();
}

/* ---------------- 拖放上传 ---------------- */
function anyModalOpen() {
  return !$('#modal').hidden || !$('#modal-card').hidden || !$('#modal-move').hidden || !$('#modal-preview').hidden;
}
const LORA_EXT = /\.(safetensors|sft|ckpt|pt|pth|bin)$/i;

function dropTargetDir(ev) {
  const tile = ev.target && ev.target.closest ? ev.target.closest('.tile[data-dir]') : null;
  if (tile) return tile.dataset.dir;
  if (curDir === HIDDEN) return '';
  return curDir;
}

async function uploadFiles(files, dir) {
  const list = files.filter((f) => LORA_EXT.test(f.name));
  if (!list.length) return toast('只接受 .safetensors / .ckpt 这类 LoRA 文件', true);
  let ok = 0;
  const fails = [];
  for (const f of list) {
    toast(t('正在复制 ') + f.name + ' …');
    try {
      const r = await fetch('/api/upload?dir=' + encodeURIComponent(dir) + '&name=' + encodeURIComponent(f.name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: f,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      ok++;
    } catch (e) {
      fails.push(f.name + '：' + e.message);
    }
  }
  await loadTree();
  render();
  toast(fails.length ? `${ok} / ${fails.length} · ${fails[0]}` : t('已复制 ') + ok + ' → ' + dirLabel(dir), fails.length > 0);
}

/* ---------------- 侧栏目录树 ---------------- */
/* ---------------- 左栏目录树：可折叠 ---------------- */
const EXPAND_KEY = 'lora.treeExpanded';
const ROOT_OPEN_KEY = 'lora.treeRootOpen';
let treeExpanded = new Set(JSON.parse(localStorage.getItem(EXPAND_KEY) || '[]'));
let rootOpen = localStorage.getItem(ROOT_OPEN_KEY) !== '0';   // 根目录默认展开

function saveExpand() {
  localStorage.setItem(EXPAND_KEY, JSON.stringify([...treeExpanded]));
  localStorage.setItem(ROOT_OPEN_KEY, rootOpen ? '1' : '0');
}
/* 进入某个目录时，把它的所有上级都展开，免得看不见自己 */
function expandPath(dir) {
  let p = parentOf(dir);
  while (p) { treeExpanded.add(p); p = parentOf(p); }
  saveExpand();
}
function toggleExpand(rel) {
  if (rel === '') rootOpen = !rootOpen;
  else if (treeExpanded.has(rel)) treeExpanded.delete(rel);
  else treeExpanded.add(rel);
  saveExpand();
  renderTree();
}

function renderTree() {
  // 一律不缩进：层级用图标的深浅表示（--lv），这样再深也不会跑出侧栏
  const row = (key, icon, name, lv, cnt, extra = '') =>
    `<div class="cat ${curDir === key ? 'active' : ''} ${extra}" data-dir="${esc(key)}">
       ${icon}<span class="dname">${esc(name)}</span><span class="cnt">${cnt}</span>
     </div>`;
  // 层级数字 + 分组颜色：同一个父目录下的子目录用同一种颜色，多了就循环用
  const PALETTE = ['#e0a458', '#6aa9e9', '#7ec98a', '#c58ae0', '#e07a7a'];
  const parentIdx = new Map();
  const badge = (rel, lv) => {
    if (lv < 1) return '';
    const pi = parentIdx.get(parentOf(rel)) ?? 0;
    return `<i class="lv" style="--lv-color:${PALETTE[pi % PALETTE.length]}">${lv}</i>`;
  };
  // 第一级在收起时不标数字；更深的层级一直标
  const iconHTML = (rel, kids, open, lv) => {
    const num = (lv >= 2 || (lv === 1 && open)) ? badge(rel, lv) : '';
    return kids
      ? `<span class="ic" data-tw="${esc(rel)}" title="${open ? t('收起') : t('展开')}">${open ? '📂' : '📁'}${num}</span>`
      : `<span class="ic plain">📁${num}</span>`;
  };

  const dirs = [...tree.dirs].sort((a, b) => a.rel.localeCompare(b.rel, 'zh'));
  [...new Set(dirs.map((d) => parentOf(d.rel)))].sort().forEach((p, i) => parentIdx.set(p, i));
  const hasChild = new Set();
  dirs.forEach((d) => { const p = parentOf(d.rel); if (p) hasChild.add(p); });
  const depthOf = (rel) => (rel ? rel.split('/').length : 0);

  // 该显示哪些（只看展开状态）
  const shown = new Set(['']);
  dirs.forEach((d) => {
    const p = parentOf(d.rel);
    const open = p === '' ? rootOpen : treeExpanded.has(p);
    if (shown.has(p) && open) shown.add(d.rel);
  });

  let html = row('', '<span class="ic" data-tw="" title="' + t('展开') + ' / ' + t('收起') + '">🗂</span>',
                 t('根目录'), 0, treeCardCount(''));

  dirs.forEach((d) => {
    if (!shown.has(d.rel)) return;
    const lv = depthOf(d.rel);
    html += row(d.rel, iconHTML(d.rel, hasChild.has(d.rel), treeExpanded.has(d.rel), lv),
                d.name, lv, treeCardCount(d.rel));
  });

  const foot = row(HIDDEN, '<span class="ic plain">🙈</span>', t('隐藏'), 0, lib.hidden.length);

  const cats = $('#cats-list');
  if (!cats) { $('#cats').innerHTML = html + foot; return; }
  const keep = cats.scrollTop;
  cats.innerHTML = html;
  cats.scrollTop = keep;
  $('#cats-foot').innerHTML = foot;
}






/* ---------------- 主区 ---------------- */
function childHTML(card, k) {
  const key = card.id + '|' + k.id;
  const n = sel.indexOf(key);
  const tags = (k.tags || []).length ? '<span class="tagm">' + (k.tags || []).map(esc).join(' · ') + '</span>' : '';
  const imgs = imgsOf(k);
  const img = imgs.length
    ? `<div class="cimgs">` + imgs.map((u) => `<img class="cimg" src="${esc(u)}" loading="lazy" alt="">`).join('') + `</div>`
    : '';
  const titleTxt = (k.title || '').trim();
  const bodyTxt = (k.body || '').trim();
  const head = (titleTxt || n >= 0 || tags)
    ? `<div class="ct">${titleTxt ? `<span class="tt">${esc(titleTxt)}</span>` : ''}${n >= 0 ? `<span class="selno">${n + 1}</span>` : ''}${tags}</div>`
    : '';
  return `<div class="child ${n >= 0 ? 'selected' : ''}" draggable="true" data-child="${esc(key)}">
    <div class="mid">
      ${head}
      ${bodyTxt ? `<div class="cb">${esc(k.body || '')}</div>` : ''}
      ${img}
    </div>
    <div class="acts">
      <button class="icon" data-copy-child="${esc(key)}" title="${t('复制这条')}">⧉</button>
      <button class="icon" data-edit-child="${esc(key)}" title="${t('编辑')}">✎</button>
    </div>
  </div>`;
}

function cardHTML(card) {
  const kids = card.children || [];
  const whole = sel.indexOf(card.id);
  return `<div class="card ${whole >= 0 ? 'has-sel' : ''}" data-card="${card.id}">
    <div class="card-head" draggable="true" data-whole="${card.id}" title="${esc(cardTip(card, card.path))}">
      <span class="title">${esc(card.title || t('(无标题)'))}${card.w ? ` <span class="wbadge">${esc(card.w)}</span>` : ''}${whole >= 0 ? ' ⑂' + (whole + 1) : ''}</span>
      <span class="n">${kids.length}</span>
      ${card.path ? civMarkHTML('c:' + card.id, civState(card.path, card).civitai) : ''}
      <span class="acts">
        <button class="icon" data-add-child="${card.id}" title="${t('新建小卡片')}">＋</button>
        <button class="icon" data-edit-card="${card.id}" title="${t('编辑大卡片 / 移动')}">✎</button>
      </span>
    </div>
    ${kids.length
      ? kids.map((k) => childHTML(card, k)).join('')
      : `<div class="child empty-hint"><div class="mid"><div class="cb">${t('还没有内容，点标题右边的 ＋ 新建小卡片。')}</div></div></div>`}
  </div>`;
}

/* 拖动排序用：按 order 再按标题 */
function byOrder(a, b) {
  const ao = a.order == null ? 1e9 : a.order;
  const bo = b.order == null ? 1e9 : b.order;
  return ao - bo || String(a.title || '').localeCompare(String(b.title || ''), 'zh');
}
/* 这个目录里所有"有自己的卡片"的条目（有内容没内容都算），按手动顺序排 */
function orderedCards(dir) {
  return lib.cards
    .filter((c) => (c.path ? parentOf(c.path) === dir && !isHidden(c.path) : (c.dir || '') === dir))
    .sort(byOrder);
}

/* 把没排过序的卡片按"现在看到的样子"补上序号，返回当前最大序号 */
function ensureOrder(dir) {
  const list = orderedCards(dir);
  const missing = list.some((c) => c.order == null);
  if (missing) list.forEach((c, i) => { c.order = i + 1; });
  return list.reduce((m, c) => Math.max(m, c.order || 0), 0);
}

/* 新卡片一律排到最后：前面手动排过的一个都不动 */
function nextOrder(dir) {
  return ensureOrder(dir) + 1;
}

/* 按规则排一次：有提示词的在前、空的在后，各自按名字 */
function autoSort() {
  const list = orderedCards(curDir);
  if (!list.length) return;
  const byName = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh');
  const withKids = list.filter((c) => (c.children || []).length).sort(byName);
  const empty = list.filter((c) => !(c.children || []).length).sort(byName);
  [...withKids, ...empty].forEach((c, i) => { c.order = i + 1; });
  touch();
  render();
  toast(t('已按规则排序：有提示词 ') + withKids.length + t(' 张在前，空 ') + empty.length + t(' 张在后'));
}

function ghostHTML(file, hiddenView) {
  const card = cardByPath(file.rel);
  if (card && !hiddenView) return cardHTML(card);
  const btn = hiddenView
    ? `<button class="icon" data-unhide="${esc(file.rel)}" title="${t('取消隐藏')}">↩</button>`
    : `<button class="icon" data-claim="${esc(file.rel)}" title="${t('新建小卡片')}">＋</button>`;
  const hint = hiddenView ? t('已隐藏，右键或点 ↩ 恢复。') : t('还没有小卡片，点 ＋ 新建（右键也有）');
  const inner = card ? kidsOf(card) : `<div class="child"><div class="mid"><div class="cb">${hint}</div></div></div>`;
  return `<div class="card ghost" data-path="${esc(file.rel)}" title="${esc(cardTip(cardByPath(file.rel), file.rel))}">
    <div class="card-head">
      <span class="title">${esc(file.name)}</span>
      <span class="n">${hiddenView ? t('隐藏') : t('空')}</span>
      ${civMarkHTML('f:' + file.rel, civState(file.rel, cardByPath(file.rel)).civitai)}
      <span class="acts">${btn}</span>
    </div>
    ${inner}
  </div>`;
}

function kidsOf(card) {
  return (card.children || []).map((k) => childHTML(card, k)).join('');
}

/* 当前目录 + 它下面所有层级的目录 */
function subtreeDirs(dir) {
  const out = new Set([dir]);
  const queue = [dir];
  while (queue.length) {
    const d = queue.shift();
    dirsIn(d).forEach((x) => {
      if (!out.has(x.rel)) { out.add(x.rel); queue.push(x.rel); }
    });
  }
  return out;
}

function dirOfCard(c) {
  return c.path ? parentOf(c.path) : (c.dir || '');
}

/* ---------------- 目录前进 / 后退（鼠标侧键、Alt+←/→） ----------------
   直接借浏览器的历史记录：goDir 里 pushState，popstate 里回放。
   这样无论侧键是被宿主窗口转发过来，还是 Chromium 自己处理，走的都是同一条路。 */
function navApply(dir) {
  expandPath(dir);
  curDir = dir;
  sel = [];
  $('#search').value = '';
  render();
  scrollTop();
}

function navBack() { history.back(); }
function navForward() { history.forward(); }

window.__navBack = navBack;
window.__navForward = navForward;

window.addEventListener('popstate', (e) => {
  const d = (e.state && typeof e.state.dir === 'string') ? e.state.dir : '';
  navApply(d);
});

function renderMain() {
  const q = $('#search').value.trim().toLowerCase();

  if (curDir === HIDDEN) {
    const files = lib.hidden.filter((rel) => {
      if (!q) return true;
      const c = cardByPath(rel);
      const hay = (rel + ' ' + (c ? (c.title || '') + ' ' + (c.children || []).map((k) => (k.title || '') + ' ' + (k.body || '')).join(' ') : '')).toLowerCase();
      return hay.includes(q);
    }).map((rel) => ({ rel, name: stemOf(rel) }));
    const hidLabel = '🙈 ' + t('隐藏');
    $('#crumb').innerHTML = q
      ? `${hidLabel} · ${files.length}`
      : `${hidLabel} · ${files.length}`;
    $('#folders').innerHTML = '';
    paint(files.map((f) => ghostHTML(f, true)));
    return;
  }

  if (q) {
    // 只在"当前目录 + 下级"里搜；没有下级就只搜当前目录
    const scope = subtreeDirs(curDir);
    const items = lib.cards.filter((c) => {
      if (c.path && isHidden(c.path)) return false;
      if (!scope.has(dirOfCard(c))) return false;
      const hay = (c.title + '\n' + (c.children || []).map((k) => (k.title || '') + ' ' + (k.body || '')).join('\n')).toLowerCase();
      return hay.includes(q);
    });
    const scopeLabel = curDir
      ? dirLabel(curDir) + (dirsIn(curDir).length ? t('及下级') : '')
      : t('全部');
    $('#crumb').innerHTML = `${t('搜索')}「${esc($('#search').value.trim())}」· ${esc(scopeLabel)} · ${items.length}${t(' 张卡')}`;
    $('#folders').innerHTML = '';
    paint(items.map(cardHTML));
    return;
  }

  const subs = dirsIn(curDir);
  $('#folders').innerHTML = subs
    .map((d) => `<div class="tile" data-dir="${esc(d.rel)}">
        <div class="tname">📁 ${esc(d.name)}</div>
        <div class="tmeta">${countsText(d.rel)}</div>
      </div>`)
    .join('');

  const crumbs = [''];
  if (curDir) {
    const parts = curDir.split('/');
    for (let i = 0; i < parts.length; i++) crumbs.push(parts.slice(0, i + 1).join('/'));
  }
  $('#crumb').innerHTML =
    crumbs.map((p) => `<a href="#" data-dir="${esc(p)}">${esc(p ? dirLabel(p) : t('🗂 根目录'))}</a>`).join(' <span class="sep">/</span> ') +
    ` <span class="sep">·</span> ${countsText(curDir)}`;

  const items = orderedCards(curDir).map(cardHTML);
  const ghostFiles = filesIn(curDir)
    .filter((f) => !cardByPath(f.rel))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  ghostFiles.forEach((f) => items.push(ghostHTML(f, false)));
  paint(items);
}

function paint(items) {
  // 重排会把内容清空一次，滚动位置会跳回顶部；这里先记下来、排完再放回去
  const scroller = $('#scroller');
  const keepTop = scroller.scrollTop;
  const wasTop = keepTop <= 0;

  $('#empty').hidden = items.length > 0 || !!$('#search').value.trim();
  const el = $('#cards');
  el.innerHTML = items.join('');
  layoutColumns(el);

  if (!wasTop) {
    scroller.scrollTop = keepTop;
    // 内容高度还在变（图片/字体）时再补一次
    requestAnimationFrame(() => { scroller.scrollTop = keepTop; });
  }
}

function layoutColumns(el) {
  const cards = Array.from(el.children);
  if (!cards.length) return;
  const width = el.clientWidth || 900;
  const n = Math.max(1, Math.floor((width + 12) / 312));
  el.innerHTML = '';
  const cols = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'col';
    el.appendChild(c);
    cols.push(c);
  }
  const h = new Array(n).fill(0);
  cards.forEach((node) => {
    let k = 0;
    for (let i = 1; i < n; i++) if (h[i] < h[k]) k = i;
    cols[k].appendChild(node);
    h[k] += node.offsetHeight + 12;
  });
}

function renderSel() {
  $('#selbar').hidden = sel.length === 0;
  $('#seln').textContent = sel.length;
  const lbl = { 'sel-label': '已选', 'sep-label': '分隔', 'dedup-label': '去重' };
  Object.keys(lbl).forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = t(lbl[id]); });
  const names = sel.map((key) => {
    const [cid, kid] = key.split('|');
    const c = lib.cards.find((x) => x.id === cid);
    if (!c) return '?';
    if (!kid) return c.title || t('(无标题)');
    const k = (c.children || []).find((x) => x.id === kid);
    return (c.title || '') + (k && k.title ? ' / ' + k.title : '');
  });
  $('#selorder').textContent = sel.length > 1 ? names.join(' → ') : names[0] || '';
}

function render() {
  updateMatchButton();
  renderTree();
  renderMain();
  renderSel();
  $('#btn-undo').hidden = !lastMove;
  requestAnimationFrame(updateScrollBtns);   // 内容高度变了，按钮显隐跟着变
}

/* ---------------- 拖动排序 ---------------- */
let dragKey = null;

async function undoMove() {
  if (!lastMove) return;
  try {
    if (lastMove.kind === 'dir') {
      // 纯文本卡只是换了位置，没有文件要挪
      const c = lib.cards.find((x) => x.id === lastMove.cardId);
      if (c) c.dir = lastMove.fromDir;
    } else {
      await moveFile(lastMove.to, parentOf(lastMove.from));
      const c = cardByPath(lastMove.to);
      if (c) c.path = lastMove.from;
    }
    toast(t('已撤销'));
    lastMove = null;                 // 撤完就没有可撤销的了
    touch();
    try { await loadTree(); } catch { }
    render();
  } catch (e) { toast(t('撤销失败：') + e.message, true); }
}

/* 把一张卡片（连同它的 LoRA 文件）移动到某个目录 */
async function moveCardTo(cardId, dir) {
  const c = lib.cards.find((x) => x.id === cardId);
  if (!c) return;
  const from = c.path ? parentOf(c.path) : (c.dir || '');
  if (from === dir) return;
  if (c.path) {
    try {
      const d = await moveFile(c.path, dir);
      lastMove = { from: d.from, to: d.to };
      c.path = d.to;
    } catch (e) { return toast(e.message, true); }
  } else {
    lastMove = { kind: 'dir', cardId: c.id, fromDir: from };
    c.dir = dir;
  }
  touch();
  try { await loadTree(); } catch { }
  render();
  toast(t('已移动到 ') + dirLabel(dir));
}


/* ---------------- 把卡片拖到文件夹上 = 移动 ---------------- */
function bindMoveDrop() {
  const mark = (el) => {
    document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    if (el) el.classList.add('drop-target');
  };
  const wire = (box, pick) => {
    if (!box) return;
    box.addEventListener('dragover', (e) => {
      if (!dragKey || dragKey.type !== 'card') return;
      const el = pick(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      mark(el);
    });
    box.addEventListener('dragleave', (e) => {
      if (!box.contains(e.relatedTarget)) mark(null);
    });
    box.addEventListener('drop', (e) => {
      if (!dragKey || dragKey.type !== 'card') return;
      const el = pick(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      mark(null);
      const id = dragKey.id;
      dragKey = null;
      moveCardTo(id, el.dataset.dir ?? '');
    });
  };
  wire($('#folders'), (t) => t.closest('.tile[data-dir]'));
  wire($('#cats-list'), (t) => t.closest('.cat[data-dir]'));
  wire($('#crumb'), (t) => t.closest('[data-dir]'));
}

function clearDropMarks() {
  document.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
  document.querySelectorAll('.drop-before,.drop-after').forEach((x) => {
    x.classList.remove('drop-before', 'drop-after');
  });
}

function bindDrag() {
  const box = $('#cards');

  box.addEventListener('dragstart', (e) => {
    // 在正文上按下时不要抢：那是想选文字
    if (e.target.closest('.cb') || e.target.closest('.acts') || e.target.closest('.cimg')) {
      e.preventDefault();
      return;
    }
    const child = e.target.closest('[data-child]');
    if (child) {
      dragKey = { type: 'child', key: child.dataset.child };
      child.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', child.dataset.child); } catch (_) {}
      return;
    }
    const head = e.target.closest('.card-head[data-whole]');
    if (!head) return;
    const card = head.closest('[data-card]');
    if (!card) return;
    dragKey = { type: 'card', id: card.dataset.card };
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', card.dataset.card); } catch (_) {}
  });

  box.addEventListener('dragend', () => { clearDropMarks(); dragKey = null; });

  box.addEventListener('dragover', (e) => {
    if (!dragKey) return;
    const target = e.target.closest(dragKey.type === 'card' ? '[data-card]' : '[data-child]');
    if (!target) return;
    if (dragKey.type === 'card' && target.dataset.card === dragKey.id) return;
    if (dragKey.type === 'child') {
      if (target.dataset.child === dragKey.key) return;
      if (target.dataset.child.split('|')[0] !== dragKey.key.split('|')[0]) return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = target.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    document.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    target.classList.add(before ? 'drop-before' : 'drop-after');
  });

  box.addEventListener('drop', (e) => {
    if (!dragKey) return;
    const target = e.target.closest(dragKey.type === 'card' ? '[data-card]' : '[data-child]');
    if (!target) return;
    e.preventDefault();
    const r = target.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;

    if (dragKey.type === 'card') {
      const moved = lib.cards.find((c) => c.id === dragKey.id);
      const list = orderedCards(curDir).filter((c) => c.id !== dragKey.id);
      const idx = list.findIndex((c) => c.id === target.dataset.card);
      if (moved && idx >= 0) {
        list.splice(idx + (before ? 0 : 1), 0, moved);
        list.forEach((c, i) => { c.order = i + 1; });
        touch();
      }
    } else {
      const [cid, kid] = dragKey.key.split('|');
      const card = lib.cards.find((c) => c.id === cid);
      const arr = (card.children || []).slice();
      const from = arr.findIndex((k) => k.id === kid);
      if (from >= 0) {
        const moved = arr.splice(from, 1)[0];
        const to = arr.findIndex((k) => k.id === target.dataset.child.split('|')[1]);
        if (to >= 0) arr.splice(to + (before ? 0 : 1), 0, moved);
        else arr.push(moved);
        card.children = arr;
        card.updated = Date.now();
        touch();
      }
    }
    clearDropMarks();
    dragKey = null;
    render();
  });
}

/* ---------------- 选择 / 复制 ---------------- */
const pendingClick = new Map();   // key -> timer，用来区分单击和快速双击

function queueToggle(key, onDouble) {
  if (pendingClick.has(key)) {          // 同一个目标在 220ms 内又被点：算双击
    clearTimeout(pendingClick.get(key));
    pendingClick.delete(key);
    onDouble();
    return;
  }
  const timer = setTimeout(() => {
    pendingClick.delete(key);
    toggleSel(key);
  }, 220);
  pendingClick.set(key, timer);
}

function toggleSel(key) {
  const i = sel.indexOf(key);
  if (i >= 0) {
    sel.splice(i, 1);
  } else {
    const [cid, kid] = key.split('|');
    if (kid) {
      // 选中小卡片：把"整张大卡"的选中去掉，避免同一段内容被算两次
      const whole = sel.indexOf(cid);
      if (whole >= 0) sel.splice(whole, 1);
    } else {
      // 选中整张大卡：把它下面所有小卡片的选中去掉
      sel = sel.filter((k) => k.split('|')[0] !== cid);
    }
    sel.push(key);
  }
  renderMain();
  renderSel();
}

function bodiesOf(key) {
  const [cid, kid] = key.split('|');
  const c = lib.cards.find((x) => x.id === cid);
  if (!c) return [];
  if (!kid) return (c.children || []).map((k) => (k.body || '').trim()).filter(Boolean);
  const k = (c.children || []).find((x) => x.id === kid);
  return k && (k.body || '').trim() ? [k.body.trim()] : [];
}

function mergedText() {
  const sep = $('#sep').value.replace('\\n', '\n');
  let out = [];
  sel.forEach((key) => out.push(...bodiesOf(key)));
  if (!$('#dedup').checked) return out.join(sep);
  const seen = new Set();
  const uniq = [];
  out.forEach((b) =>
    b.split(/[,，\n]/).map((t) => t.trim()).filter(Boolean).forEach((t) => {
      const k = t.toLowerCase();
      if (!seen.has(k)) { seen.add(k); uniq.push(t); }
    })
  );
  return uniq.join(sep);
}

/* ---------------- 迷你 markdown 渲染（够用就好，不引外部库） ---------------- */
function md(src) {
  let t = String(src || '');
  t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = (x) => x
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  const out = [];
  let list = null;
  let table = [];

  const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\|?[\s:|-]+\|[\s:|-]*$/.test(r));
    if (rows.length) {
      out.push('<table>');
      rows.forEach((r, i) => {
        const cells = r.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const tag = i === 0 ? 'th' : 'td';
        out.push('<tr>' + cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('') + '</tr>');
      });
      out.push('</table>');
    }
    table = [];
  };

  String(t).split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*\|.*\|\s*$/.test(line)) { table.push(line.trim()); return; }
    flushTable();
    if (!line.trim()) { closeList(); out.push(''); return; }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList();
      const n2 = m[1].length;
      out.push(`<h${n2}>${inline(m[2])}</h${n2}>`);
      return;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); return; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + inline(m[1]) + '</li>');
      return;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + inline(m[1]) + '</li>');
      return;
    }
    closeList();
    out.push('<p>' + inline(line) + '</p>');
  });
  closeList();
  flushTable();
  return out.join('\n');
}

/* ---------------- 提示词格式化 ---------------- */
function formatPrompt(src) {
  const stats = { punct: 0, newline: 0, space: 0, comma: 0 };
  let t = String(src || '');

  // 1) 全角标点 → 半角（中文括号、顿号、全角空格都在内）
  const MAP = { '，': ',', '、': ',', '；': ';', '：': ':', '（': '(', '）': ')', '【': '[', '】': ']', '　': ' ' };
  t = t.replace(/[，、；：（）【】　]/g, (c) => { stats.punct++; return MAP[c]; });

  // 2) 换行 / 制表符 → 逗号分隔
  t = t.replace(/[\r\n\t]+/g, () => { stats.newline++; return ', '; });

  // 3) 按逗号切段，逐段 trim，丢空段（顺带处理重复逗号和首尾逗号）
  const parts = t.split(',');
  const kept = [];
  parts.forEach((p) => {
    let x = p.replace(/\s+/g, ' ').trim();
    if (x !== p.trim().replace(/\s+/g, ' ')) stats.space++;
    if (!x) { if (p.trim() !== '' || kept.length) stats.comma++; return; }
    kept.push(x);
  });
  const before = parts.length;
  const after = kept.length;
  if (before !== after) stats.comma += before - after;

  return { text: kept.join(', '), stats };
}

/* ---------------- 预览 ---------------- */
let pvState = null;

function openPreview(cardId, childId) {
  const card = lib.cards.find((x) => x.id === cardId);
  if (!card) return;
  let title, raw, html;

  if (childId) {
    const k = (card.children || []).find((x) => x.id === childId);
    if (!k) return;
    title = (card.title || '') + ' · ' + (k.title || t('正文'));
    raw = k.body || '';
    html = imgsOf(k).map((u) => `<img class="pv-img" src="${esc(u)}" alt="">`).join('') + md(raw);
  } else {
    const kids = card.children || [];
    title = card.title || t('(无标题)');
    raw = kids.map((k) => (k.body || '')).filter(Boolean).join('\n\n');
    html = kids.length
      ? kids.map((k) => `<h3>${esc(k.title || t('正文'))}</h3>` +
          imgsOf(k).map((u) => `<img class="pv-img" src="${esc(u)}" alt="">`).join('') +
          md(k.body || '')).join('<hr class="pv-sep">')
      : `<p class="pv-empty">${t('这张卡还没有提示词。')}</p>`;
  }

  pvState = { cardId, childId, raw };
  $('#pv-title').textContent = title;
  $('#pv-body').innerHTML = html;
  $('#pv-body').scrollTop = 0;
  $('#modal-preview').hidden = false;
}

function closePreview() { $('#modal-preview').hidden = true; pvState = null; }

/* ---------------- 小卡片编辑 ---------------- */
function openChild(cardId, childId) {
  const card = lib.cards.find((x) => x.id === cardId);
  if (!card) return;
  editingChild = { cardId, childId: childId || null };
  const k = childId ? card.children.find((x) => x.id === childId) : null;
  $('#ed-title').placeholder = t('标题（可留空），例如：提示词 / 备忘');
  $('#ed-title').value = k ? k.title || '' : '';
  $('#ed-body').value = k ? k.body || '' : '';
  setThumbs(imgsOf(k));
  $('#ed-del').style.display = childId ? '' : 'none';
  const fbtn = $('#ed-format');
  if (fbtn) { fbtn.dataset.undo = ''; fbtn.dataset.before = ''; fbtn.dataset.selpos = ''; fbtn.textContent = t('格式化'); }
  $('#ed-del').dataset.draft = '';
  $('#modal').hidden = false;
  updateSaveState();
  setTimeout(() => (k ? $('#ed-body') : $('#ed-title')).focus(), 30);
}

/* ---------------- 多图 ---------------- */
let edImgs = [];

function imgsOf(k) {
  if (!k) return [];
  if (Array.isArray(k.imgs)) return k.imgs.filter(Boolean);
  return k.img ? [k.img] : [];
}

function setThumbs(list) {
  edImgs = (list || []).filter(Boolean).slice();
  const box = $('#ed-imgs');
  if (!edImgs.length) { box.hidden = true; box.innerHTML = ''; updateSaveState(); return; }
  box.innerHTML = edImgs.map((u, i) =>
    `<div class="imgcell"><img src="${esc(u)}" alt="" loading="lazy">
       <button class="icon rm" data-rm-img="${i}" title="${t('移除图片')}">✕</button>
     </div>`).join('');
  box.hidden = false;
  updateSaveState();
}

function edHasContent() {
  return !!($('#ed-title').value.trim() || $('#ed-body').value.trim() || edImgs.length);
}

function updateSaveState() {
  const btn = $('#ed-save');
  if (!btn) return;
  btn.disabled = !edHasContent();
}

function closeChild() { $('#modal').hidden = true; editingChild = null; }

function saveChild() {
  if (!editingChild) return;
  const title = $('#ed-title').value.trim();
  const body = $('#ed-body').value;
  const imgs = edImgs.slice();
  if (!title && !body.trim() && !imgs.length) {
    toast('标题、正文、图片至少要有一项', true);
    return;                                   // 不关窗，让用户继续填或点取消
  }

  let card = editingChild.cardId ? lib.cards.find((x) => x.id === editingChild.cardId) : null;
  if (!card) {
    card = {
      id: uid('g_'),
      path: editingChild.path || '',
      dir: '',
      title: editingChild.path ? stemOf(editingChild.path) : '新大卡片',
      w: '',
      children: [],
      updated: Date.now(),
    };
    adoptFileState(card.path, card);
    lib.cards.push(card);
    card.order = nextOrder(curDir);
    editingChild = { cardId: card.id, childId: null };
  }
  if (editingChild.childId) {
    const k = card.children.find((x) => x.id === editingChild.childId);
    if (k) Object.assign(k, { title, body, imgs });
    else card.children.push({ id: uid('k_'), title, body, imgs, tags: [] });
  } else {
    card.children.push({ id: uid('k_'), title, body, imgs, tags: [] });
  }
  card.updated = Date.now();
  touch(); closeChild(); render();
}

async function uploadImages(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (!list.length) return;
  let ok = 0;
  for (const file of list) {
    const name = file.name && file.name !== 'image.png' ? file.name : 'paste.png';
    const r = await fetch('/api/image?name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!r.ok) { toast('图片上传失败', true); continue; }
    const d = await r.json();
    edImgs.push(d.url); ok++;
  }
  setThumbs(edImgs);
  if (ok) toast(t('已加入 ') + ok + t(' 张图（保存后生效）'));
}

/* ---------------- 大卡片编辑 / 移动 ---------------- */
function fillFolderSelect(el, want) {
  el.innerHTML = ['<option value="">根目录</option>']
    .concat(tree.dirs.slice().sort((a, b) => a.rel.localeCompare(b.rel, 'zh')).map((d) => `<option value="${esc(d.rel)}">${esc(d.rel)}</option>`))
    .join('');
  el.value = tree.dirs.some((d) => d.rel === want) ? want : '';
}

function openCard(cardId) {
  editingCard = cardId ? { cardId } : { cardId: null, path: '', draftTitle: '' };
  const c = cardId ? lib.cards.find((x) => x.id === cardId) : null;
  $('#cd-title').value = c ? c.title || '' : '';
  $('#cd-w').value = c ? c.w || '' : '';
  $('#cd-del').style.display = cardId ? '' : 'none';
  $('#cd-tip').textContent = c && c.path
    ? '换文件夹会把 LoRA 文件真的挪过去（旧工作流里存的路径会失效，挪完要重启 ComfyUI）。'
    : '这张卡没绑定 LoRA 文件，换文件夹只是换个位置放卡片。';
  fillFolderSelect($('#cd-folder'), c ? (c.path ? parentOf(c.path) : c.dir || '') : (curDir === HIDDEN ? '' : curDir));
  $('#modal-card').hidden = false;
  setTimeout(() => $('#cd-title').focus(), 30);
}

function closeCard() { $('#modal-card').hidden = true; editingCard = null; }

async function moveFile(from, toDir) {
  const d = await postJson('/api/move', { from, to: toDir });
  return d;
}

async function saveCard() {
  if (!editingCard) return;
  const title = $('#cd-title').value.trim();
  const folder = $('#cd-folder').value;

  if (editingCard.cardId) {
    const c = lib.cards.find((x) => x.id === editingCard.cardId);
    const oldDir = c.path ? parentOf(c.path) : (c.dir || '');
    c.title = title || c.title;
    c.w = ($('#cd-w').value || '').trim();
    if (oldDir !== folder) {
      if (c.path) {
        try {
          const d = await moveFile(c.path, folder);
          lastMove = { from: d.from, to: d.to };
          c.path = d.to;
        } catch (e) { return toast(e.message, true); }
      } else {
        lastMove = { kind: 'dir', cardId: c.id, fromDir: oldDir };
        c.dir = folder;
      }
    }
    c.updated = Date.now();
    try { await loadTree(); } catch { }
  } else {
    const boundPath = editingCard.path || '';
    const c = {
      id: uid('g_'),
      path: boundPath,
      dir: boundPath ? '' : folder,
      title: title || (boundPath ? stemOf(boundPath) : '新卡片'),
      w: ($('#cd-w').value || '').trim(),
      children: [],
      updated: Date.now(),
    };
    lib.cards.push(c);
    c.order = nextOrder(curDir);
  }
  touch(); closeCard(); render();
}

/* 为一个还没卡的 LoRA 直接建一张空的大卡片（不写内容） */
function createEmptyCard(rel) {
  const exist = cardByPath(rel);
  if (exist) return openCard(exist.id);
  const c = {
    id: uid('g_'),
    path: rel,
    dir: '',
    title: stemOf(rel),
    w: '',
    children: [],
    order: nextOrder(curDir),
    updated: Date.now(),
  };
  adoptFileState(rel, c);
  lib.cards.push(c);
  touch();
  render();
  toast(t('已创建 ') + (c.title || ''));
}

function claimFile(rel) {
  // 已经有卡：直接加一条
  const exist = cardByPath(rel);
  if (exist) return openChild(exist.id, null);

  // 还没建卡：直接写第一条提示词，保存时才连带建出 LoRA 大卡；取消则什么都不留
  editingChild = { cardId: null, path: rel, childId: null };
  $('#ed-title').placeholder = '给「' + stemOf(rel) + '」写一条（标题可留空）';
  $('#ed-title').value = '';
  $('#ed-body').value = '';
  setThumbs([]);
  $('#ed-del').style.display = 'none';
  $('#modal').hidden = false;
  setTimeout(() => $('#ed-body').focus(), 30);
}


/* ---------------- 批量移动 ---------------- */
function openMove() {
  const ids = [...new Set(sel.map((k) => k.split('|')[0]))];
  if (!ids.length) return;
  $('#mv-head').innerHTML = t('把选中的 ') + '<b>' + ids.length + '</b>' + t('项移到');
  fillFolderSelect($('#mv-folder'), '');
  $('#modal-move').hidden = false;
  $('#modal-move').dataset.ids = ids.join(',');
}

async function doMove() {
  const ids = ($('#modal-move').dataset.ids || '').split(',').filter(Boolean);
  const folder = $('#mv-folder').value;
  let ok = 0, fail = 0;
  for (const id of ids) {
    const c = lib.cards.find((x) => x.id === id);
    if (!c) continue;
    if (!c.path) {
      lastMove = { kind: 'dir', cardId: c.id, fromDir: c.dir || '' };
      c.dir = folder; ok++; continue;
    }
    if (parentOf(c.path) === folder) { ok++; continue; }
    try {
      const d = await moveFile(c.path, folder);
      lastMove = { from: d.from, to: d.to };
      c.path = d.to;
      ok++;
    } catch { fail++; }
  }
  touch();
  $('#modal-move').hidden = true;
  sel = [];
  try { await loadTree(); } catch { }   // 文件真的挪了位置，目录树必须跟着刷新
  render();
  toast(fail ? `${ok} ok / ${fail} failed` : t('已移动 ') + ok + t(' 项'), fail > 0);
}

/* ---------------- 事件 ---------------- */
function bind() {
  $('#search').addEventListener('input', renderMain);

  let rz = null;
  window.addEventListener('resize', () => {
    updateScrollBtns();
    clearTimeout(rz);
    rz = setTimeout(() => { renderMain(); updateScrollBtns(); }, 180);
  });

  // Alt+← / Alt+→ 也能前进后退
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); navBack(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); navForward(); }
  });

  const goDir = (dir) => {
    if (dir !== curDir) history.pushState({ dir }, '', '?dir=' + encodeURIComponent(dir));
    expandPath(dir);
    curDir = dir;
    sel = [];
    $('#search').value = '';        // 点分类/文件夹/面包屑 = 退出搜索
    render();
    scrollTop();
  };

  $('#cats').addEventListener('click', (e) => {
    const tw = e.target.closest('[data-tw]');
    if (tw) { e.stopPropagation(); toggleExpand(tw.dataset.tw); return; }   // 三角只折叠，不导航
    const r = e.target.closest('[data-dir]');
    if (r) goDir(r.dataset.dir);
  });
  $('#folders').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) goDir(t.dataset.dir); });
  $('#crumb').addEventListener('click', (e) => { const a = e.target.closest('[data-dir]'); if (a) { e.preventDefault(); goDir(a.dataset.dir); } });

  /* 右键菜单 */
  $('#cards').addEventListener('contextmenu', (e) => {
    const child = e.target.closest('[data-child]');
    if (child) {
      const [cid, kid] = child.dataset.child.split('|');
      return showMenu(e, [
        { label: t('预览'), run: () => openPreview(cid, kid) },
        { label: t('复制这一条'), run: () => copyText(bodiesOf(child.dataset.child).join('\n')) },
        { label: t('编辑'), run: () => openChild(cid, kid) },
        { sep: true },
        { label: t('删除这一条'), danger: true, run: () => { const c = lib.cards.find((x) => x.id === cid); c.children = c.children.filter((x) => x.id !== kid); touch(); render(); } },
      ]);
    }
    const card = e.target.closest('[data-card]');
    if (card) {
      const c = lib.cards.find((x) => x.id === card.dataset.card);
      if (!c) return;
      // 顺序：新建 -> 查看/编辑 -> 文件操作 -> 删除，和空卡片的菜单对齐
      return showMenu(e, [
        { label: t('新建小卡片'), run: () => openChild(c.id, null) },
        { sep: true },
        { label: t('预览'), run: () => openPreview(c.id, null) },
        { label: t('编辑大卡片'), run: () => openCard(c.id) },
        { label: t('复制全部提示词'), run: () => copyText(bodiesOf(c.id).join(', ')) },
        { sep: true },
        { label: t('移动到…'), run: () => { sel = [c.id]; renderSel(); openMove(); } },
        { label: t('重命名 LoRA 文件…'), show: !!c.path, run: () => renamePath(c.path) },
        { label: t('隐藏这个 LoRA'), show: !!c.path, run: () => hidePath(c.path) },
        { label: t('在资源管理器中显示'), show: !!c.path, run: () => revealPath(c.path) },
        { label: t('在 Civitai 打开'), show: !!(c.path && civState(c.path, c).civitai), run: () => openCivitai(c.path, c) },
        { label: t('刷新 Civitai 信息'), show: !!c.path, run: () => rematchOne(c, null) },
        { label: t('删除 LoRA 文件…'), danger: true, show: !!c.path, run: () => deleteLoraFile(c.path) },
        { sep: true, show: !!c.path },
        { label: t('删除大卡片'), danger: true, run: () => { lib.cards = lib.cards.filter((x) => x.id !== c.id); sel = sel.filter((k) => k.split('|')[0] !== c.id); touch(); render(); } },
        { sep: true, show: !!lastMove },
        { label: t('撤销移动'), show: !!lastMove, run: () => undoMove() },
      ]);
    }
    const ghost = e.target.closest('.card.ghost[data-path]');
    if (ghost) {
      const rel = ghost.dataset.path;
      // 和"有卡片"的右键保持一致的说法与顺序
      return showMenu(e, [
        { label: t('取消隐藏'), show: isHidden(rel), run: () => unhidePath(rel) },
        { label: t('新建小卡片'), show: !isHidden(rel), run: () => claimFile(rel) },
        { label: t('新建大卡片'), show: !isHidden(rel), run: () => createEmptyCard(rel) },
        { sep: true, show: !isHidden(rel) },
        { label: t('重命名 LoRA 文件…'), run: () => renamePath(rel) },
        { label: t('隐藏这个 LoRA'), show: !isHidden(rel), run: () => hidePath(rel) },
        { label: t('在资源管理器中显示'), run: () => revealPath(rel) },
        { label: t('在 Civitai 打开'), show: !!civState(rel, cardByPath(rel)).civitai, run: () => openCivitai(rel, cardByPath(rel)) },
        { label: t('刷新 Civitai 信息'), run: () => rematchOne(null, rel) },
        { sep: true },
        { label: t('删除 LoRA 文件…'), danger: true, run: () => deleteLoraFile(rel) },
      ]);
    }
    // 没命中卡片：不处理，冒泡给空白菜单
  });

  $('#folders').addEventListener('contextmenu', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    const rel = t.dataset.dir;
    showMenu(e, [
      { label: t('打开'), run: () => goDir(rel) },
      { sep: true },
      { label: t('重命名文件夹…'), run: () => renamePath(rel) },
      { label: t('新建子文件夹…'), run: () => { curDir = rel; newFolder(); } },
      { label: t('导入 LoRA 到这里…'), run: () => importLora(rel) },
      { label: t('删除文件夹'), danger: true, run: () => deleteFolder(rel) },
      { sep: true },
      { label: t('在资源管理器中显示'), run: () => revealPath(rel) },
    ]);
  });

  $('#cats').addEventListener('contextmenu', (e) => {
    const r = e.target.closest('[data-dir]');
    if (!r || r.dataset.dir === '' || r.dataset.dir === HIDDEN) return;
    const rel = r.dataset.dir;
    showMenu(e, [
      { label: t('重命名文件夹…'), run: () => renamePath(rel) },
      { label: t('删除文件夹'), danger: true, run: () => deleteFolder(rel) },
      { label: t('在资源管理器中显示'), run: () => revealPath(rel) },
    ]);
  });

  $('#scroller').addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    showMenu(e, [
      { label: t('新建大卡片'), run: () => openCard(null) },
      { label: t('新建文件夹…'), run: () => newFolder() },
      { label: t('导入 LoRA 文件…'), run: () => importLora(curDir) },
      { sep: true },
      { label: t('按规则排序（有提示词的在前）'), run: () => autoSort() },
      { sep: true },
      { label: t('撤销移动'), show: !!lastMove, run: () => undoMove() },
      { sep: true, show: !!lastMove },
      { label: t('刷新这个目录'), run: async () => { await loadTree(); render(); toast(t('已刷新')); } },
      { label: t('在资源管理器中打开'), run: () => revealPath(curDir) },
    ]);
  });

  bindDrag();
  bindMoveDrop();

  $('#pv-close').addEventListener('click', closePreview);
  $('#pv-copy').addEventListener('click', () => {
    if (pvState) copyText(pvState.raw || '');
  });
  $('#pv-edit').addEventListener('click', () => {
    if (!pvState) return;
    const st = pvState;
    closePreview();
    if (st.childId) openChild(st.cardId, st.childId);
    else openCard(st.cardId);
  });

  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('.mi');
    if (!b) return;
    const it = $('#menu')._items[+b.dataset.i];
    hideMenu();
    if (it && it.run) it.run();
  });

  document.addEventListener('click', (e) => { if (!e.target.closest('#menu')) hideMenu(); });
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('#menu')) hideMenu(); });
  $('#scroller').addEventListener('scroll', hideMenu, { passive: true });

  /* 卡片区点击 */
  $('#cards').addEventListener('click', (e) => {
    const t = e.target;

    const unhide = t.closest('[data-unhide]');
    if (unhide) { e.stopPropagation(); return unhidePath(unhide.dataset.unhide); }

    const claim = t.closest('[data-claim]');
    if (claim) { e.stopPropagation(); return claimFile(claim.dataset.claim); }

    const keyOf = (el) => {
      const k = el.dataset.civOpen || el.dataset.civRefresh || '';
      const i = k.indexOf(':');
      return { kind: k.slice(0, i), val: k.slice(i + 1) };
    };
    const openEl = t.closest('[data-civ-open]');
    if (openEl) {
      e.stopPropagation();
      const { kind, val } = keyOf(openEl);
      const card = kind === 'c' ? lib.cards.find((x) => x.id === val) : cardByPath(val);
      const url = civState(kind === 'c' ? (card && card.path) || '' : val, card).civitai;
      if (url) openUrl(url);
      return;
    }
    const refEl = t.closest('[data-civ-refresh]');
    if (refEl) {
      e.stopPropagation();
      const { kind, val } = keyOf(refEl);
      rematchOne(kind === 'c' ? lib.cards.find((x) => x.id === val) : null,
                 kind === 'f' ? val : null);
      return;
    }

    const addChild = t.closest('[data-add-child]');
    if (addChild) { e.stopPropagation(); return openChild(addChild.dataset.addChild, null); }

    const editCard = t.closest('[data-edit-card]');
    if (editCard) { e.stopPropagation(); return openCard(editCard.dataset.editCard); }

    const editChild = t.closest('[data-edit-child]');
    if (editChild) { const [cid, kid] = editChild.dataset.editChild.split('|'); return openChild(cid, kid); }

    const copyChild = t.closest('[data-copy-child]');
    if (copyChild) return copyText(bodiesOf(copyChild.dataset.copyChild).join('\n'));

    const child = t.closest('[data-child]');
    if (child) {
      const key = child.dataset.child;
      return queueToggle(key, () => openPreview(key.split('|')[0], key.split('|')[1]));
    }

    const whole = t.closest('[data-whole]');
    if (whole) {
      const id = whole.dataset.whole;
      return queueToggle(id, () => openPreview(id, null));
    }
  });

  /* 顶部按钮 */
  $('#btn-theme').addEventListener('click', cycleTheme);

  $('#btn-lang').addEventListener('click', () => {
    setLang(LANG === 'en' ? 'zh' : 'en');
    $('#btn-lang').textContent = LANG === 'en' ? 'EN' : '中';
    applyTheme(themeMode());
    render();
  });

  if (mql) {
    const onScheme = () => { if (themeMode() === 'auto') applyTheme('auto'); };
    if (mql.addEventListener) mql.addEventListener('change', onScheme);
    else if (mql.addListener) mql.addListener(onScheme);
  }


  $('#btn-undo').addEventListener('click', () => undoMove());

  $('#btn-top').addEventListener('click', () => $('#scroller').scrollTo({ top: 0, behavior: 'smooth' }));
  $('#btn-bottom').addEventListener('click', () => {
    const sc = $('#scroller');
    sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
  });
  $('#scroller').addEventListener('scroll', updateScrollBtns, { passive: true });
  if (window.ResizeObserver) {
    new ResizeObserver(() => updateScrollBtns()).observe($('#scroller'));
  }

  /* 鼠标在可横滚的图片区上时，滚轮转成横向滚动 */
  document.addEventListener('wheel', (e) => {
    const box = e.target.closest('.cimgs, #ed-imgs');
    if (!box || box.scrollWidth <= box.clientWidth + 1) return;
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (!d) return;
    const max = box.scrollWidth - box.clientWidth;
    const next = Math.max(0, Math.min(max, box.scrollLeft + d));
    if (next === box.scrollLeft) return;     // 到头了，把滚动还给页面
    e.preventDefault();
    box.scrollLeft = next;
  }, { passive: false });

  /* 侧栏宽度拖动 */
  const SIDE_KEY = 'lora.sideW';
  let sideW = parseInt(localStorage.getItem(SIDE_KEY) || '172', 10);
  if (!(sideW >= 140 && sideW <= 460)) sideW = 172;
  $('#cats').style.width = sideW + 'px';
  const grip = $('#sidegrip');
  if (grip) {
    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = $('#cats').getBoundingClientRect().width;
      const move = (ev) => {
        const w = Math.max(140, Math.min(460, startW + ev.clientX - startX));
        sideW = Math.round(w);
        $('#cats').style.width = sideW + 'px';
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        localStorage.setItem(SIDE_KEY, String(sideW));
        renderMain();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  $('#btn-match').addEventListener('click', matchAll);

  $('#btn-root').addEventListener('click', async () => {
    const cur = lib.root || tree.root;
    const p = prompt('LoRA 根目录（改完会重新扫描）：', cur);
    if (!p || !p.trim() || p.trim() === cur) return;
    lib.root = p.trim();
    await save();
    try { await loadTree(); curDir = ''; render(); toast(t('根目录已切换')); }
    catch (e) { toast(e.message, true); }
  });

  $('#btn-reveal').addEventListener('click', () => fetch('/api/reveal', { method: 'POST' }).catch(() => {}));

  $('#btn-merge').addEventListener('click', () => {
    const t = mergedText();
    if (!t) return toast('选中的没有正文', true);
    copyText(t);
    // 复制完清空选择并退出选中态，方便直接选下一批
    sel = [];
    renderMain();
    renderSel();
  });
  $('#btn-move').addEventListener('click', openMove);
  $('#btn-clearsel').addEventListener('click', () => { sel = []; renderMain(); renderSel(); });

  /* 拖放 */
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    if (anyModalOpen()) { e.preventDefault(); return; }   // 编辑界面里拖图，别弹遮罩
    dragDepth++;
    $('#dropmask').hidden = false;
    $('#dropdir').textContent = dirLabel(dropTargetDir(e));
  });
  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (anyModalOpen()) {                       // 只给"可放下"的光标，不显示目录提示
      $('#modal').classList.toggle('dropping', !$('#modal').hidden);
      return;
    }
    $('#dropdir').textContent = dirLabel(dropTargetDir(e));
    document.querySelectorAll('.tile.drop').forEach((x) => x.classList.remove('drop'));
    const tile = e.target.closest && e.target.closest('.tile');
    if (tile) tile.classList.add('drop');
  });
  document.addEventListener('dragleave', (e) => {
    if (anyModalOpen() && !e.relatedTarget) $('#modal').classList.remove('dropping');
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      $('#dropmask').hidden = true;
      document.querySelectorAll('.tile.drop').forEach((x) => x.classList.remove('drop'));
    }
  });
  document.addEventListener('drop', async (e) => {
    dragDepth = 0;
    $('#dropmask').hidden = true;
    document.querySelectorAll('.tile.drop').forEach((x) => x.classList.remove('drop'));
    $('#modal').classList.remove('dropping');
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();

    const files = Array.from(e.dataTransfer.files);

    // 编辑界面开着：拖进来的是图片就设为配图，不是图片就不当成导入 LoRA
    if (anyModalOpen()) {
      const img = files.find((f) => (f.type || '').startsWith('image/'));
      if (img && !$('#modal').hidden) return uploadImages([img]);
      if (img) return toast(t('这张卡片不放图片，图片请加在小卡片上'), true);
      return toast(t('编辑界面里只能拖图片进来；导入 LoRA 请在卡片区拖放'), true);
    }

    const dir = dropTargetDir(e);
    await uploadFiles(files, dir);
  });

  /* 小卡片编辑 */
  $('#ed-close').addEventListener('click', closeChild);
  $('#ed-save').addEventListener('click', saveChild);
  $('#ed-del').addEventListener('click', () => {
    if (!editingChild || !editingChild.childId) return closeChild();
    if (!confirm(t('删除这一条？'))) return;
    const c = lib.cards.find((x) => x.id === editingChild.cardId);
    c.children = c.children.filter((x) => x.id !== editingChild.childId);
    sel = sel.filter((k) => k !== editingChild.cardId + '|' + editingChild.childId);
    touch(); closeChild(); render();
  });
  $('#ed-copy').addEventListener('click', () => copyText($('#ed-body').value));

  $('#ed-format').addEventListener('click', () => {
    const ta = $('#ed-body');
    const btn = $('#ed-format');

    if (btn.dataset.undo === '1') {           // 再点一次 = 撤销
      ta.value = btn.dataset.before || '';
      try {
        const pos = JSON.parse(btn.dataset.selpos || 'null');
        if (pos) ta.setSelectionRange(pos[0], pos[1]);
      } catch (_) {}
      btn.dataset.undo = '';
      btn.dataset.before = '';
      btn.dataset.selpos = '';
      btn.textContent = '格式化';
      toast(t('已撤销'));
      return;
    }

    // 有选区就只格式化选区（比如一段纯标签，绕开旁边的说明文字）
    const s0 = ta.selectionStart;
    const s1 = ta.selectionEnd;
    const picked = s1 > s0 ? ta.value.slice(s0, s1) : '';
    const partial = !!picked.trim();

    const src = partial ? picked : ta.value;
    const res = formatPrompt(src);

    if (partial) {
      if (res.text === picked) return toast(t('选中的这段已经规整了'));
      const nv = ta.value.slice(0, s0) + res.text + ta.value.slice(s1);
      btn.dataset.before = ta.value;
      btn.dataset.selpos = JSON.stringify([s0, s1]);
      btn.dataset.undo = '1';
      btn.textContent = '撤销';
      ta.value = nv;
      ta.focus();
      ta.setSelectionRange(s0, s0 + res.text.length);
    } else {
      if (res.text === ta.value) return toast(t('已经是规整的了'));
      btn.dataset.before = ta.value;
      btn.dataset.selpos = '';
      btn.dataset.undo = '1';
      btn.textContent = '撤销';
      ta.value = res.text;
    }

    const bits = [];
    if (res.stats.punct) bits.push(t('全角标点 ') + res.stats.punct);
    if (res.stats.newline) bits.push(t('换行 ') + res.stats.newline);
    if (res.stats.space) bits.push(t('多余空格 ') + res.stats.space);
    if (res.stats.comma) bits.push(t('逗号 ') + res.stats.comma);
    const head = partial ? t('已格式化选中 ') + picked.length + t(' 字符：') : t('已格式化：');
    toast(head + (bits.join(' · ') || t('微调')));
  });

  $('#ed-body').addEventListener('input', () => {
    const btn = $('#ed-format');
    if (btn.dataset.undo === '1') { btn.dataset.undo = ''; btn.textContent = '格式化'; }
  });
  $('#ed-img').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', (e) => { uploadImages(e.target.files); e.target.value = ''; });
  $('#file-lora').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) await uploadFiles(files, importDir);
  });
  $('#ed-title').addEventListener('input', updateSaveState);
  $('#ed-body').addEventListener('input', updateSaveState);

  $('#ed-imgs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm-img]');
    if (!b) return;
    const i = Number(b.dataset.rmImg);
    if (Number.isFinite(i)) { edImgs.splice(i, 1); setThumbs(edImgs); }
  });
  $('#ed-body').addEventListener('paste', (e) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); uploadImages([item.getAsFile()]); }
  });
  $('#ed-body').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    saveChild();                       // 回车 = 保存；Shift+回车 = 换行
  });
  $('#ed-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#ed-body').focus(); }
  });
  $('#cd-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveCard(); }
  });

  /* 大卡片编辑 */
  $('#cd-close').addEventListener('click', closeCard);
  $('#cd-save').addEventListener('click', saveCard);
  $('#cd-del').addEventListener('click', () => {
    if (!editingCard || !editingCard.cardId) return closeCard();
    if (!confirm(t('删除这张卡？里面的提示词会一起删掉（磁盘上的 LoRA 文件不动）。'))) return;
    lib.cards = lib.cards.filter((x) => x.id !== editingCard.cardId);
    sel = sel.filter((k) => k.split('|')[0] !== editingCard.cardId);
    touch(); closeCard(); render();
  });

  /* 批量移动 */
  $('#mv-close').addEventListener('click', () => ($('#modal-move').hidden = true));
  $('#mv-ok').addEventListener('click', doMove);

  $('#modal-preview').addEventListener('mousedown', (e) => {
    if (e.target.classList && e.target.classList.contains('modal')) e.preventDefault();
  });

  // 点背景不再关闭：编辑时很容易手滑点到框外，一关内容就没了。只用 ✕ / Esc 关闭。

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#modal-preview').hidden) return closePreview();
      if (!$('#menu').hidden) return hideMenu();
      if (!$('#modal').hidden) return closeChild();
      if (!$('#modal-card').hidden) return closeCard();
      if (!$('#modal-move').hidden) return ($('#modal-move').hidden = true);
      if (sel.length) { sel = []; renderMain(); renderSel(); return; }
      if ($('#search').value) { $('#search').value = ''; renderMain(); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      if (!$('#modal').hidden) { e.preventDefault(); saveChild(); }
      else if (!$('#modal-card').hidden) { e.preventDefault(); saveCard(); }
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (saveTimer) { save(); e.preventDefault(); e.returnValue = ''; }
  });
}

/* ---------------- 启动 ---------------- */
(async function boot() {
  const usp = new URLSearchParams(location.search);
  const qlang = usp.get('lang');
  if (qlang === 'en' || qlang === 'zh') setLang(qlang);
  applyStaticI18n();
  const langBtn = $('#btn-lang');
  if (langBtn) langBtn.textContent = LANG === 'en' ? 'EN' : '中';
  const qp = usp.get('theme');
  if (qp && THEME_ORDER.includes(qp)) localStorage.setItem(THEME_KEY, qp);
  applyTheme(themeMode());
  try { await loadLib(); }
  catch (e) {
    document.body.innerHTML = '<div style="padding:40px;color:#e88">读取数据失败：' + esc(e.message) + '</div>';
    return;
  }
  try { await loadTree(); }
  catch (e) {
    tree = { root: '', dirs: [], files: [] };
    toast(e.message, true);
    $('#empty').textContent = t('还没有设置 LoRA 目录 —— 点顶栏「⚙ 根目录」选一个 ComfyUI 的 models\\loras。');
    $('#empty').hidden = false;
  }
  if (!lib.root) lib.root = tree.root;
  const qpv = usp.get('preview');   // 调试用：?preview=卡片标题 直接开预览
  if (qpv) {
    const hit = lib.cards.find((c) => (c.title || '') === qpv);
    if (hit) setTimeout(() => openPreview(hit.id, null), 250);
  }
  const qsel = usp.get('q');          // 调试/收藏用：?q=关键词 直接带搜索
  if (qsel) $('#search').value = qsel;
  const qdir = usp.get('dir');
  if (qdir && (qdir === HIDDEN || tree.dirs.some((d) => d.rel === qdir))) curDir = qdir;

  bind();
  migrate();
  normalize();
  expandPath(curDir);
  render();
  history.replaceState({ dir: curDir }, '', '?dir=' + encodeURIComponent(curDir));
  scrollTop();
  if (lib.savedAt) $('#saved').textContent = t('已保存 ') + lib.savedAt.slice(11, 19);
})();
