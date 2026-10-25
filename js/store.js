// IndexedDB への保存（原稿はこのiPhoneの中だけに保存される）

const DB_NAME = 'scenario-editor';
const STORE = 'scripts';

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function listScripts() {
  const all = await run('readonly', s => s.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

const getScript = id => run('readonly', s => s.get(id));
const putScript = doc => run('readwrite', s => s.put(doc));
const deleteScript = id => run('readwrite', s => s.delete(id));

function newId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// 書きはじめの本文。シナリオは柱から始まるので、最初の段落は「○」を入れた柱にしておく
function firstBlocks() {
  return [{ type: 'hashira', text: '○' }];
}

// 本文がまだ何も書かれていない（段落が1つだけで、種類も文字もない）
function isBlankBody(blocks) {
  return blocks.length === 1 && !blocks[0].type && !blocks[0].text.trim();
}

function newScript() {
  return {
    id: newId(),
    updatedAt: Date.now(),
    cover: { subtitle: '', title: '', author: '' },
    characters: '',
    blocks: firstBlocks(),
    backCover: { text: '' },
  };
}

// 読み込んだJSONを、欠けている項目を補って新しい作品として扱う
function normalizeImported(data) {
  const base = newScript();
  return {
    ...base,
    cover: { ...base.cover, ...(data.cover || {}) },
    characters: String(data.characters || ''),
    blocks: normalizeBlocks(data),
    backCover: { ...base.backCover, ...(data.backCover || {}) },
  };
}

// 旧形式（body に1行＝1段落のテキスト）をブロックに変換する
function normalizeBlocks(data) {
  const blocks = Array.isArray(data.blocks)
    ? data.blocks.map(b => ({ type: ['hashira', 'togaki', 'serifu'].includes(b?.type) ? b.type : null, text: String(b?.text || '') }))
    : textToBlocks(String(data.body || ''));
  return blocks.length ? blocks : [{ type: null, text: '' }];
}
