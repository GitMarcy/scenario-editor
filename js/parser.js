// 本文テキストを段落（柱・ト書き・セリフ）に分類する。1行＝1段落。

const HASHIRA_RE = /^[○◯〇]/;
// 名前「…」。名前は1〜10字で、句読点・括弧・空白を含まない
const SERIFU_RE = /^([^「」『』、。，．\s　○◯〇]{1,10})「/;
const NOON_RE = /[（(]\s*昼\s*[）)]\s*$/;

function classifyLine(line) {
  if (line.trim() === '') return 'blank';
  // 行頭が空白ならト書きとして扱う（セリフと誤判定される行の回避用）
  if (/^[\s　]/.test(line)) return 'togaki';
  if (HASHIRA_RE.test(line)) return 'hashira';
  if (SERIFU_RE.test(line)) return 'serifu';
  return 'togaki';
}

function parseBody(text) {
  const paras = [];
  for (const raw of (text || '').split('\n')) {
    const type = classifyLine(raw);
    if (type === 'blank') continue;
    let t = raw.trim().replace(/^[\s　]+/, '');
    if (type === 'hashira') t = '○' + t.slice(1).trim().replace(NOON_RE, '');
    if (type === 'serifu') t = t.replace(/\s+$/, '');
    paras.push({ type, text: t });
  }
  return paras;
}

// 本文中でセリフに使われている名前（出現回数の多い順）
function serifuNames(text) {
  const count = new Map();
  for (const line of (text || '').split('\n')) {
    if (classifyLine(line) !== 'serifu') continue;
    const name = line.match(SERIFU_RE)[1];
    count.set(name, (count.get(name) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

// 人物表の各行から名前部分（「（」や空白の手前）を取り出す
function characterNames(text) {
  return (text || '').split('\n')
    .map(l => l.trim().split(/[（(\s　]/)[0])
    .filter(Boolean);
}
