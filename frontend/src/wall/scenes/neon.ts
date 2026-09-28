// 霓虹招牌（暗）：夜裡一面漆成深灰的磚牆，牆上直接掛著霓虹燈管，燈光把磚牆染上顏色。
//  - 畫面的焦點＝主打留言：手寫體（霞鶩文楷）彎成的霓虹字，大大地掛在牆中間；第一拍開始一個字一個字通電點亮
//    （「啪、啪」閃兩下，剛亮是訊號色、半秒後變白色燈管），留言裡的愛心是一圈玫瑰色的愛心燈管；署名是下面小一號的一排。
//  - 歌詞＝上面一排細細的黑體燈管（比留言小一級）：還沒唱的是沒通電的玻璃管（看得到、讀得到），唱到的那一刻通電點亮成訊號色，
//    唱完轉成白色燈管；換句時整排熄掉、換上新的玻璃管。偶爾有一個字「滋」地暗一下（每小節最多一次，確定性）。
//    沒有留言時歌詞是主角：大大的一排掛在中間，下面一行小小的邀請。純音樂：歌名整排亮著。
//  - 右上角一顆會動的霓虹愛心：大小兩圈燈管一拍換一次（老招牌的兩格動畫），下面漆著小小的「營業時間：永遠」。
// 手法：燈管用 Canvas2D 畫（玻璃管一層、通電發光的一層加亮疊上去才會發光）；另外把「亮著的燈管」畫在一張 1/4 大小的光圖上，
// 磚牆的 shader 用不同的 mip 層取樣這張光圖，算出燈管旁邊的光暈與打在磚牆上的大片色光（燈亮到哪、牆就亮到哪）。鏡頭慢慢推近。
// 2026-09-29 依「MV 融合原則」：留言變成最大的那組燈管、歌詞縮小一級；拿掉壓克力背板（像卡片）、「營業中」大字與編號。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, frameIdx } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, lyricSizeFor, beatAfter, signature, heartPoints, type LyricLayout } from './_motifs';
import { stagger } from './_t11';
import type { Rect } from './_t9';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.15, 0.8], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 有留言時：歌詞在上面一排（小）、留言在中間（大）。 */
const LYR_S = { x: 150, y: 212, w: 1300 };
const MSG_BOX = { x: 150, y: 318, w: 1340, h: 470 };
/** 沒有留言時：歌詞大大地在中間，邀請在下面。 */
const LYR_B = { x: 150, y: 470, w: 1400, size: 132, min: 76 };
const FAM_LYR = F.hei(300);
const FAM_MSG = F.hand(400);
const HEART = { x: 1660, y: 196, r: 84 };
const INVITE = '掃描右下角 QR code，把你的祝福點亮';
/** 光圖的縮小倍數。 */
const LS = 0.25;

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D light; uniform float gain; uniform float t;
  vec3 L(vec2 uv, float lod) { vec3 v = textureLod(light, uv, lod).rgb; return C_SIGNAL * v.r + mix(C_BONE, C_EMBER, 0.35) * v.g + C_ROSE * v.b; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    // 光：近的（燈管旁邊的光暈）與遠的（打在牆上的大片光），在光圖的不同 mip 層取樣、繞一圈平均
    vec3 near = L(uv, 1.2) * 0.5, wide = vec3(0.0), far = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785 + 0.3;
      vec2 d = vec2(cos(a), sin(a));
      near += L(uv + d * vec2(18.0 / ${W}.0, 18.0 / ${H}.0), 1.8) * 0.0625;
      wide += L(uv + d * vec2(70.0 / ${W}.0, 70.0 / ${H}.0), 3.2) * 0.125;
      far += L(uv + d * vec2(210.0 / ${W}.0, 210.0 / ${H}.0), 5.0) * 0.125;
    }
    // 磚：88×30（含 5 px 灰縫），一排錯半塊
    float row = floor(p.y / 30.0);
    vec2 q = vec2(mod(p.x + mod(row, 2.0) * 44.0 + 7.0, 88.0), mod(p.y, 30.0));
    vec2 id = vec2(floor((p.x + mod(row, 2.0) * 44.0 + 7.0) / 88.0), row);
    float h = hash12(id);
    float ex = min(q.x - 2.5, 85.5 - q.x), ey = min(q.y - 2.5, 27.5 - q.y);
    float e = min(ex, ey) + 1.2 * snoise(p / 7.0) + 0.8 * snoise(p / 2.3);
    float face = smoothstep(0.0, 2.2, e);
    // 漆過的磚面：顆粒、每塊深淺不一、偶爾掉漆的小坑
    float grain = 0.75 + 0.18 * snoise(p / 5.0) + 0.1 * fbm(p / 40.0 + h * 9.0, 3);
    float pit = smoothstep(0.62, 0.72, snoise(p / 11.0 + h * 31.0)) * 0.35;
    vec3 alb = mix(C_GRAPHITE * 0.5, C_ASH * 0.42, 0.25 + 0.5 * h) * grain * (1.0 - pit);
    alb = mix(alb * 0.35, alb, face);
    // 磚的上緣接到一點光（燈大多在上面），下緣暗
    float bevel = (smoothstep(3.0, 0.0, abs(q.y - 3.5)) - 0.6 * smoothstep(3.0, 0.0, abs(q.y - 26.5))) * face;
    vec3 lit = wide * 0.55 + far * 0.45;
    vec3 col = alb * (0.05 + lit * gain * 2.4 * (1.0 + 0.4 * bevel));
    // 燈管周圍的光暈（空氣裡的光，不乘牆的顏色）
    col += near * gain * 0.32 + wide * gain * 0.05;
    fragColor = vec4(col, 1.0);
  }`, { light: { value: null }, gain: { value: 1 }, t: { value: 0 } });

/** 光圖的貼圖：要 mipmap（shader 用不同層當不同半徑的光暈）。 */
function lightTexture(cv: HTMLCanvasElement) {
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.NoColorSpace;
  tx.premultiplyAlpha = true;
  tx.flipY = false;
  tx.minFilter = THREE.LinearMipmapLinearFilter;
  tx.magFilter = THREE.LinearFilter;
  tx.generateMipmaps = true;
  return tx;
}

interface MChar { ch: string; x: number; y: number; t: number; w: number }
type TubeState = 'off' | 'white' | 'hot' | 'heart';

export default class Neon extends Scene {
  bg = shared('neon.bg', BG);
  /** 玻璃管與白色燈管（一般疊）。 */
  glass = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 通電發光的訊號色燈管（加亮疊上去才會發光），半解析度就夠。 */
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  /** 光圖：亮著的燈管，R = 訊號色、G = 白色燈管、B = 愛心（1/4 大小，shader 取 mip 當光暈）。 */
  lightCv = Object.assign(document.createElement('canvas'), { width: Math.round(W * LS), height: Math.round(H * LS) });
  lightCtx = this.lightCv.getContext('2d')!;
  lightTex = this.track(lightTexture(this.lightCv));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 97 + (this.msg?.id ?? 0)) >>> 0;
  fit: FitResult | null = null;
  msgFam = FAM_MSG;
  chars: MChar[] = [];
  sig = ''; sigT = Infinity; sigX = 0; sigY = 0; sigSize = 48;
  tFirst = 0;
  /** 歌詞燈管的字級與位置（有留言時小、沒留言時大）。 */
  lyr = { x: LYR_S.x, y: LYR_S.y, w: LYR_S.w, size: 56, min: 48 };
  hasLyrics = true;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${INVITE}${song.title}${song.artist}營業時間永遠新人的話`);
    const c = this.glass.ctx;
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.25, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    this.hasLyrics = lyrics.linesIn(s - 1, e + 1).length > 0;
    let fit: FitResult, box: { x: number; y: number; w: number; h: number };
    if (m) {
      // 留言是主角：扣掉署名那一排的高度再找字級，署名永遠在最後一行下面
      box = MSG_BOX;
      fit = fitText(c, m.text, FAM_MSG, box.w, box.h - 84, { min: 56, max: 150, lineHeight: 1.22, maxLines: 4 });
      this.sigSize = Math.round(Math.max(44, Math.min(56, fit.size * 0.5)));
      this.lyr = { ...LYR_S, size: lyricSizeFor(fit.size), min: 48 };
    } else {
      // 沒有留言：歌詞是主角（大），邀請是一行小字
      this.msgFam = F.hand(400);
      box = { x: LYR_B.x, y: 760, w: 1180, h: 60 };
      fit = fitText(c, INVITE, this.msgFam, box.w, box.h, { min: 44, max: 46, lineHeight: 1.2, maxLines: 1 });
      this.lyr = { x: LYR_B.x, y: LYR_B.y, w: LYR_B.w, size: LYR_B.size, min: LYR_B.min };
    }
    this.fit = fit;
    // 留言整塊（含署名）在框裡垂直置中
    const sigGap = m ? Math.max(66, fit.size * 0.62) : 0;
    const top = box.y + Math.max(0, (box.h - fit.height - sigGap) / 2) + fit.size * 0.9;
    c.font = font(this.msgFam, fit.size);
    const pos: { ch: string; x: number; y: number; w: number }[] = [];
    fit.lines.forEach((ln, li) => {
      let x = box.x;
      for (const ch of Array.from(ln)) { const w = c.measureText(ch).width; pos.push({ ch, x, y: top + li * fit.lineHeight, w }); x += w; }
    });
    const times = stagger(au, this.tFirst + beat * 0.5, pos.length, Math.min(2 * bar, 0.4 * (e - s)));
    this.chars = pos.map((p, i) => ({ ...p, t: times[i]! }));
    const lastT = times[times.length - 1] ?? this.tFirst;
    if (m) {
      this.sigT = lastT + beat;
      const widest = Math.max(...fit.lines.map((l) => c.measureText(l).width));
      c.font = font(FAM_MSG, this.sigSize);
      const sw = c.measureText(this.sig).width;
      this.sigX = Math.max(box.x + widest - sw, box.x + 40);
      this.sigY = top + (fit.lines.length - 1) * fit.lineHeight + sigGap;
    }
    // ---- 範圍（給導演／檢查用）
    let rows = 1;
    for (const ln of lyrics.linesIn(s - 1, e + 1)) rows = Math.max(rows, this.layLyric(ln).rows.length);
    this.avoid = [[this.lyr.x - 20, this.lyr.y - this.lyr.size - 10, this.lyr.w + 40, this.lyr.size * (rows > 1 ? 2.3 : 1.2) + 30]];
    if (m) this.avoid.push([box.x - 20, box.y - 20, box.w + 40, this.sigY - box.y + 40]);
  }

  private layLyric(line: Line): LyricLayout {
    const L = this.lyr;
    return layoutLyric(this.glass.ctx, line, { family: FAM_LYR, size: L.size, minSize: L.min, maxWidth: L.w, lineHeight: 1.1 });
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const G = this.glass, Hh = this.hot;
    G.clear(); Hh.clear();
    const c = G.ctx, hc = Hh.ctx, lc = this.lightCtx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, this.lightCv.width, this.lightCv.height);
    // 每一格從同樣的畫布狀態開始（線頭、對齊、字距…不會被上一格留下來的設定影響）
    c.save(); hc.save(); lc.save();
    lc.setTransform(LS, 0, 0, LS, 0, 0);
    lc.globalCompositeOperation = 'lighter';
    // 通電：開場 0.3 秒內整面招牌「啪」地亮起（閃兩下）；結尾拔插頭
    const power = t < s + 0.3 ? (frameIdx(t) % 4 < 2 ? 0.35 : 1) * prog(t, s, s + 0.08) : t > e - 0.2 ? 1 - prog(t, e - 0.2, e - 0.05) : 1;

    this.hardware(c);
    this.bigSign(c, hc, lc, t, power);
    this.message(c, hc, lc, t, power);
    this.heartSign(c, hc, lc, t, power);
    c.restore(); hc.restore(); lc.restore();

    this.lightTex.needsUpdate = true;
    this.bg.u.light!.value = this.lightTex;
    this.bg.u.gain!.value = 1 + 0.12 * f.a.kick;
    this.bg.render(renderer, out);
    comp.draw(renderer, G.upload(), out);
    comp.draw(renderer, Hh.upload(), out, { mode: 'add', tint: [2.3, 2.3, 2.3] });
    // 鏡頭：整個窗格很慢地推近
    const push = ease.inOutCubic(clamp((t - s) / Math.max(1, e - s)));
    return { bloom: 0.95, bloomRadius: 0.7, halation: 0.4, vignette: 0.6, zoom: 1 + 0.035 * push, popupAvoid: this.avoid };
  }

  /** 一根燈管字：沒通電的玻璃管（淡淡的填色＋玻璃邊），或通電（白色燈管／訊號色燈管）。 */
  private tube(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, lc: CanvasRenderingContext2D, ch: string, x: number, y: number, state: TubeState, k = 1) {
    if (state === 'off' || k <= 0.02) {
      c.fillStyle = rgba('bone', 0.18);
      c.fillText(ch, x, y);
      c.strokeStyle = rgba('bone', 0.18); c.lineWidth = 1;
      c.strokeText(ch, x, y);
      if (state === 'off') return;
    }
    if (state === 'white') {
      c.fillStyle = rgba('bone', 0.97 * k);
      c.fillText(ch, x, y);
      lc.fillStyle = `rgba(0,${Math.round(200 * k)},0,1)`; lc.fillText(ch, x, y);
    } else {
      c.fillStyle = rgba('ember', k); c.fillText(ch, x, y);
      hc.fillStyle = rgba('signal', k); hc.fillText(ch, x, y);
      lc.fillStyle = `rgba(${Math.round(255 * k)},0,0,1)`; lc.fillText(ch, x, y);
    }
  }

  /** 愛心燈管：一圈玫瑰色的愛心（留言裡的 ♥、右上角的招牌都用它）；沒通電是玻璃。 */
  private heartTube(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, lc: CanvasRenderingContext2D, cx: number, cy: number, r: number, lw: number, k: number) {
    const path = new Path2D();
    heartPoints(64).forEach((p, i) => (i ? path.lineTo(cx + p.x * r, cy + p.y * r) : path.moveTo(cx + p.x * r, cy + p.y * r)));
    path.closePath();
    c.lineWidth = hc.lineWidth = lc.lineWidth = lw;
    c.lineJoin = hc.lineJoin = lc.lineJoin = 'round';
    if (k > 0.05) {
      c.strokeStyle = rgba('rose', k); c.stroke(path);
      hc.strokeStyle = rgba('rose', 0.8 * k); hc.stroke(path);
      lc.strokeStyle = `rgba(0,0,${Math.round(255 * k)},1)`; lc.stroke(path);
    } else { c.strokeStyle = rgba('bone', 0.16); c.stroke(path); }
  }

  /** 燈管的電線：幾根從上面垂下來的黑電線（牆上唯一的「硬體」，很暗）。 */
  private hardware(c: CanvasRenderingContext2D) {
    c.strokeStyle = rgba('ink', 0.9); c.lineWidth = 4; c.lineCap = 'round';
    const cables: [number, number][] = [[HEART.x + 40, HEART.y - HEART.r * 0.9], [this.lyr.x + 30, this.lyr.y - this.lyr.size * 0.9]];
    for (const [x, y] of cables) { c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + 10, y - 40, x - 20, y - 80, x - 6, -20); c.stroke(); }
  }

  // ------------------------------------------------------------ 歌詞
  private bigSign(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, lc: CanvasRenderingContext2D, t: number, power: number) {
    const { lyrics, audio: au, song } = this.ctx;
    const L = this.lyr;
    const ly = lyricAt(lyrics, t, 1.6, 0.35);
    // 每小節挑一個唱完的字「滋」地暗一下（在第二拍後半）
    const bar = Math.floor(au.barAt(t) + 1e-4);
    const buzzT = au.timeOfBar(bar) + au.beatPeriod(t) * 1.5;
    const buzzing = t >= buzzT && t < buzzT + 0.09 && hash(bar, this.seed) < 0.6;
    const buzzPick = hash(bar, this.seed + 5);
    if (ly) {
      const lay = this.layLyric(ly.line);
      const oy = L.y - (lay.rows.length > 1 ? lay.size * (this.msg ? 0.9 : 0.55) : 0);
      c.font = hc.font = lc.font = font(FAM_LYR, lay.size);
      const sung = lay.words.filter((w) => Lyrics.wordProgress(w.word, t) >= 1);
      const buzzW = sung.length ? sung[Math.floor(buzzPick * sung.length)] : null;
      for (const pw of lay.words) {
        const x = L.x + pw.x, y = oy + pw.y;
        const p = Lyrics.wordProgress(pw.word, t);
        if (p <= 0) {
          // 還沒唱：玻璃管（換句時淡淡出現）
          c.save(); c.globalAlpha = ly.k; this.tube(c, hc, lc, pw.word.w, x, y, 'off'); c.restore();
          continue;
        }
        // 通電：開頭 0.1 秒閃兩下；唱完退場時整排熄掉
        let k = t - pw.word.start < 0.1 ? (frameIdx(t) % 3 === 1 ? 0.15 : 1) : 1;
        if (buzzing && pw === buzzW) k = 0.2;
        k *= power;
        if (ly.k < 1 && t > ly.line.end) k *= ly.k;
        this.tube(c, hc, lc, pw.word.w, x, y, p < 1 ? 'hot' : 'white', k);
      }
      return;
    }
    // 純音樂：歌名整排亮著（白色燈管）；句子之間的空檔：歌名是沒通電的玻璃管（招牌不會空著）
    const lit = !this.hasLyrics;
    c.font = font(FAM_LYR, L.size);
    const w = c.measureText(song.title).width;
    const size = Math.max(L.min, Math.min(L.size, (L.size * L.w) / Math.max(1, w)));
    c.font = hc.font = lc.font = font(FAM_LYR, size);
    let x = L.x;
    const chs = Array.from(song.title);
    chs.forEach((ch, i) => {
      const k = (buzzing && i === Math.floor(buzzPick * chs.length) ? 0.2 : 1) * power;
      this.tube(c, hc, lc, ch, x, L.y, lit ? 'white' : 'off', k);
      x += c.measureText(ch).width;
    });
  }

  // ------------------------------------------------------------ 留言（手寫體霓虹）
  private message(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, lc: CanvasRenderingContext2D, t: number, power: number) {
    const fit = this.fit!, m = this.msg;
    if (m?.couple) {
      c.font = font(F.hei(500), 17); c.letterSpacing = '6px'; c.fillStyle = rgba('bone', 0.3);
      c.fillText('新人的話', MSG_BOX.x, MSG_BOX.y - 6);
      c.letterSpacing = '0px';
    }
    c.font = hc.font = lc.font = font(this.msgFam, fit.size);
    for (const g of this.chars) {
      const since = t - g.t;
      const on = since >= 0;
      const k = on ? (since < 0.08 ? (frameIdx(t) % 3 === 1 ? 0.2 : 1) : 1) * power : 0;
      if (g.ch === '♥') {
        // 留言裡的愛心：一圈愛心燈管（照字型那顆的框）
        const mm = c.measureText('♥');
        const hgt = mm.actualBoundingBoxAscent + mm.actualBoundingBoxDescent;
        const cy = g.y - (mm.actualBoundingBoxAscent - mm.actualBoundingBoxDescent) / 2;
        this.heartTube(c, hc, lc, g.x + g.w / 2, cy, Math.min(g.w, hgt * 1.15) * 0.42, Math.max(3, fit.size * 0.06), k);
        c.font = hc.font = lc.font = font(this.msgFam, fit.size);
        continue;
      }
      if (!on) { this.tube(c, hc, lc, g.ch, g.x, g.y, 'off'); continue; }
      // 剛點亮的字是訊號色，0.5 秒後變白色燈管
      this.tube(c, hc, lc, g.ch, g.x, g.y, since < 0.5 ? 'hot' : 'white', k);
    }
    if (m && t >= this.sigT - 0.4) {
      c.font = hc.font = lc.font = font(FAM_MSG, this.sigSize);
      const on = t >= this.sigT;
      let x = this.sigX;
      for (const ch of Array.from(this.sig)) {
        this.tube(c, hc, lc, ch, x, this.sigY, on ? 'white' : 'off', 0.85 * power);
        x += c.measureText(ch).width;
      }
    }
  }

  // ------------------------------------------------------------ 右上：兩格動畫的霓虹愛心
  private heartSign(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, lc: CanvasRenderingContext2D, t: number, power: number) {
    const au = this.ctx.audio;
    const big = Math.floor(au.beatAt(t) + 1e-4) % 2 === 0;
    this.heartTube(c, hc, lc, HEART.x, HEART.y, HEART.r, 6, big ? power : 0);
    this.heartTube(c, hc, lc, HEART.x, HEART.y, HEART.r * 0.62, 6, big ? 0 : power);
    // 漆在牆上的小字
    c.font = font(F.hei(500), 17); c.letterSpacing = '6px'; c.fillStyle = rgba('bone', 0.28); c.textAlign = 'center';
    c.fillText('營業時間：永遠', HEART.x, HEART.y + HEART.r + 44);
    c.textAlign = 'left'; c.letterSpacing = '0px';
  }
}
