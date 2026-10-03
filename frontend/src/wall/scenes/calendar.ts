// 照片版面「月曆」（亮，P8 印刷品）：一本掛在白牆上的月曆，這個月的照片是新人的照片——
//  - 月曆用鐵圈裝訂、鐵絲掛在牆上的釘子上。左邊是照片，右邊是婚禮那個月的日期格（婚禮的年月，週日是紅字），
//    婚禮那天在一個拍點被訊號色的筆一筆圈起來。還沒定日期：不畫日期格，月曆只剩照片和字（像月曆的封面頁）。
//  - 進場：上個月那一頁在第一拍「翻上去」（繞著鐵圈往上翻過頂、露出這個月），整本月曆被帶得晃兩下再停住。
//  - 字（_photo.ts 的 PhotoText，思源宋體）：主字是賓客留言＋署名，或新人的註解；沒有主字時歌詞自己當主字。
//    橫的照片：主字印在照片下面，歌詞印在右欄日期格下面的記事欄（同一張紙的另一欄，位置固定）。
//    直的照片：照片佔滿整頁高，字整塊（主字＋歌詞）印在右欄日期格下面，右欄跟著加寬、月曆跟著加高。
//    兩個都沒有就只有照片（與日期格）。
//  - 照片完整印出，印出來的畫面慢慢往新人點的焦點推（1.15 倍）；很小的舊照片最多放大到原尺寸約 1.5 倍。
//  - 鏡頭很慢地推近、往右搖一點；窗光很淡地斜照在牆上。右下角（HUD）是牆或月曆右欄下面的空白格線，不印字。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { DATE, beatAfter } from './_motifs';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, homographyPx, textFits, PAPER_INK, type Plane, type Quad, type PressTextStyle } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', paper: true, energy: [0, 0.8], bars: [2, 8], weight: 1, prefers: ['landscape'] };

const WALL = { w: 2800, h: 1800 };
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const M = 44;
/** 右欄：寬、月份標題高、日期格（每格寬高）。 */
const RW = 470, HEAD_H = 92, CELL_W = 64, CELL_H = 46, WEEK_H = 34;
/** 日期格的下緣（頁面座標）、照片那一欄的標準高度。 */
const GRID_B = M + 20 + HEAD_H + WEEK_H + 6 * CELL_H, INNER = 720;

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D grid; uniform sampler2D cap; uniform sampler2D lyr;
  uniform mat3 mWall; uniform mat3 mFlip; uniform vec2 pg; uniform vec2 pagePos; uniform vec2 nail; uniform float sway; uniform float rw;
  uniform vec4 pr; uniform vec4 crop; uniform float photoPx; uniform vec4 capRect; uniform vec4 lyrRect; uniform vec4 circ; uniform float circP;
  uniform float flipA; uniform float flipBack; uniform float k; uniform float t;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = homo(mWall, p);
    float s = homoScale(mWall, p);
    // 牆：白牆、很淡的灰泥紋，窗光斜斜一大片
    float n = fbm(q / 180.0, 3);
    vec3 col = mix(C_BONE, C_PAPER, 0.55) * (0.86 + 0.03 * n);
    float lit = dot(q - vec2(t * 5.0, 0.0), normalize(vec2(0.8, 0.6)));
    col *= 0.9 + 0.12 * smoothstep(2600.0, 900.0, lit);
    // 月曆的座標：繞著釘子晃
    vec2 nl = pagePos + nail;
    vec2 pq = rot2(-sway) * (q - nl) + nail;
    vec2 pqs = rot2(-sway) * (q - vec2(14.0, 22.0) - nl) + nail;
    // 影子
    float sh = exp(-outsideDist(pqs, pg) / 22.0);
    col *= 1.0 - 0.22 * sh;
    // 釘子與鐵絲掛鉤
    float dn = length(q - nl);
    col *= 1.0 - 0.3 * exp(-length(q - nl - vec2(5.0, 7.0)) / 7.0);
    vec2 hk1 = vec2(pg.x * 0.5 - 110.0, -4.0), hk2 = vec2(pg.x * 0.5 + 110.0, -4.0);
    float wire = min(sdSegment(pq, hk1, nail), sdSegment(pq, hk2, nail));
    col = mix(col, C_GRAPHITE * 0.7, (1.0 - smoothstep(0.7, 1.7, wire / max(s, 0.5))) * 0.9);
    col = mix(col, mix(C_ASH, C_BONE, 0.3) * 0.8, 1.0 - smoothstep(5.0, 6.5, dn));
    // 這一頁
    float a = edgeA(pq, pg, s);
    if (a > 0.0) {
      vec3 paper = mix(C_BONE, C_PAPER, 0.25) * (0.94 + 0.02 * paperFiber(pq));
      vec3 pc = paper;
      vec2 uv = (pq - pr.xy) / pr.zw;
      float inPh = edgeA(pq - pr.xy, pr.zw, s);
      if (inPh > 0.0) {
        float lod = log2(max(s * photoPx / pr.z, 1e-4) / PX_SCALE);
        vec3 ph = photoLin(photo, cropUv(crop, uv), lod);
        // 月曆紙的霧面：最亮的地方也是紙色，不發光
        pc = mix(pc, ph * mix(vec3(1.0), paper / max(luma(paper), 0.01), 0.15), inPh);
      }
      vec4 gc = layerAt(grid, pq / pg);
      pc = pc * (1.0 - gc.a) + gc.rgb;
      vec4 cc = layerAt(cap, (pq - capRect.xy) / capRect.zw);
      pc = pc * (1.0 - cc.a) + cc.rgb;
      vec4 lc = layerAt(lyr, (pq - lyrRect.xy) / lyrRect.zw);
      pc = pc * (1.0 - lc.a) + lc.rgb;
      // 婚禮那天：訊號色的筆圈起來（一筆畫，起筆、收筆有一點重疊）
      if (circP > 0.0) {
        vec2 d = (pq - circ.xy) / circ.zw;
        float ang = atan(d.y, d.x);
        float wob = 1.0 + 0.05 * sin(ang * 3.0 + 1.3) + 0.03 * sin(ang * 7.0);
        float r = length(d) / wob;
        float sweep = fract((ang + 2.2) / 6.2832);
        float drawn = step(sweep, circP * 1.08);
        float ring = 1.0 - smoothstep(0.0, 1.2, abs(r - 1.0) * circ.z / 2.6 - 0.6);
        pc = mix(pc, mix(C_BLOOD, C_SIGNAL, 0.35) * 0.9, ring * drawn * 0.9);
      }
      // 鐵圈：頁面上緣一排小洞與鐵環
      float rx = mod(pq.x - 12.0, 24.0) - 12.0;
      float hole = 1.0 - smoothstep(3.0, 4.2, length(vec2(rx, pq.y - 14.0)));
      pc = mix(pc, C_INK2 * 0.8, hole * step(30.0, pq.x) * step(pq.x, pg.x - 30.0));
      col = mix(col, pc, a);
    }
    // 上個月那一頁（翻上去中）：正面是淡淡的格子與一塊灰，翻過頂之後是紙背
    if (flipA > 0.0) {
      vec2 fq = homo(mFlip, q);
      float fs = homoScale(mFlip, q) * s;
      float fa = edgeA(fq, pg, fs);
      if (fa > 0.0) {
        vec3 fc = mix(C_BONE, C_PAPER, 0.3) * 0.93;
        if (flipBack < 0.5) {
          // 上個月的照片（另一張，看不清楚：同一張照片很糊、褪色）與日期格的細線
          vec2 fu = (fq - pr.xy) / pr.zw;
          float blk = edgeA(fq - pr.xy, pr.zw, fs);
          vec3 old = photoLin(photo, vec2(1.0) - fu * 0.8, 6.0);
          fc = mix(fc, mix(vec3(luma(old)), old, 0.4) * 0.85 + fc * 0.25, blk * 0.8);
          vec2 g0 = vec2(pg.x - rw - ${M}.0, ${M + 20 + HEAD_H + WEEK_H}.0);
          vec2 gl = abs(fract((fq - g0) / vec2(${CELL_W}.0, ${CELL_H}.0)) - 0.5);
          float inG = step(g0.x, fq.x) * step(fq.x, g0.x + ${7 * CELL_W}.0) * step(g0.y, fq.y) * step(fq.y, g0.y + ${6 * CELL_H}.0);
          fc = mix(fc, C_SEPIA * 0.6, smoothstep(0.47, 0.5, max(gl.x, gl.y)) * inG * 0.3);
        }
        fc *= flipA;
        col = mix(col, fc, fa);
      }
    }
    // 鐵環（在頁面上緣外面一點，金屬的亮邊）
    {
      float rx = mod(pq.x - 12.0, 24.0) - 12.0;
      float ring = abs(length(vec2(rx * 1.6, pq.y - 4.0)) - 10.0);
      float on = step(30.0, pq.x) * step(pq.x, pg.x - 30.0) * step(pq.y, 14.0) * step(-8.0, pq.y);
      col = mix(col, mix(C_GRAPHITE, C_BONE, 0.35 + 0.4 * smoothstep(-6.0, 6.0, rx)), (1.0 - smoothstep(1.0, 2.2, ring)) * on);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, grid: { value: null }, cap: { value: null }, lyr: { value: null },
  mWall: { value: new THREE.Matrix3() }, mFlip: { value: new THREE.Matrix3() }, pg: { value: new THREE.Vector2() }, pagePos: { value: new THREE.Vector2() },
  nail: { value: new THREE.Vector2() }, sway: { value: 0 }, rw: { value: RW }, pr: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  photoPx: { value: 1 }, capRect: { value: new THREE.Vector4() }, lyrRect: { value: new THREE.Vector4() }, circ: { value: new THREE.Vector4() }, circP: { value: 0 },
  flipA: { value: 0 }, flipBack: { value: 0 }, k: { value: 1 }, t: { value: 0 },
});

type R = [number, number, number, number];

export default class Calendar extends PressPlate {
  bg = shared('calendar.bg', BG);
  grid!: Layer2D;
  cap!: Layer2D;
  /** 歌詞另外印在記事欄時的圖層（橫的照片、有主字也有歌詞）。 */
  lyr!: Layer2D;
  dated = !!DATE;
  /** 頁面大小（設計 px）、照片（頁面座標）、字（頁面座標）、記事欄的歌詞（頁面座標）、婚禮那天的格子中心。 */
  pw = 0; phh = 0;
  pr: R = [0, 0, 0, 0];
  capR: R = [0, 0, 0, 0];
  lyrR: R = [0, 0, 0, 0];
  circle: [number, number] = [0, 0];
  /** 右欄的寬（直的照片有字時加寬，字才放得下）。 */
  rw = RW;
  /** 頁面左上角在牆上的位置。 */
  pageX = 0; pageY = 0;
  tFlip = 0; tCirc = 0;

  override async init() {
    const { start, audio } = this.ctx;
    await this.loadPhoto(`${WEEK.join('')}${MONTHS.join('')}0123456789 ·`);
    const a = this.aspect, tx = this.hasText;
    const st = (w: number, h: number, o: Partial<PressTextStyle> = {}): PressTextStyle => ({ family: F.ming(400), w, h, min: 40, max: 48, lineHeight: 1.36, ...PAPER_INK(), ...o });
    /** 排字：先照四行排，60 字的留言放不下就多折幾行。回傳整塊要佔的高度（頂到最後一行的下緣）。 */
    const layText = (w: number, h: number, o: Partial<PressTextStyle> = {}) => {
      if (!textFits(this.makeText(st(w, h, o)), h)) this.makeText(st(w, h, { ...o, maxLines: 7 }));
      return tx ? this.text.height + this.text.size * 0.35 : 0;
    };
    const sc = (w: number) => Math.min(1, (this.img.w * 1.5) / w);
    let w: number, h: number, colH = 0, need = 0;
    if (this.dated) {
      if (a >= 1.1) {
        // 橫的：照片在左上、主字在照片下面；有主字又有歌詞時，歌詞印在右欄日期格下面的記事欄（另一欄，位置固定）。
        // 先排字（欄寬約照片寬），照片用剩下的高度
        w = Math.min(860, INNER * a); w *= sc(w);
        const tw = clamp(w, 600, 760);
        need = layText(tw, 360, { lyricsApart: true, lyricW: RW });
        h = Math.min(w / a, INNER - (tx ? 30 + need : 0)); w = h * a;
        this.pr = [M, M + 20, w, h];
        this.capR = [M, M + 20 + h + 30, Math.max(w, tw), need];
        // 記事欄：日期格下面，頂跟主字的頂對齊（太高就貼著日期格）
        if (this.text.apart) this.lyrR = [0, Math.max(GRID_B + 40, this.capR[1]), RW, this.text.lyricH + this.text.lyricSize * 0.4];
        colH = Math.max(h + (tx ? 30 + need : 0), GRID_B - M - 20 + 60, this.lyrR[1] + this.lyrR[3] + 24 - M - 20);
        this.pw = M + this.capR[2] + 56 + RW + M;
        this.lyrR[0] = this.pw - M - RW;
      } else {
        // 直的：照片佔滿整頁高，字整塊印在右欄的日期格下面；右欄加寬、月曆加高到放得下（最高 840）
        this.rw = tx ? 560 : RW;
        const gy = GRID_B + 34;
        need = layText(this.rw, 840 - (gy - M - 20));
        h = clamp(gy - M - 20 + need, INNER, 840); w = h * a;
        const k = Math.min(1, (this.img.h * 1.5) / h); w *= k; h *= k;
        this.pr = [M, M + 20, w, h];
        this.capR = [M + w + 56, gy, this.rw, need];
        colH = Math.max(h, gy - M - 20 + need);
        this.pw = M + w + 56 + this.rw + M;
      }
    } else {
      // 沒有日期：只有照片和字（月曆的封面頁），字在照片下面置中
      w = a >= 1 ? Math.min(900, INNER * a) : INNER * a; w *= sc(w);
      const tw = clamp(w, 640, 900);
      need = layText(tw, 380, { align: 'center' });
      h = Math.min(w / a, INNER - (tx ? 30 + need : 0)); w = h * a;
      const pw = Math.max(w, tx ? tw : 0);
      this.pr = [M + (pw - w) / 2, M + 20, w, h];
      this.capR = [M, M + 20 + h + 30, pw, need];
      colH = h + (tx ? 30 + need : 0);
      this.pw = M + pw + M;
    }
    this.phh = Math.round(M + 20 + colH + M);
    this.pw = Math.round(this.pw);
    this.pageX = WALL.w / 2 - this.pw / 2 - 60;
    this.pageY = WALL.h / 2 - this.phh / 2 + 30;
    this.grid = this.track(new Layer2D(this.pw, this.phh, SCALE, { fast: true }));
    this.cap = this.track(new Layer2D(Math.max(40, this.capR[2]) + 10, Math.max(40, this.capR[3]) + 20, SCALE, { fast: true }));
    this.lyr = this.track(new Layer2D(Math.max(40, this.lyrR[2]) + 10, Math.max(40, this.lyrR[3]) + 20, SCALE, { fast: true }));
    this.drawGrid();
    this.cap.upload();
    this.lyr.upload();
    // 翻頁在第一拍、圈日期在第二個小節線（窗格太短就在翻完之後一拍）
    this.tFlip = beatAfter(audio, start + 0.45);
    this.tCirc = Math.min(beatAfter(audio, this.tFlip + 1.4), Math.max(this.tFlip + 0.8, this.ctx.end - 1.6));
  }

  /** 右欄：月份、星期、日期格；右欄下面幾條記事的格線（不印字）。 */
  private drawGrid() {
    const L = this.grid, c = L.ctx;
    L.clear();
    if (!this.dated) { L.upload(); return; }
    const d = DATE!;
    const x0 = this.pw - M - this.rw, y0 = M + 20;
    // 月份：小小的兩位數＋英文月名與年份
    c.textBaseline = 'alphabetic';
    c.font = font(F.serif(600), 46);
    c.fillStyle = rgba('sepia', 0.9);
    const mm = String(d.m).padStart(2, '0');
    c.fillText(mm, x0, y0 + 42);
    const mw = c.measureText(mm).width;
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.62);
    c.fillText(`${MONTHS[d.m - 1]} · ${d.yyyy}`, x0 + mw + 18, y0 + 38);
    c.letterSpacing = '0px';
    c.fillStyle = rgba('sepia', 0.35);
    c.fillRect(x0, y0 + 64, this.rw, 1.5);
    // 星期（週日紅字）
    const gy = y0 + HEAD_H;
    c.font = font(F.hei(500), 17);
    c.textAlign = 'center';
    WEEK.forEach((wd, i) => {
      c.fillStyle = i === 0 ? rgba('collar', 0.85) : rgba('sepia', 0.55);
      c.fillText(wd, x0 + CELL_W * (i + 0.5) + 3, gy + 20);
    });
    // 日期
    const first = new Date(d.y, d.m - 1, 1).getDay();
    const days = new Date(d.y, d.m, 0).getDate();
    c.font = font(F.archivo(75, 500), 25);
    for (let day = 1; day <= days; day++) {
      const k = first + day - 1, col = k % 7, row = Math.floor(k / 7);
      const cx = x0 + CELL_W * (col + 0.5) + 3, cy = gy + WEEK_H + row * CELL_H + 26;
      c.fillStyle = col === 0 ? rgba('collar', 0.85) : rgba('sepia', 0.85);
      c.fillText(String(day), cx, cy);
      if (day === d.d) this.circle = [cx, cy - 9];
    }
    c.textAlign = 'left';
    // 橫的照片：右欄下面幾條記事的格線（直的這裡印字）；歌詞印在記事欄時，格線從歌詞下面開始（線不穿過字）
    if (this.aspect >= 1.1) {
      c.fillStyle = rgba('sepia', 0.14);
      const ly0 = this.lyrR[3] > 0 ? this.lyrR[1] + this.lyrR[3] + 30 : GRID_B + 40;
      for (let y = ly0; y < this.phh - M; y += 44) c.fillRect(x0, y, RW, 1.2);
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const wall: Plane = { x: W / 2, y: H / 2, w: WALL.w, h: WALL.h, ry: 5 * (Math.PI / 180) };
    const cam = { f: 1700, zoom: 0.92 + 0.045 * z0, cx: W / 2 - 60, cy: H / 2 + 20, dx: -20 * ease.inOutQuad(clamp(lt / 12)), dy: 0 };
    const u = this.bg.u;
    homographyPx(planeQuad(wall, cam), WALL.w, WALL.h, u.mWall!.value as THREE.Matrix3);
    const nail: [number, number] = [this.pw / 2, -66];
    (u.pg!.value as THREE.Vector2).set(this.pw, this.phh);
    (u.pagePos!.value as THREE.Vector2).set(this.pageX, this.pageY);
    (u.nail!.value as THREE.Vector2).set(...nail);
    // 翻頁：0.45 秒翻過頂；之後整本被帶得晃兩下再停
    const tf = this.tFlip - 0.2;
    const th = Math.PI * ease.inOutQuad(prog(t, tf, tf + 0.45));
    const after = t - (tf + 0.45);
    const sway = after > 0 ? 0.012 * Math.exp(-after / 0.7) * Math.sin(after * 7.5) : 0;
    u.sway!.value = sway;
    if (th > 0 && th < Math.PI - 0.02 && Math.abs(Math.cos(th)) > 0.015) {
      // 上個月那一頁：上緣（鐵圈）不動，下緣往鏡頭翻起來再翻過頂（下緣離鏡頭越近越寬）
      const ph = this.phh, pw = this.pw, x0 = this.pageX, y0 = this.pageY;
      const yb = y0 + ph * Math.cos(th), grow = 1 + 0.22 * Math.sin(th);
      const cx = x0 + pw / 2;
      const quad: Quad = [[x0, y0], [x0 + pw, y0], [cx + (pw / 2) * grow, yb], [cx - (pw / 2) * grow, yb]];
      homographyPx(quad, pw, ph, u.mFlip!.value as THREE.Matrix3);
      u.flipA!.value = 0.75 + 0.25 * Math.abs(Math.cos(th));
      u.flipBack!.value = th > Math.PI / 2 ? 1 : 0;
    } else u.flipA!.value = 0;
    // 翻之前看到的是上個月那一頁（蓋在這一頁上面）
    if (t < tf) {
      const quad: Quad = [[this.pageX, this.pageY], [this.pageX + this.pw, this.pageY], [this.pageX + this.pw, this.pageY + this.phh], [this.pageX, this.pageY + this.phh]];
      homographyPx(quad, this.pw, this.phh, u.mFlip!.value as THREE.Matrix3);
      u.flipA!.value = 1; u.flipBack!.value = 0;
    }
    (u.pr!.value as THREE.Vector4).set(...this.pr);
    // 印出來的照片往焦點推（印在紙上，1.15 倍）
    const crop = this.pushCrop(lt, this.pr[2] / this.pr[3], 1.15, this.pr[2] * 0.95);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    u.grid!.value = this.grid.texture;
    u.rw!.value = this.rw;
    // 字：主字（＋歌詞）印在照片下面或右欄；歌詞另外印在記事欄時自己一層
    if (this.hasText) {
      this.paintText(this.cap, t, this.dated ? 0 : this.capR[2] / 2, 0);
      if (this.text.apart && this.text.drawLyrics(this.lyr.ctx, t, 0, 0, { clear: () => this.lyr.clear() })) this.lyr.upload();
    }
    u.cap!.value = this.cap.texture;
    (u.capRect!.value as THREE.Vector4).set(this.capR[0], this.capR[1], this.cap.w, this.cap.h);
    u.lyr!.value = this.lyr.texture;
    (u.lyrRect!.value as THREE.Vector4).set(this.lyrR[0], this.lyrR[1], this.lyr.w, this.lyr.h);
    (u.circ!.value as THREE.Vector4).set(this.circle[0], this.circle[1], 30, 24);
    u.circP!.value = this.dated ? ease.inOutQuad(prog(t, this.tCirc, this.tCirc + 0.55)) : 0;
    u.t!.value = lt;
    u.k!.value = (0.94 + 0.06 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return PHOTO_POST(true);
  }
}
