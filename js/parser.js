// 本文は段落（ブロック）の配列。各ブロックは { type, text }。
// type は 'hashira'（柱）・'togaki'（ト書き）・'serifu'（セリフ）、まだ選んでいなければ null。

const HASHIRA_RE = /^[○◯〇]/;
// 名前「…」。名前は1〜10字で、句読点・括弧・空白を含まない。ルビ付きの名前（｜田中《たなか》「）も含む
const SERIFU_RE = /^((?:[｜|][^｜|《》「」\s　]{1,10}《[^《》]*》|[^「」『』、。，．\s　○◯〇｜|《》]{1,10}(?:《[^《》]*》)?))「/;
// ルビ：｜親文字《ふりがな》。｜を省くと、《の前に続く漢字が親文字になる
const RUBY_RE = /[｜|]([^｜|《》\n]+?)《([^《》\n]*)》|([々〆ヶ\p{Script=Han}]+)《([^《》\n]*)》/gu;

// 縦中横：^12^。半角にできる英数記号（^ を除く）2〜4字を半角にして1マスに横に並べる（toFull のあとの ＾１２＾ も同じ）。
// 「(^_^)と」などが縦中横にならないよう、かなや漢字は含めない
const TCY_RE = /[\^＾]([!-\]_-~！-］＿-～]{2,4})[\^＾]/g;

function toHalf(s) {
  return s.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
}

// 1字ずつ。結合用の濁点・半濁点（U+3099・U+309A）は前の字と1マスにする（「あ゙」など）
const CHAR_RE = /[^][゙゚]?/gu;
const MARK_RE = /[゙゚]$/;

function chars1(s) {
  return s.match(CHAR_RE) || [];
}

// 縦中横のマスは2字以上をまとめた1要素になる（濁点を重ねた字は除く）
function isTcy(ch) {
  return Array.from(ch).length > 1 && !MARK_RE.test(ch);
}

// 1マスずつに分ける。縦中横は記号を除いて1マスにまとめる
function cells(s) {
  const out = [];
  let last = 0;
  for (const m of s.matchAll(TCY_RE)) {
    out.push(...chars1(s.slice(last, m.index)), toHalf(m[1]));
    last = m.index + m[0].length;
  }
  return [...out, ...chars1(s.slice(last))];
}

// ルビ・縦中横の記号を除いた文字（text）とマス（chars）、ルビの位置（at＝何マス目から、len＝親文字のマス数）に分ける
function parseRuby(s) {
  const chars = [], rubies = [];
  let last = 0;
  for (const m of s.matchAll(RUBY_RE)) {
    chars.push(...cells(s.slice(last, m.index)));
    const base = cells(m[1] ?? m[3]), ruby = m[2] ?? m[4];
    if (ruby) rubies.push({ at: chars.length, len: base.length, ruby });
    chars.push(...base);
    last = m.index + m[0].length;
  }
  chars.push(...cells(s.slice(last)));
  return { text: chars.join(''), chars, rubies };
}

// ルビの記号とふりがなを除いた1マスずつ。at〜end＝元の文字列での範囲、m＝ルビの親文字ならそのルビ（RUBY_RE の一致）、
// tcy＝縦中横（ch は記号を除いた中身、at〜end は記号を含む）
function rawChars(s) {
  const out = [];
  const one = (from, to, m) => {
    for (const c of s.slice(from, to).matchAll(CHAR_RE)) {
      out.push({ ch: c[0], at: from + c.index, end: from + c.index + c[0].length, m });
    }
  };
  const push = (from, to, m) => {
    let k = from;
    for (const t of s.slice(from, to).matchAll(TCY_RE)) {
      one(k, from + t.index, m);
      k = from + t.index + t[0].length;
      out.push({ ch: toHalf(t[1]), at: from + t.index, end: k, m, tcy: true });
    }
    one(k, to, m);
  };
  let last = 0;
  for (const m of s.matchAll(RUBY_RE)) {
    push(last, m.index, null);
    const at = m.index + (m[1] != null ? 1 : 0);
    push(at, at + (m[1] ?? m[3]).length, m);
    last = m.index + m[0].length;
  }
  push(last, s.length, null);
  return out;
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
