// 帆船（亮）：航海插畫的鋼筆線稿。一艘斜桁帆（gaff）的小帆船往右開，海面是一排排鋼筆畫的小浪，每一拍往左捲一段。
//  - 主帆是一塊 three.js 的網格（布）：第一個拍點「升帆」（從帆桁底下拉上去），之後每個小節線一陣風把帆吹鼓
//    （彈簧緩動、後緣往外弓、帆腹有陰影），整艘船同時往前一衝、微微傾一下；風過了帆慢慢鬆回去，布面有細小的皺紋在抖。
//  - 主打留言寫在帆面上（手寫字，跟著帆一起鼓起來、一起傾，讀得到）；署名在右下角。
//  - 歌詞寫在桅頂的長三角旗上：旗子往船尾飄，字沿著旗子的中線排，每一拍旗子甩出一道波紋；
//    跟唱規則照舊（還沒唱三成、正在唱是偏深的訊號色、唱完是墨色）。
//  - 船身寫船名「幸福號」與留言編號；左下角冷面註記「航向：永遠　途中不停靠」。
//  - 沒有主打留言：帆上寫「本船開往永遠，途中不停靠。」＋邀請；純音樂：旗子上寫歌名。
// 畫法：紙與海的底色一個 shader；浪與海鷗是 LineBatch 細線（船後面一批、船前面一批）；帆是網格＋自己的 shader（布、縫線、陰影、字）；
// 船身、桅杆、索具、三角旗與歌詞每格畫在一張 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba, LIN } from '../engine/palette';
import { clamp, ease, prog, lerp, hash, springStep, TAU } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, beatAfter, signature, drawMessage, COUPLE_ZH } from './_motifs';
import { paperSignal, singColor, glyphProgress, fitLine, fitMsg, lyricSize, slowPush, no3, INVITE_SMALL, type Rect } from './_t20';

export const spec: PlateSpecDecl = { group: 'type', family: 'water', paper: true, energy: [0.3, 0.9], bars: [4, 8] };

/** 船的原點：桅杆腳（甲板上）。船身、帆、桅杆都在這個座標系裡，整艘船一起晃。 */
const BOAT = { x: 1110, y: 738 };
const HORIZON = 612;
/** 水線（船身在這條線以下看不到；這條線以下的浪畫在船前面）。 */
const WATER = 832;
/** 主帆四個角（船的座標）：前下（帆腳前端）、後下（帆桁尾）、後上（斜桁尾）、前上（斜桁頭）。 */
const SAIL = { tack: [-8, -26], clew: [-704, -36], peak: [-666, -500], head: [-8, -470] } as const;
/** 帆面貼圖的大小（邏輯像素，大約等於帆在螢幕上的大小：字才不會被壓扁）。 */
const SW = 692, SH = 458;
const MAST_TOP = -642;
/** 三角旗：從桅頂往左飄，最長到 x = 150。 */
const FLAG = { x0: 4, y0: MAST_TOP + 8, maxLen: BOAT.x - 150 };
const LYR_FAM = F.archivo(100, 700);
const MSG_FAM = F.hand(700);
const NO_MSG = '本船開往永遠，途中不停靠。';
const NO_MSG_LINES = ['本船開往永遠，', '途中不停靠。'];
/** 航海日誌式的冷面註記（左邊天空，一行一項）。 */
const NOTE = ['航向：永遠', '風力：每小節一陣', '途中不停靠'];

const SKY = () => new FSPass(/* glsl */ `
  uniform float uIn;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float fib = fbm(p / 240.0, 3);
    vec3 paper = C_PAPER * (0.975 + 0.025 * fib);
    // 天空靠海平線亮一點；海面帶一點點訊號色的暗部（主題換色跟著變）
    vec3 sky = paper * (1.0 + 0.025 * smoothstep(200.0, ${HORIZON}.0, p.y));
    vec3 sea = mix(paper, mix(C_PAPER, C_BLOOD, 0.5), 0.12 + 0.08 * smoothstep(${HORIZON}.0, ${H}.0, p.y));
    vec3 col = p.y < ${HORIZON}.0 ? sky : sea;
    col = mix(col, C_SEPIA, pxLine(abs(p.y - ${HORIZON}.0), 0.6, 1.4) * 0.8 * uIn);
    fragColor = vec4(col, 1.0);
  }`, { uIn: { value: 1 } });

// ---------------------------------------------------------------- 帆（網格＋shader）
const SAIL_VERT = /* glsl */ `precision highp float;
#define PI 3.14159265359
in vec3 position; in vec2 uv;
uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
uniform vec2 uTack, uClew, uPeak, uHead;
uniform vec3 uXf;       // 船的平移 (x, y) 與旋轉
uniform float uB;       // 帆鼓起來的程度 0..1
uniform float uHoist;   // 升帆 0..1
uniform float uT;
out vec2 vUV; out float vShade; out vec2 vPx;
void main() {
  float u = uv.x, v = uv.y;     // u：0 桅杆 → 1 後緣；v：0 帆腳 → 1 帆頂
  float vh = v * uHoist;
  vec2 foot = mix(uTack, uClew, u), top = mix(uHead, uPeak, u);
  vec2 p = mix(foot, top, vh);
  // 帆鼓起來：後緣往外（往左）弓、帆腹往外推；鬆的時候有細小的皺紋在抖
  float belly = sin(PI * v) * pow(u, 1.2);
  p.x -= uB * 46.0 * belly;
  p.y -= uB * 10.0 * sin(PI * u) * v;
  p.x += (1.0 - uB) * 3.0 * sin(u * 17.0 + v * 9.0 - uT * 9.0) * u;
  // 帆腹的明暗：靠桅杆受光、往後緣暗下去；鼓得越飽越明顯
  vShade = 1.0 - uB * 0.15 * smoothstep(0.15, 0.95, u) * (0.55 + 0.45 * sin(PI * v))
         - (1.0 - uB) * 0.035 * (0.5 + 0.5 * sin(u * 23.0 - v * 11.0 + uT * 7.0));
  float c = cos(uXf.z), s = sin(uXf.z);
  vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + uXf.xy;
  vUV = vec2(u, v);
  vPx = vec2(u * ${SW}.0, v * ${SH}.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 0.0, 1.0);
}`;
const SAIL_FRAG = /* glsl */ `precision highp float;
${GLSL_COMMON}
in vec2 vUV; in float vShade; in vec2 vPx;
uniform sampler2D uTex;
uniform float uHoist;
out vec4 fragColor;
void main() {
  // 布：比紙白一點，橫向的縫線（一幅一幅的帆布）、靠後緣三根帆骨
  vec3 cloth = mix(C_PAPER, vec3(1.0), 0.3) * vShade;
  float sd = abs(mod(vPx.y + 31.0, 62.0) - 31.0);
  float seam = pxLine(sd, 0.4, 1.1) * 0.16;
  float batten = 0.0;
  for (int i = 1; i <= 3; i++) {
    float by = float(i) * ${SH}.0 / 4.0;
    batten = max(batten, pxLine(abs(vPx.y - by), 1.2, 2.0) * step(${SW}.0 - 90.0, vPx.x));
  }
  // 帆的邊（繩邊）
  float edge = min(min(vPx.x, ${SW}.0 - vPx.x), min(vPx.y, ${SH}.0 - vPx.y));
  float rope = pxLine(edge, 1.6, 2.6);
  vec3 col = mix(cloth, C_SEPIA, max(seam, batten * 0.5));
  // 字：fast 的 Layer2D（預乘、sRGB）要自己解；貼圖的 x 由左（後緣）往右（桅杆）
  vec4 tx = texture(uTex, vec2(1.0 - vUV.x, vUV.y));
  vec3 ink = tx.a > 0.0 ? toLinear(tx.rgb / tx.a) : vec3(0.0);
  col = mix(col, ink * mix(1.0, vShade, 0.5), tx.a * smoothstep(0.55, 0.95, uHoist));
  col = mix(col, C_SEPIA, rope * 0.9);
  fragColor = vec4(col, 1.0);
}`;

interface Mark { row: number; x0: number; w: number; h: number; a: number }
/** 旗子上的一行歌詞：字級與（一或兩）列；i0 是這一列第一個字在整行裡是第幾個字（跟唱進度用）。 */
interface Flag { size: number; rows: { text: string; i0: number; w: number }[] }

export default class Sailboat extends Scene {
  sky = shared('sailboat.sky', SKY);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  sailTex = this.track(new Layer2D(SW, SH, SCALE, { fast: true }));
  back = this.track(new LineBatch(6000, { screen2D: true, blend: 'normal' }));
  front = this.track(new LineBatch(4000, { screen2D: true, blend: 'normal' }));
  scene3 = new THREE.Scene();
  cam = new THREE.OrthographicCamera(0, W, 0, H, -10, 10);
  mat!: THREE.RawShaderMaterial;
  geo!: THREE.PlaneGeometry;
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 61 + (this.msg?.id ?? 0) * 29) >>> 0;
  b0 = 0;
  rows: { y: number; w: number; h: number; lw: number; a: number; speed: number }[] = [];
  marks: Mark[] = [];
  flagSize = new Map<number, Flag>();
  /** 歌詞字級：有留言時比帆上的留言小一號（焦點是留言），沒有留言時放大。 */
  lyrSize = 60;
  title = '';
  shipNo = '';
  avoid: Rect[] = [];
  sailRect: Rect = [0, 0, 0, 0];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    this.title = `${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
    this.shipNo = m ? no3(m.n) : `SONG ${String(song.index).padStart(2, '0')}`;
    const text = m ? m.text : NO_MSG;
    const sigText = m ? (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name)) : '';
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(text + sigText + NO_MSG + INVITE_SMALL + NOTE.join('') + this.title + lines.map((l) => l.text).join('') + '幸福號FROM THE COUPLE · 新人No.0123456789');

    // ---- 帆面上的字（畫一次）：貼圖座標 x 由左（後緣）往右（桅杆），y 由上（帆頂）往下
    const c = this.sailTex.ctx;
    const pad = { l: 58, r: 46, t: 48, b: 40 };
    const tagH = m?.couple ? 38 : 0;
    const sigSize = 44;
    const reserve = m ? sigSize + 22 : 60;
    const bw = SW - pad.l - pad.r, bh = SH - pad.t - pad.b;
    const fit = fitMsg(c, text, MSG_FAM, bw, bh - reserve - tagH, { min: 44, max: m ? 104 : 56, lineHeight: 1.26, maxLines: 6, oneLine: 68, lines: m ? undefined : NO_MSG_LINES });
    this.lyrSize = lyricSize(m ? fit.size : null, 60);
    const blockH = tagH + fit.height + reserve;
    const top = pad.t + (bh - blockH) / 2;
    const x0 = pad.l + (bw - fit.width) / 2;
    if (m?.couple) {
      c.font = font(F.mono(500), 17); c.letterSpacing = '3px'; c.fillStyle = paperSignal(0.95);
      c.fillText('FROM THE COUPLE · 新人', x0, top + 16); c.letterSpacing = '0px';
    }
    drawMessage(c, fit, MSG_FAM, x0, top + tagH + fit.size * 0.9, { color: rgba('sepia', 0.95) });
    if (m) {
      c.font = font(MSG_FAM, sigSize);
      const sw = measure(sigText, MSG_FAM, sigSize);
      c.fillStyle = paperSignal(0.95);
      c.fillText(sigText, Math.max(x0 + fit.width - sw, pad.l), top + tagH + fit.height + 18 + sigSize * 0.9);
    } else {
      c.font = font(F.hei(500), 24); c.letterSpacing = '1px'; c.fillStyle = rgba('sepia', 0.75);
      const iw = measure(INVITE_SMALL, F.hei(500), 24) + 20;
      c.fillText(INVITE_SMALL, Math.max(pad.l - 20, x0 + (fit.width - iw) / 2), top + fit.height + 46);
      c.letterSpacing = '0px';
    }
    this.sailTex.upload();

    // ---- 帆的網格
    this.geo = new THREE.PlaneGeometry(1, 1, 36, 30);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: SAIL_VERT, fragmentShader: SAIL_FRAG,
      uniforms: {
        ...THEME_UNIFORMS, uTex: { value: this.sailTex.texture },
        uTack: { value: new THREE.Vector2(...SAIL.tack) }, uClew: { value: new THREE.Vector2(...SAIL.clew) },
        uPeak: { value: new THREE.Vector2(...SAIL.peak) }, uHead: { value: new THREE.Vector2(...SAIL.head) },
        uXf: { value: new THREE.Vector3() }, uB: { value: 0 }, uHoist: { value: 1 }, uT: { value: 0 },
      },
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    this.scene3.add(mesh);

    // ---- 海：一排排鋼筆小浪（遠的小、密、淡；近的大、疏、濃）
    const rnd = (i: number, k: number) => hash(this.seed, i, k);
    let y = HORIZON + 10;
    for (let r = 0; y < H + 30; r++) {
      const d = (y - HORIZON) / (H - HORIZON);
      const w = lerp(26, 150, d), h = lerp(3, 16, d);
      this.rows.push({ y, w, h, lw: lerp(0.9, 2.1, d), a: lerp(0.45, 0.85, d), speed: lerp(8, 60, d) });
      y += lerp(10, 44, d);
    }
    this.rows.forEach((row, ri) => {
      let x = -row.w * rnd(ri, 0);
      for (let i = 0; x < W + row.w * 3; i++) {
        const w = row.w * (0.6 + 0.8 * rnd(ri * 97 + i, 1));
        if (rnd(ri * 97 + i, 2) > 0.18) this.marks.push({ row: ri, x0: x, w, h: row.h * (0.7 + 0.6 * rnd(ri * 97 + i, 3)), a: row.a });
        x += w * (1.1 + 0.9 * rnd(ri * 97 + i, 4));
      }
    });

    // ---- 旗子上的歌詞：先決定每一行的字級（放得進旗子最長的長度）
    for (const line of lines) this.flagFor(line);

    // ---- 即時小卡避開：旗子一帶、帆面
    const p = (k: readonly [number, number]) => [BOAT.x + k[0], BOAT.y + k[1]];
    const xs = [SAIL.tack, SAIL.clew, SAIL.peak, SAIL.head].map((k) => p(k)[0]!), ys = [SAIL.tack, SAIL.clew, SAIL.peak, SAIL.head].map((k) => p(k)[1]!);
    this.sailRect = [Math.min(...xs) - 60, Math.min(...ys) - 10, Math.max(...xs) - Math.min(...xs) + 70, Math.max(...ys) - Math.min(...ys) + 20];
    this.avoid = [[140, BOAT.y + MAST_TOP - 10, FLAG.maxLen + 30, 150], this.sailRect];
  }

  /** 一行歌詞在旗子上的字級與寬度。 */
  private flagFor(line: Line): Flag {
    let f = this.flagSize.get(line.i);
    if (f) return f;
    const maxW = FLAG.maxLen - 110;
    const size1 = fitLine(line.text, LYR_FAM, maxW, this.lyrSize, 48);
    if (layout(line.text, LYR_FAM, size1).width <= maxW + 1 || line.words.length < 2) {
      f = { size: size1, rows: [{ text: line.text, i0: 0, w: layout(line.text, LYR_FAM, size1).width }] };
    } else {
      // 一列放不下（字會小於 48 px）：在最接近中間的字之間折成兩列（旗子變寬）
      let best = 1, bestW = Infinity;
      for (let k = 1; k < line.words.length; k++) {
        const o = line.words[k]!.o;
        const w = Math.max(layout(line.text.slice(0, o).trimEnd(), LYR_FAM, 100).width, layout(line.text.slice(o), LYR_FAM, 100).width);
        if (w < bestW) { bestW = w; best = k; }
      }
      const o = line.words[best]!.o;
      const t1 = line.text.slice(0, o).trimEnd(), t2 = line.text.slice(o);
      const size = clamp(Math.floor((100 * maxW) / bestW), 48, Math.min(56, this.lyrSize));
      f = { size, rows: [{ text: t1, i0: 0, w: layout(t1, LYR_FAM, size).width }, { text: t2, i0: Array.from(line.text.slice(0, o)).length, w: layout(t2, LYR_FAM, size).width }] };
    }
    this.flagSize.set(line.i, f);
    return f;
  }

  /** 風：每個小節線一陣（彈簧），之後慢慢鬆回去。回傳 0..1+（帆鼓的程度）。 */
  private gust(t: number) {
    const au = this.ctx.audio;
    const bi = Math.floor(au.barAt(t) + 1e-4);
    const tb = au.timeOfBar(bi);
    if (tb < this.b0 - 0.01) return 0.3;
    const bar = Math.max(0.5, au.timeOfBar(bi + 1) - tb);
    const age = t - tb;
    // 從上一陣風剩下的 0.67 接著吹（小節線上不會先「塌」一下才鼓起來）
    const k = springStep(age, 1.6, 0.42);
    return 0.4 + 0.27 * (1 - k) + 0.6 * k * (1 - 0.55 * clamp(age / bar));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const inK = prog(t, s, s + 0.35);
    this.sky.u.uIn!.value = inK;
    this.sky.render(renderer, out);

    // 船：每拍輕輕起伏；小節線的風把船往前推一下、往下風處傾一點
    const g = this.gust(t);
    const bph = au.beatAt(t) % 1;
    const bob = 4 * Math.sin(bph * TAU) + 2 * Math.sin(t * 1.3);
    const heel = -0.012 - 0.018 * (g - 0.4);
    const surge = 26 * (g - 0.4);
    const xf = { x: BOAT.x + surge, y: BOAT.y + bob, r: heel };
    // 往左捲的浪：每拍捲一段（outCubic）
    const beats = Math.max(0, au.beatAt(t) - au.beatAt(s));
    const roll = Math.floor(beats) + ease.outCubic(clamp((beats % 1) / 0.5));

    this.back.clear(); this.front.clear();
    this.drawSea(roll, t);
    this.drawGulls(t);
    this.drawStays(xf);
    if (this.back.count) this.back.render(renderer, out);

    // 帆
    const u = this.mat.uniforms;
    (u.uXf!.value as THREE.Vector3).set(xf.x, xf.y, xf.r);
    u.uB!.value = t < this.b0 ? 0.15 : g;
    u.uHoist!.value = 0.08 + 0.92 * prog(t, this.b0 - 0.05, this.b0 + 0.5, (x) => ease.outBack(x, 1.2));
    u.uT!.value = t;
    renderer.setRenderTarget(out);
    renderer.render(this.scene3, this.cam);

    // 船身、桅杆、索具、旗子與歌詞
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    c.globalAlpha = inK;
    this.drawBoat(c, xf, t, g);
    this.drawFlag(c, xf, t, roll);
    this.drawNotes(c);
    comp.draw(renderer, L.upload(), out);
    if (this.front.count) this.front.render(renderer, out);
    return { paper: 1, popupAvoid: this.avoid, bloom: 0.1, bloomThreshold: 1.8, halation: 0.02, vignette: 0.16, grain: 0.04, ca: 0.3, zoom: slowPush(f.p) };
  }

  /** 鋼筆小浪：每一筆是一小段往上拱的弧；船身水線以下的列畫在前面那批（蓋住船底）。 */
  private drawSea(roll: number, t: number) {
    const ink = LIN.sepia;
    for (const mk of this.marks) {
      const row = this.rows[mk.row]!;
      const span = W + row.w * 4;
      let x = ((mk.x0 - roll * row.speed) % span + span) % span - row.w * 2;
      // 右下角 QR 區淡一點（亮版面的 HUD 字是深色的，底下不要太花）
      const hud = x > 1330 && row.y > 820 ? 0.4 : 1;
      const lb = row.y >= WATER - 6 ? this.front : this.back;
      // 船身附近的浪不要畫在船身上（船身擋住後面那一排）
      if (lb === this.back && row.y > HORIZON + 120 && x + mk.w > BOAT.x - 700 && x < BOAT.x + 420 && row.y > WATER - 60) continue;
      const n = 6;
      let px = x, py = row.y;
      for (let k = 1; k <= n; k++) {
        const q = k / n;
        const nx = x + mk.w * q, ny = row.y - mk.h * Math.sin(Math.PI * q) * (q < 0.5 ? 1 : 0.9);
        lb.seg2(px, py, nx, ny, row.lw * (0.6 + 0.6 * Math.sin(Math.PI * q)), ink, mk.a * hud);
        px = nx; py = ny;
      }
    }
    // 船尾拖出的兩道航跡（往後張開）
    const sx = BOAT.x - 700, sy = WATER + 2;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 10; k++) {
        const a = k / 10, b = (k + 0.6) / 10;
        const ph = (t * 0.6 + k * 0.13) % 1;
        this.front.seg2(sx - a * 520, sy + side * a * 26 + (side > 0 ? a * 18 : 0), sx - b * 520, sy + side * b * 26 + (side > 0 ? b * 18 : 0), 1.6 * (1 - a), ink, 0.7 * (1 - a) * (0.6 + 0.4 * ph));
      }
    }
  }

  /** 後支索、斜桁的吊索：會從帆的前面穿過去擋到字，所以畫在帆後面（被帆布擋住，只露出帆外面的一段）。 */
  private drawStays(xf: { x: number; y: number; r: number }) {
    const cs = Math.cos(xf.r), sn = Math.sin(xf.r), ink = LIN.sepia;
    const P = (x: number, y: number) => [xf.x + cs * x - sn * y, xf.y + sn * x + cs * y] as const;
    const seg = (a: readonly [number, number], b: readonly [number, number]) => this.back.seg2(a[0], a[1], b[0], b[1], 1.3, ink, 0.8);
    seg(P(4, MAST_TOP + 4), P(-690, -6));
    seg(P(4, MAST_TOP + 30), P(SAIL.peak[0] + 40, SAIL.peak[1] - 4));
  }

  /** 兩隻海鷗（細線的 m 字），翅膀在拍點拍一下。 */
  private drawGulls(t: number) {
    const au = this.ctx.audio, ink = LIN.sepia;
    const bph = au.beatAt(t) % 1;
    const flap = Math.sin(ease.outCubic(bph) * Math.PI);
    for (const [gx, gy, sc, off] of [[1560, 300, 1, 0], [1690, 360, 0.7, 0.35]] as const) {
      const x = gx + 30 * Math.sin(t * 0.25 + off * 5), y = gy + 8 * Math.sin(t * 0.7 + off * 3);
      const lift = (10 - 18 * ((flap + off) % 1)) * sc;
      const w = 30 * sc;
      this.back.seg2(x - w, y - lift, x - w * 0.45, y - 6 * sc, 1.6, ink, 0.8);
      this.back.seg2(x - w * 0.45, y - 6 * sc, x, y, 1.6, ink, 0.8);
      this.back.seg2(x, y, x + w * 0.45, y - 6 * sc, 1.6, ink, 0.8);
      this.back.seg2(x + w * 0.45, y - 6 * sc, x + w, y - lift, 1.6, ink, 0.8);
    }
  }

  /** 船身（剖面線稿、陰影排線、訊號色的舷線、船名）、桅杆、帆桁、索具、前帆。 */
  private drawBoat(c: CanvasRenderingContext2D, xf: { x: number; y: number; r: number }, t: number, g: number) {
    const ink = rgba('sepia', 0.95);
    c.save();
    // 船身在水線以下的部分看不到
    c.beginPath(); c.rect(0, 0, W, WATER + 4); c.clip();
    c.translate(xf.x, xf.y);
    c.rotate(xf.r);
    c.lineJoin = 'round'; c.lineCap = 'round';
    // 船身：船尾在左（方的）、船首在右（尖的、翹起來）
    const hull = new Path2D();
    hull.moveTo(-700, -4);
    hull.lineTo(410, -18);
    hull.quadraticCurveTo(452, -22, 474, -38);
    hull.quadraticCurveTo(400, 96, 170, 134);
    hull.lineTo(-560, 138);
    hull.quadraticCurveTo(-676, 120, -700, -4);
    hull.closePath();
    c.fillStyle = rgba('paper', 1);
    c.fill(hull);
    // 船身的陰影：斜排線（剖面的下半部）
    c.save();
    c.clip(hull);
    c.strokeStyle = rgba('sepia', 0.35);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let x = -760; x < 520; x += 9) { c.moveTo(x, 58); c.lineTo(x + 70, 150); }
    c.stroke();
    // 舷線：一條訊號色的寬帶＋細線
    c.fillStyle = paperSignal(0.85);
    c.beginPath(); c.moveTo(-700, 6); c.lineTo(440, -10); c.lineTo(440, 4); c.lineTo(-700, 20); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = ink; c.lineWidth = 2.6;
    c.stroke(hull);
    // 船名（船尾）與編號
    c.font = font(F.ming(900), 22);
    c.fillStyle = rgba('sepia', 0.85);
    c.fillText('幸福號', -630, 62);
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '3px';
    c.fillText(this.shipNo, -548, 62);
    c.letterSpacing = '0px';
    // 桅杆、帆桁（boom）、斜桁（gaff）
    c.lineWidth = 7;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(4, MAST_TOP); c.stroke();
    const bc = SAIL.clew, pk = SAIL.peak, hd = SAIL.head, tk = SAIL.tack;
    const bellyX = -(g * 46);
    c.lineWidth = 5.5;
    c.beginPath(); c.moveTo(tk[0], tk[1] + 6); c.lineTo(bc[0] - 30, bc[1] + 4); c.stroke();
    c.lineWidth = 4.5;
    c.beginPath(); c.moveTo(hd[0], hd[1]); c.lineTo(pk[0] - 16, pk[1] - 2); c.stroke();
    // 索具：前支索（桅頂到船首）、後支索、帆桁的控帆索
    c.lineWidth = 1.4;
    c.strokeStyle = rgba('sepia', 0.8);
    c.beginPath();
    c.moveTo(4, MAST_TOP + 4); c.lineTo(462, -34);
    c.moveTo(bc[0] + 30, bc[1] + 4); c.lineTo(-610, -4);
    c.stroke();
    // 前帆（三角帆）：跟著風鼓一點，布面兩條皺摺
    const jb = [[10, MAST_TOP + 30], [430, -34], [40, -30]] as const;
    const bulge = 26 + 30 * g;
    c.beginPath();
    c.moveTo(jb[0][0], jb[0][1]);
    c.quadraticCurveTo((jb[0][0] + jb[1][0]) / 2 + bulge, (jb[0][1] + jb[1][1]) / 2 - bulge * 0.35, jb[1][0], jb[1][1]);
    c.lineTo(jb[2][0], jb[2][1]);
    c.closePath();
    c.fillStyle = rgba('paper', 1);
    c.fill();
    c.strokeStyle = ink; c.lineWidth = 2.2; c.stroke();
    c.strokeStyle = rgba('sepia', 0.3); c.lineWidth = 1;
    c.beginPath();
    for (let k = 1; k <= 3; k++) { const q = k / 4; c.moveTo(lerp(jb[0][0], jb[2][0], q) + 6, lerp(jb[0][1], jb[2][1], q)); c.lineTo(lerp(jb[0][0], jb[1][0], q) + bulge * 0.6, lerp(jb[0][1], jb[1][1], q)); }
    c.stroke();
    c.restore();
    void bellyX; void t;
  }

  /** 桅頂的長三角旗：往左（船尾）飄，每拍甩出一道波；歌詞沿著旗子的中線排（一或兩列）。 */
  private drawFlag(c: CanvasRenderingContext2D, xf: { x: number; y: number; r: number }, t: number, roll: number) {
    const { lyrics } = this.ctx;
    const ly = lyricAt(lyrics, t, 1.3, 0.35);
    let flag: Flag = { size: 40, rows: [{ text: this.title, i0: 0, w: measure(this.title, LYR_FAM, 40) }] };
    let line: Line | null = null, alpha = 1;
    if (lyrics.has) {
      if (!ly) flag = { size: 40, rows: [] };
      else { line = ly.line; flag = this.flagFor(line); alpha = ly.k; }
    }
    const size = flag.size, nRows = flag.rows.length;
    const tw = Math.max(0, ...flag.rows.map((r) => r.w));
    // 旗子掛在桅頂（跟著船晃）；長度依字的寬度，最短 420；兩列時旗子寬一點
    const cs = Math.cos(xf.r), sn = Math.sin(xf.r);
    const hx = xf.x + cs * FLAG.x0 - sn * FLAG.y0, hy = xf.y + sn * FLAG.x0 + cs * FLAG.y0;
    const len = clamp(Math.max(420, tw + 110), 420, FLAG.maxLen);
    const hh = nRows > 1 ? size * 2.25 : Math.max(size * 0.95, 60);
    // 中線：越往尾巴擺得越大；波往尾巴傳（每拍 roll 加一）
    const cy = (d: number) => hy + hh * 0.55 + 7 * Math.min(1, d / 260) * Math.sin(d / 150 - roll * Math.PI) + d * 0.03;
    const half = (d: number) => lerp(hh * 0.55, hh * (nRows > 1 ? 0.4 : 0.3), d / len);
    const N = 40;
    c.save();
    c.beginPath();
    for (let i = 0; i <= N; i++) { const d = (len * i) / N; c.lineTo(hx - d, cy(d) - half(d)); }
    // 燕尾
    c.lineTo(hx - len + 40, cy(len - 40));
    for (let i = N; i >= 0; i--) { const d = (len * i) / N; c.lineTo(hx - d, cy(d) + half(d)); }
    c.closePath();
    c.fillStyle = rgba('paper', 1);
    c.fill();
    c.strokeStyle = rgba('sepia', 0.9); c.lineWidth = 1.8; c.stroke();
    // 靠桅杆的一段訊號色
    c.save(); c.clip();
    c.fillStyle = paperSignal(0.9);
    c.fillRect(hx - 22, hy - 20, 22, hh * 1.6);
    c.restore();
    // 字：沿著中線一個字一個字排（字的中心落在中線上、依斜率轉）；兩列時上下各偏半行
    const gp = line ? glyphProgress(line, t) : null;
    c.font = font(LYR_FAM, size);
    c.textBaseline = 'middle';
    c.globalAlpha *= alpha;
    flag.rows.forEach((row, ri) => {
      const lay = layout(row.text, LYR_FAM, size);
      const dy = (ri - (nRows - 1) / 2) * size * 1.08;
      const startD = 40 + (len - 110 - lay.width) / 2 + lay.width; // 距離桅杆：第一個字在最左邊
      lay.glyphs.forEach((gl, k) => {
        if (gl.ch === ' ') return;
        const d = startD - gl.x - gl.w / 2;
        const x = hx - d, y = cy(d) + dy;
        const ang = Math.atan2(cy(d - 2) - cy(d + 2), 4);
        c.save();
        c.translate(x, y);
        c.rotate(ang);
        c.fillStyle = gp ? singColor(gp[row.i0 + k]?.p ?? 0, true) : rgba('sepia', 0.72);
        c.fillText(gl.ch, -gl.w / 2, size * 0.04);
        c.restore();
      });
    });
    c.restore();
  }

  /** 左下角的冷面註記（mono）。 */
  private drawNotes(c: CanvasRenderingContext2D) {
    c.save();
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.72);
    NOTE.forEach((n, i) => c.fillText(n, 150, 318 + i * 28));
    c.restore();
  }

  override dispose() {
    this.geo?.dispose();
    this.mat?.dispose();
    super.dispose();
  }
}
