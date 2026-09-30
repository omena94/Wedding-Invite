// 登機口（亮、date、雙語）：白天的機場登機口。大片落地窗外停著一架飛機（沒有任何航空公司的名字或標誌），遠處另一架慢慢滑過；
// 宣文和孟庭拖著行李、拿著護照和登機證站在窗前，腳邊三個寵物提籃，芃芃、QQ、元元（元元的提籃最大）從上面的開口探頭。
// 角色是 Codex 畫的紙偶（_puppet.ts）；提籃、行李、看板由程式畫。
//  - **兩行歌詞是登機口的雙語看板**：左上一塊深色的航班看板，「目的地」那一欄是歌詞——中文大字（40～52）、原文小一號在正下方，
//    像真的機場雙語標示；換一句歌詞時整列往上捲、新的一列捲進來。沒翻譯的歌只有一行，看板那一列就只有一行高；純音樂時目的地寫「幸福」。
//  - **焦點是主打留言**：左下角前景一個大行李箱，把手上掛著一張牛皮紙行李吊牌，留言手寫在吊牌上（照「留言尺寸與版面比例標準 v2」：
//    字 40～60、吊牌最大 600 × 380），吊牌跟著拍子輕輕晃。沒有留言時吊牌寫邀請、字淡，歌詞變主角。
//  - 節奏：看板的「登機中」每拍閃一下；每兩小節的小節線廣播「叮咚」（看板上方一圈訊號色的波紋），孟庭舉起護照和登機證歡呼、
//    宣文低頭確認登機證；三隻狗每拍輪流探頭（先縮下去再冒出來），廣播那一下三隻一起探出來。
//  - 次要動作：窗外遠處的飛機慢慢滑過、天花板的燈條、地板上淡淡的倒影。鏡頭：整個窗格慢慢推近兩個人。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, msgChars } from './_motifs';
import { inkFor, inkLine, inkPoly, inkEllipse, inkPath, drawNote, paperBG, type Note, type Pt } from './_couple';
import { loadPuppets, hasPuppet, drawPick, drawPuppet, puppetShadow, puppetIn, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import type { Lyrics } from '../engine/lyrics';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'date', paper: true, energy: [0.25, 0.95], bars: [4, 8] };

const FLOOR = 930;
const SZ = 520;
const XW_X = 990, MT_X = 1250;
/** 孟庭那兩張 Codex 畫小了（臉是其他版面的 0.93 倍），放大補回來，兩人才是正常的身高差。 */
const MT_S = 1.075;
/** 三個寵物提籃：底邊中心的 x、寬、高（元元的最大）與狗的圖。 */
const CARRIERS = [
  { x: 1300, w: 150, h: 104, dog: 'pp_sit', who: 'pp' },
  { x: 1140, w: 150, h: 104, dog: 'qq_sit', who: 'qq' },
  { x: 965, w: 200, h: 136, dog: 'yy_sit', who: 'yy' },
] as const;
/** 看板：外框、目的地那一欄（歌詞）的範圍。 */
const BOARD = { x: 110, y: 96, w: 900, h: 300 };
const DEST = { x: 150, y: 206, w: 820, h: 176 };
/** 行李吊牌：吊繩的起點（行李箱把手）、吊牌最大的範圍與內距。 */
const TAG = { hx: 690, hy: 640, w: 600, h: 370 };
const TPAD = { x: 40, top: 58, bottom: 30 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const P = {
  xwStand: 'xw_d3_gate_stand', xwCheck: 'xw_d3_gate_check', mtCheer: 'mt_d3_gate_cheer', mtStand: 'mt_d3_gate_stand',
} as const;
/** 還沒畫好的姿勢先用 base 的站姿。 */
const FALLBACK: Record<string, string> = { xw_d3_gate_stand: 'xw_idle_front', xw_d3_gate_check: 'xw_idle_front', mt_d3_gate_cheer: 'mt_cheer', mt_d3_gate_stand: 'mt_idle_front' };

export default class Departuregate extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  tag = { x: 0, y: 0, w: TAG.w, h: TAG.h };
  calls: number[] = [];
  xwKeys: [number, string][] = [];
  mtKeys: [number, string][] = [];
  pose = (n: string) => (hasPuppet(n) ? n : FALLBACK[n] ?? n);
  msgT0 = 0;
  lyricSize = 50;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + '登機口航班目的地時間狀態登機中幸福準時' + 'GATE D3 FLIGHT AO0313 BOARDING 13:13');
    const names = [...Object.values(P).map(this.pose), ...CARRIERS.map((k) => k.dog)];
    this.track(await loadPuppets(names));
    // ---- 廣播：每兩小節的小節線（「叮咚」、孟庭舉起登機證、宣文確認）
    const b0 = Math.round(au.barAt(barAfter(au, s + 0.8)));
    this.xwKeys = [[-1e9, this.pose(P.xwStand)]];
    this.mtKeys = [[-1e9, this.pose(P.mtStand)]];
    for (let k = 0; k < 20; k += 2) {
      const tb = au.timeOfBar(b0 + k);
      if (tb > e + 0.1) break;
      const bp = au.beatPeriod(tb);
      this.calls.push(tb);
      this.mtKeys.push([tb, this.pose(P.mtCheer)], [tb + bp * 2.5, this.pose(P.mtStand)]);
      this.xwKeys.push([tb + bp, this.pose(P.xwCheck)], [tb + bp * 3.2, this.pose(P.xwStand)]);
    }
    // ---- 行李吊牌：標準 v2 的字級，吊牌的寬高跟著留言；吊在把手左下方
    const c = this.fg.ctx;
    const w = TAG.w - TPAD.x * 2, hmax = TAG.h - TPAD.top - TPAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const tw = Math.min(TAG.w, tightenNote(c, this.note, 300) + TPAD.x * 2);
    const th = Math.min(TAG.h, Math.max(200, TPAD.top + this.note.height + TPAD.bottom + 8));
    // 吊牌掛在把手左下方（右上角的圓孔用一條細繩連到把手），左緣離畫面左邊 ≥ 64 px（字離邊緣 ≥ 100 px）
    this.tag = { x: Math.max(64, TAG.hx - 40 - tw), y: TAG.hy - 20, w: tw, h: th };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.3);
    this.drawBackground();
  }

  /** 不會動的：落地窗（天空、停機坪、停著的飛機、空橋）、天花板、地板、看板的外框、前景的大行李箱。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx, ink = inkFor(true);
    L.clear();
    // 天花板與燈條
    c.fillStyle = mixRgba('paper', 'sepia', 0.06);
    c.fillRect(0, 0, W, 70);
    for (let x = 60; x < W; x += 260) { c.fillStyle = rgba('bone', 0.9); c.fillRect(x, 26, 170, 8); }
    // 落地窗：一格一格的窗框，窗外天空（淡）、停機坪、停著的飛機（機身、機尾，沒有字）
    const WIN = { y: 90, h: 610 };
    const sky = c.createLinearGradient(0, WIN.y, 0, WIN.y + WIN.h);
    sky.addColorStop(0, mixRgba('bone', 'leash', 0.28)); sky.addColorStop(0.62, mixRgba('bone', 'leash', 0.1)); sky.addColorStop(0.64, mixRgba('paper', 'ash', 0.35)); sky.addColorStop(1, mixRgba('paper', 'ash', 0.5));
    c.fillStyle = sky; c.fillRect(0, WIN.y, W, WIN.h);
    const hz = WIN.y + WIN.h * 0.63;
    // 停著的飛機：窗外右邊，機頭朝左，一個大的機身＋機翼＋機尾
    c.save();
    c.translate(1290, hz - 20);
    c.fillStyle = mixRgba('bone', 'paper', 0.3);
    inkPoly(c, [{ x: -420, y: 0 }, { x: -380, y: -40 }, { x: 420, y: -44 }, { x: 520, y: -150 }, { x: 560, y: -150 }, { x: 540, y: -36 }, { x: 560, y: 4 }, { x: -380, y: 14 }], { ink, fill: mixRgba('bone', 'paper', 0.25), w: 0.8, seed: 3 });
    inkPoly(c, [{ x: -60, y: 2 }, { x: 160, y: 2 }, { x: 330, y: 62 }, { x: 250, y: 64 }], { ink, fill: mixRgba('bone', 'ash', 0.25), w: 0.6, seed: 4 });
    for (let k = 0; k < 16; k++) { c.fillStyle = rgba('sepia', 0.4); c.fillRect(-330 + k * 42, -28, 14, 10); }
    inkEllipse(c, 60, 34, 46, 18, 0, { ink, fill: mixRgba('ash', 'sepia', 0.2), w: 0.6, seed: 5 });
    c.fillStyle = rgba('signal', 0.6);
    c.fillRect(-380, -2, 800, 5);
    c.restore();
    // 空橋（從左邊伸過去接機門）
    inkPoly(c, [{ x: 0, y: hz - 110 }, { x: 760, y: hz - 90 }, { x: 760, y: hz - 20 }, { x: 0, y: hz - 10 }], { ink, fill: mixRgba('paper', 'ash', 0.55), w: 0.8, seed: 6 });
    // 窗框：直的窗條、上下的橫條
    c.fillStyle = mixRgba('sepia', 'paper', 0.55);
    for (let x = 0; x <= W; x += 240) c.fillRect(x - 5, WIN.y, 10, WIN.h);
    c.fillRect(0, WIN.y, W, 12);
    c.fillRect(0, WIN.y + WIN.h - 12, W, 12);
    // 地板：淡灰、往前一點點亮，幾條磁磚縫、窗戶的倒影
    const fl = c.createLinearGradient(0, WIN.y + WIN.h, 0, H);
    fl.addColorStop(0, mixRgba('paper', 'ash', 0.3)); fl.addColorStop(1, mixRgba('paper', 'bone', 0.4));
    c.fillStyle = fl; c.fillRect(0, WIN.y + WIN.h, W, H - WIN.y - WIN.h);
    c.fillStyle = rgba('bone', 0.35);
    for (let x = 0; x <= W; x += 240) c.fillRect(x - 30, WIN.y + WIN.h + 6, 40, 120);
    c.strokeStyle = rgba('sepia', 0.1); c.lineWidth = 1;
    c.beginPath();
    for (const y of [790, 870, 980]) { c.moveTo(0, y); c.lineTo(W, y); }
    for (let x = -400; x < W + 400; x += 200) { c.moveTo(960 + (x - 960) * 0.55, 700); c.lineTo(x, H); }
    c.stroke();
    // 看板：深色的面板、細框、上面一條小標
    const B = BOARD;
    c.fillStyle = rgba('sepia', 0.18);
    c.fillRect(B.x + 8, B.y + 12, B.w, B.h);
    c.fillStyle = mixRgba('ink', 'ink2', 0.6);
    c.beginPath(); c.roundRect(B.x, B.y, B.w, B.h, 10); c.fill();
    c.strokeStyle = mixRgba('ash', 'ink2', 0.5); c.lineWidth = 4; c.stroke();
    c.fillStyle = rgba('bone', 0.08);
    c.fillRect(B.x + 16, B.y + 96, B.w - 32, 2);
    c.fillStyle = mixRgba('ash', 'ink', 0.4);
    c.fillRect(B.x + B.w / 2 - 6, 0, 12, B.y);
    // 前景的大行李箱（左下，只露上半部）：硬殼、直條紋、拉桿與把手
    const S = { x: TAG.hx - 175, y: TAG.hy + 70, w: 350, h: 460 };
    inkPoly(c, [{ x: S.x, y: S.y + 30 }, { x: S.x + 30, y: S.y }, { x: S.x + S.w - 30, y: S.y }, { x: S.x + S.w, y: S.y + 30 }, { x: S.x + S.w, y: S.y + S.h }, { x: S.x, y: S.y + S.h }], { ink, fill: mixRgba('signal', 'paper', 0.55), w: 1, seed: 8 });
    for (let k = 1; k < 6; k++) inkLine(c, [{ x: S.x + (S.w * k) / 6, y: S.y + 16 }, { x: S.x + (S.w * k) / 6, y: S.y + S.h }], { ink, w: 0.4, seed: 10 + k, color: rgba('sepia', 0.3) });
    inkPoly(c, [{ x: TAG.hx - 70, y: S.y - 4 }, { x: TAG.hx - 70, y: S.y - 70 }, { x: TAG.hx + 70, y: S.y - 70 }, { x: TAG.hx + 70, y: S.y - 4 }, { x: TAG.hx + 52, y: S.y - 4 }, { x: TAG.hx + 52, y: S.y - 52 }, { x: TAG.hx - 52, y: S.y - 52 }, { x: TAG.hx - 52, y: S.y - 4 }], { ink, fill: mixRgba('sepia', 'paper', 0.4), w: 0.7, seed: 20 });
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(true);

    this.plane(c, ink, t);
    this.drawBoard(c, t, lyrics);
    // ---- 兩個人（窗前）、三個提籃（腳邊）
    const kick = beatKick(au, t, 0.25);
    const ex = puppetIn(t, s + 0.05, 0.45), em = puppetIn(t, s + 0.15, 0.45);
    if (ex.alpha > 0) {
      puppetShadow(c, 'xw', XW_X, FLOOR, { h: SZ, alpha: 0.28 * ex.alpha, color: '70,60,50' });
      drawPick(c, this.xwKeys, t, XW_X, FLOOR, { h: SZ, spin: ex.spin, alpha: ex.alpha, squash: 0.01 * kick + breathe(t, 0.008, 3.2), pivot: 0.2 });
    }
    if (em.alpha > 0) {
      let lift = 0;
      for (const tc of this.calls) { const d = t - tc; if (d >= 0 && d < bp) lift = Math.max(lift, 16 * Math.sin(Math.PI * d / bp)); }
      puppetShadow(c, 'mt', MT_X, FLOOR, { h: SZ, lift, alpha: 0.28 * em.alpha, color: '70,60,50' });
      drawPick(c, this.mtKeys, t, MT_X, FLOOR - lift, { h: SZ, scale: MT_S, spin: em.spin, alpha: em.alpha, squash: 0.012 * kick + breathe(t, 0.008, 3.5, 0.4), pivot: 0.2 });
    }
    this.carriers(c, ink, t, bp);
    // ---- 前景的行李吊牌（留言）
    this.drawTag(c, ink, t);
    // ---- 廣播「叮咚」：看板上方一圈訊號色的波紋
    const sg = LIN.signal;
    for (const tc of this.calls) {
      const d = t - tc;
      if (d < 0 || d > 0.8) continue;
      const k = d / 0.8;
      const pts: Pt[] = [];
      for (let i = 0; i <= 40; i++) { const a = Math.PI + (i / 40) * Math.PI; pts.push({ x: BOARD.x + BOARD.w / 2 + Math.cos(a) * (30 + 120 * k), y: BOARD.y - 6 + Math.sin(a) * (14 + 50 * k) }); }
      this.glow.polyline(pts, 2, [sg[0] * 2, sg[1] * 2, sg[2] * 2], 1 - k);
    }
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p), z = 0.03 * push;
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.2, grain: 0.04, ca: 0.4, zoom: 1 + z, shake: [-(1060 - W / 2) * z, -(560 - H / 2) * z] };
  }

  /** 窗外遠處另一架飛機慢慢滑過（小小的剪影，照時間往左移，一個窗格滑過去一次）。 */
  private plane(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>, t: number) {
    const u = ((t - this.ctx.start) * 22) % 2600;
    const x = 2200 - u, y = 90 + 610 * 0.63 - 14;
    if (x < -200 || x > 2100) return;
    inkPoly(c, [{ x, y }, { x: x + 20, y: y - 12 }, { x: x + 170, y: y - 12 }, { x: x + 196, y: y - 44 }, { x: x + 206, y: y - 44 }, { x: x + 200, y: y - 8 }, { x: x + 206, y: y + 2 }, { x: x + 16, y: y + 4 }], { ink, fill: mixRgba('bone', 'ash', 0.3), w: 0.5, seed: 30, color: rgba('sepia', 0.4) });
  }

  /** 登機口看板：上面一排小字（登機口、班次、時間、登機中每拍閃），下面「目的地」那一欄是歌詞（中文＋原文），換句子時往上捲。 */
  private drawBoard(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics) {
    const B = BOARD, au = this.ctx.audio;
    c.save();
    c.font = font(F.mono(600), 20);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('bone', 0.55);
    c.fillText('GATE D3', B.x + 30, B.y + 44);
    c.fillText('AO 0313', B.x + 250, B.y + 44);
    c.fillText('13:13', B.x + 470, B.y + 44);
    const blink = Math.floor(au.beatAt(t) * 2) % 2 === 0;
    c.fillStyle = rgba('signal', blink ? 1 : 0.35);
    c.fillText('BOARDING', B.x + 660, B.y + 44);
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('bone', 0.35);
    c.fillText('登機口　　　班次　　　　時間　　　　狀態：登機中', B.x + 30, B.y + 80);
    c.fillText('目的地', B.x + 30, B.y + 124);
    c.letterSpacing = '0px';
    // 目的地：歌詞（捲動：新的一句從下面捲上來）
    c.beginPath(); c.rect(DEST.x - 10, DEST.y - 8, DEST.w + 20, DEST.h + 20); c.clip();
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: DEST.w, unsung: rgba('bone', 0.3), sung: rgba('bone', big ? 0.96 : 0.9), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      const roll = 1 - ease.outCubic(clamp((t - (ly.line.start - 0.35)) / 0.3));
      // 在目的地那一欄垂直置中（有原文時兩行一起置中）
      c.translate(DEST.x, DEST.y + (DEST.h - lay.height) / 2 + lay.size * 0.86 + roll * DEST.h);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      // 純音樂：目的地寫「幸福　準時」；兩句之間：同一行字變暗（像看板在換下一班）
      c.font = font(F.hei(700), 48);
      c.fillStyle = rgba('bone', lyrics.has ? 0.28 : 0.85);
      c.fillText('幸福　準時', DEST.x, DEST.y + (DEST.h + 48 * 0.72) / 2);
    }
    c.restore();
  }

  /** 三個寵物提籃（網布窗、提把）：狗坐在裡面、從上面的開口探頭；每拍輪流縮下去再冒出來，廣播那一下三隻一起探出來。 */
  private carriers(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>, t: number, bp: number) {
    const au = this.ctx.audio;
    const bi = Math.floor(au.beatAt(t) + 1e-6), since = t - au.timeOfBeat(bi);
    let call = 0;
    for (const tc of this.calls) { const d = t - tc; if (d >= 0 && d < bp * 1.5) call = Math.max(call, Math.sin(Math.PI * d / (bp * 1.5))); }
    CARRIERS.forEach((k, i) => {
      const en = puppetIn(t, this.ctx.start + 0.3 + i * 0.1, 0.4);
      if (en.alpha <= 0) return;
      const top = FLOOR - k.h;
      // 每拍輪到一隻：先縮下去（前半拍）再冒出來
      const mine = (bi % 3) === i;
      const duck = mine ? Math.sin(Math.PI * clamp(since / (bp * 0.8))) : 0;
      const peek = 0.5 + 0.12 * call - 0.16 * duck;
      const dogH = SZ * (k.who === 'yy' ? 0.42 : k.who === 'qq' ? 0.29 : 0.26);
      const o: PuppetOpts = { h: SZ, flip: i === 2, alpha: en.alpha, rot: 0.04 * Math.sin(au.beatAt(t) * Math.PI + i) };
      puppetShadow(c, k.who, k.x, FLOOR, { h: SZ, alpha: 0.25 * en.alpha, color: '70,60,50', wide: 1.1 });
      // 狗：坐在提籃裡、頭冒出上緣（只畫提籃上緣以上的部分，下面被提籃擋住）
      c.save();
      c.beginPath(); c.rect(k.x - k.w, 0, k.w * 2, top + 6); c.clip();
      drawPuppet(c, k.dog, k.x, top + dogH * (1 - peek) + 10, o);
      c.restore();
      // 提籃：軟殼、前面一塊網布窗、兩條提把
      const x0 = k.x - k.w / 2;
      inkPath(c, [{ x: x0 + k.w * 0.2, y: top + 4 }, { x: k.x, y: top - k.h * 0.55 }, { x: x0 + k.w * 0.8, y: top + 4 }], { ink, w: 0.8, seed: 40 + i, color: rgba('sepia', 0.6) });
      inkPoly(c, [{ x: x0, y: top }, { x: x0 + k.w, y: top }, { x: x0 + k.w + 6, y: FLOOR }, { x: x0 - 6, y: FLOOR }], { ink, fill: mixRgba(['leash', 'gingham', 'fur'][i]!, 'paper', 0.45), w: 0.9, seed: 50 + i });
      const m = { x: x0 + k.w * 0.18, y: top + k.h * 0.22, w: k.w * 0.64, h: k.h * 0.6 };
      c.fillStyle = rgba('sepia', 0.12);
      c.fillRect(m.x, m.y, m.w, m.h);
      c.strokeStyle = rgba('sepia', 0.22); c.lineWidth = 1;
      c.beginPath();
      for (let x = m.x; x <= m.x + m.w; x += 8) { c.moveTo(x, m.y); c.lineTo(x, m.y + m.h); }
      for (let y = m.y; y <= m.y + m.h; y += 8) { c.moveTo(m.x, y); c.lineTo(m.x + m.w, y); }
      c.stroke();
    });
  }

  /** 行李吊牌：從行李箱把手垂下來一條細繩，牛皮紙吊牌（上緣一個圓孔），跟著拍子輕輕晃；留言一個字一個字寫上去。 */
  private drawTag(c: CanvasRenderingContext2D, ink: ReturnType<typeof inkFor>, t: number) {
    const n = this.note;
    if (!n) return;
    const au = this.ctx.audio;
    const T = this.tag;
    const swing = 0.012 * Math.sin(au.beatAt(t) * Math.PI) + 0.01 * beatKick(au, t, 0.4);
    const hole = { x: T.x + T.w - 46, y: T.y + 36 };
    inkPath(c, [{ x: TAG.hx, y: TAG.hy + 14 }, { x: (TAG.hx + hole.x) / 2, y: (TAG.hy + 14 + hole.y) / 2 + 12 }, hole], { ink, w: 0.6, seed: 60, color: rgba('sepia', 0.7) });
    // 只有吊牌的紙跟著晃；字不跟著轉（斜的字每格都要重新光柵化，很貴；晃的角度很小，看不出來）
    c.save();
    c.translate(hole.x, hole.y);
    c.rotate(swing - 0.03);
    c.translate(-hole.x, -hole.y);
    c.fillStyle = rgba('sepia', 0.14);
    c.beginPath(); c.roundRect(T.x + 10, T.y + 12, T.w, T.h, 16); c.fill();
    c.fillStyle = mixRgba('paper', 'fur', 0.3);
    c.beginPath(); c.roundRect(T.x, T.y, T.w, T.h, 16); c.fill();
    c.strokeStyle = rgba('sepia', 0.35); c.lineWidth = 1.5; c.stroke();
    c.fillStyle = mixRgba('paper', 'bone', 0.6);
    c.beginPath(); c.arc(hole.x, hole.y, 12, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('sepia', 0.5); c.stroke();
    c.restore();
    c.save();
    c.font = font(F.mono(600), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.5);
    c.fillText('AO 0313 · 行李吊牌', T.x + TPAD.x, T.y + 36);
    c.letterSpacing = '0px';
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.09);
    const done = this.msgT0 + total * per;
    drawNote(c, n, T.x + TPAD.x, T.y + TPAD.top + Math.max(0, (T.h - TPAD.top - TPAD.bottom - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.75), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
