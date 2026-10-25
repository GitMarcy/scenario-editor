const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let doc = null;
let saveTimer = null;
let dirty = false;
let previewMode = localStorage.getItem('previewMode') || 'half';
let showGrid = localStorage.getItem('showGrid') !== '0';
let menuTarget = null;

const fields = {
  subtitle: $('#cover-subtitle'),
  title: $('#cover-title'),
  author: $('#cover-author'),
  back: $('#back-text'),
};
const panelsEl = $('.panels'); // 編集画面のスクロールする部分

// ---------- 共通 ----------

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function formatDate(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function showView(name) {
  $('#view-list').hidden = name !== 'list';
  $('#view-edit').hidden = name !== 'edit';
}

// ---------- 保存 ----------

function scheduleSave() {
  if (!restoring) scheduleHistory();
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 800);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!doc || !dirty) return;
  dirty = false;
  doc.updatedAt = Date.now();
  try {
    await putScript(doc);
  } catch (e) {
    dirty = true;
    toast('保存に失敗しました：' + e.message, 4000);
  }
}

document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
window.addEventListener('pagehide', flush);

// ---------- 作品一覧 ----------

async function showList() {
  await flush();
  doc = null;
  localStorage.removeItem('lastOpened');
  const scripts = await listScripts();
  const ul = $('#script-list');
  ul.replaceChildren(...scripts.map(s => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="open"><span class="t">${escapeHtml(s.cover.title || '無題')}</span>
      <span class="d">${formatDate(s.updatedAt)}　${escapeHtml(s.cover.author || '')}</span></button>
      <button class="more" aria-label="メニュー">…</button>`;
    li.querySelector('.open').onclick = () => openScript(s.id);
    li.querySelector('.more').onclick = () => {
      menuTarget = s;
      $('#item-dialog-title').textContent = s.cover.title || '無題';
      $('#item-dialog').showModal();
    };
    return li;
  }));
  $('#list-empty').hidden = scripts.length > 0;
  showView('list');
}

$('#btn-new').onclick = async () => {
  const d = newScript();
  await putScript(d);
  openScript(d.id, 'cover');
};

$('#import-file').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const d = normalizeImported(JSON.parse(await file.text()));
    await putScript(d);
    toast('読み込みました');
    showList();
  } catch {
    toast('読み込めませんでした（.json のバックアップを選んでください）', 4000);
  }
};

$('#item-dialog').addEventListener('click', async e => {
  const action = e.target.dataset.item;
  if (!action) return;
  $('#item-dialog').close();
  const s = menuTarget;
  if (action === 'duplicate') {
    await putScript({ ...structuredClone(s), id: newId(), updatedAt: Date.now(),
      cover: { ...s.cover, title: (s.cover.title || '無題') + '（コピー）' } });
    showList();
  } else if (action === 'backup') {
    exportBackup(s);
  } else if (action === 'delete') {
    if (confirm(`「${s.cover.title || '無題'}」を削除しますか？元に戻せません。`)) {
      await deleteScript(s.id);
      showList();
    }
  }
});

// ---------- 編集 ----------

async function openScript(id, tab) {
  const d = await getScript(id);
  if (!d) return showList();
  doc = d;
  dirty = false;
  if (!Array.isArray(doc.blocks)) {
    doc.blocks = normalizeBlocks(doc);
    delete doc.body;
    scheduleSave();
  }
  if (!Array.isArray(doc.characters)) {
    doc.characters = normalizeCharacters(doc.characters);
    scheduleSave();
  }
  // 以前に作ったまま何も書いていない作品も、柱から書きはじめられるようにする
  if (isBlankBody(doc.blocks)) doc.blocks = firstBlocks();
  localStorage.setItem('lastOpened', id);
  cur = 0;
  fillEditor();
  resetHistory();
  showView('edit');
  switchTab(tab || localStorage.getItem('tab') || 'body');
}

function fillEditor() {
  fields.subtitle.value = doc.cover.subtitle;
  fields.title.value = doc.cover.title;
  fields.author.value = doc.cover.author;
  renderCharacters();
  fields.back.value = doc.backCover.text;
  updateTitle();
  renderBlocks();
  updateToolbar();
  updateChips();
}

function updateTitle() {
  $('#edit-title').textContent = doc.cover.title || '無題';
  fields.back.placeholder = doc.cover.author || '';
}

$('#btn-back').onclick = showList;

function switchTab(name) {
  localStorage.setItem('tab', name);
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $$('.panel').forEach(p => { p.hidden = p.dataset.panel !== name; });
  if (name === 'preview') renderPreview();
  setSelecting(false);
  panelsEl.scrollTop = 0;
}

$$('.tabs button').forEach(b => { b.onclick = () => switchTab(b.dataset.tab); });

fields.subtitle.oninput = () => { doc.cover.subtitle = fields.subtitle.value; scheduleSave(); };
fields.title.oninput = () => { doc.cover.title = fields.title.value; updateTitle(); scheduleSave(); };
fields.author.oninput = () => { doc.cover.author = fields.author.value; updateTitle(); scheduleSave(); };
fields.back.oninput = () => { doc.backCover.text = fields.back.value; scheduleSave(); };

// ---------- 人物 ----------

const charList = $('#char-list');

function renderCharacters() {
  const n = doc.characters.length;
  charList.replaceChildren(...doc.characters.map((c, i) => {
    const el = document.createElement('div');
    el.className = 'char';
    el.innerHTML = `<div class="char-row">
        <label class="field"><span>名前</span><input data-k="name" type="text" placeholder="田中蓮"></label>
        <label class="field"><span>年齢</span><input data-k="age" type="text" placeholder="２５"></label>
        <label class="field"><span>職業</span><input data-k="job" type="text" placeholder="フリーター"></label>
      </div>
      <label class="field"><span>名前の表記</span><input data-k="label" type="text"></label>
      <div class="char-actions">
        <span class="num">${i + 1}</span>
        <button data-act="up" aria-label="上へ移動" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button data-act="down" aria-label="下へ移動" ${i === n - 1 ? 'disabled' : ''}>↓</button>
        <button data-act="del" class="del">削除</button>
      </div>`;
    for (const input of el.querySelectorAll('input')) input.value = c[input.dataset.k];
    el.querySelector('[data-k="label"]').placeholder = c.name || '田中';
    return el;
  }));
}

charList.addEventListener('input', e => {
  const k = e.target.dataset.k;
  if (!k) return;
  const i = [...charList.children].indexOf(e.target.closest('.char'));
  doc.characters[i][k] = e.target.value;
  if (k === 'name') e.target.closest('.char').querySelector('[data-k="label"]').placeholder = e.target.value || '田中';
  updateChips();
  scheduleSave();
});

charList.addEventListener('click', e => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  const i = [...charList.children].indexOf(e.target.closest('.char'));
  const c = doc.characters[i];
  if (act === 'del') {
    if ((c.name || c.label || c.age || c.job) && !confirm(`「${c.name || c.label || '名前なし'}」を削除しますか？`)) return;
    doc.characters.splice(i, 1);
    renderCharacters();
  } else {
    const j = act === 'up' ? i - 1 : i + 1;
    [doc.characters[i], doc.characters[j]] = [doc.characters[j], doc.characters[i]];
    renderCharacters();
    // 続けて押せるように、動かした人物のボタンにフォーカスを移す
    charList.children[j].querySelector(`[data-act="${act}"]`).focus();
  }
  markHistoryStep();
  updateChips();
  scheduleSave();
});

$('#btn-add-char').onclick = () => {
  doc.characters.push({ name: '', age: '', job: '', label: '' });
  renderCharacters();
  charList.lastElementChild.querySelector('input').focus();
  markHistoryStep();
  scheduleSave();
};

// ---------- 本文エディタ（1段落＝1ブロック） ----------

const LABEL = { hashira: '柱', togaki: 'ト', serifu: 'セ' };
const blocksEl = $('#body-blocks');
let cur = 0;      // 編集中のブロック
let layout = { lines: [], rows: [] }; // rows[i] = ブロックiの行の通し番号

function blockEl(i) { return blocksEl.children[i]; }
function blockTa(i) { return blockEl(i)?.querySelector('textarea'); }
function indexOf(node) { return [...blocksEl.children].indexOf(node.closest('.blk')); }

function makeBlockEl(b) {
  const el = document.createElement('div');
  el.className = 'blk';
  el.innerHTML = `<button class="badge" tabindex="-1"><span></span></button>
    <div class="cells"><div class="render" aria-hidden="true"></div>
    <textarea rows="1" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea></div>
    <div class="marks" aria-hidden="true"></div>`;
  el.querySelector('textarea').value = b.text;
  setBlockType(el, b.type);
  return el;
}

function setBlockType(el, type) {
  el.className = `blk t-${type || 'none'}`;
  el.querySelector('.badge span').textContent = LABEL[type] || '？';
  el.querySelector('textarea').placeholder = type ? '' : '↑ 柱・ト書き・セリフを選んでください';
}

function renderBlocks() {
  blocksEl.replaceChildren(...doc.blocks.map(makeBlockEl));
  refreshLayout(true);
}

// 組版し直して、原稿用紙どおりの表示・ページ区切り・統計を更新する
function refreshLayout(all = false, changed = -1) {
  const lines = layoutBody(doc.blocks);
  const rows = doc.blocks.map(() => []);
  lines.forEach((l, g) => rows[l.block].push(g));
  layout = { lines, rows };

  rows.forEach((gs, i) => {
    const el = blockEl(i);
    el.classList.toggle('gap', gs.length > 0 && lines[gs[0]].type === 'blank');
    if (all || i === changed) {
      el.querySelector('.render').innerHTML = gs.map(g =>
        `<div style="padding-left:${lines[g].indent}em">${escapeHtml(lines[g].chars.join(''))}</div>`).join('');
    }
    // 半ページ（10行）ごとの区切り。偶数ノンブルの次からA4の次の紙
    const marks = gs.filter(g => g % LINES_PER_HALF === 0).map(g => {
      const n = g / LINES_PER_HALF + 1;
      return `<div class="pmark${n % 2 ? ' sheet' : ''}" style="top:calc(${lines[g].row} * var(--lh))"><span>P${n}</span></div>`;
    }).join('');
    if (el.dataset.marks !== marks) {
      el.dataset.marks = marks;
      el.querySelector('.marks').innerHTML = marks;
    }
  });

  const n = lines.length;
  const halves = Math.max(1, Math.ceil(n / LINES_PER_HALF));
  $('#body-stats').textContent = `本文 ${n}行 ／ ノンブル ${halves}（A4 ${Math.ceil(halves / 2)}枚・20×20換算 ${(n / 20).toFixed(1)}枚）`;
  updateCaret();
}

// 入力中のブロックは、ブラウザの折り返しが組版より1行多くなることがあるので高さを合わせる
function fitBlock(i) {
  const el = blockEl(i);
  const ta = blockTa(i);
  if (!el || !ta) return;
  ta.style.height = 'auto';
  const gap = el.classList.contains('gap') ? parseFloat(getComputedStyle(el).lineHeight) : 0;
  el.querySelector('.cells').style.minHeight = ta.scrollHeight + gap + 'px';
  ta.style.height = '';
}

function updateCaret() {
  const { lines, rows } = layout;
  const ta = blockTa(cur);
  const total = Math.max(1, Math.ceil(lines.length / LINES_PER_HALF));
  let g = lines.findIndex(l => l.block >= cur);
  if (g < 0) g = lines.length;
  const gs = rows[cur] || [];
  if (ta && gs.length) {
    const c = ta.selectionStart;
    let acc = 0;
    g = gs[gs.length - 1];
    for (const k of gs) {
      acc += lines[k].chars.length;
      if (c < acc) { g = k; break; }
    }
  }
  $('#caret-pos').textContent = `P${Math.floor(g / LINES_PER_HALF) + 1}・${g % LINES_PER_HALF + 1}行目 ／ 全${total}P`;
}

function updateToolbar() {
  const type = doc?.blocks[cur]?.type;
  $$('#type-buttons button').forEach(b => b.classList.toggle('on', b.dataset.type === type));
  $('#type-buttons').classList.toggle('need', !type);
}

function focusBlock(i, caret) {
  const ta = blockTa(i);
  if (!ta) return;
  ta.focus();
  const c = caret ?? ta.value.length;
  ta.setSelectionRange(c, c);
}

function blockChanged(i) {
  refreshLayout(false, i);
  fitBlock(i);
  updateToolbar();
  clearTimeout(updateChips.timer);
  updateChips.timer = setTimeout(updateChips, 1500);
  scheduleSave();
}

// ブロックiの後ろに新しいブロックを入れる
function insertBlocks(i, list) {
  doc.blocks.splice(i + 1, 0, ...list);
  const ref = blockEl(i + 1);
  for (const b of list) blocksEl.insertBefore(makeBlockEl(b), ref);
  refreshLayout(true);
  scheduleSave();
}

function removeBlock(i) {
  doc.blocks.splice(i, 1);
  blockEl(i).remove();
}

function setType(i, type) {
  const b = doc.blocks[i];
  if (!b) return;
  delete blockEl(i).dataset.auto; // ボタンで選んだ種類は自動判定で変えない
  if (b.type === type) return;
  const ta = blockTa(i);
  let caret = ta.selectionStart;
  if ((b.type === 'hashira' && HASHIRA_RE.test(b.text)) || (b.type === 'serifu' && LEAD_SPACE_RE.test(b.text))) {
    b.text = b.text.slice(1);
    caret = Math.max(0, caret - 1);
  }
  if (type === 'hashira' && !HASHIRA_RE.test(b.text)) {
    b.text = '○' + b.text;
    caret++;
  }
  b.type = type;
  ta.value = b.text;
  setBlockType(blockEl(i), type);
  ta.setSelectionRange(caret, caret);
  blockChanged(i);
}

// 書き出しから種類を判定する：「○」で柱、空白3つでト書き、名前「でセリフ。
// 種類が未選択か、改行で自動的にト書きになった段落だけが対象
function detectType(i, composing) {
  const b = doc.blocks[i];
  const el = blockEl(i);
  if (b.type && !(b.type === 'togaki' && el.dataset.auto)) return;
  const ta = blockTa(i);
  let type = null;
  if (HASHIRA_RE.test(b.text)) type = 'hashira';
  else if (SERIFU_RE.test(b.text)) type = 'serifu';
  else if (!b.type && !composing && /^[ 　]{3}/.test(b.text)) {
    // 字下げはト書きが自動でするので、入力した空白3つは消す
    const caret = Math.max(0, ta.selectionStart - 3);
    b.text = b.text.slice(3);
    ta.value = b.text;
    ta.setSelectionRange(caret, caret);
    type = 'togaki';
  }
  if (!type || type === b.type) return;
  b.type = type;
  setBlockType(el, type);
  delete el.dataset.auto;
}

blocksEl.addEventListener('focusin', e => {
  if (e.target.tagName !== 'TEXTAREA') return;
  cur = indexOf(e.target);
  fitBlock(cur);
  updateToolbar();
  updateCaret();
});
blocksEl.addEventListener('focusout', e => {
  if (e.target.tagName === 'TEXTAREA') e.target.closest('.cells').style.minHeight = '';
});
document.addEventListener('selectionchange', () => {
  if (document.activeElement?.closest?.('#body-blocks')) updateCaret();
});

// iPhoneではキーボードが出ると、見えている範囲だけが縮んで下にずれる。
// 編集画面をその範囲に合わせ（#view-edit の --vv-top / --vv-h）、ページ自体はスクロールさせない
if (window.visualViewport) {
  const vv = window.visualViewport;
  const root = document.documentElement;
  // 段落をタップしてからキーボードが出て位置が落ち着くまで、画面を背景色で覆っておく
  const veil = $('#veil');
  let settleTimer, veilLimit;
  const uncover = () => {
    clearTimeout(settleTimer);
    clearTimeout(veilLimit);
    if (veil.hidden || veil.classList.contains('fade')) return;
    veil.classList.add('fade');
    setTimeout(() => { if (veil.classList.contains('fade')) veil.hidden = true; }, 200);
  };
  const waitSettle = ms => { clearTimeout(settleTimer); settleTimer = setTimeout(uncover, ms); };
  // キーボードが出たままでも、別の段落をタップしたときは覆う（改行で次の段落へ進むときは覆わない）
  let tappedAt = 0;
  blocksEl.addEventListener('pointerdown', () => { tappedAt = performance.now(); });
  blocksEl.addEventListener('focusin', e => {
    if (e.target.tagName !== 'TEXTAREA' || selecting) return;
    if (root.classList.contains('kb') && performance.now() - tappedAt > 1000) return;
    veil.classList.remove('fade');
    veil.hidden = false;
    waitSettle(300); // 外付けキーボードなどで画面が動かないときも消えるように
    clearTimeout(veilLimit);
    veilLimit = setTimeout(uncover, 900);
  });

  let lastTop = 0, lastH = vv.height;
  const fit = () => {
    if (vv.offsetTop !== lastTop || vv.height !== lastH) {
      lastH = vv.height;
      if (!veil.hidden) waitSettle(150);
    }
    const editing = !$('#view-edit').hidden;
    // 入力を始めるとページ全体が上に送られる。編集画面を元の位置に戻し、
    // 送られた分だけ中身を同じだけスクロールして、文字の見える位置は変えない（画面が行ったり来たりしないように）
    let shift = vv.offsetTop - lastTop;
    lastTop = vv.offsetTop;
    if (editing && (scrollX || scrollY)) {
      shift += scrollY;
      window.scrollTo(0, 0);
    }
    root.style.setProperty('--vv-top', vv.offsetTop + 'px');
    root.style.setProperty('--vv-h', vv.height + 'px');
    root.classList.toggle('kb', innerHeight - vv.height > 120);
    if (editing && shift) panelsEl.scrollTop += shift; // 下の余白が付いてから送る
    if (debugViewport) {
      const r = $('#view-edit').getBoundingClientRect();
      debugViewport.textContent = `vv ${Math.round(vv.offsetTop)}/${Math.round(vv.height)} win ${Math.round(scrollY)}/${innerHeight} edit ${Math.round(r.top)}/${Math.round(r.height)}`;
    }
  };
  // 「…/index.html?debug」で開くと、画面の位置の値を左上に出す（不具合を調べるため）
  const debugViewport = location.search.includes('debug') && $('#view-edit').appendChild(document.createElement('div'));
  if (debugViewport) debugViewport.style.cssText = 'position:absolute;left:4px;bottom:4px;z-index:99;font:11px monospace;background:#000c;color:#fff;padding:2px 4px;pointer-events:none';
  // キーボードが出入りするあいだは、通知が遅れたり来なかったりするので、しばらく毎フレーム合わせる
  let until = 0;
  const watch = () => {
    fit();
    const loop = () => { fit(); if (performance.now() < until) requestAnimationFrame(loop); };
    if (performance.now() >= until) requestAnimationFrame(loop);
    until = performance.now() + 1000;
  };
  vv.addEventListener('resize', watch);
  vv.addEventListener('scroll', watch);
  window.addEventListener('scroll', watch, { passive: true });
  document.addEventListener('focusin', watch);
  document.addEventListener('focusout', watch);
  document.addEventListener('input', watch);
  fit();
}

// 入力中の段落がツールバーの下やキーボードに隠れたら、見えるところまで送る
function revealCaretBlock() {
  const ta = document.activeElement;
  if (!ta?.closest?.('#body-blocks')) return;
  const r = ta.getBoundingClientRect();
  const top = $('#toolbar').getBoundingClientRect().bottom + 8;
  const bottom = panelsEl.getBoundingClientRect().bottom - 8;
  // 長い段落は先頭まで戻すとカーソルが下に隠れるので、末尾を見せる
  if (r.top < top && r.height < bottom - top) panelsEl.scrollTop -= top - r.top;
  else if (r.bottom > bottom) panelsEl.scrollTop += Math.min(r.bottom - bottom, r.top - top);
}
blocksEl.addEventListener('focusin', () => setTimeout(revealCaretBlock, 350)); // キーボードが出てから

// 余白やバッジを押したら、そのブロック（なければ最後のブロック）を編集
blocksEl.addEventListener('click', e => {
  if (selecting) {
    if (dragged) dragged = false;
    else selectBlock(e.target.closest('.blk'));
    return;
  }
  if (e.target.tagName === 'TEXTAREA') return;
  const el = e.target.closest('.blk');
  focusBlock(el ? indexOf(el) : doc.blocks.length - 1);
});

// 改行した次の段落の種類。柱・ト書きの次はト書き、セリフの続きはセリフ、
// セリフを「」」で閉じたあとは種類を選び直す。text は改行位置より前の文字
function nextType(type, text) {
  if (type === 'hashira' || type === 'togaki') return 'togaki';
  if (type === 'serifu' && /」[\s　]*$/.test(text)) return null;
  return type;
}

// セリフの続きは行頭に全角スペースを入れておき、消したら種類を選ぶ前に戻す
const SERIFU_MARK = '　';
const LEAD_SPACE_RE = /^[\s　]/;

// 改行キーで段落を分ける（変換の確定では beforeinput の改行は来ない）
blocksEl.addEventListener('beforeinput', e => {
  if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
  e.preventDefault();
  const i = indexOf(e.target);
  const b = doc.blocks[i];
  const ta = e.target;
  if (!b.type && !b.text.trim()) return;
  const after = b.text.slice(ta.selectionEnd);
  b.text = b.text.slice(0, ta.selectionStart);
  ta.value = b.text;
  blockChanged(i);
  const type = nextType(b.type, b.text);
  const mark = type === 'serifu' ? SERIFU_MARK : '';
  insertBlocks(i, [{ type, text: mark + after.replace(/^[\s　]+/, '') }]);
  if (type) blockEl(i + 1).dataset.auto = '1';
  focusBlock(i + 1, mark.length);
});

blocksEl.addEventListener('input', e => {
  const i = indexOf(e.target);
  const b = doc.blocks[i];
  const ta = e.target;
  const [first, ...rest] = ta.value.split('\n');
  const hadMark = LEAD_SPACE_RE.test(b.text);
  b.text = first;
  // 柱の「○」やセリフの続きの行頭スペースを消したら、種類を選ぶ前に戻る
  if ((b.type === 'hashira' && !HASHIRA_RE.test(b.text)) ||
      (b.type === 'serifu' && hadMark && !LEAD_SPACE_RE.test(b.text))) {
    b.type = null;
    setBlockType(blockEl(i), null);
  }
  detectType(i, e.isComposing);
  if (!rest.length) return blockChanged(i);

  // 貼り付けなどで複数行が入ったら、行ごとにブロックへ分ける（種類は推定）
  const caretInRest = ta.value.length - ta.selectionEnd;
  ta.value = first;
  blockChanged(i);
  const added = textToBlocks(rest.join('\n'));
  if (!added.length) {
    const type = nextType(b.type, b.text);
    added.push({ type, text: type === 'serifu' ? SERIFU_MARK : '' });
  }
  insertBlocks(i, added);
  const last = i + added.length;
  focusBlock(last, Math.max(0, doc.blocks[last].text.length - caretInRest));
});

blocksEl.addEventListener('keydown', e => {
  if (e.isComposing || e.keyCode === 229) return;
  const ta = e.target;
  if (ta.tagName !== 'TEXTAREA') return;
  const i = indexOf(ta);
  const b = doc.blocks[i];
  const s = ta.selectionStart;
  const collapsed = s === ta.selectionEnd;

  if (e.key === 'Backspace' && collapsed && s === 0) {
    if (b.type && !b.text) {
      // 空の段落で後退すると、種類を選ぶ前に戻る
      e.preventDefault();
      b.type = null;
      setBlockType(blockEl(i), null);
      blockChanged(i);
    } else if (i > 0) {
      // 前の段落とつなげる
      e.preventDefault();
      const prev = doc.blocks[i - 1];
      const caret = prev.text.length;
      prev.text += b.text;
      blockTa(i - 1).value = prev.text;
      removeBlock(i);
      focusBlock(i - 1, caret);
      blockChanged(i - 1);
      refreshLayout(true);
    }
  } else if (e.key === 'Delete' && collapsed && s === ta.value.length && i < doc.blocks.length - 1) {
    e.preventDefault();
    b.text += doc.blocks[i + 1].text;
    ta.value = b.text;
    removeBlock(i + 1);
    ta.setSelectionRange(s, s);
    blockChanged(i);
    refreshLayout(true);
  } else if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && collapsed && s === 0 && i > 0) {
    e.preventDefault();
    focusBlock(i - 1);
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && collapsed && s === ta.value.length && i < doc.blocks.length - 1) {
    e.preventDefault();
    focusBlock(i + 1, 0);
  }
});

// ---------- ツールバー ----------

function updateChips() {
  if (!doc) return;
  const names = [...new Set([...serifuNames(doc.blocks), ...characterNames(doc.characters)])];
  $('#name-chips').replaceChildren(...names.map(n => {
    const b = document.createElement('button');
    b.dataset.insert = 'name';
    b.dataset.name = n;
    b.textContent = n;
    return b;
  }));
}

function insertText(text, caretOffset = text.length) {
  const ta = blockTa(cur);
  if (!ta) return;
  const start = ta.selectionStart;
  ta.setRangeText(text, start, ta.selectionEnd, 'end');
  ta.selectionStart = ta.selectionEnd = start + caretOffset;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// ボタンを押してもキーボードが閉じないように、フォーカスを奪わない
$('#toolbar').addEventListener('pointerdown', e => {
  if (e.target.closest('button')) e.preventDefault();
});
$('#toolbar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !doc || !(b.dataset.type || b.dataset.insert)) return;
  if (!blockTa(cur)) cur = doc.blocks.length - 1;
  if (document.activeElement !== blockTa(cur)) focusBlock(cur);
  if (b.dataset.type) return setType(cur, b.dataset.type);

  const kind = b.dataset.insert;
  if (kind === 'kakko') insertText('「」', 1);
  else if (kind === 'name') {
    const s = b.dataset.name + '「」';
    startBlock('serifu', s, s.length - 1);
  } else if (kind === 'batsu') startBlock('togaki', '　×　　　×　　　×');
  else insertText(kind);
});

// 空の段落ならそこに、書きかけの段落なら次の段落に、種類と書き出しを入れる
function startBlock(type, text, caret = text.length) {
  let i = cur;
  if (doc.blocks[i].text.trim()) {
    insertBlocks(i, [{ type, text: '' }]);
    i++;
    focusBlock(i);
  }
  setType(i, type);
  doc.blocks[i].text = '';
  blockTa(i).value = '';
  insertText(text, caret);
}

// ---------- 段落をまとめて削除 ----------

let selecting = false;
let selected = new Set();
let anchor = null;

function setSelecting(on) {
  selecting = on;
  selected = new Set();
  anchor = null;
  blocksEl.classList.toggle('selecting', on);
  $('#toolbar').classList.toggle('selecting', on);
  if (on) document.activeElement?.blur();
  updateSelection();
}

// 1つ目のタップで選び、2つ目のタップでその間をまとめて選ぶ。あとは1つずつ選択・解除
function selectBlock(el) {
  if (!el) return;
  const i = indexOf(el);
  if (selected.size === 1 && anchor !== null && anchor !== i) {
    for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) selected.add(k);
    anchor = null;
  } else if (selected.has(i)) {
    selected.delete(i);
  } else {
    selected.add(i);
    if (selected.size === 1) anchor = i;
  }
  updateSelection();
}

function updateSelection() {
  [...blocksEl.children].forEach((el, i) => el.classList.toggle('sel', selected.has(i)));
  $('#select-count').textContent = selected.size
    ? `${selected.size}段落`
    : 'タップ・なぞって選択';
  $('#btn-select-clear').disabled = !selected.size;
  $('#btn-delete-blocks').disabled = !selected.size;
  $('#btn-move-up').disabled = !selected.size || selected.has(0);
  $('#btn-move-down').disabled = !selected.size || selected.has(doc.blocks.length - 1);
}

// なぞって選ぶ。なぞり始める前の選択に、なぞった範囲を足す。
// 画面の上下の端まで来たら自動でスクロールする
let drag = null;
let dragged = false; // なぞり終わりの click をタップとして扱わない

function blockAtY(y) {
  const els = [...blocksEl.children];
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (y < r.bottom || i === els.length - 1) return y < r.top && i === 0 ? 0 : i;
  }
  return -1;
}

function dragTo(y) {
  const i = blockAtY(y);
  if (i < 0) return;
  if (i !== drag.start) drag.moved = true;
  if (!drag.moved) return;
  selected = new Set(drag.base);
  for (let k = Math.min(drag.start, i); k <= Math.max(drag.start, i); k++) selected.add(k);
  anchor = null;
  updateSelection();
}

function autoScroll() {
  if (!drag) return;
  const top = $('#toolbar').getBoundingClientRect().bottom + 40;
  const bottom = panelsEl.getBoundingClientRect().bottom - 40;
  const dy = drag.y < top ? -(top - drag.y) / 3 : drag.y > bottom ? (drag.y - bottom) / 3 : 0;
  if (dy) {
    panelsEl.scrollTop += Math.max(-20, Math.min(20, dy));
    dragTo(drag.y);
  }
  drag.raf = requestAnimationFrame(autoScroll);
}

blocksEl.addEventListener('pointerdown', e => {
  if (!selecting) return;
  dragged = false;
  const el = e.target.closest('.blk');
  if (!el) return;
  drag = { start: indexOf(el), base: new Set(selected), moved: false, y: e.clientY };
  drag.raf = requestAnimationFrame(autoScroll);
});
blocksEl.addEventListener('pointermove', e => {
  if (!drag) return;
  drag.y = e.clientY;
  dragTo(e.clientY);
});
function endDrag() {
  if (!drag) return;
  cancelAnimationFrame(drag.raf);
  dragged = drag.moved;
  drag = null;
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// 選んだ段落を1つ上（dir=-1）か下（dir=1）へ動かす。離れた段落を選んでいても、それぞれ1つずつ動く
function moveSelected(dir) {
  const order = [...selected].sort((a, b) => (a - b) * -dir);
  if (order.some(i => i + dir < 0 || i + dir >= doc.blocks.length)) return;
  const next = new Set();
  for (const i of order) {
    [doc.blocks[i], doc.blocks[i + dir]] = [doc.blocks[i + dir], doc.blocks[i]];
    next.add(i + dir);
  }
  selected = next;
  anchor = null;
  renderBlocks();
  updateSelection();
  updateChips();
  markHistoryStep();
  scheduleSave();
  const first = Math.min(...selected), last = Math.max(...selected);
  blockEl(dir < 0 ? first : last).scrollIntoView({ block: 'nearest' });
}

$('#btn-move-up').onclick = () => moveSelected(-1);
$('#btn-move-down').onclick = () => moveSelected(1);
$('#btn-select').onclick = () => setSelecting(true);
$('#btn-select-done').onclick = () => setSelecting(false);
$('#btn-select-clear').onclick = () => {
  selected = new Set();
  anchor = null;
  updateSelection();
};
$('#btn-delete-blocks').onclick = () => {
  const n = selected.size;
  doc.blocks = doc.blocks.filter((_, i) => !selected.has(i));
  if (!doc.blocks.length) doc.blocks = firstBlocks();
  setSelecting(false);
  cur = Math.min(cur, doc.blocks.length - 1);
  renderBlocks();
  updateToolbar();
  updateChips();
  scheduleSave();
  toast(`${n}段落を削除しました`);
};

// ---------- 元に戻す・やり直す ----------
// 作品の中身をまるごと記録する。続けて打った文字は1秒の区切りまで1回分にまとめ、
// 段落の追加・削除や種類の変更はそれだけで1回分にする

const HISTORY_MAX = 200;
let hist = { undo: [], redo: [], last: null, shape: '', time: 0 };
let historyPending = false;
let historyForce = false; // 段落の並べ替えなど、種類の並びが変わらなくても1回分にする操作
let restoring = false;

function snapshot() {
  return JSON.stringify({ cover: doc.cover, characters: doc.characters, blocks: doc.blocks, backCover: doc.backCover });
}

function blockShape() {
  return doc.blocks.map(b => b.type).join();
}

function resetHistory() {
  hist = { undo: [], redo: [], last: snapshot(), shape: blockShape(), time: 0 };
  updateHistoryButtons();
}

// 1つの操作で何度変更されても1回分になるよう、操作の終わりにまとめて記録する
function markHistoryStep() {
  historyForce = true;
}

function scheduleHistory() {
  if (historyPending) return;
  historyPending = true;
  queueMicrotask(commitHistory);
}

function commitHistory() {
  historyPending = false;
  if (!doc) return;
  const now = snapshot();
  if (now === hist.last) return;
  const shape = blockShape();
  const structural = shape !== hist.shape || historyForce;
  historyForce = false;
  if (structural || Date.now() - hist.time > 1000) {
    hist.undo.push(hist.last);
    if (hist.undo.length > HISTORY_MAX) hist.undo.shift();
  }
  hist.last = now;
  hist.shape = shape;
  hist.time = structural ? 0 : Date.now();
  hist.redo = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('#btn-undo').disabled = !hist.undo.length;
  $('#btn-redo').disabled = !hist.redo.length;
}

function undo() { step(hist.undo, hist.redo); }
function redo() { step(hist.redo, hist.undo); }

function step(from, to) {
  commitHistory();
  if (!from.length) return;
  const editing = document.activeElement?.closest?.('#body-blocks');
  const before = doc.blocks;
  to.push(hist.last);
  hist.last = from.pop();
  hist.time = 0;
  const s = JSON.parse(hist.last);
  Object.assign(doc, s);
  hist.shape = blockShape();
  // 変わった段落にカーソルを置く
  let i = doc.blocks.findIndex((b, k) => b.text !== before[k]?.text || b.type !== before[k]?.type);
  if (i < 0) i = Math.min(cur, doc.blocks.length - 1);
  cur = Math.min(i, doc.blocks.length - 1);
  setSelecting(false);
  restoring = true;
  fillEditor();
  scheduleSave();
  restoring = false;
  updateHistoryButtons();
  if (editing) focusBlock(cur);
}

// ボタンを押してもキーボードが閉じないように、フォーカスを奪わない
$('.history').addEventListener('pointerdown', e => e.preventDefault());
$('#btn-undo').onclick = undo;
$('#btn-redo').onclick = redo;
document.addEventListener('keydown', e => {
  if (!doc || $('#view-edit').hidden || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  if (e.shiftKey) redo(); else undo();
});

// ---------- プレビュー ----------

function renderPreview() {
  if (!doc) return;
  const scroller = $('#preview-scroller');
  const sheets = buildSheets(doc);
  const items = [];
  for (const s of sheets) {
    if (previewMode === 'half' && s.kind === 'grid') {
      items.push(renderHalf(s.halves[0], { grid: showGrid }));
      if (s.halves[1].lines.length) items.push(renderHalf(s.halves[1], { grid: showGrid }));
    } else {
      items.push(renderSheet(s, { grid: showGrid }));
    }
  }
  const availW = scroller.clientWidth - 24;
  const availH = scroller.clientHeight - 24;
  scroller.replaceChildren(...items.map(node => {
    const w = parseFloat(node.style.width) * MM;
    const h = parseFloat(node.style.height) * MM;
    const scale = Math.min(availW / w, availH / h);
    node.classList.add('paper');
    node.style.transform = `scale(${scale})`;
    const wrap = document.createElement('div');
    wrap.className = 'page';
    const inner = document.createElement('div');
    inner.className = 'page-inner';
    inner.style.width = `${w * scale}px`;
    inner.style.height = `${h * scale}px`;
    inner.appendChild(node);
    wrap.appendChild(inner);
    return wrap;
  }));
  scroller.scrollLeft = 0;
  updateIndicator();
}

function updateIndicator() {
  const scroller = $('#preview-scroller');
  const n = scroller.children.length;
  const i = Math.round(Math.abs(scroller.scrollLeft) / scroller.clientWidth) + 1;
  $('#page-indicator').textContent = n ? `${Math.min(i, n)} / ${n}` : '';
}

$('#preview-scroller').addEventListener('scroll', updateIndicator, { passive: true });

$$('[data-pmode]').forEach(b => {
  b.classList.toggle('on', b.dataset.pmode === previewMode);
  b.onclick = () => {
    previewMode = b.dataset.pmode;
    localStorage.setItem('previewMode', previewMode);
    $$('[data-pmode]').forEach(x => x.classList.toggle('on', x === b));
    renderPreview();
  };
});

$('#grid-toggle').checked = showGrid;
$('#grid-toggle').onchange = e => {
  showGrid = e.target.checked;
  localStorage.setItem('showGrid', showGrid ? '1' : '0');
  renderPreview();
};

window.addEventListener('resize', () => {
  if (doc && !$('[data-panel="preview"]').hidden) renderPreview();
});

// ---------- 書き出し ----------

$('#btn-export').onclick = () => $('#export-dialog').showModal();

$('#export-dialog').addEventListener('click', async e => {
  const action = e.target.dataset.export;
  if (!action) return;
  if (action === 'close') return $('#export-dialog').close();
  await flush();

  if (action === 'pdf') {
    $('#busy').hidden = false;
    try {
      const file = await buildPdfFile(doc);
      $('#export-dialog').close();
      showSavePrompt(file);
    } catch (err) {
      toast('PDFを作れませんでした：' + err.message, 4000);
    } finally {
      $('#busy').hidden = true;
    }
    return;
  }

  $('#export-dialog').close();
  try {
    if (action === 'print') printDoc(doc);
    else if (action === 'copy-grid') {
      await copyToClipboard(gridText(doc));
      toast('コピーしました（20字改行）');
    } else if (action === 'copy-para') {
      const { plain, html } = paragraphContent(doc);
      await copyToClipboard(plain, html);
      toast('コピーしました（段落ごと）');
    } else if (action === 'backup') await exportBackup(doc);
  } catch (err) {
    toast('失敗しました：' + err.message, 4000);
  }
});

// PDFができたら、もう一度タップしてもらって共有シートを開く
function showSavePrompt(file) {
  toastAction(`PDFができました（${Math.round(file.size / 1024)}KB）`, '保存・共有', () => saveFile(file), 0);
}

// ボタン付きの通知。ms が 0 なら閉じるまで出したまま
function toastAction(msg, label, fn, ms = 6000) {
  const t = $('#toast');
  clearTimeout(toast.timer);
  t.innerHTML = '';
  t.append(msg);
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { t.hidden = true; fn(); };
  const x = document.createElement('button');
  x.textContent = '閉じる';
  x.className = 'sub';
  x.onclick = () => { t.hidden = true; };
  t.append(b, x);
  t.hidden = false;
  if (ms) toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- 起動 ----------

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); // file:// では使えない

const last = localStorage.getItem('lastOpened');
if (last) openScript(last); else showList();
