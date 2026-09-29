// 心電圖版面（heartbeat.ts）的「醫囑」紙條：心電圖機印出來的熱感應紙，在前景從畫面下緣一格一格送上來。
// 紙條是這個版面的焦點（MV 融合原則：留言是畫面世界裡的東西）：主文（留言）大、墨色深；抬頭、編號、印的小段心電圖、
// 格子都是紙本來就有的東西，所以小、淡，不搶字。
// 紙條內容在這個窗格裡不會變，所以在 init() 先畫進自己的一張 Layer2D（連陰影、微微的歪斜、光線一起），
// 只上傳一次貼圖，之後每格只改它在畫面上的位置——Canvas 上傳貼圖是這台機器最貴的事，不能每格做。
import { Layer2D } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { fitText, type FitResult } from '../engine/text';
import type { Msg } from '../engine/scene';
import { signature, drawHeart } from './_motifs';
import { sigV2, fitClauses } from './_v2';

export interface Strip {
  /** 紙條畫在這張圖層上（含四周陰影的邊 pad）。 */
  layer: Layer2D;
  /** 紙的寬、到簽名列為止的內容高度（紙本身往下延伸出畫面）。 */
  w: number;
  contentH: number;
  /** 畫布四周留給陰影的邊。 */
  pad: number;
  /** 畫布的邏輯高度（含往下延伸的紙）。 */
  h: number;
  fit: FitResult;
  /** 簽名列的基線（紙條座標）：版面用它讓最後一行字離畫面下緣至少 96 px。 */
  sigY: number;
}

const PAD_X = 44;
// 紙條的直向版面（紙條座標，y 向下）：印的心電圖 → 抬頭列 → 細線 → 主文 → 簽名列。抬頭壓得很矮，高度留給主文
const Y_TRACE = 26, Y_HEAD = 66, Y_RULE = 80, BODY_GAP = 26, SIG_GAP = 50, BOTTOM = 30;
/** 主文以外固定佔掉的高度（從紙頂到簽名列基線，扣掉主文本身）：版面算主文最大高度用。 */
export const STRIP_FIXED = Y_RULE + BODY_GAP + SIG_GAP;
const BLEED = 140; // 紙在簽名列下面再延伸這麼長（一定超出畫面下緣，看起來是從機器裡拉出來、離鏡頭很近）
const TILT = -0.011; // 紙微微歪一點（實體的紙，不是介面上的卡片）

/**
 * 畫一張紙條。`trace(x01)` 回傳紙頂印的小段心電圖（-1..1），`body` 是主文（留言或邀請）。
 * `maxW/maxH` 是主文最大的框；紙寬依主文實際寬度收，短留言就是一張窄窄的收據。
 */
export function buildStrip(o: {
  head: string; tag: string; body: string; bodyFamily: string; sig: string; foot: string;
  maxW: number; maxH: number; min: number; max: number; trace: (x01: number) => number;
}): Strip {
  const meas = document.createElement('canvas').getContext('2d')!;
  // v2：照標點斷行（字級只小一點點也值得），署名 26～32
  const opt = { min: o.min, max: o.max, lineHeight: 1.26, maxLines: 5 };
  const byW = fitText(meas, o.body, o.bodyFamily, o.maxW, o.maxH, opt), byC = fitClauses(meas, o.body, o.bodyFamily, o.maxW, o.maxH, opt);
  const fit = byC && byC.size >= byW.size * 0.9 ? byC : byW;
  const sigSize = sigV2(fit.size);
  meas.font = font(F.mono(500), 15);
  const footW = meas.measureText(o.foot).width;
  meas.font = font(F.hand(400), sigSize);
  const sigW = meas.measureText(o.sig).width;
  const w = Math.round(Math.max(520, fit.width + 2 * PAD_X, sigW + footW + 2 * PAD_X + 60));
  const yRule = Y_RULE;
  const yBody = yRule + BODY_GAP + fit.size * 0.92;
  const ySig = yRule + BODY_GAP + fit.height + SIG_GAP;
  const contentH = ySig + BOTTOM;
  const h = contentH + BLEED;
  const pad = 56;
  const layer = new Layer2D(Math.ceil(w + 2 * pad), Math.ceil(h + 2 * pad), undefined, { fast: true });
  const c = layer.ctx;
  c.translate(pad, pad);
  c.rotate(TILT);

  // 紙的外形：上緣是撕下來的鋸齒（熱感應紙的切刀痕），下面一路延伸
  const edge = () => {
    c.beginPath();
    const tooth = 9;
    c.moveTo(0, h);
    c.lineTo(0, 4);
    for (let x = 0; x < w; x += tooth) {
      c.lineTo(Math.min(w, x + tooth / 2), 0);
      c.lineTo(Math.min(w, x + tooth), 4);
    }
    c.lineTo(w, h);
    c.closePath();
  };
  // 紙離鏡頭近、離監護儀遠：陰影大而軟，落在後面的螢幕上
  c.save();
  c.shadowColor = rgba('ink', 0.85);
  c.shadowBlur = 48;
  c.shadowOffsetY = 18;
  c.shadowOffsetX = -10;
  edge();
  c.fillStyle = rgba('paper');
  c.fill();
  c.restore();
  c.save();
  edge();
  c.clip();
  // 心電圖紙的格子：只剩很淡的 5 mm 粗格（每個主題的訊號色），主文的字才乾淨
  for (let x = 60; x < w; x += 60) { c.fillStyle = rgba('signal', 0.1); c.fillRect(x, 0, 1, h); }
  for (let y = 60; y < h; y += 60) { c.fillStyle = rgba('signal', 0.1); c.fillRect(0, y, w, 1); }
  // 光線：上面被監護儀照亮，越往下越暗（紙往鏡頭這邊彎、走出光線）；左右一點點色差
  const gv = c.createLinearGradient(0, 0, 0, h);
  gv.addColorStop(0, rgba('ink', 0));
  gv.addColorStop(Math.min(0.95, (ySig + 10) / h), rgba('ink', 0.07));
  gv.addColorStop(1, rgba('ink', 0.4));
  c.fillStyle = gv;
  c.fillRect(0, 0, w, h);
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, rgba('sepia', 0.04));
  g.addColorStop(0.5, rgba('sepia', 0));
  g.addColorStop(1, rgba('sepia', 0.06));
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.restore();

  // 紙頂印的一小段心電圖（這台機器剛剛量到的，兩個人的第一下心跳）：細、淡
  c.save();
  c.strokeStyle = rgba('sepia', 0.42);
  c.lineWidth = 1.3;
  c.lineJoin = 'round';
  c.beginPath();
  const x0 = PAD_X, x1 = w - PAD_X;
  for (let x = x0; x <= x1; x += 1.5) {
    const y = Y_TRACE - 16 * o.trace((x - x0) / (x1 - x0)) + 4;
    if (x === x0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
  c.restore();

  c.textBaseline = 'alphabetic';
  // 抬頭：醫囑 Rx ………… 編號（小、淡：紙本來印好的字）
  c.fillStyle = rgba('sepia', 0.62);
  c.font = font(F.hei(700), 20);
  c.letterSpacing = '6px';
  c.fillText(o.head, PAD_X, Y_HEAD);
  const hw = c.measureText(o.head).width;
  c.letterSpacing = '0px';
  c.font = font(F.serif(600, true), 24);
  c.fillText('Rx', PAD_X + hw + 6, Y_HEAD);
  c.font = font(F.mono(500), 14);
  c.letterSpacing = '3px';
  c.textAlign = 'right';
  c.fillStyle = rgba('sepia', 0.5);
  c.fillText(o.tag, w - PAD_X, Y_HEAD);
  c.textAlign = 'left';
  c.letterSpacing = '0px';
  c.fillStyle = rgba('sepia', 0.3);
  c.fillRect(PAD_X, yRule, w - 2 * PAD_X, 1);

  // 主文（留言）：手寫字、深墨色，整個畫面最大的字。留言裡的 ♥ 換成我們自己畫的玫瑰色愛心（雙色感熱紙印的紅字），
  // 字寬照字型量（斷行時就是用這個寬度算的）
  c.font = font(o.bodyFamily, fit.size);
  fit.lines.forEach((ln, i) => {
    const y = yBody + i * fit.lineHeight;
    let x = PAD_X;
    for (const part of ln.split(/(♥)/)) {
      if (!part) continue;
      const pw = c.measureText(part).width;
      if (part === '♥') drawHeart(c, x + pw / 2, y - fit.size * 0.4, Math.min(pw, fit.size) * 0.78, mixRgba('rose', 'sepia', 0.22, 0.95));
      else { c.fillStyle = rgba('sepia', 0.97); c.fillText(part, x, y); }
      x += pw;
    }
  });

  // 簽名列：左邊署名（讀得到）、右邊冷面的註記（很淡）
  c.font = font(F.hand(400), sigSize);
  c.fillStyle = rgba('sepia', 0.85);
  c.fillText(o.sig, PAD_X, ySig);
  c.font = font(F.mono(500), 15);
  c.letterSpacing = '2px';
  c.textAlign = 'right';
  c.fillStyle = rgba('sepia', 0.48);
  c.fillText(o.foot, w - PAD_X, ySig);
  c.textAlign = 'left';
  c.letterSpacing = '0px';
  return { layer, w, contentH, pad, h, fit, sigY: ySig };
}

/** 留言的紙條內容。 */
export function msgStrip(m: Msg) {
  return {
    head: '醫囑',
    tag: `No.${String(m.n).padStart(3, '0')}${m.couple ? '  ·  新人' : ''}`,
    body: m.text,
    sig: signature(m.name),
    foot: m.couple ? 'FROM THE COUPLE' : '療程：一輩子',
  };
}

/** 沒有主打留言時的紙條：邀請大家留言（冷面的「用法」）。 */
export const INVITE_STRIP = {
  head: '醫囑',
  tag: 'No.---',
  body: '掃描右下角 QR code，把你的祝福寫上大螢幕。',
  sig: '—— 值班的大螢幕',
  foot: '用法：不限次數',
};

export const STRIP_TEXT = '醫囑療程：一輩子新人用法不限次數掃描右下角把你的祝福寫上大螢幕值班的大螢幕一位賓客——';
