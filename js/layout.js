// 原稿用紙（1行20字・半ページ10行）への組版


const COLS = 20;          // 1行の字数
const LINES_PER_HALF = 10; // ノンブル1つあたりの行数

// 行末にぶら下げてよい文字（最大2字）
const HANG = new Set([...'、。，．」』）〕】！？']);
// 行頭に置かない文字
const NO_START = new Set([...'、。，．」』）〕】！？…‥・：；ゝゞヽヾ々']);
// 行末に置かない文字
const NO_END = new Set([...'「『（〔【']);

const INDENT = {
  hashira: [0, 1],
  togaki: [3, 3],
  serifu: [0, 1],
  serifuCont: [1, 1], // セリフの続きは1行目から1字下げ
  none: [0, 0],       // 種類未選択
};

// 半角英数記号を全角に（縦書きで横倒しにならないように）
function toFull(s) {
  return s
    .replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))
    .replace(/ /g, '　');
}

// 1段落を行に折り返す。各行は { indent, chars, rubies }。
// rubies は { at（行の何文字目から）, len（親文字の字数）, ruby }
function wrap(text, first, rest, width = COLS) {
  const { text: plain, rubies } = parseRuby(text);
  const chars = Array.from(plain);
  if (!chars.length) return [{ indent: first, chars: [], rubies: [] }];
  const lines = [];
  let i = 0;
  let indent = first;
  while (i < chars.length) {
    let end = Math.min(i + (width - indent), chars.length);
    if (end < chars.length) {
      let hang = 0;
      while (hang < 2 && end < chars.length && HANG.has(chars[end])) { end++; hang++; }
      while (end < chars.length && end - i > 1 && NO_START.has(chars[end])) end--;
      while (end < chars.length && end - i > 1 && NO_END.has(chars[end - 1])) end--;
      // ルビの親文字の途中では折り返さない（1行に収まらない長さのときだけ折る）
      const r = rubies.find(r => r.at > i && r.at < end && end < r.at + r.len);
      if (r) end = r.at;
    }
    lines.push({ indent, chars: chars.slice(i, end), rubies: lineRubies(rubies, i, end) });
    i = end;
    indent = rest;
  }
  return lines;
}

// start〜end の文字に掛かるルビ。行をまたぐルビは、ふりがなを親文字の字数の割合で分ける
function lineRubies(rubies, start, end) {
  const out = [];
  for (const r of rubies) {
    const s = Math.max(r.at, start), e = Math.min(r.at + r.len, end);
    if (s >= e) continue;
    const kana = Array.from(r.ruby);
    const part = x => Math.round((x - r.at) / r.len * kana.length);
    const ruby = kana.slice(part(s), part(e)).join('');
    if (ruby) out.push({ at: s - start, len: e - s, ruby });
  }
  return out;
}

// 各行に、元のブロック番号（block）とブロック内の何行目か（row）を付ける。
// 柱の前は1行空ける。ただし柱が見開き（A4の紙）の1行目に来るときは空けない
function layoutBody(blocks) {
  const lines = [];
  for (const p of bodyParas(blocks)) {
    const [first, rest] = INDENT[p.cont ? 'serifuCont' : p.type];
    let row = 0;
    if (p.type === 'hashira' && lines.length % (LINES_PER_HALF * 2) !== 0) {
      lines.push({ indent: 0, chars: [], rubies: [], type: 'blank', block: p.block, row: row++ });
    }
    for (const l of wrap(toFull(p.text), first, rest)) lines.push({ ...l, type: p.type, block: p.block, row: row++ });
  }
  return lines;
}

function layoutCharacters(characters) {
  const entries = (characters || []).map(characterLine).filter(Boolean);
  if (!entries.length) return [];
  const lines = [{ indent: 3, chars: [...'人　物'], rubies: [] }];
  for (const e of entries) lines.push(...wrap(toFull(e), 1, 2));
  return lines;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// 作品全体をA4横の紙（sheet）の配列にする。
// grid の sheet は halves[0]=右半分, halves[1]=左半分
function buildSheets(doc) {
  const sheets = [{ kind: 'cover', ...doc.cover }];

  const chHalves = chunk(layoutCharacters(doc.characters), LINES_PER_HALF);
  for (let k = 0; k < chHalves.length; k += 2) {
    sheets.push({ kind: 'grid', halves: [
      { lines: chHalves[k], nombre: null },
      { lines: chHalves[k + 1] || [], nombre: null },
    ] });
  }

  const bodyHalves = chunk(layoutBody(doc.blocks), LINES_PER_HALF);
  if (!bodyHalves.length) bodyHalves.push([]);
  for (let k = 0; k < bodyHalves.length; k += 2) {
    sheets.push({ kind: 'grid', halves: [
      { lines: bodyHalves[k], nombre: k + 1 },
      { lines: bodyHalves[k + 1] || [], nombre: bodyHalves[k + 1] ? k + 2 : null },
    ] });
  }

  sheets.push({ kind: 'back', text: doc.backCover.text || doc.cover.author });
  return sheets;
}

function lineToString(l) {
  return '　'.repeat(l.indent) + l.chars.join('');
}

// ルビを並べる範囲。親文字の先頭からの位置 start と長さ span を返し、ルビはこの中に均等に並べる。
// len＝親文字の長さ、n＝ルビの字数、size＝ルビ1字の大きさ（単位はそろっていれば何でもよい）
// ・親文字の長さに収まるときは、前後にルビ1字分の空きをとる
// ・空きをとると収まらないときは、空きなしで親文字の長さいっぱいに並べる（少しなら詰める）
// ・それでも収まらないほど多いときは、親文字の前後にはみ出して中央に揃える
function rubySpread(len, n, size) {
  const need = n * size;
  if (need <= len - 2 * size) return { start: size, span: len - 2 * size };
  if (need * 0.9 <= len) return { start: 0, span: len };
  return { start: (len - need) / 2, span: need };
}

// 文字をHTMLにする。ルビの付いた文字は tag(親文字, ふりがな, ルビ) で囲む。
// charHtml(文字, 何文字目) で1字ずつの書き方を変えられる
function rubyHtml(chars, rubies, tag, charHtml = ch => escapeHtml(ch)) {
  const part = (a, b) => chars.slice(a, b).map((ch, j) => charHtml(ch, a + j)).join('');
  let html = '', k = 0;
  for (const r of rubies) {
    html += part(k, r.at) + tag(part(r.at, r.at + r.len), escapeHtml(r.ruby), r);
    k = r.at + r.len;
  }
  return html + part(k, chars.length);
}
