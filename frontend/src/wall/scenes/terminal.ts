// 終端機（機器 B，暗）：暗房間裡一台老式綠螢幕終端機（磷光是主題的訊號色），鏡頭斜斜地拍著它的弧形玻璃。
//  - 主視覺：螢幕左邊跑著一個程式「./heart」——用字元畫的立體愛心（像經典的 ASCII 甜甜圈），
//    每一拍往另一邊擺一下（outExpo，停住），每個小節線「怦」地脹一下，大鼓時整顆亮一下。越亮的面用越密的字（.,-~:;=!*#$@），
//    最亮的幾個字是白熱的。右上角一小行計數器：跳了幾下（一拍加一）。
//  - 主打留言：右邊一塊。第一拍有人打「cat wishes/042.txt」（一個字一個字、打完在下一拍按 Enter），
//    檔案內容就是留言（v2 字級），一段一段印出來（剛印出的字燙的、冷成磷光白），署名在最後一行下面，接著新的提示字元與游標。
//    沒有留言：「cat: wishes/: 目前還沒有留言」＋一行邀請。
//  - 歌詞：下方三分之一，「tail -f tonight.log」的最新一行：唱到的字反白（訊號色的方塊）、唱完磷光白、還沒唱三成亮。純音樂：歌名。
//  - 鏡頭：終端機在空間裡、稍微側一點，進場從更斜的地方在第一拍前後落定，之後慢慢推近；
//    焦點轉移：開場對焦在愛心上，留言印出來時焦點移到留言。窗格一開始是映像管開機：一條亮線上下撐開成畫面。
// 手法：字畫在一張 Canvas 層（愛心一列一次 fillText），經過映像管 shader（桶狀變形、掃描線、磷光光暈、更新帶）畫進離屏圖，
// 再用 _t8 的舞台當成房間裡的一台螢幕來拍（透視、景深、塑膠外框、玻璃反光）。字級照 v2 標準（螢幕 px，除以舞台的縮放）。
import type * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText, measure } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, type LyricLayout, type LyricStyle, signature, beatAfter, lyricSubOf, subGap, drawLyricSub } from './_motifs';
import { DEC_GLSL, INVITE, T8_TEXT, Stage, camMove, type StageCam } from './_t8';
import { V2, msgMaxFor, lyricV2, sigV2, fitClauses } from './_v2';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.2, 0.95], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（玻璃上的座標，px）
const PROMPT = '$ ';
const P_SIZE = 24; // 指令列的字級（配角）
/** 愛心的字元格（左邊的主視覺）。 */
const HX = 150, HY = 150, HCOLS = 60, HROWS = 29, HFS = 25;
const HCW = HFS * 0.6; // Plex Mono 的字寬
/** 右邊：留言。 */
const MX = 1150, MY = 240, MW = 620, MH = 520;
/** 下方三分之一：歌詞。 */
const LX = 170, LY_Y = 968, LY_W = 1060;
const RAMP = '.,-~:;=!*#$@';
const TEXT = `${T8_TEXT}目前還沒有留言—·♪█`;
/** 磷光的「白」：紙白帶一點訊號色（整片螢幕是單色的磷光，但字要夠白才讀得清楚）。 */
const PH = (a = 1) => mixRgba('bone', 'signal', 0.28, a);
/** 基本機位（沒有加鏡頭運動）：init 用它換算字級。 */
const CAM: StageCam = { yaw: 0.09, pitch: 0.03, roll: -0.004, zoom: 0.86, x: 20, y: -12, dof: 1.2, bezel: 80, radius: 90, glass: 1.2, room: [0, 0, 0], glow: 0.03 };

// 愛心的輪廓（±1、y 向下）：跟 heartPoints 一樣的參數曲線，先量好範圍
const HEART: { x: number; y: number }[] = (() => {
  const pts: { x: number; y: number }[] = [];
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * TAU;
    const x = 16 * Math.sin(a) ** 3, y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a));
    pts.push({ x, y });
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const c = (y0 + y1) / 2, h = (y1 - y0) / 2;
  return pts.map((p) => ({ x: p.x / h, y: (p.y - c) / h }));
})();

/** 映像管：桶狀變形、掃描線、磷光光暈、更新帶、開機的亮線。整張內容就是玻璃（外框由舞台畫）。 */
const CRT = () => new FSPass(/* glsl */ `
  uniform sampler2D tex; uniform float on; uniform float kick; uniform float roll;
  ${DEC_GLSL}
  // textureLod：光暈在迴圈裡取樣，不用導數（D3D 會警告）
  vec4 samp(vec2 uv) { return decLayer(textureLod(tex, uv, 0.0)); }
  void main() {
    vec2 cc = vUv - 0.5;
    vec2 ca = cc * vec2(1.7778, 1.0);
    float r2 = dot(ca, ca);
    vec2 d = cc * (1.0 + 0.04 * r2 + 0.015 * r2 * r2);
    float sq = max(on, 0.004);
    vec2 suv = vec2(d.x, d.y / sq) + 0.5;
    vec3 col = C_INK * 0.45 + C_SIGNAL * (0.008 + 0.016 * (1.0 - smoothstep(0.0, 0.7, length(ca))));
    if (abs(cc.y) < 0.5 * sq && suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
      vec4 c = samp(suv);
      vec3 halo = vec3(0.0);
      vec2 px = vec2(1.0 / ${W}.0, 1.0 / ${H}.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        halo += samp(suv + vec2(cos(a), sin(a)) * px * 5.0).rgb;
      }
      col = col * (1.0 - c.a) + c.rgb + halo * 0.035;
    }
    col += C_EMBER * 3.0 * (1.0 - smoothstep(0.0, 0.004 + 0.012 * on, abs(cc.y))) * (1.0 - on) * step(0.001, on) * step(on, 0.97);
    col *= 0.88 + 0.12 * sin(FRAG_PX.y * 2.0944);
    col *= 1.0 + 0.05 * exp(-pow((suv.y - roll) / 0.05, 2.0)) + 0.05 * kick;
    col *= 1.0 - 0.45 * smoothstep(0.32, 0.62, max(abs(ca.x) / 1.7778 * 1.05, abs(ca.y)));
    fragColor = vec4(col, 1.0);
  }`, { tex: { value: null }, on: { value: 1 }, kick: { value: 0 }, roll: { value: 0 } });

export default class Terminal extends Scene {
  crt = shared('terminal.crt', CRT);
  stage = new Stage();
  scr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 這一格有沒有韓文原文副行（建構時就看：引擎只在建立這一格之前設好開關）；有的話歌詞整段往上讓一行。 */
  hasSub = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l));
  beat = 0.5;
  cmd = '';
  cmdT: number[] = [];
  tEnter = 0;
  fit: FitResult | null = null;
  charT: number[] = [];
  typedEnd = 0;
  /** 內容上的字級（已經換算過舞台縮放）。 */
  sigPx = 30;
  st: LyricStyle = { family: F.mono(600), size: 52, minSize: 44, maxWidth: LY_W, lineHeight: 1.12 };
  private zbuf = new Float32Array(HCOLS * HROWS);
  private lum = new Int8Array(HCOLS * HROWS);

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start;
    const m = this.msg;
    const beat = this.beat = au.beatPeriod(s + 0.1);
    this.cmd = m ? `cat wishes/${String(m.n).padStart(3, '0')}.txt` : 'cat wishes/';
    await loadText(TEXT + (song.title ?? '') + (m ? m.text + m.name : ''));
    // v2 字級：標準是螢幕 px，除以舞台在那裡的縮放倍數
    const zM = this.stage.scaleAt(CAM, MX + MW / 2, MY + MH / 2);
    const zL = this.stage.scaleAt(CAM, LX + LY_W / 2, LY_Y - 20);
    // 打指令：第一拍開始，一個字一個 32 分音符（最慢 0.045 秒），打完在下一拍按 Enter
    const tA = beatAfter(au, s + 0.1);
    const dc = Math.min(beat / 8, 0.045);
    this.cmdT = Array.from(this.cmd, (_, i) => tA + i * dc);
    this.tEnter = beatAfter(au, tA + this.cmd.length * dc + 0.05);
    if (m) {
      const c = this.scr.ctx;
      const o = { min: V2.msgMin / zM, max: msgMaxFor(m.text) / zM, lineHeight: 1.3, maxLines: 6 };
      // 字級依「框的高度扣掉署名那一行」算，署名永遠在最後一行下面
      const bh = MH - 90;
      this.fit = fitClauses(c, m.text, F.ming(700), MW, bh, o) ?? fitText(c, m.text, F.ming(700), MW, bh, o);
      this.sigPx = sigV2(this.fit.size * zM) / zM;
      const ls = lyricV2(this.fit.size * zM) / zL;
      this.st = { family: F.mono(600), size: ls, minSize: V2.lyrMin / zL, maxWidth: LY_W, lineHeight: 1.12 };
      const n = this.fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
      const dur = clamp(0.045 * n + 0.2, 0.5, 2.6), step = beat / 4;
      const per = Math.ceil(n / Math.max(1, Math.round(dur / step)));
      const t0 = this.tEnter + 0.05;
      this.charT = Array.from({ length: n }, (_, i) => t0 + Math.floor(i / per) * step);
      this.typedEnd = this.charT[n - 1] ?? t0;
    } else {
      const ls = lyricV2(null) / zL;
      this.st = { family: F.mono(600), size: ls, minSize: V2.lyrMin / zL, maxWidth: LY_W, lineHeight: 1.12 };
    }
  }

  // ---------------------------------------------------------------- 字元愛心
  /** 旋轉角：每一拍往另一邊擺 ±35°（outExpo 停住）。轉整圈會轉到側面，看起來像半顆愛心，所以只擺不轉。 */
  private yawAt(t: number) {
    const b = this.ctx.audio.beatAt(t), nb = Math.floor(b);
    const side = (i: number) => (((i % 2) + 2) % 2 === 0 ? 0.62 : -0.62);
    return lerp(side(nb - 1), side(nb), ease.outExpo(clamp((b - nb) / 0.55)));
  }
  /**
   * 把立體愛心（輪廓 × r 往內縮、前後兩面鼓起來）投影到字元格，z-buffer 留最靠近的點，亮度 = 法線和光的夾角。
   * 跟經典的 ASCII 甜甜圈一樣的做法，每格重算（幾千個點，很便宜）。
   */
  private heart(t: number) {
    const au = this.ctx.audio;
    const zb = this.zbuf, lum = this.lum;
    zb.fill(-1e9); lum.fill(-1);
    const th = this.yawAt(t), tilt = 0.14;
    const ct = Math.cos(th), st = Math.sin(th), cx = Math.cos(tilt), sx = Math.sin(tilt);
    // 每個小節線「怦」一下、大鼓時小小地脹一下
    const db = au.timeOfBar(Math.floor(au.barAt(t)));
    const beatK = 1 + 0.12 * Math.exp(-Math.max(0, t - db) / 0.12) + 0.04 * au.hit('kick', t, 0.12);
    const D = 0.42;
    const Lx = -0.35, Ly = -0.55, Lz = 0.76; // 光從左上前方來（y 向下）
    const scale = (HROWS * 0.74) * beatK;
    const aspect = HFS / HCW; // 字元格是直的長方形：x 要多放大一點才是正的愛心
    for (let i = 0; i < HEART.length; i++) {
      const h = HEART[i]!, hl = Math.hypot(h.x, h.y) + 1e-3;
      for (let k = 1; k <= 22; k++) {
        const r = k / 22;
        const zz = D * Math.sqrt(Math.max(0, 1 - r * r));
        const g = (D * r) / Math.sqrt(Math.max(0.02, 1 - r * r)) / hl;
        for (const side of [1, -1]) {
          // 點與法線（物件座標）
          const x = h.x * r, y = h.y * r, z = side * zz;
          let nx = (h.x / hl) * g, ny = (h.y / hl) * g, nz = side;
          const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
          // 繞 y 轉、再往前倒一點
          const x1 = x * ct + z * st, z1 = -x * st + z * ct;
          const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
          const nx1 = nx * ct + nz * st, nz1 = -nx * st + nz * ct;
          const ny2 = ny * cx - nz1 * sx, nz2 = ny * sx + nz1 * cx;
          const p = 3 / (3 - z2); // 一點點透視
          const col = Math.round(HCOLS / 2 + x1 * scale * p * aspect * 0.5);
          const row = Math.round(HROWS / 2 + y2 * scale * p * 0.5 * 1.02);
          if (col < 0 || col >= HCOLS || row < 0 || row >= HROWS) continue;
          const idx = row * HCOLS + col;
          if (z2 <= zb[idx]!) continue;
          zb[idx] = z2;
          const L = nx1 * Lx + ny2 * Ly + nz2 * Lz;
          // 亮度開 1.6 次方：不然大半個正面都是最密的 @，看不出立體
          lum[idx] = L <= 0 ? 0 : Math.min(RAMP.length - 1, Math.floor(Math.pow(L, 1.6) * RAMP.length));
        }
      }
    }
  }
  private drawHeart(c: CanvasRenderingContext2D, t: number) {
    const s = this.ctx.start;
    this.heart(t);
    const kick = this.ctx.audio.hit('kick', t, 0.12);
    const on = prog(t, s, s + 0.5);
    c.font = font(F.mono(600), HFS);
    // 一列兩次 fillText：一般亮度的字是訊號色，最亮的幾個字（高光）是白熱的
    for (let row = 0; row < HROWS; row++) {
      let a = '', b = '';
      for (let col = 0; col < HCOLS; col++) {
        const v = this.lum[row * HCOLS + col]!;
        if (v < 0) { a += ' '; b += ' '; continue; }
        const ch = RAMP[v]!;
        if (v >= RAMP.length - 1) { a += ' '; b += ch; } else { a += ch; b += ' '; }
      }
      const y = HY + (row + 1) * HFS;
      c.fillStyle = rgba('signal', (0.8 + 0.2 * kick) * on);
      c.fillText(a, HX, y);
      c.fillStyle = mixRgba('signal', 'bone', 0.45, on);
      c.fillText(b, HX, y);
    }
  }

  // ---------------------------------------------------------------- 畫字（玻璃座標）
  private draw(t: number) {
    const L = this.scr, c = L.ctx;
    L.clear();
    const au = this.ctx.audio;
    const s = this.ctx.start;
    const blink = ((au.beatAt(t) % 1) + 1) % 1 < 0.5;
    c.textBaseline = 'alphabetic';
    const m = this.msg;
    // ---- 左上：正在跑的程式與心跳計數（配角：小、低對比）
    const px0 = this.prompt(c, HX, HY - 18);
    label(c, `./heart --bpm ${Math.round(au.bpm)}`, px0, HY - 18, F.mono(500), P_SIZE, PH(0.55));
    const beats = Math.max(0, Math.floor(au.beatAt(t) - au.beatAt(s)) + 1);
    label(c, `♥ ${String(beats).padStart(4, '0')}`, HX + HCOLS * HCW, HY - 18, F.mono(500), P_SIZE, rgba('signal', 0.55), 'right');
    // ---- 左邊：愛心（主視覺）
    this.drawHeart(c, t);
    // ---- 右邊：cat 留言
    const typed = this.cmdT.filter((x) => x <= t).length;
    let x = this.prompt(c, MX, MY);
    c.font = font(F.mono(500), P_SIZE);
    c.fillStyle = PH(0.6);
    const cmdShown = this.cmd.slice(0, typed);
    c.fillText(cmdShown, x, MY);
    x += c.measureText(cmdShown).width;
    if (t < this.tEnter) this.cursor(c, x, MY, P_SIZE, blink || typed < this.cmd.length);
    else if (m) {
      const fit = this.fit!;
      c.font = font(F.ming(700), fit.size);
      const top = MY + 40 + fit.size * 0.92;
      let idx = 0;
      fit.lines.forEach((ln, li) => {
        let xx = MX;
        const y = top + li * fit.lineHeight;
        for (const ch of Array.from(ln)) {
          const ta = this.charT[idx++] ?? 0;
          const cw = c.measureText(ch).width;
          if (t >= ta) {
            const heat = Math.exp(-(t - ta) / 0.2);
            const to = ch === '♥' ? 'rose' : 'bone';
            c.fillStyle = heat > 0.02 ? mixRgba(to, 'signal', heat, 1) : to === 'rose' ? rgba('rose') : PH(1);
            c.fillText(ch, xx, y);
          }
          xx += cw;
        }
      });
      const done = t >= this.typedEnd + this.beat / 2;
      const last = top + (fit.lines.length - 1) * fit.lineHeight;
      if (done) {
        // 署名在最後一行下面（隔半個留言字高），再下面是新的提示字元
        const sy = last + fit.size * 0.5 + this.sigPx;
        label(c, signature(m.name) + (m.couple ? '　（新人）' : ''), MX, sy, F.ming(400), this.sigPx, PH(0.7));
        const py = sy + P_SIZE * 2;
        const px = this.prompt(c, MX, py);
        this.cursor(c, px, py, P_SIZE, blink);
      }
    } else {
      label(c, 'cat: wishes/: 目前還沒有留言', MX, MY + 44, F.mono(500), P_SIZE, PH(0.55));
      label(c, INVITE, MX, MY + 88, F.hei(500), 24, PH(0.55));
      const px = this.prompt(c, MX, MY + 132);
      this.cursor(c, px, MY + 132, P_SIZE, blink);
    }
    // ---- 下方：歌詞
    this.drawLyric(c, t);
    L.upload();
  }

  private prompt(c: CanvasRenderingContext2D, x: number, y: number, size = P_SIZE) {
    label(c, PROMPT, x, y, F.mono(600), size, rgba('signal', 0.8));
    return x + measure(PROMPT, F.mono(600), size);
  }
  private cursor(c: CanvasRenderingContext2D, x: number, y: number, size: number, on: boolean) {
    if (!on) return;
    c.fillStyle = rgba('signal', 0.9);
    c.fillRect(x + 2, y - size * 0.82, size * 0.56, size * 0.98);
  }

  /** 歌詞：tail -f 的最新一行。正在唱的字反白，唱完磷光白，還沒唱三成亮。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    // 有韓文原文的窗格：原文印在中文下面一行（log 的下一行），整段（連 tail -f 那行）往上讓出一行
    const ly = lyricAt(lyrics, t);
    const lay = ly ? layoutLyric(c, ly.line, this.st) : null;
    const sb = lay?.sub;
    const up = sb ? sb.dy - (lay!.rows.length - 1) * lay!.size * (this.st.lineHeight ?? 1.18) + sb.lay.rows[sb.lay.rows.length - 1]!.y : this.hasSub ? subGap(this.st.size) : 0;
    label(c, '$ tail -f tonight.log', LX, LY_Y - up - this.st.size * 1.9, F.mono(500), 22, PH(0.4));
    if (ly && lay) {
      const y0 = LY_Y - up - lay.rows[lay.rows.length - 1]!.y;
      c.save();
      c.globalAlpha = ly.k;
      this.lyric(c, ly.line, t, lay, LX, y0);
      const sub = lyricSubOf(ly.line);
      if (sub && sb) {
        // 原文：同一個磷光、小一號，唱到不反白（唱到、唱完都是磷光白淡兩成），逐字時間是原文自己的
        const dim = this.msg ? 0.8 : 1;
        c.translate(LX, y0 + sb.dy);
        drawLyricSub(c, sub, t, { ...this.st, sung: PH(0.95 * dim), unsung: PH(0.28) }, lay.size);
      }
      c.restore();
    } else if (!lyrics.has) {
      label(c, `♪ ${song.title || '今晚的歌'}`, LX, LY_Y, F.mono(600), this.st.size, PH(0.8));
    }
  }
  private lyric(c: CanvasRenderingContext2D, line: Line, t: number, lay: LyricLayout, x: number, y: number) {
    c.save();
    c.translate(x, y);
    c.font = font(this.st.family, lay.size);
    const dim = this.msg ? 0.8 : 1;
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      if (p > 0 && p < 1) {
        c.fillStyle = rgba('signal', 0.95);
        c.fillRect(pw.x - 4, pw.y - lay.size * 0.84, pw.w + 8, lay.size * 1.04);
        c.fillStyle = rgba('ink');
      } else c.fillStyle = p >= 1 ? PH(0.95 * dim) : PH(0.28);
      c.fillText(pw.word.w, pw.x, pw.y);
    }
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    this.draw(t);
    const u = this.crt.u;
    u.tex!.value = this.scr.upload();
    u.on!.value = ease.outExpo(prog(t, s, s + 0.4));
    u.kick!.value = f.a.kick;
    u.roll!.value = 1 - (((au.barAt(t) % 1) + 1) % 1);
    this.crt.render(renderer, this.stage.rt);
    // 鏡頭：焦點轉移——開場對焦在愛心，留言印出來時花一拍半移到留言
    const mv = camMove(au, s, e, t, { inYaw: 0.12, inZoom: 0.07, push: 0.04, sway: 0.01 });
    const fk = this.msg ? ease.inOutCubic(prog(t, this.tEnter, this.tEnter + 1.5 * this.beat)) : 0;
    const hc: [number, number] = [HX + (HCOLS * HCW) / 2, HY + (HROWS * HFS) / 2];
    const focus: [number, number] = [lerp(hc[0], MX + MW / 2, fk), lerp(hc[1], MY + MH / 2, fk)];
    this.stage.draw(renderer, out, {
      ...CAM, yaw: CAM.yaw + mv.yaw, zoom: CAM.zoom + mv.zoom, focus,
      room: [LIN.ink[0] * 0.55, LIN.ink[1] * 0.55, LIN.ink[2] * 0.55],
    });
    void pulse;
    return { bloom: 0.8, halation: 0.35, vignette: 0.5, ca: 1.2 };
  }
}

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, size: number, color: string, align: CanvasTextAlign = 'left') {
  c.font = font(family, size);
  c.fillStyle = color;
  c.textAlign = align;
  c.fillText(text, x, y);
  c.textAlign = 'left';
}
