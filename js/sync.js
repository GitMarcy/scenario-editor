// Googleドライブとの同期（選んだ人だけ）。
// 台本は本人のGoogleドライブにある「アプリ専用の隠しフォルダ（appDataFolder）」に置く。
// 通信はこのブラウザとGoogleの間だけで、作った人を含め、本人のアカウント以外からは読めない

// Google Cloud で作った OAuth クライアントID（ウェブアプリケーション）。公開してよい値。
// 空のあいだは同期の入口を出さない
const GOOGLE_CLIENT_ID = '431779331949-q49bfuej666gs8o7gkb3i727gb48qeg4.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

// file:// ではGoogleのログインが使えない
const syncAvailable = !!GOOGLE_CLIENT_ID && location.protocol.startsWith('http');

// 状態：busy（同期中）/ done（同期済み）/ auth（再接続が必要）/ offline / error
const syncInfo = { status: 'done', onchange: null };

function syncEnabled() {
  return syncAvailable && localStorage.getItem('syncMode') === 'drive';
}

function setSyncStatus(status) {
  syncInfo.status = status;
  if (status === 'done') localStorage.setItem('syncLastAt', Date.now());
  syncInfo.onchange?.();
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
const writeJson = (key, v) => localStorage.setItem(key, JSON.stringify(v));

// ---------- ログイン ----------

// アクセストークンは約1時間で切れる。サーバーがないので自動では延ばせず、切れたらタップで取り直す
function driveToken() {
  const t = readJson('driveToken', null);
  return t && t.exp > Date.now() + 60000 ? t.value : null;
}

let gisPromise;
function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => { gisPromise = null; reject(new Error('Googleに接続できませんでした')); };
    document.head.append(s);
  });
  return gisPromise;
}

// ログインのウィンドウを開く。ブラウザにポップアップを止められないよう、タップの処理の中ですぐ呼ぶ
let tokenClient, tokenWaiter;
function connectDrive() {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      loadGis().catch(() => {});
      return reject(new Error('Googleの準備中です。もう一度押してください'));
    }
    tokenClient ??= google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: r => tokenWaiter?.(r),
      error_callback: e => tokenWaiter?.({ error: e.type }),
    });
    tokenWaiter = r => {
      tokenWaiter = null;
      if (r.error || !google.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
        return reject(new Error('Googleドライブへの保存が許可されませんでした'));
      }
      writeJson('driveToken', { value: r.access_token, exp: Date.now() + r.expires_in * 1000 });
      resolve();
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// 同期をやめる。台本はこの端末に残す。
// 同期の記録（syncState・pendingDeletes）は残し、再開したときに、やめているあいだの編集や削除を伝える
function disconnectDrive() {
  const t = driveToken();
  if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t);
  ['driveToken', 'driveEmail', 'syncLastAt'].forEach(k => localStorage.removeItem(k));
  localStorage.setItem('syncMode', 'local');
}

// どのアカウントと同期しているかを表示するため（取れなくても同期には差し支えない）
async function fetchDriveEmail() {
  try {
    const r = await (await drive(`${DRIVE_API}/about?fields=user(emailAddress)`)).json();
    localStorage.setItem('driveEmail', r.user.emailAddress);
  } catch { /* 表示しないだけ */ }
}

// ---------- Drive API ----------

async function drive(url, opt = {}) {
  const token = driveToken();
  const authError = Object.assign(new Error('Googleに再接続してください'), { auth: true });
  if (!token) throw authError;
  const res = await fetch(url, { ...opt, headers: { ...opt.headers, Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    localStorage.removeItem('driveToken');
    throw authError;
  }
  if (!res.ok) throw new Error(`Googleドライブとの通信に失敗しました（${res.status}）`);
  return res;
}

// 作品1つにつきファイル1つ（名前は「台本のid.json」）。appProperties に更新日時と、削除済みかどうかを持つ
async function listRemote(q) {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name,appProperties)', pageSize: '1000' });
    if (q) params.set('q', q);
    if (pageToken) params.set('pageToken', pageToken);
    const r = await (await drive(`${DRIVE_API}/files?${params}`)).json();
    files.push(...r.files);
    pageToken = r.nextPageToken;
  } while (pageToken);
  // 2台で同時に作ると同じ名前が2つできることがあるので、新しいほうを使う
  const map = new Map();
  for (const f of files) {
    const id = f.name.replace(/\.json$/, '');
    const updatedAt = Number(f.appProperties?.updatedAt) || 0;
    if (!(map.get(id)?.updatedAt >= updatedAt)) {
      map.set(id, { fileId: f.id, updatedAt, deleted: f.appProperties?.deleted === '1' });
    }
  }
  return map;
}

async function findRemote(id) {
  return (await listRemote(`name = '${id}.json'`)).get(id);
}

async function writeRemote(id, fileId, body, props) {
  const meta = { name: `${id}.json`, mimeType: 'application/json', appProperties: props };
  if (!fileId) meta.parents = ['appDataFolder'];
  const boundary = 'scenario-' + newId();
  const data = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--`;
  await drive(`${DRIVE_UPLOAD}/files${fileId ? '/' + fileId : ''}?uploadType=multipart&fields=id`, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: data,
  });
}

const upload = (s, fileId) => writeRemote(s.id, fileId, JSON.stringify(s), { updatedAt: String(s.updatedAt), deleted: '0' });

// 消した作品は、ほかの端末にも消したことを伝えるため、中身のない「墓標」として残す
const writeTombstone = (id, fileId) => writeRemote(id, fileId, '{}', { updatedAt: String(Date.now()), deleted: '1' });

async function download(id, r) {
  const data = await (await drive(`${DRIVE_API}/files/${r.fileId}?alt=media`)).json();
  return { ...newScript(), ...data, id, updatedAt: r.updatedAt };
}

// ---------- 同期 ----------

// 同期の処理は1つずつ順番に行う（同じ作品を同時に書き換えないように）
let syncChain = Promise.resolve();
function syncQueue(fn) {
  const p = syncChain.then(fn);
  syncChain = p.catch(() => {});
  return p;
}
const syncIdle = () => syncChain;

function syncFailed(e) {
  setSyncStatus(e.auth ? 'auth' : navigator.onLine === false ? 'offline' : 'error');
  return false;
}

// 手元とドライブを突き合わせる。手元の作品が変わったら true
function syncAll() {
  return syncQueue(async () => {
    if (!syncEnabled()) return false;
    if (!driveToken()) return syncFailed({ auth: true });
    setSyncStatus('busy');
    try {
      const changed = await reconcile();
      setSyncStatus('done');
      return changed;
    } catch (e) {
      return syncFailed(e);
    }
  });
}

async function reconcile() {
  const remote = await listRemote();
  const local = new Map((await listScripts()).map(s => [s.id, s]));
  // state[id]：最後に同期したときの更新日時。これより新しければ、そのあとに書き換えられている
  const state = readJson('syncState', {});
  const pending = readJson('pendingDeletes', []);
  let changed = false;

  for (const id of pending) {
    const r = remote.get(id);
    if (r && !r.deleted) await writeTombstone(id, r.fileId);
    delete state[id];
  }
  writeJson('pendingDeletes', []);

  try {
    for (const id of new Set([...local.keys(), ...remote.keys()])) {
      if (pending.includes(id)) continue;
      const l = local.get(id), r = remote.get(id), base = state[id] || 0;
      if (r?.deleted) {
        if (!l) continue;
        if (l.updatedAt > base) {
          // ほかの端末で消したあとに、この端末で書いた分は残す
          await upload(l, r.fileId);
          state[id] = l.updatedAt;
        } else {
          await deleteScript(id);
          delete state[id];
          changed = true;
        }
      } else if (!r) {
        await upload(l);
        state[id] = l.updatedAt;
      } else if (!l) {
        await putScript(await download(id, r));
        state[id] = r.updatedAt;
        changed = true;
      } else if (l.updatedAt === r.updatedAt) {
        state[id] = r.updatedAt;
      } else if (l.updatedAt > base && r.updatedAt > base) {
        // 両方の端末で書き換えていた：ドライブの版を採用し、この端末の版は別の作品として残す
        const copy = { ...l, id: newId(), cover: { ...l.cover, title: (l.cover.title || '無題') + '（この端末の版）' } };
        await putScript(copy);
        await upload(copy);
        state[copy.id] = copy.updatedAt;
        await putScript(await download(id, r));
        state[id] = r.updatedAt;
        changed = true;
      } else if (r.updatedAt > l.updatedAt) {
        await putScript(await download(id, r));
        state[id] = r.updatedAt;
        changed = true;
      } else {
        await upload(l, r.fileId);
        state[id] = l.updatedAt;
      }
    }
  } finally {
    writeJson('syncState', state);
  }
  return changed;
}

// 編集のあと、その作品だけを少し待ってから送る
const pushTimers = {};
function syncPush(id) {
  if (!syncEnabled()) return;
  clearTimeout(pushTimers[id]);
  pushTimers[id] = setTimeout(() => syncQueue(() => pushOne(id)), 2500);
}

async function pushOne(id) {
  if (!syncEnabled()) return;
  if (!driveToken()) return syncFailed({ auth: true });
  const l = await getScript(id);
  if (!l) return;
  setSyncStatus('busy');
  try {
    const state = readJson('syncState', {});
    const r = await findRemote(id);
    // ほかの端末で書き換えたり消したりしていたら、ここでは上書きせず、一覧に戻ったときの突き合わせに任せる
    const remoteUnchanged = r && !r.deleted && r.updatedAt <= (state[id] || 0);
    if (!r || (remoteUnchanged && r.updatedAt !== l.updatedAt)) {
      await upload(l, r?.fileId);
      writeJson('syncState', { ...readJson('syncState', {}), [id]: l.updatedAt });
    }
    setSyncStatus('done');
  } catch (e) {
    syncFailed(e);
  }
}

// 消したことを記録し、次の突き合わせでドライブに伝える（同期をやめているあいだに消した分は、再開したときに）
function syncDelete(id) {
  if (!syncEnabled() && !(id in readJson('syncState', {}))) return;
  writeJson('pendingDeletes', [...readJson('pendingDeletes', []), id]);
}
