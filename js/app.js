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
  characters: $('#characters'),
  body: $('#body-text'),
  back: $('#back-text'),
};

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
  localStorage.setItem('lastOpened', id);
  fields.subtitle.value = doc.cover.subtitle;
  fields.title.value = doc.cover.title;
  fields.author.value = doc.cover.author;
  fields.characters.value = doc.characters;
  fields.body.value = doc.body;
  fields.back.value = doc.backCover.text;
  updateTitle();
  updateBodyDecor();
  updateChips();
  showView('edit');
  switchTab(tab || localStorage.getItem('tab') || 'body');
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
  if (name === 'body') autogrow();
  if (name === 'preview') renderPreview();
  window.scrollTo(0, 0);
}

$$('.tabs button').forEach(b => { b.onclick = () => switchTab(b.dataset.tab); });

fields.subtitle.oninput = () => { doc.cover.subtitle = fields.subtitle.value; scheduleSave(); };
fields.title.oninput = () => { doc.cover.title = fields.title.value; updateTitle(); scheduleSave(); };
fields.author.oninput = () => { doc.cover.author = fields.author.value; updateTitle(); scheduleSave(); };
fields.characters.oninput = () => { doc.characters = fields.characters.value; updateChips(); scheduleSave(); };
fields.back.oninput = () => { doc.backCover.text = fields.back.value; scheduleSave(); };
fields.body.oninput = () => {
  doc.body = fields.body.value;
  updateBodyDecor();
  clearTimeout(updateChips.timer);
  updateChips.timer = setTimeout(updateChips, 1500);
  scheduleSave();
};

// ---------- 本文エディタ：種類の目印と統計 ----------

const LABEL = { hashira: '柱', togaki: 'ト', serifu: 'セ', blank: '' };

function updateBodyDecor() {
  const lines = fields.body.value.split('\n');
  $('#body-backdrop').innerHTML = lines.map(l => {
    const t = classifyLine(l);
    return `<div class="ln t-${t}" data-label="${LABEL[t]}">${escapeHtml(l) || '&nbsp;'}</div>`;
  }).join('');
  autogrow();
  const n = layoutBody(fields.body.value).length;
  const halves = Math.max(1, Math.ceil(n / LINES_PER_HALF));
  $('#body-stats').textContent = `本文 ${n}行 ／ ノンブル ${halves}（A4 ${Math.ceil(halves / 2)}枚・20×20換算 ${(n / 20).toFixed(1)}枚）`;
}

function autogrow() {
  const ta = fields.body;
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, 240) + 'px';
}

// ---------- ツールバー ----------

function updateChips() {
  if (!doc) return;
  const names = [...new Set([...serifuNames(doc.body), ...characterNames(doc.characters)])];
  $('#name-chips').replaceChildren(...names.map(n => {
    const b = document.createElement('button');
    b.dataset.insert = 'name';
    b.dataset.name = n;
    b.textContent = n;
    return b;
  }));
}

function insertText(text, caretOffset = text.length) {
  const ta = fields.body;
  const start = ta.selectionStart;
  ta.setRangeText(text, start, ta.selectionEnd, 'end');
  ta.selectionStart = ta.selectionEnd = start + caretOffset;
  ta.dispatchEvent(new Event('input'));
}

function atLineStart() {
  const ta = fields.body;
  const before = ta.value.slice(0, ta.selectionStart);
  return before === '' || before.endsWith('\n');
}

function currentLineEmpty() {
  const ta = fields.body;
  const v = ta.value;
  const s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let e = v.indexOf('\n', ta.selectionStart);
  if (e < 0) e = v.length;
  return v.slice(s, e).trim() === '';
}

// ボタンを押してもキーボードが閉じないように、フォーカスを奪わない
$('#toolbar').addEventListener('pointerdown', e => {
  if (e.target.closest('button')) e.preventDefault();
});
$('#toolbar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const kind = b.dataset.insert;
  const nl = atLineStart() || currentLineEmpty() ? '' : '\n';
  if (kind === 'hashira') insertText(nl + '○');
  else if (kind === 'kakko') insertText('「」', 1);
  else if (kind === 'name') {
    const s = nl + b.dataset.name + '「」';
    insertText(s, s.length - 1);
  } else insertText(kind);
  fields.body.focus();
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
  const t = $('#toast');
  clearTimeout(toast.timer);
  t.innerHTML = '';
  t.append(`PDFができました（${Math.round(file.size / 1024)}KB）`);
  const b = document.createElement('button');
  b.textContent = '保存・共有';
  b.onclick = async () => { t.hidden = true; await saveFile(file); };
  const x = document.createElement('button');
  x.textContent = '閉じる';
  x.className = 'sub';
  x.onclick = () => { t.hidden = true; };
  t.append(b, x);
  t.hidden = false;
}

// ---------- 起動 ----------

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {}); // file:// では使えない

const last = localStorage.getItem('lastOpened');
if (last) openScript(last); else showList();
