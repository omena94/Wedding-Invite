// 程式碼（批次 T6・螢幕 B，暗）：一扇浮在暗處、微微斜放的程式編輯器（three.js 的透視鏡頭，不是平面貼圖）。
//  - 程式是真的能跑的 JavaScript（中文函式名稱也合法）：
//      while (true) {
//        // ♪ 正在唱的歌詞          ← 歌詞是註解：像編輯器的自動完成，先淡淡地排好，唱到哪個字就「打」到哪個字
//        love(祝福(), 署名());
//      }
//      function 祝福() { return `主打留言`; }   ← 留言是字串，第一拍開始一個字一個字打進去（function 會提升，所以寫在迴圈後面也能跑）
//  - 留言打完的下一個小節線按下「▶ 執行」：下面的終端機往上展開，把留言印出來（手寫字，大大的），
//    除錯箭頭在 while 與 love() 之間一拍跳一行，每跑一次 love() 計數器加一。
//  - 鏡頭：窗格一開始視窗從側面轉進來（outExpo）；執行時再轉正一點、推近；大鼓讓鏡頭輕輕往前一頂。
// 手法：整個視窗畫在一張 Canvas 層上，當成 three.js 平面的貼圖，用透視相機拍；火花的位置用同一台相機投影回螢幕。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, prog } from '../engine/util';
import type { FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { lyricAt, sparkHead, sparkParticles, beatAfter, barAfter, signature, drawMessage, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { typedLayout, drawTyped, fitMessage, inOut, type Rect } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0.3, 0.95], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 視窗（貼圖座標，像素，y 向下）
const TW = 1440; // 視窗寬
const TITLE_H = 60; // 標題列
const FS = 54; // 程式字級（等寬字，拉丁字寬 0.6 em）
const CH = FS * 0.6;
const LH = 72; // 行距
const GUT = 112; // 程式從這裡開始（左邊是行號）
const TOP = TITLE_H + 26; // 第一行的上緣
const PAD_R = 50;
const TERM_HDR = 50; // 終端機標題列高
const MSG_W = TW - 2 * 56 - 180; // 終端機裡留言的寬（右邊留空：視窗右下角在畫面上靠近 QR 區）
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
const TEXT = `婚禮誓詞執行終端機祝福署名一位賓客還沒有人寫掃描右下角寫下你的間奏${GROOM}${BRIDE}`;

// 背景：暗色的桌面，視窗後面一團很淡的暖光
const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform vec2 c; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float r = length((p - c) / vec2(1100.0, 700.0));
    vec3 col = C_INK + (C_INK2 - C_INK) * (1.2 * exp(-r * r * 1.4) + 0.25 * fbm(p / 500.0 + t * 0.01, 3));
    col += C_BLOOD * 0.05 * exp(-r * r * 3.0) * k;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, c: { value: new THREE.Vector2(800, 540) }, k: { value: 1 } });

// 視窗平面的 shader：解 fast 圖層（預乘、sRGB）→ 線性；視窗外面一圈柔和的影子，上緣一道很淡的反光
const WIN_VERT = /* glsl */ `precision highp float;
in vec3 position; in vec2 uv; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; out vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WIN_FRAG = /* glsl */ `precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D tex; uniform vec2 size; uniform float margin; uniform float opacity; uniform float glare;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() {
  vec2 p = vUv * (size + 2.0 * margin) - margin; // 視窗像素（y 向上）
  vec4 col = vec4(0.0);
  if (p.x >= 0.0 && p.y >= 0.0 && p.x <= size.x && p.y <= size.y) {
    vec4 c = texture(tex, p / size);
    c.rgb = c.a > 0.0 ? toLin(c.rgb / c.a) * c.a : vec3(0.0);
    // 斜斜的一道反光（玻璃的感覺），跟鏡頭角度一起動
    float g = smoothstep(0.0, 1.0, 1.0 - abs(p.x / size.x - (1.0 - p.y / size.y) * 0.6 - glare) * 3.0);
    c.rgb += vec3(0.012, 0.011, 0.01) * g * c.a;
    col = c;
  }
  // 影子：往下偏 18 px 的圓角矩形距離場
  vec2 q = p - vec2(0.0, -18.0);
  vec2 d2 = max(max(-q, q - size), 0.0);
  float d = length(d2);
  float sh = 0.6 * exp(-d / 34.0) * step(0.001, d + (1.0 - col.a));
  col += vec4(0.0, 0.0, 0.0, sh) * (1.0 - col.a);
  fragColor = col * opacity;
}`;

type Col = 'kw' | 'fn' | 'str' | 'p' | 'cm';
type Tok = [string, Col];
interface Row { y: number; num: number | null; toks: Tok[]; kind: 'code' | 'lyric' | 'msg'; i?: number }

export default class Code extends Scene {
  bg = shared('code.bg', BG);
  win!: Layer2D;
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  TH = 900;
  rows: Row[] = [];
  lyricRows = 1;
  msgLines: string[] = [];
  msgPrefixW = 0;
  termY = 0; // 展開後終端機的上緣
  termFit: FitResult | null = null;
  tType0 = 0; tType1 = 0; tRun = 0;
  rowWhile = 0; rowLove = 0;
  // three.js：視窗平面與透視相機
  private scene3 = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(26, W / H, 10, 40000);
  private mesh!: THREE.Mesh;
  private mat!: THREE.RawShaderMaterial;
  private readonly MARGIN = 120;
  private avoid: Rect[] = [];

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText(TEXT + song.title + song.artist);
    // 留言在字串裡怎麼斷行：第一行接在「  return `」後面，之後的行縮排四格（編輯器的自動換行）
    const mc = document.createElement('canvas').getContext('2d')!;
    mc.font = font(F.mono(400), FS);
    this.msgPrefixW = mc.measureText('  return `').width;
    const text = this.msg ? this.msg.text : '';
    this.msgLines = this.msg ? this.wrapString(mc, text) : [];
    // 這個窗格會唱到的歌詞，最長的一句要幾行（固定下來，換句時下面的程式才不會跳）
    const lyricW = TW - GUT - PAD_R - mc.measureText('  // ♪ ').width;
    for (const ln of this.ctx.lyrics.linesIn(s - 1, e + 1)) this.lyricRows = Math.max(this.lyricRows, typedLayout(mc, ln, F.mono(400), FS, lyricW, { minSize: 50, maxRows: 2 }).rows);
    this.buildRows();
    // 時間：第一拍開始打留言；打完之後的第一個小節線執行（最晚第一拍後一小節半，太短的窗格就早一點）
    const b0 = beatAfter(au, s + 0.05), beat = au.beatPeriod(b0);
    const n = Array.from(text || 'x').length;
    this.tType0 = b0;
    this.tType1 = b0 + (this.msg ? clamp(0.04 * n + 0.25, 0.5, 1.9) : 0.9);
    const bar = barAfter(au, this.tType1 + 0.05);
    this.tRun = Math.min(bar, this.tType1 + 1.5 * 4 * beat, Math.max(this.tType1 + 0.1, e - 2 * beat));
    // 終端機：展開後蓋住 while 區塊下面的部分（函式已經打完、看過了）
    this.termY = this.rows[this.rowLove + 1]!.y + LH + 18;
    const term = document.createElement('canvas').getContext('2d')!;
    // 視窗高度先照程式算（收起來的終端機不能蓋到最後一行），終端機的留言用剩下的高度排，不夠才把視窗拉高
    const lastRow = this.rows[this.rows.length - 1]!;
    const TH0 = lastRow.y + LH + TERM_HDR + 30;
    const fixed = TERM_HDR + 70 + 30 + 140; // 指令列、署名、計數
    const avail = Math.max(180, TH0 - this.termY - fixed);
    this.termFit = this.msg ? fitMessage(term, text, F.hand(400), MSG_W, avail, { min: 44, max: 84, lineHeight: 1.28 }) : null;
    this.TH = Math.ceil(Math.max(TH0, this.termY + fixed + (this.termFit ? this.termFit.height : 120)));
    this.win = this.track(new Layer2D(TW, this.TH, undefined, { fast: true }));
    // 平面：比視窗大一圈（影子畫在外圈）
    const M = this.MARGIN;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: WIN_VERT, fragmentShader: WIN_FRAG,
      uniforms: { tex: { value: this.win.texture }, size: { value: new THREE.Vector2(TW, this.TH) }, margin: { value: M }, opacity: { value: 1 }, glare: { value: 0.3 } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(TW + 2 * M, this.TH + 2 * M), this.mat);
    this.scene3.add(this.mesh);
    // 即時小卡避開：整個窗格裡視窗大概的位置（用執行後的鏡頭算）
    // 歌詞那幾行、編輯器裡的留言字串、終端機印出來的留言（用執行後的鏡頭投影；視窗其他地方被蓋到沒關係）
    this.pose(this.tRun + 2, 0);
    const box = (x0: number, y0: number, x1: number, y1: number): Rect => {
      const a = this.toScreen(x0, y0), b = this.toScreen(x1, y1);
      return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)];
    };
    const r0 = this.rows[this.rowWhile]!, rL = this.rows[this.rowLove]!;
    this.avoid = [box(GUT - 40, r0.y, TW - 60, rL.y + LH)];
    const mr = this.rows.filter((r) => r.kind === 'msg');
    if (mr.length) this.avoid.push(box(GUT, mr[0]!.y, TW - 60, mr[mr.length - 1]!.y + LH));
    this.avoid.push(box(40, this.termY + TERM_HDR, 56 + MSG_W, this.termY + TERM_HDR + 100 + (this.termFit ? this.termFit.height + 80 : 120)));
  }

  override dispose() {
    this.mesh?.geometry.dispose();
    this.mat?.dispose();
    super.dispose();
  }

  /** 把留言在字串裡斷行（中文一字一格、英文不拆字）：第一行比較短（前面有 return `）。 */
  private wrapString(c: CanvasRenderingContext2D, text: string): string[] {
    const first = TW - GUT - PAD_R - this.msgPrefixW - CH * 2, rest = TW - GUT - PAD_R - CH * 6;
    const out: string[] = [];
    let cur = '', lim = first;
    const toks = text.match(/[A-Za-z0-9'’&@#+\-.,!?]+\s*|\s+|./gsu) ?? [];
    for (const tk of toks) {
      if (cur && c.measureText(cur + tk).width > lim) { out.push(cur); cur = tk.trimStart(); lim = rest; }
      else cur += tk;
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }

  private buildRows() {
    const rows: Row[] = [];
    let y = TOP, num = 1;
    const add = (toks: Tok[], kind: Row['kind'] = 'code', numbered = true, i?: number) => { rows.push({ y, num: numbered ? num++ : null, toks, kind, i }); y += LH; };
    add([['while', 'kw'], [' (', 'p'], ['true', 'kw'], [') {', 'p']]);
    this.rowWhile = 0;
    for (let i = 0; i < this.lyricRows; i++) add([], 'lyric', i === 0, i);
    this.rowLove = rows.length;
    add([['  love', 'fn'], ['(', 'p'], ['祝福', 'fn'], ['(), ', 'p'], ['署名', 'fn'], ['());', 'p']]);
    add([['}', 'p']]);
    add([]);
    add([['function', 'kw'], [' 祝福', 'fn'], ['() {', 'p']]);
    if (this.msg) this.msgLines.forEach((_, i) => add([], 'msg', i === 0, i));
    else add([['  return ', 'kw'], ['你的祝福', 'fn'], [';', 'p']]);
    add([['}', 'p']]);
    const name = this.msg ? (this.msg.name || '一位賓客') : '';
    add([['function', 'kw'], [' 署名', 'fn'], ['() { ', 'p'], ['return', 'kw'], [this.msg ? ` "${name}"` : ' ???', this.msg ? 'str' : 'p'], ['; }', 'p']]);
    this.rows = rows;
  }

  // ------------------------------------------------------------ 鏡頭
  /** 這一格的鏡頭（視窗的轉角、位置、大小）。 */
  private pose(t: number, kick: number) {
    const s = this.ctx.start;
    const beat = this.ctx.audio.beatPeriod(t);
    const inK = prog(t, s, s + Math.max(0.5, beat * 1.2), ease.outExpo);
    const runK = prog(t, this.tRun, this.tRun + 0.7, ease.outExpo);
    // 畫面上的大小：視窗高度塞進 1080 - 2×80，最多 0.95 倍
    const sc0 = Math.min(0.95, (H - 160) / this.TH);
    const sc = sc0 * lerp(0.86, 1, inK) * (1 + 0.018 * runK) * (1 + 0.008 * kick);
    const rotY = lerp(0.42, 0.13, inK) - 0.07 * runK;
    const rotX = -0.035 + 0.02 * runK;
    const cx = lerp(900, 820, inK) + 12 * runK, cy = 540 - 6 * runK;
    const fov = this.cam.fov * Math.PI / 180;
    const D = (H / 2) / (sc * Math.tan(fov / 2));
    this.cam.position.set(0, 0, D);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld();
    this.cam.updateProjectionMatrix();
    this.mesh.position.set((cx - W / 2) / sc, -(cy - H / 2) / sc, 0);
    this.mesh.rotation.set(rotX, rotY, 0);
    this.mesh.updateMatrixWorld();
    this.mat.uniforms.glare!.value = 0.25 + rotY * 1.5;
    return inK;
  }

  /** 視窗貼圖上的一點（像素，y 向下）→ 螢幕像素。 */
  private toScreen(px: number, py: number) {
    const v = new THREE.Vector3(px - TW / 2, this.TH / 2 - py, 0).applyMatrix4(this.mesh.matrixWorld).project(this.cam);
    return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
  }

  // ------------------------------------------------------------ 每一格
  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.2, 0.3);
    this.pose(t, f.a.kick);
    this.bg.u.t!.value = t;
    this.bg.u.k!.value = 0.6 + 0.4 * f.a.kick;
    this.bg.render(renderer, out);
    const head = this.drawWindow(t);
    this.mat.uniforms.opacity!.value = k;
    renderer.setRenderTarget(out);
    renderer.render(this.scene3, this.cam);
    this.glow.clear();
    if (head && k > 0.6) {
      const p = this.toScreen(head.x, head.y);
      sparkParticles(this.glow, t, () => p, { rate: 70, life: 0.3, speed: 190, seed: 5 });
      sparkHead(this.glow, p.x, p.y, t, 0.85);
    }
    if (this.glow.count) this.glow.render(renderer, out);
    return { bloom: 0.55, vignette: 0.45, popupAvoid: this.avoid };
  }

  /** 畫整扇視窗；回傳正在打字的位置（貼圖座標）給火花。 */
  private drawWindow(t: number): { x: number; y: number } | null {
    const L = this.win; L.clear();
    const c = L.ctx;
    const au = this.ctx.audio;
    const TH = this.TH;
    // 視窗底、邊框、標題列
    c.fillStyle = rgba('ink2'); roundRect(c, 0, 0, TW, TH, 18); c.fill();
    c.strokeStyle = rgba('graphite', 0.7); c.lineWidth = 1.5; roundRect(c, 0.75, 0.75, TW - 1.5, TH - 1.5, 18); c.stroke();
    c.fillStyle = rgba('ink', 0.55); c.fillRect(1, 1, TW - 2, TITLE_H - 1);
    c.fillStyle = rgba('graphite', 0.6); c.fillRect(0, TITLE_H, TW, 1);
    c.textBaseline = 'alphabetic';
    // 分頁：婚禮.js（目前）、誓詞.txt
    c.font = font(F.hei(500), 24);
    c.fillStyle = rgba('ink2'); c.fillRect(24, 10, 176, TITLE_H - 10);
    c.fillStyle = rgba('signal', 0.9); c.fillRect(24, 10, 176, 3);
    c.fillStyle = rgba('bone', 0.92); c.fillText('婚禮.js', 52, 46);
    c.fillStyle = rgba('ash', 0.55); c.fillText('誓詞.txt', 236, 46);
    // 執行鍵：執行的那一刻亮起來
    const run = prog(t, this.tRun, this.tRun + 0.08) * (1 - 0.6 * prog(t, this.tRun + 0.25, this.tRun + 0.9));
    const bx = TW - 190, by = 12, bw = 160, bh = TITLE_H - 22;
    c.fillStyle = run > 0 ? rgba('signal', 0.2 + 0.75 * run) : rgba('graphite', 0.35);
    roundRect(c, bx, by, bw, bh, 8); c.fill();
    c.font = font(F.hei(700), 22); c.fillStyle = run > 0.5 ? rgba('ink') : rgba('bone', 0.85);
    c.fillText('▶  執行', bx + 34, by + 27);
    c.font = font(F.mono(400), 18); c.fillStyle = rgba('ash', 0.6); c.letterSpacing = '2px';
    c.fillText(`${DATE_DOTS}`, TW - 480, 42);
    c.letterSpacing = '0px';

    // 除錯箭頭：執行之後一拍一行，在 while 與 love() 之間來回
    const ran = t >= this.tRun;
    const stepIdx = ran ? Math.floor(au.beatAt(t) - au.beatAt(this.tRun) + 1e-4) : -1;
    const execRow = stepIdx < 0 ? -1 : stepIdx % 2 === 0 ? this.rowWhile : this.rowLove;
    let head: { x: number; y: number } | null = null;
    for (const [ri, r] of this.rows.entries()) {
      if (ri === execRow) {
        const since = (au.beatAt(t) - au.beatAt(this.tRun)) % 1;
        c.fillStyle = rgba('signal', 0.07 + 0.08 * (1 - clamp(since * 3)));
        c.fillRect(1, r.y, TW - 2, LH);
        c.fillStyle = rgba('signal', 0.95);
        c.beginPath(); c.moveTo(20, r.y + 20); c.lineTo(40, r.y + LH / 2); c.lineTo(20, r.y + LH - 20); c.closePath(); c.fill();
      }
      const base = r.y + LH / 2 + FS * 0.36;
      if (r.num !== null) {
        c.font = font(F.mono(400), 28); c.textAlign = 'right';
        c.fillStyle = ri === execRow ? rgba('bone', 0.8) : rgba('graphite', 0.9);
        c.fillText(String(r.num), GUT - 26, base - 4);
        c.textAlign = 'left';
      }
      if (r.kind === 'code') this.drawToks(c, r.toks, GUT, base);
      else if (r.kind === 'lyric' && r.i === 0) head = this.drawLyricRow(c, t, base) ?? head;
      else if (r.kind === 'msg' && r.i === 0) head = this.drawMsgRows(c, t, base) ?? head;
    }
    this.drawTerminal(c, t, stepIdx);
    L.upload();
    return head;
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

  /** 歌詞註解：「// ♪ 」後面是這一句，先淡淡地排好（自動完成的建議），唱到的字打上去。 */
  private drawLyricRow(c: CanvasRenderingContext2D, t: number, base: number): { x: number; y: number } | null {
    const { lyrics, song } = this.ctx;
    const x0 = this.drawToks(c, [['  // ♪ ', 'cm']], GUT, base);
    // 下一句提早兩秒淡淡排好（自動完成的建議），唱完的留 2.5 秒
    const ly = lyricAt(lyrics, t, 2.5, 2);
    if (!ly) {
      // 間奏或純音樂：註解寫歌名
      c.font = font(F.mono(400), FS); c.fillStyle = COLORS.cm();
      c.fillText(lyrics.has ? '（間奏）' : `${song.title || '今晚的歌'}`, x0, base);
      return null;
    }
    const lay = typedLayout(c, ly.line as Line, F.mono(400), FS, TW - x0 - PAD_R, { minSize: 50, maxRows: 2 });
    const cur = drawTyped(c, lay, F.mono(400), x0, base, LH, t, { active: rgba('signal'), sung: rgba('bone', 0.96), ghost: rgba('bone', 0.26) }, ly.k);
    // 第二行前面也補上註解符號
    for (let r = 1; r < lay.rows; r++) this.drawToks(c, [['  //   ', 'cm']], GUT, base + r * LH);
    return cur.typing ? { x: cur.x, y: cur.y - FS * 0.35 } : null;
  }

  /** 留言字串：第一拍開始一個字一個字打進去。 */
  private drawMsgRows(c: CanvasRenderingContext2D, t: number, base: number): { x: number; y: number } | null {
    const all = this.msgLines.map((l) => Array.from(l));
    const total = all.reduce((a, l) => a + l.length, 0);
    const shown = Math.floor(total * prog(t, this.tType0, this.tType1));
    let left = shown, head: { x: number; y: number } | null = null;
    c.font = font(F.mono(400), FS);
    all.forEach((chars, i) => {
      const y = base + i * LH;
      let x = i === 0 ? this.drawToks(c, [['  return ', 'kw'], ['`', 'str']], GUT, y) : GUT + CH * 6;
      const n = clamp(left, 0, chars.length);
      left -= chars.length;
      const part = chars.slice(0, n).join('');
      c.fillStyle = COLORS.str();
      fillHeartsMono(c, part, x, y);
      x += c.measureText(part).width;
      if (n > 0 && n < chars.length) head = { x, y: y - FS * 0.35 };
      if (i === all.length - 1 && shown >= total) this.drawToks(c, [['`', 'str'], [';', 'p']], x, y);
      // 游標：打字中在字後面，打完停在結尾（一拍閃一下）
      const typingHere = shown < total && n < chars.length && (i === 0 || shown > all.slice(0, i).reduce((a, l) => a + l.length, 0));
      if (typingHere && t >= this.tType0) { c.fillStyle = rgba('signal'); c.fillRect(x + 2, y - FS * 0.8, 4, FS); }
    });
    return head;
  }

  /** 終端機：執行前是收起來的一條，執行時往上展開，印出留言、署名，while 每跑一圈 love() 計數加一。 */
  private drawTerminal(c: CanvasRenderingContext2D, t: number, stepIdx: number) {
    const TH = this.TH, au = this.ctx.audio;
    const open = prog(t, this.tRun, this.tRun + 0.45, ease.outExpo);
    const y0 = lerp(TH - TERM_HDR - 8, this.termY, open);
    c.save();
    c.beginPath(); c.rect(1, y0, TW - 2, TH - y0 - 1); c.clip();
    c.fillStyle = rgba('ink'); c.fillRect(0, y0, TW, TH - y0);
    c.fillStyle = rgba('graphite', 0.8); c.fillRect(0, y0, TW, 1.5);
    c.font = font(F.hei(500), 22); c.fillStyle = rgba('bone', 0.8);
    c.fillText('終端機', 40, y0 + 34);
    c.fillStyle = rgba('signal', 0.9); c.fillRect(40, y0 + TERM_HDR - 4, 66, 3);
    c.font = font(F.mono(400), 18); c.fillStyle = rgba('ash', 0.6); c.letterSpacing = '2px';
    c.fillText(t < this.tRun ? '待命' : '執行中 · while (true)', 140, y0 + 33);
    c.letterSpacing = '0px';
    const x = 56;
    let y = y0 + TERM_HDR + 56;
    // 指令列：執行前游標在閃；執行時指令一下子打出來
    c.font = font(F.mono(500), 36);
    c.fillStyle = rgba('signal'); c.fillText('$', x, y);
    const cmd = 'node 婚禮.js';
    const nc = Math.floor(cmd.length * prog(t, this.tRun - 0.12, this.tRun + 0.05));
    c.fillStyle = rgba('bone', 0.9); c.fillText(cmd.slice(0, nc), x + 44, y);
    if (t < this.tRun + 0.1 && Math.floor(au.beatAt(t) * 2) % 2 === 0) { c.fillStyle = rgba('bone', 0.8); c.fillRect(x + 48 + c.measureText(cmd.slice(0, nc)).width, y - 30, 18, 36); }
    if (open > 0.02) {
      y += 30;
      if (this.msg && this.termFit) {
        // 留言一行一行印出來（印表機的速度：一行 70 毫秒）
        const fit = this.termFit;
        const lines = fit.lines.length;
        const k = clamp((t - this.tRun - 0.12) / 0.07);
        const shownLines = Math.min(lines, Math.floor((t - this.tRun - 0.12) / 0.07) + 1);
        if (k > 0) {
          const chars = fit.lines.slice(0, shownLines).reduce((a, l) => a + Array.from(l).length, 0);
          drawMessage(c, fit, F.hand(400), x, y + fit.size * 0.95, { chars, color: rgba('bone', 0.97) });
        }
        y += fit.height + 22;
        const ka = prog(t, this.tRun + 0.12 + lines * 0.07, this.tRun + 0.4 + lines * 0.07);
        c.save(); c.globalAlpha *= ka;
        c.font = font(F.hand(400), 44); c.fillStyle = rgba('ash');
        c.fillText(signature(this.msg.name) + (this.msg.couple ? '（新人）' : ''), x + 24, y + 44);
        c.restore();
        y += 70;
      } else {
        // 沒有留言：冷面的錯誤訊息，下面一句邀請
        const ka = prog(t, this.tRun + 0.1, this.tRun + 0.3);
        c.save(); c.globalAlpha *= ka;
        c.font = font(F.mono(500), 34); c.fillStyle = rgba('blood');
        c.fillText('ReferenceError: 你的祝福 is not defined', x, y + 40);
        c.font = font(F.hand(400), 54); c.fillStyle = rgba('bone', 0.95);
        c.fillText('掃描右下角 QR code，寫下你的祝福', x, y + 120);
        c.restore();
        y += 160;
      }
      // 計數：love() 每跑一次加一
      const calls = stepIdx >= 0 ? Math.floor((stepIdx + 1) / 2) : 0;
      if (calls > 0) {
        const bump = 1 - clamp((au.beatAt(t) - au.beatAt(this.tRun) - (calls * 2 - 1)) * 3);
        c.font = font(F.mono(500), 32);
        c.fillStyle = rgba('ash', 0.85);
        c.fillText('love() ×', x, y + 36);
        const w = c.measureText('love() × ').width;
        c.fillStyle = rgba(bump > 0 ? 'signal' : 'bone', 0.95);
        c.fillText(String(calls), x + w, y + 36 - bump * 6);
        c.fillStyle = rgba('rose', 0.5 + 0.5 * bump);
        c.font = font(F.mono(500), 32);
        c.fillText('♥', x + w + c.measureText(String(calls)).width + 20, y + 36);
      }
    }
    c.restore();
  }
}

const COLORS: Record<Col, () => string> = {
  kw: () => rgba('signal', 0.88),
  fn: () => rgba('bone', 0.94),
  str: () => rgba('ember', 0.9),
  p: () => rgba('ash', 0.8),
  cm: () => rgba('ash', 0.62),
};

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** 字串裡的 ♥ 用點綴色。 */
function fillHeartsMono(c: CanvasRenderingContext2D, s: string, x: number, y: number) {
  if (!s.includes('♥')) { c.fillText(s, x, y); return; }
  const base = c.fillStyle;
  let px = x;
  for (const part of s.split(/(♥)/)) {
    if (!part) continue;
    c.fillStyle = part === '♥' ? rgba('rose') : base;
    c.fillText(part, px, y);
    px += c.measureText(part).width;
  }
  c.fillStyle = base;
}
