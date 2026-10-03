// 照片版面「大頭貼」（P9 台灣味，亮）：一張剛從大頭貼機吐出來的貼紙，從畫面上方滑下來落在桌上（俯拍，桌面是主題色的淡色紙）——
//  - 貼紙上同一張照片印四格（橫的照片 2×2、直的照片一排四格），右邊一欄是寫字的地方。
//  - 每一拍「蓋」上一格的花樣：第一格白色圓角框＋角落的閃光、第二格柔光（亮一點、暖一點）＋圓點框、第三格復古的棕色調＋花邊框、
//    第四格雙線框＋一閃一閃的星星。框與星星用點綴的訊號色、原木色（固定色 fur），不畫愛心、不畫人。
//  - 四格都蓋好之後，鏡頭推近到第四格（最後一格），那一格的貼紙微微翹起來（影子落在底紙上），
//    右邊那一欄用細筆手寫：主字（賓客的祝福＋署名，或新人的註解）一個字一個字寫出來，歌詞小一號寫在下面跟唱；
//    沒有主字時歌詞自己寫在那裡（_photo.ts 的 PhotoText；推近之後才出現，遠景時字太小）。
//    兩個都沒有：鏡頭推近到第四格的正中間。婚禮日期印在那一欄的右下角（小小的，沒有日期就不印）。
//  - 焦點：四格是同一張照片、繞著焦點裁得不一樣（第一格整張、第二格近一點、第三格更近），
//    推近之後第四格的畫面再慢慢往焦點推。
//  - 一直在動：星星一閃一閃、每個小節線一道光掃過亮面的貼紙、鏡頭很慢地漂。
// 畫法：一個 shader（桌面、貼紙底紙與影子、四格照片的濾鏡與框、翹起來的第四格、亮面的反光）；字畫在一張 Canvas（fast），shader 在那一欄的座標取樣。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter, DATE_DOT } from './_motifs';
import { focusCrop, photoWords, settleK } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, Words, camUniforms, setCam } from './_p9';

// 縮圖（thumbAt）拍四格都蓋好花樣、還沒推近的那一刻：收尾的畫面只剩第四格，看不出是一張大頭貼。
export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'local', prefers: ['portrait', 'square'], energy: [0, 1], bars: [2, 8], weight: 1, thumbAt: 0.146 };

const DIST = 2600;
const RAD = Math.PI / 180;
/** 格子間距、貼紙的邊、右邊那一欄的寬（世界座標 = 推近之後的畫面 px）。 */
const GAP = 36, MARG = 50, PANEL = 600;

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  ${P9_CAM_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform float hasTxt; uniform vec2 txO; uniform vec2 txS; uniform float txK;
  uniform vec2 shC; uniform float shR; uniform vec2 shHalf; uniform vec2 gridO; uniform vec2 grid; uniform vec2 cell;
  uniform float stamp[4]; uniform vec4 crops[4]; uniform float lift; uniform float lod; uniform float lodBig;
  uniform float sweep; uniform float t; uniform float k; uniform float panel; uniform vec2 rule;

  const float GAP = ${GAP}.0;
  const vec2 SH = vec2(0.3, 0.42);
  float star4(vec2 q, float r) { q = abs(q) / r; return (pow(sqrt(q.x) + sqrt(q.y), 2.0) - 1.0) * r * 0.35; }
  vec2 shL(vec2 w) { return rot2(-shR) * (w - shC); }

  // 一格的樣子：第 i 格（0..3），c = 格子中心為原點的座標，l = mip 層
  vec3 cellCol(int i, vec2 c, float l, out float a) {
    float st = stamp[i];
    vec2 hs = cell * 0.5;
    float d = sdBox(c, hs - 16.0) - 16.0;
    a = fillAA(d, 0.9);
    // 貼紙的白框
    vec3 col = C_BONE * 0.93;
    float inset = 14.0 + 6.0 * st;
    float dp = sdBox(c, hs - inset - 10.0) - 10.0;
    // 每一格繞著焦點裁得不一樣（crops）
    vec2 uv = cropUV((c + hs) / (2.0 * hs), crops[i]);
    vec3 ph = photoLin(photo, uv, l);
    float y = luma(ph);
    if (i == 1) ph = mix(ph, ph * 0.78 + vec3(0.12) + C_SIGNAL * 0.04, st);
    if (i == 2) ph = mix(ph, y * mix(C_FUR, C_BONE, 0.45) * 1.05, st * 0.85);
    if (i == 3) ph = mix(ph, clamp((ph - y) * 1.15 + y, 0.0, 0.84), st);
    col = mix(col, ph, fillAA(dp, 0.8));
    // 框（蓋上去的時候從大縮到剛好）
    float ring = dp - 0.0;
    if (i == 0) {
      col = mix(col, C_BONE * 0.9, fillAA(abs(ring + 8.0) - 3.0, 0.8) * st);
    } else if (i == 1) {
      // 圓點框
      vec2 cq = abs(c) - (hs - inset * 0.5);
      float along = cq.x > cq.y ? c.y : c.x;
      float dd = length(vec2(mod(along + 400.0, 26.0) - 13.0, max(cq.x, cq.y))) - 5.0;
      col = mix(col, mix(C_SIGNAL, C_BONE, 0.25) * 0.85, fillAA(dd, 0.9) * st * step(-inset, max(cq.x, cq.y)));
    } else if (i == 2) {
      // 花邊框（波浪）
      vec2 cq = abs(c);
      float along = cq.x / hs.x > cq.y / hs.y ? c.y : c.x;
      float wav = abs(ring + 6.0 + 3.0 * sin(along * 0.25)) - 2.2;
      col = mix(col, C_FUR * 0.85, fillAA(wav, 0.8) * st);
    } else {
      col = mix(col, C_SIGNAL * 0.8, max(fillAA(abs(ring + 5.0) - 1.6, 0.8), fillAA(abs(ring + 12.0) - 0.9, 0.8)) * st);
    }
    // 閃光的星星（角落，一閃一閃）
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      vec2 sp = hs * vec2(j == 1 ? 0.78 : -0.8, j == 2 ? 0.74 : -0.72) * (i == 3 ? 1.0 : 0.92) - sign(vec2(j == 1 ? 1.0 : -1.0, j == 2 ? 1.0 : -1.0)) * 6.0;
      float tw = 0.65 + 0.35 * sin(t * (4.0 + fj) + float(i) * 1.7 + fj * 2.3);
      float r = (i == 3 ? 30.0 : 20.0) * (j == 0 ? 1.0 : 0.62) * tw * st;
      if (i == 1 && j == 2) continue;
      if (r > 0.5) {
        float ds = star4(c - sp, r);
        vec3 sc = j == 1 ? C_BONE * 0.95 : mix(C_SIGNAL, C_BONE, 0.35);
        col = mix(col, sc, fillAA(ds, 0.8));
      }
    }
    return col;
  }

  // 貼紙在 w（世界座標，貼紙的平面）：回傳顏色與覆蓋；skip3 = 第四格已經翹起來（底紙上只剩一塊）
  vec4 sheetAt(vec2 w, float skip3, out vec2 q) {
    q = shL(w);
    float ds = sdBox(q, shHalf - 10.0) - 10.0;
    float a = fillAA(ds, 0.9);
    if (a <= 0.0) return vec4(0.0);
    vec3 col = C_BONE * 0.9 * (0.985 + 0.015 * paperTex(q));
    vec2 g = q - gridO;
    vec2 pitch = cell + GAP;
    vec2 id = floor(g / pitch);
    if (id.x >= 0.0 && id.y >= 0.0 && id.x < grid.x && id.y < grid.y) {
      vec2 c = g - id * pitch - cell * 0.5;
      int i = int(id.y * grid.x + id.x);
      if (i == 3 && skip3 > 0.5) {
        // 翹起來之後的底紙：淡淡的灰
        float d = sdBox(c, cell * 0.5 - 16.0) - 16.0;
        col = mix(col, C_BONE * 0.8, fillAA(d, 0.9));
      } else {
        float ca;
        vec3 cc = cellCol(i, c, lod, ca);
        col = mix(col, cc, ca);
      }
    }
    // 右邊那一欄：淡淡的點線（寫字的地方）＋字
    if (panel > 0.5) {
      vec2 pq0 = q - txO;
      if (pq0.x > 20.0 && pq0.x < txS.x - 20.0 && pq0.y > 30.0 && pq0.y < txS.y - 40.0) {
        // 點線跟著字的行距（rule = 第一條線的 y、行距），字才寫在線上
        float ly = mod(pq0.y - rule.x, rule.y);
        float dot2 = step(mod(pq0.x, 12.0), 5.0);
        col = mix(col, C_SIGNAL * 0.6, (1.0 - smoothstep(0.6, 1.4, min(ly, rule.y - ly))) * dot2 * 0.35);
      }
      vec2 pq = q - txO;
      if (hasTxt > 0.5) {
        vec4 tx = layerAt(txt, pq / txS) * txK;
        col = col * (1.0 - tx.a) + tx.rgb;
      }
    }
    return vec4(col, a);
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w = onZ(p, 0.0);
    // 桌面：主題色的淡色紙、一點一點的圓點
    vec3 col = mix(C_PAPER, C_SIGNAL, 0.07) * (0.95 + 0.02 * snoise(w / 500.0));
    vec2 dg = mod(w + vec2(23.0), 46.0) - 23.0;
    col = mix(col, mix(C_PAPER, C_SIGNAL, 0.2), fillAA(length(dg) - 3.0, 0.9) * 0.6);
    col *= 1.04 - 0.1 * smoothstep(-600.0, 1600.0, dot(w - shC, vec2(0.6, 0.8)));
    // 貼紙的影子
    vec2 qs = shL(w - SH * 8.0);
    col *= 1.0 - 0.22 * boxShade(sdBox(qs, shHalf), 16.0);
    vec2 q;
    vec4 sh = sheetAt(w, lift > 0.5 ? 1.0 : 0.0, q);
    // 翹起來的第四格在底紙上的影子
    vec2 c3 = gridO + vec2(mod(3.0, grid.x), floor(3.0 / grid.x)) * (cell + GAP) + cell * 0.5;
    if (lift > 0.5) {
      vec2 qq = shL(onZ(p, 0.0) - SH * lift);
      sh.rgb *= 1.0 - 0.3 * boxShade(sdBox(qq - c3, cell * 0.5 - 6.0), 4.0 + lift * 0.25);
    }
    col = mix(col, sh.rgb, sh.a);
    // 翹起來的第四格
    if (lift > 0.5) {
      vec2 ql = shL(onZ(p, lift)) - c3;
      float ca;
      vec3 cc = cellCol(3, ql, lodBig, ca);
      col = mix(col, cc, ca);
    }
    // 亮面的反光：每個小節線一道斜光掃過去
    float sw = exp(-pow(dot(q, normalize(vec2(1.0, 0.35))) - sweep, 2.0) / 7000.0);
    col += C_BONE * 0.06 * sw * sh.a;
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, hasTxt: { value: 0 }, txO: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) }, txK: { value: 0 },
  ...camUniforms(),
  shC: { value: new THREE.Vector2() }, shR: { value: 0 }, shHalf: { value: new THREE.Vector2() }, gridO: { value: new THREE.Vector2() },
  grid: { value: new THREE.Vector2(2, 2) }, cell: { value: new THREE.Vector2() }, stamp: { value: [0, 0, 0, 0] }, crops: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 1, 1)) }, lift: { value: 0 },
  lod: { value: 0 }, lodBig: { value: 0 }, sweep: { value: -3000 }, t: { value: 0 }, k: { value: 1 }, panel: { value: 0 }, rule: { value: new THREE.Vector2(92, 66) },
});

export default class Purikura extends P9Plate {
  bg = shared('purikura.bg', BG);
  txt: Layer2D | null = null;
  words: Words | null = null;
  /** 2×2 或一排四格。 */
  cols = 2; rows = 2;
  cw = 0; ch = 0;
  shW = 0; shH = 0;
  /** 第四格的中心、右欄的左上角（貼紙的座標，貼紙中心是原點）。 */
  c3x = 0; c3y = 0;
  txX = 0; txY = 0; txW = 0; txH = 0;
  tStamp: number[] = [];
  tZoom = 0; zoomDur = 1;
  ang = 0;

  override async init() {
    await this.loadPhoto(DATE_DOT);
    const { end, audio } = this.ctx;
    const img = this.img, a = img.w / img.h;
    const probe = document.createElement('canvas').getContext('2d')!;
    const pw = photoWords(this.ctx);
    // 右欄的字（60 字的留言排五行；推近之後在畫面上就是這個大小）
    const words = pw.kind !== 'none' || pw.lyrics ? new Words(this.ctx, probe, {
      family: F.hand(700), w: PANEL - 70, h: 560, min: 40, max: 50, lineHeight: 1.4, maxLines: 5, align: 'left',
      ink: rgba('sepia', 0.9), unsung: rgba('sepia', 0.28), active: mixRgba('signal', 'sepia', 0.35), sigInk: rgba('sepia', 0.75), sigSize: 28,
      album: { family: F.hand(700), size: 22, color: rgba('sepia', 0.55) },
    }) : null;
    this.words = words?.has ? words : null;
    // 格子大小 = 推近之後第四格在畫面上的大小
    if (a >= 1) { this.cols = 2; this.rows = 2; this.cw = Math.min(this.words ? 740 : 900, 600 * a); this.ch = this.cw / a; }
    else { this.cols = 4; this.rows = 1; this.ch = this.words ? 640 : 760; this.cw = this.ch * a; }
    const gw = this.cols * this.cw + (this.cols - 1) * GAP, gh = this.rows * this.ch + (this.rows - 1) * GAP;
    this.shW = gw + 2 * MARG + PANEL; this.shH = gh + 2 * MARG;
    const gx = -this.shW / 2 + MARG, gy = -this.shH / 2 + MARG;
    this.c3x = gx + (3 % this.cols) * (this.cw + GAP) + this.cw / 2;
    this.c3y = gy + Math.floor(3 / this.cols) * (this.ch + GAP) + this.ch / 2;
    // 右欄的字：跟第四格的中間對齊
    this.txW = PANEL - 30; this.txH = Math.max((this.words?.height ?? 0) + 80, 200);
    this.txX = gx + gw + 20;
    this.txY = clamp(this.c3y - this.txH / 2, -this.shH / 2 + 20, this.shH / 2 - 20 - this.txH);
    if (this.words) this.txt = this.track(new Layer2D(Math.ceil(this.txW), Math.ceil(this.txH), undefined, { fast: true }));
    this.ang = (hash(this.seed, 2) - 0.5) * 3 * RAD;
    // 時間：落下 → 一拍蓋一格 → 推近（短窗格壓縮）
    const t0 = this.cue(0.35, 0.75);
    const gap = Math.max(0.16, Math.min(beatAfter(audio, t0, 1) - t0 || 0.45, (end - t0) / 9, 0.5));
    this.tStamp = [0, 1, 2, 3].map((i) => t0 + i * gap);
    this.tZoom = this.tStamp[3]! + gap * 0.8;
    this.zoomDur = Math.max(0.5, Math.min(1.1, (end - this.tZoom) * 0.4));
    this.words?.writeFrom(this.tZoom + this.zoomDur * 0.8, Math.max(0.6, Math.min(2.2, (end - this.tZoom - this.zoomDur) * 0.5)));
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    // 貼紙從上面滑下來、落定（彈一下）
    const drop = ease.outBack(prog(t, s, s + 0.65), 1.1);
    const shY = lerp(-1400, 0, drop);
    (u.shC!.value as THREE.Vector2).set(0, shY);
    u.shR!.value = this.ang + (1 - drop) * 4 * RAD;
    (u.shHalf!.value as THREE.Vector2).set(this.shW / 2, this.shH / 2);
    (u.gridO!.value as THREE.Vector2).set(-this.shW / 2 + MARG, -this.shH / 2 + MARG);
    (u.grid!.value as THREE.Vector2).set(this.cols, this.rows);
    (u.cell!.value as THREE.Vector2).set(this.cw, this.ch);
    const st = u.stamp!.value as number[];
    for (let i = 0; i < 4; i++) st[i] = clamp(ease.outBack(prog(t, this.tStamp[i]!, this.tStamp[i]! + 0.28), 2.2), 0, 1.2);
    // 焦點：四格繞著焦點裁得不一樣（整張 → 近一點 → 更近），第四格推近之後再慢慢往焦點推；很小的舊照片少推
    const img = this.img, a = img.w / img.h, cw = this.cw;
    const crops = u.crops!.value as THREE.Vector4[];
    crops[0]!.set(0, 0, 1, 1);
    crops[1]!.set(...focusCrop(this.photo, img.w, img.h, a, 1, { zoom: 1.15, screenW: cw }));
    crops[2]!.set(...focusCrop(this.photo, img.w, img.h, a, 1, { zoom: 1.32, screenW: cw }));
    crops[3]!.set(...focusCrop(this.photo, img.w, img.h, a, settleK(t - this.tZoom, 5), { zoom: 1.3, screenW: cw }));
    // 推近到第四格（＋右欄）；第四格翹起來
    const zp = ease.inOutCubic(prog(t, this.tZoom, this.tZoom + this.zoomDur));
    const lift = 46 * ease.outCubic(prog(t, this.tZoom + this.zoomDur * 0.3, this.tZoom + this.zoomDur));
    u.lift!.value = lift < 0.6 ? 0 : lift;
    const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
    const rot = (x: number, y: number): [number, number] => [x * ca - y * sa, x * sa + y * ca];
    const hasPanel = !!this.words;
    // 最後的取景：第四格＋右欄的中間（沒有字：第四格的中間）
    const fx = hasPanel ? (this.c3x - this.cw / 2 + this.txX + this.txW) / 2 : this.c3x, fy = this.c3y;
    const [gx, gy] = rot(fx, fy);
    const fitAll = Math.min(1480 / this.shW, 780 / this.shH);
    const zoomEnd = hasPanel ? Math.min(1, 1500 / (this.cw + GAP + PANEL)) : 1;
    const push = 1 - Math.exp(-lt / 7);
    const zoom = lerp(fitAll, zoomEnd, zp) * (1 + 0.025 * push);
    const drift = 8 * Math.sin(lt * 0.4);
    const proj = setCam(u, {
      x: lerp(0, gx, zp) + drift, y: lerp(0, gy - 10, zp), z: 0, dist: DIST, zoom,
      pitch: lerp(8, 4, zp) * RAD, roll: lerp(-1.5, 0.6, zp) * RAD * (this.ang >= 0 ? 1 : -1),
    });
    void proj;
    u.lod!.value = this.lod(this.cw * zoom, crops[2]!.z - crops[2]!.x);
    u.lodBig!.value = this.lod(this.cw * zoom * (DIST / (DIST - lift)), crops[3]!.z - crops[3]!.x);
    u.sweep!.value = lerp(-2400, 2400, ease.inOutCubic(clamp(f.barPhase / 0.8)));
    u.t!.value = t;
    u.k!.value = (0.88 + 0.12 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    u.photo!.value = this.tex;
    u.panel!.value = hasPanel ? 1 : 0;
    u.hasTxt!.value = this.words ? 1 : 0;
    // shader 是共用的：沒有字的窗格也要換掉上一個窗格（已經釋放）的字圖層
    u.txt!.value = this.tex;
    if (this.words && this.txt) {
      const L = this.txt;
      // 內容變了才重畫：先清掉、印日期（右下角，在字的下面），再寫字
      const clear = () => {
        L.clear();
        if (!DATE_DOT) return;
        const c = L.ctx;
        c.font = font(F.mono(500), 18);
        c.fillStyle = rgba('sepia', 0.45);
        c.textAlign = 'right';
        c.letterSpacing = '3px';
        c.fillText(DATE_DOT, L.w - 24, L.h - 14);
        c.letterSpacing = '0px';
        c.textAlign = 'left';
      };
      if (this.words.draw(L.ctx, t, 20, 40, clear)) L.upload();
      u.txt!.value = L.texture;
      // 點線：第一條在主字第一行的基線下面一點，行距跟主字一樣（只有歌詞時照歌詞的字級）
      const T = this.words.text, sz = T.hasMain ? T.size : T.lyricSize || 46;
      (u.rule!.value as THREE.Vector2).set(40 + this.words.head + sz * 1.08, T.fit ? T.fit.lineHeight : sz * 1.4);
      (u.txO!.value as THREE.Vector2).set(this.txX, this.txY);
      (u.txS!.value as THREE.Vector2).set(L.w, L.h);
      // 遠景時字太小：推近之後才出現（註解本來就是推近之後才開始寫）
      u.txK!.value = prog(t, this.tZoom + this.zoomDur * 0.5, this.tZoom + this.zoomDur);
    }
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.26 };
  }
}

