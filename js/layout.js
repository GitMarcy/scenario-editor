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
};

// 半角英数記号を全角に（縦書きで横倒しにならないように）
function toFull(s) {
  return s
    .replace(/[!-~]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))
    .replace(/ /g, '　');
}

// 1段落を行に折り返す。各行は { indent, chars }
function wrap(text, first, rest, width = COLS) {
  const chars = Array.from(text);
  if (!chars.length) return [{ indent: first, chars: [] }];
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
    }
    lines.push({ indent, chars: chars.slice(i, end) });
    i = end;
    indent = rest;
  }
  return lines;
}

function layoutBody(text) {
  const lines = [];
  for (const p of parseBody(text)) {
    const [first, rest] = INDENT[p.type];
    for (const l of wrap(toFull(p.text), first, rest)) lines.push({ ...l, type: p.type });
  }
  return lines;
}

function layoutCharacters(text) {
  const entries = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!entries.length) return [];
  const lines = [{ indent: 3, chars: [...'人　物'] }];
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

  const bodyHalves = chunk(layoutBody(doc.body), LINES_PER_HALF);
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
