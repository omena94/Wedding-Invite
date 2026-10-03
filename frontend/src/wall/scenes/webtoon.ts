// 條漫（雙語・批次 B1，亮）：一條直向的條漫，一格一格往上捲——一拍捲一小步（outExpo），每句歌詞開始時那一格剛好捲到中間。
// 格子裡是網點＋墨線的漫畫空鏡（窗邊的兩杯熱飲、亮著一扇窗的公寓、公車站靠著的兩把傘、響著的手機、屋頂的星空、
// 黃昏的摩天輪、停在樹下的腳踏車、插著信的信箱；大螢幕的版面不畫人物，只畫物件與場景），格子裡的小東西會動（熱氣、雨、閃爍的星、
// 手機震動、流星、飄落的花瓣）。
//  - 兩行歌詞是每一格的對話框：中文大（黑體）、原文小一號在同一個框裡的下一行，各自照自己的逐字時間亮；
//    沒有翻譯的歌對話框只有一行（框跟著變小）。對話框的尾巴指向格子裡「說話」的東西（手機、窗、收音機…）。
//  - 主打留言是右邊「這一話的作者的話」：一張細框的小卡，手寫字、署名在最後一行下面；上面一行小小的話數與歌名，
//    下面一顆愛心與按讚數（每個小節線 +1、愛心跳一下）。沒有留言時作者的話寫邀請。
//  - 條漫整條微微歪一點、下面有影子，鏡頭慢慢推近（不要像一張平平的介面截圖）。
//  - 標準 v2：留言 40～60 px、卡 ≤ 640×430（右邊）；中文 40～52、原文 32～40（_b1.ts）。右下角 HUD 底下是乾淨的紙。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, beatAfter, signature, fillWithHearts, drawHeart, type LyricStyle } from './_motifs';
import { V2, lyricV2 } from './_v2';
import { biLayout, drawBi, fitMsgV2, type BiLay, type MsgFit } from './_b1';
import { paperSignal } from './_t19';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'screen', paper: true, energy: [0.2, 0.85], bars: [4, 8] };

/** 條漫那一欄（畫面 x）與格子寬、格與格之間的空白。 */
const STRIP = { x: 300, w: 760, gap: 56 };
/** 右邊：作者的話。 */
const NOTE = { x: 1170, y: 250, w: 640, h: 430 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const MSG_FAM = F.hand(700);
type Motif = 'mugs' | 'flat' | 'umbrellas' | 'phone' | 'roof' | 'ferris' | 'bike' | 'mailbox';
const MOTIFS: Motif[] = ['mugs', 'flat', 'umbrellas', 'phone', 'roof', 'ferris', 'bike', 'mailbox'];
/** 每種格子：對話框尾巴指向哪裡（格子內的比例座標）、格子裡會動的是什麼。 */
const SPEAKER: Record<Motif, [number, number]> = {
  mugs: [0.5, 0.72], flat: [0.62, 0.55], umbrellas: [0.35, 0.7], phone: [0.5, 0.7], roof: [0.3, 0.8], ferris: [0.6, 0.62], bike: [0.45, 0.75], mailbox: [0.5, 0.66],
};

const BG = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 紙：上面亮一點；很淡的方格（像漫畫稿紙）
    vec3 col = mix(C_PAPER, mix(C_PAPER, C_SEPIA, 0.05), smoothstep(0.0, ${H}.0, p.y));
    vec2 g = abs(mod(p, 48.0) - 24.0);
    col = mix(col, mix(C_PAPER, C_SIGNAL, 0.18), (1.0 - smoothstep(0.4, 1.2, min(g.x, g.y) - 22.8)) * 0.35);
    fragColor = vec4(col, 1.0);
  }`, {});

interface Panel { y: number; h: number; motif: Motif; line: Line | null; art: Layer2D; seed: number; t0: number; bubble: { x: number; y: number } }

export default class Webtoon extends Scene {
  bg = shared('webtoon.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 作者的話（不會變）：init 畫一次。 */
  note = this.track(new Layer2D(NOTE.w + 40, NOTE.h + 40, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 211 + (this.msg?.id ?? 0) * 29) >>> 0;
  panels: Panel[] = [];
  fit: MsgFit | null = null;
  msgSize: number | null = null;
  noteH = 300;
  tNote = 0;
  ep = 1;
  lyr: LyricStyle = { family: F.hei(700), size: V2.lyrMax, minSize: V2.lyrMin, maxWidth: 620, align: 'center', lineHeight: 1.2, active: paperSignal(), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.3) };
  head = '';

  override async init() {
    const { audio: au, lyrics, start: s, end: e, song } = this.ctx;
    const m = this.msg;
    const sig = m ? signature(m.name) : '';
    this.ep = 1 + (song.index || 1);
    this.head = `條漫  ·  第 ${this.ep} 話${song.title ? '  ·  ' + song.title : ''}`;
    await loadText(`${m?.text ?? ''}${sig}${this.head}${INVITE}作者的話本話的主角是你按讚FROM THE COUPLE·新人No.0123456789`);
    if (m) {
      const c = this.note.ctx;
      this.fit = fitMsgV2(c, m.text, MSG_FAM, NOTE.w - 80, NOTE.h - 110, { lineHeight: 1.32 });
      this.msgSize = this.fit.fit.size;
    }
    this.lyr = { ...this.lyr, size: lyricV2(this.msgSize), active: paperSignal() };
    this.tNote = beatAfter(au, s + 0.05);
    this.drawNote(m, sig);
    // ---- 格子：這個窗格前後會唱到的每一句一格；沒有歌詞就每兩小節一格空鏡
    const lines = lyrics.linesIn(s - 8, e + 8);
    const keys: { line: Line | null; t0: number }[] = lines.length
      ? lines.map((l) => ({ line: l, t0: l.start - 0.35 }))
      : Array.from({ length: Math.ceil((au.barAt(e) - au.barAt(s)) / 2) + 3 }, (_, i) => ({ line: null, t0: au.timeOfBar(Math.floor(au.barAt(s)) + 2 * (i - 1)) }));
    let y = 0, last = -1;
    keys.forEach((k, i) => {
      const sd = hash(this.seed, k.line?.i ?? i, 7);
      let mi = Math.floor(sd * MOTIFS.length);
      if (mi === last) mi = (mi + 3) % MOTIFS.length;
      last = mi;
      const h = Math.round(440 + 110 * hash(this.seed, i, 3));
      const art = this.track(new Layer2D(STRIP.w, h, undefined, { fast: true }));
      const motif = MOTIFS[mi]!;
      this.panels.push({ y, h, motif, line: k.line, art, seed: sd, t0: k.t0, bubble: { x: STRIP.w * (0.5 + (hash(this.seed, i, 5) - 0.5) * 0.12), y: 0 } });
      this.drawPanel(art, motif, h, sd);
      y += h + STRIP.gap;
    });
  }

  // ---------------------------------------------------------------- 格子的畫（墨線＋網點＋一個點綴色）
  private tone(c: CanvasRenderingContext2D, a = 0.32) {
    // 網點：6 px 一格的小圓點（漫畫的網點紙）
    const cv = document.createElement('canvas'); cv.width = cv.height = 12;
    const q = cv.getContext('2d')!;
    q.fillStyle = rgba('sepia', a);
    q.beginPath(); q.arc(3, 3, 1.6, 0, TAU); q.arc(9, 9, 1.6, 0, TAU); q.fill();
    const pat = c.createPattern(cv, 'repeat')!;
    pat.setTransform(new DOMMatrix().scale(0.5, 0.5));
    return pat;
  }

  private drawPanel(L: Layer2D, motif: Motif, h: number, sd: number) {
    const c = L.ctx, w = STRIP.w;
    L.clear();
    c.fillStyle = mixRgba('bone', 'paper', 0.15);
    c.fillRect(0, 0, w, h);
    const ink = rgba('sepia', 0.9), acc = mixRgba('paper', 'signal', 0.55), tone = this.tone(c), tone2 = this.tone(c, 0.55);
    c.strokeStyle = ink; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
    const line = (pts: number[][]) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x!, y!) : c.moveTo(x!, y!))); c.stroke(); };
    const rnd = (k: number) => hash(sd * 1000, k);
    const gy = h * 0.8;
    switch (motif) {
      case 'mugs': {
        // 窗：窗框、窗外斜斜的雨、窗台；兩個馬克杯
        c.fillStyle = tone; c.fillRect(90, 50, w - 180, gy - 110);
        c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1.5;
        for (let i = 0; i < 40; i++) { const x = 100 + rnd(i) * (w - 200), y = 60 + rnd(i + 50) * (gy - 150); line([[x, y], [x - 8, y + 26]]); }
        c.strokeStyle = ink; c.lineWidth = 5;
        c.strokeRect(90, 50, w - 180, gy - 110); line([[w / 2, 50], [w / 2, gy - 60]]); line([[90, (gy - 10) / 2], [w - 90, (gy - 10) / 2]]);
        c.lineWidth = 4; line([[40, gy - 50], [w - 40, gy - 50]]);
        for (const [mx, hi] of [[w * 0.4, 0], [w * 0.58, 1]] as const) {
          c.fillStyle = hi ? acc : rgba('bone');
          c.beginPath(); c.roundRect(mx - 42, gy - 140, 84, 90, [4, 4, 16, 16]); c.fill(); c.stroke();
          c.beginPath(); c.arc(mx + (hi ? 48 : -48), gy - 100, 20, hi ? -1.3 : 1.8, hi ? 1.3 : 4.5); c.stroke();
        }
        break;
      }
      case 'flat': {
        // 夜裡的公寓：網點的夜空、月亮、一整面窗，只有一扇亮著（點綴色＋小愛心）
        c.fillStyle = tone2; c.fillRect(0, 0, w, h);
        c.fillStyle = rgba('bone'); c.beginPath(); c.arc(w * 0.16, 90, 38, 0, TAU); c.fill();
        c.fillStyle = tone2; c.beginPath(); c.arc(w * 0.16 + 16, 80, 34, 0, TAU); c.fill();
        c.fillStyle = mixRgba('bone', 'paper', 0.3); c.fillRect(w * 0.3, 70, w * 0.62, h - 70); c.strokeRect(w * 0.3, 70, w * 0.62, h - 70);
        const cols = 4, rows = Math.floor((h - 110) / 92), lit = Math.floor(rnd(1) * cols * rows);
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
          const x = w * 0.34 + k * (w * 0.14), y = 100 + r * 92;
          const on = r * cols + k === lit;
          c.fillStyle = on ? acc : tone2;
          c.fillRect(x, y, w * 0.09, 56); c.strokeRect(x, y, w * 0.09, 56);
          if (on) drawHeart(c, x + w * 0.045, y + 30, 18);
        }
        break;
      }
      case 'umbrellas': {
        // 公車站：站牌、長椅、靠著的兩把傘、地上的水窪
        c.lineWidth = 4;
        line([[w * 0.78, gy], [w * 0.78, 80]]); c.fillStyle = acc; c.beginPath(); c.arc(w * 0.78, 100, 36, 0, TAU); c.fill(); c.stroke();
        c.fillStyle = rgba('bone'); c.fillRect(w * 0.12, gy - 90, w * 0.46, 22); c.strokeRect(w * 0.12, gy - 90, w * 0.46, 22);
        line([[w * 0.16, gy - 68], [w * 0.16, gy]]); line([[w * 0.54, gy - 68], [w * 0.54, gy]]);
        // 收起來的傘：尖端著地、傘布往上變寬再收到傘柄、最上面一個彎鉤，斜斜地靠在長椅邊
        for (const [ux, fill, lean] of [[w * 0.3, rgba('bone'), -0.1], [w * 0.4, acc, 0.12]] as const) {
          c.save(); c.translate(ux, gy - 2); c.rotate(lean);
          c.fillStyle = fill;
          c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(-26, -90, -18, -160); c.lineTo(-6, -190); c.lineTo(6, -190); c.lineTo(18, -160); c.quadraticCurveTo(26, -90, 0, 0); c.closePath(); c.fill(); c.stroke();
          line([[-12, -120], [10, -60]]);
          line([[0, -190], [0, -236]]);
          c.beginPath(); c.arc(-14, -236, 14, 0, Math.PI, true); c.stroke();
          c.restore();
        }
        line([[20, gy], [w - 20, gy]]);
        c.fillStyle = tone; c.beginPath(); c.ellipse(w * 0.62, gy + 30, 130, 16, 0, 0, TAU); c.fill();
        break;
      }
      case 'phone': {
        // 桌上的手機：螢幕上的對話泡泡與一顆愛心通知
        c.fillStyle = tone; c.fillRect(0, gy - 30, w, h - gy + 30);
        line([[0, gy - 30], [w, gy - 30]]);
        c.save(); c.translate(w * 0.5, gy - 150); c.rotate(-0.12);
        c.fillStyle = rgba('bone'); c.beginPath(); c.roundRect(-90, -170, 180, 330, 26); c.fill(); c.stroke();
        c.fillStyle = tone; c.fillRect(-72, -140, 144, 260);
        c.fillStyle = rgba('bone');
        for (const [bx, by, bw] of [[-60, -120, 100], [-30, -80, 96], [-60, -40, 80]] as const) { c.beginPath(); c.roundRect(bx, by, bw, 28, 12); c.fill(); c.lineWidth = 2; c.stroke(); }
        c.fillStyle = acc; c.beginPath(); c.roundRect(-40, 10, 104, 40, 14); c.fill(); c.stroke();
        drawHeart(c, 12, 30, 22);
        c.restore();
        break;
      }
      case 'roof': {
        // 屋頂的星空：網點的夜、點點的星、屋頂的剪影與天線
        c.fillStyle = tone2; c.fillRect(0, 0, w, h);
        c.fillStyle = rgba('bone');
        for (let i = 0; i < 26; i++) { const x = rnd(i) * w, y = rnd(i + 40) * gy * 0.8, r = 1.5 + 2.5 * rnd(i + 80); c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
        c.fillStyle = rgba('sepia', 0.92);
        c.beginPath(); c.moveTo(0, gy - 60); c.lineTo(w * 0.35, gy - 140); c.lineTo(w * 0.7, gy - 60); c.lineTo(w, gy - 90); c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fill();
        c.strokeStyle = rgba('sepia', 0.92); line([[w * 0.35, gy - 140], [w * 0.35, gy - 230]]); line([[w * 0.3, gy - 210], [w * 0.4, gy - 210]]); line([[w * 0.31, gy - 190], [w * 0.39, gy - 190]]);
        break;
      }
      case 'ferris': {
        // 黃昏的摩天輪：一條條橫的天色網點、輪子、輻條、車廂（有一節是點綴色）
        for (let i = 0; i < 5; i++) { c.fillStyle = this.tone(c, 0.12 + i * 0.07); c.fillRect(0, i * gy / 5, w, gy / 5 + 1); }
        const cx = w * 0.6, cy = gy * 0.52, R = Math.min(gy * 0.42, 220);
        c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke();
        c.lineWidth = 1.5;
        for (let i = 0; i < 12; i++) { const a = i * TAU / 12; line([[cx, cy], [cx + Math.cos(a) * R, cy + Math.sin(a) * R]]); }
        c.lineWidth = 3;
        for (let i = 0; i < 12; i++) { const a = i * TAU / 12 + 0.26; c.fillStyle = i === 2 ? acc : rgba('bone'); c.beginPath(); c.roundRect(cx + Math.cos(a) * R - 14, cy + Math.sin(a) * R, 28, 24, 5); c.fill(); c.stroke(); }
        line([[cx, cy], [cx - 80, h]]); line([[cx, cy], [cx + 80, h]]);
        c.fillStyle = rgba('sepia', 0.85); c.fillRect(0, gy + 20, w, h - gy - 20);
        break;
      }
      case 'bike': {
        // 樹下的腳踏車：樹幹、網點的樹冠、車籃裡的花
        c.fillStyle = tone; c.beginPath(); c.ellipse(w * 0.22, 90, 210, 120, 0, 0, TAU); c.fill();
        c.fillStyle = rgba('bone'); c.fillRect(w * 0.16, 120, 36, gy - 120); c.strokeRect(w * 0.16, 120, 36, gy - 120);
        line([[20, gy], [w - 20, gy]]);
        const bx = w * 0.58, r = 70;
        c.beginPath(); c.arc(bx - 110, gy - r, r, 0, TAU); c.stroke(); c.beginPath(); c.arc(bx + 110, gy - r, r, 0, TAU); c.stroke();
        line([[bx - 110, gy - r], [bx - 20, gy - r - 90], [bx + 70, gy - r - 90], [bx + 110, gy - r]]); line([[bx - 20, gy - r - 90], [bx, gy - r], [bx - 110, gy - r]]); line([[bx, gy - r], [bx + 70, gy - r - 90]]);
        line([[bx + 70, gy - r - 90], [bx + 60, gy - r - 130], [bx + 96, gy - r - 136]]);
        c.fillStyle = rgba('bone'); c.beginPath(); c.roundRect(bx + 86, gy - r - 178, 70, 44, 6); c.fill(); c.stroke();
        c.fillStyle = acc;
        for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(bx + 98 + i * 15, gy - r - 184 - 10 * rnd(i), 12, 0, TAU); c.fill(); c.stroke(); }
        break;
      }
      case 'mailbox': {
        // 草地上的信箱：柱子、圓頂的信箱、插著一封信（封口一顆愛心）
        c.fillStyle = tone; c.fillRect(0, gy, w, h - gy);
        c.fillStyle = rgba('bone'); c.fillRect(w * 0.47, gy - 200, 26, 200); c.strokeRect(w * 0.47, gy - 200, 26, 200);
        c.fillStyle = acc; c.beginPath(); c.moveTo(w * 0.36, gy - 200); c.lineTo(w * 0.36, gy - 290); c.arc(w * 0.48, gy - 290, w * 0.12, Math.PI, TAU); c.lineTo(w * 0.6, gy - 200); c.closePath(); c.fill(); c.stroke();
        c.save(); c.translate(w * 0.48, gy - 330); c.rotate(-0.25);
        c.fillStyle = rgba('bone'); c.fillRect(-60, -40, 120, 70); c.strokeRect(-60, -40, 120, 70);
        line([[-60, -40], [0, 0], [60, -40]]);
        drawHeart(c, 0, 6, 22);
        c.restore();
        c.strokeStyle = rgba('sepia', 0.6); c.lineWidth = 2;
        for (let i = 0; i < 30; i++) { const x = rnd(i) * w; line([[x, gy + 4], [x - 4, gy - 14 - 10 * rnd(i + 9)]]); }
        break;
      }
    }
    // 格線：粗的墨框
    c.strokeStyle = ink; c.lineWidth = 5; c.strokeRect(2.5, 2.5, w - 5, h - 5);
  }

  /** 作者的話：細框的小卡、表頭一行「作者的話」、手寫的留言、署名。 */
  private drawNote(m: Msg | null, sig: string) {
    const L = this.note, c = L.ctx, P = 20;
    L.clear();
    const mf = this.fit;
    const bodyH = mf ? mf.height : 120;
    const h = Math.min(NOTE.h, 70 + bodyH + 40);
    this.noteH = h;
    c.fillStyle = rgba('sepia', 0.1); c.beginPath(); c.roundRect(P + 6, P + 8, NOTE.w, h, 14); c.fill();
    c.fillStyle = mixRgba('bone', 'paper', 0.2); c.beginPath(); c.roundRect(P, P, NOTE.w, h, 14); c.fill();
    c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 1.5; c.stroke();
    // 表頭：一枝鋼筆尖的小圖示＋「作者的話」
    c.save(); c.translate(P + 40, P + 40); c.rotate(0.7);
    c.fillStyle = paperSignal(0.9); c.beginPath(); c.moveTo(0, -14); c.lineTo(8, 4); c.lineTo(0, 16); c.lineTo(-8, 4); c.closePath(); c.fill();
    c.restore();
    c.font = font(F.hei(700), 22); c.fillStyle = rgba('sepia', 0.85); c.textBaseline = 'alphabetic';
    c.fillText('作者的話', P + 64, P + 48);
    c.font = font(F.mono(500), 15); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.5); c.textAlign = 'right';
    c.fillText(m ? (m.couple ? 'FROM THE COUPLE · 新人' : `No.${String(m.n).padStart(3, '0')}`) : '', P + NOTE.w - 26, P + 46);
    c.textAlign = 'left'; c.letterSpacing = '0px';
    c.strokeStyle = rgba('sepia', 0.2); c.lineWidth = 1; c.beginPath(); c.moveTo(P + 26, P + 66); c.lineTo(P + NOTE.w - 26, P + 66); c.stroke();
    const x = P + 40, top = P + 90;
    if (m && mf) {
      const fit = mf.fit;
      c.font = font(MSG_FAM, fit.size); c.fillStyle = rgba('sepia', 0.95);
      const y0 = top + fit.size * 0.9;
      fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x, y0 + i * fit.lineHeight));
      c.font = font(F.hand(400), mf.sig); c.fillStyle = rgba('sepia', 0.68);
      const sw = c.measureText(sig).width;
      c.fillText(sig, Math.max(x, x + Math.max(fit.width, sw) - sw), y0 + (fit.lines.length - 1) * fit.lineHeight + mf.sigDy);
    } else {
      c.font = font(MSG_FAM, 44); c.fillStyle = rgba('sepia', 0.92);
      c.fillText('本話的主角是你。', x, top + 42);
      c.font = font(F.hei(500), 22); c.letterSpacing = '1px'; c.fillStyle = rgba('sepia', 0.62);
      c.fillText(INVITE, x, top + 92);
      c.letterSpacing = '0px';
    }
  }

  /**
   * t 時的捲動位置（條漫座標，對到畫面 y = 540 的那一點）：一拍捲一步（outExpo）。唱一句的時候那一格的對話框停在畫面上半
   * （每拍只往上挪一點點，讀得到），最後兩拍才把下一格捲上來——句子開始時下一格的對話框剛好到位。
   */
  private scroll(t: number) {
    const au = this.ctx.audio, P = this.panels;
    const focus = (i: number) => P[i]!.y + 320;
    let i = 0;
    while (i < P.length - 1 && P[i + 1]!.t0 <= t) i++;
    if (t < P[0]!.t0) return focus(0) - (P[0]!.h + STRIP.gap) * (1 - clamp((t - (P[0]!.t0 - 2)) / 2));
    if (i === P.length - 1) return focus(i) + 14 * Math.max(0, au.beatAt(t) - au.beatAt(P[i]!.t0));
    const b0 = au.beatAt(P[i]!.t0), b1 = au.beatAt(P[i + 1]!.t0);
    const n = Math.max(1, Math.round(b1 - b0));
    const bt = clamp(au.beatAt(t) - b0, 0, n);
    const D = focus(i + 1) - focus(i), small = n > 2 ? Math.min(14, D / n) : 0;
    // 第 k 拍捲到哪裡：前面每拍一小步，最後兩拍分兩大步（六成、四成）
    const at = (k: number) => {
      const lead = Math.max(0, n - 2);
      if (k <= lead) return k * small;
      const rest = D - lead * small;
      return lead * small + rest * (k - lead >= 2 ? 1 : n >= 2 ? 0.6 * (k - lead) : k);
    };
    const k0 = Math.floor(bt);
    return focus(i) + lerp(at(k0), at(Math.min(n, k0 + 1)), ease.outExpo(clamp((bt - k0) / 0.35)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.bg.render(renderer, out);
    const L = this.layer; L.clear();
    const c = L.ctx;
    const inK = prog(t, s, s + 0.35);
    c.globalAlpha = inK;
    // ---- 條漫：整條微微歪一點
    const sc = this.scroll(t);
    const ly = lyricAt(lyrics, t, 30);
    c.save();
    c.translate(STRIP.x + STRIP.w / 2, 540); c.rotate(-0.012); c.translate(-(STRIP.x + STRIP.w / 2), -540);
    for (const p of this.panels) {
      const y = p.y - sc + 540;
      if (y > H + 40 || y + p.h < -40) continue;
      c.fillStyle = rgba('sepia', 0.12); c.fillRect(STRIP.x + 10, y + 12, STRIP.w, p.h);
      c.drawImage(p.art.canvas, STRIP.x, y, STRIP.w, p.h);
      this.alive(c, p, STRIP.x, y, t);
      if (p.line) this.bubble(c, p, STRIP.x, y, t, ly?.line === p.line ? 1 : 0.45);
    }
    c.restore();
    // 捲軸：條漫右邊一條細線，一個小滑塊跟著捲
    const total = this.panels.reduce((a, p) => a + p.h + STRIP.gap, 0);
    c.fillStyle = rgba('sepia', 0.12); c.fillRect(STRIP.x + STRIP.w + 34, 120, 4, 840);
    c.fillStyle = rgba('sepia', 0.45); c.fillRect(STRIP.x + STRIP.w + 34, 120 + 840 * clamp(sc / total), 4, 90);
    // ---- 右邊：話數、作者的話、按讚
    c.font = font(F.mono(500), 16); c.letterSpacing = '3px'; c.fillStyle = rgba('sepia', 0.55);
    c.fillText(this.head, NOTE.x + 20, NOTE.y - 34);
    c.letterSpacing = '0px';
    this.drawNoteProp(c, t);
    const bi = Math.floor(au.barAt(t) + 1e-4), bt = au.timeOfBar(bi);
    const likes = 128 + Math.max(0, bi - Math.floor(au.barAt(s)));
    const pop = t > s + 0.1 ? 1 + 0.35 * Math.exp(-(t - bt) / 0.15) : 1;
    const ly0 = NOTE.y + this.noteH + 70;
    drawHeart(c, NOTE.x + 44, ly0 - 8, 30 * pop);
    c.font = font(F.mono(600), 20); c.fillStyle = rgba('sepia', 0.7);
    c.fillText(`${likes}`, NOTE.x + 72, ly0);
    comp.draw(renderer, L.upload(), out);
    return { paper: 1, bloom: 0.1, bloomThreshold: 1.6, vignette: 0.18, grain: 0.035, zoom: 1 + 0.03 * ease.inOutQuad(f.p) };
  }

  /** 對話框：圓角的白框、尾巴指向格子裡說話的東西；裡面中文一行、原文一行（有翻譯才有）。 */
  private bubble(c: CanvasRenderingContext2D, p: Panel, x0: number, y0: number, t: number, alpha: number) {
    const line = p.line!;
    const bl: BiLay = biLayout(c, line, this.lyr, { sub: { family: F.hei(500), sung: rgba('sepia', 0.82), unsung: rgba('sepia', 0.28) } });
    const mw = Math.max(...bl.main.rows.map((r) => r.width), ...(bl.sub ? bl.sub.rows.map((r) => r.width) : [0]));
    const size = bl.main.size;
    const bw = mw + 70, bh = bl.span + size * 1.25 + 34;
    const cx = x0 + p.bubble.x, top = y0 + 40;
    const [sx, sy] = SPEAKER[p.motif];
    const tx = x0 + STRIP.w * sx, ty = y0 + p.h * sy;
    c.save();
    c.fillStyle = rgba('bone'); c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 3;
    // 尾巴先畫（框蓋住根部）
    const by = top + bh;
    c.beginPath(); c.moveTo(cx - 24, by - 6); c.quadraticCurveTo(lerp(cx, tx, 0.5), lerp(by, ty, 0.3), lerp(cx, tx, 0.62), Math.min(ty - 20, by + 90)); c.lineTo(cx + 24, by - 6); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.roundRect(cx - bw / 2, top, bw, bh, Math.min(60, bh / 2)); c.fill(); c.stroke();
    // 尾巴根部被框線切到的那一段補白
    c.fillStyle = rgba('bone'); c.fillRect(cx - 22, by - 5, 44, 8);
    c.translate(cx, top + 22 + size * 0.92);
    // 不是正在唱的那一格：框照樣是白的（漫畫的框不會透明），字淡一點
    drawBi(c, line, t, this.lyr, bl, alpha);
    c.restore();
  }

  /** 格子裡會動的小東西（畫在格子上面、切在格子裡）：熱氣、雨、閃爍的星、手機震動、流星、飄落的花瓣。 */
  private alive(c: CanvasRenderingContext2D, p: Panel, x0: number, y0: number, t: number) {
    const au = this.ctx.audio, w = STRIP.w, h = p.h, gy = h * 0.8;
    c.save();
    c.beginPath(); c.rect(x0 + 5, y0 + 5, w - 10, h - 10); c.clip();
    c.translate(x0, y0);
    c.strokeStyle = rgba('sepia', 0.55); c.lineWidth = 2.5; c.lineCap = 'round';
    const beat = au.beatAt(t), bph = beat - Math.floor(beat);
    switch (p.motif) {
      case 'mugs': {
        for (const mx of [w * 0.4, w * 0.58]) for (let k = 0; k < 2; k++) {
          c.beginPath();
          for (let i = 0; i <= 12; i++) { const v = i / 12, y = gy - 150 - v * 110; const x = mx - 10 + k * 20 + Math.sin(v * 6 - t * 3 + k * 2 + mx) * 10 * v; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
          c.globalAlpha = 0.6; c.stroke(); c.globalAlpha = 1;
        }
        break;
      }
      case 'umbrellas': case 'flat': {
        c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.5;
        for (let i = 0; i < 30; i++) { const x = hash(p.seed, i) * w, y = ((hash(p.seed, i, 2) * h + t * 600) % (h + 40)) - 20; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 6, y + 22); c.stroke(); }
        break;
      }
      case 'phone': {
        // 拍點上手機震一下：旁邊兩組震動線
        const k = Math.exp(-bph / 0.15);
        c.lineWidth = 3; c.strokeStyle = paperSignal(0.8 * k);
        for (const sgn of [-1, 1]) for (let j = 0; j < 3; j++) { const x = w * 0.5 + sgn * (120 + j * 14), y = gy - 190 + j * 30; c.beginPath(); c.moveTo(x, y); c.lineTo(x + sgn * 16, y - 8); c.stroke(); }
        break;
      }
      case 'roof': case 'ferris': {
        // 星星照拍子閃（十字的光）；屋頂那一格每個小節一顆流星
        for (let i = 0; i < 6; i++) {
          const x = hash(p.seed, i, 3) * w, y = hash(p.seed, i, 4) * gy * 0.6 + 20;
          const k = Math.exp(-((beat + i * 0.37) % 2) / 0.3);
          c.strokeStyle = rgba('bone', 0.9 * k); c.lineWidth = 2;
          c.beginPath(); c.moveTo(x - 10, y); c.lineTo(x + 10, y); c.moveTo(x, y - 10); c.lineTo(x, y + 10); c.stroke();
        }
        if (p.motif === 'roof') {
          const bar = au.barAt(t), fr = bar - Math.floor(bar);
          if (fr < 0.35) {
            const u = fr / 0.35, x = w * (0.9 - 0.6 * u), y = 40 + 120 * u;
            c.strokeStyle = rgba('bone', 0.9 * (1 - u)); c.lineWidth = 3;
            c.beginPath(); c.moveTo(x, y); c.lineTo(x + 80, y - 30); c.stroke();
          }
        }
        break;
      }
      case 'bike': case 'mailbox': {
        // 飄落的花瓣（點綴色的小橢圓）
        c.fillStyle = mixRgba('paper', 'signal', 0.6);
        for (let i = 0; i < 10; i++) {
          const x = (hash(p.seed, i, 6) * w + 30 * Math.sin(t * 1.3 + i)) % w, y = ((hash(p.seed, i, 7) * h + t * 70) % (h + 20)) - 10;
          c.save(); c.translate(x, y); c.rotate(t * 2 + i); c.beginPath(); c.ellipse(0, 0, 7, 4, 0, 0, TAU); c.fill(); c.restore();
        }
        break;
      }
    }
    c.restore();
  }

  /** 作者的話：第一個拍點從右邊滑進來。 */
  private drawNoteProp(c: CanvasRenderingContext2D, t: number) {
    const k = ease.outExpo(clamp((t - this.tNote) / 0.6));
    if (k <= 0) return;
    c.save();
    c.globalAlpha *= k;
    c.translate(NOTE.x + 120 * (1 - k), NOTE.y);
    c.rotate(0.01);
    c.drawImage(this.note.canvas, -20, -20, this.note.w, this.note.h);
    c.restore();
  }
}
