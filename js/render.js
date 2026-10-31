// 原稿用紙のDOM描画。寸法はすべてmm（sample.pdf から採寸）


const G = {
  sheetW: 297, sheetH: 210,   // A4横
  pitchX: 11.4,               // 行の間隔
  pitchY: 7.1,                // 字の間隔
  font: 4.6,                  // 本文の文字サイズ
  ruby: 2.3,                  // ルビの文字サイズ（親文字の右に付ける）
  rubyGap: 0.7,               // 親文字とルビの間
  halfTop: 28.75,             // 紙の上端から半ページ枠の上端まで
  halfPad: 10,                // 半ページ枠の上端から1字目のマスまで
};
G.halfW = G.pitchX * LINES_PER_HALF;
// 左右の半ページは間を空けずに並べ、紙の中央に置く
G.leftHalfX = (G.sheetW - G.halfW * 2) / 2; // 左半分の左端
G.rightHalfX = G.leftHalfX + G.halfW;       // 右半分の左端
G.halfH = G.halfPad + G.pitchY * (COLS + 2) + 6;
G.nombreY = G.halfPad + G.pitchY * (COLS + 2) + 1;

const MM = 96 / 25.4; // CSS px / mm

const mm = v => `${v}mm`;

function el(tag, cls, style) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (style) Object.assign(e.style, style);
  return e;
}

function renderHalf(half, { grid = false } = {}) {
  const box = el('div', 'half', { width: mm(G.halfW), height: mm(G.halfH) });
  if (grid) {
    box.appendChild(el('div', 'grid', {
      top: mm(G.halfPad), width: mm(G.halfW), height: mm(G.pitchY * COLS),
      backgroundSize: `${mm(G.pitchX)} ${mm(G.pitchY)}`,
    }));
  }
  half.lines.forEach((line, c) => {
    const x = G.halfW - (c + 1) * G.pitchX;
    line.chars.forEach((ch, k) => {
      if (ch === '　') return;
      const cell = el('div', 'cell', {
        left: mm(x), top: mm(G.halfPad + (line.indent + k) * G.pitchY),
      });
      cell.textContent = ch;
      box.appendChild(cell);
    });
    for (const r of line.rubies) {
      const { left, chars } = rubyBox(x, line.indent, r);
      for (const { ch, cy } of chars) {
        const rt = el('div', 'ruby', { left: mm(left), top: mm(G.halfPad + cy - G.ruby / 2) });
        rt.textContent = ch;
        box.appendChild(rt);
      }
    }
  });
  if (half.nombre != null) {
    const n = el('div', 'nombre', { top: mm(G.nombreY) });
    n.textContent = half.nombre;
    box.appendChild(n);
  }
  return box;
}

// ルビの位置（x＝行の左端、半ページ枠の1字目のマスから）。親文字の右に、rubySpread の範囲に均等に並べる。
// left＝ルビの左端、chars＝1字ずつの文字と中心の高さ（cy）
function rubyBox(x, indent, r) {
  const kana = Array.from(r.ruby);
  const n = kana.length;
  const { start, span } = rubySpread(r.len * G.pitchY, n, G.ruby);
  const top = (indent + r.at) * G.pitchY + start;
  return {
    left: x + (G.pitchX + G.font) / 2 + G.rubyGap,
    chars: kana.map((ch, k) => ({ ch, cy: top + span * (k + 0.5) / n })),
  };
}

// 表紙・裏表紙の縦書きテキスト。x=1行目の中心, top=1字目の上端,
// adv=字送り（文字サイズに対する倍率）, maxH=1行の最大長さ, gap=行送り（倍率）
const FREE = {
  subtitle: { x: 257.5, top: 40, font: 4, adv: 1.5, maxH: 140, gap: 1.8 },
  title: { x: 152, top: 62, font: 9.5, adv: 1.15, maxH: 125, gap: 1.6 },
  author: { x: 52.5, top: 112, font: 6.5, adv: 1.5, maxH: 80, gap: 1.6 },
  back: { x: 148.5, top: 128, font: 4.6, adv: 1.6, maxH: 70, gap: 1.8 },
};

// 縦書きテキストを行（列）に分割（改行と最大長さで折る）
function freeColumns(text, spec) {
  const per = Math.max(1, Math.floor(spec.maxH / (spec.font * spec.adv)));
  const cols = [];
  for (const para of toFull(text || '').split('\n')) {
    const chars = Array.from(para);
    if (!chars.length) { cols.push([]); continue; }
    for (let i = 0; i < chars.length; i += per) cols.push(chars.slice(i, i + per));
  }
  return cols;
}

function freeText(text, spec) {
  const frag = document.createDocumentFragment();
  freeColumns(text, spec).forEach((col, c) => {
    const cx = spec.x - c * spec.font * spec.gap;
    col.forEach((ch, k) => {
      if (ch === '　' || ch === ' ') return;
      const cell = el('div', 'cell', {
        left: mm(cx - G.pitchX / 2),
        top: mm(spec.top + k * spec.font * spec.adv),
        width: mm(G.pitchX), height: mm(spec.font * spec.adv),
        lineHeight: mm(G.pitchX), fontSize: mm(spec.font),
      });
      cell.textContent = ch;
      frag.appendChild(cell);
    });
  });
  return frag;
}

function renderSheet(sheet, opts = {}) {
  const box = el('div', 'sheet', { width: mm(G.sheetW), height: mm(G.sheetH) });
  if (sheet.kind === 'grid') {
    const r = renderHalf(sheet.halves[0], opts);
    const l = renderHalf(sheet.halves[1], opts);
    Object.assign(r.style, { position: 'absolute', left: mm(G.rightHalfX), top: mm(G.halfTop) });
    Object.assign(l.style, { position: 'absolute', left: mm(G.leftHalfX), top: mm(G.halfTop) });
    box.append(r, l);
  } else if (sheet.kind === 'cover') {
    box.append(
      freeText(sheet.subtitle, FREE.subtitle),
      freeText(sheet.title, FREE.title),
      freeText(sheet.author, FREE.author),
    );
  } else if (sheet.kind === 'back') {
    box.append(freeText(sheet.text, FREE.back));
  }
  return box;
}
