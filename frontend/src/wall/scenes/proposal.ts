// 求婚（暗、wedding、日常服）：夜裡的城市頂樓陽台。宣文單膝跪下、在小節線打開戒指盒，對面大樓的窗戶一格一格亮成留言的字。
// 角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 故事照小節走：站著（宣文手背在後面藏著戒指盒）→ 小節線前兩拍單膝跪下（預備）→ **小節線上打開戒指盒**（訊號色的光往外炸、火星繞著戒指）、
//    孟庭同一刻摀住嘴往後一縮 → 下一個小節線孟庭伸出手 → 再下一個小節線兩人抱在一起轉圈，天上開始放煙火（一小節一發，炸在小節線上）。
//    窗格長（≥ 7 小節）時每一步多停一小節；窗格短時故事演到哪算哪（留言一樣完整出現）。
//  - **焦點是主打留言**：寫在畫面左邊那棟大樓的玻璃帷幕上——字是「亮著的窗」（字形上切出一格一格的窗框），
//    第一拍起一個字一個字亮起來（像日光燈閃兩下才亮），署名最後亮。照「留言尺寸與版面比例標準 v2」：字 40～60、範圍 680 × 400。
//    沒有留言時窗戶排出邀請、亮度低，歌詞變主角。
//  - 歌詞在陽台地板前緣（下三分之一），比留言小一級（40～52），照跟唱規則逐字亮。
//  - 次要動作落在拍點：右上的串燈每拍亮一下、有一顆燈跟著八分音符往前跑；遠處大樓的窗戶在拍點上零星開關；大樓頂的航空警示燈一小節閃一次。
//  - 紙偶用 puppetLight 打成上亮下暗（夜裡、串燈從上面照），不會比窗戶上的字還亮。鏡頭整個窗格慢慢推近兩個人，打開戒指盒那一下輕輕一頓。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, mulberry32 } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, sparkParticles, msgChars, signature } from './_motifs';
import { drawNote, type Note, type Pt } from './_couple';
import { loadPuppets, drawPick, drawPuppet, FADE, puppetPoint, puppetBox, puppetShadow, puppetIn, puppetLight, jumpArc, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'wedding', paper: false, energy: [0.2, 0.9], bars: [4, 8] };

/** 陽台地板（腳底）與場景尺度（宣文的身高 px）。 */
const FLOOR = 884;
const SZ = 430;
/** 宣文（面向右）、孟庭（翻過來面向左）、抱在一起時的中心。 */
const AL_X = 1000, OM_X = 1262, HUG_X = 1128;
/**
 * 抱起來那張的基準高度量到的是被抱高的孟庭頭頂（比宣文高一截），整張會被縮小；放大回來，宣文才跟單人的圖一樣高
 * （原圖：孟庭頭頂 y≈21、宣文頭頂 y≈85、腳底 y≈1238）。
 */
const HUG_S = (1238 - 21) / (1238 - 85);
/** 玻璃欄杆：扶手與底座的高度。 */
const RAIL = { top: 640, base: 806 };
/** 對面的大樓（留言寫在它的窗戶上）與留言的範圍（標準 v2：≤ 860 × 430）。 */
const TOWER = { x: 110, y: 150, w: 790 };
/** 大樓頂上退縮的兩層（相對大樓左上角）與天線頂的航空警示燈。 */
const CROWN = [{ dx: 90, w: 540, top: 44, h: 44 }, { dx: 300, w: 200, top: 84, h: 40 }];
const ANT = { x: TOWER.x + 400, y: TOWER.y - 150 };
const MSG = { x: 168, y: 206, w: 680, h: 400 };
/** 玻璃帷幕的窗格（px）：留言的字也切成這個格子，看起來就是一格一格亮著的窗。 */
const GX = 8, GY = 10;
/** 歌詞：陽台地板前緣，左邊對齊；最後一排的基線。 */
const LYR = { x: 150, base: 972, w: 1120 };
/** 串燈：右上一條懸垂線。 */
const LIGHTS = { x0: 930, y0: 92, x1: 1850, y1: 128, sag: 92, n: 17 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';

/** 姿勢圖。 */
const P = {
  alStand: 'xw_proposal_stand', alKneel1: 'xw_proposal_kneel_1', alKneel2: 'xw_proposal_kneel_2',
  omStand: 'mt_proposal_stand', omGasp: 'mt_proposal_gasp', omHand: 'mt_proposal_hand', hug: 'cp_proposal_hug',

} as const;

interface Rect { x: number; y: number; w: number; h: number }
/** 一格要亮起來的字：在留言畫布上的範圍與亮起的時間。 */
interface Cell extends Rect { t: number }

/**
 * 夜空：上面最暗，往地平線帶一點訊號色的城市光暈，零星幾顆星（很淡、慢慢閃）。
 * 用 shader 算（浮點＋一點點抖色）：Canvas2D 的淡漸層只有幾個 8 位元的階，大螢幕上會看到一條一條的。
 */
const SKY = () => new FSPass(/* glsl */ `
  uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float y = p.y / ${H}.0;
    vec3 col = mix(C_INK, mix(C_INK, C_INK2, 0.9), smoothstep(0.0, 0.62, y));
    float haze = exp(-pow((p.y - 700.0) / 190.0, 2.0));
    col += C_BLOOD * 0.05 * haze + C_SIGNAL * 0.012 * haze;
    vec2 g = floor(p / 4.0);
    float h = hash12(g);
    float star = step(0.9982, h) * (1.0 - smoothstep(160.0, 560.0, p.y));
    col += C_BONE * star * (0.12 + 0.1 * sin(t * 1.3 + h * 60.0));
    col += (hash12(p + 0.5) - 0.5) * 0.003;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 } });

export default class Proposal extends Scene {
  sky = shared('proposal.sky', SKY);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 窗戶上的留言（init 畫一次、切好窗格），每格只把亮起來的字貼到 fg。只當圖源，不上傳。 */
  msgL = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  cells: Cell[] = [];
  sigCell: Cell | null = null;
  /** 故事的時間點：跪下、打開戒指盒、伸手、擁抱。 */
  tKneel = 0; tOpen = 0; tHand = 0; tHug = 0;
  alKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  /** 煙火：炸開的時間、位置、顏色的種子。 */
  shells: { t: number; x: number; y: number; seed: number }[] = [];
  /** 遠處會在拍點上開關的窗。 */
  twinkles: Rect[] = [];
  box: Pt = { x: 0, y: 0 };
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(Object.values(P)));
    // ---- 故事的時間點（都在小節線上；跪下在小節線前兩拍）
    const bp = au.beatPeriod(s);
    const b0 = Math.round(au.barAt(s));
    const bar = au.timeOfBar(b0 + 1) - au.timeOfBar(b0);
    const nb = (e - s) / Math.max(0.3, bar);
    const gap = nb >= 7 ? 2 : 1;
    this.tOpen = barAfter(au, s + Math.max(0.9, bp * 2.5), nb >= 9 ? 1 : 0);
    const ob = Math.round(au.barAt(this.tOpen));
    this.tKneel = Math.max(s + 0.5, this.tOpen - bp * (this.tOpen - bp * 2 >= s + 0.55 ? 2 : 1));
    this.tHand = au.timeOfBar(ob + gap);
    this.tHug = au.timeOfBar(ob + gap * 2);
    this.alKeys = [[-1e9, P.alStand], [this.tKneel, P.alKneel1], [this.tOpen, P.alKneel2]];
    this.omKeys = [[-1e9, P.omStand], [this.tOpen, P.omGasp], [this.tHand, P.omHand]];
    this.box = this.pointOr(P.alKneel2, 'box', AL_X, FLOOR, 0.92, 0.38);
    // 煙火：擁抱那一刻起每個小節線一發（右上的天空，不碰左邊的留言）
    const rnd = mulberry32(31);
    for (let b = Math.round(au.barAt(this.tHug)), k = 0; k < 24; b++, k++) {
      const tb = au.timeOfBar(b);
      if (tb > e + 0.1) break;
      this.shells.push({ t: tb, x: 1120 + rnd() * 560, y: 190 + rnd() * 150, seed: k * 7 + 3 });
    }
    // ---- 窗戶上的留言
    const c = this.msgL.ctx;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, MSG.w, MSG.h) : noteV2(c, INVITE, null, MSG.w, MSG.h * 0.5, { max: 44 });
    tightenNote(c, this.note, 300);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.layoutWindows();
    this.drawBackground();
  }

  /** 圖上的道具點（sprites.json 量的）；沒有就用外框的比例估一個。 */
  private pointOr(name: string, key: string, x: number, y: number, fx: number, fy: number): Pt {
    const p = puppetPoint(name, key, x, y, { h: SZ });
    if (p) return p;
    const [bx, by, bw, bh] = puppetBox(name, x, y, { h: SZ });
    return { x: bx + bw * fx, y: by + bh * fy };
  }

  /**
   * 把留言畫到 msgL（窗光的顏色、後面一層很淡的光暈），再切出窗框；算好每個字的範圍與亮起的時間
   * （第一拍起一個字一個字，最後署名）。之後每格只把亮了的字貼上去。
   */
  private layoutWindows() {
    const n = this.note!, L = this.msgL, c = L.ctx;
    const au = this.ctx.audio;
    const x0 = MSG.x + Math.max(0, (MSG.w - n.width) / 2);
    const y0 = MSG.y + Math.max(0, (MSG.h - n.height) * 0.42);
    const lit = this.msg ? mixRgba('bone', 'ember', 0.32) : mixRgba('bone', 'ember', 0.3, 0.5);
    L.clear();
    // 光暈：同一段字糊開、很淡（窗光灑在帷幕上）
    c.save();
    c.filter = 'blur(9px)';
    c.globalAlpha = 0.22;
    drawNote(c, n, x0, y0, { color: rgba('ember'), sigColor: rgba('ember'), sigK: 1 });
    c.restore();
    drawNote(c, n, x0, y0, { color: lit, sigColor: mixRgba('bone', 'ember', 0.2, 0.8), sigK: 1 });
    // 窗框：跟大樓帷幕同一個格子（署名那一列不切，小字要清楚）
    const sigTop = y0 + n.fit.height + n.sigRow * 0.72 - n.sig * 1.05;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fillStyle = '#000';
    for (let x = TOWER.x + GX; x < TOWER.x + TOWER.w; x += GX) c.fillRect(x - 0.6, MSG.y - 20, 1.2, sigTop - MSG.y + 14);
    for (let y = TOWER.y + GY; y < sigTop - 6; y += GY) c.fillRect(TOWER.x, y - 0.8, TOWER.w, 1.6);
    c.restore();
    // 每個字的範圍：跟 drawMessage 一樣量字寬（中英混排、愛心都一樣）
    const f = n.fit;
    c.save();
    c.font = font(n.family, f.size);
    const t0 = beatAfter(au, this.ctx.start + 0.3);
    const total = msgChars(f);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.09);
    let k = 0;
    f.lines.forEach((ln, i) => {
      const base = y0 + f.size * 0.9 + i * f.lineHeight;
      const chars = Array.from(ln);
      let pre = '';
      for (const ch of chars) {
        const a = c.measureText(pre).width;
        pre += ch;
        const b = c.measureText(pre).width;
        this.cells.push({ x: x0 + a, y: base - f.size * 1.08, w: b - a, h: f.size * 1.42, t: t0 + (k++) * per + hash(k, 5) * per * 0.6 });
      }
    });
    if (n.name !== null) {
      c.font = font(n.family, n.sig);
      const sw = c.measureText(signature(n.name)).width;
      const by = y0 + f.height + n.sigRow * 0.72;
      this.sigCell = { x: x0 + n.width - sw - 4, y: by - n.sig * 1.1, w: sw + 8, h: n.sig * 1.5, t: t0 + total * per + 0.15 };
    }
    c.restore();
  }

  /** 不會動的：遠近兩層城市、對面大樓的帷幕、玻璃欄杆、陽台地板（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const rnd = mulberry32(7);
    const warm = (a: number) => mixRgba('bone', 'ember', 0.45, a);
    // 遠的一層：矮、顏色接近天空
    for (let x = -20; x < W; ) {
      const w = 50 + rnd() * 110, top = 560 + rnd() * 130;
      c.fillStyle = mixRgba('ink', 'ink2', 0.55);
      c.fillRect(x, top, w - 2, RAIL.base - top);
      x += w;
    }
    // 近一點的一層：高低錯落（有的頂上退縮一層、有水塔或天線）、零星亮著的窗（很淡）
    for (let x = 880; x < W; ) {
      const w = 70 + rnd() * 150, top = 430 + rnd() * 210;
      c.fillStyle = rgba('ink2');
      c.fillRect(x, top, w - 3, RAIL.base - top);
      const r0 = rnd();
      if (r0 < 0.4) c.fillRect(x + w * 0.2, top - 18 - rnd() * 26, w * 0.55, 40);
      else if (r0 < 0.65) { c.fillRect(x + w * 0.6, top - 16, 22, 16); c.fillRect(x + w * 0.6 + 4, top - 22, 14, 6); }
      else if (r0 < 0.8) c.fillRect(x + w * 0.3, top - 50, 2, 50);
      for (let wy = top + 14; wy < RAIL.base - 10; wy += 16) for (let wx = x + 8; wx < x + w - 12; wx += 12) {
        const r = rnd();
        if (r < 0.1) { c.fillStyle = warm(0.05 + rnd() * 0.12); c.fillRect(wx, wy, 6, 8); c.fillStyle = rgba('ink2'); }
        else if (r < 0.13 && this.twinkles.length < 44 && wy < RAIL.top - 10) this.twinkles.push({ x: wx, y: wy, w: 6, h: 8 });
      }
      x += w + rnd() * 20;
    }
    // 對面的大樓：玻璃帷幕（窗格、每五層一條樓板、幾道直的鋁條），頂上退縮兩層、一根天線；零星亮著的窗
    const T = TOWER, tb = RAIL.base;
    const blocks: Rect[] = [
      { x: T.x, y: T.y, w: T.w, h: tb - T.y },
      ...CROWN.map((k) => ({ x: T.x + k.dx, y: T.y - k.top, w: k.w, h: k.h })),
    ];
    for (const B of blocks) {
      c.fillStyle = mixRgba('ink', 'ink2', 0.45);
      c.fillRect(B.x - 20, B.y + 10, 20, B.h - 10);
      c.fillStyle = mixRgba('ink2', 'graphite', 0.1);
      c.fillRect(B.x, B.y, B.w, B.h);
      const g = c.createLinearGradient(0, T.y - 90, 0, tb);
      g.addColorStop(0, rgba('bone', 0.035)); g.addColorStop(1, rgba('ink', 0.28));
      c.fillStyle = g;
      c.fillRect(B.x, B.y, B.w, B.h);
      c.fillStyle = rgba('ink', 0.5);
      for (let x = T.x; x <= T.x + T.w; x += GX) if (x >= B.x && x <= B.x + B.w) c.fillRect(x - 0.6, B.y, 1.2, B.h);
      for (let y = T.y - 200; y < B.y + B.h; y += GY) if (y >= B.y) c.fillRect(B.x, y - 0.6, B.w, (Math.round((y - T.y) / GY) % 5 === 0) ? 2.4 : 1.2);
      c.fillStyle = rgba('bone', 0.045);
      for (let x = T.x + 79 * GX / 8; x < B.x + B.w; x += 20 * GX) if (x > B.x) c.fillRect(x, B.y, 2, B.h);
      for (let y = B.y + 3; y < B.y + B.h - 8; y += GY) for (let x = B.x + 2; x < B.x + B.w - 6; x += GX) {
        if (rnd() < 0.035) { c.fillStyle = warm(0.04 + rnd() * 0.08); c.fillRect(x, y, GX - 3, GY - 4); }
      }
      c.fillStyle = mixRgba('ink', 'ink2', 0.7);
      c.fillRect(B.x - 6, B.y - 8, B.w + 12, 9);
    }
    c.fillRect(ANT.x - 1.5, ANT.y, 3, T.y - CROWN[CROWN.length - 1]!.top - ANT.y);
    // 玻璃欄杆：玻璃讓後面暗一點、一道斜的反光；立柱、扶手
    c.fillStyle = rgba('ink', 0.28);
    c.fillRect(0, RAIL.top, W, RAIL.base - RAIL.top);
    c.save();
    c.beginPath(); c.rect(0, RAIL.top, W, RAIL.base - RAIL.top); c.clip();
    for (const x of [360, 1480]) {
      const rg = c.createLinearGradient(x, 0, x + 160, 0);
      rg.addColorStop(0, rgba('bone', 0)); rg.addColorStop(0.5, rgba('bone', 0.035)); rg.addColorStop(1, rgba('bone', 0));
      c.fillStyle = rg;
      c.beginPath(); c.moveTo(x, RAIL.base); c.lineTo(x + 110, RAIL.top); c.lineTo(x + 190, RAIL.top); c.lineTo(x + 80, RAIL.base); c.fill();
    }
    c.restore();
    c.fillStyle = rgba('bone', 0.1);
    for (let x = 60; x < W; x += 270) c.fillRect(x, RAIL.top, 2, RAIL.base - RAIL.top);
    c.fillStyle = rgba('bone', 0.26);
    c.fillRect(0, RAIL.top - 3, W, 3);
    c.fillStyle = rgba('bone', 0.08);
    c.fillRect(0, RAIL.top, W, 2);
    // 陽台地板：底座一條線，往前越來越亮一點點（串燈照下來），幾條很淡的磁磚縫
    c.fillStyle = rgba('ink2');
    c.fillRect(0, RAIL.base, W, H - RAIL.base);
    const fl = c.createRadialGradient(HUG_X, FLOOR, 20, HUG_X, FLOOR, 620);
    fl.addColorStop(0, rgba('bone', 0.05)); fl.addColorStop(1, rgba('bone', 0));
    c.fillStyle = fl;
    c.fillRect(0, RAIL.base, W, H - RAIL.base);
    c.fillStyle = rgba('bone', 0.12);
    c.fillRect(0, RAIL.base, W, 1.5);
    c.fillStyle = rgba('bone', 0.035);
    for (const [y, k] of [[830, 1], [868, 1.4], [918, 2], [990, 2.8]] as const) c.fillRect(0, y, W, k);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.sky.u.t!.value = t;
    this.sky.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    this.drawCouple(c, t, bp);
    puppetLight(c, [AL_X - 300, FLOOR - SZ * 1.25, 760, SZ * 1.25 + 40], rgba('ink', 0.04), rgba('ink', 0.46));

    // ---- 遠處的窗在拍點上零星開關；大樓頂的航空警示燈一小節閃一次
    const bi = Math.floor(au.beatAt(t) + 1e-6);
    c.fillStyle = mixRgba('bone', 'ember', 0.45, 0.32);
    this.twinkles.forEach((w, i) => { if (hash(i, bi) > 0.55) c.fillRect(w.x, w.y, w.w, w.h); });
    const blink = Math.exp(-((au.barAt(t) % 1) * (au.timeOfBar(Math.floor(au.barAt(t)) + 1) - au.timeOfBar(Math.floor(au.barAt(t))))) / 0.18);
    const sg = LIN.signal;
    this.glow.seg2(ANT.x, ANT.y, ANT.x + 0.1, ANT.y, 5, [sg[0] * 3, sg[1] * 1.2, sg[2] * 1.2], 0.25 + 0.75 * blink);

    // ---- 窗戶上的留言、地板前緣的歌詞
    this.drawWindows(c, t);
    this.drawLyrics(c, t);

    comp.draw(renderer, L.upload(), out);

    // ---- 發光：串燈、戒指盒、煙火
    this.drawLights(t, f);
    this.drawRing(t, bp);
    for (const sh of this.shells) this.firework(t, sh);
    if (this.glow.count) this.glow.render(renderer, out);

    // 鏡頭：整個窗格慢慢推近兩個人；打開戒指盒那一下輕輕一頓
    const push = ease.inOutCubic(f.p);
    const kick = t >= this.tOpen ? Math.exp(-(t - this.tOpen) / 0.25) : 0;
    const z = 0.035 * push + 0.012 * kick;
    return { bloom: 0.7, vignette: 0.52, halation: 0.05, zoom: 1 + z, shake: [-(HUG_X - W / 2) * z, -(640 - H / 2) * z * 0.5] };
  }

  /** 宣文與孟庭：擁抱之前各自一張紙偶，擁抱之後換成兩人一起的那張（交叉淡化、跳起來抱住再落地）。 */
  private drawCouple(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const hugIn = this.tHug - bp * 0.35;
    const kick = beatKick(au, t, 0.25);
    if (t < hugIn + 0.08) {
      const fadeK = 1 - clamp((t - hugIn) / 0.08);
      // 宣文：站著呼吸（緊張）、跪下時往下一沉再彈一下
      const ea = puppetIn(t, s + 0.05, 0.45);
      if (ea.alpha > 0) {
        const kneelSq = t >= this.tKneel ? 0.12 * Math.exp(-(t - this.tKneel) / 0.1) * Math.cos((t - this.tKneel) * 22) : 0;
        const openLift = t >= this.tOpen ? 0.02 * Math.exp(-(t - this.tOpen) / 0.3) : 0;
        const o: PuppetOpts = { h: SZ, spin: ea.spin, alpha: ea.alpha * fadeK, squash: breathe(t, 0.012, 2.2) + kneelSq - openLift, rot: t >= this.tOpen ? -0.03 * Math.exp(-(t - this.tOpen) / 0.4) : 0, pivot: 0.1 };
        puppetShadow(c, 'xw', AL_X, FLOOR, { h: SZ, alpha: 0.7 * ea.alpha * fadeK, color: '0,0,0' });
        drawPick(c, this.alKeys, t, AL_X, FLOOR, o);
      }
      // 孟庭：站著跟著拍子輕輕點；打開戒指盒那一刻往後一縮、驚喜地一跳；伸手的時候往前一點
      const eo = puppetIn(t, s + 0.18, 0.45);
      if (eo.alpha > 0) {
        const back = t >= this.tOpen ? ease.outCubic(prog(t, this.tOpen, this.tOpen + 0.25)) * (1 - prog(t, this.tHand - 0.2, this.tHand + 0.1, ease.inOutCubic)) : 0;
        const j = jumpArc(t, this.tOpen + 0.02, this.tOpen + Math.min(0.36, bp * 0.8), 16, { crouch: 0.04, land: 0.1 });
        const x = OM_X + 18 * back - (t >= this.tHand ? 10 * ease.outCubic(prog(t, this.tHand, this.tHand + 0.3)) : 0);
        puppetShadow(c, 'mt', x, FLOOR, { h: SZ, lift: -j.y, alpha: 0.7 * eo.alpha * fadeK, color: '0,0,0' });
        this.drawOm(c, t, x, FLOOR + j.y, { h: SZ, spin: eo.spin, alpha: eo.alpha * fadeK, squash: j.squash + breathe(t, 0.01, 2.6, 0.3) + 0.015 * kick * (t < this.tOpen ? 1 : 0), rot: 0.05 * back, pivot: 0.1 });
      }
    }
    if (t >= hugIn) {
      // 抱在一起：孟庭跳進懷裡（整張輕輕一跳、落地壓扁），之後跟著拍子左右晃、像在慢慢轉圈
      const k = clamp((t - hugIn) / 0.08);
      const j = jumpArc(t, hugIn, this.tHug + bp * 0.2, 22, { crouch: 0.03, land: 0.12 });
      const sw = Math.sin(au.beatAt(t) * Math.PI * 0.5) * 0.025;
      puppetShadow(c, 'cp', HUG_X, FLOOR, { h: SZ, lift: -j.y, alpha: 0.75 * k, color: '0,0,0' });
      drawPuppet(c, P.hug, HUG_X, FLOOR + j.y, { h: SZ, scale: HUG_S, alpha: k, squash: j.squash + 0.012 * beatKick(au, t, 0.3), rot: sw, pivot: 0.2 });
    }
  }

  /**
   * 孟庭的姿勢時間軸（跟 drawPick 一樣換圖時舊的淡出 FADE 秒）：她要面向左邊的宣文。
   * 側面的圖都朝右、要翻過來；只有摀嘴那張 Codex 畫成朝左（臉轉向左），不用翻——每張圖各自決定翻不翻。
   */
  private drawOm(c: CanvasRenderingContext2D, t: number, x: number, y: number, o: PuppetOpts) {
    const flipOf = (n: string) => n !== P.omGasp;
    let k = 0;
    for (let i = 0; i < this.omKeys.length; i++) if (t >= this.omKeys[i]![0]) k = i;
    const cur = this.omKeys[k]![1];
    drawPuppet(c, cur, x, y, { ...o, flip: flipOf(cur) });
    const since = t - this.omKeys[k]![0], prev = this.omKeys[k - 1]?.[1];
    if (prev && prev !== cur && since < FADE) drawPuppet(c, prev, x, y, { ...o, flip: flipOf(prev), alpha: (o.alpha ?? 1) * (1 - since / FADE) });
  }

  /** 打開戒指盒：小節線上訊號色的光往外炸一圈（一拍內收掉），之後戒指一直有幾顆火星繞著；抱在一起之後收掉。 */
  private drawRing(t: number, bp: number) {
    if (t < this.tOpen || t > this.tHug) return;
    const u = t - this.tOpen, B = this.box, sg = LIN.signal, em = LIN.ember;
    if (u < bp * 1.2) {
      const k = u / (bp * 1.2), fade = (1 - k) * (1 - k);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + hash(i, 3) * 0.3;
        const r0 = 14 + 60 * ease.outCubic(k), r1 = r0 + 26 + 50 * hash(i, 9) * (1 - k);
        this.glow.seg2(B.x + Math.cos(a) * r0, B.y + Math.sin(a) * r0, B.x + Math.cos(a) * r1, B.y + Math.sin(a) * r1, 1.6, [sg[0] * 3, sg[1] * 3, sg[2] * 3], fade);
      }
    }
    const on = 1 - prog(t, this.tHug - 0.3, this.tHug);
    this.glow.seg2(B.x, B.y, B.x + 0.1, B.y, 7 + 3 * Math.exp(-u / 0.3), [em[0] * 3, em[1] * 3, em[2] * 3], 0.9 * on);
    sparkParticles(this.glow, t, (tb) => (tb >= this.tOpen && tb <= this.tHug - 0.3 ? { x: B.x, y: B.y } : null), { rate: 26, life: 0.5, speed: 60, gravity: -30, seed: 11, intensity: 0.8 });
  }

  /** 串燈：每拍一起亮一下，一顆燈跟著八分音符往前跑。 */
  private drawLights(t: number, f: Frame) {
    const { x0, y0, x1, y1, sag, n } = LIGHTS, em = LIN.ember;
    const au = this.ctx.audio;
    const pulse = beatKick(au, t, 0.3);
    const chase = Math.floor(au.beatAt(t) * 2) % n;
    const pts: Pt[] = [];
    for (let i = 0; i <= 40; i++) { const u = i / 40; pts.push({ x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u + sag * 4 * u * (1 - u) }); }
    this.glow.polyline(pts, 1, [LIN.bone[0] * 0.25, LIN.bone[1] * 0.25, LIN.bone[2] * 0.25], 0.5);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u + sag * 4 * u * (1 - u) + 7;
      const b = 0.45 + 0.35 * pulse + (i === chase ? 0.9 : 0) + 0.1 * Math.sin(t * 2 + i);
      const k = 1.6 + 1.4 * b;
      this.glow.seg2(x, y, x + 0.1, y, 6.5, [em[0] * k, em[1] * k, em[2] * k], clamp(b) * clamp(f.lt / 0.4));
    }
  }

  /** 一發煙火：小節線前從地平線升起、小節線上炸開成一圈細線（往下垂、淡掉）。 */
  private firework(t: number, sh: { t: number; x: number; y: number; seed: number }) {
    const au = this.ctx.audio;
    const rise = Math.min(0.7, au.beatPeriod(sh.t) * 1.4);
    const u = t - sh.t;
    if (u < -rise || u > 2.2) return;
    const sg = LIN.signal, em = LIN.ember;
    if (u < 0) {
      const k = 1 + u / rise;
      const y = RAIL.top + (sh.y - RAIL.top) * ease.outCubic(k);
      this.glow.seg2(sh.x, y + 30, sh.x, y, 1.4, [em[0] * 2.5, em[1] * 2.5, em[2] * 2.5], 0.8);
      return;
    }
    const k = 1 - Math.exp(-u * 3.2), fade = Math.pow(1 - u / 2.2, 1.6);
    const R = 110 + 50 * hash(sh.seed, 1);
    const col = hash(sh.seed, 2) > 0.5 ? sg : em;
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + hash(sh.seed, i) * 0.12;
      const r = R * k * (0.85 + 0.15 * hash(i, sh.seed));
      const droop = 34 * u * u;
      const x1 = sh.x + Math.cos(a) * r, y1 = sh.y + Math.sin(a) * r + droop;
      const x0 = sh.x + Math.cos(a) * r * 0.72, y0 = sh.y + Math.sin(a) * r * 0.72 + droop * 0.7;
      this.glow.seg2(x0, y0, x1, y1, 1.5, [col[0] * 2.6, col[1] * 2.6, col[2] * 2.6], fade);
    }
  }

  /** 窗戶上的留言：亮了的字從 msgL 貼上來（亮的時候像日光燈閃兩下），署名最後亮。 */
  private drawWindows(c: CanvasRenderingContext2D, t: number) {
    const src = this.msgL.canvas, S = SCALE;
    const one = (r: Cell) => {
      const u = (t - r.t) / 0.16;
      if (u < 0) return;
      const a = u >= 1 ? 1 : [0.7, 0.12, 0.85, 0.35, 1][Math.floor(u * 5)]!;
      c.globalAlpha = a;
      c.drawImage(src, r.x * S, r.y * S, r.w * S, r.h * S, r.x, r.y, r.w, r.h);
    };
    c.save();
    for (const r of this.cells) one(r);
    if (this.sigCell) one(this.sigCell);
    c.restore();
  }

  /** 地板前緣的歌詞（跟唱）；折成兩排時往上長，最後一排的基線不動。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    if (!ly) return;
    const big = !this.msg;
    const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: LYR.w, unsung: rgba('bone', 0.26), sung: rgba('bone', big ? 0.94 : 0.84), active: rgba('signal') };
    const lay = layoutLyric(c, ly.line, st);
    c.save();
    c.translate(LYR.x, LYR.base - (lay.height - lay.size));
    drawLyric(c, ly.line, t, st, lay, ly.k * prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5));
    c.restore();
  }
}
