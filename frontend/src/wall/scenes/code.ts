// 程式碼（批次 T6・螢幕 B，暗）：深夜一台筆電的螢幕，淺景深。
// MV 檢修後：不再是一整扇「編輯器介面」，而是鏡頭貼近一塊真的螢幕——遠一點的行與右邊都糊掉。
// 留言標準 v2：螢幕（一直在動的程式、右邊的縮圖捲軸、下面的執行狀態）是主視覺，留言在螢幕上 40～60 px，
// 程式碼本身小一號（署名就是 love() 裡的名字，螢幕上約 30 px）；房間裡螢幕的光照出空氣裡的灰塵。
//  - 畫面裡只有兩組字：主打留言（寫在字串裡，手寫字、最大最亮）與歌詞（註解，逐字「打」出來、小一級）。
//      while (true) {
//        // ♪ 正在唱的歌詞          ← 像自動完成：先淡淡地排好，唱到哪個字就打到哪個字
//        const 祝福 = `
//          主打留言……            ← 第一拍開始一個字一個字打進去（仙女棒的火花就是游標）
//        `;
//        love(祝福, "署名");
//      }
//  - 鏡頭：一開始對焦在歌詞那一行，第一拍後一小節內搖下來、對焦到留言（拉焦）；之後每個小節線再推近一點點，大鼓輕輕一頂。
//  - 留言打完的下一個小節線：整段字串被「全選」一下（訊號色的反白由左掃到右再退掉）。
//  - 沒有留言：字串是「還沒有人寫……掃描右下角 QR code」；純音樂：註解寫歌名。
// 手法：螢幕內容畫在一張 Canvas 層（打開 mipmap），用 _t6 的 ScreenRig 擺進 three.js 空間拍（透視、邊框、玻璃反光、景深）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, sparkHead, sparkParticles, beatAfter, barAfter, drawMessage, COUPLE_ZH } from './_motifs';
import { fitText } from '../engine/text';
import { msgMaxFor, lyricV2, fitClauses, V2 } from './_v2';
import { typedLayout, drawTyped, inOut, ScreenRig, mipRT, blitToRT, loadPlateText } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0.3, 0.95], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 螢幕（貼圖座標，像素，y 向下）
const TW = 1720; // 螢幕寬（比畫面大：鏡頭很近，只拍到一部分）
const FS = 44; // 程式字級（等寬，拉丁字寬 0.6 em；螢幕上約 30 px，是配角）
const CH = FS * 0.6;
const LH = 66; // 程式的行距
const GUT = 112; // 程式從這裡開始（左邊是行號）
/** 留言附近「螢幕 px ÷ 貼圖 px」（鏡頭推到最近時，保守估計）：v2 的字級是螢幕上的 px，畫在貼圖上要除以它。 */
const LS = 0.7;
const MSG_X = GUT + CH * 4; // 留言（字串內容）的左緣
const PAD_R = 90;
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
const TEXT = `婚禮祝福署名一位賓客還沒有人寫掃描右下角寫一句給新人間奏今晚的歌${GROOM}${BRIDE}`;

// 房間：很暗，螢幕的光灑在附近（光的中心與大小每格跟著螢幕在畫面上的位置）
const BG = () => new FSPass(/* glsl */ `
  uniform vec2 c; uniform vec2 r; uniform float k; uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 d = (p - c) / r;
    float glow = exp(-dot(d, d) * 1.2);
    vec3 col = C_INK * 0.8 + (C_INK2 - C_INK * 0.8) * (0.4 + 1.4 * glow) + C_BLOOD * 0.025 * glow;
    col += (C_INK2 - C_INK) * 0.25 * fbm(p / 520.0, 3);
    // 螢幕的光照出空氣裡的灰塵：很小的亮點慢慢飄（環境的動態，只在光裡看得到）
    for (int i = 0; i < 2; i++) {
      float sc = i == 0 ? 70.0 : 120.0;
      vec2 q = p / sc + vec2(t * 0.06, -t * 0.09) * (1.0 + float(i));
      vec2 id = floor(q); vec2 f = fract(q) - 0.5;
      vec2 o = hash22(id + float(i) * 17.0) - 0.5;
      float sp = smoothstep(0.07, 0.0, length(f - o * 0.8)) * step(0.8, hash12(id + 3.1 + float(i)));
      col += C_BONE * 0.05 * sp * glow * (0.6 + 0.4 * sin(t * 2.0 + hash12(id) * 6.28));
    }
    fragColor = vec4(col * mix(0.6, 1.0, k), 1.0);
  }`, { c: { value: new THREE.Vector2(900, 540) }, r: { value: new THREE.Vector2(900, 600) }, k: { value: 1 }, t: { value: 0 } });

type Col = 'kw' | 'id' | 'str' | 'p' | 'cm';
type Tok = [string, Col];
interface Row { y: number; h: number; num: number; toks: Tok[]; kind: 'code' | 'lyric' | 'msg'; i: number }

export default class Code extends Scene {
  bg = shared('code.bg', BG);
  win!: Layer2D;
  winRT!: THREE.WebGLRenderTarget;
  rig!: ScreenRig;
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  TH = 1000;
  rows: Row[] = [];
  lyricRows = 1;
  fit: FitResult | null = null;
  tType0 = 0; tType1 = 0; tSel = 0; tRack = 0;
  /** 歌詞那一行、留言那一段、love() 那一行的中心（貼圖座標）。 */
  lyricY = 0; msgY = 0; msgTop = 0; msgBot = 0; loveRow = 0;
  /** 歌詞那一行的字級（貼圖上）與留言在螢幕上的字級。 */
  lyrSize = 70; msgScreen: number | null = null;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadPlateText(this.ctx, TEXT);
    const mc = document.createElement('canvas').getContext('2d')!;
    const text = this.msg ? this.msg.text : '還沒有人寫。掃描右下角 QR code，寫一句給新人';
    // 留言：v2 的字級（螢幕上 40～60，照字數），寬不超過螢幕上 840 px；沒有留言時字串是邀請，小一號、淡一點
    const fam = F.hand(400);
    const o = { min: V2.msgMin / LS, max: (this.msg ? msgMaxFor(text) : 44) / LS, lineHeight: 1.3, maxLines: 5 };
    const mw = Math.min(TW - MSG_X - PAD_R, 840 / LS), mh = 400 / LS;
    this.fit = fitClauses(mc, text, fam, mw, mh, o) ?? fitText(mc, text, fam, mw, mh, o);
    this.msgScreen = this.msg ? this.fit.size * LS : null;
    // 歌詞：比留言小一級（v2），這個窗格最長的一句要幾行先算好，換句時下面的程式才不會跳
    this.lyrSize = lyricV2(this.msgScreen) / LS;
    mc.font = font(F.mono(400), FS);
    const lyricW = TW - GUT - PAD_R - mc.measureText('  // ♪ ').width;
    for (const ln of this.ctx.lyrics.linesIn(s - 1, e + 1)) this.lyricRows = Math.max(this.lyricRows, typedLayout(mc, ln, F.mono(400), this.lyrSize, lyricW, { minSize: V2.lyrMin / LS, maxRows: 2 }).rows);
    this.buildRows();
    // 時間：第一拍開始打留言；拉焦（歌詞 → 留言）跟著打字開始，一小節內完成；打完的下一個小節線「全選」一下
    const b0 = beatAfter(au, s + 0.05), beat = au.beatPeriod(b0);
    const n = Array.from(text).length;
    this.tType0 = b0;
    this.tType1 = b0 + clamp(0.045 * n + 0.3, 0.6, 2.2);
    this.tRack = b0 + Math.min(4 * beat, 1.6);
    this.tSel = Math.min(barAfter(au, this.tType1 + 0.05), e - beat);
    const last = this.rows[this.rows.length - 1]!;
    this.TH = Math.ceil(last.y + last.h + 150);
    this.win = this.track(new Layer2D(TW, this.TH, undefined, { fast: true }));
    this.winRT = this.track(mipRT(TW, this.TH));
    this.rig = new ScreenRig(this.winRT.texture, TW, this.TH, { decode: false, bezel: 34, radius: 22 });
  }

  override dispose() { this.rig?.dispose(); super.dispose(); }

  private buildRows() {
    const rows: Row[] = [];
    let y = 70, num = 7;
    const add = (toks: Tok[], kind: Row['kind'] = 'code', h = LH, i = 0) => { rows.push({ y, h, num: kind === 'msg' && i > 0 ? 0 : num++, toks, kind, i }); y += h; };
    add([['import', 'kw'], [' { 你, 我 } ', 'id'], ['from', 'kw'], [' "今晚";', 'str']]);
    add([]);
    add([['while', 'kw'], [' (', 'p'], ['true', 'kw'], [') {', 'p']]);
    for (let i = 0; i < this.lyricRows; i++) add([], 'lyric', this.lyrSize * 1.3, i);
    add([['  const', 'kw'], [' 祝福', 'id'], [' = ', 'p'], ['`', 'str']]);
    const fit = this.fit!;
    this.msgTop = y;
    fit.lines.forEach((_, i) => add([], 'msg', i === 0 ? fit.lineHeight + 10 : fit.lineHeight, i));
    this.msgBot = y;
    add([['  `', 'str'], [';', 'p']]);
    this.loveRow = rows.length;
    const name = this.msg ? (this.msg.name || '一位賓客') : '你';
    add([['  love', 'id'], ['(', 'p'], ['祝福', 'id'], [', ', 'p'], [`"${name}"`, 'str'], [');', 'p']]);
    add([['}', 'p']]);
    this.rows = rows;
    const lr = rows.find((r) => r.kind === 'lyric')!;
    this.lyricY = lr.y + lr.h * 0.5;
    this.msgY = (this.msgTop + this.msgBot) / 2;
  }

  // ------------------------------------------------------------ 鏡頭
  private pose(t: number, kick: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    // 拉焦：打字一開始，從歌詞搖到留言（inOutCubic），之後每個小節線再推近一點（outExpo，停在拍點）
    const r = prog(t, this.tType0, this.tRack, ease.inOutCubic);
    const bars = Math.max(0, au.barAt(t) - au.barAt(this.tRack));
    const step = Math.min(5, Math.floor(bars) + prog(bars - Math.floor(bars), 0, 0.3, ease.outExpo));
    const inK = prog(t, s, s + 0.9, ease.outCubic);
    const fy = lerp(this.lyricY + 40, this.msgY - 30, r);
    const scale = lerp(0.66, 0.7, r) * (1 + 0.01 * step) * (1 + 0.005 * kick) * lerp(0.94, 1, inK);
    // 螢幕往後仰、右邊往後退：上面幾行與右半邊離焦點遠，自然糊掉（淺景深），留言與歌詞在焦點上；
    // 螢幕放在畫面左邊一點，右下角 HUD 那一區只看得到暗暗的房間
    this.rig.pose({ fx: GUT + 360, fy, cx: lerp(630, 600, r), cy: lerp(430, 455, r), scale, rx: -0.3 + 0.04 * r, ry: lerp(0.4, 0.32, r) + 0.06 * (1 - inK), rz: -0.015 });
    // 對焦範圍：歌詞那一行到留言的最後一行，上面幾行與右邊糊掉；打字前只對焦在歌詞
    const fy1 = lerp(this.lyricY + LH, this.msgBot + LH * 2, r);
    // 左右整行都在焦點裡（長留言寫到最右邊也要清楚），上下離開就糊
    this.rig.focus(0, this.lyricY - LH * 0.7, TW, fy1, 70);
    return r;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.25, 0.3);
    this.pose(t, f.a.kick);
    const c0 = this.rig.toScreen(TW * 0.4, this.TH * 0.5);
    (this.bg.u.c!.value as THREE.Vector2).set(c0.x, c0.y);
    this.bg.u.k!.value = k;
    this.bg.u.t!.value = t;
    this.bg.render(renderer, out);
    const head = this.drawScreen(t);
    blitToRT(renderer, this.ctx.comp, this.win.texture, this.winRT);
    const u = this.rig.u;
    (u.backCol!.value as THREE.Vector3).set(LIN.ink2[0] * 1.05, LIN.ink2[1] * 1.05, LIN.ink2[2] * 1.05);
    (u.bezelCol!.value as THREE.Vector3).set(LIN.ink[0] * 0.6, LIN.ink[1] * 0.6, LIN.ink[2] * 0.6);
    (u.rimCol!.value as THREE.Vector3).set(...LIN.bone);
    u.glare!.value = 0.1 + 0.4 * f.p;
    u.k!.value = k;
    this.rig.render(renderer, out);
    this.glow.clear();
    if (head && k > 0.6) {
      const p = this.rig.toScreen(head.x, head.y);
      sparkParticles(this.glow, t, () => p, { rate: 70, life: 0.3, speed: 180, seed: 5 });
      sparkHead(this.glow, p.x, p.y, t, 0.8);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.55, vignette: 0.55 };
  }

  /** 畫螢幕內容；回傳正在打字的位置（貼圖座標）給火花。 */
  private drawScreen(t: number): { x: number; y: number } | null {
    const L = this.win; L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    let head: { x: number; y: number } | null = null;
    // 全選：留言打完後的小節線，反白由左掃到右、再退掉
    const sel = prog(t, this.tSel, this.tSel + 0.3, ease.outCubic), selOut = 1 - prog(t, this.tSel + 0.5, this.tSel + 1.2);
    if (sel > 0 && selOut > 0) {
      c.fillStyle = rgba('signal', 0.055 * selOut);
      c.fillRect(MSG_X - 12, this.msgTop + 4, (TW - MSG_X - PAD_R + 24) * sel, this.msgBot - this.msgTop);
    }
    this.drawMinimap(c, t);
    this.drawStatus(c, t);
    // love() 那一行：留言打完之後迴圈在跑，大鼓一打就亮一下
    const lr = this.rows[this.loveRow]!, kick = this.ctx.audio.hit('kick', t, 0.14);
    if (t >= this.tType1 && kick > 0.02) { c.fillStyle = rgba('signal', 0.035 * kick); c.fillRect(0, lr.y + 4, TW, lr.h - 8); }
    for (const r of this.rows) {
      const base = r.y + r.h * 0.5 + (r.kind === 'lyric' ? this.lyrSize : FS) * 0.36;
      if (r.kind !== 'msg' || r.i === 0) {
        c.font = font(F.mono(400), 26); c.textAlign = 'right'; c.fillStyle = rgba('graphite', 0.75);
        c.fillText(String(r.num), GUT - 34, r.kind === 'msg' ? r.y + r.h * 0.62 : base - 6);
        c.textAlign = 'left';
      }
      if (r.kind === 'code') this.drawToks(c, r.toks, GUT, base);
      else if (r.kind === 'lyric' && r.i === 0) head = this.drawLyricRow(c, t, base) ?? head;
      else if (r.kind === 'msg' && r.i === 0) head = this.drawMsg(c, t) ?? head;
    }
    L.upload();
    return head;
  }

  /** 右邊的縮圖捲軸：整份程式的縮影，可視範圍的框一拍往下走一格（次要動作落在拍點）。 */
  private drawMinimap(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const x0 = TW - 190, w = 120, y0 = 60, h = this.TH - 180;
    c.fillStyle = rgba('bone', 0.03); c.fillRect(x0 - 10, y0 - 10, w + 20, h + 20);
    for (let y = 0, i = 0; y < h; y += 9, i++) {
      const len = hash(i, 5) < 0.12 ? 0 : (0.2 + 0.8 * hash(i, 9)) * w * (0.4 + 0.6 * ((i % 7) / 7));
      c.fillStyle = hash(i, 11) < 0.2 ? rgba('signal', 0.16) : rgba('bone', 0.1);
      c.fillRect(x0 + (i % 3) * 8, y0 + y, len, 4);
    }
    const bt = au.beatAt(t), i = Math.floor(bt), step = i + prog(bt - i, 0, 0.3, ease.outExpo);
    const vh = h * 0.18, vy = y0 + ((step * 0.045) % 1) * (h - vh);
    c.fillStyle = rgba('bone', 0.06); c.fillRect(x0 - 6, vy, w + 12, vh);
    c.strokeStyle = rgba('bone', 0.14); c.lineWidth = 1.5; c.strokeRect(x0 - 6, vy, w + 12, vh);
  }

  /** 最下面的執行狀態（小字、低對比）：留言打完之後 love() 每兩拍跑一次，計數往上跳。 */
  private drawStatus(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, y = this.TH - 56;
    c.fillStyle = rgba('bone', 0.05); c.fillRect(0, y - 36, TW, 1.5);
    const bt = au.beatAt(t), blink = 1 - clamp((bt - Math.floor(bt)) * 2.5);
    const run = t >= this.tType1;
    c.fillStyle = rgba(run ? 'signal' : 'ash', run ? 0.35 + 0.5 * blink : 0.4);
    c.beginPath(); c.arc(GUT - 50, y - 10, 7, 0, Math.PI * 2); c.fill();
    c.font = font(F.mono(500), 30); c.fillStyle = rgba('ash', 0.55);
    const n = run ? Math.floor((bt - au.beatAt(this.tType1)) / 2) + 1 : 0;
    c.fillText(run ? `執行中　love() × ${n}` : '待命', GUT - 30, y);
  }

  private drawToks(c: CanvasRenderingContext2D, toks: Tok[], x: number, y: number) {
    c.font = font(F.mono(400), FS);
    for (const [s, k] of toks) {
      c.fillStyle = COLORS[k]();
      c.fillText(s, x, y);
      x += c.measureText(s).width;
    }
    return x;
  }

  /** 歌詞註解：「// ♪ 」後面是這一句，先淡淡地排好，唱到的字打上去。 */
  private drawLyricRow(c: CanvasRenderingContext2D, t: number, base: number): { x: number; y: number } | null {
    const { lyrics, song } = this.ctx;
    const x0 = this.drawToks(c, [['  // ♪ ', 'cm']], GUT, base);
    const ly = lyricAt(lyrics, t, 2.5, 2);
    if (!ly) {
      c.font = font(F.mono(400), this.lyrSize); c.fillStyle = COLORS.cm();
      c.fillText(lyrics.has ? '（間奏）' : `${song.title || '今晚的歌'}`, x0, base);
      return null;
    }
    const sz = this.lyrSize, lh = sz * 1.3;
    const lay = typedLayout(c, ly.line, F.mono(400), sz, TW - x0 - PAD_R, { minSize: V2.lyrMin / LS, maxRows: 2 });
    const cur = drawTyped(c, lay, F.mono(400), x0, base, lh, t, { active: rgba('signal'), sung: rgba('bone', 0.86), ghost: rgba('bone', 0.2) }, ly.k);
    for (let r = 1; r < lay.rows; r++) this.drawToks(c, [['  //   ', 'cm']], GUT, base + r * lh);
    return cur.typing ? { x: cur.x, y: cur.y - sz * 0.35 } : null;
  }

  /** 字串裡的留言：第一拍開始一個字一個字打進去。 */
  private drawMsg(c: CanvasRenderingContext2D, t: number): { x: number; y: number } | null {
    const fit = this.fit!;
    const total = fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const shown = Math.floor(total * prog(t, this.tType0, this.tType1));
    const y0 = this.msgTop + 10 + fit.size * 0.95;
    const col = this.msg ? rgba('bone', 0.97) : rgba('bone', 0.45);
    const hd = drawMessage(c, fit, F.hand(400), MSG_X, y0, { chars: shown, color: col });
    if (shown < total && t >= this.tType0 && hd) return { x: hd.x, y: hd.y };
    // 打完：游標停在結尾，一拍閃一下
    if (shown >= total && hd && Math.floor(this.ctx.audio.beatAt(t) * 2) % 2 === 0) { c.fillStyle = rgba('signal', 0.9); c.fillRect(hd.x + 6, hd.y - fit.size * 0.45, 5, fit.size * 0.95); }
    return null;
  }
}

const COLORS: Record<Col, () => string> = {
  kw: () => rgba('signal', 0.28),
  id: () => rgba('bone', 0.3),
  str: () => rgba('ember', 0.78),
  p: () => rgba('ash', 0.36),
  cm: () => rgba('ash', 0.5),
};
