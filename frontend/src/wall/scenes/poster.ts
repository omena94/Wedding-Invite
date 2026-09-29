// 網版海報（亮）：印刷工作台上的一張演唱會海報，正在網版印刷。海報的圖是主視覺（右邊大半）：
//  1. 第一刀（落在第一個拍點）：訊號色——海平線上半顆大大的網點太陽、一圈放射的光芒、兩道細的弧線；暗部色——一片網點的海浪（太陽的倒影是訊號色）。
//  2. 第二刀（落在下一個小節線）：深墨——主打留言排在海報左邊（黑體，40～60 px，照留言尺寸標準 v2，留言區約 650 × 420），
//     署名、日期等小字；愛心是第三色（玫瑰）。兩色疊印的地方顏色更深（油墨是透明的、相乘）。
//  之後這張海報是「會動的印刷品」：每一拍光芒轉半格（像翻頁動畫）、太陽的網點跟著低音呼吸、每個小節線海浪往前推一格、
//  每個大鼓訊號色那一版的套準「跳」一下（兩版錯開幾 px 再彈回來）；每兩小節刮刀再刮一次（補墨，濕的反光掃過去）。
//  - 一個焦點：留言。歌詞印在留言下面（逐字跟唱：還沒唱是淡墨、正在唱是訊號色、唱完是深墨）。
//  - 沒有留言：留言的位置印正在唱的歌詞（逐字跟唱）；純音樂又沒有留言：印新人的名字，下面一行邀請。
//  - 鏡頭：刮墨的時候是斜斜的近景（刮刀從畫面上方刮過來、影子落在紙上），第二刀刮完在拍點上切到比較正的全景，慢慢推近。
//  - 右下角（HUD）是海報空白的紙邊，不印東西。
// 手法：three.js 的「桌上的紙」舞台（_t4 Stage：透視、景深、桌面與影子），刮刀是一個真的 3D 方塊；
// 海報本身每格用一個 shader 畫進 render target：分色的遮罩（init() 畫一次：網點的濃淡、訊號色實地、深墨、玫瑰）、
// 網點在 shader 裡算（旋轉 15° 的網格）、兩版各自的套準偏移、刮刀掃過的範圍、剛刮上去的濕墨反光、網布的細紋。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, makeRT } from '../engine/gl';
import { F, font } from '../engine/type';
import { clamp, ease, prog, hash, pulse, lerp } from '../engine/util';
import { Lyrics } from '../engine/lyrics';
import { lyricAt, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { grid, layoutRows, Stage, camDist, type Grid, type RowsLayout, type V3 } from './_t4';
import { loadAll, t21Grain, GRAIN_GLSL, block, glyphPath, groupLine, T21_INVITE, type Block, type TGlyph, type TGroup, type Rect } from './_t21';
import { V2, lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'print', paper: true, energy: [0.45, 1], bars: [4, 8], weight: 1 };

/** 海報（紙面 px）與它的 render target（1.25 倍，推近時網點還是銳利）。 */
const PW = 1500, PH = 1000, RES = 1.25;
/** 留言的框（海報左邊）：右下角不能進 HUD（海報正放時大約 x ≥ 1160、y ≥ 800 會落在 QR 區）。 */
const HEAD = { x: 80, y: 150, w: 680, h: 440 };
const LYR = { x: 80, w: 680 };
/** 太陽：圓心就在海平線上（半顆），光芒只往上放射、停在上緣的小字下面。 */
const SUN = { x: 1080, y: 600, r: 250 };
/** 海浪：太陽底下（右下角 HUD 前面就停）。 */
const WAVE = { x0: 640, x1: 1440, y0: 600, y1: 780 };
/** 全景時海報在畫面上的縮放（頁面 px → 螢幕 px），留言字級照 v2 換算。 */
const K = 0.96;
const FAM = F.hei(900);
const FAM_SMALL = F.hei(700);

const POSTER = () => new FSPass(/* glsl */ `
  ${GRAIN_GLSL}
  uniform sampler2D art; uniform sampler2D lay; uniform vec2 size; uniform float t;
  uniform vec2 o1; uniform vec2 o2; uniform float r1; uniform float r2; uniform float w1; uniform float w2;
  uniform float sqY; uniform float sqOn;
  uniform float rayRot; uniform float breathe; uniform float wavePh; uniform float r3; uniform float w3;
  uniform vec3 sun;
  // 旋轉 15° 的網點（cell px）：tone 0..1 → 圓點的半徑
  float halftone(vec2 p, float tone) {
    vec2 q = rot2(0.2618) * p / 13.0;
    vec2 f = fract(q) - 0.5;
    float r = sqrt(clamp(tone, 0.0, 1.0)) * 0.62;
    float d = length(f) - r;
    float aa = fwidth(q.x) * 0.9;
    return (1.0 - smoothstep(-aa, aa, d)) * step(0.02, tone);
  }
  vec4 artAt(vec2 p) { vec2 u = p / size; return (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0) ? vec4(0.0) : texture(art, u); }
  vec4 layAt(vec2 p) { vec2 u = p / size; return (u.x < 0.0 || u.y < 0.0 || u.x > 1.0 || u.y > 1.0) ? vec4(0.0) : fastLayer(texture(lay, vec2(u.x, 1.0 - u.y))); }
  // 刮刀刮過的範圍：y < r（邊緣一點點網布的鋸齒）
  float pulled(vec2 p, float r) { return smoothstep(r + 3.0, r - 3.0, p.y + 2.5 * snoise(vec2(p.x / 9.0, r * 0.01))); }
  void main() {
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * size;
    vec4 gr = paperGrain(p * 1.6);
    vec3 pap = mix(C_PAPER, C_BONE, 0.5) * (0.965 + 0.03 * gr.b + 0.02 * (gr.r - 0.5));
    // 版一：訊號色（在紙上要飽和一點：紙色 ×（訊號色 / 紙色）^2.2）
    vec3 c1 = pap * pow(clamp(C_SIGNAL / pap, vec3(0.004), vec3(1.0)), vec3(2.2));
    c1 = mix(c1, C_BLOOD, 0.12);
    vec3 c2 = mix(C_SEPIA, C_INK, 0.35);
    vec3 c3 = C_ROSE;
    vec3 c4 = pap * pow(clamp(mix(C_BLOOD, C_SIGNAL, 0.25) / pap, vec3(0.004), vec3(1.0)), vec3(1.3));
    vec2 q1 = p - o1, q2 = p - o2;
    vec4 a1 = artAt(q1), a2 = artAt(q2);
    vec4 l1 = layAt(q1), l2 = layAt(q2);
    // 光芒：太陽外面一圈放射的楔形（網點），每一拍轉半格；太陽本身的網點跟著低音呼吸
    vec2 dv = q1 - sun.xy;
    float rr = length(dv), an = atan(dv.y, dv.x);
    float wedge = smoothstep(0.34, 0.3, abs(fract(an / 6.2832 * 18.0 + rayRot) - 0.5));
    float rayT = wedge * smoothstep(sun.z + 40.0, sun.z + 60.0, rr) * (1.0 - smoothstep(sun.z + 110.0, sun.z + 165.0, rr)) * 0.55;
    // 光芒只在海平線上面（往下就是海）、不伸進左邊的留言與歌詞
    rayT *= smoothstep(0.0, -24.0, dv.y) * smoothstep(760.0, 840.0, q1.x);
    float sunT = a1.r * (0.85 + 0.3 * breathe);
    float k1 = max(max(a1.g, halftone(q1, max(sunT, rayT))), l1.g) * pulled(p, r1);
    // 海浪：一條一條起伏的網點橫帶（暗部色），每個小節線往前推一格；遠的（上面）細、近的（下面）粗
    float wy = (q1.y - ${WAVE.y0}.0) / ${WAVE.y1 - WAVE.y0}.0;
    float inW = step(0.0, wy) * step(wy, 1.0) * smoothstep(${WAVE.x0}.0, ${WAVE.x0 + 140}.0, q1.x) * (1.0 - smoothstep(${WAVE.x1 - 140}.0, ${WAVE.x1}.0, q1.x));
    float band = q1.y + 9.0 * (0.4 + wy) * sin(q1.x / (40.0 + 50.0 * wy) + wavePh * 1.7 + q1.y * 0.05);
    float per = mix(14.0, 30.0, wy);
    float stripe = smoothstep(0.52, 0.42, abs(fract(band / per) - 0.5) * 2.0);
    float k4 = halftone(q1, stripe * inW * mix(0.45, 0.85, wy)) * pulled(p, r1);
    // 太陽在海面上的倒影：正下方一條訊號色的碎浪（越遠越窄）
    float refl = exp(-pow((q1.x - sun.x) / mix(90.0, 170.0, wy), 2.0)) * stripe * inW;
    k1 = max(k1, halftone(q1 + 6.5, refl * 0.75) * pulled(p, r1));
    k4 *= 1.0 - 0.8 * smoothstep(0.2, 0.6, refl);
    float k2 = max(a2.b, l2.b) * pulled(p, r2);
    float k3 = max(a2.a, l2.r) * pulled(p, r2);
    // 網布的細紋與油墨的厚薄
    float mesh = 0.96 + 0.04 * sin(p.x * 2.1) * sin(p.y * 2.1);
    float uneven = 0.93 + 0.07 * snoise(p / 140.0) + 0.03 * gr.r;
    vec3 col = pap;
    col *= mix(vec3(1.0), c1 / pap, k1 * mesh * uneven);
    col *= mix(vec3(1.0), c4 / pap, k4 * mesh * uneven);
    col *= mix(vec3(1.0), c3 / pap, k3 * mesh * uneven);
    col *= mix(vec3(1.0), c2 / pap, k2 * mesh * (0.97 + 0.03 * uneven));
    // 剛刮上去的墨是濕的：刮刀後面一段有反光（半秒內乾掉）
    float wet = max((k1 + k4) * w1 * smoothstep(r1 - 260.0, r1, p.y), (k2 + k3) * w2 * smoothstep(r2 - 260.0, r2, p.y));
    // 補墨的那一刀：濕的反光從上往下掃過印好的地方
    wet = max(wet, clamp(k1 + k2 + k3 + k4, 0.0, 1.0) * w3 * exp(-pow((p.y - r3) / 140.0, 2.0)));
    col += C_BONE * 0.12 * wet * smoothstep(0.3, 0.8, snoise(p / vec2(90.0, 18.0)) * 0.5 + 0.5);
    // 刮刀的影子（刮刀在紙上方一點點、光從左上來：影子落在它下面）
    float sd = p.y - sqY;
    col *= 1.0 - sqOn * 0.32 * smoothstep(-6.0, 10.0, sd) * (1.0 - smoothstep(20.0, 90.0, sd));
    fragColor = vec4(col, 1.0);
  }`, {
  grainTex: { value: null }, art: { value: null }, lay: { value: null }, size: { value: new THREE.Vector2(PW, PH) }, t: { value: 0 },
  o1: { value: new THREE.Vector2() }, o2: { value: new THREE.Vector2() }, r1: { value: -99 }, r2: { value: -99 }, w1: { value: 0 }, w2: { value: 0 },
  sqY: { value: -999 }, sqOn: { value: 0 },
  rayRot: { value: 0 }, breathe: { value: 0 }, wavePh: { value: 0 }, r3: { value: -999 }, w3: { value: 0 },
  sun: { value: new THREE.Vector3(SUN.x, SUN.y, SUN.r) },
});

function makeRig() {
  const rt = makeRT(PW * RES, PH * RES, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const st = new Stage(0, 30);
  st.U.ambient.value = 0.8;
  const mDoc = st.docMaterial(rt.texture, [rt.width, rt.height], [PW, PH], { radius: 2, edge: 1 });
  const doc = st.docMesh(mDoc, PW, PH, 0, 0, 1);
  // 對位用的紙膠帶（三小片，壓著海報的角）
  const tapeM = st.solidMaterial('mix(C_PAPER, C_ASH, 0.35) * (0.92 + 0.08 * detail * snoise(p / 6.0))', { depthTest: false });
  const tapes = [[-PW / 2 + 10, PH / 2 - 10, 0.7], [PW / 2 - 14, PH / 2 - 6, -0.6], [-PW / 2 + 8, -PH / 2 + 12, -0.75]].map(([x, y, r]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(130, 38), tapeM);
    m.position.set(x!, y!, 3); m.rotation.z = r!; m.frustumCulled = false;
    st.scene.add(m);
    return m;
  });
  // 刮刀：鋁的握把＋黑色橡膠刀片（一個方塊，上面亮、側面暗）
  const sqM = st.solidMaterial('mix(C_INK2 * 1.4, mix(C_GRAPHITE, C_ASH, 0.5), smoothstep(0.6, 0.95, n.z) * 0.8) * (0.9 + 0.1 * snoise(p / vec2(200.0, 4.0)))');
  const squeegee = new THREE.Mesh(new THREE.BoxGeometry(PW + 160, 34, 90), sqM);
  squeegee.frustumCulled = false;
  st.scene.add(squeegee);
  return { rt, st, mDoc, doc, tapes, squeegee };
}

export default class Poster extends Scene {
  pass = shared('poster.pass', POSTER);
  rig = shared('poster.rig', makeRig);
  /** 會變的字（歌詞、沒有留言時的大標），海報座標。 */
  lay = this.track(new Layer2D(PW, PH, undefined, { fast: true }));
  art: THREE.DataTexture | null = null;
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 53 + (this.msg?.id ?? 0) * 7) >>> 0;
  g!: Grid;
  block: Block | null = null;
  /** 兩刀：刮完（落在拍點）的時間與長度；之後每兩小節補墨一刀（刮完的時間）。 */
  p1 = 0; p2 = 0; dur = 0.45;
  floods: number[] = [];
  lyrSize = 48;
  lyrY = 700;
  hasLyrics = false;
  avoid: Rect[] = [];
  names = COUPLE_ZH;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    await loadAll(this.ctx, `LIVE婚禮現場${this.names}${DATE_DOTS}`);
    const g = (this.g = grid(au, s, e));
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.dur = clamp(g.beat * 0.85, 0.3, 0.5);
    // 第一刀落在第一個夠遠的拍點；第二刀落在之後的第一個小節線（太遠就兩拍後）
    this.p1 = au.timeOfBeat(Math.ceil(au.beatAt(s + this.dur + 0.05) - 1e-6));
    let p2 = g.bars.find((b) => b >= this.p1 + g.beat * 0.9) ?? Infinity;
    if (p2 > this.p1 + g.beat * 4.1 || p2 > s + 0.45 * (e - s)) p2 = au.timeOfBeat(au.beatAt(this.p1) + 2);
    this.p2 = p2;
    // 補墨：第二刀之後，每兩小節的小節線刮完一刀（窗格最後一小節不刮，留時間讀）
    for (const b of g.bars) if (b > p2 + g.bar * 1.5 && b < e - g.bar * 0.8 && Math.round((b - p2) / g.bar) % 2 === 0) this.floods.push(b);
    this.buildArt();
    this.avoid = [[HEAD.x, HEAD.y, HEAD.w, HEAD.h], [LYR.x, this.lyrY - this.lyrSize * 2.3, LYR.w, this.lyrSize * 2.6]];
  }

  /** 分色的遮罩（只畫一次）：R = 訊號色網點的濃淡、G = 訊號色實地、B = 深墨、A = 玫瑰（愛心）。 */
  private buildArt() {
    const m = this.msg;
    const mk = () => {
      const cv = document.createElement('canvas');
      cv.width = PW; cv.height = PH;
      const c = cv.getContext('2d', { willReadFrequently: true })!;
      c.textBaseline = 'alphabetic';
      c.fillStyle = '#fff'; c.strokeStyle = '#fff';
      return { cv, c };
    };
    const tone = mk(), c1 = mk(), c2 = mk(), c3 = mk();
    // 太陽：網點由中心（濃）往外（淡），右下被裁掉一點（出血）
    const gr = tone.c.createRadialGradient(SUN.x - 60, SUN.y - 50, 0, SUN.x, SUN.y, SUN.r);
    gr.addColorStop(0, 'rgba(255,255,255,0.92)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0.08)');
    tone.c.fillStyle = gr;
    // 只有海平線上面的半顆（下半顆沉在海裡）
    tone.c.beginPath(); tone.c.arc(SUN.x, SUN.y, SUN.r, Math.PI, Math.PI * 2); tone.c.fill();
    // 訊號色實地：兩圈細線、下緣的粗線
    c1.c.lineWidth = 4; c1.c.beginPath(); c1.c.arc(SUN.x, SUN.y, SUN.r + 30, Math.PI * 1.08, Math.PI * 1.92); c1.c.stroke();
    c1.c.lineWidth = 2; c1.c.beginPath(); c1.c.arc(SUN.x, SUN.y, SUN.r + 52, Math.PI * 1.12, Math.PI * 1.88); c1.c.stroke();
    c1.c.fillRect(LYR.x, 812, HEAD.w, 10);
    // 深墨：上緣的小字與細線
    const small = (c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, align: CanvasTextAlign = 'left', fam = FAM_SMALL) => {
      c.font = font(fam, size); c.letterSpacing = '6px'; c.textAlign = align; c.fillText(text, x, y); c.letterSpacing = '0px'; c.textAlign = 'left';
    };
    small(c2.c, m?.couple ? 'FROM THE COUPLE · 新人' : 'LIVE · 婚禮現場', HEAD.x, 92, 22);
    small(c2.c, `${m ? `No.${String(m.n).padStart(3, '0')}   ` : ''}${DATE_DOTS}`, PW - HEAD.x, 92, 20, 'right', F.mono(500));
    c2.c.fillRect(HEAD.x, 112, PW - HEAD.x * 2, 3);
    const heads: TGlyph[] = [];
    if (m) {
      const b = (this.block = block(c2.c, m, FAM, HEAD, { align: 'left', sigFamily: FAM_SMALL, lineHeight: 1.22, maxLines: 6, valign: 0.3, v2: K }));
      const groups: TGroup[] = [];
      for (const ln of b.lines) groupLine(ln.text, ln.x, ln.y, FAM, b.fit.size, 99, 0, heads, groups);
      c2.c.font = font(FAM_SMALL, b.sig.size); c2.c.fillText(b.sig.text, HEAD.x, b.sig.y);
      this.lyrSize = lyricV2(b.fit.size * K) / K;
      // 歌詞印在海報下緣、粗線上面（下緣對齊，兩行時往上長）
      this.lyrY = 772;
    } else if (!this.hasLyrics) {
      // 純音樂又沒有留言：印新人的名字（60 px，兩行），下面一行邀請
      const [a, bb] = this.names.split(/\s*&\s*/);
      const groups: TGroup[] = [];
      const sz = V2.msgMax / K;
      groupLine(a ?? this.names, HEAD.x, 330, FAM, sz, 99, 0, heads, groups);
      groupLine(`& ${bb ?? ''}`, HEAD.x, 330 + sz * 1.25, FAM, sz, 99, 0, heads, groups);
      small(c2.c, T21_INVITE, LYR.x, 560, 22);
    }
    for (const gl of heads) glyphPath(gl.ch === '♥' ? c3.c : c2.c, gl);
    const px = (x: { c: CanvasRenderingContext2D }) => x.c.getImageData(0, 0, PW, PH).data;
    const R = px(tone), G = px(c1), B = px(c2), A = px(c3);
    const out = new Uint8Array(PW * PH * 4);
    for (let i = 0; i < out.length; i += 4) { out[i] = R[i + 3]!; out[i + 1] = G[i + 3]!; out[i + 2] = B[i + 3]!; out[i + 3] = A[i + 3]!; }
    const tex = new THREE.DataTexture(out, PW, PH, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    this.art = this.track(tex);
  }

  /** 第 k 刀的進度：刮完的時間 tEnd，刮 dur 秒（inOutCubic）。回傳刮到的 y（海報座標）。 */
  private pullY(t: number, tEnd: number) {
    const k = clamp((t - (tEnd - this.dur)) / this.dur);
    return { y: -60 + (PH + 120) * ease.inOutCubic(k), k };
  }

  private shoot(t: number) {
    const st = this.rig.st, s = this.ctx.start, e = this.ctx.end;
    const D = camDist(30);
    const side = hash(this.seed, 3) < 0.5 ? -1 : 1;
    let T: V3, dist: number, tilt: number, yaw: number;
    if (t < this.p2) {
      // 刮墨的近景：斜斜地看著海報上半部，跟著刮刀往下一點
      const pk = t < this.p1 ? this.pullY(t, this.p1).y : this.pullY(t, this.p2).y;
      const drift = prog(t, s, this.p2);
      // 近景也不要把下緣的歌詞放得太大（v2：歌詞 ≤ 52 px）、不要切到左緣的字：比原本退後一點、少偏一點
      T = [side * 30, PH / 2 - 380 - 0.12 * clamp(pk, 0, PH), 0];
      dist = D * (1.0 - 0.04 * drift);
      tilt = THREE.MathUtils.degToRad(38);
      yaw = side * (0.12 - 0.04 * drift);
    } else {
      // 第二刀刮完：切到比較正的全景，慢慢推近；每個小節線往前衝一下
      const p = prog(t, this.p2, e, ease.inOutQuad);
      const bar = this.ctx.audio.barAt(t), bp = bar - Math.floor(bar);
      const punch = t - this.p2 > this.g.bar * 0.9 ? 0.02 * Math.exp(-bp * 6) : 0;
      T = [side * 10 * (1 - p), -12, 0];
      dist = D * (1.04 - 0.025 * p - punch);
      tilt = THREE.MathUtils.degToRad(13 - 3 * p);
      yaw = side * 0.035 * (1 - p);
    }
    st.look([T[0] + Math.sin(yaw) * dist, T[1] - Math.sin(tilt) * dist, Math.cos(tilt) * dist], T);
    // 對焦：刮墨時對著太陽（圖先出來），第二刀之後移到留言
    const fk = ease.inOutCubic(prog(t, this.p2 - 0.2, this.p2 + 1.2));
    st.U.focus.value = lerp(st.depthOf([SUN.x - PW / 2, PH / 2 - SUN.y, 0]), st.depthOf([HEAD.x + HEAD.w / 2 - PW / 2, PH / 2 - (HEAD.y + HEAD.h / 2), 0]), fk);
    st.U.aperture.value = t < this.p2 ? 26 : 14;
    st.U.pool.value.set(-220, 180, 1500, 0.55);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, audio: au, song } = this.ctx;
    const t = f.t, R = this.rig;
    const u = this.pass.u;
    u.grainTex!.value = t21Grain(renderer);
    u.art!.value = this.art;
    u.t!.value = t;
    const a = this.pullY(t, this.p1), b = this.pullY(t, this.p2);
    u.r1!.value = t < this.p1 - this.dur ? -99 : a.y; u.r2!.value = t < this.p2 - this.dur ? -99 : b.y;
    u.w1!.value = 1 - clamp((t - this.p1) / 0.6); u.w2!.value = 1 - clamp((t - this.p2) / 0.6);
    // 套準：訊號色那一版平常偏 (3, -2) px；每個大鼓跳一下（方向每拍不一樣），很快彈回來
    const beat = Math.floor(au.beatAt(t));
    const kick = t > this.p2 ? pulse(t, au.timeOfBeat(beat), 0.07) : 0;
    const ang = hash(this.seed, beat) * Math.PI * 2;
    (u.o1!.value as THREE.Vector2).set(3 + Math.cos(ang) * 9 * kick, -2 + Math.sin(ang) * 9 * kick);
    (u.o2!.value as THREE.Vector2).set(0, 0);
    // 會動的印刷品：光芒一拍轉半格（outExpo，落在拍點）、太陽跟著低音呼吸、海浪每個小節線推一格
    const bt = au.beatAt(t), bi = Math.floor(bt);
    u.rayRot!.value = 0.5 * (bi + ease.outExpo(clamp((t - au.timeOfBeat(bi)) / 0.25)));
    u.breathe!.value = f.a.low;
    const br = au.barAt(t), bri = Math.floor(br);
    u.wavePh!.value = bri + ease.inOutCubic(clamp((t - au.timeOfBar(bri)) / Math.min(0.6, this.g.bar * 0.5)));
    // 刮刀：印的兩刀，或補墨的那一刀
    let cur = t < this.p1 + 0.1 ? a : b;
    let flood = -1;
    for (const tf of this.floods) { const fk = this.pullY(t, tf); if (fk.k > 0 && t < tf + 0.5) { flood = tf; if (fk.k < 1) cur = fk; } }
    const on = cur.k > 0 && cur.k < 1 ? 1 : 0;
    u.sqY!.value = cur.y; u.sqOn!.value = on;
    const fp = flood > 0 ? this.pullY(t, flood) : null;
    u.r3!.value = fp ? fp.y - 80 : -999; u.w3!.value = fp ? 1 - clamp((t - flood) / 0.5) : 0;

    // ---- 會變的字：G = 訊號色、B = 深墨、R = 玫瑰
    const L = this.lay; L.clear();
    const c = L.ctx;
    const ly = lyricAt(lyrics, t);
    if (this.msg) {
      if (ly) this.karaoke(c, layoutRows(c, ly.line, { family: FAM_SMALL, size: this.lyrSize, minSize: V2.lyrMin / K, maxW: LYR.w, maxRows: 2, align: 'left' }), t, LYR.x, this.lyrY, ly.k, true);
      else if (!this.hasLyrics) this.mono(c, `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, this.lyrY - 20);
    } else if (this.hasLyrics) {
      // 大標是歌詞：兩句之間留著上一句（海報不會突然變空白），下一句提早 0.35 秒換上
      const line = lyrics.shownLine(t, 1e4, 0.35) ?? lyrics.nextLine(t);
      if (line) {
        const lay = layoutRows(c, line, { family: FAM, size: V2.lyrMax / K, minSize: V2.lyrMin / K, maxW: HEAD.w, maxRows: 3, align: 'left', lineHeight: 1.2 });
        const y = HEAD.y + HEAD.h * 0.4 - (lay.height / 2) + lay.size * 0.85;
        this.karaoke(c, lay, t, HEAD.x, y, 1, false);
      }
      c.font = font(FAM_SMALL, 22); c.letterSpacing = '6px'; c.fillStyle = 'rgb(0,0,255)';
      c.fillText(T21_INVITE, LYR.x, 700); c.letterSpacing = '0px';
    }
    u.lay!.value = L.upload();
    this.pass.render(renderer, R.rt);

    // ---- 舞台
    const lastPull = flood > 0 ? flood : this.p2;
    R.squeegee.visible = on === 1 || (t > lastPull && t < lastPull + 0.35);
    // 刮完那一刀：刮刀抬起來、往下退出畫面
    const lift = t > lastPull ? ease.inCubic(clamp((t - lastPull) / 0.35)) : 0;
    R.squeegee.position.set(0, PH / 2 - cur.y - 17 - lift * 300, 46 + lift * 260);
    R.squeegee.rotation.x = -0.25;
    this.shoot(t);
    R.st.shadows([
      { x: 14, y: -18, w: PW, h: PH, blur: 18, k: 0.32, r: 3 },
      ...(R.squeegee.visible ? [{ x: 40, y: PH / 2 - cur.y - 70 - lift * 300, w: PW + 160, h: 60, blur: 24 + lift * 60, k: 0.35 * (1 - lift) }] : []),
    ]);
    R.st.render(renderer, out);
    const hit = Math.max(pulse(t, this.p1, 0.08), pulse(t, this.p2, 0.08), ...this.floods.map((x) => pulse(t, x, 0.08) * 0.5));
    return {
      paper: 1, bloom: 0.25, vignette: 0.4, grain: 0.045,
      shake: [0, hit * 5], zoom: 1 + 0.02 * hit,
      popupAvoid: this.avoid.map((r) => this.docRect(r)),
    };
  }

  /** 海報座標的矩形 → 螢幕上的外框。 */
  private docRect([x, y, w, h]: Rect): Rect {
    const st = this.rig.st;
    const ps = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => st.toScreen([px! - PW / 2, PH / 2 - py!, 1]));
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  }

  /** 跟唱（海報上的油墨）：還沒唱 = 淡的深墨、正在唱 = 訊號色、唱完 = 深墨；愛心是玫瑰。 */
  private karaoke(c: CanvasRenderingContext2D, lay: RowsLayout, t: number, x: number, y: number, alpha: number, bottom: boolean) {
    c.save();
    c.translate(x, bottom ? y - (lay.rows.length - 1) * lay.lineHeight : y);
    c.font = font(bottom ? FAM_SMALL : FAM, lay.size);
    c.textBaseline = 'alphabetic';
    c.globalAlpha = alpha;
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      const heart = pw.word.w === '♥';
      c.fillStyle = heart ? 'rgba(255,0,0,0.3)' : 'rgba(0,0,255,0.24)';
      if (p < 1) glyphPath(c, { ch: pw.word.w, x: pw.x, y: pw.y, w: pw.w, size: lay.size, family: bottom ? FAM_SMALL : FAM });
      if (p <= 0) continue;
      c.save();
      c.beginPath(); c.rect(pw.x - lay.size * 0.1, pw.y - lay.size * 1.1, (pw.w + lay.size * 0.2) * p, lay.size * 1.5); c.clip();
      c.fillStyle = heart ? 'rgb(255,0,0)' : p < 1 ? 'rgb(0,255,0)' : 'rgb(0,0,255)';
      glyphPath(c, { ch: pw.word.w, x: pw.x, y: pw.y, w: pw.w, size: lay.size, family: bottom ? FAM_SMALL : FAM });
      c.restore();
    }
    c.restore();
  }

  private mono(c: CanvasRenderingContext2D, text: string, x: number, y: number) {
    c.font = font(F.mono(500), 22); c.letterSpacing = '4px'; c.fillStyle = 'rgb(0,0,255)';
    c.fillText(text, x, y); c.letterSpacing = '0px';
  }
}

