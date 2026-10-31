// 書き出し：PDF（画像）、印刷、Word用コピー、バックアップ


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
  const W = 842, H = 595; // A4横（pt）
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
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
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

// 原稿用紙どおり：20字で改行し、字下げは全角スペース
function gridText(doc) {
  return layoutBody(doc.blocks).map(lineToString).join('\n');
}

// 段落ごと：テキストは1字目だけ字下げ、HTMLはぶら下げインデントで2行目以降も揃える。
// ルビはテキストでは ｜親文字《ふりがな》 のまま、HTMLでは <ruby> にする
function paragraphContent(doc) {
  const paras = bodyParas(doc.blocks).map(p => ({ ...p, text: toFull(p.text) }));
  const plain = paras.map(p => (p.type === 'togaki' ? '　　　' : p.cont ? '　' : '') + p.text).join('\n');
  const style = {
    hashira: 'margin:0 0 0 1em;text-indent:-1em',
    togaki: 'margin:0 0 0 3em',
    serifu: 'margin:0 0 0 1em;text-indent:-1em',
    serifuCont: 'margin:0 0 0 1em',
    none: 'margin:0',
  };
  const html = '<div style="font-family:\'游明朝\',\'Yu Mincho\',\'ヒラギノ明朝 ProN\',serif">' +
    paras.map(p => {
      const { text, rubies } = parseRuby(p.text);
      const body = rubyHtml(Array.from(text), rubies, (base, ruby) => `<ruby>${base}<rt>${ruby}</rt></ruby>`);
      return `<p style="${style[p.cont ? 'serifuCont' : p.type]}">${body}</p>`;
    }).join('') + '</div>';
  return { plain, html };
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
