// 本文は段落（ブロック）の配列。各ブロックは { type, text }。
// type は 'hashira'（柱）・'togaki'（ト書き）・'serifu'（セリフ）、まだ選んでいなければ null。

const HASHIRA_RE = /^[○◯〇]/;
// 名前「…」。名前は1〜10字で、句読点・括弧・空白を含まない。ルビ付きの名前（｜田中《たなか》「）も含む
const SERIFU_RE = /^((?:[｜|][^｜|《》「」\s　]{1,10}《[^《》]*》|[^「」『』、。，．\s　○◯〇｜|《》]{1,10}(?:《[^《》]*》)?))「/;
// ルビ：｜親文字《ふりがな》。｜を省くと、《の前に続く漢字が親文字になる
const RUBY_RE = /[｜|]([^｜|《》\n]+?)《([^《》\n]*)》|([々〆ヶ\p{Script=Han}]+)《([^《》\n]*)》/gu;

// ルビの記号を除いた文字と、ルビの位置（at＝何文字目から、len＝親文字の字数）に分ける
function parseRuby(s) {
  let text = '', n = 0, last = 0;
  const rubies = [];
  for (const m of s.matchAll(RUBY_RE)) {
    const before = s.slice(last, m.index);
    const base = m[1] ?? m[3], ruby = m[2] ?? m[4];
    const len = Array.from(base).length;
    n += Array.from(before).length;
    if (ruby) rubies.push({ at: n, len, ruby });
    text += before + base;
    n += len;
    last = m.index + m[0].length;
  }
  return { text: text + s.slice(last), rubies };
}

function rubyMarkup(base, ruby) {
  return base && ruby ? `｜${base}《${ruby}》` : base;
}
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

// 本文中でセリフに使われている名前 { name, ruby }（出現回数の多い順）。
// ルビの有無で別の名前にはせず、名前全体に付いたルビがあればそれを使う
function serifuNames(blocks) {
  const names = new Map();
  for (const b of blocks || []) {
    if (b.type !== 'serifu') continue;
    const m = b.text.match(SERIFU_RE);
    if (!m) continue;
    const { text: name, rubies } = parseRuby(m[1]);
    const n = names.get(name) || { name, ruby: '', count: 0 };
    n.count++;
    if (!n.ruby && rubies.length === 1 && rubies[0].len === Array.from(name).length) n.ruby = rubies[0].ruby;
    names.set(name, n);
  }
  return [...names.values()].sort((a, b) => b.count - a.count).map(({ name, ruby }) => ({ name, ruby }));
}

// 人物は { name, nameRuby, age, job, label, labelRuby }。
// label は本文で使う名前の表記（空なら name のまま）、～Ruby はそれぞれのふりがな
function emptyCharacter() {
  return { name: '', nameRuby: '', age: '', job: '', label: '', labelRuby: '' };
}

// 旧形式の人物表の1行「田中蓮（２５）フリーター」を名前・年齢・職業に分ける
function parseCharacterLine(line) {
  const m = line.match(/^(.+?)[（(]([^）)]*)[）)][\s　]*(.*)$/);
  if (m) return { ...emptyCharacter(), name: m[1].trim(), age: m[2].trim(), job: m[3].trim() };
  const [name, ...rest] = line.split(/[\s　]+/);
  return { ...emptyCharacter(), name, job: rest.join('　') };
}

// 本文で使う人物の名前 { name, ruby }（名前の表記があればそちら。表記が空なら名前のふりがなを使う）
function characterNames(characters) {
  return (characters || [])
    .map(c => ({ name: (c.label || c.name).trim(), ruby: (c.labelRuby || (c.label.trim() ? '' : c.nameRuby)).trim() }))
    .filter(n => n.name);
}

// 人物表に印刷する1行「名前（年齢）職業」。名前のふりがなはルビにする
function characterLine(c) {
  const name = c.name.trim(), age = c.age.trim(), job = c.job.trim();
  return rubyMarkup(name, c.nameRuby.trim()) + (age ? `（${age}）` : '') + (job ? (age || !name ? '' : '　') + job : '');
}
