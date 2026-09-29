// 便利貼牆（亮）：一面漆白的牆，一拍一張便利貼「啪」地貼上去——真的是 three.js 的立體：每張便利貼上緣黏著、下緣微微翹起來
// （彈一下才停），牆上有它的影子；鏡頭在第一拍落定（從斜一點、近一點的位置），之後每貼一張就輕輕往前頂一下。
//  - 最上面一排：歌詞寫在一整排便利貼上（麥克筆，字跨過好幾張，便利貼之間有一點點錯位）。每一句歌詞開始前，
//    一排新的便利貼從左到右一口氣疊上去蓋住上一句，照跟唱規則上色（還沒唱三成、正在唱訊號色的暗部、唱完墨色）。
//  - 主打留言：第一拍貼上左下那張最大的；之後每拍在右邊貼一張別人的短留言（沒有就貼冷面的待辦：「☑ 吃飽了」），
//    貼滿四格以後，每個小節線再往上疊一張。
//  - 右邊一條（即時小卡的位置）只有幾張裝飾用的便利貼（愛心、日期、∞），被小卡蓋住沒關係。
//  - 純音樂：上面那排寫歌名。沒有留言：最大那張是邀請（掃右下角 QR，把祝福貼上來）。
// 畫法：牆與便利貼都是一個 three.js 場景（透視鏡頭）。便利貼是一個 instanced mesh（每張兩個實例：先畫影子再畫紙，
// 照順序疊），紙上的字取自兩張 Canvas2D：不會變的（留言、裝飾）在 init() 畫一次，歌詞那一條每格重畫。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D, W, H, SCALE } from '../engine/gl';
import { GLSL_COMMON, THEME_UNIFORMS } from '../engine/glsl/common';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash, pulse, mulberry32 } from '../engine/util';
import { fitText } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, drawHeart, fillWithHearts, signature, DATE_DOTS, type LyricStyle } from './_motifs';
import { grid, windowLines, renderStage, type Grid } from './_t5';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.35, 1], bars: [4, 8], minMessages: 4 };

// ---------------------------------------------------------------- 牆上的位置（鏡頭歸位時 = 螢幕像素，y 向下）
const ROW = { x: 140, y: 120, w: 820, n: 4 }; // 歌詞那一排（一張 205）：只在主打那張上面，跟主打同一個焦點
const NOTE_S = ROW.w / ROW.n;
const HERO = { x: 460, y: 640, s: 620, rot: -0.022 };
const SLOTS = [[1060, 470], [1370, 486], [1066, 790], [1380, 800]] as const; // 右邊四格（中心）：離焦點遠，會糊掉
const SLOT_S = 282;
const DECOR = [[1250, 170, 214, -0.07], [1700, 250, 190, 0.06], [1690, 620, 200, 0.04]] as const;
// 字的畫布：atlas（不會變的）與 strip（歌詞，每格重畫；三條：歌名、偶數句、奇數句）
const AT_W = 2048, AT_H = 1200, AT_RES = 1.25;
const BAND_H = 200;
// 歌詞比主打留言小一級；沒有留言時歌詞是焦點，大一點
const LY: LyricStyle = { family: F.archivo(100, 700), size: 60, minSize: 50, maxWidth: ROW.w - 60, align: 'center', lineHeight: 1.1 };
const LY_BIG: LyricStyle = { ...LY, family: F.archivo(100, 900), size: 84 };
const SLAP = 0.15; // 貼上去要幾秒

const TODO = ['☑ 找到座位', '☑ 吃飽了', '☐ 跟新人合照', '☐ 寫一句祝福', '記得：拿喜餅', '新郎 好帥', '新娘 好美', '芃芃 QQ 很乖'];

// ---------------------------------------------------------------- 三維場景（整晚共用）
const NOTE_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec2 uv;
in vec4 iA;  // 中心 x、y（牆面像素，y 向下）、離牆的高度、旋轉
in vec4 iB;  // 寬、高、翹起的量、透明度
in vec4 iUV; // 字的畫布上的範圍（u0 v0 u1 v1）
in vec4 iC;  // 紙的顏色（linear）、種類（0 影子、1 紙＋atlas、2 紙＋strip）
uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
out vec2 vUv; out vec2 vLocal; out float vShade; out vec4 vRect; out vec3 vCol; out float vKind; out float vAlpha; out float vS;
void main() {
  vec2 lp = position.xy; // -0.5..0.5，y 向上
  float s = 0.5 - lp.y;  // 0 = 上緣（黏膠）… 1 = 下緣
  float kind = iC.w;
  vec2 size = iB.xy;
  float cs = max(0.0, s - 0.2) / 0.8;
  float z = iB.z * size.y * 0.13 * cs * cs;
  float dzds = iB.z * size.y * 0.13 * 2.0 * cs / 0.8;
  vec2 off = vec2(0.0);
  if (kind < 0.5) {
    // 影子：大一點、往右下偏；紙離牆越高影子越散、越遠
    // 下緣翹起來的地方影子離得比較遠（看得出它離開牆面）
    float co = iB.z * size.y * 0.075 * cs * cs;
    size += vec2(22.0 + iA.z * 0.2);
    off = vec2(8.0 + iA.z * 0.12 + co * 0.45, -11.0 - iA.z * 0.16 - co);
    z = 0.0; dzds = 0.0;
  }
  vec2 p = lp * size;
  float c = cos(iA.w), sn = sin(iA.w);
  p = vec2(c * p.x - sn * p.y, sn * p.x + c * p.y) + off;
  vec3 world = vec3(iA.x + p.x, -iA.y + p.y, (kind < 0.5 ? 0.3 : iA.z + z + 0.6));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  // 明暗：翹起來的下緣朝上、接到上方的光，稍微亮一點；整張由上往下一點點變暗
  vec3 n = normalize(vec3(0.0, dzds / size.y, 1.0));
  vShade = 0.95 + 0.1 * dot(n, normalize(vec3(-0.25, 0.8, 0.55))) - 0.045 * s;
  vUv = uv; vLocal = lp; vRect = iUV; vCol = iC.rgb; vKind = kind; vAlpha = iB.w; vS = s;
}`;

const NOTE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv; in vec2 vLocal; in float vShade; in vec4 vRect; in vec3 vCol; in float vKind; in float vAlpha; in float vS;
uniform sampler2D atlas; uniform sampler2D strip;
out vec4 fragColor;
${GLSL_COMMON}
void main() {
  if (vKind < 0.5) {
    // 柔和的影子：離邊越近越淡
    vec2 q = abs(vLocal) * 2.0;
    float e = max(q.x, q.y);
    float a = (1.0 - smoothstep(0.66, 1.0, e)) * 0.26 * vAlpha;
    fragColor = vec4(C_SEPIA * 0.6 * a, a);
    return;
  }
  vec2 tuv = mix(vRect.xy, vRect.zw, vUv);
  vec4 tx = vKind < 1.5 ? texture(atlas, tuv) : texture(strip, tuv);
  // 字的畫布是 fast 上傳（預乘、sRGB）：自己解回線性
  vec3 ink = tx.a > 0.0 ? toLinear(tx.rgb / tx.a) : vec3(0.0);
  vec3 paper = vCol * vShade;
  paper *= 1.0 - 0.05 * (1.0 - smoothstep(0.0, 0.1, vS)); // 上緣的黏膠條
  // 邊緣一條很細的暗線（紙的厚度）
  vec2 q = abs(vLocal) * 2.0;
  paper *= 1.0 - 0.16 * smoothstep(0.975, 1.0, max(q.x, q.y));
  vec3 col = mix(paper, ink, tx.a);
  fragColor = vec4(col * vAlpha, vAlpha);
}`;

const WALL_VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
out vec2 vW;
void main() { vW = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const WALL_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vW;
out vec4 fragColor;
${GLSL_COMMON}
void main() {
  vec2 p = vec2(vW.x, -vW.y); // 牆面像素，y 向下
  // 漆過的牆：滾筒留下的直紋、很淡的斑駁；左上方的光
  float roll = fbm(vec2(p.x / 60.0, p.y / 900.0), 3) * 0.5 + fbm(p / 260.0, 3) * 0.5;
  vec3 col = C_PAPER * (0.88 + 0.022 * roll);
  col *= 0.94 + 0.08 * (1.0 - smoothstep(0.0, 1900.0, length(p - vec2(300.0, -100.0))));
  fragColor = vec4(col, 1.0);
}`;

const CAP = 320;
function makeRig() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(26, W / H, 10, 20000);
  const wallMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, uniforms: { ...THEME_UNIFORMS }, depthTest: true, depthWrite: true }); // 牆要寫深度：景深靠它
  // 牆的頂點座標就是牆面座標（平移放進幾何，shader 直接拿來算紋路）
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(9000, 6000).translate(960, -540, 0), wallMat);
  wall.frustumCulled = false; wall.renderOrder = 0;
  const base = new THREE.PlaneGeometry(1, 1, 1, 12);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const attr = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const A = { iA: attr(4), iB: attr(4), iUV: attr(4), iC: attr(4) };
  for (const [k, a] of Object.entries(A)) geo.setAttribute(k, a);
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: NOTE_VERT, fragmentShader: NOTE_FRAG,
    uniforms: { atlas: { value: null }, strip: { value: null }, ...THEME_UNIFORMS },
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const notes = new THREE.Mesh(geo, mat);
  notes.frustumCulled = false; notes.renderOrder = 1;
  scene.add(wall, notes);
  return { scene, cam, geo, mat, A, count: 0 };
}

/** 一張便利貼。t0 = 貼上去的時間（-Infinity：窗格開始前就在了）；tex 0 = atlas、1 = strip。 */
interface Note { x: number; y: number; w: number; h: number; rot: number; t0: number; curl: number; uv: [number, number, number, number]; tex: 0 | 1; color: (t: number) => [number, number, number]; side: number }

const mixLin = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

export default class StickyNotes extends Scene {
  rig = shared('stickynotes.rig', makeRig);
  atlas = this.track(new Layer2D(AT_W, AT_H, SCALE * AT_RES, { fast: true }));
  strip = this.track(new Layer2D(ROW.w, BAND_H * 3, SCALE * AT_RES, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  notes: Note[] = [];
  lines: Line[] = [];
  /** 每一句歌詞那一排便利貼開始疊上去的時間。 */
  layerT: number[] = [];
  atlasDirty = true;

  override async init() {
    const { audio: au, lyrics, song, params } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    this.lines = windowLines(lyrics, s, e);
    const m = this.msg;
    const others = ((params.messages ?? []) as Msg[]).filter((x) => x.id !== m?.id && Array.from(x.text).length <= 15);
    await loadText(`${TODO.join('')}空位等你來貼掃描右下角把你的祝福貼上來一位賓客♪∞${song.title}${song.artist}${m ? m.text + m.name : ''}${others.slice(0, 12).map((x) => x.text + x.name).join('')}${this.lines.map((l) => l.text).join('')}`);
    const rnd = mulberry32((params.seed ?? 1) * 7 + 3);
    const c = this.atlas.ctx;
    c.textBaseline = 'alphabetic';
    const paper = () => LIN.paper, sig = () => LIN.signal, emb = () => LIN.ember, bone = () => LIN.bone;
    const uvOf = (x: number, y: number, w: number, h: number): [number, number, number, number] => [x / AT_W, 1 - (y + h) / AT_H, (x + w) / AT_W, 1 - y / AT_H];

    // ---- 右邊的裝飾（窗格開始前就在了）
    DECOR.forEach(([x, y, sz, rot], i) => {
      const cx = 20 + i * 240, cy = 900;
      this.decorCell(c, cx, cy, sz, i);
      this.notes.push({ x, y, w: sz, h: sz, rot, t0: -Infinity, curl: 0.5, uv: uvOf(cx, cy, sz, sz), tex: 0, color: (t) => mixLin(paper(), i === 1 ? emb() : sig(), i === 1 ? 0.45 : 0.28), side: 1 });
    });

    // ---- 歌詞那一排：每一句一層（句子開始前 0.35 秒要蓋好，所以提早一點開始一張一張疊）
    const layers: { t: number; band: number }[] = [];
    this.lines.forEach((l, i) => {
      const tl = l.start - 0.35 - 0.34;
      layers.push({ t: tl < s + 0.05 ? -Infinity : tl, band: 1 + (i % 2) });
    });
    // 窗格開始時還沒有句子（或純音樂）：先有一排寫歌名的
    if (!layers.length || layers[0]!.t !== -Infinity) layers.unshift({ t: -Infinity, band: 0 });
    // 窗格開始前就在唱的句子只留最後一層
    const firstLive = layers.map((x) => x.t === -Infinity).lastIndexOf(true);
    layers.slice(firstLive).forEach((ly, li) => {
      for (let j = 0; j < ROW.n; j++) {
        const jitter = (k: number) => hash(li, j, k, params.seed ?? 1) - 0.5;
        this.notes.push({
          x: ROW.x + NOTE_S * (j + 0.5) + jitter(1) * 3, y: ROW.y + BAND_H / 2 - 4 + jitter(2) * 4, w: NOTE_S + 4, h: NOTE_S, rot: jitter(3) * 0.03,
          t0: ly.t === -Infinity ? -Infinity : ly.t + j * 0.055, curl: 0.35 + jitter(4) * 0.3,
          uv: [j / ROW.n, 1 - (ly.band + 1) * BAND_H / (3 * BAND_H), (j + 1) / ROW.n, 1 - ly.band * BAND_H / (3 * BAND_H)], tex: 1,
          color: () => mixLin(paper(), sig(), 0.42), side: 1,
        });
      }
    });
    this.layerT = layers.slice(firstLive).map((x) => x.t);
    this.drawTitleBand();

    // ---- 主打：最大的那張
    const hx = 0, hy = 0;
    this.heroCell(c, hx, hy, HERO.s);
    this.notes.push({ x: HERO.x, y: HERO.y, w: HERO.s, h: HERO.s, rot: HERO.rot, t0: g.b0, curl: 0.55, uv: uvOf(hx, hy, HERO.s, HERO.s), tex: 0, color: () => mixLin(paper(), emb(), 0.55), side: -1 });

    // ---- 右邊四格：主打之後每拍一張，貼滿以後每個小節線再疊一張
    const texts: { text: string; name: string }[] = others.map((x) => ({ text: x.text, name: x.name }));
    let ti = Math.floor(rnd() * TODO.length);
    const nextText = () => texts.shift() ?? { text: TODO[ti++ % TODO.length]!, name: '' };
    const times: number[] = [];
    for (let k = 1; k <= 4; k++) times.push(g.b0 + g.beat * k);
    for (const b of g.bars) if (b > g.b0 + g.beat * 4.5 && b < e - g.beat * 0.5 && times.length < 12) times.push(b);
    times.filter((x) => x < e - 0.1).forEach((tt, k) => {
      const [sx, sy] = SLOTS[k % 4]!;
      const cellX = 660 + (k % 4) * 290, cellY = (Math.floor(k / 4)) * 292;
      const tx = nextText();
      this.smallCell(c, cellX, cellY, SLOT_S, tx.text, tx.name, k);
      const tone = k % 3;
      this.notes.push({
        x: sx + (rnd() - 0.5) * 18, y: sy + (rnd() - 0.5) * 18, w: SLOT_S, h: SLOT_S, rot: (rnd() - 0.5) * 0.09, t0: tt, curl: 0.4 + rnd() * 0.5,
        uv: uvOf(cellX, cellY, SLOT_S, SLOT_S), tex: 0, color: () => tone === 0 ? mixLin(paper(), sig(), 0.3) : tone === 1 ? mixLin(paper(), bone(), 0.6) : mixLin(paper(), emb(), 0.5), side: k % 2 ? 1 : -1,
      });
    });
    // 畫的順序：先裝飾、再歌詞那排、主打、右邊（同一區裡照貼上去的時間）
  }

  /** 右邊裝飾：愛心、日期、∞。 */
  private decorCell(c: CanvasRenderingContext2D, x: number, y: number, s: number, i: number) {
    c.save(); c.beginPath(); c.rect(x, y, s, s); c.clip();
    if (i === 0) drawHeart(c, x + s / 2, y + s / 2 + 6, s * 0.46);
    else if (i === 1) {
      const d = DATE_DOTS.replace(/ /g, '');
      const fit = fitText(c, d, F.hand(700), s - 40, 60, { min: 20, max: 40, maxLines: 1 });
      c.font = font(F.hand(700), fit.size); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'center';
      c.fillText(d, x + s / 2, y + s / 2 + fit.size * 0.35); c.textAlign = 'left';
    } else {
      c.font = font(F.serif(600, true), 150); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'center';
      c.fillText('∞', x + s / 2, y + s / 2 + 44); c.textAlign = 'left';
    }
    c.restore();
  }

  /** 主打那張：麥克筆寫的留言、署名、No.；沒有留言是邀請。 */
  private heroCell(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
    const m = this.msg;
    c.save(); c.beginPath(); c.rect(x, y, s, s); c.clip();
    const text = m ? m.text : '掃描右下角 QR code，把你的祝福貼上來';
    // 高度預算扣掉署名那一行：署名永遠在字的下面
    const fit = fitText(c, text, F.hand(700), s - 80, s - 150, { min: 48, max: m ? 116 : 64, lineHeight: 1.2, maxLines: 7 });
    c.font = font(F.hand(700), fit.size); c.fillStyle = rgba('sepia', m ? 0.95 : 0.7);
    const top = y + 44 + (s - 150 - fit.height) * 0.4;
    fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x + 38, top + fit.size * 0.9 + i * fit.lineHeight));
    if (m) {
      c.font = font(F.hand(400), 36); c.fillStyle = rgba('sepia', 0.75); c.textAlign = 'right';
      c.fillText(signature(m.name), x + s - 40, y + s - 44); c.textAlign = 'left';
    }
    c.restore();
  }

  /** 右邊的小張：別人的短留言（手寫、署名）或冷面待辦。 */
  private smallCell(c: CanvasRenderingContext2D, x: number, y: number, s: number, text: string, name: string, k: number) {
    c.save(); c.beginPath(); c.rect(x, y, s, s); c.clip();
    const fit = fitText(c, text, F.hand(700), s - 56, s - (name ? 110 : 70), { min: 44, max: 64, lineHeight: 1.18, maxLines: 3 });
    c.font = font(F.hand(700), fit.size); c.fillStyle = rgba('sepia', 0.92);
    const top = y + 40 + (s - (name ? 110 : 70) - fit.height) / 2;
    fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x + 28, top + fit.size * 0.9 + i * fit.lineHeight));
    if (name) {
      c.font = font(F.hand(400), 28); c.fillStyle = rgba('sepia', 0.7); c.textAlign = 'right';
      c.fillText(signature(name), x + s - 26, y + s - 30); c.textAlign = 'left';
    }
    void k;
    c.restore();
  }

  /** 歌名那一條（不會變，畫一次）。 */
  private drawTitleBand() {
    const c = this.strip.ctx, { song, lyrics } = this.ctx;
    c.save(); c.beginPath(); c.rect(0, 0, ROW.w, BAND_H); c.clip();
    const txt = `♪ ${song.title || '今晚的歌'}${!lyrics.has && song.artist ? ' · ' + song.artist : ''}`;
    const fit = fitText(c, txt, F.archivo(100, 900), ROW.w - 90, BAND_H - 60, { min: 50, max: 110, lineHeight: 1.05, maxLines: 2 });
    c.font = font(F.archivo(100, 900), fit.size); c.fillStyle = rgba('sepia', 0.92); c.textAlign = 'center';
    fit.lines.forEach((ln, i) => c.fillText(ln, ROW.w / 2, BAND_H / 2 + fit.size * 0.36 - (fit.lines.length - 1) * fit.lineHeight / 2 + i * fit.lineHeight));
    c.textAlign = 'left';
    c.restore();
  }

  /** 歌詞的兩條：正在唱的那句（跟唱）與上一句（全部唱完）。 */
  private drawBands(t: number) {
    const c = this.strip.ctx;
    const st = { ...(this.msg ? LY : LY_BIG), active: rgba('blood'), sung: rgba('sepia', 0.94), unsung: rgba('sepia', 0.3) };
    for (let band = 1; band <= 2; band++) {
      c.clearRect(0, band * BAND_H, ROW.w, BAND_H);
      // 這一條屬於哪一句：窗格裡第 i 句用 band 1 + (i % 2)，挑最近開始蓋的那一句
      let line: Line | null = null;
      this.lines.forEach((l, i) => { if (1 + (i % 2) === band && l.start - 0.35 - 0.4 <= t) line = l; });
      if (!line) continue;
      const ln = line as Line;
      const lay = layoutLyric(c, ln, st);
      c.save();
      c.beginPath(); c.rect(0, band * BAND_H, ROW.w, BAND_H); c.clip();
      c.translate(ROW.w / 2, band * BAND_H + BAND_H / 2 + lay.size * 0.36 - (lay.rows.length - 1) * lay.size * 1.05 / 2);
      drawLyric(c, ln, t, st, lay, 1);
      c.restore();
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, g = this.g;
    const R = this.rig;
    this.drawBands(t);
    R.mat.uniforms.atlas!.value = this.atlas.texture;
    R.mat.uniforms.strip!.value = this.strip.upload();
    if (this.atlasDirty) { this.atlas.upload(); this.atlasDirty = false; }

    // ---- 實例：每張兩個（影子、紙），照順序疊
    const A = R.A;
    let n = 0, lastSlap = -Infinity;
    const put = (a: THREE.InstancedBufferAttribute, i: number, x: number, y: number, z: number, w: number) => { const arr = a.array as Float32Array; arr[i * 4] = x; arr[i * 4 + 1] = y; arr[i * 4 + 2] = z; arr[i * 4 + 3] = w; };
    for (const nt of this.notes) {
      if (t < nt.t0 - 0.001) continue;
      if (nt.t0 > lastSlap && nt.t0 <= t) lastSlap = nt.t0;
      const age = t - nt.t0;
      const e = nt.t0 === -Infinity ? 1 : ease.outExpo(clamp(age / SLAP));
      const lift = 320 * (1 - e);
      const sc = 1 + 0.14 * (1 - e);
      const rot = nt.rot + (1 - e) * 0.22 * nt.side;
      const wob = nt.t0 === -Infinity || age < SLAP ? 0 : Math.exp(-(age - SLAP) * 6) * Math.sin((age - SLAP) * 26) * 0.9;
      const curl = Math.max(0, nt.curl + wob + (1 - e) * 1.2);
      const alpha = nt.t0 === -Infinity ? 1 : clamp(age / 0.05);
      const col = nt.color(t);
      for (const kind of [0, nt.tex === 1 ? 2 : 1]) {
        if (n >= CAP) break;
        put(A.iA, n, nt.x, nt.y, lift, rot);
        put(A.iB, n, nt.w * sc, nt.h * sc, curl, alpha);
        put(A.iUV, n, nt.uv[0], nt.uv[1], nt.uv[2], nt.uv[3]);
        put(A.iC, n, col[0], col[1], col[2], kind);
        n++;
      }
    }
    for (const a of Object.values(A)) { a.needsUpdate = true; a.addUpdateRange(0, n * 4); }
    R.geo.instanceCount = n;

    // ---- 鏡頭：斜斜地看著牆（從左邊），焦點在主打那張與上面那排歌詞；右邊的便利貼越遠越糊（淺景深）。
    // 第一拍（主打貼上去）前從更斜、更近的地方搖進來落定；之後每個小節線往前推一小步，每貼一張輕輕頂一下。
    const D0 = (H / 2) / Math.tan(THREE.MathUtils.degToRad(13));
    const k = ease.outCubic(prog(t, s, Math.max(s + 0.3, g.b0 + 0.2)));
    let step = 0;
    for (const b of g.bars) step += prog(t, b - 0.1, b + 0.7, ease.inOutCubic);
    const push = 14 * pulse(t, lastSlap, 0.09) + Math.min(step, 6) * 22;
    const yaw = 0.34 + (1 - k) * 0.12;
    const look = new THREE.Vector3(800, -545, 0);
    const D = D0 * lerp(0.95, 1.03, k) - push;
    R.cam.position.set(look.x - Math.sin(yaw) * D, look.y + (1 - k) * 30, Math.cos(yaw) * D);
    R.cam.lookAt(look);
    R.cam.updateMatrixWorld();
    // 對焦在主打與歌詞那一排中間（牆上 x≈470）
    const fp = new THREE.Vector3(470, -450, 0);
    const focus = R.cam.position.distanceTo(fp);
    renderStage(renderer, R.scene, R.cam, out, LIN.paper, { focus, range: 130, maxR: 16, falloff: 0.1 });
    for (const a of Object.values(A)) a.clearUpdateRanges();
    void au;
    return {
      paper: 1, bloom: 0.2, vignette: 0.26, grain: 0.04,
    };
  }
}

