// 文氏圖（亮）：一張一本正經的集合論插圖。左圓 A = 宣文、右圓 B = 孟庭。
//  - 開場兩個圓像用圓規畫出來（筆尖繞一圈，一拍畫完），隔得遠遠的；兩個圓只標名字（宣文、孟庭）。
//  - 接著在拍點上兩個圓「喀、喀」兩下靠過去重疊（outExpo），交集 A ∩ B 用訊號色的螢光筆塗滿——主打留言就寫在交集裡，
//    一個字一個字落在拍點上。兩邊只屬於自己的部分用版畫的斜線（A 往右上、B 往右下）打陰影。
//  - 之後每個小節線交集亮一下、兩個圓再往中間貼近一點點（越來越像）；斜線的方向也跟著轉一點。
//  - 歌詞在上方當作圖的標題（逐字跟唱，亮版面：訊號色的暗部＋螢光筆）。左下是集合的定義與註腳。
//  - 沒有留言：交集裡寫「我們」與一行邀請。純音樂：標題寫本圖配樂（歌名）。
// 畫法：紙（_t11 的共用紙）→ 圓、斜線、螢光筆（全螢幕 shader，疊在紙上）→ 字（Canvas2D）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, TAU } from '../engine/util';
import { tokens, type FitResult } from '../engine/text';
import { lyricAt, beatAfter, signature, fillWithHearts } from './_motifs';
import { Paper, stagger, pad3, mono, tag, type Rect } from './_t11';
import { paperLyric, lyricLine, lyricRows, lyricSizeFor } from './_t12';

export const spec: PlateSpecDecl = { group: 'type', family: 'science', paper: true, energy: [0.15, 0.8], bars: [4, 12], weight: 1 };

// ---------------------------------------------------------------- 版面
/** 兩個圓的中線、半徑；圓心距離從 D0（分開）→ D1（重疊）→ D2（窗格結束時，又貼近一點）。 */
const CY = 662, CXM = 900, R = 400;
const D0 = 2 * R + 60, D1 = 0.62 * R, D2 = 0.55 * R;
const LYR = { x: 124, base: 212, w: 1200, size: 64 };
const FAM_MSG = F.hand(700);
const INVITE = '掃描右下角 QR code，把你的祝福放進交集裡。';
const FOOT = '＊交集會隨時間變大。';

const VENN = () => {
  const p = new FSPass(/* glsl */ `
  uniform vec2 ca; uniform vec2 cb; uniform float r; uniform float swA; uniform float swB;
  uniform float hatchK; uniform float lensK; uniform float pulse; uniform float rot; uniform float k;
  // 疊一層（預乘）
  vec4 over(vec4 d, vec3 c, float a) { return vec4(c * a + d.rgb * (1.0 - a), a + d.a * (1.0 - a)); }
  // 圓規畫的圓：從左邊（角度 π）順時針畫到 sw（0..1）
  float arc(vec2 p, vec2 c, float sw) {
    vec2 d = p - c;
    float a = fract((atan(d.y, d.x) - PI) / TAU + 1.0);
    return step(a, sw);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float dA = length(p - ca) - r, dB = length(p - cb) - r;
    float aw = 1.0;
    float inA = 1.0 - smoothstep(-aw, aw, dA), inB = 1.0 - smoothstep(-aw, aw, dB);
    vec4 o = vec4(0.0);
    // 交集：訊號色的螢光筆（拍點亮一下），邊緣留一點點白（手塗的不會塗到線上）
    float lens = (1.0 - smoothstep(-8.0, -5.0, dA)) * (1.0 - smoothstep(-8.0, -5.0, dB));
    float streak = 0.9 + 0.1 * sin(p.y * 0.21 + sin(p.x * 0.013) * 2.0);
    o = over(o, C_SIGNAL, lens * lensK * (0.34 + 0.2 * pulse) * streak);
    // 只屬於自己的部分：版畫的斜線（A 往右上、B 往右下），斜線是一條一條畫上去的（hatchK 從左掃到右）
    float sweep = smoothstep(p.x - 60.0, p.x + 60.0, mix(200.0, 1700.0, hatchK));
    vec2 ua = rot2(0.785 + rot) * p, ub = rot2(-0.785 - rot) * p;
    float hA = hatch(ua.y / 11.0, 0.13) * inA * (1.0 - inB) * sweep;
    float hB = hatch(ub.y / 11.0, 0.13) * inB * (1.0 - inA) * sweep;
    o = over(o, C_SEPIA, (hA + hB) * 0.3);
    // 圓：粗一點的線＋外面一條細線（像圖版的雙線），圓規畫到哪裡就到哪裡
    float la = (pxLine(abs(dA), 0.9, 1.9) + 0.45 * pxLine(abs(dA - 7.0), 0.3, 1.1)) * arc(p, ca, swA);
    float lb = (pxLine(abs(dB), 0.9, 1.9) + 0.45 * pxLine(abs(dB - 7.0), 0.3, 1.1)) * arc(p, cb, swB);
    o = over(o, C_SEPIA, min(1.0, la + lb) * 0.9);
    // 圓心：圓規針腳的小十字
    float xa = step(length(p - ca), 7.0) * max(pxLine(abs(p.x - ca.x), 0.3, 1.0), pxLine(abs(p.y - ca.y), 0.3, 1.0)) * step(0.001, swA);
    float xb = step(length(p - cb), 7.0) * max(pxLine(abs(p.x - cb.x), 0.3, 1.0), pxLine(abs(p.y - cb.y), 0.3, 1.0)) * step(0.001, swB);
    // 針腳在交集塗滿之後淡掉（不要在留言的字後面留兩個小十字）
    o = over(o, C_SEPIA, (xa + xb) * 0.6 * (1.0 - lensK));
    fragColor = o * k;
  }`, {
    ca: { value: new THREE.Vector2() }, cb: { value: new THREE.Vector2() }, r: { value: R }, swA: { value: 0 }, swB: { value: 0 },
    hatchK: { value: 0 }, lensK: { value: 0 }, pulse: { value: 0 }, rot: { value: 0 }, k: { value: 1 },
  }, { blending: THREE.CustomBlending, transparent: true });
  const m = p.mat;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return p;
};

interface Glyph { ch: string; x: number; y: number; w: number; t: number }

export default class Venn extends Scene {
  paper = shared('t11.paper', () => new Paper());
  venn = shared('venn.shapes', VENN);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  /** 時間：圓規畫完、靠過去的兩下、留言開始寫。 */
  tFirst = 0; unit = 0.5; tDraw = 0; tStep: number[] = []; tMsg = 0;
  sig = ''; sigT = Infinity; sigX = 0; sigY = 0;
  box = { x: 0, y: 0, w: 0, h: 0 };
  lyricsInWindow = false;
  avoid: Rect[] = [];
  /** 歌詞字級：有留言時比留言小一截（一格只有一個焦點）。 */
  lyrSize = LYR.size;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    const text = m ? m.text : '我們';
    await loadText(`${text}${this.sig}${INVITE}${FOOT}${song.title}${song.artist}宣文孟庭本圖配樂文氏圖集合A ∩ B`);
    const beat = au.beatPeriod(s);
    this.tFirst = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    // 窗格短（不到三小節）就用半拍當單位，一樣的事情擠在前面做完，留時間讀
    const beats = (e - this.tFirst) / beat;
    const u = this.unit = beats < 12 ? 0.5 : 1;
    const B = (k: number) => au.timeOfBeat(au.beatAt(this.tFirst) + k * u);
    this.tDraw = B(1);
    this.tStep = [B(2), B(3)];
    this.tMsg = B(4);

    // ---- 交集裡的留言：排成交集（透鏡）的形狀——每一行的寬度照那一行在透鏡裡的寬度，行數越多字越小
    const c = this.layer.ctx;
    const fam = FAM_MSG;
    const lay = m
      ? lensFit(c, text, fam, 44, 108, 1.3, 64)
      : lensFit(c, text, fam, 60, 150, 1.2, 150);
    const fit = this.fit = { size: lay.size, lines: lay.rows, lineHeight: lay.lh, width: 0, height: 0 };
    c.font = font(fam, fit.size);
    const chars: Omit<Glyph, 't'>[] = [];
    fit.lines.forEach((ln, li) => {
      const lw = c.measureText(ln).width;
      let x = CXM - lw / 2;
      for (const ch of Array.from(ln)) { const w = c.measureText(ch).width; chars.push({ ch, x, y: lay.y0 + li * fit.lineHeight, w }); x += w; }
    });
    const blockTop = lay.y0 - fit.size * 0.9;
    this.box = { x: CXM - lensHalf(0, D1), y: blockTop, w: lensHalf(0, D1) * 2, h: lay.y0 + (fit.lines.length - 1) * fit.lineHeight + 80 - blockTop };
    const bar = au.timeOfBar(au.barAt(this.tFirst) + 1) - this.tFirst;
    const times = stagger(au, this.tMsg, chars.length, Math.min(1.6 * bar, 0.35 * (e - s)));
    this.glyphs = chars.map((g, i) => ({ ...g, t: times[i]! }));
    const tLast = times[times.length - 1] ?? this.tMsg;
    this.sigT = tLast + beat * 0.5;
    this.sigX = CXM;
    this.sigY = lay.y0 + (fit.lines.length - 1) * fit.lineHeight + 58;
    this.lyricsInWindow = lyrics.linesIn(s, e).length > 0;

    // ---- 即時小卡避開：交集（留言）與上方的歌詞
    const msgR: Rect = [Math.round(this.box.x - 10), Math.round(this.box.y - 20), Math.round(this.box.w + 20), Math.round(this.box.h + 60)];
    this.lyrSize = lyricSizeFor(m ? fit.size : null);
    const rows = Math.max(1, lyricRows(c, lyrics.linesIn(s, e), paperLyric(this.lyrSize, LYR.w)));
    const lyr: Rect = [LYR.x - 12, LYR.base - this.lyrSize - 40, LYR.w + 24, this.lyrSize * (rows > 1 ? 2.35 : 1.25) + 52];
    this.avoid = [msgR, msgR, lyr, lyr];
  }

  /** 圓心距：遠遠的 → 拍點上兩下靠過去 → 之後慢慢再貼近一點。 */
  private dist(t: number) {
    const [t1, t2] = this.tStep as [number, number];
    const k1 = ease.outExpo(clamp((t - t1) / 0.35)), k2 = ease.outExpo(clamp((t - t2) / 0.35));
    let d = lerp(D0, lerp(D0, D1, 0.45), k1);
    d = lerp(d, D1, k2);
    return d - (D1 - D2) * prog(t, t2 + 0.4, this.ctx.end, ease.inOutCubic);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const vis = prog(t, s, s + 0.25) * (1 - prog(t, e - 0.3, e, ease.inCubic));
    this.paper.render(renderer, out, { k: 1 });
    const d = this.dist(t);
    const ax = CXM - d / 2, bx = CXM + d / 2;
    // 每個小節線：交集亮一下、斜線轉一點點
    const bi = Math.floor(au.barAt(t) + 1e-6), tb = au.timeOfBar(bi);
    const pulse = t >= this.tStep[1]! ? Math.exp(-(t - tb) / 0.25) : 0;
    const rot = 0.06 * Math.sin(bi * 1.7) * ease.outExpo(clamp((t - tb) / 0.4));
    const u = this.venn.u;
    (u.ca!.value as THREE.Vector2).set(ax, CY); (u.cb!.value as THREE.Vector2).set(bx, CY);
    // 圓規：開場到第一拍之後畫完一圈（右圓晚一點點）
    u.swA!.value = ease.inOutCubic(prog(t, s, this.tDraw));
    u.swB!.value = ease.inOutCubic(prog(t, s + (this.tDraw - s) * 0.25, this.tDraw + this.unit * 0.3));
    u.hatchK!.value = ease.inOutCubic(prog(t, this.tDraw, this.tStep[0]! + 0.2));
    u.lensK!.value = ease.outExpo(prog(t, this.tStep[1]!, this.tStep[1]! + 0.3));
    u.pulse!.value = pulse; u.rot!.value = rot; u.k!.value = vis;
    this.venn.render(renderer, out);

    const L = this.layer, c = L.ctx;
    L.clear();
    c.globalAlpha = vis;
    // ---- 圓的名字（圓規畫到那裡才出現）
    const la = prog(t, s + (this.tDraw - s) * 0.4, this.tDraw);
    c.save(); c.globalAlpha *= la;
    // 配角的字都小、淡（MV 融合原則：焦點只有交集裡的留言）
    c.font = font(F.serif(600, true), 34); c.fillStyle = rgba('sepia', 0.8); c.textAlign = 'center';
    c.fillText('A', ax - R * 0.72, CY - R * 0.72); c.fillText('B', bx + R * 0.72, CY - R * 0.72);
    c.font = font(F.hei(500), 22); c.fillStyle = rgba('sepia', 0.7); c.letterSpacing = '3px';
    c.fillText('宣文', ax - R * 0.72, CY - R * 0.72 + 34); c.fillText('孟庭', bx + R * 0.72, CY - R * 0.72 + 34);
    c.letterSpacing = '0px';
    c.restore();
    // ---- 交集：留言一個字一個字寫上去
    const fit = this.fit!;
    c.font = font(FAM_MSG, fit.size); c.textAlign = 'left';
    for (const g of this.glyphs) {
      if (t < g.t) break;
      const k = clamp((t - g.t) / 0.14), wet = 1 - clamp((t - g.t) / 0.8);
      c.save();
      if (k < 1) { c.beginPath(); c.rect(g.x - 4, g.y - fit.size, (g.w + 8) * k, fit.size * 1.4); c.clip(); }
      c.fillStyle = g.ch === '♥' ? rgba('rose') : mixRgba('sepia', 'blood', wet * 0.9);
      c.fillText(g.ch, g.x, g.y);
      c.restore();
    }
    const m = this.msg;
    if (t >= this.sigT) {
      c.save(); c.globalAlpha *= prog(t, this.sigT, this.sigT + 0.35);
      if (m) {
        c.font = font(F.hand(400), 36); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'center';
        fillWithHearts(c, this.sig, this.sigX, this.sigY);
      } else {
        c.font = font(F.hand(700), 40); c.fillStyle = rgba('sepia', 0.9); c.textAlign = 'center';
        INVITE.split(/(?<=，)/).forEach((ln, i) => c.fillText(ln, CXM, this.sigY + 6 + i * 52));
      }
      c.restore();
    }
    // A ∩ B 的小標與「還有」（交集上方與下方）
    const lk = ease.outExpo(prog(t, this.tStep[1]!, this.tStep[1]! + 0.3));
    if (lk > 0) {
      c.save(); c.globalAlpha *= lk;
      mono(c, 'A ∩ B', CXM, this.box.y - 16, { size: 18, tracking: 4, color: rgba('sepia', 0.75), align: 'center', weight: 600 });
      c.restore();
    }
    this.lyric(c, t);
    tag(c, FOOT, LYR.x, 984, { size: 17, color: rgba('sepia', 0.55), tracking: 1 });
    comp.draw(renderer, L.upload(), out);
    void TAU;
    // 鏡頭：整個窗格慢慢推近（像電影），大鼓時輕輕頂一下
    return { paper: 1, bloom: 0.3, vignette: 0.25, grain: 0.04, zoom: 1 + 0.025 * ease.inOutCubic(f.p) + 0.004 * f.a.kick, popupAvoid: this.avoid };
  }

  /** 上方的標題：歌詞逐字跟唱；純音樂寫本圖配樂。 */
  private lyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const ly = lyricAt(lyrics, t);
    if (!ly) {
      if (!this.lyricsInWindow) {
        mono(c, '本圖配樂', LYR.x, LYR.base - 76, { size: 15, tracking: 3, color: rgba('sepia', 0.6) });
        c.font = font(F.archivo(100, 800), 56); c.fillStyle = rgba('sepia', 0.9); c.textAlign = 'left'; c.fillText(song.title, LYR.x, LYR.base);
      }
      return;
    }
    const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.1));
    c.save(); c.textAlign = 'left'; c.translate(LYR.x, LYR.base + (1 - inK) * 14);
    lyricLine(c, ly.line, t, paperLyric(this.lyrSize, LYR.w), ly.k * c.globalAlpha, true);
    c.restore();
  }
}

/** 圓心距 d 時，交集在離中線 y（px，往下為正）那一條水平線上的半寬（離圓邊留 18 px）。 */
function lensHalf(y: number, d: number) {
  const q = R * R - y * y;
  return q <= 0 ? 0 : Math.sqrt(q) - d / 2 - 18;
}

/**
 * 把文字排進交集：找最大字級，行寬跟著透鏡變（中間寬、上下窄），整塊垂直置中（下面留 below px 給署名）。
 * 斷行單位用 engine/text 的 tokens（中文禁則、英文不拆字）。回傳每一行、字級、行距與第一行的基線。
 */
function lensFit(c: CanvasRenderingContext2D, text: string, family: string, min: number, max: number, lhk: number, below: number) {
  const toks = tokens(text);
  // 好的斷點：標點、愛心、空白（賓客常用愛心或換行當停頓）
  const PUNCT = /(?:[，、。！？；：,.!?;:）」』♥]|\s)\s*$/;
  const tryAt = (size: number, maxRows: number) => {
    c.font = font(family, size);
    const lh = size * lhk;
    for (let n = 1; n <= maxRows; n++) {
      const h = size + (n - 1) * lh + below;
      const y0 = CY - h / 2 + size * 0.86;
      const widths: number[] = [];
      for (let i = 0; i < n; i++) {
        const yb = y0 + i * lh;
        widths.push(2 * Math.min(lensHalf(yb - size * 0.86 - CY, D1), lensHalf(yb + size * 0.14 - CY, D1)));
      }
      // 太靠透鏡尖端的行只放得下一兩個字，讀起來很怪：每行至少要放得下三個多字
      if (widths.some((w) => w < size * 3.3)) continue;
      const rows: string[] = [];
      let k = 0, ok = true;
      for (let i = 0; i < n; i++) {
        const start = k;
        let cur = '';
        while (k < toks.length) {
          const next = cur + toks[k]!;
          if (c.measureText(next.trimEnd()).width > widths[i]!) { if (!cur) ok = false; break; }
          cur = next; k++;
        }
        if (!ok) break;
        // 這一行滿了、後面還有字：往回找四個單位內的標點（或愛心、空白），在它後面斷（「吃／飽」這種斷法很難讀）
        if (k < toks.length && i < n - 1) {
          for (let back = 1; back <= 4 && k - back > start; back++) {
            const cand = toks.slice(start, k - back).join('');
            if (PUNCT.test(cand) && c.measureText(cand.trimEnd()).width >= widths[i]! * 0.55) { k -= back; cur = cand; break; }
          }
        }
        rows.push(cur.trim());
      }
      if (ok && k >= toks.length) return { size, rows: rows.filter((r) => r), lh, y0 };
    }
    return null;
  };
  const search = (maxRows: number) => {
    let lo = min, hi = max, best = tryAt(min, maxRows);
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2, r = tryAt(mid, maxRows);
      if (r) { best = r; lo = mid; } else hi = mid;
    }
    return best ? tryAt(Math.floor(best.size), maxRows) ?? best : null;
  };
  const full = search(9);
  // 少排一行還是大字（≥ 68 px、至少最大字級的六成）就選少的：「新婚快樂！！！」一行比「新婚快／樂！！！」好讀
  if (full) {
    for (let n = 1; n < full.rows.length; n++) {
      const r = search(n);
      if (r && r.rows.length <= n && r.size >= Math.max(68, full.size * 0.62)) return r;
    }
    return full;
  }
  // 最小字級還放不下（不該發生：60 字在最小字級可以排進去）：一行硬排
  return { size: min, rows: [text], lh: min * lhk, y0: CY };
}
