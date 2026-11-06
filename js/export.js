// 保存・コピー：PDF（画像）、印刷、Word（.docx）、Word用・プレーンテキストのコピー、編集データ（.json）


const FONT = '"Hiragino Mincho ProN", "Hiragino Mincho Pro", "Yu Mincho", "YuMincho", serif';

// 縦書きで90度回す文字
const ROTATE = new Set([...'ー－―‐～〜…‥（）「」『』【】〔〕［］｛｝〈〉《》＝→←＜＞：；｜']);
// 縦書きで右上に寄せる文字
const PUNCT = new Set([...'、。，．']);
const SMALL = new Set([...'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ']);

function drawChar(ctx, ch, cx, cy, f) {
  ctx.save();
  ctx.translate(cx, cy);
  if (ROTATE.has(ch)) ctx.rotate(Math.PI / 2);
  else if (PUNCT.has(ch)) ctx.translate(f * 0.6, -f * 0.6);
  else if (SMALL.has(ch)) ctx.translate(f * 0.1, -f * 0.1);
  ctx.fillText(ch, 0, 0);
  ctx.restore();
}

function drawSheet(sheet, k) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(G.sheetW * k);
  canvas.height = Math.round(G.sheetH * k);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (sheet.kind === 'grid') {
    sheet.halves.forEach((half, h) => {
      const ox = h === 0 ? G.rightHalfX : G.leftHalfX;
      const oy = G.halfTop;
      half.lines.forEach((line, c) => {
        const x = G.halfW - (c + 1) * G.pitchX;
        const cx = ox + x + 0.5 * G.pitchX;
        ctx.font = `${G.font * k}px ${FONT}`;
        line.chars.forEach((ch, i) => {
          if (ch === '　') return;
          const cy = oy + G.halfPad + (line.indent + i + 0.5) * G.pitchY;
          drawChar(ctx, ch, cx * k, cy * k, G.font * k);
        });
        ctx.font = `${G.ruby * k}px ${FONT}`;
        for (const r of line.rubies) {
          const { left, chars } = rubyBox(x, line.indent, r);
          for (const { ch, cy } of chars) {
            drawChar(ctx, ch, (ox + left + G.ruby / 2) * k, (oy + G.halfPad + cy) * k, G.ruby * k);
          }
        }
      });
      if (half.nombre != null) {
        ctx.font = `${3.6 * k}px ${FONT}`;
        ctx.fillText(String(half.nombre), (ox + G.halfW / 2) * k, (oy + G.nombreY + 1.8) * k);
      }
    });
  } else {
    const items = sheet.kind === 'cover'
      ? [[sheet.subtitle, FREE.subtitle], [sheet.title, FREE.title], [sheet.author, FREE.author]]
      : [[sheet.text, FREE.back]];
    for (const [text, spec] of items) {
      ctx.font = `${spec.font * k}px ${FONT}`;
      freeColumns(text, spec).forEach((col, c) => {
        const cx = spec.x - c * spec.font * spec.gap;
        col.forEach((ch, i) => {
          if (ch === '　' || ch === ' ') return;
          const cy = spec.top + (i + 0.5) * spec.font * spec.adv;
          drawChar(ctx, ch, cx * k, cy * k, spec.font * k);
        });
      });
    }
  }
  return canvas;
}

function canvasToJpeg(canvas) {
  return new Promise(resolve => canvas.toBlob(async b => {
    resolve(new Uint8Array(await b.arrayBuffer()));
  }, 'image/jpeg', 0.92));
}

// JPEG画像を1ページ1枚で並べた最小限のPDFを作る
function buildPdf(images, imgW, imgH) {
  const W = 728.5, H = 515.9; // B5横（pt）
  // 画像は採寸（A4横）の縦横比のまま幅いっぱいに置き、わずかに余る上下は等分に空ける
  const ih = +(W * imgH / imgW).toFixed(2);
  const iy = +((H - ih) / 2).toFixed(2);
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let offset = 0;
  const push = x => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    parts.push(b);
    offset += b.length;
  };
  const obj = (num, write) => {
    offsets[num] = offset;
    push(`${num} 0 obj\n`);
    write();
    push('\nendobj\n');
  };

  const n = images.length;
  const pageNum = i => 3 + i * 3;
  push('%PDF-1.4\n%âãÏÓ\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${images.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] /Count ${n} >>`));
  images.forEach((img, i) => {
    const p = pageNum(i);
    obj(p, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`));
    const content = `q ${W} 0 0 ${ih} 0 ${iy} cm /Im0 Do Q`;
    obj(p + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(p + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);
      push(img);
      push('\nendstream');
    });
  });
  const total = 2 + n * 3;
  const xref = offset;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let k = 1; k <= total; k++) push(`${String(offsets[k]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// PDFを作ってFileを返す（共有シートはタップ直後でないと開けないので、保存は別操作）
async function buildPdfFile(doc) {
  await document.fonts?.ready;
  const k = 7; // px/mm（約178dpi）
  const images = [];
  let w = 0, h = 0;
  for (const sheet of buildSheets(doc)) {
    const canvas = drawSheet(sheet, k);
    w = canvas.width; h = canvas.height;
    images.push(await canvasToJpeg(canvas));
  }
  return new File([buildPdf(images, w, h)], `${fileBase(doc)}.pdf`, { type: 'application/pdf' });
}

function printDoc(doc) {
  const root = document.getElementById('print-root');
  root.replaceChildren(...buildSheets(doc).map(s => renderSheet(s, { grid: false })));
  const cleanup = () => { root.replaceChildren(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 原稿用紙どおり：20字で改行し、字下げは全角スペース。
// ルビはテキストでは ｜親文字《ふりがな》、HTML（Wordに貼るとき）では <ruby> にする
function gridContent(doc) {
  const lines = layoutBody(doc.blocks);
  const plain = lines.map(l => '　'.repeat(l.indent) +
    rubyHtml(l.chars, l.rubies, (base, _, r) => `｜${base}《${r.ruby}》`, ch => ch)).join('\n');
  const html = '<div style="font-family:\'游明朝\',\'Yu Mincho\',\'ヒラギノ明朝 ProN\',serif">' +
    lines.map(l => `<p style="margin:0">${'　'.repeat(l.indent)}${
      rubyHtml(l.chars, l.rubies, (base, ruby) => `<ruby>${base}<rt style="font-size:6pt">${ruby}</rt></ruby>`) || '　'}</p>`).join('') + '</div>';
  return { plain, html };
}

// ---------- Word（.docx） ----------
// 見本（sample.docx）と同じ、B5横・縦書き・1ページ20行。1行を1段落にし、字下げは全角スペース。
// ノンブルは本文のフッターに { = PAGE*2 }（左）と { = PAGE*2-1 }（右）の計算フィールドで出す

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// 1行（layoutBody の行）を段落の中身にする。ルビは Word のルビ（親文字の半分の大きさ）
function docxLine(l) {
  const ruby = (base, ruby) => '</w:t></w:r><w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="distributeSpace"/>' +
    '<w:hps w:val="12"/><w:hpsRaise w:val="22"/><w:hpsBaseText w:val="24"/><w:lid w:val="ja-JP"/></w:rubyPr>' +
    `<w:rt><w:r><w:rPr><w:sz w:val="12"/></w:rPr><w:t>${ruby}</w:t></w:r></w:rt>` +
    `<w:rubyBase><w:r><w:t>${base}</w:t></w:r></w:rubyBase></w:ruby></w:r><w:r><w:t xml:space="preserve">`;
  return `<w:r><w:t xml:space="preserve">${'　'.repeat(l.indent)}${rubyHtml(l.chars, l.rubies, ruby)}</w:t></w:r>`;
}

function docxText(text, rPr = '') {
  return text ? `<w:r>${rPr && `<w:rPr>${rPr}</w:rPr>`}<w:t xml:space="preserve">${escapeHtml(text)}</w:t></w:r>` : '';
}

// 段落 { pPr, body } を並べる。sect を渡すと最後の段落でセクションを区切る
// （空の段落を足して区切ると、ちょうど20行で終わったときに白紙のページができるため）
function docxParas(paras, sect = '') {
  return paras.map((p, i) => {
    const pPr = (p.pPr || '') + (sect && i === paras.length - 1 ? sect : '');
    return `<w:p>${pPr && `<w:pPr>${pPr}</w:pPr>`}${p.body || ''}</w:p>`;
  }).join('');
}

// 段落の改行マークの大きさ（空の段落の行の高さが変わる）
const markSize = sz => `<w:rPr><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;

function docxSect(charSpace, footer) {
  return '<w:sectPr>' +
    (footer ? `<w:footerReference w:type="default" r:id="${footer}"/>` : '') +
    '<w:pgSz w:w="14572" w:h="10319" w:orient="landscape" w:code="13"/>' +
    '<w:pgMar w:top="1985" w:right="1701" w:bottom="1701" w:left="1701" w:header="851" w:footer="992" w:gutter="0"/>' +
    (footer === 'rId3' ? '<w:pgNumType w:start="1"/>' : '') +
    '<w:cols w:space="425"/><w:textDirection w:val="tbRl"/>' +
    `<w:docGrid w:type="linesAndChars" w:linePitch="558" w:charSpace="${charSpace}"/></w:sectPr>`;
}

// シナリオセンター式の本文：1段落を1つの段落にして流し込み（折り返しはWordに任せる）、
// 見本（sample.docx）のスタイル「柱」「ト書き」「セリフ」を当てる。柱の前の空行は原稿用紙と同じ所に入れる
const SC_STYLE = { hashira: 'Hashira', togaki: 'Togaki', serifu: 'Serifu' };

function docxScenarioBody(blocks) {
  const blank = new Set(layoutBody(blocks).filter(l => l.type === 'blank').map(l => l.block));
  const paras = [];
  for (const p of bodyParas(blocks)) {
    if (blank.has(p.block)) paras.push({});
    let { text, rubies } = parseRuby(toFull(p.text));
    // 柱の「○」はスタイルの箇条書きで付く
    if (p.type === 'hashira') {
      text = text.slice(1);
      rubies = rubies.map(r => ({ ...r, at: r.at - 1 }));
    }
    const style = SC_STYLE[p.type];
    // セリフの続きは1行目も1字下げ（2行目からはスタイルで下がる）
    paras.push({
      pPr: style ? `<w:pStyle w:val="${style}"/>` : '',
      body: docxLine({ indent: p.cont ? 1 : 0, chars: Array.from(text), rubies }),
    });
  }
  return paras;
}

// 見本のスタイルを写したもの（「ト書き」は「ト書１」をもとにしている）。
// ト書きだけは見本と変えて、1行目だけでなく全部の行を3字下げる
const SC_STYLES =
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Serifu"><w:name w:val="セリフ"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
  '<w:pPr><w:widowControl/><w:ind w:left="100" w:hangingChars="100" w:hanging="100"/><w:jc w:val="left"/></w:pPr><w:rPr><w:szCs w:val="24"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Togaki1"><w:name w:val="ト書１"/><w:basedOn w:val="Serifu"/><w:next w:val="Serifu"/>' +
  '<w:pPr><w:ind w:left="0" w:firstLineChars="300" w:firstLine="300"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Togaki"><w:name w:val="ト書き"/><w:basedOn w:val="Togaki1"/><w:qFormat/>' +
  '<w:pPr><w:ind w:leftChars="300" w:left="720" w:firstLineChars="0" w:firstLine="0"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Hashira"><w:name w:val="柱"/><w:qFormat/>' +
  '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:rPr><w:kern w:val="2"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>';

// 柱の「○」（見本の箇条書きと同じ）
const SC_NUMBERING = `${XML_HEAD}<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0">` +
  '<w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
  '<w:pStyle w:val="Hashira"/><w:suff w:val="nothing"/><w:lvlText w:val="○"/><w:lvlJc w:val="left"/>' +
  '<w:pPr><w:ind w:left="420" w:hanging="420"/></w:pPr>' +
  '<w:rPr><w:rFonts w:ascii="ＭＳ 明朝" w:eastAsia="ＭＳ 明朝" w:hAnsi="ＭＳ 明朝" w:cs="ＭＳ 明朝" w:hint="eastAsia"/><w:sz w:val="24"/></w:rPr>' +
  '</w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

function docxDocument(doc, sc) {
  const lines = text => toFull(text || '').split('\n');
  const blanks = (n, pPr = '') => Array.from({ length: n }, () => ({ pPr }));

  // 表紙：副題、題名（大きく太字）、作者。続けて改ページして人物表
  const titleRPr = '<w:b/><w:sz w:val="56"/><w:szCs w:val="56"/>';
  const cover = [
    ...lines(doc.cover.subtitle).map(t => ({ body: docxText(t) })),
    ...blanks(7, markSize(21)),
    ...lines(doc.cover.title).map(t => ({
      pPr: `<w:ind w:firstLineChars="200"/><w:rPr>${titleRPr}</w:rPr>`, body: docxText(t, titleRPr),
    })),
    ...blanks(7, markSize(40)),
    ...lines(doc.cover.author).map(t => ({
      pPr: markSize(40), body: docxText('　'.repeat(7) + t, '<w:sz w:val="40"/><w:szCs w:val="40"/>'),
    })),
  ];
  const chars = layoutCharacters(doc.characters).map(l => ({ body: docxLine(l) }));
  if (chars.length) chars[0].pPr = '<w:pageBreakBefore/>';

  const body = sc ? docxScenarioBody(doc.blocks) : layoutBody(doc.blocks).map(l => ({ body: docxLine(l) }));
  if (!body.length) body.push({});

  const back = [
    ...blanks(10),
    ...lines(doc.backCover.text || doc.cover.author).map(t => ({ body: docxText('　'.repeat(12) + t) })),
  ];

  return `${XML_HEAD}<w:document ${W_NS}><w:body>` +
    docxParas([...cover, ...chars], docxSect(24986)) +
    docxParas(body, docxSect(18739, 'rId3')) +
    docxParas(back) + docxSect(24986, 'rId4') +
    '</w:body></w:document>';
}

// 本文のフッター。見本と同じく、左に偶数・右に奇数のノンブルを全角スペースで振り分ける
function docxNombreFooter() {
  const r = s => `<w:r>${s}</w:r>`;
  const fld = type => r(`<w:fldChar w:fldCharType="${type}"/>`);
  const instr = s => r(`<w:instrText xml:space="preserve">${s}</w:instrText>`);
  const nombre = (expr, sample) => fld('begin') + instr(' = ') + fld('begin') + instr(' PAGE ') + fld('end') +
    instr(`${expr} `) + fld('separate') + r(`<w:t>${sample}</w:t>`) + fld('end');
  return `${XML_HEAD}<w:ftr ${W_NS}><w:p><w:pPr><w:jc w:val="left"/></w:pPr>` +
    docxText('　'.repeat(13)) + nombre('*2', 2) + docxText('　'.repeat(26)) + nombre('*2-1', 1) +
    '</w:p></w:ftr>';
}

// sc：シナリオセンター式（本文を流し込み、柱・ト書き・セリフのスタイルを当てる）
function buildDocxFile(doc, sc = false) {
  const T = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`;
  const part = (name, type) => `<Override PartName="/word/${name}" ContentType="${T}.${type}+xml"/>`;
  const zip = buildZip([
    ['[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      part('document.xml', 'document.main') + part('styles.xml', 'styles') + part('settings.xml', 'settings') +
      part('footer1.xml', 'footer') + part('footer2.xml', 'footer') +
      (sc ? part('numbering.xml', 'numbering') : '') + '</Types>'],
    ['_rels/.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rel('rId1', 'officeDocument', 'word/document.xml') + '</Relationships>'],
    ['word/_rels/document.xml.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rel('rId1', 'styles', 'styles.xml') + rel('rId2', 'settings', 'settings.xml') +
      rel('rId3', 'footer', 'footer1.xml') + rel('rId4', 'footer', 'footer2.xml') +
      (sc ? rel('rId5', 'numbering', 'numbering.xml') : '') + '</Relationships>'],
    ['word/document.xml', docxDocument(doc, sc)],
    ['word/styles.xml', `${XML_HEAD}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr>` +
      '<w:rFonts w:ascii="ＭＳ 明朝" w:eastAsia="ＭＳ 明朝" w:hAnsi="ＭＳ 明朝"/><w:kern w:val="2"/>' +
      '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="ja-JP" w:bidi="ar-SA"/>' +
      '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl w:val="0"/><w:jc w:val="both"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      (sc ? SC_STYLES : '') + '</w:styles>'],
    ['word/settings.xml', `${XML_HEAD}<w:settings ${W_NS}><w:defaultTabStop w:val="996"/>` +
      '<w:characterSpacingControl w:val="compressPunctuation"/><w:compat>' +
      '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>' +
      '</w:compat></w:settings>'],
    ['word/footer1.xml', docxNombreFooter()],
    // 裏表紙のフッター。付けないと本文のノンブルを引き継いでしまう
    ['word/footer2.xml', `${XML_HEAD}<w:ftr ${W_NS}><w:p/></w:ftr>`],
    ...(sc ? [['word/numbering.xml', SC_NUMBERING]] : []),
  ]);
  return new File([zip], `${fileBase(doc)}.docx`, { type: `${T}.document` });
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = ~0;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return ~c >>> 0;
}

// リトルエンディアンの整数を並べる。fields は [値, バイト数] の配列
function le(...fields) {
  const out = new Uint8Array(fields.reduce((s, [, n]) => s + n, 0));
  const v = new DataView(out.buffer);
  let p = 0;
  for (const [x, n] of fields) {
    if (n === 4) v.setUint32(p, x, true); else v.setUint16(p, x, true);
    p += n;
  }
  return out;
}

// 無圧縮（stored）のZIP。files は [名前, 文字列] の配列。日付は1980/1/1にしておく
function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0, centralSize = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const common = [[20, 2], [0, 2], [0, 2], [0, 2], [0x21, 2], [crc, 4], [data.length, 4], [data.length, 4], [n.length, 2], [0, 2]];
    const local = le([0x04034b50, 4], ...common);
    parts.push(local, n, data);
    const c = le([0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]);
    central.push(c, n);
    centralSize += c.length + n.length;
    offset += local.length + n.length + data.length;
  }
  const end = le([0x06054b50, 4], [0, 2], [0, 2], [files.length, 2], [files.length, 2], [centralSize, 4], [offset, 4], [0, 2]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

// プレーンテキスト：本文だけを段落ごとに1行。字下げもルビも付けない
function plainText(doc) {
  return bodyParas(doc.blocks).map(p => parseRuby(toFull(p.text)).text).join('\n');
}

async function copyToClipboard(plain, html) {
  if (html && window.ClipboardItem && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
      return;
    } catch { /* writeText にフォールバック */ }
  }
  await navigator.clipboard.writeText(plain);
}

async function exportBackup(doc) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  await saveFile(new File([blob], `${fileBase(doc)}.json`, { type: blob.type }));
}

function fileBase(doc) {
  return (doc.cover.title || '無題').replace(/[\\/:*?"<>|]/g, '_');
}

// iPhoneでは共有シート（「ファイルに保存」など）、それ以外はダウンロード
async function saveFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
