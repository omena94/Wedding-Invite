// 穿韓服（亮、kculture、雙語）：晴天午後的古宮殿迴廊前（通用的樣子，不畫真實的地標），宣文和孟庭穿韓服拍照。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 d2），迴廊、屋簷、彩繪、木匾、石板地、紙扇、落葉是程式畫的。
//  - 孟庭轉圈：每個小節線轉一圈（紙偶翻面轉一圈，轉的時候換成裙擺飛起來的那張），落地彈一下；
//    宣文替她撐一把紙傘（傘跟著她轉的方向晃一下），每拍輕輕點頭。
//  - **兩行歌詞是屋簷下的木匾**：深色木頭、金色的字，中文大字、原文小一號在下面；換一句時木匾上的金字從左到右描一遍亮起來。
//    沒翻譯的歌只有一行，木匾跟著變矮。
//  - **焦點是主打留言**：寫在左邊架上打開的一把紙扇（扇面、竹骨），標準 v2：字 40～60、扇子寬 ≤ 840。
//  - 風：銀杏葉一片一片飄過（小節線上多一陣），迴廊的柱子一根一根往遠處排（慢慢往左移一點點，像鏡頭在走）。
import * as THREE from 'three';
import { Scene, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { ease, prog, hash, fract } from '../engine/util';
import { lyricAt, layoutLyric, beatAfter, barAfter, type LyricStyle } from './_motifs';
import { paperBG, type Note } from './_couple';
import { loadPuppets, drawPick, puppetShadow, landSquash, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet, writeNote } from './_c5';
import { pose, loadLyricGlyphs, drawLyricIn } from './_d2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'kculture', paper: true, energy: [0.2, 0.9], bars: [4, 8] };

/** 場景尺度與地面（石板地的前緣）。 */
const SZ = 600;
const FLOOR = 976;
const AL_X = 940, OM_X = 1160;
/** 迴廊：簷下的橫樑、柱子的底、柱子的間距。 */
const BEAM_Y = 250, BASE_Y = 760, PILLAR_GAP = 330;
/** 木匾（歌詞）：中心 x、上緣、最大寬。 */
const PLAQUE = { cx: 1180, y: 104, w: 1000 };
/** 紙扇（留言）：扇軸（扇子的圓心，在下面）、外半徑、內半徑（扇骨露出來的地方）。 */
const FAN = { cx: 480, cy: 740, r: 470, r0: 160 };
/** 扇面上寫字的範圍（相對扇軸，y 往上是負的）：扇面是圓的，上緣越高越窄，字要放在夠寬的那一段（y -380 那裡還有 ±275）。 */
const TEXT = { w: 520, top: -380, bottom: -176 };

export default class Hanbok extends Scene {
  paper = paperBG();
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(256, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  twirls: number[] = [];
  omKeys: [number, string][] = [];
  alName = 'xw_idle_front';
  lineStarts: number[] = [];
  note: Note | null = null;
  noteT0 = 0;
  lyricSize = 50;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE);
    await loadLyricGlyphs(lyrics, s, e);
    const P = { stand: pose('mt_hanbok_stand', 'mt_idle_front'), twirl: pose('mt_hanbok_twirl', 'mt_idle_front') };
    this.alName = pose('xw_hanbok_umbrella', 'xw_idle_front');
    this.track(await loadPuppets([P.stand, P.twirl, this.alName]));
    // 孟庭每個小節線轉一圈（半拍前開始、一拍半轉完）；窗格開頭先站好
    const bar0 = barAfter(au, s + 0.5);
    for (let bar = Math.round(au.barAt(bar0)), k = 0; k < 40; k++, bar++) { const t = au.timeOfBar(bar); if (t > e - 0.3) break; this.twirls.push(t); }
    this.omKeys = [[-1e9, P.stand]];
    for (const tw of this.twirls) { const bp = au.beatPeriod(tw); this.omKeys.push([tw - bp * 0.4, P.twirl], [tw + bp * 1.4, P.stand]); }
    for (const l of lyrics.linesIn(s - 1, e + 1)) this.lineStarts.push(l.start - 0.35);
    // 扇面上的留言：標準 v2 的字級
    const c = this.fg.ctx;
    const hmax = TEXT.bottom - TEXT.top;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, TEXT.w, hmax) : noteV2(c, INVITE, null, TEXT.w, hmax * 0.6, { max: 44 });
    tightenNote(c, this.note, 300);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = Math.min(beatAfter(au, s + 0.4), s + 0.9);
    this.drawBackground();
  }

  /** 不會動的：屋簷（瓦片的剪影）、彩繪的橫樑、迴廊的柱子與欄杆、石板地、扇子的架子。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 迴廊後面的白牆與木格窗（很淡）
    c.fillStyle = mixRgba('paper', 'bone', 0.5);
    c.fillRect(0, BEAM_Y, W, BASE_Y - BEAM_Y);
    c.strokeStyle = rgba('sepia', 0.1);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let x = 200; x < W; x += PILLAR_GAP) {
      for (let k = 0; k < 5; k++) { c.moveTo(x + 40 + k * 50, BEAM_Y + 120); c.lineTo(x + 40 + k * 50, BASE_Y - 140); }
      for (let k = 0; k < 6; k++) { c.moveTo(x + 40, BEAM_Y + 120 + k * 50); c.lineTo(x + 240, BEAM_Y + 120 + k * 50); }
    }
    c.stroke();
    // 屋簷：深色的瓦（一條條的瓦溝），簷口往兩端微微翹起
    c.fillStyle = mixRgba('sepia', 'ink', 0.35);
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(W, 0); c.lineTo(W, 150); c.quadraticCurveTo(W / 2, 196, 0, 150); c.closePath(); c.fill();
    c.strokeStyle = rgba('bone', 0.1);
    c.lineWidth = 2;
    c.beginPath();
    for (let x = 20; x < W; x += 36) { c.moveTo(x, 0); c.lineTo(x, 150 + 40 * Math.sin((Math.PI * x) / W)); }
    c.stroke();
    // 彩繪的橫樑：綠底、紅藍的幾何花紋一格一格
    const by = 180;
    c.fillStyle = mixRgba('gingham', 'ink', 0.25);
    c.fillRect(0, by, W, BEAM_Y - by);
    for (let x = 0, k = 0; x < W; x += 90, k++) {
      c.fillStyle = k % 2 ? mixRgba('collar', 'paper', 0.2) : mixRgba('denim', 'paper', 0.2);
      c.beginPath(); c.moveTo(x + 45, by + 10); c.lineTo(x + 75, (by + BEAM_Y) / 2); c.lineTo(x + 45, BEAM_Y - 10); c.lineTo(x + 15, (by + BEAM_Y) / 2); c.closePath(); c.fill();
      c.fillStyle = rgba('bone', 0.7);
      c.beginPath(); c.arc(x + 45, (by + BEAM_Y) / 2, 8, 0, Math.PI * 2); c.fill();
    }
    // 柱子：紅褐色的圓柱（左亮右暗），底下一塊石墩
    for (let x = 200; x < W + PILLAR_GAP; x += PILLAR_GAP) {
      const g = c.createLinearGradient(x - 24, 0, x + 24, 0);
      g.addColorStop(0, mixRgba('collar', 'fur', 0.4)); g.addColorStop(0.35, mixRgba('collar', 'bone', 0.2)); g.addColorStop(1, mixRgba('collar', 'ink', 0.45));
      c.fillStyle = g;
      c.fillRect(x - 24, BEAM_Y, 48, BASE_Y - BEAM_Y);
      c.fillStyle = mixRgba('paper', 'sepia', 0.25);
      c.fillRect(x - 36, BASE_Y - 10, 72, 26);
    }
    // 迴廊的木地台邊（一條）與前面的石板地（一格一格往鏡頭展開）
    c.fillStyle = mixRgba('fur', 'sepia', 0.35);
    c.fillRect(0, BASE_Y + 16, W, 24);
    const sg = c.createLinearGradient(0, BASE_Y + 40, 0, H);
    sg.addColorStop(0, mixRgba('paper', 'ash', 0.25)); sg.addColorStop(1, mixRgba('paper', 'ash', 0.12));
    c.fillStyle = sg;
    c.fillRect(0, BASE_Y + 40, W, H - BASE_Y - 40);
    c.strokeStyle = rgba('sepia', 0.1);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let y = BASE_Y + 80, k = 0; y < H; k++, y += 40 + k * 12) { c.moveTo(0, y); c.lineTo(W, y); }
    for (let i = -12; i <= 12; i++) { c.moveTo(W / 2 + i * 120, BASE_Y + 40); c.lineTo(W / 2 + i * 300, H); }
    c.stroke();
    // 扇子的架子（木頭的 T 形小架，扇軸插在上面）
    c.fillStyle = mixRgba('fur', 'sepia', 0.5);
    c.fillRect(FAN.cx - 8, FAN.cy, 16, FLOOR - FAN.cy - 10);
    c.fillRect(FAN.cx - 70, FLOOR - 16, 140, 14);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics } = this.ctx;
    const t = f.t;
    this.paper.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    this.drawPlaque(c, t, lyrics);
    this.drawFan(c, t);
    this.drawPeople(c, t);
    this.drawLeaves(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.03, vignette: 0.24, grain: 0.045, ca: 0.5, zoom: 1 + 0.03 * push, shake: [-((AL_X + OM_X) / 2 - W / 2) * 0.03 * push, 0] };
  }

  /** 孟庭轉一圈的進度（0..1）：小節線前一點點開始、一拍半轉完。 */
  private twirlAt(t: number): number {
    const au = this.ctx.audio;
    for (const tw of this.twirls) {
      const bp = au.beatPeriod(tw);
      const u = (t - (tw - bp * 0.4)) / (bp * 1.8);
      if (u > 0 && u < 1) return u;
    }
    return 0;
  }

  /** 兩人：孟庭在小節線轉一圈（紙偶翻面一整圈、轉的時候稍微離地、落地壓扁回彈）；宣文撐傘站在她旁邊，每拍點頭，傘跟著她晃。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const nod = beatKick(au, t, 0.28);
    const tw = this.twirlAt(t);
    const enA = enterPuppet(this.glow, t, this.ctx.start + 0.12, AL_X, FLOOR - 6, 1);
    if (enA) {
      puppetShadow(c, 'xw', AL_X, FLOOR, { h: SZ, alpha: 0.3 * enA.alpha, color: '70,45,25' });
      const o: PuppetOpts = { h: SZ, pivot: 0.2, rot: 0.03 * Math.sin(tw * Math.PI * 2), squash: 0.012 * nod + breathe(t, 0.008, 3.3), spin: enA.spin, alpha: enA.alpha };
      drawPick(c, [[-1e9, this.alName]], t, AL_X, FLOOR, o);
    }
    const enO = enterPuppet(this.glow, t, this.ctx.start + 0.04, OM_X, FLOOR - 6, 2);
    if (enO) {
      const lift = 14 * Math.sin(Math.PI * tw);
      let land = 0;
      for (const w0 of this.twirls) land += landSquash(t, w0 + au.beatPeriod(w0) * 1.4, 0.08, 0.3);
      puppetShadow(c, 'mt', OM_X, FLOOR, { h: SZ, lift, alpha: 0.3 * enO.alpha, color: '70,45,25', wide: 1 + 0.4 * Math.sin(Math.PI * tw) });
      const o: PuppetOpts = { h: SZ, pivot: 0.5, squash: 0.01 * nod + land - 0.03 * Math.sin(Math.PI * tw), spin: enO.spin + ease.inOutCubic(tw), alpha: enO.alpha };
      drawPick(c, this.omKeys, t, OM_X, FLOOR - lift, o);
    }
  }

  /**
   * 屋簷下的木匾：深色木頭、金色細框；中文大字、原文小一號在下面（drawLyric 自動畫原文，字色是金色）。
   * 木匾大小跟著這一句；換一句時一道光從左到右掃過金字（0.4 秒）。間奏時木匾上寫「（間奏）」。
   */
  private drawPlaque(c: CanvasRenderingContext2D, t: number, lyrics: typeof this.ctx.lyrics) {
    const ly = lyricAt(lyrics, t);
    let since = 9;
    for (const ls of this.lineStarts) if (t >= ls) since = t - ls;
    const a = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    const gold = mixRgba('fur', 'cream', 0.45);
    const st: LyricStyle = { family: F.ming(900), size: this.lyricSize, minSize: 40, maxWidth: PLAQUE.w - 100, align: 'center', unsung: mixRgba('fur', 'cream', 0.3, 0.35), sung: gold, active: rgba('signal') };
    let w = 520, h = 110;
    if (ly) {
      const lay = layoutLyric(c, ly.line, st);
      const sub = lay.sub ? lay.sub.lay.rows.reduce((m, r) => Math.max(m, r.width), 0) : 0;
      w = Math.min(PLAQUE.w, Math.max(...lay.rows.map((r) => r.width), sub) + 110);
      h = lay.height + lay.size * 0.2 + 56;
    }
    const x = PLAQUE.cx - w / 2, y = PLAQUE.y;
    c.save();
    c.globalAlpha = a;
    // 兩條吊鍊（從屋簷下來）
    c.strokeStyle = rgba('sepia', 0.55);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(x + 50, 150); c.lineTo(x + 50, y); c.moveTo(x + w - 50, 150); c.lineTo(x + w - 50, y); c.stroke();
    c.fillStyle = rgba('sepia', 0.18);
    c.fillRect(x + 8, y + 10, w, h);
    c.fillStyle = mixRgba('sepia', 'ink', 0.3);
    c.fillRect(x, y, w, h);
    c.strokeStyle = gold;
    c.lineWidth = 3;
    c.strokeRect(x + 10, y + 10, w - 20, h - 20);
    if (ly) {
      drawLyricIn(c, ly.line, t, st, { x, y: y + 16, w, h: h - 32 }, ly.k);
      // 換一句：一道光從左到右掃過
      if (since < 0.45) {
        const u = since / 0.45, sx = x + u * w;
        const g = c.createLinearGradient(sx - 80, 0, sx + 80, 0);
        g.addColorStop(0, rgba('bone', 0)); g.addColorStop(0.5, rgba('bone', 0.35 * Math.sin(Math.PI * u))); g.addColorStop(1, rgba('bone', 0));
        c.fillStyle = g;
        c.fillRect(x + 12, y + 12, w - 24, h - 24);
      }
    } else {
      c.font = font(F.ming(900), 40);
      c.textAlign = 'center';
      c.fillStyle = gold;
      c.fillText('（間奏）', x + w / 2, y + h / 2 + 14);
    }
    c.restore();
  }

  /**
   * 紙扇：打開的摺扇（半圓多一點）插在架子上：竹骨（扇軸附近露出來）、扇面（淡淡的米色紙、一摺一摺的明暗）、
   * 左下角一枝淡墨的梅花；留言寫在扇面上（照扇面的弧度置中，橫著寫），署名在下面。開場扇子「唰」地打開。
   */
  private drawFan(c: CanvasRenderingContext2D, t: number) {
    const F0 = FAN;
    const open = ease.outCubic(prog(t, this.ctx.start + 0.1, this.ctx.start + 0.6));
    const span = Math.PI * 0.9 * open;
    const a0 = -Math.PI / 2 - span / 2, a1 = -Math.PI / 2 + span / 2;
    c.save();
    c.translate(F0.cx, F0.cy);
    // 影子
    c.fillStyle = rgba('sepia', 0.1);
    c.beginPath(); c.moveTo(10, 12); c.arc(10, 12, F0.r, a0, a1); c.closePath(); c.fill();
    // 扇面：一摺一摺（交錯的明暗）
    const folds = 18;
    for (let k = 0; k < folds; k++) {
      const b0 = a0 + (k / folds) * (a1 - a0), b1 = a0 + ((k + 1) / folds) * (a1 - a0);
      c.fillStyle = k % 2 ? mixRgba('bone', 'cream', 0.35) : mixRgba('bone', 'cream', 0.55);
      c.beginPath(); c.arc(0, 0, F0.r, b0, b1); c.arc(0, 0, F0.r0, b1, b0, true); c.closePath(); c.fill();
    }
    // 竹骨
    c.strokeStyle = mixRgba('fur', 'sepia', 0.35);
    c.lineWidth = 5;
    c.beginPath();
    for (let k = 0; k <= folds; k += 2) { const b = a0 + (k / folds) * (a1 - a0); c.moveTo(0, 0); c.lineTo(Math.cos(b) * F0.r0, Math.sin(b) * F0.r0); }
    c.stroke();
    c.strokeStyle = rgba('sepia', 0.4);
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(0, 0, F0.r, a0, a1); c.stroke();
    // 淡墨梅枝（左下）
    if (open > 0.9) {
      c.strokeStyle = rgba('sepia', 0.25);
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(-F0.r * 0.78, -F0.r0 * 1.2); c.quadraticCurveTo(-F0.r * 0.6, -F0.r * 0.55, -F0.r * 0.35, -F0.r * 0.62); c.stroke();
      c.fillStyle = mixRgba('rose', 'bone', 0.5, 0.6);
      for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(-F0.r * (0.7 - k * 0.08), -F0.r * (0.42 + 0.04 * Math.sin(k * 2)), 7, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
    const n = this.note;
    if (!n || open < 0.9) return;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.5, this.ctx.start + 0.8);
    const top = F0.cy + TEXT.top + Math.max(0, (TEXT.bottom - TEXT.top - n.height) * 0.4);
    writeNote(c, n, F0.cx - n.width / 2, top, t, this.noteT0, { msg: !!this.msg, color: rgba('sepia', 0.95), faint: rgba('sepia', 0.6), sig: rgba('sepia', 0.72), align: 'center' });
    c.restore();
  }

  /** 銀杏葉：黃色的小扇形，一片一片往右下飄；小節線上多一陣。 */
  private drawLeaves(c: CanvasRenderingContext2D, t: number) {
    for (let i = 0; i < 14; i++) {
      const sp = 0.07 + 0.05 * hash(i, 1);
      const u = fract(hash(i, 2) + t * sp);
      const x = -60 + u * (W + 200) + 40 * Math.sin(t * 1.3 + i);
      const y = 120 + hash(i, 3) * 760 + u * 180;
      if (x > 1340 && y > 820) continue;
      c.save();
      c.translate(x, y);
      c.rotate(t * (1 + hash(i, 4)) + i);
      c.fillStyle = mixRgba('ball', 'fur', 0.35, 0.85);
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 11, -Math.PI * 0.85, -Math.PI * 0.15); c.closePath(); c.fill();
      c.restore();
    }
  }
}
