// 烤肉店（暗、kculture、雙語）：深夜的韓式烤肉店，宣文和孟庭隔著桌上的炭火烤盤坐著，一根銀色的排煙管從天花板垂到烤盤上方。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 d2），烤盤、肉、煙、木牌、點菜單是程式畫的。不畫任何店名、品牌。
//  - 肉在拍點翻面：烤盤上五條五花肉，每一拍翻一條（翻過去那一下「滋」：冒一團煙、濺幾點火星），越烤越焦黃。
//  - 宣文拿剪刀剪肉：每個小節線剪一刀（預備：剪刀張開在小節線前半拍，小節線上合起來），被剪的那條分成兩段。
//  - 孟庭包生菜：每兩小節，前一小節包好（拿著生菜包），下一個小節線餵到宣文嘴裡（宣文張嘴），兩人中間冒一顆小愛心。
//  - **兩行歌詞寫在牆上的長木牌**（烤肉店的木牌菜單）：中文大字、原文小一號在下面，同一塊木板上；換一句時木牌晃一下。
//    沒翻譯的歌只有一行，字在木牌正中間。
//  - **焦點是主打留言**：寫在左邊牆上掛著的點菜單（夾板＋紙），標準 v2：字 40～60、紙最大 430 × 430，高度跟著留言。
//  - 燈：烤盤上方一盞吊燈打出暖光，炭火從下面把臉照紅一點；煙被排煙管吸上去。鏡頭慢慢推近烤盤。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, drawHeart, beatAfter, barAfter, type LyricStyle } from './_motifs';
import { inkFor, inkPoly, inkEllipse, type Note } from './_couple';
import { loadPuppets, drawPick, puppetLight, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enterPuppet, writeNote } from './_c5';
import { loadLyricGlyphs, drawLyricIn } from './_d2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'kculture', paper: false, energy: [0.3, 1], bars: [4, 8] };

/** 場景尺度（宣文站直的身高 px）；坐著的腳底（被桌子擋住）。 */
const SZ = 760;
/** 坐著的腳底（被桌子擋住）：膝蓋剛好在桌面後緣下面。 */
const SEAT = 968;
const AL_X = 730, OM_X = 1195;
/** 桌面（橢圓的中心與半徑）、烤盤（桌子正中間）。 */
const TABLE = { cx: 960, cy: 830, rx: 820, ry: 118 };
const GRILL = { x: 960, y: 800, rx: 176, ry: 54 };
/** 排煙管：中心 x、管子寬、罩子下緣。 */
const DUCT = { x: 960, w: 92, bottom: 452 };
/** 牆上的長木牌（歌詞）：右上。 */
const PLANK = { x: 1010, y: 70, w: 820, h: 204 };
/** 左邊牆上的點菜單（夾板）：最大範圍（標準 v2）與寫字的內距。 */
const PAD_BOX = { x: 112, y: 132, w: 430, h: 430 };
const PAD = { x: 36, top: 92, bottom: 30 };
const MEAT = 5;

/** 烤肉店的底：暖暗的牆、吊燈打在桌上的一圈暖光、炭火往上照的紅光。用 shader 算，漸層才不會一階一階。 */
const ROOM = () => new FSPass(/* glsl */ `
  uniform float warm;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = mix(C_INK, C_INK2, 0.55 + 0.45 * smoothstep(0.0, 700.0, p.y));
    // 木頭牆板：很淡的直縫
    col += C_BONE * 0.006 * step(0.992, fract(p.x / 118.0)) * step(p.y, 700.0);
    vec2 q = (p - vec2(${GRILL.x}.0, 640.0)) / vec2(760.0, 520.0);
    col += vec3(0.95, 0.75, 0.5) * 0.05 * exp(-dot(q, q) * 1.6);
    vec2 r = (p - vec2(${GRILL.x}.0, ${GRILL.y}.0)) / vec2(360.0, 240.0);
    // 炭火的光：用固定的橘色（換主題也不會變成紫色的火）
    col += vec3(0.75, 0.29, 0.08) * (0.05 + 0.04 * warm) * exp(-dot(r, r) * 1.8);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { warm: { value: 0 } });

interface Strip { x: number; y: number; w: number; seed: number }

export default class Kbbq extends Scene {
  room = shared('kbbq.room', ROOM);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  strips: Strip[] = [];
  /** 每一拍翻一條肉的時間；每個小節線剪一刀；每兩小節餵一口。 */
  flips: number[] = [];
  cuts: number[] = [];
  feeds: number[] = [];
  alanKeys: [number, string][] = [];
  omKeys: [number, string][] = [];
  /** 換句的時間（木牌晃一下）。 */
  lineStarts: number[] = [];
  note: Note | null = null;
  pad = { ...PAD_BOX };
  noteT0 = 0;
  lyricSize = 50;

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客點菜單ORDER TABLE 13 · 五花肉 牛小排 生菜 × 2 ✓' + INVITE);
    await loadLyricGlyphs(lyrics, s, e);
    // 宣文平常就是拿著剪刀和夾子顧烤盤的樣子（cut），剪的那一下用動作表現；孟庭平常在包生菜（wrap）
    const P = {
      cut: 'xw_kbbq_cut', open: 'xw_kbbq_open', watch: 'xw_kbbq_cut',
      wrap: 'mt_kbbq_wrap', feed: 'mt_kbbq_feed', sit: 'mt_kbbq_wrap',
    };
    this.track(await loadPuppets([...new Set(Object.values(P))]));
    // 烤盤上的五條肉：斜斜地排、長短不一
    for (let i = 0; i < MEAT; i++) {
      const u = (i - (MEAT - 1) / 2) / MEAT;
      this.strips.push({ x: GRILL.x + u * GRILL.rx * 1.7, y: GRILL.y - 6 + (i % 2) * 10, w: 96 + 26 * hash(i, 3), seed: i });
    }
    for (let b = Math.ceil(au.beatAt(s + 0.3) - 1e-6), k = 0; k < 400; k++, b++) { const t = au.timeOfBeat(b); if (t > e) break; this.flips.push(t); }
    const bar0 = barAfter(au, s + 0.4);
    for (let bar = Math.round(au.barAt(bar0)), k = 0; k < 40; k++, bar++) {
      const t = au.timeOfBar(bar);
      if (t > e - 0.1) break;
      if (k % 2 === 0) this.cuts.push(t); else this.feeds.push(t);
    }
    // 姿勢時間軸：宣文平常看著烤盤；剪：小節線前半拍張開剪刀、小節線剪下去、一拍後放下；
    // 餵：孟庭在前一小節包好（拿著生菜包），小節線餵過去、宣文張嘴，一拍半後各自回來
    const A: [number, string][] = [[-1e9, P.watch]], O: [number, string][] = [[-1e9, P.sit]];
    for (const t of this.cuts) { const bp = au.beatPeriod(t); A.push([t - bp * 0.5, P.cut], [t + bp, P.watch]); }
    for (const t of this.feeds) {
      const bp = au.beatPeriod(t);
      O.push([t - bp * 2, P.wrap], [t - bp * 0.1, P.feed], [t + bp * 1.5, P.sit]);
      A.push([t - bp * 0.2, P.open], [t + bp * 1.5, P.watch]);
    }
    A.sort((a, b) => a[0] - b[0]); O.sort((a, b) => a[0] - b[0]);
    this.alanKeys = A; this.omKeys = O;
    for (const l of lyrics.linesIn(s - 1, e + 1)) this.lineStarts.push(l.start - 0.35);
    // 點菜單上的留言：標準 v2 的字級；紙的高度跟著留言（夾板上緣固定）
    const c = this.fg.ctx;
    const w = PAD_BOX.w - PAD.x * 2, hmax = PAD_BOX.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const pw = Math.min(PAD_BOX.w, tightenNote(c, this.note, 330) + PAD.x * 2);
    this.pad = { x: PAD_BOX.x, y: PAD_BOX.y, w: pw, h: Math.min(PAD_BOX.h, Math.max(270, PAD.top + this.note.height + PAD.bottom + 8)) };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.noteT0 = Math.min(beatAfter(au, s + 0.4), s + 0.9);
    this.drawBackground();
  }

  /** 不會動的：排煙管與罩子、牆上的掛勾、點菜單的夾板、桌子與桌上的小菜碟。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ink = inkFor(false, { fill: rgba('ink2') });
    // 排煙管：銀色的圓管，左邊一條亮邊、右邊暗；下面一個喇叭形的罩子
    const d = DUCT;
    const g = c.createLinearGradient(d.x - d.w / 2, 0, d.x + d.w / 2, 0);
    g.addColorStop(0, mixRgba('ash', 'ink', 0.55)); g.addColorStop(0.28, mixRgba('bone', 'ash', 0.55)); g.addColorStop(0.6, mixRgba('ash', 'ink', 0.45)); g.addColorStop(1, mixRgba('ink2', 'ash', 0.25));
    c.fillStyle = g;
    c.fillRect(d.x - d.w / 2, -10, d.w, d.bottom - 60);
    // 一節一節的接縫
    c.strokeStyle = rgba('ink', 0.35);
    c.lineWidth = 2;
    c.beginPath();
    for (let y = 70; y < d.bottom - 70; y += 120) { c.moveTo(d.x - d.w / 2, y); c.lineTo(d.x + d.w / 2, y); }
    c.stroke();
    const hood = c.createLinearGradient(d.x - 140, 0, d.x + 140, 0);
    hood.addColorStop(0, mixRgba('ash', 'ink', 0.5)); hood.addColorStop(0.3, mixRgba('bone', 'ash', 0.6)); hood.addColorStop(1, mixRgba('ink2', 'ash', 0.3));
    c.fillStyle = hood;
    c.beginPath(); c.moveTo(d.x - d.w / 2, d.bottom - 72); c.lineTo(d.x + d.w / 2, d.bottom - 72); c.lineTo(d.x + 132, d.bottom); c.lineTo(d.x - 132, d.bottom); c.closePath(); c.fill();
    c.fillStyle = rgba('ink', 0.7);
    c.beginPath(); c.ellipse(d.x, d.bottom, 132, 16, 0, 0, Math.PI * 2); c.fill();
    // 木牌的兩條吊繩掛勾（木牌本身每格畫：換句時會晃）
    for (const x of [PLANK.x + 60, PLANK.x + PLANK.w - 60]) inkEllipse(c, x, PLANK.y - 64, 6, 6, 0, { ink, fill: mixRgba('ash', 'ink', 0.3), w: 0.5, seed: x, color: rgba('bone', 0.3) });
    // 點菜單：牆上一根釘子、夾板（深木色）、白紙、夾子
    const P0 = this.pad;
    c.fillStyle = rgba('ink', 0.55);
    c.fillRect(P0.x + 12, P0.y + 14, P0.w, P0.h);
    c.fillStyle = mixRgba('ink2', 'fur', 0.5);
    c.beginPath(); c.roundRect(P0.x - 12, P0.y - 18, P0.w + 24, P0.h + 30, 10); c.fill();
    c.fillStyle = mixRgba('bone', 'cream', 0.25);
    c.fillRect(P0.x, P0.y, P0.w, P0.h);
    c.fillStyle = mixRgba('ash', 'bone', 0.3);
    c.beginPath(); c.roundRect(P0.x + P0.w / 2 - 56, P0.y - 30, 112, 32, 6); c.fill();
    // 紙上印好的表頭與幾行菜名（淡）：主角是手寫的留言
    c.font = font(F.hei(700), 20);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('ink', 0.62);
    c.fillText('點菜單', P0.x + PAD.x, P0.y + 44);
    c.letterSpacing = '0px';
    c.font = font(F.mono(500), 15);
    c.textAlign = 'right';
    c.fillStyle = rgba('ink', 0.45);
    c.fillText('TABLE 13', P0.x + P0.w - PAD.x, P0.y + 44);
    c.textAlign = 'left';
    c.font = font(F.hei(500), 15);
    c.fillStyle = rgba('ink', 0.35);
    c.fillText('五花肉 × 2 ✓　牛小排 ✓　生菜 ✓', P0.x + PAD.x, P0.y + 72);
    c.strokeStyle = rgba('ink', 0.15);
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(P0.x + PAD.x, P0.y + 82); c.lineTo(P0.x + P0.w - PAD.x, P0.y + 82); c.stroke();
    // 桌子：深色的木頭桌面（橢圓，前緣在畫面下面）、烤盤的鐵框、幾碟小菜
    const T = TABLE;
    const tg = c.createLinearGradient(0, T.cy - T.ry, 0, H);
    tg.addColorStop(0, mixRgba('ink2', 'fur', 0.28)); tg.addColorStop(1, mixRgba('ink', 'fur', 0.12));
    c.fillStyle = tg;
    c.beginPath(); c.ellipse(T.cx, T.cy, T.rx, T.ry, 0, Math.PI, 0); c.lineTo(T.cx + T.rx, H); c.lineTo(T.cx - T.rx, H); c.closePath(); c.fill();
    c.strokeStyle = rgba('bone', 0.12);
    c.lineWidth = 2;
    c.beginPath(); c.ellipse(T.cx, T.cy, T.rx, T.ry, 0, Math.PI * 1.02, Math.PI * 1.98); c.stroke();
    // 烤盤的鐵框（圓形、下面一圈暗的炭爐）
    const G = GRILL;
    c.fillStyle = rgba('ink', 0.9);
    c.beginPath(); c.ellipse(G.x, G.y + 14, G.rx + 26, G.ry + 18, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = mixRgba('ash', 'ink', 0.3);
    c.lineWidth = 5;
    c.beginPath(); c.ellipse(G.x, G.y, G.rx + 10, G.ry + 6, 0, 0, Math.PI * 2); c.stroke();
    // 小菜：幾個小白碟（泡菜、醬料），左右兩邊，不進右下角
    for (const [x, y, k] of [[520, 900, 0], [640, 944, 1], [1300, 900, 2], [760, 1000, 3]] as const) {
      c.fillStyle = rgba('ink', 0.4);
      c.beginPath(); c.ellipse(x + 6, y + 8, 50, 16, 0, 0, Math.PI * 2); c.fill();
      inkEllipse(c, x, y, 48, 15, 0, { ink, fill: mixRgba('bone', 'ash', 0.25), w: 0.5, seed: 40 + k, color: rgba('bone', 0.35) });
      c.fillStyle = k % 2 ? mixRgba('signal', 'blood', 0.6) : mixRgba('gingham', 'ink', 0.3);
      c.beginPath(); c.ellipse(x, y - 2, 30, 8, 0, 0, Math.PI * 2); c.fill();
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t;
    const kick = beatKick(au, t, 0.3);
    this.room.u.warm!.value = kick;
    this.room.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 兩個人（最先畫：打光只染紙偶）→ 桌子的前緣蓋住下半身（桌子在 bg；人畫在它上面，所以桌面以下用一塊桌面色蓋回去）
    this.drawPeople(c, t);
    puppetLight(c, [0, 200, W, SEAT], rgba('ink', 0.18), rgba('ink', 0.5));
    this.tableFront(c);
    // ---- 烤盤：炭火、鐵網、肉、煙
    this.drawGrill(c, t);
    // ---- 餵的那一下：兩人中間冒一顆愛心
    for (const tf of this.feeds) {
      const k = (t - tf) / 1.2;
      if (k < 0 || k > 1) continue;
      c.save();
      c.globalAlpha = Math.sin(Math.PI * k);
      // 生菜包餵到嘴邊的那裡（兩人中間偏宣文、嘴的高度）冒出來往上飄
      drawHeart(c, (AL_X + OM_X) / 2 - 90 + 20 * Math.sin(k * 6), 520 - 130 * k, 30 + 10 * k);
      c.restore();
    }
    // ---- 木牌（歌詞）與點菜單（留言）
    this.drawPlank(c, t, lyrics);
    this.drawMessage(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.6, vignette: 0.5, zoom: 1 + 0.03 * push, shake: [0, -(GRILL.y - H / 2) * 0.012 * push] };
  }

  /** 兩人：姿勢照時間軸；每拍輕輕點頭；剪的那一下肩膀往下一沉；餵的時候孟庭往前傾。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const nod = beatKick(au, t, 0.28);
    const enA = enterPuppet(this.glow, t, this.ctx.start + 0.05, AL_X, 760, 1);
    if (enA) {
      let snip = 0;
      for (const tc of this.cuts) { const d = t - tc; if (d >= 0 && d < 0.3) snip = Math.max(snip, 1 - d / 0.3); }
      const o: PuppetOpts = { h: SZ, pivot: 0.2, squash: 0.012 * nod + 0.02 * snip + breathe(t, 0.008, 3.2), rot: 0.012 * Math.sin(au.beatAt(t) * Math.PI * 0.5), spin: enA.spin, alpha: enA.alpha };
      drawPick(c, this.alanKeys, t, AL_X, SEAT, o);
    }
    const enO = enterPuppet(this.glow, t, this.ctx.start + 0.15, OM_X, 760, 2);
    if (enO) {
      let lean = 0;
      for (const tf of this.feeds) lean = Math.max(lean, prog(t, tf - 0.25, tf, ease.outCubic) * (1 - prog(t, tf + 0.5, tf + 0.9)));
      const o: PuppetOpts = { h: SZ, pivot: 0.2, squash: 0.012 * nod + breathe(t, 0.008, 3.0, 0.4), rot: -0.04 * lean, spin: enO.spin, alpha: enO.alpha };
      drawPick(c, this.omKeys, t, OM_X, SEAT, o);
    }
  }

  /** 桌面：人畫完之後把桌面以下蓋回去（坐著的人下半身在桌子後面）。跟 bg 的桌子同樣的顏色。 */
  private tableFront(c: CanvasRenderingContext2D) {
    const T = TABLE;
    const tg = c.createLinearGradient(0, T.cy - T.ry, 0, H);
    tg.addColorStop(0, mixRgba('ink2', 'fur', 0.28)); tg.addColorStop(1, mixRgba('ink', 'fur', 0.12));
    c.save();
    c.fillStyle = tg;
    c.beginPath(); c.ellipse(T.cx, T.cy, T.rx, T.ry, 0, Math.PI, 0); c.lineTo(T.cx + T.rx, H); c.lineTo(T.cx - T.rx, H); c.closePath(); c.fill();
    c.strokeStyle = rgba('bone', 0.12);
    c.lineWidth = 2;
    c.beginPath(); c.ellipse(T.cx, T.cy, T.rx, T.ry, 0, Math.PI * 1.02, Math.PI * 1.98); c.stroke();
    c.restore();
  }

  /** 烤盤：炭火（訊號色，跟著大鼓亮）、鐵網、五條肉（每拍翻一條、剪過的分兩段）、煙（被排煙管吸上去）、火星。 */
  private drawGrill(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const G = GRILL;
    const kick = beatKick(au, t, 0.3);
    // 炭爐與炭火：火一律用固定的橘紅（fur、collar），換主題也不會變成紫色的火
    c.save();
    c.fillStyle = rgba('ink', 0.95);
    c.beginPath(); c.ellipse(G.x, G.y + 12, G.rx + 22, G.ry + 16, 0, 0, Math.PI * 2); c.fill();
    const cg = c.createRadialGradient(G.x, G.y + 8, 10, G.x, G.y + 8, G.rx);
    cg.addColorStop(0, mixRgba('fur', 'cream', 0.35 + 0.3 * kick)); cg.addColorStop(0.5, mixRgba('fur', 'collar', 0.5, 0.8)); cg.addColorStop(1, mixRgba('collar', 'ink', 0.6, 0.2));
    c.fillStyle = cg;
    c.beginPath(); c.ellipse(G.x, G.y + 8, G.rx, G.ry, 0, 0, Math.PI * 2); c.fill();
    // 鐵網
    c.strokeStyle = mixRgba('ash', 'ink', 0.2);
    c.lineWidth = 2;
    c.beginPath();
    for (let k = -8; k <= 8; k++) {
      const x = G.x + (k / 8) * G.rx, hh = G.ry * Math.sqrt(Math.max(0, 1 - (k / 8) ** 2));
      c.moveTo(x, G.y - hh); c.lineTo(x, G.y + hh);
    }
    c.stroke();
    c.restore();
    // 肉：翻面在拍點（這一拍翻哪一條照順序），翻的時候跳起來、壓扁成一條線再翻過來
    const cutsDone = this.cuts.filter((tc) => t >= tc).length;
    this.strips.forEach((sp, i) => {
      let flipK = 0, flips = 0;
      this.flips.forEach((tf, j) => {
        if (j % MEAT !== i || t < tf) return;
        flips++;
        const d = t - tf;
        if (d < 0.22) flipK = 1 - d / 0.22;
      });
      const cooked = clamp(0.25 + flips * 0.18);
      const hop = Math.sin(Math.PI * flipK) * 18;
      const sy = Math.cos(Math.PI * (1 - flipK)) * (flipK > 0 ? 1 : 1);
      const pieces = i < cutsDone ? 2 : 1;
      for (let p = 0; p < pieces; p++) {
        const w = pieces === 2 ? sp.w * 0.46 : sp.w;
        const x = pieces === 2 ? sp.x + (p ? 1 : -1) * (sp.w * 0.27) : sp.x;
        this.meat(c, x, sp.y - hop, w, Math.abs(sy), cooked, flips % 2 === 1, sp.seed + p);
      }
      // 翻過去那一下：一團煙、幾點火星
      if (flipK > 0.6) {
        const sg = LIN.fur;
        for (let k = 0; k < 4; k++) {
          const a = -Math.PI / 2 + (hash(i, k, flips) - 0.5) * 1.6, r = 20 + 30 * (1 - flipK);
          this.glow.seg2(sp.x + Math.cos(a) * r * 0.6, sp.y + Math.sin(a) * r * 0.6, sp.x + Math.cos(a) * r, sp.y + Math.sin(a) * r, 2, [sg[0] * 2.5, sg[1] * 2.5, sg[2] * 2.5], flipK);
        }
      }
    });
    // 剪刀剪下去那一下：刀口一閃
    for (const tc of this.cuts) {
      const d = t - tc;
      if (d < 0 || d > 0.25) continue;
      const i = this.cuts.indexOf(tc) % MEAT, sp = this.strips[i]!, k = 1 - d / 0.25, sg = LIN.bone;
      this.glow.seg2(sp.x - 4, sp.y - 30, sp.x + 4, sp.y + 12, 2.5, [sg[0] * 1.5, sg[1] * 1.5, sg[2] * 1.5], k);
    }
    // 煙：一縷一縷往上飄，越高越往排煙管收進去
    c.save();
    for (let k = 0; k < 9; k++) {
      const u = ((t * 0.32 + k / 9) % 1);
      const x0 = G.x + (hash(k, 7) - 0.5) * G.rx * 1.6;
      const x = lerp(x0, DUCT.x, ease.inCubic(u)) + 18 * Math.sin(t * 1.3 + k * 2);
      const y = lerp(G.y - 20, DUCT.bottom + 10, u);
      const r = 30 + 50 * u;
      const a = 0.09 * Math.sin(Math.PI * u) * (1 + 0.8 * kick);
      const sg = c.createRadialGradient(x, y, 0, x, y, r);
      sg.addColorStop(0, rgba('bone', a)); sg.addColorStop(1, rgba('bone', 0));
      c.fillStyle = sg;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.restore();
  }

  /** 一條五花肉：粉紅的瘦肉與白色的油花條紋；烤越久越焦黃；sy 是翻面時看起來的厚度（1 = 平放）。 */
  private meat(c: CanvasRenderingContext2D, x: number, y: number, w: number, sy: number, cooked: number, flipped: boolean, seed: number) {
    const h = 26 * Math.max(0.12, sy);
    // 肉色用固定色：生的是淡紅（collar 加奶油色），烤熟變成焦糖色（fur），再焦一點帶一點黑
    const lean = mixRgba(mixRgba('collar', 'cream', 0.42), mixRgba('fur', 'ink', 0.35), cooked * 0.85);
    const fat = mixRgba('cream', 'fur', cooked * 0.6);
    c.save();
    c.translate(x, y);
    c.rotate(-0.08 + 0.05 * hash(seed, 1));
    c.fillStyle = rgba('ink', 0.35);
    c.beginPath(); c.roundRect(-w / 2 + 4, -h / 2 + 6, w, h, 8); c.fill();
    c.fillStyle = lean;
    c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, 8); c.fill();
    // 油花：兩條白色的條紋（翻過面的位置不一樣）
    c.fillStyle = fat;
    for (const f0 of flipped ? [0.3, 0.72] : [0.22, 0.6]) c.fillRect(-w / 2 + 3, -h / 2 + h * f0, w - 6, Math.max(1, h * 0.14));
    // 焦痕：鐵網的烙印（烤過才有）
    if (cooked > 0.4) {
      c.strokeStyle = rgba('ink', 0.35 * cooked);
      c.lineWidth = 2;
      c.beginPath();
      for (let k = -2; k <= 2; k++) { c.moveTo(k * w * 0.18 - 4, -h / 2 + 2); c.lineTo(k * w * 0.18 + 4, h / 2 - 2); }
      c.stroke();
    }
    c.restore();
  }

  /**
   * 牆上的長木牌：兩條繩子吊著，木紋、邊框；中文歌詞大字、原文小一號在下面（drawLyric 自動畫）；換一句時木牌晃一下（很快停住，
   * 字在停住之後才是正的，斜的字不會一直重新光柵化）。間奏時木牌上寫一行淡淡的「（間奏：肉還在烤）」。
   */
  private drawPlank(c: CanvasRenderingContext2D, t: number, lyrics: typeof this.ctx.lyrics) {
    const P = PLANK;
    let swing = 0;
    for (const ls of this.lineStarts) { const d = t - ls; if (d >= 0 && d < 0.6) swing = 0.03 * Math.sin(d * 18) * Math.exp(-d / 0.18); }
    const ink = inkFor(false, { fill: rgba('ink2') });
    c.save();
    c.translate(P.x + P.w / 2, P.y - 64);
    if (Math.abs(swing) > 0.0005) c.rotate(swing);
    c.translate(-P.w / 2, 64);
    // 吊繩
    c.strokeStyle = rgba('bone', 0.35);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(60, -64); c.lineTo(40, 0); c.moveTo(P.w - 60, -64); c.lineTo(P.w - 40, 0); c.stroke();
    // 木板：影子、底色、木紋、內框
    c.fillStyle = rgba('ink', 0.5);
    c.fillRect(10, 12, P.w, P.h);
    const wg = c.createLinearGradient(0, 0, 0, P.h);
    wg.addColorStop(0, mixRgba('ink2', 'fur', 0.5)); wg.addColorStop(1, mixRgba('ink2', 'fur', 0.36));
    c.fillStyle = wg;
    c.fillRect(0, 0, P.w, P.h);
    c.strokeStyle = rgba('ink', 0.18);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let k = 0; k < 5; k++) { const y = 20 + k * 44 + 6 * hash(k, 9); c.moveTo(8, y); c.bezierCurveTo(P.w * 0.3, y - 6, P.w * 0.7, y + 7, P.w - 8, y - 2); }
    c.stroke();
    inkPoly(c, [{ x: 0, y: 0 }, { x: P.w, y: 0 }, { x: P.w, y: P.h }, { x: 0, y: P.h }], { ink, w: 0.6, seed: 71, color: rgba('ink', 0.6) });
    c.strokeStyle = rgba('bone', 0.14);
    c.lineWidth = 1.5;
    c.strokeRect(14, 14, P.w - 28, P.h - 28);
    const ly = lyricAt(lyrics, t);
    const a = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.55);
    if (ly) {
      const st: LyricStyle = { family: F.ming(700), size: this.lyricSize, minSize: 40, maxWidth: P.w - 70, align: 'center', unsung: rgba('bone', 0.3), sung: rgba('bone', 0.94), active: rgba('signal') };
      drawLyricIn(c, ly.line, t, st, { x: 0, y: 14, w: P.w, h: P.h - 28 }, ly.k * a);
    } else {
      c.font = font(F.ming(700), 40);
      c.textAlign = 'center';
      c.fillStyle = rgba('bone', 0.4 * a);
      c.fillText('（間奏：肉還在烤）', P.w / 2, P.h / 2 + 14);
    }
    c.restore();
  }

  /** 點菜單上的手寫留言：第一拍起逐字寫上去，寫完署名淡入。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const P0 = this.pad;
    const top = P0.y + PAD.top, h = P0.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.15, this.ctx.start + 0.55);
    writeNote(c, n, P0.x + PAD.x, top + Math.max(0, (h - n.height) * 0.4), t, this.noteT0, { msg: !!this.msg, color: rgba('ink', 0.92), faint: rgba('ink', 0.58), sig: rgba('ink', 0.7) });
    c.restore();
  }
}
