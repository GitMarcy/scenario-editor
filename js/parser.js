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

// 人物表の各行から名前部分（「（」や空白の手前）を取り出す
function characterNames(text) {
  return (text || '').split('\n')
    .map(l => l.trim().split(/[（(\s　]/)[0])
    .filter(Boolean);
}
