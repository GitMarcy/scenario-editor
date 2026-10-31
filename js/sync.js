// Googleドライブとの同期（選んだ人だけ）。
// 台本は本人のマイドライブの「シナリオエディター（同期）」フォルダに、編集データ（.json）と同じ形で置く。
// 権限は drive.file（このアプリが作ったファイルだけを読み書きできる）。
// 通信はこのブラウザとGoogleの間だけで、作った人を含め、本人のアカウント以外からは読めない

// Google Cloud で作った OAuth クライアントID（ウェブアプリケーション）。公開してよい値。
// 空のあいだは同期の入口を出さない
const GOOGLE_CLIENT_ID = '431779331949-q49bfuej666gs8o7gkb3i727gb48qeg4.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'シナリオエディター（同期）';
const OLD_FOLDER_NAME = 'シナリオエディター'; // はじめのころの名前。見つけたら今の名前に直す
const APP_TAG = 'scenario-editor'; // このアプリのファイルの印（appProperties.app）

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

// アクセストークンは約1時間で切れる。サーバーがないので自動では延ばせず、切れたらタップで取り直す。
// 権限を変えたあと（隠しフォルダ→見えるフォルダ）は、前の権限のトークンを使わない
function driveToken() {
  const t = readJson('driveToken', null);
  return t && t.scope === DRIVE_SCOPE && t.exp > Date.now() + 60000 ? t.value : null;
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
      writeJson('driveToken', { value: r.access_token, scope: DRIVE_SCOPE, exp: Date.now() + r.expires_in * 1000 });
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
  ['driveToken', 'driveEmail', 'driveFolder', 'syncLastAt'].forEach(k => localStorage.removeItem(k));
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

// 作品1つにつきファイル1つ（名前は「タイトル.json」）。利用者がフォルダを移したり名前を変えたりしても
// 見つけられるよう、appProperties に作品のid・更新日時・削除済みかどうかを持つ
async function listRemote(extra) {
  let q = `appProperties has { key='app' and value='${APP_TAG}' }`;
  if (extra) q += ` and ${extra}`;
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,trashed,appProperties)', pageSize: '1000' });
    if (pageToken) params.set('pageToken', pageToken);
    const r = await (await drive(`${DRIVE_API}/files?${params}`)).json();
    files.push(...r.files);
    pageToken = r.nextPageToken;
  } while (pageToken);
  const map = new Map();
  for (const f of files) {
    const p = f.appProperties || {};
    const deleted = p.deleted === '1';
    // 利用者がドライブで消したファイルは「なかったもの」として扱い、手元の作品から作り直す。
    // ドライブ側の操作で台本を失わないように、作品を消すのはこのアプリで消したときだけにする
    if (!p.scriptId || (f.trashed && !deleted)) continue;
    const updatedAt = Number(p.updatedAt) || 0;
    // 同じ作品のファイルが2つあるとき（ドライブでコピーしたときなど）は、新しいほうを使う
    if (!(map.get(p.scriptId)?.updatedAt >= updatedAt)) map.set(p.scriptId, { fileId: f.id, updatedAt, deleted });
  }
  return map;
}

async function findRemote(id) {
  return (await listRemote(`appProperties has { key='scriptId' and value='${id}' }`)).get(id);
}

// 新しく作る作品を入れるフォルダ。ゴミ箱に入れられていたら作り直す（確かめるのは開くたびに1回）
let folderId = null;
async function driveFolder() {
  if (folderId) return folderId;
  const cached = localStorage.getItem('driveFolder');
  if (cached) {
    try {
      const f = await (await drive(`${DRIVE_API}/files/${cached}?fields=id,name,trashed`)).json();
      if (!f.trashed) return (folderId = await renameOldFolder(f));
    } catch (e) {
      if (e.auth) throw e;
    }
  }
  const q = `appProperties has { key='app' and value='${APP_TAG}-folder' } and trashed = false`;
  const r = await (await drive(`${DRIVE_API}/files?${new URLSearchParams({ q, fields: 'files(id,name)', orderBy: 'createdTime' })}`)).json();
  folderId = r.files[0] && await renameOldFolder(r.files[0]);
  if (!folderId) {
    const res = await drive(`${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', appProperties: { app: `${APP_TAG}-folder` } }),
    });
    folderId = (await res.json()).id;
  }
  localStorage.setItem('driveFolder', folderId);
  return folderId;
}

// 前の名前のままのフォルダだけを今の名前にする（利用者が自分で付けた名前は変えない）
async function renameOldFolder(f) {
  if (f.name === OLD_FOLDER_NAME) {
    await drive(`${DRIVE_API}/files/${f.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME }),
    });
  }
  return f.id;
}

// 中身は「編集データ（.json）を書き出し」と同じ形。ドライブからダウンロードして［続きから書く］でも読み込める
async function upload(s, fileId) {
  const meta = {
    name: `${fileBase(s)}.json`,
    mimeType: 'application/json',
    appProperties: { app: APP_TAG, scriptId: s.id, updatedAt: String(s.updatedAt), deleted: '0' },
  };
  if (fileId) meta.trashed = false; // ほかの端末で消したあとに書いた分を戻すとき
  else meta.parents = [await driveFolder()];
  const boundary = 'scenario-' + newId();
  const data = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(s, null, 2)}\r\n--${boundary}--`;
  await drive(`${DRIVE_UPLOAD}/files${fileId ? '/' + fileId : ''}?uploadType=multipart&fields=id`, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: data,
  });
}

// 消した作品は、ほかの端末にも消したことを伝えるため、印を付けてドライブのゴミ箱に移す。
// ゴミ箱は30日で空になるので、それより長く開かなかった端末では、消した作品がドライブに戻ることがある
function writeTombstone(fileId) {
  return drive(`${DRIVE_API}/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true, appProperties: { deleted: '1', updatedAt: String(Date.now()) } }),
  });
}

// ドライブで中身を書き換えられて読めないファイルは null（その作品はこの回は同期しない）
async function download(id, r) {
  const res = await drive(`${DRIVE_API}/files/${r.fileId}?alt=media`);
  try {
    return { ...newScript(), ...(await res.json()), id, updatedAt: r.updatedAt };
  } catch {
    return null;
  }
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
  await driveFolder(); // フォルダを用意し、前の名前なら直しておく（開くたびに1回）
  const remote = await listRemote();
  const local = new Map((await listScripts()).map(s => [s.id, s]));
  // state[id]：最後に同期したときの更新日時。これより新しければ、そのあとに書き換えられている
  const state = readJson('syncState', {});
  const pending = readJson('pendingDeletes', []);
  let changed = false;

  for (const id of pending) {
    const r = remote.get(id);
    if (r && !r.deleted) await writeTombstone(r.fileId);
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
      } else if (l?.updatedAt === r.updatedAt) {
        state[id] = r.updatedAt;
      } else if (!l || r.updatedAt > l.updatedAt || l.updatedAt > base && r.updatedAt > base) {
        const d = await download(id, r);
        if (!d) continue;
        if (l && l.updatedAt > base && r.updatedAt > base) {
          // 両方の端末で書き換えていた：ドライブの版を採用し、この端末の版は別の作品として残す
          const copy = { ...l, id: newId(), cover: { ...l.cover, title: (l.cover.title || '無題') + '（この端末の版）' } };
          await putScript(copy);
          await upload(copy);
          state[copy.id] = copy.updatedAt;
        }
        await putScript(d);
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
