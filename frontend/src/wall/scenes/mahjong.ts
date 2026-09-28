// 麻將（亮）：正上方往下拍的麻將桌（淺色的毛氈、四邊木頭的桌框），鏡頭像轉盤一樣很慢地轉、慢慢推近。
//  - 主打留言是一副一副的牌：每個字一張（象牙白的牌面、訊號色一家子的牌背，看得到牌的厚度），一開始全部蓋著；
//    在拍點照閱讀順序一張張翻開（翻的時候會浮起來、影子拉開，落下輕輕一彈）。「福、喜、愛、心」這種吉祥字刻紅色。
//  - 全部翻完的下一拍「推倒」：整副牌一起喀一聲，右上角一顆木頭的「胡了」牌子落下來（比留言小，是配角的笑點）。
//  - 歌詞在計分的籌碼上：桌子下方一排籌碼，一個字（英文一個單字）一枚，唱到的那枚跳起來、字變成訊號色，唱完是墨色。
//  - 沒有留言：牌是「宣文♥孟庭」，籌碼放大（歌詞是主角），底下一行邀請。純音樂：籌碼排歌名。
// 手法：毛氈與桌框是全螢幕 shader（跟鏡頭一起轉），牌、籌碼、牌子是開場畫好的小圖（Canvas），每格用 drawImage 擺上去
// （翻牌是垂直方向的縮放，cos 從 −1 到 1，負的時候畫牌背）；轉動只轉畫布座標，不用每格重新光柵化斜的字。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, frameIdx } from '../engine/util';
import { Lyrics, type Line, type Word } from '../engine/lyrics';
import { beatAfter, drawHeart, lyricSizeFor } from './_motifs';
import { sigInk, makeCanvas, freeCanvas, shadowSprite } from './_t1';
import { bestCellRows, onGrid, sigOf, T17_INVITE, T17_TEXT } from './_t17';

export const spec: PlateSpecDecl = { group: 'type', family: 'game', paper: true, energy: [0.3, 1], bars: [4, 8], weight: 1 };

const FAM_TILE = F.ming(900);
const FAM_CHIP = F.hei(700);
const FAM_SIG = F.hand(700);
const NO_MSG_TEXT = '宣文♥孟庭';
/** 刻紅字的吉祥字。 */
const RED = new Set(Array.from('福喜囍愛心幸永樂福壽合好美甜'));
/** 牌的區域（鏡頭落定時的螢幕座標）、籌碼那一排。 */
const AREA = { x0: 190, x1: 1540, y0: 160, y1: 730 };
const CHIPS = { x: 150, y: 880, w: 1170 };

const FELT = () => new FSPass(/* glsl */ `
  uniform mat3 camInv;
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = (camInv * vec3(sp, 1.0)).xy;
    // 毛氈：淺色、細細的纖維雜訊，中間被燈照亮、往外暗下去
    float fib = hash12(floor(q * 1.3)) - 0.5;
    float cloud = fbm(q / 420.0, 3);
    vec3 col = mix(C_PAPER, C_BONE, 0.3) * (0.965 + 0.05 * cloud + 0.025 * fib);
    col = mix(col, mix(C_PAPER, C_SEPIA, 0.12), 0.25);
    // 桌框：畫面外圍一圈木頭（轉動時會露出來），內緣一道陰影
    vec2 e = min(q - vec2(-40.0, -40.0), vec2(${W + 40}.0, ${H + 40}.0) - q);
    float m = min(e.x, e.y);
    float g = fbm(vec2(q.x / 700.0, q.y / 60.0) + (e.x < e.y ? 3.0 : 0.0), 3);
    vec3 wood = mix(C_SEPIA, C_PAPER, 0.35 + 0.12 * g) * (0.9 + 0.08 * sin(q.x / 5.0 + 20.0 * g));
    col *= 1.0 - 0.25 * exp(-max(m, 0.0) / 26.0);
    col = mix(wood, col, smoothstep(-1.0, 1.0, m));
    float r = length((sp - vec2(900.0, 470.0)) * vec2(0.85, 1.2)) / 1150.0;
    col *= 0.8 + 0.26 * exp(-r * r * 1.4);
    fragColor = vec4(col, 1.0);
  }`, { camInv: { value: new THREE.Matrix3() } });

interface Tile { ch: string; x: number; y: number; tf: number; sprite: number }
interface Chip { word: Word; x: number; y: number; w: number; sprite: number }

export default class Mahjong extends Scene {
  felt = shared('mahjong.felt', FELT);
  L = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  sig = '';
  tiles: Tile[] = [];
  faces: ReturnType<typeof makeCanvas>[] = [];
  back: ReturnType<typeof makeCanvas> | null = null;
  shadow: ReturnType<typeof shadowSprite> | null = null;
  marker: ReturnType<typeof makeCanvas> | null = null;
  sigCv: ReturnType<typeof makeCanvas> | null = null;
  tw = 80; th = 106; thick = 14;
  t1 = 0; tDone = 0; tHu = 0; B = 0.5;
  /** 每一行歌詞的籌碼（開場排好）。 */
  chipLines = new Map<Line, { chips: Chip[]; ink: ReturnType<typeof makeCanvas>[]; hot: ReturnType<typeof makeCanvas>[]; faded: ReturnType<typeof makeCanvas>[] }>();
  chipSize = 50;
  blockR = { x0: 0, y0: 0, x1: 0, y1: 0 };
  sigPos = { x: 0, y: 0 };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const text = m ? m.text : NO_MSG_TEXT;
    this.sig = sigOf(m);
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(`${text}${this.sig}${T17_TEXT}${T17_INVITE}${song.title}${song.artist}胡了♪${lines.map((l) => l.text).join('')}`);
    const B = (this.B = au.beatPeriod(s + 0.1));

    // ---- 排牌：每行幾張，挑牌最大的排法
    const aw = AREA.x1 - AREA.x0, ah = AREA.y1 - AREA.y0 - 70;
    const pick = bestCellRows(text, m ? [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] : [12], (cols, rows) => {
      const byW = aw / (cols * 1.07);
      const byH = ah / (rows.length * 1.5);
      return Math.min(byW, byH, m ? (rows.length === 1 ? 128 : 100) : 80);
    });
    const rows = pick.rows.slice(0, 6);
    const cols = Math.max(...rows.map((r) => r.length));
    const tw = (this.tw = Math.floor(Math.min(aw / (cols * 1.07), ah / (rows.length * 1.5), m ? (rows.length === 1 ? 128 : 100) : 80)));
    const th = (this.th = Math.round(tw * 1.33));
    const thick = (this.thick = Math.round(tw * 0.17));
    const gapX = Math.round(tw * 0.06), rowH = th + thick + Math.round(tw * 0.32);
    const blockW = cols * (tw + gapX) - gapX, blockH = rows.length * rowH - (rowH - th - thick);
    const bx = Math.round((AREA.x0 + AREA.x1) / 2 - blockW / 2), by = Math.round(AREA.y0 + (AREA.y1 - AREA.y0 - 60 - blockH) / 2);
    this.blockR = { x0: bx, y0: by, x1: bx + blockW, y1: by + blockH };

    // ---- 牌的小圖：牌面（每個字一張）、牌背；都含牌的厚度（下緣看得到兩層：象牙與牌背的顏色）
    const RES = 1.5;
    const pad = 3;
    const body = (c: CanvasRenderingContext2D, face: boolean) => {
      const r = tw * 0.12;
      // 厚度：下面那一截（牌背的顏色，上面一條象牙色的層）
      c.fillStyle = mixRgba('signal', 'blood', 0.35);
      c.beginPath(); c.roundRect(pad, pad + thick, tw, th, r); c.fill();
      c.fillStyle = mixRgba('bone', 'paper', 0.5);
      c.beginPath(); c.roundRect(pad, pad + thick * 0.45, tw, th, r); c.fill();
      // 上面那一面
      const g = c.createLinearGradient(0, pad, 0, pad + th);
      if (face) { g.addColorStop(0, mixRgba('bone', 'paper', 0.1)); g.addColorStop(1, mixRgba('bone', 'paper', 0.45)); }
      else { g.addColorStop(0, mixRgba('signal', 'paper', 0.5)); g.addColorStop(1, mixRgba('signal', 'paper', 0.28)); }
      c.fillStyle = g;
      c.beginPath(); c.roundRect(pad, pad, tw, th, r); c.fill();
      // 斜邊的高光（左上）與暗邊
      c.strokeStyle = rgba('bone', face ? 0.9 : 0.45); c.lineWidth = 1.5;
      c.beginPath(); c.roundRect(pad + 1.5, pad + 1.5, tw - 3, th - 3, r * 0.9); c.stroke();
      c.strokeStyle = rgba('sepia', 0.18); c.lineWidth = 1;
      c.beginPath(); c.roundRect(pad + 0.5, pad + 0.5, tw - 1, th - 1, r); c.stroke();
    };
    const uniq = [...new Set(rows.flat())];
    const faceIdx = new Map<string, number>();
    for (const ch of uniq) {
      const cv = makeCanvas(tw + pad * 2, th + thick + pad * 2, RES);
      body(cv.c, true);
      if (ch.trim()) {
        const c = cv.c;
        const size = tw * 0.74;
        if (ch === '♥') drawHeart(c, pad + tw / 2, pad + th / 2, size * 0.8, rgba('rose'));
        else {
          c.font = font(FAM_TILE, size);
          c.textAlign = 'center';
          // 刻出來的字：先畫一點點亮邊（凹下去的下緣受光），再畫字
          const col = RED.has(ch) ? sigInk(1, 3.2) : rgba('sepia', 0.95);
          c.fillStyle = rgba('bone', 0.9);
          c.fillText(ch, pad + tw / 2, pad + th / 2 + size * 0.36 + 1.2);
          c.fillStyle = col;
          c.fillText(ch, pad + tw / 2, pad + th / 2 + size * 0.36);
        }
      }
      faceIdx.set(ch, this.faces.length);
      this.faces.push(cv);
    }
    this.back = makeCanvas(tw + pad * 2, th + thick + pad * 2, RES);
    body(this.back.c, false);
    this.shadow = shadowSprite(tw, th + thick, Math.max(6, tw * 0.1), tw * 0.12);

    // ---- 時間：翻牌排在拍子的格子上（閱讀順序）；翻完的下一拍「推倒」＋「胡了」
    this.t1 = beatAfter(au, s + Math.min(0.3, B * 0.6));
    const n = rows.reduce((a, r) => a + r.length, 0);
    const budget = clamp(0.5 * (e - this.t1), 2 * B, 8 * B);
    const grid = onGrid(au, this.t1, n, budget);
    let k = 0;
    rows.forEach((row, j) => {
      const rw = row.length * (tw + gapX) - gapX;
      const x0 = bx + (blockW - rw) / 2;
      row.forEach((ch, i) => { this.tiles.push({ ch, x: x0 + i * (tw + gapX), y: by + j * rowH, tf: grid.times[k++]!, sprite: faceIdx.get(ch)! }); });
    });
    this.tDone = grid.times[n - 1]! + 0.25;
    this.tHu = au.timeOfBeat(Math.ceil(au.beatAt(this.tDone) - 1e-6) + 1);

    // ---- 署名：最後一行右下，手寫
    if (this.sig) {
      const sz = Math.max(40, Math.round(tw * 0.5));
      const cv = (this.sigCv = makeCanvas(900, sz * 1.6, 1.5));
      cv.c.font = font(FAM_SIG, sz);
      cv.c.fillStyle = rgba('sepia', 0.85);
      cv.c.textAlign = 'right';
      cv.c.fillText(this.sig, 890, sz * 1.1);
      this.sigPos = { x: this.blockR.x1 - 900, y: this.blockR.y1 + 8 };
    }
    // ---- 「胡了」的牌子：木頭圓牌、紅字
    const md = Math.round(Math.min(150, tw * 1.35));
    const mk = (this.marker = makeCanvas(md + 20, md + 26, 1.5));
    {
      const c = mk.c, r = md / 2, cx = r + 10, cy = r + 8;
      c.fillStyle = mixRgba('sepia', 'paper', 0.25);
      c.beginPath(); c.arc(cx, cy + 7, r, 0, Math.PI * 2); c.fill();
      const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      g.addColorStop(0, mixRgba('paper', 'bone', 0.6)); g.addColorStop(1, mixRgba('paper', 'sepia', 0.22));
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = sigInk(0.9, 3.2); c.lineWidth = 3;
      c.beginPath(); c.arc(cx, cy, r * 0.82, 0, Math.PI * 2); c.stroke();
      c.fillStyle = sigInk(1, 3.2);
      c.font = font(FAM_TILE, r * 0.62);
      c.textAlign = 'center';
      c.fillText('胡了', cx, cy + r * 0.22);
    }

    // ---- 籌碼：每一行歌詞排好（中文一字一枚、英文一個單字一枚），畫好三種狀態的小圖
    this.chipSize = m ? lyricSizeFor(tw * 0.74) : 72;
    for (const ln of lines.length ? lines : []) this.layoutChips(ln);
  }

  /** 一行歌詞的籌碼：放不下一排就縮小，還放不下折兩排。 */
  private layoutChips(ln: Line) {
    let size = this.chipSize;
    const mc = document.createElement('canvas').getContext('2d')!;
    const words = ln.words.filter((w) => w.w.trim());
    const widthOf = (sz: number) => words.map((w) => { mc.font = font(FAM_CHIP, sz); return Math.max(sz * 1.5, mc.measureText(w.w.trim()).width + sz * 0.9); });
    let ws = widthOf(size);
    const gap = () => size * 0.14;
    const total = () => ws.reduce((a, b) => a + b, 0) + gap() * (ws.length - 1);
    // 先縮到一排放得下（最小 48 px），還是放不下就平均分成兩排（不要第二排只剩一枚）
    while (total() > CHIPS.w && size > 48) { size -= 2; ws = widthOf(size); }
    const nRows = Math.ceil(total() / CHIPS.w);
    const target = total() / nRows;
    const rows: number[][] = [[]];
    let acc = 0;
    ws.forEach((w, i) => {
      if (rows[rows.length - 1]!.length && rows.length < nRows && (acc + w / 2 > target || acc + w > CHIPS.w)) { rows.push([]); acc = 0; }
      rows[rows.length - 1]!.push(i); acc += w + gap();
    });
    const chips: Chip[] = [];
    const ink: ReturnType<typeof makeCanvas>[] = [], hot: ReturnType<typeof makeCanvas>[] = [], faded: ReturnType<typeof makeCanvas>[] = [];
    const rowH = size * 1.62;
    rows.forEach((row, r) => {
      let x = CHIPS.x;
      const y = CHIPS.y - (rows.length - 1 - r) * rowH;
      for (const i of row) {
        const w = ws[i]!;
        chips.push({ word: words[i]!, x, y, w, sprite: chips.length });
        for (const [arr, state] of [[ink, 0], [hot, 1], [faded, 2]] as const) arr.push(this.chipSprite(words[i]!.w.trim(), w, size, state));
        x += w + gap();
      }
    });
    this.chipLines.set(ln, { chips, ink, hot, faded });
  }

  /** 籌碼的圖：圓角（英文單字是長圓形）、外圈一圈點點的邊、中間的字。state 0 = 唱完（墨）、1 = 正在唱（訊號色）、2 = 還沒唱（淡）。 */
  private chipSprite(word: string, w: number, size: number, state: number) {
    const h = size * 1.5;
    const cv = makeCanvas(w + 8, h + 12, 1.5);
    const c = cv.c;
    const r = h / 2;
    c.fillStyle = rgba('sepia', state === 2 ? 0.1 : 0.2);
    c.beginPath(); c.roundRect(4, 8, w, h, r); c.fill();
    c.fillStyle = state === 1 ? mixRgba('paper', 'signal', 0.35) : mixRgba('bone', 'paper', state === 2 ? 0.55 : 0.2);
    c.beginPath(); c.roundRect(4, 4, w, h, r); c.fill();
    c.strokeStyle = state === 1 ? sigInk(0.9, 3) : rgba('sepia', state === 2 ? 0.22 : 0.45);
    c.setLineDash([3, 5]); c.lineWidth = 2.5;
    c.beginPath(); c.roundRect(4 + h * 0.08, 4 + h * 0.08, w - h * 0.16, h * 0.84, r * 0.84); c.stroke();
    c.setLineDash([]);
    c.fillStyle = state === 1 ? rgba('blood') : rgba('sepia', state === 2 ? 0.32 : 0.92);
    c.font = font(FAM_CHIP, size);
    c.textAlign = 'center';
    c.fillText(word, 4 + w / 2, 4 + h / 2 + size * 0.36);
    return cv;
  }

  override dispose() {
    for (const f of this.faces) freeCanvas(f);
    for (const x of [this.back, this.shadow, this.marker, this.sigCv]) freeCanvas(x);
    for (const v of this.chipLines.values()) for (const a of [v.ink, v.hot, v.faded]) a.forEach(freeCanvas);
    super.dispose();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const B = this.B;
    // ---- 鏡頭：切進來時轉一點、拉遠一點 → 第一拍落定 → 轉盤似地很慢轉、推近
    const land = ease.outExpo(prog(t, s, this.t1 + B * 0.5));
    const drift = ease.inOutQuad(prog(t, this.t1, e));
    const rot = (1 - land) * -0.09 + 0.035 * (drift - 0.5);
    const sc = (0.9 + 0.1 * land) * (1 + 0.02 * drift) * (1 - 0.006 * pulse(t, this.tHu, 0.12));
    const cx = (this.blockR.x0 + this.blockR.x1) / 2, cy = (this.blockR.y0 + CHIPS.y) / 2;
    const cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
    // 畫布：p' = c + R(rot)·sc·(p − c)；shader 要反過來（螢幕 → 桌面）
    const ics = Math.cos(-rot) / sc, isn = Math.sin(-rot) / sc;
    (this.felt.u.camInv!.value as THREE.Matrix3).set(ics, -isn, cx - ics * cx + isn * cy, isn, ics, cy - isn * cx - ics * cy, 0, 0, 1);
    this.felt.render(renderer, out);

    const L = this.L;
    L.clear();
    const c = L.ctx;
    c.setTransform(cs, sn, -sn, cs, cx - cs * cx + sn * cy, cy - sn * cx - cs * cy);

    // ---- 牌
    const tw = this.tw, th = this.th, thick = this.thick;
    const huK = pulse(t, this.tHu, 0.07);
    for (const tl of this.tiles) {
      const u = clamp((t - tl.tf) / 0.26);
      const ang = Math.PI * ease.inOutCubic(u);
      const cosA = -Math.cos(ang); // −1 = 牌背朝上、1 = 牌面朝上
      const lift = Math.sin(ang) * 0.12 + 0.02 * pulse(t, tl.tf + 0.26, 0.06) - 0.015 * huK;
      const sx = 1 + lift, sy = Math.max(0.02, Math.abs(cosA)) * (1 + lift);
      const x = tl.x + tw / 2, y = tl.y + (th + thick) / 2;
      // 影子：浮起來時往右下拉開、變淡
      const sh = this.shadow!;
      c.save();
      c.globalAlpha = 0.22 - lift * 0.5;
      c.drawImage(sh.cv, x - tw / 2 - sh.pad + 4 + lift * 60, y - (th + thick) / 2 - sh.pad + 6 + lift * 80, sh.w, sh.h);
      c.restore();
      const img = cosA >= 0 ? this.faces[tl.sprite]! : this.back!;
      c.save();
      c.translate(x, y - lift * 40);
      c.scale(sx, sy);
      c.drawImage(img.cv, -img.w / 2, -img.h / 2, img.w, img.h);
      // 翻到側面時比較暗
      if (Math.abs(cosA) < 0.999) { c.globalAlpha = 0.3 * (1 - Math.abs(cosA)); c.fillStyle = rgba('sepia'); c.fillRect(-tw / 2, -img.h / 2, tw, img.h - 6); }
      c.restore();
    }
    // 署名
    if (this.sigCv) {
      const a = ease.outCubic(prog(t, this.tDone, this.tDone + 0.3));
      if (a > 0) { c.globalAlpha = a; c.drawImage(this.sigCv.cv, this.sigPos.x, this.sigPos.y, this.sigCv.w, this.sigCv.h); c.globalAlpha = 1; }
    }
    // 「胡了」牌子：從上面掉下來、彈一下
    if (t >= this.tHu - 0.18 && this.marker) {
      const u = clamp((t - (this.tHu - 0.18)) / 0.18);
      const k = u < 1 ? u * u : 1;
      const bounce = t > this.tHu ? Math.abs(Math.sin((t - this.tHu) * 16)) * Math.exp(-(t - this.tHu) * 7) * 0.08 : 0;
      const s2 = 1 + (1 - k) * 0.7 + bounce;
      const mk = this.marker;
      // 放在第一副牌的右邊（桌上），不要蓋到字
      const mx = this.blockR.x1 + mk.w * 0.62, my = this.blockR.y0 + this.th * 0.55;
      c.save();
      c.translate(mx, my); c.rotate(-0.12); c.scale(s2, s2);
      c.globalAlpha = Math.min(1, u * 3);
      c.drawImage(mk.cv, -mk.w / 2, -mk.h / 2, mk.w, mk.h);
      c.restore();
    }
    // ---- 籌碼（歌詞）
    this.drawChips(c, t);
    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, L.upload(), out);

    let amp = 0;
    for (const tl of this.tiles) amp += 0.6 * pulse(t, tl.tf + 0.26, 0.04);
    amp = Math.min(amp, 2.5) + 6 * huK;
    const ph = frameIdx(t);
    return { paper: 1, bloom: 0.2, bloomThreshold: 1.6, halation: 0.04, vignette: 0.3, grain: 0.05, shake: [amp * (hash(ph, 1) - 0.5) * 2, amp * (hash(ph, 2) - 0.5) * 2] };
  }

  /** 籌碼：這一格要顯示的歌詞行（提早 0.35 秒出現、唱完停 1.2 秒），唱到的那枚跳起來。 */
  private drawChips(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    if (!this.msg) {
      c.fillStyle = rgba('sepia', 0.55);
      c.font = font(F.hei(500), 20);
      c.letterSpacing = '3px';
      c.fillText(T17_INVITE, CHIPS.x, CHIPS.y + this.chipSize * 1.5 + 44);
      c.letterSpacing = '0px';
    }
    if (!lyrics.has) {
      c.fillStyle = rgba('sepia', 0.7);
      c.font = font(F.mono(500), 22);
      c.letterSpacing = '5px';
      c.fillText(`♪ ${song.title}`, CHIPS.x, CHIPS.y + 40);
      c.letterSpacing = '0px';
      return;
    }
    const ln = lyrics.shownLine(t, 1.2, 0.35);
    if (!ln) return;
    const set = this.chipLines.get(ln);
    if (!set) return;
    const kin = clamp((t - (ln.start - 0.35)) / 0.35), kout = 1 - clamp((t - ln.end - 0.6) / 0.6);
    const k = Math.min(kin, kout);
    set.chips.forEach((ch, i) => {
      const p = Lyrics.wordProgress(ch.word, t);
      const img = p <= 0 ? set.faded[i]! : p < 1 ? set.hot[i]! : set.ink[i]!;
      // 一枚一枚放上桌（進場時從上面落下來一點點）、唱到的那一下跳起來
      const drop = (1 - ease.outCubic(clamp((t - (ln.start - 0.35) - i * 0.02) / 0.25))) * 18;
      const hop = p > 0 && p < 1 ? 7 * Math.sin(Math.PI * clamp((t - ch.word.start) / 0.22)) : 0;
      c.globalAlpha = k;
      c.drawImage(img.cv, ch.x - 4, ch.y - img.h / 2 - drop - hop, img.w, img.h);
    });
    c.globalAlpha = 1;
  }
}
