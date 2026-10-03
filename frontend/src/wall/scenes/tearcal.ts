// 照片版面「撕日曆」（P9 台灣味，亮）：牆上掛著一本老式的撕日曆（上面一塊紅色燙金的板子、下面一疊薄薄的日曆紙）——
//  - 一開始最上面那一頁印著婚禮那一天：年、月、星期、大大的紅色日期，下面一行「宜 嫁娶」；
//    新人還沒定日期時不印數字，大字換成「吉日」，年月與星期整個收起來。
//  - 第一個拍點，這一頁被撕下來：下緣先翹起來，接著往上翻、撕開（上緣是撕破的鋸齒），旋轉著飛出畫面；
//    底下那一頁印的就是照片，照片下面（或右邊，直的照片、字多的時候）印著主字（賓客的祝福＋署名，或新人的註解；
//    思源宋體，一個字一個字印出來）。日曆紙放不下主字＋歌詞，所以有主字時歌詞燙金印在上面紅色的頭上跟唱
//    （位置固定，那時頭上的花紋收起來）；沒有主字時歌詞印在主字的位置（_photo.ts 的 PhotoText）。
//    兩個都沒有：那一頁只有照片。裝訂處留著一條撕剩的紙邊。
//  - 焦點：那一頁上的照片往焦點推（1.18 倍）。
//  - 鏡頭：撕下來之後慢慢推近到照片那一頁（歌詞在頭上時看整本），微微斜；日曆的側面看得到一頁一頁的紙邊。
// 畫法：一個 shader：牆、背板（紅底燙金）、整疊日曆（側面的紙邊）、照片那一頁（照片＋字）、撕剩的紙邊、
// 被撕下來的那一頁（以上緣為軸翻轉的平面，用射線求交算出它在畫面上的位置、正反面、受光）。
// 日期那一頁的字畫在一張 Canvas（init 畫一次），註解畫在另一張。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { DATE } from './_motifs';
import { photoWords } from './_photo';
import { P9Plate, P9_GLSL, P9_CAM_GLSL, Words, camUniforms, fitPhoto, setCam } from './_p9';

// 縮圖（thumbAt）拍撕到一半的那一刻（日期那一頁翻起來、底下的照片露出來）：收尾的畫面只看得到一頁照片，看不出是撕日曆。
export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'local', prefers: ['landscape', 'square'], energy: [0, 1], bars: [2, 8], weight: 1, thumbAt: 0.0585 };

const DIST = 2400;
const RAD = Math.PI / 180;
const WEEK = '日一二三四五六';
const MONTH = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
/** 日期那一頁上的固定字（init 先載字型）。 */
/** 頭上歌詞的寬（燙金框裡；頁面最窄 720，框裡至少 750）。 */
const LYR_W = 600;
const DATE_GLYPHS = `年月星期${WEEK}${MONTH.join('')}宜嫁娶祝福吉日0123456789．：`;

const BG = () => new FSPass(/* glsl */ `
  ${P9_GLSL}
  ${P9_CAM_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform sampler2D datePg; uniform float hasTxt;
  uniform sampler2D lyr; uniform float hasLyr; uniform vec2 lyS; uniform vec4 crop;
  uniform vec2 pgC; uniform vec2 pgHalf; uniform vec2 phC; uniform vec2 phHalf; uniform float lod;
  uniform vec2 txO; uniform vec2 txS;
  uniform vec3 tearH; uniform float tearTh; uniform float tearPhi; uniform float torn; uniform float t; uniform float k;

  const float PAD_Z = 14.0;
  // 撕破的鋸齒（沿著 x）
  float jag(float x) { return 7.0 * hash11(floor(x / 7.0) + 0.5) + 4.0 * sin(x * 0.07); }
  vec3 pageC(vec2 q) { return mix(C_BONE, C_PAPER, 0.4) * 0.93 * (0.975 + 0.025 * paperTex(q * 1.4)); }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w = onZ(p, -30.0);
    // 牆：刷白的水泥牆，淡淡的斑駁；左上的光
    vec3 col = mix(C_PAPER, C_BONE, 0.2) * (0.86 + 0.04 * fbm(w / 300.0, 3));
    col *= 1.04 - 0.14 * smoothstep(-200.0, 1600.0, w.x * 0.6 + w.y);
    // 背板（z = 0）：上面一塊紅色燙金的頭，下面是牛皮色的板子；影子往右下
    vec2 bh = vec2(pgHalf.x + 34.0, pgHalf.y + 110.0);
    vec2 bc = pgC + vec2(0.0, -76.0);
    col *= 1.0 - 0.3 * boxShade(sdBox(w - bc - vec2(16.0, 20.0), bh), 22.0);
    // 釘子與掛繩
    vec2 nail = bc + vec2(0.0, -bh.y - 90.0);
    float rope = min(sdSegment(w, nail, bc + vec2(-bh.x * 0.5, -bh.y)), sdSegment(w, nail, bc + vec2(bh.x * 0.5, -bh.y))) - 1.4;
    col = mix(col, C_SEPIA * 0.5, fillAA(rope, 0.8));
    col = mix(col, C_GRAPHITE * 0.6, fillAA(length(w - nail) - 6.0, 0.8));
    vec2 wb = onZ(p, 0.0);
    float db = sdBox(wb - bc, bh);
    if (db < 2.0) {
      vec3 board = mix(C_FUR, C_BONE, 0.3) * 0.62;
      float head = step(wb.y, bc.y - bh.y + 150.0);
      vec3 red = C_COLLAR * 0.8 * (0.95 + 0.05 * paperTex(wb));
      vec3 gold = mix(C_FUR, C_BONE, 0.45) * 0.85;
      vec2 hq = wb - vec2(bc.x, bc.y - bh.y + 75.0);
      float frame = abs(sdBox(hq, vec2(bh.x - 18.0, 57.0))) - 1.5;
      float orn = abs(length(vec2(abs(hq.x) - bh.x * 0.55, hq.y)) - 26.0) - 1.4;
      float orn2 = abs(length(hq) - 34.0) - 1.6;
      // 歌詞印在頭上時花紋收起來，只留框
      red = mix(red, gold, max(fillAA(frame, 0.8), max(fillAA(orn, 0.8), fillAA(orn2, 0.8)) * (1.0 - hasLyr)));
      if (hasLyr > 0.5) {
        vec4 ly = layerAt(lyr, (hq + lyS * 0.5) / lyS);
        red = red * (1.0 - ly.a) + ly.rgb;
      }
      board = mix(board, red, head);
      col = mix(col, board, fillAA(db, 0.8));
    }
    // 整疊日曆：側面（一頁一頁的紙邊）＋最上面的照片那一頁
    vec2 q0 = onZ(p, 0.0) - pgC, q1 = onZ(p, PAD_Z) - pgC;
    float d0 = sdBox(q0, pgHalf), d1 = sdBox(q1, pgHalf);
    float aSide = fillAA(d0, 0.8);
    if (aSide > 0.0) {
      float lines = 0.5 + 0.5 * sin((q0.x + q0.y) * 1.9);
      col = mix(col, mix(C_BONE, C_PAPER, 0.4) * (0.7 + 0.08 * lines), aSide);
    }
    float aTop = fillAA(d1, 0.8);
    if (aTop > 0.0) {
      vec3 pg = pageC(q1);
      // 照片（一條細框）
      vec2 pq = q1 + pgC - phC;
      float dp = sdBox(pq, phHalf);
      pg = mix(pg, C_SEPIA * 0.5, fillAA(abs(dp - 6.0) - 0.7, 0.8));
      vec2 uv = cropUV((pq + phHalf) / (2.0 * phHalf), crop);
      pg = mix(pg, photoLin(photo, uv, lod), fillAA(dp, 0.8));
      if (hasTxt > 0.5) {
        vec4 tx = layerAt(txt, (q1 + pgC - txO) / txS);
        pg = pg * (1.0 - tx.a) + tx.rgb;
      }
      // 撕剩的紙邊（上緣、鋸齒）
      float stub = q1.y + pgHalf.y - (16.0 + jag(q1.x)) * torn;
      pg = mix(pg, pageC(q1 * 1.3) * 1.02, (1.0 - smoothstep(-0.8, 0.8, stub)) * torn);
      pg *= 1.0 - 0.1 * torn * (1.0 - smoothstep(0.0, 8.0, abs(stub))) * step(0.0, stub);
      // 翻起來的那一頁投在上面的影子（翻到一半最暗）
      pg *= 1.0 - 0.28 * sin(clamp(tearTh, 0.0, PI)) * (1.0 - torn) * smoothstep(pgHalf.y * 1.6, 0.0, q1.y + pgHalf.y);
      col = mix(col, pg, aTop);
    }
    // 裝訂處：上緣一條深紅的布條
    vec2 qb = onZ(p, PAD_Z + 2.0) - pgC;
    float dbind = sdBox(qb - vec2(0.0, -pgHalf.y + 10.0), vec2(pgHalf.x + 4.0, 12.0));
    col = mix(col, C_COLLAR * 0.42 * (0.85 + 0.15 * smoothstep(12.0, -12.0, qb.y + pgHalf.y - 10.0)), fillAA(dbind, 0.8));
    // 被撕下來的那一頁：以上緣為軸翻轉、飛走
    if (tearTh > -0.5) {
      vec3 ex = vec3(cos(tearPhi), sin(tearPhi), 0.0);
      vec3 d0v = vec3(-sin(tearPhi), cos(tearPhi), 0.0);
      vec3 dv = d0v * cos(tearTh) + vec3(0.0, 0.0, 1.0) * sin(tearTh);
      vec3 n = cross(ex, dv);
      vec3 D = camRay(p);
      float dn = dot(D, n);
      if (abs(dn) > 1e-5) {
        float tt = dot(tearH - camO, n) / dn;
        vec3 P = camO + D * tt;
        float u = dot(P - tearH, ex), v = dot(P - tearH, dv);
        float dpg = max(abs(u) - pgHalf.x, max(-v + jag(u + 40.0) * torn, v - 2.0 * pgHalf.y));
        float a = fillAA(dpg, 1.0);
        if (a > 0.0 && tt > 0.0) {
          vec2 lq = vec2(u + pgHalf.x, v);
          vec3 c;
          // 光從左上、鏡頭方向：翻過來的角度決定亮暗
          float shade = 0.82 + 0.22 * abs(dot(n, normalize(vec3(-0.3, -0.5, 0.8))));
          if (dn < 0.0) {
            c = pageC(lq);
            vec4 dt = layerAt(datePg, lq / (2.0 * pgHalf));
            c = c * (1.0 - dt.a) + dt.rgb;
          } else {
            c = pageC(lq) * 0.9;
          }
          col = mix(col, c * shade, a);
        }
      }
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, datePg: { value: null }, hasTxt: { value: 0 }, ...camUniforms(),
  lyr: { value: null }, hasLyr: { value: 0 }, lyS: { value: new THREE.Vector2(1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  pgC: { value: new THREE.Vector2() }, pgHalf: { value: new THREE.Vector2() }, phC: { value: new THREE.Vector2() }, phHalf: { value: new THREE.Vector2() }, lod: { value: 0 },
  txO: { value: new THREE.Vector2() }, txS: { value: new THREE.Vector2(1, 1) },
  tearH: { value: new THREE.Vector3() }, tearTh: { value: 0 }, tearPhi: { value: 0 }, torn: { value: 0 }, t: { value: 0 }, k: { value: 1 },
});

export default class TearCal extends P9Plate {
  bg = shared('tearcal.bg', BG);
  txt: Layer2D | null = null;
  /** 有主字時歌詞印在紅色的頭上（自己一張圖層）。 */
  lyr: Layer2D | null = null;
  datePg: Layer2D | null = null;
  words: Words | null = null;
  /** 字在照片下面（橫的照片）或右邊（直的照片、字多的時候）。 */
  below = true;
  pgW = 0; pgH = 0; pgX = 900; pgY = 600;
  phW = 0; phH = 0; phX = 0; phY = 0;
  txX = 0; txY = 0;
  tTear = 0;
  side = 1;

  override async init() {
    await this.loadPhoto(DATE_GLYPHS);
    await loadText(DATE_GLYPHS);
    const { end } = this.ctx;
    const img = this.img;
    const probe = document.createElement('canvas').getContext('2d')!;
    const pw = photoWords(this.ctx);
    if (pw.kind === 'none' && !pw.lyrics) this.fitPage(null, true);
    else {
      // 字在照片下面或右邊：兩種都排排看，照片放得比較大的那種（橫的照片偏好下面、直的偏好右邊）
      const land = img.w / img.h >= 1.15;
      const wb = this.makeWords(probe, true), wr = this.makeWords(probe, false);
      const ab = this.fitPage(wb, true), ar = this.fitPage(wr, false);
      if (land ? ab >= ar * 0.8 : ab > ar * 1.25) this.fitPage(wb, true);
      const words = this.words!;
      this.txt = this.track(new Layer2D(Math.ceil(words.st.w + 40), Math.ceil(words.height + 30), undefined, { fast: true }));
      // 歌詞在紅色的頭上：燙金框裡（高 114）上下置中
      if (words.apart) this.lyr = this.track(new Layer2D(LYR_W + 40, 114, undefined, { fast: true }));
    }
    this.side = hash(this.seed, 4) < 0.5 ? -1 : 1;
    this.drawDatePage();
    this.tTear = this.cue(0.35, 0.95);
    this.words?.writeFrom(this.tTear + 0.65, Math.max(0.6, Math.min(2.2, (end - this.tTear - 0.65) * 0.5)));
  }

  /** 日曆紙上的字（主字＋署名）；有主字也有歌詞時歌詞另外印在紅色的頭上（lyricsApart）。 */
  private makeWords(probe: CanvasRenderingContext2D, below: boolean) {
    const gold = mixRgba('fur', 'bone', 0.45);
    return new Words(this.ctx, probe, {
      family: F.ming(700), w: below ? 640 : 470, h: below ? 300 : 580, min: 40, max: 50, lineHeight: 1.36, maxLines: below ? 4 : 6,
      align: below ? 'center' : 'left',
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.4), sigInk: rgba('sepia', 0.75), sigSize: 28,
      album: { family: F.ming(700), size: 22, color: rgba('sepia', 0.55) },
      lyricsApart: true,
      lyricBox: { w: LYR_W, align: 'center', ink: gold, unsung: mixRgba('fur', 'bone', 0.45, 0.38), active: mixRgba('signal', 'bone', 0.45), lyricSubSize: 40 },
    });
  }

  /**
   * 頁面的大小、照片與字的位置。歌詞印在頭上時整本（頭＋頁面）都要在畫面裡，頁面矮一點；
   * 放不下就把照片縮小。回傳照片的面積（選版面用）。
   */
  private fitPage(words: Words | null, below: boolean) {
    this.words = words; this.below = below;
    const apart = !!words?.apart;
    const maxH = apart ? 680 : 760;
    let bw = words ? (below ? 640 : 520) : 720, bh = words ? (below ? 500 : 620) : 700;
    for (let i = 0; i < 12; i++) {
      const ph = fitPhoto(this.img, bw, bh);
      this.phW = ph.w; this.phH = ph.h;
      this.layout(apart);
      if (this.pgH <= maxH && this.pgW <= 1100) break;
      bw *= 0.94; bh *= 0.94;
    }
    return this.phW * this.phH;
  }

  private layout(apart: boolean) {
    const words = this.words, phW = this.phW, phH = this.phH;
    if (!words) this.pgW = Math.max(560, phW + 80);
    else if (this.below) this.pgW = Math.max(720, phW + 80, words.st.w + 60);
    else this.pgW = 40 + phW + 50 + Math.max(240, words.width) + 40;
    this.pgH = !words ? 46 + phH + 44 : this.below ? 46 + phH + 34 + words.height + 30 + 44 : 46 + Math.max(phH, words.height) + 44;
    // 歌詞在頭上：整本（頭＋頁面）置中；字在右邊時字整塊在 x < 1340（右下角的 HUD）
    this.pgY = apart ? 540 + 76 : 600;
    this.pgX = this.below ? 900 : Math.min(900, 1380 - this.pgW / 2);
    const top = this.pgY - this.pgH / 2, left = this.pgX - this.pgW / 2;
    if (!words || this.below) {
      this.phX = this.pgX; this.phY = top + 46 + phH / 2;
      if (words) { this.txX = this.pgX - words.st.w / 2 - 20; this.txY = top + 46 + phH + 34 - 10; }
    } else {
      const inner = Math.max(phH, words.height);
      this.phX = left + 40 + phW / 2; this.phY = top + 46 + inner / 2;
      this.txX = left + 40 + phW + 50 - 20; this.txY = top + 46 + (inner - words.height) / 2 - 10;
    }
  }

  /** 日期那一頁（撕下來的那一頁）：年、月、星期、大大的日期；沒有日期時大字是「吉日」。 */
  private drawDatePage() {
    const W = Math.ceil(this.pgW), Hh = Math.ceil(this.pgH);
    const L = this.track(new Layer2D(W, Hh, undefined, { fast: true }));
    this.datePg = L;
    const c = L.ctx;
    L.clear();
    const red = rgba('collar', 0.92), ink = rgba('sepia', 0.85);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    const cx = W / 2;
    if (DATE) {
      c.font = font(F.mono(500), 24);
      c.fillStyle = ink;
      c.textAlign = 'left';
      c.fillText(`${DATE.yyyy}`, 46, 78);
      c.textAlign = 'right';
      c.font = font(F.ming(900), 34);
      c.fillStyle = red;
      c.fillText(`${MONTH[DATE.m - 1]}月`, W - 46, 80);
      c.textAlign = 'center';
      const big = Math.min(Hh * 0.46, W * 0.62);
      c.font = font(F.archivo(62, 900), big);
      c.fillStyle = red;
      c.fillText(String(DATE.d), cx, Hh * 0.2 + big * 0.82);
      const wd = new Date(DATE.y, DATE.m - 1, DATE.d).getDay();
      c.font = font(F.ming(700), 40);
      c.fillStyle = ink;
      c.letterSpacing = '10px';
      c.fillText(`星期${WEEK[wd]}`, cx + 5, Hh * 0.2 + big + 40);
      c.letterSpacing = '0px';
    } else {
      // 還沒定日期：不印數字
      const big = Math.min(Hh * 0.3, W * 0.36);
      c.font = font(F.ming(900), big);
      c.fillStyle = red;
      c.fillText('吉日', cx, Hh * 0.22 + big);
    }
    c.strokeStyle = rgba('sepia', 0.35);
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(46, Hh - 120); c.lineTo(W - 46, Hh - 120); c.stroke();
    c.font = font(F.ming(700), 30);
    c.fillStyle = ink;
    c.letterSpacing = '8px';
    c.fillText('宜：嫁娶．祝福', cx + 4, Hh - 66);
    c.letterSpacing = '0px';
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    const top = this.pgY - this.pgH / 2;
    (u.pgC!.value as THREE.Vector2).set(this.pgX, this.pgY);
    (u.pgHalf!.value as THREE.Vector2).set(this.pgW / 2, this.pgH / 2);
    (u.phC!.value as THREE.Vector2).set(this.phX, this.phY);
    (u.phHalf!.value as THREE.Vector2).set(this.phW / 2, this.phH / 2);
    // 撕：下緣先翹起來 → 往上翻 → 撕開、旋轉著往右上飛走
    const tt = this.tTear;
    const lift = 14 * ease.inOutQuad(prog(t, tt - 0.45, tt)) * RAD;
    const flip = ease.inCubic(prog(t, tt, tt + 0.38));
    const fly = ease.inQuad(prog(t, tt + 0.3, tt + 1.25));
    const th = lift + flip * 150 * RAD + fly * 60 * RAD;
    u.tearTh!.value = fly >= 1 ? -1 : th;
    u.torn!.value = prog(t, tt + 0.22, tt + 0.3);
    u.tearPhi!.value = this.side * fly * 50 * RAD;
    (u.tearH!.value as THREE.Vector3).set(this.pgX + this.side * fly * 1300, top - fly * 900, 15 + fly * 500);
    // 鏡頭：撕下來之後推近到照片那一頁；歌詞印在頭上時看整本（頭＋頁面都在畫面裡）
    const apart = !!this.lyr;
    const pushIn = ease.inOutCubic(prog(t, tt + 0.2, tt + 1.6));
    const drift = 1 - Math.exp(-lt / 8);
    const zEnd = apart ? Math.min(1.04, 920 / (this.pgH + 220)) : 1.04;
    const zoom = lerp(zEnd - 0.06, zEnd, pushIn) + 0.025 * drift;
    const cy = apart ? this.pgY - 76 : this.pgY;
    setCam(u, {
      x: this.pgX + 60 * this.side * (1 - pushIn) + 12 * drift * this.side, y: lerp(cy - 40, cy + 4, pushIn), z: 0, dist: DIST, zoom,
      yaw: this.side * lerp(9, 4, pushIn) * RAD, pitch: lerp(-3, -1.5, pushIn) * RAD, roll: this.side * 0.4 * RAD,
    });
    // 焦點：撕開之後，那一頁上的照片往焦點推（印刷品 1.18 倍；很小的舊照片少推）
    const crop = this.focus(t, tt + 0.3, this.phW / this.phH, { zoom: 1.18, screenW: this.phW * zoom });
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.lod!.value = this.lod(this.phW * zoom, crop[2] - crop[0]);
    u.t!.value = t;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    u.photo!.value = this.tex;
    u.datePg!.value = this.datePg!.texture;
    u.hasTxt!.value = this.words ? 1 : 0;
    // shader 是共用的：沒有字的窗格也要換掉上一個窗格（已經釋放）的字圖層
    u.txt!.value = this.tex;
    if (this.words && this.txt) {
      const L = this.txt;
      if (this.words.draw(L.ctx, t, 20, 10, () => L.clear())) L.upload();
      u.txt!.value = L.texture;
      (u.txO!.value as THREE.Vector2).set(this.txX, this.txY);
      (u.txS!.value as THREE.Vector2).set(L.w, L.h);
    }
    // 頭上的歌詞（燙金框裡上下置中，位置整個窗格不變）
    u.hasLyr!.value = this.lyr ? 1 : 0;
    u.lyr!.value = this.tex;
    if (this.words && this.lyr) {
      const L = this.lyr;
      if (this.words.drawLyrics(L.ctx, t, 20, (L.h - this.words.lyricH) / 2 - 3, () => L.clear())) L.upload();
      u.lyr!.value = L.texture;
      (u.lyS!.value as THREE.Vector2).set(L.w, L.h);
    }
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.3 };
  }
}
