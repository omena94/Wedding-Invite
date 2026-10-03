// 照片版面「花磚牆」（P9 台灣味，亮）：老房子的花磚牆（每塊磚中間一朵八瓣花，四個角的四分之一圓拼起來是另一朵圓花），
// 照片（有白邊的相片）用兩段紙膠帶斜斜貼在牆上——
//  - 切進來時鏡頭貼著牆、斜斜地看著磚（很淺的景深，近的磚清楚、遠的糊掉），然後轉到正面、往後拉，照片出現在牆上。
//  - 字寫在照片右邊一條一條的紙膠帶上（一行一條，撕下來貼上去的樣子）：主字（賓客的祝福＋署名，或新人的註解）一拍貼一條，
//    署名跟著最後一條貼上去；歌詞小一號寫在下面的紙膠帶上跟唱；沒有主字時歌詞自己寫在紙膠帶上（_photo.ts 的 PhotoText）。
//    兩個都沒有：只有照片，在牆的中間。
//  - 焦點：牆上的照片往焦點推（1.18 倍），鏡頭轉到正面之後也慢慢往焦點那一點移。
//  - 一直在動：釉面的反光跟著鏡頭的角度滑動；照片的下緣微微翹起，每個小節線被風吹得掀一下（影子跟著變）；鏡頭很慢地漂。
//  - 花磚的顏色是實物本來的顏色（固定色：紅 collar、綠 gingham、黃 fur、米白），不跟主題換；褪色、不搶照片。
// 畫法：一個 shader（花磚的圖樣是距離場，景深照每一點離鏡頭多遠算；照片、膠帶、影子）；紙膠帶與字畫在一張 Canvas（fast），shader 取樣。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog } from '../engine/util';
import { beatAfter, lyricAt, layoutLyric } from './_motifs';
import { focusIn, PhotoText, photoWords, settleK } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, camUniforms, fitPhoto, setCam } from './_p9';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'local', prefers: ['square', 'small'], energy: [0, 1], bars: [2, 8], weight: 1 };

const DIST = 2400;
const RAD = Math.PI / 180;
/** 紙膠帶那一欄的寬、相簿名那一行的高。 */
const COL_W = 600, LINE_H = 70;
/** 字在圖層裡的左緣（左邊留給紙膠帶的頭）、第一行的頂。 */
const TX = 44, TY = 20;

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  ${P9_CAM_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform float hasTxt; uniform vec2 txO; uniform vec2 txS;
  uniform vec2 phC; uniform float phR; uniform vec2 phHalf; uniform float phBd; uniform float lod; uniform vec4 crop;
  uniform float focusD; uniform float curl; uniform float t; uniform float k;

  const float TS = 250.0;   // 一塊磚
  // 花磚的圖樣：uv = 磚的局部座標（-1..1）；回傳顏色。aa = 邊緣寬（磚的單位）
  vec3 tileAt(vec2 uv, vec2 id, float aa) {
    float h = hash12(id);
    vec3 base = mix(C_BONE, C_FUR, 0.1) * (0.84 + 0.05 * h);
    // 老磚褪色：顏色都往米白靠
    vec3 red = mix(C_COLLAR, C_BONE, 0.5), green = mix(mix(C_GINGHAM, C_INK2, 0.15), C_BONE, 0.25), yel = mix(C_FUR, C_BONE, 0.45);
    vec3 col = base;
    float r = length(uv), a = atan(uv.y, uv.x);
    // 四個角的四分之一圓（四塊磚拼成一朵圓花）
    vec2 cq = 1.0 - abs(uv);
    float cr = length(cq);
    col = mix(col, yel, fillAA(cr - 0.46, aa));
    col = mix(col, red, fillAA(abs(cr - 0.3) - 0.07, aa));
    col = mix(col, green, fillAA(cr - 0.1, aa));
    // 邊框：細細的一圈綠
    float edge = min(cq.x, cq.y);
    col = mix(col, green, fillAA(abs(edge - 0.08) - 0.018, aa) * step(0.46, cr));
    // 中間：八瓣花（紅）、花瓣之間的葉子（綠）、花心（黃）
    float petal = r - 0.42 * (0.55 + 0.45 * pow(abs(cos(a * 4.0)), 0.7));
    col = mix(col, red, fillAA(petal, aa));
    col = mix(col, mix(red, C_BONE, 0.35), fillAA(petal + 0.12, aa));
    vec2 lq = rot2(PI / 8.0) * uv;
    float la = atan(lq.y, lq.x);
    float lsec = mod(la + PI / 8.0, PI / 4.0) - PI / 8.0;
    vec2 lp = r * vec2(cos(lsec), sin(lsec));
    float leaf = (length((lp - vec2(0.56, 0.0)) / vec2(0.2, 0.065)) - 1.0) * 0.065;
    col = mix(col, green, fillAA(leaf, aa));
    col = mix(col, yel, fillAA(r - 0.1, aa));
    col = mix(col, red, fillAA(r - 0.04, aa));
    // 釉面：一點點不均勻、細的裂紋
    col *= 0.97 + 0.03 * snoise(uv * 3.0 + id * 7.0);
    return col;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w = onZ(p, 0.0);
    // 這一點離鏡頭多遠 → 景深與抗鋸齒（換成牆上的長度）
    vec3 P = vec3(w, 0.0) - camO;
    float depth = dot(P, camF);
    float pxW = depth / camFoc;
    float blurPx = abs(depth - focusD) * 0.012;
    float aaW = (0.8 + blurPx) * pxW;
    // 花磚＋灰縫
    vec2 g = w / TS;
    vec2 id = floor(g);
    vec2 uv = (fract(g) - 0.5) * 2.0;
    vec3 col = tileAt(uv, id, aaW / TS * 2.0 + 0.004);
    float grout = 1.0 - smoothstep(0.0, aaW / TS * 2.0 + 0.012, min(1.0 - abs(uv.x), 1.0 - abs(uv.y)) - 0.018);
    col = mix(col, mix(C_BONE, C_GRAPHITE, 0.25) * 0.8, grout);
    // 光：左上來的窗光，下面暗一點；釉面的反光跟著鏡頭的角度滑動（亮的一條，比紙暗，不發光）
    col *= 0.97 - 0.16 * smoothstep(0.0, 1300.0, w.y + 0.3 * w.x - 300.0);
    vec3 v = normalize(-P);
    float spec = pow(max(dot(normalize(v + normalize(vec3(-0.5, -0.4, 0.75))), vec3(0.0, 0.0, 1.0)), 0.0), 60.0);
    col += C_BONE * 0.12 * spec * (1.0 - grout);
    // 照片：影子（下緣翹起來，影子往下長）、相片、兩段紙膠帶
    vec2 q = rot2(-phR) * (w - phC);
    vec2 hs = phHalf + phBd;
    float lift = curl * smoothstep(-hs.y, hs.y, q.y);
    vec2 qs = q - vec2(10.0, 12.0) - vec2(0.4, 1.0) * lift * 30.0;
    col *= 1.0 - 0.35 * boxShade(sdBox(qs, hs), 6.0 + 22.0 * lift);
    vec4 pr = printAt(photo, q, phHalf, phBd, lod, aaW, crop);
    // 翹起來的地方被光照得亮一點點
    pr.rgb *= 1.0 + 0.04 * lift;
    col = mix(col, pr.rgb, pr.a);
    for (int i = 0; i < 2; i++) {
      float sx = i == 0 ? -1.0 : 1.0;
      vec2 tc = vec2(sx * (hs.x - 8.0), -hs.y + 8.0);
      vec2 tq = rot2(sx * 0.62) * (q - tc);
      float along = tq.x, across = tq.y;
      // 撕開的兩端（鋸齒）
      float torn = 5.0 * (hash11(floor(across * 0.4) + float(i) * 13.0) - 0.5);
      float dt = max(abs(across) - 19.0, abs(along) - 62.0 - torn);
      float at = fillAA(dt, aaW);
      col = mix(col, mix(C_BONE, C_FUR, 0.22) * 0.9 * (0.96 + 0.04 * snoise(tq * 0.3)), at * 0.82);
    }
    // 紙膠帶上的字（Canvas 裡已經畫好膠帶＋字）
    if (hasTxt > 0.5) {
      vec4 tx = layerAt(txt, (w - txO) / txS);
      col = col * (1.0 - tx.a) + tx.rgb;
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, hasTxt: { value: 0 }, txO: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) },
  ...camUniforms(),
  phC: { value: new THREE.Vector2() }, phR: { value: 0 }, phHalf: { value: new THREE.Vector2() }, phBd: { value: 16 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  focusD: { value: 2400 }, curl: { value: 0 }, t: { value: 0 }, k: { value: 1 },
});

export default class Tiles extends P9Plate {
  bg = shared('tiles.bg', BG);
  txt: Layer2D | null = null;
  /** 紙膠帶上的字：主字（留言或註解）＋署名＋歌詞。 */
  text: PhotoText | null = null;
  /** 相簿名那一行的高（相簿第一張才有）。 */
  head = 0;
  hw = 0; hh = 0; bd = 16; cx = 900; cy = 480; ang = 0;
  txX = 0; txY = 0; txH = 0;
  /** 每一條膠帶貼上去的時間（主字一行一條；沒有主字時第一條就是歌詞）。 */
  tLine: number[] = [];
  /** 每一條膠帶的左右錯開、長短（種子決定）。 */
  jit: number[] = [];

  override async init() {
    await this.loadPhoto();
    const { end, audio } = this.ctx;
    const ph = this.photo;
    const probe = document.createElement('canvas').getContext('2d')!;
    const pw = photoWords(this.ctx);
    if (pw.kind !== 'none' || pw.lyrics) {
      // 一行一條紙膠帶：行距 1.5（膠帶之間留一點縫）；60 字的留言排五行
      this.text = new PhotoText(this.ctx, probe, {
        family: F.hand(700), w: COL_W - 60, h: 600, min: 40, max: 48, lineHeight: 1.5, maxLines: 5, align: 'left',
        ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.4), sigInk: rgba('sepia', 0.78), sigSize: 28,
      });
    }
    const T = this.text;
    const img = fitPhoto(this.img, T ? 720 : 940, T ? 600 : 660);
    this.hw = img.w / 2; this.hh = img.h / 2;
    this.bd = clamp(0.04 * Math.min(img.w, img.h), 10, 20);
    this.ang = (hash(this.seed, 8) - 0.5) * 3 * RAD;
    const rnd = mulberry32(this.seed * 31 + 7);
    this.jit = Array.from({ length: 10 }, () => rnd());
    if (T) {
      this.head = ph.chapter && ph.album ? LINE_H : 0;
      this.txH = Math.ceil(TY + this.head + T.height + 40);
      const gw = 2 * (this.hw + this.bd) + 100 + COL_W;
      this.cx = Math.max(130 + this.hw, (1920 - gw) / 2 - 20 + this.hw + this.bd); this.cy = 480;
      this.txX = this.cx + this.hw + this.bd + 100 - 20;
      // 整塊的最後一行在 HUD 區上面
      this.txY = clamp(this.cy - this.txH / 2, 130, 815 - this.txH);
      this.txt = this.track(new Layer2D(COL_W + 40, this.txH, undefined, { fast: true }));
    } else { this.cx = 930; this.cy = 470; }
    // 一拍貼一條（從轉到正面之後開始）
    const t0 = this.cue(0.9, 1.4);
    const n = T?.fit ? T.fit.lines.length : 1;
    const gap = Math.max(0.15, Math.min(beatAfter(audio, t0, 1) - t0 || 0.45, (end - t0 - 0.5) / (n + 1), 0.5));
    this.tLine = Array.from({ length: 8 }, (_, i) => t0 + i * gap);
  }

  /** 一條紙膠帶：撕開的兩端是鋸齒，半透明的米色。 */
  private tape(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, seed: number) {
    const r = mulberry32(seed);
    c.save();
    c.globalAlpha = 0.86 * k;
    c.fillStyle = mixRgba('bone', 'fur', 0.22);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + w, y);
    for (let i = 1; i <= 6; i++) c.lineTo(x + w + (r() - 0.5) * 8, y + (h * i) / 6);
    c.lineTo(x, y + h);
    for (let i = 5; i >= 0; i--) c.lineTo(x + (r() - 0.5) * 8, y + (h * i) / 6);
    c.closePath();
    c.fill();
    c.restore();
  }

  /**
   * 紙膠帶＋字：主字一行一條（一拍貼一條，貼到哪一行字就寫到哪一行），署名跟著最後一條；
   * 歌詞一排一條（第一條貼上去之後才開始唱）。內容變了才重畫（PhotoText 判斷），膠帶在字的清除步驟裡先畫。
   */
  private draw(t: number) {
    const T = this.text!, ph = this.photo;
    const L = this.txt!, c = L.ctx;
    const shown = this.tLine.filter((x) => t >= x).length;
    const fit = T.fit;
    const nMain = fit ? fit.lines.length : 0;
    const chars = fit ? (shown >= nMain ? Infinity : fit.lines.slice(0, shown).reduce((a, l) => a + Array.from(l).length, 0)) : 0;
    const lyrOn = shown > 0 ? 1 : 0;
    const top = TY + this.head;
    const paintTapes = () => {
      L.clear();
      if (shown <= 0) return;
      if (this.head) {
        c.save();
        c.font = font(F.hand(700), 22);
        c.fillStyle = rgba('sepia', 0.6);
        c.letterSpacing = '4px';
        c.fillText(ph.album, TX - 10, TY + LINE_H * 0.6);
        c.restore();
      }
      if (fit) {
        c.font = font(T.st.family, fit.size);
        fit.lines.forEach((ln, i) => {
          if (i >= shown) return;
          const base = top + fit.size * 0.9 + i * fit.lineHeight, th = fit.lineHeight - 12;
          const x = TX - 22 - this.jit[i]! * 10;
          this.tape(c, x, base - fit.size * 0.38 - th / 2, c.measureText(ln).width + 44 + this.jit[i]! * 10, th, 1, this.seed * 13 + i);
        });
        // 署名：最後一條貼上去時一起出現，貼一條窄一點的
        if (T.words.sig && shown >= nMain) {
          c.font = font(T.st.sigFamily ?? T.st.family, T.sigSize);
          const base = top + fit.height + T.sigH - T.sigSize * 0.12, th = T.sigSize * 1.5;
          this.tape(c, TX - 16, base - T.sigSize * 0.38 - th / 2, c.measureText(T.words.sig).width + 32, th, 1, this.seed * 13 + 9);
        }
      }
      const ly = T.sung ? lyricAt(this.ctx.lyrics, t, 6) : null;
      if (ly) {
        const ls = T.lyricStyle(), lay = layoutLyric(c, ly.line, ls);
        const base = top + T.lyricTop + lay.size * 0.9, th = lay.size * 1.32;
        const x0 = TX - 22 - this.jit[7]! * 10;
        lay.rows.forEach((r, i) => this.tape(c, x0 + r.x, base + r.y - lay.size * 0.38 - th / 2, r.width + 44 + this.jit[7]! * 10, th, ly.k, this.seed * 17 + i));
        // 有翻譯的歌（沒有主字時）：原文副行也各自貼一條小一點的紙膠帶
        if (lay.sub) {
          const sl = lay.sub.lay, sth = sl.size * 1.32;
          sl.rows.forEach((r, i) => this.tape(c, TX - 16 + r.x, base + lay.sub!.dy + r.y - sl.size * 0.38 - sth / 2, r.width + 32, sth, ly.k, this.seed * 19 + i));
        }
      }
    };
    if (T.draw(c, t, TX, top, { chars, lyricAlpha: lyrOn, clear: paintTapes })) L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    (u.phC!.value as THREE.Vector2).set(this.cx, this.cy);
    u.phR!.value = this.ang;
    (u.phHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    u.phBd!.value = this.bd;
    // 照片下緣翹起，每個小節線被風掀一下
    const bp = f.barPhase;
    u.curl!.value = 0.25 + 0.55 * Math.exp(-bp * 5) * Math.sin(Math.min(1, bp * 8) * Math.PI * 0.5) + 0.05 * Math.sin(t * 1.3);
    // 鏡頭：貼著牆斜斜地看 → 轉到正面、拉開；焦點從近的磚拉到照片
    const sw = ease.inOutCubic(prog(t, s, s + Math.min(1.6, (e - s) * 0.4)));
    const push = 1 - Math.exp(-lt / 7);
    const side = hash(this.seed, 9) < 0.5 ? -1 : 1;
    // 焦點：轉到正面之後，照片往焦點推；鏡頭也往焦點那一點慢慢移（有字時移得少，紙膠帶上的字一直在畫面裡）
    const tF = s + Math.min(1.6, (e - s) * 0.4);
    const crop = this.focus(t, tF - 0.4, this.hw / this.hh, { zoom: 1.18, screenW: 2 * this.hw });
    (u.crop!.value as THREE.Vector4).set(...crop);
    const [fu, fv] = focusIn(this.photo, crop);
    const qx = (fu - 0.5) * 2 * this.hw, qy = (fv - 0.5) * 2 * this.hh;
    const focX = this.cx + qx * Math.cos(this.ang) - qy * Math.sin(this.ang), focY = this.cy + qx * Math.sin(this.ang) + qy * Math.cos(this.ang);
    const toF = (this.text ? 0.16 : 0.4) * settleK(t - tF, 6);
    const zoom = lerp(1.3, 1.0, sw) + (this.text ? 0.03 : 0.08) * push;
    const camX = lerp(this.cx + side * 260, 960, sw) + side * (this.text ? 25 : 10) * push, camY = lerp(this.cy, 540, sw);
    setCam(u, { x: camX + (focX - camX) * toF, y: camY + (focY - camY) * toF, z: 0, dist: DIST, zoom, yaw: side * lerp(30, 2, sw) * RAD, pitch: lerp(-4, 0, sw) * RAD, roll: side * lerp(-2, 0.3, sw) * RAD });
    u.focusD!.value = lerp(DIST * 0.62, DIST, sw);
    u.lod!.value = this.lod(2 * this.hw * zoom, crop[2] - crop[0]);
    u.t!.value = t;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    u.photo!.value = this.tex;
    u.hasTxt!.value = this.txt ? 1 : 0;
    // shader 是共用的：沒有字的窗格也要換掉上一個窗格（已經釋放）的字圖層
    u.txt!.value = this.tex;
    if (this.txt) {
      this.draw(t);
      u.txt!.value = this.txt.texture;
      (u.txO!.value as THREE.Vector2).set(this.txX, this.txY);
      (u.txS!.value as THREE.Vector2).set(this.txt.w, this.txt.h);
    }
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.32 };
  }
}
