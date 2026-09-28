// 祝福牆（照 pdoom dense 的「文字壓力」）：全部留言排成一整面暗暗的字牆，鏡頭推進去、停在主打留言上，
// 仙女棒的火花沿著它上方的細線跑過去，把字一個個點亮成訊號色、清清楚楚讀得到，然後拉開、換下一則（窗格長時停兩三則），
// 最後拉回整面牆。讀過的留言在牆上留著暖暖的餘溫。
//  - 牆（mosaic-wall.ts）在 init() 預先畫成一張資料貼圖；每一格只有一個全螢幕 shader 在上面移動鏡頭
//    （景深：推近時牆失焦、變暗；移動快時有動態模糊），點亮的那則另外用 Canvas2D 清晰地畫在上面。
//  - 停住的時候主打是「浮起來」的：它不動，後面失焦的牆慢慢漂（視差），畫面在長長的閱讀時間裡還是活的；
//    主打那一層不變就不重畫、不重新上傳（省下每格 2～4 ms）。
//  - 歌詞在畫面上方一條橫過牆的「帶子」上（牆從帶子底下滑過，照 pdoom dense 第五版的平塗帶），右邊是收到幾則祝福的計數器。
//  - 節拍：推進緩進小節線、落地那一拍點火；大鼓讓整面牆微微一亮、hi-hat 讓零星的格子閃一下，點火時一圈光從主打往外擴散。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, layout, loadText, type TextLayout } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, pulse, hash, lerp } from '../engine/util';
import { fitText, readSeconds } from '../engine/text';
import { sparkHead, sparkParticles, lyricAt, drawLyric, layoutLyric, drawHeart, signature, type LyricStyle } from './_motifs';
import { layoutWall, drawWall, heroHeader, heroLabel, HERO_PAD, HERO_LABEL, HERO_SIG, HERO_RULE_Y, HERO_LABEL_SIZE, type HeroSpec, type WallLayout } from './mosaic-wall';
import { CamPath, constrain, worldToScreen, zoomOf, type View } from './mosaic-path';

/** 帶子（歌詞＋計數器）的上下緣（螢幕 px）；沒有歌詞時窄一點。帶子的字畫在一張只有這麼高的小圖層上。 */
const BAND = { y0: 110, y1: 278, y1Thin: 214 };
const BAND_LAYER = { y: 96, h: 196 }; // 蓋住 BAND 的 y0～y1（上下各留一點給字的下伸部）
/**
 * 計數器的右緣：放在 1340，不放在畫面最右邊——右上角是即時留言小卡的格子（x ≥ 1378），小卡是半透明的，
 * 疊在計數器上兩層字會打架。歌詞寬度跟著讓出計數器的位置。
 */
const COUNTER_R = 1340;
/**
 * 主打格子停下來時佔的螢幕範圍：字的左緣對齊 150（跟帶子上的歌詞同一條線），右緣到 1350 為止——
 * 右側 x ≥ 1378 是即時留言小卡的格子，留給它，新留言跳出來時就不會蓋到正在讀的主打；下緣留給右下角的 QR。
 */
const PARK = { x0: 150 - HERO_PAD, x1: 1350 + HERO_PAD, bottom: 884 };
/** 右下角 HUD（QR，x ≥ 1360、y ≥ 830）：簽名的基線低於 HUD_Y（字的下緣會進到 830 以下）時，右緣不能超過 HUD_X。 */
const HUD_X = 1340, HUD_Y = 816;
/** 點火的斜掃（x + SKEW·y 相同的點同時點燃）：火花在標頭細線上領頭，下面幾行跟在後面斜斜地燒過去。 */
const SKEW = 0.42;
/** 字從燒紅冷卻成訊號色要幾秒。 */
const COOL = 0.85;
const HERO_FAMILY = F.hand(700);
/** 景深的最大模糊半徑（螢幕 px）。 */
const MAX_BLUR = 6.5;
/** 停住時後面的牆漂多遠（螢幕 px）、放大多少。 */
const DRIFT_PX = 48, DRIFT_SCALE = 0.035;

const WALL_PASS = () => new FSPass(/* glsl */ `
  uniform sampler2D wall; uniform vec2 wsz; uniform float sTex;
  uniform vec4 camA; uniform vec4 camB;
  uniform vec4 par;     // 視差：以 (x, y) 為中心縮放 z 倍，再平移 w…（見 parD）
  uniform vec2 parD;
  uniform vec4 scr; uniform float scrK;
  uniform float blur, t, kick, hat, lum, spot;
  uniform vec4 band;
  uniform vec4 hr0; uniform vec4 hr1; uniform vec4 hr2;
  uniform vec4 hs0; uniform vec4 hs1; uniform vec4 hs2;
  uniform vec4 rip;
  const vec2 POIS[8] = vec2[8](vec2(-0.613, 0.354), vec2(0.170, -0.932), vec2(0.866, 0.414), vec2(-0.297, -0.391),
                               vec2(0.414, 0.230), vec2(-0.925, -0.270), vec2(0.058, 0.721), vec2(0.642, -0.520));
  // 螢幕 px（y 向下）→ 牆 px：p = c + R(−r)·(s − 中心)/zoom，再套視差
  vec2 toWall(vec2 sp, vec4 c) {
    vec2 d = (sp - vec2(${W / 2}.0, ${H / 2}.0)) * (c.z / ${W}.0);
    float cs = cos(c.w), sn = sin(c.w);
    vec2 w = c.xy + vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
    return par.xy + (w - par.xy) / par.z - parD;
  }
  vec2 uvOf(vec2 w) { return vec2(w.x / wsz.x, 1.0 - w.y / wsz.y); }
  // 主打格子：已經點亮的部分把牆上的那份藏起來（點亮的那份清晰地畫在上面），讀過的留一點訊號色的餘溫
  vec2 heroMask(vec2 w, vec4 r, vec4 s) {
    vec2 q = w - r.xy;
    float inside = step(0.0, q.x) * step(0.0, q.y) * step(q.x, r.z) * step(q.y, r.w);
    float u = q.x + s.w * q.y;
    float hide = s.y * (1.0 - smoothstep(s.x - 3.0, s.x + 3.0, u));
    return vec2(hide, s.z) * inside;
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 wA = toWall(sp, camA), wB = toWall(sp, camB);
    float zoom = ${W}.0 / camA.z;
    vec4 d;
    float mb = length(wA - wB) * zoom;
    if (blur < 0.3 && mb < 0.75) d = texture(wall, uvOf(wA));
    else {
      // 景深（圓盤）＋動態模糊（沿鏡頭移動方向）一起取 8 點；取樣用較低的 mip，點與點之間才不會有重影
      float texPerPx = sTex / zoom;
      float lod = max(log2(max(texPerPx, 1e-3)), log2(max(blur * texPerPx * 0.9, 1e-3)));
      d = vec4(0.0);
      for (int i = 0; i < 8; i++) {
        vec2 w = mix(wB, wA, (float(i) + 0.5) / 8.0) + POIS[i] * blur / zoom;
        d += textureLod(wall, uvOf(w), lod);
      }
      d *= 0.125;
    }
    // 每一格的明暗（G = 格子代號）：用畫面這一點自己的格子（mip 0，不用模糊後混到的代號）。
    // 大部分的格子暗暗的，少數亮一點——牆是一整片暗的字，不是一格格的看板
    vec4 cc = textureLod(wall, uvOf(wA), 0.0);
    float id = floor(cc.g * 255.0 + 0.5);
    float hsh = fract(sin(id * 12.9898 + 4.1) * 43758.5453);
    float tone = 0.07 + 0.19 * hsh * hsh + 0.16 * step(0.9, hsh);
    tone *= 1.0 + 0.2 * kick;
    // hi-hat：零星的格子亮一下（像有人正在寫）
    tone += 0.26 * hat * step(0.955, hash12(vec2(id, floor(t * 7.0))));
    // 點火時從主打往外擴散的一圈光
    float front = rip.z * 1700.0;
    tone += rip.w * exp(-pow((length(wA - rip.xy) - front) / 150.0, 2.0)) * exp(-rip.z * 1.4);
    // 愛心：有字、代號 0（見 mosaic-wall.ts）→ 點綴色
    float heart = step(id, 0.5) * smoothstep(0.1, 0.5, cc.r);
    vec2 m0 = heroMask(wA, hr0, hs0), m1 = heroMask(wA, hr1, hs1), m2 = heroMask(wA, hr2, hs2);
    float hide = max(m0.x, max(m1.x, m2.x)), trace = max(m0.y, max(m1.y, m2.y));
    float inWall = step(0.0, wA.x) * step(0.0, wA.y) * step(wA.x, wsz.x) * step(wA.y, wsz.y);
    float txt = d.r * (1.0 - hide) * inWall;
    float rules = d.b * (1.0 - hide) * inWall;
    // 聚光：停在主打上時，整面牆暗下來
    float L = lum * (1.0 - 0.45 * spot);
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.5 + 0.5 * snoise(sp / 520.0 + vec2(t * 0.012, 0.0)));
    vec3 ink = mix(C_BONE, C_ROSE, heart);
    col = mix(col, ink, clamp(txt * max(tone + heart * 0.14, trace * 0.8) * L, 0.0, 1.0));
    col = mix(col, C_SIGNAL, clamp(txt * trace * (1.0 - heart) * 0.62 * L, 0.0, 1.0));
    col = mix(col, mix(C_GRAPHITE, C_ASH, 0.5), clamp(rules * 0.42 * L, 0.0, 1.0));
    // 浮起來的主打底下的一片暗（柔邊）：後面的牆漂開了，字底下還是乾淨的
    vec2 sc = (scr.xy + scr.zw) * 0.5, sh = (scr.zw - scr.xy) * 0.5;
    col = mix(col, C_INK, scrK * (1.0 - smoothstep(-24.0, 56.0, sdBox(sp - sc, sh))));
    // 帶子：牆從底下滑過（平塗的底色，牆只透出一點點），上下兩條細線；大鼓時下緣亮一下
    float bc = (band.x + band.y) * 0.5;
    float y0 = mix(bc, band.x, band.z), y1 = mix(bc, band.y, band.z);
    float inBand = step(y0, sp.y) * step(sp.y, y1) * step(0.001, band.z);
    col = mix(col, C_INK + (col - C_INK) * 0.04, inBand * 0.97);
    col += C_BONE * 0.2 * (pxLine(abs(sp.y - y0), 0.35, 1.2) + pxLine(abs(sp.y - y1), 0.35, 1.2)) * step(0.001, band.z);
    col += C_SIGNAL * band.w * pxLine(abs(sp.y - y1), 0.4, 1.4) * step(0.001, band.z);
    fragColor = vec4(col, 1.0);
  }`, {
  wall: { value: null }, wsz: { value: new THREE.Vector2(1, 1) }, sTex: { value: 1 },
  camA: { value: new THREE.Vector4() }, camB: { value: new THREE.Vector4() },
  par: { value: new THREE.Vector4(0, 0, 1, 0) }, parD: { value: new THREE.Vector2() },
  scr: { value: new THREE.Vector4() }, scrK: { value: 0 },
  blur: { value: 0 }, t: { value: 0 }, kick: { value: 0 }, hat: { value: 0 }, lum: { value: 1 }, spot: { value: 0 },
  band: { value: new THREE.Vector4() },
  hr0: { value: new THREE.Vector4() }, hr1: { value: new THREE.Vector4() }, hr2: { value: new THREE.Vector4() },
  hs0: { value: new THREE.Vector4() }, hs1: { value: new THREE.Vector4() }, hs2: { value: new THREE.Vector4() },
  rip: { value: new THREE.Vector4() },
});

/**
 * 把主打（畫在它自己格子大小的圖層上，停住時的螢幕尺寸）照鏡頭的仿射變換貼到畫面上。
 * 為什麼不直接畫在全螢幕圖層：鏡頭在動、主打在淡出時，只要改這裡的矩陣與透明度，圖層不用重畫、不用重新上傳
 * （會場筆電上，一張全螢幕 Canvas 上傳就要好幾毫秒）。`add`：加亮疊上去（燒紅的字發光）。
 */
const HERO_PASS = (add: boolean) => () => {
  const p = new FSPass(/* glsl */ `
    uniform sampler2D tex; uniform vec3 ax; uniform vec3 ay; uniform vec2 size; uniform float opacity; uniform float tint;
    void main() {
      vec3 sp = vec3(FRAG_PX.x, ${H}.0 - FRAG_PX.y, 1.0);
      vec2 lp = vec2(dot(ax, sp), dot(ay, sp));
      vec2 uv = vec2(lp.x / size.x, 1.0 - lp.y / size.y);
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
      vec4 c = texture(tex, uv);
      fragColor = vec4(c.rgb * c.a * tint, c.a) * opacity;
    }`, { tex: { value: null }, ax: { value: new THREE.Vector3() }, ay: { value: new THREE.Vector3() }, size: { value: new THREE.Vector2(1, 1) }, opacity: { value: 1 }, tint: { value: 1 } },
  { blending: THREE.CustomBlending, transparent: true });
  const m = p.mat;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = add ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = add ? THREE.ZeroFactor : THREE.OneFactor; m.blendDstAlpha = add ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  return p;
};

/** 一次「停」：推進、落地點火、停著讀、放開。時間都在拍點上。 */
interface Park {
  spec: HeroSpec;
  /** 每一行的字（停住時的螢幕尺寸、格子左上角為原點）。 */
  lines: { lay: TextLayout; x: number; y: number }[];
  tPush: number; tLand: number; tIgn0: number; tIgn1: number; tRel: number; tOff: number;
  /** 放開後鏡頭移開要多久（視差在這段時間收回來）。 */
  tAway: number;
  /** 斜掃從 u0 掃到 u1（格子座標 x + SKEW·y）。 */
  u0: number; u1: number;
  view: View;
  /** 停住時格子在螢幕上的範圍（字底下那片暗用）。 */
  scr: [number, number, number, number];
  /** 停住時重要的字（標頭、留言、簽名）在螢幕上的範圍 [x, y, w, h]：給即時小卡避開。 */
  textRect: [number, number, number, number];
  /** 停住時後面的牆往哪裡漂（牆 px）。 */
  drift: [number, number];
  sigY: number; sigX: number;
}

export default class Mosaic extends Scene {
  /** 點亮的主打（清晰的字，格子座標、停住時的螢幕尺寸）：只有點火、簽名淡入時重畫，其他時候只改貼上去的矩陣。 */
  heroL!: Layer2D;
  /** 燒紅的字另外畫一層加亮疊上去才會發光（低解析度就夠，只在點火時用）。 */
  hot!: Layer2D;
  /** 帶子上的歌詞與計數器：每格都變，所以放在一張只有帶子那麼高的小圖層。 */
  bandL = this.track(new Layer2D(W, BAND_LAYER.h));
  heroPass = shared('mosaic.hero', HERO_PASS(false));
  hotPass = shared('mosaic.heroHot', HERO_PASS(true));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  pass = shared('mosaic.wall', WALL_PASS);
  canvas = document.createElement('canvas');
  tex: THREE.CanvasTexture | null = null;
  wall!: WallLayout;
  path!: CamPath;
  parks: Park[] = [];
  msgs: Msg[] = [];
  total = 0;
  sTex = 1;
  zWide = 1;
  hasBand = false;
  bandY1 = BAND.y1;
  /**
   * 即時留言小卡要避開的範圍：帶子（歌詞＋計數器）與每一則主打停住時的字。小卡一出現就停好幾秒，
   * 所以整個窗格都回傳同一組（開場全景時跳出來的小卡，也不會蓋到等一下才推進去的主打）。
   */
  avoid: [number, number, number, number][] = [];
  /** 主打圖層上一次畫的狀態（一樣就沿用上一張貼圖）。 */
  private heroSig = '';
  private hotSig = '';
  /**
   * 點亮後（冷卻完）的字色：訊號色壓暗一點點，剛好在 bloom 門檻下——點火那一下燒紅、發光，
   * 之後讀的時候是銳利的訊號色字，不帶光暈（「不描邊、不加光暈的字」）。每格照目前的主題算。
   */
  lit = '';
  /** 歌詞從 x = 150 到計數器前面（計數器約 200 寬，中間留 40）。 */
  lyricStyle: LyricStyle = { family: F.archivo(87.5, 800), size: 84, minSize: 50, maxWidth: COUNTER_R - 150 - 240 };

  override async init() {
    const { params, audio: au, lyrics, live } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const seed = (params.seed ?? 1) | 0;
    // 全部留言。params.repeat 只給開發測試用（假留言只有 18 則，複製幾份模擬 300 則的現場），正式播放不會帶這個參數
    const base: Msg[] = (params.messages ?? []).slice();
    const hero0: Msg | null = params.message ?? null;
    if (hero0 && !base.some((m) => m.id === hero0.id)) base.push(hero0);
    const rep = Math.max(1, Math.min(20, (params.repeat as number) | 0 || 1));
    this.msgs = rep === 1 ? base : Array.from({ length: rep }, (_, k) => base.map((m) => (k === 0 ? m : { ...m, id: m.id + 100000 * k, n: m.n + base.length * k }))).flat();
    this.total = Math.max(live.count, this.msgs.length);
    await loadText('已收到則祝福牆一位賓客');

    this.hasBand = lyrics.linesIn(s - 0.5, e + 0.5).length > 0;
    this.bandY1 = this.hasBand ? BAND.y1 : BAND.y1Thin;
    const parkTop = this.bandY1 + 34;
    // 帶子上的字（歌詞與計數器）都在 x < 1360：右上、右中兩格一直是空的，同時跳兩張小卡也不會蓋到歌詞、計數器或主打
    this.avoid = [[96, BAND.y0 - 6, COUNTER_R + 20 - 96, this.bandY1 - BAND.y0 + 12]];

    // ---- 節拍單位。很短的窗格（不到三小節）推進與拉開都縮成最短，讓主打多停一點
    const B = clamp(au.beatPeriod(s + 0.05), 0.28, 1.4);
    const bAt = (t: number) => au.beatAt(t), tOf = (b: number) => au.timeOfBeat(b);
    const isDown = (b: number) => { const x = au.barAt(tOf(b)); return Math.abs(x - Math.round(x)) < 0.06; };
    const b0 = Math.ceil(bAt(s) - 0.08), bE = Math.floor(bAt(e) + 0.08), NB = Math.max(2, bE - b0);
    const short = NB < 12;
    const pushB = short ? 2 : clamp(Math.round(1.25 / B), 2, 4), travelB = pushB + 1;
    let outB = short ? 1 : clamp(Math.round(1.1 / B), 2, 4);

    // ---- 要停幾則：主打一定有；窗格夠長再從全部留言裡挑短一點的（讀得完），最多三則
    const first = hero0 ?? (this.msgs.length ? this.msgs[Math.floor(hash(seed, 3) * this.msgs.length)]! : null);
    const pool = this.msgs.filter((m) => m.id !== first?.id && Array.from(m.text).length <= 36 && m.id < 100000)
      .map((m) => ({ m, k: hash(seed, m.id, 11) })).sort((a, b) => a.k - b.k).map((x) => x.m);
    const heroesMsgs: Msg[] = first ? [first] : [];
    const holdOf = (m: Msg) => readSeconds(m.text) + 0.5;
    const need = (ms: Msg[]) => B * (1 + pushB + (ms.length - 1) * travelB + outB + 2) + ms.reduce((a, m) => a + holdOf(m), 0);
    for (const m of pool) {
      if (heroesMsgs.length >= 3) break;
      if (need([...heroesMsgs, m]) <= e - s) heroesMsgs.push(m);
    }

    // ---- 主打格子：先照「停住時」的螢幕尺寸排好，再縮小放進牆裡
    const c = this.bandL.ctx;
    const boxW = PARK.x1 - PARK.x0 - 2 * HERO_PAD, boxH = PARK.bottom - parkTop - 2 * HERO_PAD - HERO_LABEL - HERO_SIG;
    // 留言越多牆越密，停的時候推得越近（主打格子在牆上才不會比其他格子大太多）
    const zBase = clamp(2.9 * Math.pow(Math.max(1, this.msgs.length) / 18, 0.2), 2.8, 4.4);
    const anchors = heroesMsgs.length === 1 ? [[0.42, 0.5]] : heroesMsgs.length === 2 ? [[0.3, 0.42], [0.68, 0.62]] : [[0.26, 0.36], [0.7, 0.3], [0.44, 0.72]];
    const specs: HeroSpec[] = heroesMsgs.map((m, i) => {
      const fit = fitText(c, m.text, HERO_FAMILY, boxW, boxH, { min: 52, max: 140, lineHeight: 1.3, maxLines: 4 });
      const textH = fit.size * 0.92 + (fit.lines.length - 1) * fit.lineHeight + fit.size * 0.28;
      const zoom = zBase * (0.92 + 0.16 * hash(seed, i, 5));
      const [ax, ay] = anchors[i]!;
      return {
        msg: m, fit, family: HERO_FAMILY, zoom,
        w: (Math.max(fit.width, 360) + 2 * HERO_PAD) / zoom, h: (2 * HERO_PAD + HERO_LABEL + textH + HERO_SIG) / zoom,
        x: 0, y: 0, ax: ax! + (hash(seed, i, 7) - 0.5) * 0.08, ay: ay! + (hash(seed, i, 8) - 0.5) * 0.1,
      };
    });
    this.wall = layoutWall(this.msgs, specs, seed);
    // 主打圖層：跟最大的主打格子一樣大（停住時的螢幕尺寸）
    const hw = Math.max(64, ...this.wall.heroes.map((h) => h.w * h.zoom)), hh = Math.max(64, ...this.wall.heroes.map((h) => h.h * h.zoom));
    this.heroL = this.track(new Layer2D(Math.ceil(hw), Math.ceil(hh)));
    this.hot = this.track(new Layer2D(Math.ceil(hw), Math.ceil(hh), 0.5));
    this.sTex = Math.min(SCALE, 4096 / this.wall.W, 4096 / this.wall.H);
    await drawWall(this.canvas, this.wall, this.msgs, this.sTex, seed);
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.NoColorSpace; // 資料，不是顏色：不要做 sRGB 轉換
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy());
    this.tex = tex;
    // 先上傳（不然第一格才上傳，會卡一下）
    this.ctx.renderer.initTexture(tex);

    // ---- 鏡頭與時間表（以拍為單位，落地盡量在小節線）
    const WW = this.wall.W, WH = this.wall.H;
    this.path = new CamPath(WW, WH);
    const rot0 = (hash(seed, 21) < 0.5 ? -1 : 1) * (0.028 + 0.02 * hash(seed, 22));
    const wide0 = constrain({ x: WW * (0.5 + (hash(seed, 23) - 0.5) * 0.08), y: WH * 0.5, w: WW * 2, r: rot0 }, WW, WH);
    const wideEnd = constrain({ x: WW * (0.5 + (hash(seed, 25) - 0.5) * 0.06), y: WH * 0.5, w: WW * 2, r: -rot0 * 0.7 }, WW, WH);
    this.zWide = zoomOf(wide0);
    const placed = this.wall.heroes;
    if (!placed.length) {
      // 沒有任何留言（理論上不會排到這個版面）：整面牆慢慢漂過去就好
      this.path.add(s, Math.max(e, s + 0.01), wide0, { ...wideEnd, w: wideEnd.w * 0.9 }, (x) => x, 0);
      return;
    }
    // 每一則停多久（拍）：讀得完為準；窗格太短就先縮停留（每則至少兩拍）、再縮拉開
    const holds = placed.map((h) => Math.ceil(holdOf(h.msg) / B));
    const fixed = () => pushB + (placed.length - 1) * travelB + outB;
    const sum = () => holds.reduce((a, x) => a + x, 0);
    while (fixed() + sum() > NB && holds.some((x) => x > 2)) holds[holds.indexOf(Math.max(...holds))]!--;
    if (fixed() + sum() > NB) outB = Math.max(1, NB - (fixed() - outB) - sum());
    let spare = NB - fixed() - sum();
    // 開場：窗格夠長就先停在整面牆上一兩拍（計數器跑完），讓第一次落地剛好在小節線
    let intro = spare >= 3 ? 1 : 0;
    for (let k = intro; k <= Math.min(intro + 4, spare); k++) if (isDown(b0 + k + pushB)) { intro = k; break; }
    spare -= intro;
    // 多的拍數：先給每則多停一點（最多多四分之一，停太久畫面會僵），剩下的留給最後拉開的整面牆
    for (let i = 0; i < holds.length; i++) {
      const add = Math.max(0, Math.min(Math.floor(spare / holds.length / 2), Math.ceil(holds[i]! * 0.25)));
      holds[i]! += add; spare -= add;
    }
    let b = b0 + intro;
    const drift0 = constrain({ ...wide0, x: wide0.x + WW * 0.02 * (hash(seed, 24) - 0.5), w: wide0.w * 0.97 }, WW, WH);
    this.path.add(s, tOf(b), wide0, drift0, (u) => u, 0);
    let v: View = drift0;
    this.parks = placed.map((h, i) => {
      const fit = h.fit;
      const lines = fit.lines.map((ln, li) => ({ lay: layout(ln, HERO_FAMILY, fit.size), x: HERO_PAD, y: HERO_PAD + HERO_LABEL + fit.size * 0.92 + li * fit.lineHeight }));
      const cellHs = h.h * h.zoom;
      // 停住時格子左上角在螢幕上的位置：靠左上（瑞士網格），緊貼在帶子下面——短的留言下方就空出來，
      // 左下、下方正中的即時小卡才有地方跳，不會蓋到正在讀的字
      const sx = PARK.x0, sy = parkTop + Math.min(24, Math.max(0, (PARK.bottom - parkTop - cellHs) / 2));
      const view = constrain({ x: h.x + (W / 2 - sx) / h.zoom, y: h.y + (H / 2 - sy) / h.zoom, w: W / h.zoom, r: 0 }, WW, WH);
      const moveB = i === 0 ? pushB : travelB;
      const tPush = tOf(b);
      let land = b + moveB;
      // 落地盡量在小節線（多的拍數夠用的話往後挪）
      for (let k = 0; k <= 3 && k <= spare; k++) if (isDown(land + k)) { land += k; spare -= k; break; }
      const tLand = tOf(land);
      const tIgn0 = tLand - (tLand - tPush) * 0.22;
      // 斜掃的範圍：火花從標頭細線的左端出發（u0），掃到最後一行的最後一個字、或細線的右端（u1）
      const hh = heroHeader(h);
      const u0 = hh.x0 + SKEW * HERO_RULE_Y;
      const lastY = lines[lines.length - 1]!.y;
      // 簽名靠右對齊留言的右緣；落在右下角 QR 的高度時往左收，不進 HUD。火花的斜掃最後也掃過它
      const sigY = lastY + fit.size * 0.28 + 58;
      const sigX = sy + sigY > HUD_Y ? Math.min(hh.right, HUD_X - sx) : hh.right;
      const u1 = Math.max(hh.x1 + SKEW * HERO_RULE_Y, sigX + SKEW * sigY, ...lines.map((l) => l.x + l.lay.width + SKEW * (l.y + 6)));
      const tIgn1 = tIgn0 + clamp(0.45 + (u1 - u0) / 2600, 0.6, 1.15);
      const rel = land + holds[i]!;
      const tRel = tOf(rel);
      this.path.add(tPush, tLand, v, view, i === 0 ? ease.inOutCubic : ease.inOutQuart, i === 0 ? 0.9 : 1.35);
      // 停著讀的時候鏡頭不動（主打那一層就不用重畫），動的是後面的牆（視差，見 render）
      this.path.add(tLand, tRel, view, view, (u) => u, 0);
      v = view;
      b = rel;
      const a = hash(seed, i, 31) * Math.PI * 2;
      const nextMove = (i < placed.length - 1 ? travelB : outB) * B;
      return {
        spec: h, lines, tPush, tLand, tIgn0, tIgn1, tRel, tOff: tRel + Math.min(B * 1.2, nextMove * 0.8), tAway: tRel + nextMove,
        u0, u1, view, scr: [sx, sy, sx + h.w * h.zoom, sy + cellHs] as [number, number, number, number],
        textRect: [sx + HERO_PAD - 8, sy + HERO_PAD - 8, Math.max(hh.right, sigX) - HERO_PAD + 16, sigY + 20 - HERO_PAD] as [number, number, number, number],
        drift: [(Math.cos(a) * DRIFT_PX) / h.zoom, (Math.sin(a) * DRIFT_PX * 0.6) / h.zoom] as [number, number], sigY, sigX,
      };
    });
    for (const p of this.parks) this.avoid.push(p.textRect);
    // 退場：拉回整面牆（換個角度），剩下的時間慢慢漂
    const tOut0 = tOf(b), tOut1 = Math.min(e, tOf(b + outB));
    this.path.add(tOut0, tOut1, v, { ...wideEnd, w: wideEnd.w * 0.94 }, outB <= 1 ? ease.inQuart : ease.inOutCubic, 1.1);
    this.path.add(tOut1, Math.max(e, tOut1 + 0.01), { ...wideEnd, w: wideEnd.w * 0.94 }, wideEnd, (u) => u, 0);
  }

  override dispose() {
    this.tex?.dispose();
    this.canvas.width = this.canvas.height = 0;
    super.dispose();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const u = this.pass.u;
    this.lit = mixRgba('signal', 'ink', 0.07);
    const view = this.path.at(t), prev = this.path.at(t - 1 / 90);
    const zoom = zoomOf(view);
    // 景深：推得越近牆越失焦（主打浮在最前面、清楚）
    const zPark = this.parks.length ? Math.min(...this.parks.map((p) => p.spec.zoom)) : this.zWide * 3;
    const dof = clamp((Math.log(zoom) - Math.log(this.zWide * 1.25)) / (Math.log(zPark * 0.95) - Math.log(this.zWide * 1.25)));
    (u.camA!.value as THREE.Vector4).set(view.x, view.y, view.w, view.r);
    (u.camB!.value as THREE.Vector4).set(prev.x, prev.y, prev.w, prev.r);
    u.wall!.value = this.tex;
    (u.wsz!.value as THREE.Vector2).set(this.wall.W, this.wall.H);
    u.sTex!.value = this.sTex;
    u.blur!.value = MAX_BLUR * ease.inOutQuad(dof);
    u.t!.value = t;
    u.kick!.value = f.a.kick;
    u.hat!.value = f.a.hat;
    u.lum!.value = 0.35 + 0.65 * prog(t, s, s + 0.25, ease.outCubic);
    u.spot!.value = dof;
    // 帶子：第一拍打開、大鼓時下緣亮一下
    (u.band!.value as THREE.Vector4).set(BAND.y0, this.bandY1, prog(t, s, s + 0.32, ease.outExpo), 0.35 * f.a.kick);
    // 視差：停住時後面的牆慢慢漂（以主打為中心放大一點、往一邊平移），鏡頭移開時收回來
    const par = u.par!.value as THREE.Vector4, parD = u.parD!.value as THREE.Vector2, scr = u.scr!.value as THREE.Vector4;
    par.set(0, 0, 1, 0); parD.set(0, 0); u.scrK!.value = 0;
    // 主打格子的遮罩與餘溫、點火的光圈
    const hr = [u.hr0!, u.hr1!, u.hr2!], hs = [u.hs0!, u.hs1!, u.hs2!];
    let rip: [number, number, number, number] = [0, 0, 9, 0];
    for (let i = 0; i < 3; i++) {
      const p = this.parks[i];
      const R = hr[i]!.value as THREE.Vector4, S = hs[i]!.value as THREE.Vector4;
      if (!p) { R.set(-1, -1, 0, 0); S.set(0, 0, 0, 0); continue; }
      const h = p.spec, st = this.heroState(p, t);
      R.set(h.x, h.y, h.w, h.h);
      S.set(st.sweep / h.zoom, st.lit, st.trace, SKEW);
      if (t >= p.tLand - 0.02 && t - p.tLand < 3) rip = [h.x + h.w / 2, h.y + h.h / 2, t - p.tLand, 0.5];
      const k = t < p.tRel ? prog(t, p.tLand, p.tRel, ease.inOutQuad) : 1 - prog(t, p.tRel, p.tAway, ease.inOutCubic);
      if (k > 0 && t >= p.tLand) {
        par.set(h.x + h.w / 2, h.y + h.h / 2, 1 + DRIFT_SCALE * k, 0);
        parD.set(p.drift[0] * k, p.drift[1] * k);
        scr.set(...p.scr);
        u.scrK!.value = 0.8 * st.alpha * Math.min(1, k * 3);
      }
    }
    (u.rip!.value as THREE.Vector4).set(...rip);
    this.pass.render(renderer, out);

    // ---- 點亮的主打：同一時間只有一則。清晰的那層只在斜掃經過時重畫（簽名也是斜掃掃出來的）；燒紅的光暈層在斜掃結束時定格，
    // 之後用透明度冷卻。鏡頭移動、淡出都只改貼上去的矩陣與透明度，不重新上傳
    this.glow.clear();
    const p = this.parks.find((q) => t >= q.tIgn0 - 0.05 && t <= q.tOff + 0.05);
    if (p) {
      const st = this.heroState(p, t);
      const sig = `${p.spec.msg.id}|${Math.round(st.sweep)}`;
      if (sig !== this.heroSig) {
        this.heroSig = sig;
        this.heroL.clear();
        this.drawHero(this.heroL.ctx, p, t);
        this.heroL.upload();
      }
      this.placeHero(this.heroPass, this.heroL, p, view, st.alpha, 1);
      this.heroPass.render(renderer, out);
      const cool = 1 - prog(t, p.tIgn1, p.tIgn1 + COOL, ease.outQuad);
      if (cool > 0.005) {
        const tHot = Math.min(t, p.tIgn1);
        const hsig = `${p.spec.msg.id}|${tHot.toFixed(4)}`;
        if (hsig !== this.hotSig) {
          this.hotSig = hsig;
          this.hot.clear();
          this.drawHeat(this.hot.ctx, p, tHot);
          this.hot.upload();
        }
        this.placeHero(this.hotPass, this.hot, p, view, st.alpha * cool, 2.2);
        this.hotPass.render(renderer, out);
      }
      if (t >= p.tIgn0 && t <= p.tIgn1) {
        const spark = this.sparkAt(p, t);
        sparkParticles(this.glow, t, (tb) => this.sparkAt(p, tb), { rate: 120, life: 0.42, speed: 240, seed: p.spec.msg.id + 3 });
        if (spark) sparkHead(this.glow, spark.x, spark.y, t, 1.1);
      }
    }
    if (this.glow.count) this.glow.render(renderer, out);

    // ---- 帶子（小圖層，貼到畫面上方）
    const BL = this.bandL;
    BL.clear();
    this.drawBand(BL.ctx, t);
    comp.draw(renderer, BL.upload(), out, { scale: [1, H / BAND_LAYER.h], offset: [0, 0.5 + (BAND_LAYER.y - H / 2) / BAND_LAYER.h] });

    // 鏡頭移動的速度（螢幕 px／秒）→ 色差；落地那拍輕輕一推
    const speed = Math.hypot(view.x - prev.x, view.y - prev.y) * zoom * 90 + Math.abs(Math.log(view.w / prev.w)) * 90 * 900;
    let punch = 0;
    for (const p of this.parks) punch = Math.max(punch, pulse(t, p.tLand, 0.11));
    return {
      bloom: 0.72, vignette: 0.48, grain: 0.055, popups: 0.85, halation: 0.14, popupAvoid: this.avoid,
      ca: 1.0 + clamp(speed / 2500, 0, 2.2),
      zoom: 1 + 0.016 * punch + 0.004 * f.a.kick,
    };
  }

  /** 主打在 t 的狀態：斜掃到哪（格子螢幕座標）、牆上那份藏多少、餘溫多少、點亮的那份多亮。 */
  private heroState(p: Park, t: number) {
    const ign = prog(t, p.tIgn0, p.tIgn1, (x) => x);
    const sweep = t < p.tIgn0 ? -1e4 : t >= p.tIgn1 ? 1e5 : lerp(p.u0, p.u1, ign);
    const off = prog(t, p.tRel, p.tOff, ease.inOutCubic);
    const lit = t < p.tIgn0 ? 0 : 1 - off;
    return { sweep, lit, trace: t >= p.tRel ? off : 0, alpha: 1 - off };
  }

  /**
   * 主打圖層（格子座標）→ 螢幕的仿射變換，把反矩陣交給 shader。停住時（1:1、沒有旋轉）位移對齊到實體像素，字才銳利。
   */
  private placeHero(pass: FSPass, L: Layer2D, p: Park, view: View, opacity: number, tint: number) {
    const h = p.spec, M = worldToScreen(view);
    const A = M.a / h.zoom, B = M.b / h.zoom, C = M.c / h.zoom, D = M.d / h.zoom;
    let E = M.a * h.x + M.c * h.y + M.e, Fy = M.b * h.x + M.d * h.y + M.f;
    if (Math.abs(A - 1) < 2e-3 && Math.abs(B) < 1e-5) { E = Math.round(E * SCALE) / SCALE; Fy = Math.round(Fy * SCALE) / SCALE; }
    const det = A * D - B * C;
    const u = pass.u;
    (u.ax!.value as THREE.Vector3).set(D / det, -C / det, (-D * E + C * Fy) / det);
    (u.ay!.value as THREE.Vector3).set(-B / det, A / det, (B * E - A * Fy) / det);
    (u.size!.value as THREE.Vector2).set(L.w, L.h);
    u.tex!.value = L.texture;
    u.opacity!.value = opacity;
    u.tint!.value = tint;
  }

  /** 火花在 tb 時的螢幕位置（沿著標頭那條細線由左往右跑，跑到編號前停住）。 */
  private sparkAt(p: Park, tb: number): { x: number; y: number } | null {
    if (tb < p.tIgn0 || tb > p.tIgn1) return null;
    const st = this.heroState(p, tb), hh = heroHeader(p.spec);
    const lx = clamp(st.sweep - SKEW * HERO_RULE_Y, hh.x0, hh.x1);
    const M = worldToScreen(this.path.at(tb));
    const h = p.spec;
    return M.pt(h.x + lx / h.zoom, h.y + HERO_RULE_Y / h.zoom);
  }

  /** 斜掃的遮罩：只畫掃過的部分（格子座標，x + SKEW·y < sweep）。 */
  private clipSweep(c: CanvasRenderingContext2D, p: Park, sweep: number) {
    const yB = p.spec.h * p.spec.zoom;
    c.beginPath();
    c.moveTo(-50, 0); c.lineTo(sweep, 0); c.lineTo(sweep - SKEW * yB, yB); c.lineTo(-50, yB);
    c.closePath(); c.clip();
  }

  /** 畫點亮的主打（格子座標、停住時的螢幕尺寸；透明度與位置由 placeHero 處理）：標頭、掃過的字、簽名。 */
  private drawHero(c: CanvasRenderingContext2D, p: Park, t: number) {
    const h = p.spec, st = this.heroState(p, t);
    const size = h.fit.size;
    const hh = heroHeader(h);
    const sweepAt = (y: number) => st.sweep - SKEW * y;
    // 標頭：火花拉出來的細線，跑到尾端時編號打出來
    const rx = clamp(sweepAt(HERO_RULE_Y), hh.x0, hh.x1);
    if (rx > hh.x0) {
      c.fillStyle = rgba('signal', 0.8);
      c.fillRect(hh.x0, HERO_RULE_Y - 0.8, rx - hh.x0, 1.6);
    }
    const lab = heroLabel(h.msg);
    const nl = Math.floor(lab.length * prog(sweepAt(HERO_RULE_Y), hh.x1 - 10, hh.x1 + 90));
    if (nl > 0) {
      c.font = font(F.mono(500), HERO_LABEL_SIZE);
      c.letterSpacing = `${hh.track}px`;
      c.textBaseline = 'alphabetic';
      c.fillStyle = this.lit;
      c.fillText(lab.slice(0, nl), hh.labelX, hh.baseY);
      c.letterSpacing = '0px';
    }
    // 字與簽名：斜掃過的才出現（燒紅的樣子在光暈層，這裡直接是讀的時候的顏色）
    const partial = st.sweep < p.u1;
    c.save();
    if (partial) this.clipSweep(c, p, st.sweep);
    c.font = font(h.family, size);
    c.textBaseline = 'alphabetic';
    c.fillStyle = this.lit;
    for (const ln of p.lines) {
      for (const g of ln.lay.glyphs) {
        const gx = ln.x + g.x;
        if (gx + SKEW * ln.y > st.sweep + size) break;
        // 愛心只用我們自己畫的那顆、點綴色
        if (g.ch === '♥') drawHeart(c, gx + g.w / 2, ln.y - size * 0.36, size * 0.78, rgba('rose'));
        else c.fillText(g.ch, gx, ln.y);
      }
    }
    if (st.sweep > p.sigX - 420 + SKEW * p.sigY) {
      c.font = font(F.hand(400), 44);
      c.fillStyle = rgba('bone', 0.9);
      c.textAlign = 'right';
      c.fillText(signature(h.msg.name), p.sigX, p.sigY);
      c.textAlign = 'left';
    }
    c.restore();
  }

  /** 燒紅的光暈層：剛被火花掃過的字最亮，掃過一陣子的暗下去（加亮疊上去才會發光）。 */
  private drawHeat(hc: CanvasRenderingContext2D, p: Park, t: number) {
    const h = p.spec, st = this.heroState(p, t);
    const size = h.fit.size;
    hc.save();
    if (st.sweep < p.u1) this.clipSweep(hc, p, st.sweep);
    hc.font = font(h.family, size);
    hc.textBaseline = 'alphabetic';
    const tSpan = p.tIgn1 - p.tIgn0, uSpan = p.u1 - p.u0;
    for (const ln of p.lines) {
      for (const g of ln.lay.glyphs) {
        const gx = ln.x + g.x, gu = gx + SKEW * ln.y;
        if (gu > st.sweep + size) break;
        const heat = 1 - clamp((t - (p.tIgn0 + ((gu - p.u0) / uSpan) * tSpan)) / COOL);
        if (heat <= 0.03 || g.ch === '♥') continue;
        hc.fillStyle = mixRgba('signal', 'ember', heat * 0.6, heat * heat);
        hc.fillText(g.ch, gx, ln.y);
      }
    }
    hc.restore();
  }

  /** 帶子：左邊跟唱的歌詞（沒有歌詞時放歌名），右邊計數器。畫在小圖層上（y 從 BAND_LAYER.y 起算）。 */
  private drawBand(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const s = this.ctx.start;
    const k = prog(t, s, s + 0.32, ease.outExpo);
    if (k <= 0) return;
    const y0 = BAND.y0, y1 = this.bandY1, mid = (y0 + y1) / 2;
    c.save();
    c.translate(0, -BAND_LAYER.y);
    c.beginPath(); c.rect(0, lerp(mid, y0, k), W, (y1 - y0) * k); c.clip();
    // 計數器：開場時從少一點的數字跑上來；窗格播放中有新留言進來就跟著加
    const N = Math.max(this.total, this.ctx.live.count);
    const n = Math.round(lerp(Math.max(0, N - 36), N, prog(t, s + 0.05, s + 0.9, ease.outExpo)));
    const xr = COUNTER_R;
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    const big = this.hasBand ? 58 : 44;
    const yNum = this.hasBand ? mid + 34 : mid + 20;
    c.font = font(F.hei(500), this.hasBand ? 22 : 18);
    c.fillStyle = rgba('bone', 0.8);
    c.fillText('則祝福', xr, yNum);
    const wUnit = c.measureText('則祝福').width;
    c.font = font(F.mono(500), big);
    c.fillStyle = rgba('bone', 0.96);
    c.fillText(String(n).padStart(3, '0'), xr - wUnit - 12, yNum);
    c.font = font(F.hei(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('ash', 0.9);
    c.fillText('祝福牆　已收到', xr + 4, yNum - big - 6);
    c.letterSpacing = '0px';
    // 正在讀哪一則：數字下面一行小小的訊號色編號
    const cur = this.parks.find((p) => t >= p.tIgn0 && t < p.tOff);
    if (cur) {
      c.font = font(F.mono(500), 13);
      c.letterSpacing = '3px';
      c.fillStyle = rgba('signal', 0.95);
      c.fillText(`▸ READING NO.${String(cur.spec.msg.n).padStart(3, '0')}`, xr + 3, yNum + (this.hasBand ? 28 : 22));
      c.letterSpacing = '0px';
    }
    c.textAlign = 'left';
    // 歌詞（照跟唱規則）；兩句之間放歌名
    const ly = this.hasBand ? lyricAt(lyrics, t) : null;
    if (ly) {
      const st = this.lyricStyle;
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
      c.save();
      c.translate(150, mid - lay.height / 2 + lay.size * 0.8 + (1 - inK) * 26);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else {
      c.font = font(F.mono(500), 18);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('ash', 0.85);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), 150, mid + 7);
      c.letterSpacing = '0px';
    }
    c.restore();
  }
}
