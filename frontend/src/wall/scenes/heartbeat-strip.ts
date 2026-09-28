// 心電圖版面（heartbeat.ts）的「醫囑」紙條：像心電圖機印出來的熱感應紙，從畫面下緣一格一格吐出來。
// 紙條內容在這個窗格裡不會變，所以在 init() 先畫進自己的一張 Layer2D（連陰影、微微的歪斜一起），
// 只上傳一次貼圖，之後每格只改它在畫面上的位置——Canvas 上傳貼圖是這台機器最貴的事，不能每格做。
import { Layer2D } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { fitText, type FitResult } from '../engine/text';
import type { Msg } from '../engine/scene';
import { signature, drawHeart } from './_motifs';

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
// 紙條的直向版面（紙條座標，y 向下）：印的心電圖 → 抬頭列 → 雙細線 → 主文 → 簽名列
const Y_TRACE = 40, Y_HEAD = 100, Y_RULE = 118, BODY_GAP = 30, SIG_GAP = 58, BOTTOM = 30;
/** 主文以外固定佔掉的高度（從紙頂到簽名列基線，扣掉主文本身）：版面算主文最大高度用。 */
export const STRIP_FIXED = Y_RULE + BODY_GAP + SIG_GAP;
const BLEED = 120; // 紙在簽名列下面再延伸這麼長（一定超出畫面下緣，看起來是從機器裡拉出來的）
const TILT = -0.006; // 紙微微歪一點（實體的紙，不是介面上的卡片）

/**
 * 畫一張紙條。`trace(x01)` 回傳紙頂印的小段心電圖（-1..1），`body` 是主文（留言或邀請）。
 * `maxW/maxH` 是主文最大的框；紙寬依主文實際寬度收，短留言就是一張窄窄的收據。
 */
export function buildStrip(o: {
  head: string; tag: string; body: string; bodyFamily: string; sig: string; foot: string;
  maxW: number; maxH: number; min: number; max: number; trace: (x01: number) => number;
}): Strip {
  const meas = document.createElement('canvas').getContext('2d')!;
  const fit = fitText(meas, o.body, o.bodyFamily, o.maxW, o.maxH, { min: o.min, max: o.max, lineHeight: 1.3, maxLines: 5 });
  meas.font = font(F.mono(500), 16);
  const footW = meas.measureText(o.foot).width;
  meas.font = font(F.hand(400), 32);
  const sigW = meas.measureText(o.sig).width;
  const w = Math.round(Math.max(560, fit.width + 2 * PAD_X, sigW + footW + 2 * PAD_X + 60));
  const yTrace = Y_TRACE, yHead = Y_HEAD, yRule = Y_RULE;
  const yBody = yRule + BODY_GAP + fit.size * 0.92;
  const ySig = yRule + BODY_GAP + fit.height + SIG_GAP;
  const contentH = ySig + BOTTOM;
  const h = contentH + BLEED;
  const pad = 48;
  const layer = new Layer2D(Math.ceil(w + 2 * pad), Math.ceil(h + 2 * pad));
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
  c.save();
  c.shadowColor = rgba('ink', 0.75);
  c.shadowBlur = 36;
  c.shadowOffsetY = 14;
  edge();
  c.fillStyle = rgba('paper');
  c.fill();
  c.restore();
  // 心電圖紙的格子：1 mm 細格、5 mm 粗格（用訊號色，每個主題的紙看起來都像真的心電圖紙）
  c.save();
  edge();
  c.clip();
  for (let x = 12; x < w; x += 12) {
    const major = (x / 12) % 5 === 0;
    c.fillStyle = rgba('signal', major ? 0.22 : 0.1);
    c.fillRect(x, 0, major ? 1.2 : 0.8, h);
  }
  for (let y = 12; y < h; y += 12) {
    const major = (y / 12) % 5 === 0;
    c.fillStyle = rgba('signal', major ? 0.22 : 0.1);
    c.fillRect(0, y, w, major ? 1.2 : 0.8);
  }
  // 紙面一點點不均勻（熱感應紙會有的淡淡色差），避免一整片死白
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, rgba('sepia', 0.035));
  g.addColorStop(0.5, rgba('sepia', 0));
  g.addColorStop(1, rgba('sepia', 0.05));
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.restore();

  // 紙頂印的一小段心電圖（這台機器剛剛量到的，兩個人的第一下心跳）
  c.save();
  c.strokeStyle = rgba('sepia', 0.78);
  c.lineWidth = 1.6;
  c.lineJoin = 'round';
  c.beginPath();
  const x0 = PAD_X, x1 = w - PAD_X;
  for (let x = x0; x <= x1; x += 1.5) {
    const y = yTrace - 30 * o.trace((x - x0) / (x1 - x0)) + 10;
    if (x === x0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.stroke();
  c.restore();

  c.textBaseline = 'alphabetic';
  // 抬頭：醫囑 Rx ………… 編號
  c.fillStyle = rgba('sepia');
  c.font = font(F.hei(700), 30);
  c.letterSpacing = '8px';
  c.fillText(o.head, PAD_X, yHead);
  const hw = c.measureText(o.head).width;
  c.letterSpacing = '0px';
  c.font = font(F.serif(600, true), 36);
  c.fillText('Rx', PAD_X + hw + 10, yHead);
  c.font = font(F.mono(500), 16);
  c.letterSpacing = '3px';
  c.textAlign = 'right';
  c.fillStyle = rgba('sepia', 0.72);
  c.fillText(o.tag, w - PAD_X, yHead);
  c.textAlign = 'left';
  c.letterSpacing = '0px';
  c.fillStyle = rgba('sepia', 0.5);
  c.fillRect(PAD_X, yRule, w - 2 * PAD_X, 1.2);
  c.fillRect(PAD_X, yRule + 4, w - 2 * PAD_X, 0.6);

  // 主文（留言）：手寫字、墨色。留言裡的 ♥ 換成我們自己畫的玫瑰色愛心（雙色感熱紙印的紅字），
  // 字寬照字型量（斷行時就是用這個寬度算的）
  c.font = font(o.bodyFamily, fit.size);
  fit.lines.forEach((ln, i) => {
    const y = yBody + i * fit.lineHeight;
    let x = PAD_X;
    for (const part of ln.split(/(♥)/)) {
      if (!part) continue;
      const pw = c.measureText(part).width;
      if (part === '♥') drawHeart(c, x + pw / 2, y - fit.size * 0.4, Math.min(pw, fit.size) * 0.78, mixRgba('rose', 'sepia', 0.22, 0.95));
      else { c.fillStyle = rgba('sepia', 0.95); c.fillText(part, x, y); }
      x += pw;
    }
  });

  // 簽名列：左邊署名、右邊冷面的註記
  c.font = font(F.hand(400), 32);
  c.fillStyle = rgba('sepia', 0.8);
  c.fillText(o.sig, PAD_X, ySig);
  c.font = font(F.mono(500), 16);
  c.letterSpacing = '2px';
  c.textAlign = 'right';
  c.fillStyle = rgba('sepia', 0.62);
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
