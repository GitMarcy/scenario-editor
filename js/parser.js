// 本文は段落（ブロック）の配列。各ブロックは { type, text }。
// type は 'hashira'（柱）・'togaki'（ト書き）・'serifu'（セリフ）、まだ選んでいなければ null。

const HASHIRA_RE = /^[○◯〇]/;
// 名前「…」。名前は1〜10字で、句読点・括弧・空白を含まない
const SERIFU_RE = /^([^「」『』、。，．\s　○◯〇]{1,10})「/;
const NOON_RE = /[（(]\s*昼\s*[）)]\s*$/;

// 旧形式のテキストや貼り付けたテキストの1行を推定で分類する
function classifyLine(line) {
  if (line.trim() === '') return 'blank';
  // 行頭が空白ならト書きとして扱う（セリフと誤判定される行の回避用）
  if (/^[\s　]/.test(line)) return 'togaki';
  if (HASHIRA_RE.test(line)) return 'hashira';
  if (SERIFU_RE.test(line)) return 'serifu';
  return 'togaki';
}

// テキスト（1行＝1段落）をブロックの配列にする
function textToBlocks(text) {
  const blocks = [];
  for (const raw of (text || '').split('\n')) {
    const type = classifyLine(raw);
    if (type === 'blank') continue;
    let t = raw.trim().replace(/^[\s　]+/, '');
    if (type === 'hashira') t = '○' + t.slice(1);
    blocks.push({ type, text: t });
  }
  return blocks;
}

// 組版・書き出し用に整える。空のブロックは除き、種類未選択は 'none'（字下げなし）。
// block は元のブロック番号。cont は行頭に空白のあるセリフ（区切りのよいところで改行したセリフの続き）
function bodyParas(blocks) {
  const paras = [];
  (blocks || []).forEach((b, block) => {
    const type = b.type || 'none';
    // ト書きは行頭の空白も字下げとして残す（×××など）
    let t = type === 'togaki' ? b.text.replace(/[\s　]+$/, '') : b.text.trim().replace(/^[\s　]+/, '');
    if (!t.trim()) return;
    if (type === 'hashira') t = '○' + t.replace(HASHIRA_RE, '').trim().replace(NOON_RE, '');
    const cont = type === 'serifu' && /^[\s　]/.test(b.text);
    paras.push({ type, text: t, block, cont });
  });
  return paras;
}

// 本文中でセリフに使われている名前（出現回数の多い順）
function serifuNames(blocks) {
  const count = new Map();
  for (const b of blocks || []) {
    if (b.type !== 'serifu') continue;
    const m = b.text.match(SERIFU_RE);
    if (m) count.set(m[1], (count.get(m[1]) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

// 旧形式の人物表の1行「田中蓮（２５）フリーター」を名前・年齢・職業に分ける
function parseCharacterLine(line) {
  const m = line.match(/^(.+?)[（(]([^）)]*)[）)][\s　]*(.*)$/);
  if (m) return { name: m[1].trim(), age: m[2].trim(), job: m[3].trim(), label: '' };
  const [name, ...rest] = line.split(/[\s　]+/);
  return { name, age: '', job: rest.join('　'), label: '' };
}

// 本文で使う人物の名前（名前の表記があればそちら）
function characterNames(characters) {
  return (characters || []).map(c => (c.label || c.name).trim()).filter(Boolean);
}

// 人物表に印刷する1行「名前（年齢）職業」
function characterLine(c) {
  const name = c.name.trim(), age = c.age.trim(), job = c.job.trim();
  return name + (age ? `（${age}）` : '') + (job ? (age || !name ? '' : '　') + job : '');
}
