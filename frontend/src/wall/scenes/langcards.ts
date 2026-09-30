// 互考單字（亮、date、雙語）：午後的咖啡廳，窗邊一張鋪著桌巾的桌子，宣文（左）和孟庭（右）面對面坐著用單字卡互考（桌子擋住腰部以下）。
// 角色是 Codex 畫的紙偶（_puppet.ts）；桌子、咖啡杯、單字卡、筆記本由程式畫。
//  - 兩小節一輪：**小節線上孟庭舉起一張卡考他**（挑眉）→ 第三拍宣文先想一下（托下巴）→ 第四拍搶答（舉手）→
//    下一個小節線：答對就兩人擊掌（兩隻手在桌子上方碰在一起，一小圈訊號色的火花），答錯（每隔一輪）孟庭彈他額頭、宣文往後一縮。
//    每拍兩人都輕輕點一下頭，咖啡杯冒的熱氣慢慢飄。
//  - **兩行歌詞是前景那疊單字卡最上面一張**：中文大字（40～52）、原文小一號在正下方，左上角一個小小的卡號；
//    換一句歌詞時最上面那張往右滑走、露出下一張（就像孟庭抽走一張）。沒翻譯的歌那張卡只有一行、卡的高度跟著縮；純音樂時卡上畫一個「？」。
//  - **焦點是主打留言**：左前景一本攤開的線圈筆記本，留言手寫在右頁（照「留言尺寸與版面比例標準 v2」：字 40～60、頁面最大 560 × 380）。
//    沒有留言時筆記本寫邀請、字淡，歌詞變主角。
//  - 次要動作：窗外的樹影慢慢晃、吊燈跟著大鼓亮一點、咖啡的熱氣。鏡頭：整個窗格慢慢推近兩個人中間。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32 } from '../engine/util';
import type { Lyrics } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, msgChars } from './_motifs';
import { inkFor, inkLine, inkPoly, inkPath, inkEllipse, drawNote, paperBG, type Note, type Pt, type Ink } from './_couple';
import { loadPuppets, hasPuppet, puppetIn, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { faceLocks, drawLocked, lockedPoint, type Lock } from './_d3';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'date', paper: true, energy: [0.3, 1], bars: [4, 8] };

/** 桌面的遠邊（擋住兩個人腰部以下）；人的腳底在桌子後面看不到的地方。 */
const TABLE_Y = 660;
const SZ = 800, FEET = 1010;
const XW_X = 700, MT_X = 1220;
/** 孟庭那幾張 Codex 畫得比宣文小一點（坐姿的頭比較小），放大一點兩個人才像坐在同一張桌子兩邊。 */
const MT_S = 1.1;
/** 前景：單字卡那一疊（最上面一張的範圍）、筆記本（左頁、右頁）。 */
const CARD = { x: 818, y: 770, w: 520, hMax: 230 };
const NOTE = { x: 100, y: 690, w: 600, h: 360 };
const NPAD = { x: 34, top: 40, bottom: 26 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = {
  xwThink: 'xw_d3_think', xwAnswer: 'xw_d3_answer',
  mtShow: 'mt_d3_card_show', mtFive: 'mt_d3_highfive', mtFlick: 'mt_d3_flick',
} as const;
const FALLBACK: Record<string, string> = {
  xw_d3_think: 'xw_idle_front', xw_d3_answer: 'xw_cheer', mt_d3_card_show: 'mt_idle_front', mt_d3_highfive: 'mt_cheer', mt_d3_flick: 'mt_cheer',
};

interface Round { show: number; think: number; answer: number; result: number; right: boolean }

export default class Langcards extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  mid = this.track(new Layer2D(W, H, undefined, { fast: true }));
  front = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  page = { x: 0, y: 0, w: 0, h: 0 };
  rounds: Round[] = [];
  xwKeys: [number, string][] = [];
  mtKeys: [number, string][] = [];
  /** 擊掌時兩隻手碰在一起的地方（圖上的 hand 點；沒有就估）。 */
  five: Pt = { x: 960, y: 330 };
  xwLock = new Map<string, Lock>();
  mtLock = new Map<string, Lock>();
  pose = (n: string) => (hasPuppet(n) ? n : FALLBACK[n] ?? n);
  msgT0 = 0;
  lyricSize = 50;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + '？…單字卡 No.' + '0123456789');
    this.track(await loadPuppets(Object.values(P).map(this.pose)));
    // ---- 兩小節一輪：小節線舉卡 → 第三拍想 → 第四拍搶答 → 下一個小節線擊掌（或彈額頭）
    const b0 = Math.round(au.barAt(barAfter(au, s + 0.5)));
    this.xwKeys = [[-1e9, this.pose(P.xwThink)]];
    this.mtKeys = [[-1e9, this.pose(P.mtShow)]];
    for (let r = 0; r < 10; r++) {
      const show = au.timeOfBar(b0 + r * 2), result = au.timeOfBar(b0 + r * 2 + 1);
      if (show > e - 0.3) break;
      const bi = Math.round(au.beatAt(show)), bp = au.beatPeriod(show);
      const rd: Round = { show, think: au.timeOfBeat(bi + 2), answer: au.timeOfBeat(bi + 3), result, right: r % 2 === 0 };
      this.rounds.push(rd);
      this.mtKeys.push([show, this.pose(P.mtShow)]);
      this.xwKeys.push([rd.think, this.pose(P.xwThink)], [rd.answer, this.pose(P.xwAnswer)]);
      if (result < e) {
        if (rd.right) { this.mtKeys.push([result, this.pose(P.mtFive)], [result + bp * 1.6, this.pose(P.mtShow)]); this.xwKeys.push([result + bp * 1.6, this.pose(P.xwThink)]); }
        else { this.mtKeys.push([result - bp * 0.2, this.pose(P.mtFlick)], [result + bp * 1.4, this.pose(P.mtShow)]); this.xwKeys.push([result + 0.05, this.pose(P.xwThink)]); }
      }
    }
    this.xwKeys.sort((a, b) => a[0] - b[0]);
    this.mtKeys.sort((a, b) => a[0] - b[0]);
    // 擊掌的點：宣文舉起的手、孟庭伸出的手（圖上的 hand 點）的中間
    // 換姿勢時臉對齊到基準姿勢（宣文：想；孟庭：舉卡），算好擊掌的兩隻手在哪
    const xo: PuppetOpts = { h: SZ, pivot: 0.3 }, mo: PuppetOpts = { h: SZ, pivot: 0.3, flip: true, scale: MT_S };
    this.xwLock = faceLocks(this.xwKeys.map((k) => k[1]), this.pose(P.xwThink), XW_X, FEET, xo);
    this.mtLock = faceLocks(this.mtKeys.map((k) => k[1]), this.pose(P.mtShow), MT_X, FEET, mo);
    const ha = lockedPoint(this.pose(P.xwAnswer), 'hand', XW_X, FEET, xo, this.xwLock);
    const hm = lockedPoint(this.pose(P.mtFive), 'hand', MT_X, FEET, mo, this.mtLock);
    if (ha && hm) this.five = { x: (ha.x + hm.x) / 2, y: (ha.y + hm.y) / 2 };
    // ---- 筆記本：標準 v2 的字級；右頁的寬高跟著留言
    const c = this.fg.ctx;
    const w = NOTE.w / 2 + 240 - NPAD.x * 2, hmax = NOTE.h - NPAD.top - NPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const pw = Math.min(w + NPAD.x * 2, tightenNote(c, this.note, 280) + NPAD.x * 2);
    const ph = Math.min(NOTE.h, Math.max(220, NPAD.top + this.note.height + NPAD.bottom + 8));
    this.page = { x: NOTE.x + 150, y: NOTE.y + NOTE.h - ph, w: pw, h: ph };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.3);
    this.drawBackground();
    this.drawFront();
  }

  /** 不會動的背景：牆、大窗（窗外的街樹）、吊燈、牆上的小黑板菜單、一盆植物。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    const rnd = mulberry32(5);
    // 大窗：三格，窗外淡淡的樹與對街
    const WIN = { x: 300, y: 90, w: 1320, h: 480 };
    c.fillStyle = mixRgba('bone', 'gingham', 0.18);
    c.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    for (let k = 0; k < 9; k++) {
      const x = WIN.x + 60 + k * 150 + rnd() * 40, r = 70 + rnd() * 50;
      c.fillStyle = mixRgba('paper', 'gingham', 0.18 + rnd() * 0.1);
      c.beginPath(); c.arc(x, WIN.y + 190 + rnd() * 60, r, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = mixRgba('paper', 'ash', 0.3);
    c.fillRect(WIN.x, WIN.y + 380, WIN.w, 100);
    c.fillStyle = mixRgba('sepia', 'paper', 0.5);
    for (let k = 0; k <= 3; k++) c.fillRect(WIN.x + (WIN.w * k) / 3 - 6, WIN.y, 12, WIN.h);
    c.fillRect(WIN.x, WIN.y - 6, WIN.w, 12);
    c.fillRect(WIN.x, WIN.y + WIN.h - 6, WIN.w, 12);
    // 左邊牆上的小黑板（菜單，只有幾條線，不寫字）
    inkPoly(c, [{ x: 60, y: 150 }, { x: 250, y: 150 }, { x: 250, y: 420 }, { x: 60, y: 420 }], { ink, fill: mixRgba('ink2', 'gingham', 0.2), w: 0.8, seed: 3 });
    c.fillStyle = rgba('bone', 0.4);
    for (let k = 0; k < 6; k++) c.fillRect(84, 190 + k * 36, 140 - (k % 3) * 30, 4);
    // 右邊一盆植物
    for (let k = 0; k < 9; k++) {
      const a = -Math.PI / 2 + (k - 4) * 0.28;
      const tip = { x: 1760 + Math.cos(a) * 170, y: 560 + Math.sin(a) * 200 };
      inkPath(c, [{ x: 1760, y: 600 }, { x: (1760 + tip.x) / 2 + 20, y: (600 + tip.y) / 2 }, tip], { ink, w: 1.4, seed: 10 + k, color: mixRgba('gingham', 'sepia', 0.3) });
    }
    inkPoly(c, [{ x: 1700, y: 600 }, { x: 1820, y: 600 }, { x: 1800, y: TABLE_Y + 40 }, { x: 1720, y: TABLE_Y + 40 }], { ink, fill: mixRgba('fur', 'paper', 0.5), w: 0.8, seed: 20 });
    L.upload();
  }

  /** 蓋在兩個人前面的：桌子（桌巾）、兩杯咖啡、線圈筆記本的紙（畫一次）。 */
  private drawFront() {
    const L = this.front, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 桌面：一大塊米白的桌巾，遠邊一條、往前變寬，垂下來的地方幾道皺褶
    inkPoly(c, [{ x: 150, y: TABLE_Y }, { x: 1770, y: TABLE_Y }, { x: 1920, y: H }, { x: 0, y: H }], { ink, fill: mixRgba('bone', 'paper', 0.35), w: 1, seed: 30 });
    c.strokeStyle = rgba('sepia', 0.08); c.lineWidth = 1;
    c.beginPath();
    for (let k = 1; k < 9; k++) { const x = 150 + (1620 * k) / 9; c.moveTo(x, TABLE_Y + 6); c.lineTo(960 + (x - 960) * 1.6, H); }
    c.stroke();
    // 兩杯咖啡（兩人面前）
    for (const [x, sd] of [[860, 31], [1080, 32]] as const) {
      inkEllipse(c, x, TABLE_Y + 38, 56, 12, 0, { ink, fill: rgba('bone'), w: 0.7, seed: sd });
      inkPoly(c, [{ x: x - 30, y: TABLE_Y - 20 }, { x: x + 30, y: TABLE_Y - 20 }, { x: x + 24, y: TABLE_Y + 34 }, { x: x - 24, y: TABLE_Y + 34 }], { ink, fill: rgba('bone'), w: 0.8, seed: sd + 5 });
      inkEllipse(c, x, TABLE_Y - 20, 30, 7, 0, { ink, fill: mixRgba('fur', 'sepia', 0.6), w: 0.6, seed: sd + 9 });
      inkPath(c, [{ x: x + 30, y: TABLE_Y - 10 }, { x: x + 48, y: TABLE_Y }, { x: x + 28, y: TABLE_Y + 18 }], { ink, w: 0.7, seed: sd + 12 });
    }
    // 線圈筆記本：左頁（窄、有幾條字的灰線）、右頁（留言）、中間的線圈
    const Pg = this.page;
    const lx = NOTE.x, ly = Pg.y, lh = Pg.h;
    c.fillStyle = rgba('sepia', 0.12);
    c.fillRect(lx + 10, ly + 12, Pg.x + Pg.w - lx, lh);
    inkPoly(c, [{ x: lx, y: ly + 6 }, { x: Pg.x, y: ly }, { x: Pg.x, y: ly + lh }, { x: lx + 4, y: ly + lh + 4 }], { ink, fill: mixRgba('bone', 'paper', 0.2), w: 0.7, seed: 40 });
    inkPoly(c, [{ x: Pg.x, y: ly }, { x: Pg.x + Pg.w, y: ly + 4 }, { x: Pg.x + Pg.w - 3, y: ly + lh + 2 }, { x: Pg.x, y: ly + lh }], { ink, fill: rgba('bone'), w: 0.7, seed: 41 });
    c.strokeStyle = rgba('leash', 0.18); c.lineWidth = 1;
    c.beginPath();
    for (let y = ly + 36; y < ly + lh - 10; y += 30) { c.moveTo(lx + 16, y); c.lineTo(Pg.x - 16, y); c.moveTo(Pg.x + 14, y); c.lineTo(Pg.x + Pg.w - 14, y); }
    c.stroke();
    c.fillStyle = rgba('sepia', 0.16);
    for (let k = 0; k < 4; k++) c.fillRect(lx + 20, ly + 50 + k * 30, 90 - k * 14, 5);
    for (let y = ly + 14; y < ly + lh - 8; y += 22) {
      c.strokeStyle = rgba('ash', 0.9); c.lineWidth = 2.5;
      c.beginPath(); c.ellipse(Pg.x, y, 8, 5, 0, 0, Math.PI * 2); c.stroke();
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t;
    const bp = au.beatPeriod(t);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const M = this.mid; M.clear();
    this.drawPeople(M.ctx, t, bp);
    comp.draw(renderer, M.upload(), out);
    comp.draw(renderer, this.front.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);
    this.steam(c, ink, t);
    this.drawCard(c, ink, t, lyrics);
    this.drawNotebook(c, t);
    this.sparks(t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p), z = 0.03 * push;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.22, grain: 0.045, ca: 0.4, zoom: 1 + z, shake: [-(960 - W / 2) * z, -(420 - H / 2) * z] };
  }

  /** 兩個人：每拍點一下頭；搶答時宣文往前一衝；擊掌那一下兩人都往桌子中間傾；被彈額頭宣文往後一縮。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio;
    const kick = beatKick(au, t, 0.25);
    let xr = 0, mr = 0;
    for (const r of this.rounds) {
      const da = t - r.answer;
      if (da >= 0 && da < bp) xr += 0.05 * Math.exp(-da / 0.2);
      const dr = t - r.result;
      if (dr >= -0.1 && dr < bp) {
        const k = Math.exp(-Math.max(0, dr) / 0.25);
        if (r.right) { xr += 0.04 * k; mr += 0.04 * k; }
        else { xr -= 0.08 * k; mr += 0.05 * k; }
      }
    }
    const ex = puppetIn(t, this.ctx.start + 0.05, 0.45), em = puppetIn(t, this.ctx.start + 0.15, 0.45);
    const base: PuppetOpts = { h: SZ, pivot: 0.3 };
    if (ex.alpha > 0) drawLocked(c, this.xwKeys, t, XW_X, FEET, { ...base, spin: ex.spin, alpha: ex.alpha, rot: xr, squash: 0.01 * kick + breathe(t, 0.008, 3.2) }, this.xwLock);
    if (em.alpha > 0) drawLocked(c, this.mtKeys, t, MT_X, FEET, { ...base, flip: true, scale: MT_S, spin: em.spin, alpha: em.alpha, rot: -mr, squash: 0.01 * kick + breathe(t, 0.008, 3.5, 0.3) }, this.mtLock);
  }

  /** 擊掌：兩隻手碰在一起那一刻一小圈訊號色的短線；彈額頭：宣文額頭前一小圈星星。 */
  private sparks(t: number) {
    const sg = LIN.signal;
    for (const r of this.rounds) {
      const d = t - r.result;
      if (d < 0 || d > 0.4) continue;
      const k = d / 0.4, p = r.right ? this.five : { x: XW_X + 60, y: FEET - SZ * 0.86 };
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + hash(i, 1) * 0.3, r0 = 10 + 50 * k, r1 = r0 + 20 * (1 - k);
        this.glow.seg2(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0, p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1, 2, [sg[0] * 2.4, sg[1] * 2.4, sg[2] * 2.4], 1 - k);
      }
    }
  }

  /** 咖啡的熱氣：兩三條淡淡的曲線往上飄。 */
  private steam(c: CanvasRenderingContext2D, ink: Ink, t: number) {
    for (const [x, ph] of [[860, 0], [1080, 0.5]] as const) for (let k = 0; k < 2; k++) {
      const u = ((t * 0.5 + k / 2 + ph) % 1);
      const x0 = x - 10 + k * 20, y0 = TABLE_Y - 40 - u * 110;
      inkPath(c, [{ x: x0, y: y0 + 40 }, { x: x0 + 10 * Math.sin(t * 2 + k), y: y0 + 20 }, { x: x0 - 8, y: y0 }], { ink, t, w: 0.5, color: rgba('sepia', 0.3 * Math.sin(Math.PI * u)), seed: 50 + k });
    }
  }

  /** 單字卡那一疊的底下幾張（歪歪的、顏色不一樣），高度跟最上面那張一樣。 */
  private cardStack(c: CanvasRenderingContext2D, y: number, h: number) {
    for (let k = 3; k >= 1; k--) {
      c.save();
      c.translate(CARD.x + CARD.w / 2, y + h / 2 + 4 * k);
      c.rotate((k % 2 ? 1 : -1) * 0.02 * k);
      c.fillStyle = mixRgba('bone', ['leash', 'rose', 'gingham'][k - 1]!, 0.22);
      c.fillRect(-CARD.w / 2, -h / 2, CARD.w, h);
      c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1;
      c.strokeRect(-CARD.w / 2, -h / 2, CARD.w, h);
      c.restore();
    }
  }

  /** 單字卡最上面一張：卡號、這一句歌詞（中文＋原文），卡的高度跟著有沒有原文；換句子時舊的一張往右滑走、新的一張露出來。 */
  private drawCard(c: CanvasRenderingContext2D, ink: Ink, t: number, lyrics: Lyrics) {
    const ly = lyricAt(lyrics, t);
    const draw = (x: number, y: number, h: number, alpha: number, body: () => void) => {
      if (alpha >= 1 && x === CARD.x) this.cardStack(c, y, h);
      c.save();
      c.globalAlpha = alpha;
      c.fillStyle = rgba('sepia', 0.12);
      c.fillRect(x + 8, y + 10, CARD.w, h);
      c.fillStyle = rgba('bone');
      c.fillRect(x, y, CARD.w, h);
      c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 1.2;
      c.strokeRect(x, y, CARD.w, h);
      c.fillStyle = rgba('signal', 0.6);
      c.fillRect(x, y, 10, h);
      body();
      c.restore();
    };
    if (!ly) {
      // 純音樂：卡上畫一個大問號；兩句之間：一張還沒翻開的空白卡（卡號是下一張）
      const h = lyrics.has ? 150 : CARD.hMax, y = CARD.y + CARD.hMax - h;
      const next = lyrics.nextLine(t);
      draw(CARD.x, y, h, 1, () => {
        if (!lyrics.has) { c.font = font(F.archivo(100, 800), 120); c.fillStyle = rgba('sepia', 0.3); c.textAlign = 'center'; c.fillText('？', CARD.x + CARD.w / 2, y + h / 2 + 44); return; }
        c.font = font(F.mono(600), 15);
        c.letterSpacing = '3px';
        c.fillStyle = rgba('sepia', 0.45);
        if (next) c.fillText(`No.${String(next.i + 1).padStart(2, '0')}`, CARD.x + 34, y + 30);
        c.letterSpacing = '0px';
        c.font = font(F.archivo(100, 700), 44);
        c.fillStyle = rgba('sepia', 0.22);
        c.fillText('…', CARD.x + 36, y + 100);
      });
      return;
    }
    const big = !this.msg;
    const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 38, maxWidth: CARD.w - 70, unsung: rgba('sepia', 0.26), sung: rgba('sepia', big ? 0.94 : 0.88), active: rgba('signal') };
    const lay = layoutLyric(c, ly.line, st);
    const h = Math.min(CARD.hMax, lay.height + 96);
    const y = CARD.y + CARD.hMax - h;
    // 換句子：上一張往右滑走（0.3 秒）
    const u = clamp((t - (ly.line.start - 0.35)) / 0.3);
    draw(CARD.x, y, h, 1, () => {
      c.font = font(F.mono(600), 15);
      c.letterSpacing = '3px';
      c.fillStyle = rgba('sepia', 0.45);
      c.fillText(`No.${String(ly.line.i + 1).padStart(2, '0')}`, CARD.x + 34, y + 30);
      c.letterSpacing = '0px';
      c.translate(CARD.x + 36, y + 50 + lay.size * 0.86);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    });
    if (u < 1) {
      const k = ease.inCubic(u);
      draw(CARD.x + 700 * k, y - 10, h, 1 - k, () => { /* 滑走的那一張：看不清楚內容，只有卡片 */ });
    }
  }

  /** 筆記本右頁的留言：一個字一個字寫上去，署名在最後一行下面。 */
  private drawNotebook(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const Pg = this.page;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.09);
    const done = this.msgT0 + total * per;
    drawNote(c, n, Pg.x + NPAD.x, Pg.y + NPAD.top + Math.max(0, (Pg.h - NPAD.top - NPAD.bottom - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.75), sigK: prog(t, done + 0.1, done + 0.5),
    });
  }
}
