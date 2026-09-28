// 活版印刷（亮）：兩個鏡頭，一個重擊。
//  1. 版台特寫：主打留言排成一格一格的鉛字（反字、金屬、字面凸起），側光把字面照出立體；墨輥在拍點上從上往下滾過，
//     滾過的字面沾上黑亮的墨。下緣壓著一張等著印的紙，歌詞一個字一個字「壓」在上面（還沒唱是沒上墨的空壓痕、唱到的字是紅墨、唱完是深咖啡墨）。
//  2. 小節線「喀」一聲壓印（畫面閃一下、震一下），直接切到印好的紙：留言印成正字，壓痕陷進紙裡、墨色有一點不均、字緣墨比較濃；
//     署名用第二色（紅墨），愛心是玫瑰色墨。歌詞照樣在下緣一個字一個字壓上去。鏡頭慢慢推近、側光掃過紙面。
//  - 一個焦點：印好的留言（思源宋體粗、最大、深墨色）。配角只有左上角一行很小的版權頁小字。
//  - 沒有留言：版台上排的是歌詞那一句（反字），每句開始的小節線壓印一次；純音樂又沒有留言：排新人的名字＋邀請。
// 手法：一個全螢幕 shader（PlaneCam：版台與紙都是平面），字在 init() 先畫成一張「高度」貼圖（清楚／模糊 3 px／模糊 9 px 三層＋鉛字的方塊），
// 版台用它算凸字的法線與影子、紙用它算壓痕的明暗；墨色另外一張彩色貼圖（留言深墨、署名紅墨、愛心玫瑰）；
// 歌詞是紙面座標的 Canvas 圖層（白色 = 只壓不上墨），每格重畫。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText, layout } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse } from '../engine/util';
import { fitText } from '../engine/text';
import { lyricAt, lyricSizeFor, COUPLE_ZH, DATE_DOTS, heartPoints } from './_motifs';
import { grid, layoutRows, drawRows, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, msgBlock, INVITE, type MsgBlock, type Rect } from './_t14';

export const spec: PlateSpecDecl = { group: 'type', family: 'craft', paper: true, energy: [0.2, 0.9], bars: [4, 8], weight: 1 };

const MSG_BOX = { x: 250, y: 200, w: 1420, h: 560 };
/** 歌詞壓在紙的下緣（右邊停在 HUD 左邊）。 */
const LYR = { x: 250, y: 918, w: 1060 };
const FAM_MSG = F.ming(900);
const FAM_SIG = F.ming(700);
const FAM_LYR = F.archivo(100, 700);
const COLOPHON = `活版印刷 · ${COUPLE_ZH} · ${DATE_DOTS}`;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D mk; uniform sampler2D ck; uniform sampler2D lyr; uniform float hasMk;
  uniform vec4 mR; uniform vec2 mTex; uniform float phase; uniform float rollY; uniform float rollOn;
  uniform float inkY; uniform float shut; uniform float t; uniform float slipY;

  vec4 M(vec2 q) { vec2 mu = (q - mR.xy) / mR.zw; return (mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) ? vec4(0.0) : texture(mk, mu); }
  vec4 CK(vec2 q) { vec2 mu = (q - mR.xy) / mR.zw; return (mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) ? vec4(0.0) : texture(ck, mu); }
  // 紙：棉紙的纖維與一點點起伏，側光從左邊來
  vec3 paperAt(vec2 P) {
    float fib = 0.5 * snoise(P / vec2(38.0, 9.0)) + 0.35 * snoise(P / vec2(7.0, 21.0)) + 0.25 * snoise(P / 2.6);
    float cl = snoise(P / 340.0);
    return mix(C_PAPER, C_BONE, 0.3) * (0.975 + 0.012 * fib + 0.018 * cl);
  }
  // 紙上的歌詞（壓痕＋墨）：白的是空壓（只有凹痕），深的是墨
  vec3 lyricOn(vec3 col, vec2 P) {
    vec4 L = fastLayer(texture(lyr, pageUV(P)));
    float ax = texture(lyr, pageUV(P + vec2(1.4, 0.0))).a - texture(lyr, pageUV(P - vec2(1.4, 0.0))).a;
    float ay = texture(lyr, pageUV(P + vec2(0.0, 1.4))).a - texture(lyr, pageUV(P - vec2(0.0, 1.4))).a;
    // 凹進去：左緣（面向光）暗、右緣亮
    col *= 1.0 + 0.22 * ax + 0.12 * ay;
    vec3 lc = L.rgb / max(L.a, 1e-3);
    float blind = step(0.55, luma(lc));
    float inkAmt = L.a * (1.0 - blind) * (0.88 + 0.12 * snoise(P / 3.0));
    col = mix(col, lc * 0.92, inkAmt);
    col *= 1.0 - 0.05 * L.a * blind;
    return col;
  }

  void main() {
    vec2 sp = SP();
    vec3 h0 = pcHit(sp, 0.0);
    vec2 P = h0.xy;
    vec3 col;
    vec2 e = vec2(1.6, 0.0);
    if (phase < 0.5) {
      // ================= 版台：反字的鉛字 =================
      vec2 cx = vec2(mR.x + mR.z * 0.5, 0.0);
      vec2 Q = vec2(2.0 * cx.x - P.x, P.y);
      vec4 m = hasMk > 0.5 ? M(Q) : vec4(0.0);
      // 版框裡的木頭填料（鉛字以外的地方）：淺色木頭、木紋
      float wg = 0.5 + 0.5 * sin(P.y / 5.0 + 3.0 * snoise(P / vec2(400.0, 40.0)));
      col = mix(mix(C_PAPER, C_BLOOD, 0.12), C_SEPIA, 0.34 + 0.08 * wg) * (0.9 + 0.08 * snoise(P / 150.0));
      // A：鉛字的字身（0.5 = 字身外框、1 = 縮進去的字身頂面），兩者之間就是字與字之間的細縫
      float sorts = smoothstep(0.7, 0.9, m.a);
      float crev = step(0.3, m.a) * (1.0 - sorts);
      // 鉛字的身體：灰色金屬，一格一格之間有細縫；被旁邊凸起的字面擋住側光的地方有影子
      float sh = M(Q + vec2(-7.0, -9.0)).b;
      vec3 metal = mix(C_ASH, C_BONE, 0.3) * (0.7 + 0.06 * snoise(P / 14.0)) * (1.0 - 0.45 * sh);
      col = mix(col, metal, sorts);
      col = mix(col, C_INK2 * 0.8, crev * 0.85);
      // 字面：凸起來的反字，邊緣受光；墨輥滾過的地方沾了墨（黑亮）
      float face = smoothstep(0.35, 0.65, m.r);
      float gx = M(Q + e.xy).g - M(Q - e.xy).g, gy = M(Q + e.yx).g - M(Q - e.yx).g;
      float rim = sat(-(gx * 0.7 + gy * 0.7) * 3.0) - sat((gx * 0.7 + gy * 0.7) * 3.0) * 0.6;
      vec3 faceC = mix(C_ASH, C_BONE, 0.55) * (1.0 + 0.5 * rim);
      float inked = step(P.y, inkY);
      vec3 inkC = C_SEPIA * 0.32 * (1.0 + 0.9 * rim) + C_BONE * 0.18 * pow(sat(rim), 2.0);
      col = mix(col, mix(faceC, inkC, inked), face);
      // 墨輥：一根黑色的橡膠滾筒橫過去（上緣一條亮光）
      float rd = (P.y - rollY) / 46.0;
      if (rollOn > 0.5 && abs(rd) < 1.0) {
        float cyl = sqrt(max(0.0, 1.0 - rd * rd));
        vec3 rc = C_INK2 * (0.5 + 0.9 * cyl) + C_BONE * 0.35 * pow(sat(1.0 - abs(rd + 0.45) * 4.0), 3.0);
        col = mix(col, rc, smoothstep(1.0, 0.94, abs(rd)));
      }
      col *= 1.0 - 0.28 * exp(-pow(max(rd - 1.0, 0.0) * 1.2, 2.0)) * rollOn * step(0.0, rd);
      // 前景壓著一張等著印的紙（離鏡頭很近，螢幕座標；邊緣微微斜），歌詞壓在上面，紙的影子落在版上
      float edgeY = slipY - 0.035 * (sp.x - 960.0);
      float slip = smoothstep(edgeY - 1.2, edgeY + 1.2, sp.y);
      col *= 1.0 - 0.35 * (1.0 - slip) * smoothstep(edgeY - 70.0, edgeY, sp.y);
      if (slip > 0.0) col = mix(col, lyricOn(paperAt(sp * 1.3), sp) * (0.96 + 0.04 * smoothstep(edgeY, edgeY + 30.0, sp.y)), slip);
      // 壓印前一瞬間：壓板蓋下來，光被擋住
      col *= 1.0 - 0.75 * shut;
    } else {
      // ================= 印好的紙（放在印刷機的鐵台上，看得到紙邊與影子） =================
      vec2 q = abs(P - vec2(960.0, 548.0)) - vec2(835.0, 492.0);
      float sd = max(q.x, q.y);
      vec3 bed = mix(C_INK2, C_ASH, 0.18) * (0.8 + 0.1 * snoise(P / 90.0) + 0.05 * snoise(P / 7.0));
      float shd = 1.0 - smoothstep(0.0, 34.0, max(q.x - 10.0, q.y - 14.0));
      col = mix(bed * (1.0 - 0.55 * shd), paperAt(P), 1.0 - smoothstep(-1.0, 1.0, sd));
      if (hasMk > 0.5) {
        vec4 m = M(P);
        vec4 ck = CK(P);
        // 壓痕：字陷進紙裡，左緣背光暗、右緣受光亮；字的周圍紙被擠得有一點起伏
        float gx = M(P + e.xy).g - M(P - e.xy).g, gy = M(P + e.yx).g - M(P - e.yx).g;
        float bx = M(P + e.xy * 3.0).b - M(P - e.xy * 3.0).b, by = M(P + e.yx * 3.0).b - M(P - e.yx * 3.0).b;
        col *= 1.0 + 0.3 * gx + 0.16 * gy + 0.12 * bx + 0.06 * by;
        col *= 1.0 - 0.035 * m.b;
        // 墨：中間稍微淡、邊緣被擠得比較濃；紙纖維讓墨有一點點不均
        float rimInk = sat((m.r - m.g) * 2.2);
        float cover = m.r * (0.93 + 0.05 * snoise(P / 4.0) + 0.03 * snoise(P / 1.3)) + 0.12 * rimInk;
        vec3 ic = ck.rgb / max(ck.a, 1e-3);
        col = mix(col, ic * (0.9 + 0.1 * snoise(P / 60.0)), sat(cover) * step(0.02, ck.a));
      }
      col = lyricOn(col, P);
    }
    // 一盞燈從左上打過來
    col *= 0.9 + 0.13 * exp(-dot((sp - vec2(600.0, 300.0)) / 1300.0, (sp - vec2(600.0, 300.0)) / 1300.0) * 2.0);
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  mk: { value: null }, ck: { value: null }, lyr: { value: null }, hasMk: { value: 0 },
  mR: { value: new THREE.Vector4(0, 0, 1, 1) }, mTex: { value: new THREE.Vector2(1, 1) }, phase: { value: 1 },
  rollY: { value: -999 }, rollOn: { value: 0 }, inkY: { value: -999 }, shut: { value: 0 }, t: { value: 0 }, slipY: { value: 850 },
});

interface Glyph { ch: string; x: number; y: number; w: number; size: number; family: string; color: string }

export default class Letterpress extends Scene {
  bg = shared('letterpress.bg', BG);
  /** 歌詞（紙面座標）。 */
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 37 + (this.msg?.id ?? 0) * 11) >>> 0;
  block: MsgBlock | null = null;
  mk: THREE.DataTexture | null = null;
  ck: THREE.CanvasTexture | null = null;
  rect: Rect = [0, 0, 1, 1];
  /** 壓印的時間（第一個夠遠的小節線）與墨輥滾過的拍點。 */
  tImp = 0;
  rolls: number[] = [];
  rollDur = 0.3;
  lyrSize = 52;
  hasLyrics = false;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.lyr.ctx;
    const gr = grid(au, s, e);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新郎新娘' : m.name) : ''}${names}${INVITE}${COLOPHON}${song.title}${song.artist}——一位賓客`);

    // ---- 壓印的時間：第一個離開頭至少一拍半的小節線；太晚（超過窗格四成）就改用一拍半之後的拍點
    let tImp = gr.bars.find((b) => b - s >= gr.beat * 1.45) ?? Infinity;
    if (tImp > s + 0.42 * (e - s)) tImp = au.timeOfBeat(Math.ceil(au.beatAt(s + gr.beat * 1.45) - 1e-3));
    this.tImp = tImp;
    // 墨輥：壓印前的每一拍滾一次（第一拍至少要有一次）
    this.rolls = gr.beats.filter((b) => b > s + 0.1 && b < tImp - 0.05);
    if (!this.rolls.length) this.rolls = [s + 0.12];
    this.rollDur = clamp(gr.beat * 0.55, 0.16, 0.34);

    // ---- 版上的字
    const glyphs: Glyph[] = [];
    const push = (text: string, x: number, y: number, family: string, size: number, color: string) => {
      for (const g of layout(text, family, size).glyphs) glyphs.push({ ch: g.ch, x: x + g.x, y, w: g.w, size, family, color });
    };
    if (m) {
      const b = (this.block = msgBlock(c, m, FAM_MSG, MSG_BOX, { align: 'left', sigFamily: FAM_SIG, sigMin: 44, sigMax: 58, min: 50, max: 150, lineHeight: 1.28, maxLines: 5 }));
      for (const ln of b.lines) push(ln.text, ln.x, ln.y, FAM_MSG, b.fit.size, rgba('sepia'));
      push(b.sig.text, b.sig.x, b.sig.y, FAM_SIG, b.sig.size, rgba('blood'));
      this.lyrSize = lyricSizeFor(b.fit.size);
      this.avoid = [b.box, [LYR.x, LYR.y - 64, LYR.w, 90]];
    } else {
      // 沒有留言：印新人的名字（歌詞在下緣是主角的時候，名字小一點）；歌詞放大
      const ft = fitText(c, names, FAM_MSG, 1100, 260, { min: 64, max: this.hasLyrics ? 88 : 170, maxLines: 1 });
      c.font = font(FAM_MSG, ft.size);
      const w = c.measureText(names).width;
      push(names, (W - w) / 2 - 60, 330 + ft.size * 0.4, FAM_MSG, ft.size, rgba('sepia'));
      this.lyrSize = 84;
      this.avoid = [[300, 200, 1300, 300], [LYR.x, 480, 1400, 260]];
    }
    this.buildMasks(glyphs);
  }

  /**
   * 字的高度貼圖（只做一次）：R = 清楚的字、G = 模糊 3 px、B = 模糊 9 px、A = 鉛字的方塊（一個字一格，格與格之間留縫）；
   * 墨色貼圖：留言深墨、署名紅墨、愛心玫瑰。模糊在這裡用 canvas 的 filter 做一次，之後只取樣。
   */
  private buildMasks(glyphs: Glyph[]) {
    if (!glyphs.length) return;
    const x0 = Math.min(...glyphs.map((g) => g.x)) - 40, x1 = Math.max(...glyphs.map((g) => g.x + g.w)) + 40;
    const y0 = Math.min(...glyphs.map((g) => g.y - g.size * 1.05)) - 30, y1 = Math.max(...glyphs.map((g) => g.y + g.size * 0.35)) + 30;
    const rect: Rect = [Math.floor(x0), Math.floor(y0), Math.ceil(x1 - x0), Math.ceil(y1 - y0)];
    this.rect = rect;
    const w = rect[2], h = rect[3];
    const mk = (opaque = false) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true })!;
      if (opaque) { cx.fillStyle = '#000'; cx.fillRect(0, 0, w, h); }
      cx.translate(-rect[0], -rect[1]);
      cx.textBaseline = 'alphabetic';
      return { cv, cx };
    };
    const heart = heartPoints(48);
    const drawGlyph = (cx: CanvasRenderingContext2D, g: Glyph, color: string) => {
      cx.fillStyle = color;
      if (g.ch === '♥') {
        const s = Math.min(g.w, g.size * 0.8) * 0.46, hx = g.x + g.w / 2, hy = g.y - g.size * 0.36;
        cx.beginPath();
        heart.forEach((p, i) => (i ? cx.lineTo(hx + p.x * s, hy + p.y * s) : cx.moveTo(hx + p.x * s, hy + p.y * s)));
        cx.closePath(); cx.fill();
        return;
      }
      cx.font = font(g.family, g.size);
      cx.fillText(g.ch, g.x, g.y);
    };
    const sharp = mk();
    for (const g of glyphs) drawGlyph(sharp.cx, g, '#fff');
    const blur = (px: number) => {
      const b = mk();
      b.cx.setTransform(1, 0, 0, 1, 0, 0);
      b.cx.filter = `blur(${px}px)`;
      b.cx.drawImage(sharp.cv, 0, 0);
      return b.cx.getImageData(0, 0, w, h).data;
    };
    const R = sharp.cx.getImageData(0, 0, w, h).data, G = blur(3), B = blur(9);
    // 鉛字的方塊：一個字一格（字身＝字寬 × 行高），格子四邊縮 1.5 px 留縫
    const so = mk();
    // 外框用半透明（A = 0.5），縮進去的頂面 A = 1
    so.cx.fillStyle = '#fff'; so.cx.globalAlpha = 0.5;
    for (const g of glyphs) if (g.ch.trim()) so.cx.fillRect(g.x - 1, g.y - g.size * 0.98 - 1, g.w + 2, g.size * 1.28 + 2);
    so.cx.globalCompositeOperation = 'destination-out';
    for (const g of glyphs) if (g.ch.trim()) so.cx.fillRect(g.x + 1.5, g.y - g.size * 0.98 + 1.5, g.w - 3, g.size * 1.28 - 3);
    so.cx.globalCompositeOperation = 'source-over';
    so.cx.globalAlpha = 1;
    so.cx.fillStyle = '#fff';
    for (const g of glyphs) if (g.ch.trim()) so.cx.fillRect(g.x + 1.5, g.y - g.size * 0.98 + 1.5, g.w - 3, g.size * 1.28 - 3);
    const A = so.cx.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h * 4; i += 4) { out[i] = R[i + 3]!; out[i + 1] = G[i + 3]!; out[i + 2] = B[i + 3]!; out[i + 3] = A[i + 3]!; }
    const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    this.mk = this.track(tex);
    // 墨色
    const col = mk();
    for (const g of glyphs) drawGlyph(col.cx, g, g.ch === '♥' ? rgba('rose') : g.color);
    const ct = new THREE.CanvasTexture(col.cv);
    ct.colorSpace = THREE.SRGBColorSpace; ct.premultiplyAlpha = false; ct.flipY = false;
    ct.minFilter = THREE.LinearFilter; ct.generateMipmaps = false; ct.needsUpdate = true;
    this.ck = this.track(ct);
  }

  /** 鏡頭：版台是低低的斜角特寫（推近）；壓印之後是印好的紙，從稍高處落下來停住，慢慢推近。最後半拍往後拉。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const side = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const F0 = 1600;
    if (t < this.tImp) {
      const p = prog(t, s, this.tImp);
      const r = this.rect;
      return {
        tx: r[0] + r[2] * (0.42 + 0.14 * p * side), ty: r[1] + r[3] * 0.52 + 40,
        dist: F0 * (0.86 - 0.08 * ease.inOutQuad(p)),
        pitch: 0.34, yaw: 0.16 * side, level: 0.8, focal: F0,
      };
    }
    const land = prog(t, this.tImp, this.tImp + 0.55, ease.outExpo);
    const p = prog(t, this.tImp, e);
    const exit = prog(t, e - 0.4, e, ease.inCubic);
    return {
      tx: 945 + 18 * side * (p - 0.5), ty: 540 - 10 * p,
      dist: F0 * (1.03 + 0.05 * (1 - land) - 0.04 * ease.inOutQuad(p) + 0.06 * exit),
      pitch: 0.1 + 0.05 * (1 - land), yaw: -0.035 * side, roll: 0.012 * side * (1 - land), level: 0.6, focal: F0,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, song } = this.ctx;
    const t = f.t;
    const phase = t < this.tImp ? 0 : 1;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    u.phase!.value = phase;
    u.t!.value = t;
    u.mk!.value = this.mk; u.ck!.value = this.ck;
    u.hasMk!.value = this.mk ? 1 : 0;
    (u.mR!.value as THREE.Vector4).set(...this.rect);
    // 墨輥：每一次從版的上緣滾到下緣（rollDur 秒，落在拍點上結束）；滾過的地方有墨
    const r = this.rect;
    let rollY = -999, rollOn = 0, inkY = -999;
    for (const rt of this.rolls) {
      const k = (t - (rt - this.rollDur)) / this.rollDur;
      if (k >= 0 && k < 1.15) { rollY = r[1] - 60 + (r[3] + 160) * ease.inOutCubic(clamp(k)); rollOn = k < 1.1 ? 1 : 0; }
      if (k >= 0) inkY = Math.max(inkY, r[1] - 60 + (r[3] + 160) * ease.inOutCubic(clamp(k)));
    }
    u.rollY!.value = rollY; u.rollOn!.value = rollOn; u.inkY!.value = inkY;
    u.shut!.value = phase === 0 ? prog(t, this.tImp - 0.1, this.tImp, ease.inQuad) : 0;
    u.slipY!.value = 842;

    // ---- 歌詞（紙面座標）：白 = 空壓、紅 = 正在唱、深咖啡 = 唱完
    const L = this.lyr; L.clear();
    const c = L.ctx;
    const ink: KaraokeInk = { active: rgba('blood'), sung: rgba('sepia'), unsung: rgba('bone') };
    const ly = lyricAt(lyrics, t);
    if (ly) {
      // 沒有留言、印好之後：歌詞是主角，壓在紙的正中間（大）；版台鏡頭時一律在前景那張紙條上
      const big = !this.msg && phase === 1;
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: big ? 1400 : LYR.w, maxRows: big ? 2 : 1, align: 'left' as const };
      const lay = layoutRows(c, ly.line, st);
      c.save(); c.translate(LYR.x, big ? 600 + lay.size * 0.4 - (lay.rows.length - 1) * lay.lineHeight * 0.5 : LYR.y - (lay.rows.length - 1) * lay.lineHeight);
      drawRows(c, lay, FAM_LYR, t, ink, ly.k);
      c.restore();
    }
    if (!this.msg && (phase === 1 || !ly)) {
      c.font = font(F.hei(500), 34); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.85);
      c.fillText(INVITE, LYR.x, LYR.y - 10);
      c.letterSpacing = '0px';
    }
    if (phase === 1) {
      // 版權頁：左上角一行很小的字（第二色）
      c.font = font(F.hei(500), 18); c.letterSpacing = '5px'; c.fillStyle = rgba('blood', 0.8);
      c.fillText(this.msg?.couple ? `FROM THE COUPLE · ${COLOPHON}` : COLOPHON, 250, 150);
      c.letterSpacing = '0px';
      if (!this.hasLyrics) {
        c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.7);
        c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), LYR.x, this.msg ? LYR.y : LYR.y + 60);
        c.letterSpacing = '0px';
      }
    }
    u.lyr!.value = L.upload();
    this.bg.render(renderer, out);
    // 壓印：閃一下、震一下
    const hit = pulse(t, this.tImp, 0.09);
    const sh = hit * 7;
    return {
      paper: 1, bloom: 0.3, vignette: phase ? 0.4 : 0.55, grain: 0.05,
      flash: 0.22 * hit, shake: [sh * (hash(this.seed, 9) - 0.5), sh * 0.8], zoom: 1 + 0.025 * hit,
      popupAvoid: this.avoid.map((rr) => this.cam.screenRect(rr, 10)),
    };
  }
}
