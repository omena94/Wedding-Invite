// 桌球（暗、sport）：深夜的桌球室，一盞吊燈打在球桌上，鏡頭在球桌側面、差不多桌面的高度。宣文（左）與孟庭（右）對打。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 一拍一球（太快的歌兩拍一球）：快歌很快、慢歌很慢。準備（ready）→ 拍點前身體往後帶 → 拍點上換成抽球（hit，球就在拍面上）→ 收回。
//    每一球在對方的半張桌子彈一次（半拍附近），桌面亮一圈小波紋；小節線上那一球是殺球：揮得比較大、球比較快、彈地的光比較亮，畫面輕輕一震。
//  - 球是白色的小點，拖著訊號色的光（加亮、會發光），暗暗的房間裡最亮的是它的軌跡。
//  - 歌詞在球桌上方一行（照跟唱規則逐字亮），**跟著球跳**：每次球彈在桌上（拍點附近），正在唱的那個詞被球「彈」起來一下，
//    其他字輕輕跟著晃；比留言小一級（標準 v2：40～52）。
//  - **焦點是主打留言**：寫在右上牆上釘著的一張紙（兩顆圖釘、稍微歪、牆上一盞小燈打著它），深墨手寫字；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、紙最大 600 × 400，高度跟著留言長短。沒有留言時紙上寫邀請、字淡，歌詞變主角。
//  - 吊燈：拍點上輕輕晃（燈罩下的光錐跟著晃），光錐裡飄著細細的灰塵。人上亮下暗（puppetLight），白 T 不會比紙上的字還亮。
//  - 鏡頭：整個窗格慢慢往右搖、推近一點點；殺球的時候頓一下。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, layoutLyric, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { Lyrics } from '../engine/lyrics';
import { inkFor, inkLine, inkPoly, drawNote, type Pt, type Note, type Ink } from './_couple';
import { loadPuppets, drawPick, puppetPoint, puppetShadow, puppetIn, puppetLight, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'sport', paper: false, energy: [0.3, 1], bars: [4, 8] };

const FLOOR = 1000;
const SZ = 440;
const XW = 250, MT = 1175;
/** 球桌：桌面前緣的高度、左右端、往後的深度（斜斜往上看得到一點桌面）。 */
const TOP = FLOOR - SZ * 0.434;
const TX0 = 368, TX1 = 1058, TDEPTH = 34, TSKEW = 12;
const NETX = (TX0 + TX1) / 2, NET_H = SZ * 0.087;
/** 吊燈：掛點與燈罩的高度。 */
const LAMP = { x: NETX, y: 0, len: 250 };
/** 牆上釘著的紙：最大的範圍（標準 v2；上緣的圖釘位置固定、高度跟著留言）與寫字的內距。 */
const SHEET = { x: 1200, y: 118, w: 600, h: 400, rot: -0.022 };
const PAD = { x: 36, top: 44, bottom: 26 };
/** 歌詞：球桌上方一行（中心、基線、最寬）。 */
const LYR = { x: NETX, y: 488, w: 780 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const BALL_R = 6;

const WHO = [
  { p: 'xw', x: XW, flip: false, dir: 1 },
  { p: 'mt', x: MT, flip: true, dir: -1 },
] as const;
const POSES = WHO.flatMap(({ p }) => [`${p}_pingpong_ready`, `${p}_pingpong_hit`]);

interface Hit { t: number; who: 0 | 1; smash: boolean; bounce: number; bx: number }

/**
 * 桌球室的底：很暗的牆、吊燈的光錐（跟著燈晃）、桌面上的光池、照著紙的小燈。用 shader 算（浮點＋抖色），
 * Canvas2D 的淡漸層只有幾個 8 位元的階，大螢幕上會看到一圈一圈的。
 */
const ROOM = () => new FSPass(/* glsl */ `
  uniform float swing;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 lamp = vec2(${LAMP.x}.0 + swing * ${LAMP.len}.0, ${LAMP.len}.0);
    // 光錐：從燈罩往下張開，方向跟著燈晃
    vec2 d = p - lamp;
    float ang = atan(d.x, d.y) - swing * 0.9;
    float cone = (1.0 - smoothstep(0.34, 0.62, abs(ang))) * smoothstep(0.0, 60.0, d.y) * exp(-d.y / 1100.0);
    vec2 q = (p - vec2(${NETX}.0 + swing * 180.0, ${Math.round(TOP)}.0)) / vec2(560.0, 150.0);
    float pool = exp(-dot(q, q) * 1.6);
    vec2 s = (p - vec2(${SHEET.x + SHEET.w / 2}.0, ${SHEET.y + SHEET.h / 2}.0)) / vec2(460.0, 400.0);
    float board = exp(-dot(s, s) * 1.5);
    float floorK = smoothstep(${FLOOR - 40}.0, ${FLOOR + 10}.0, p.y);
    vec3 col = C_INK + C_BONE * (0.014 * cone + 0.028 * pool + 0.016 * board) + C_SIGNAL * 0.01 * cone;
    col = mix(col, C_INK2 * 0.9 + C_BONE * 0.02 * pool, floorK * 0.7);
    col += (hash12(p + 0.5) - 0.5) * 0.003;
    fragColor = vec4(col, 1.0);
  }`, { swing: { value: 0 } });

export default class Pingpong extends Scene {
  room = shared('pingpong.room', ROOM);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  hits: Hit[] = [];
  keys: [number, string][][] = [[], []];
  contact: [Pt, Pt] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  note: Note | null = null;
  sheet = { ...SHEET };
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + 'TABLE 3 · 21:00');
    this.track(await loadPuppets(POSES));
    WHO.forEach((w, i) => {
      this.contact[i] = puppetPoint(`${w.p}_pingpong_hit`, 'paddle', w.x, FLOOR, { h: SZ, flip: w.flip }) ?? { x: w.x + w.dir * SZ * 0.3, y: TOP - SZ * 0.14 };
    });
    // 擊球表：進場之後第一拍起一拍一球（太快的歌兩拍一球），宣文先；小節線上那一球是殺球
    const step = au.beatPeriod(this.ctx.start) < 0.33 ? 2 : 1;
    let b = Math.ceil(au.beatAt(beatAfter(au, this.ctx.start + 0.7)) - 1e-6);
    let who: 0 | 1 = 0;
    for (let k = 0; k < 400; k++) {
      const t = au.timeOfBeat(b);
      if (t > this.ctx.end + 1) break;
      const next = au.timeOfBeat(b + step);
      const bar = au.barAt(t);
      const smash = k > 0 && Math.abs(bar - Math.round(bar)) < 0.05;
      // 彈在對方那半張桌子（殺球彈得比較靠近網、時間早一點）
      const tb = lerp(t, next, smash ? 0.42 : 0.55);
      const bx = who === 0 ? lerp(NETX, TX1, smash ? 0.35 : 0.55) : lerp(NETX, TX0, smash ? 0.35 : 0.55);
      this.hits.push({ t, who, smash, bounce: tb, bx });
      who = who ? 0 : 1;
      b += step;
    }
    WHO.forEach((w, i) => {
      const ks: [number, string][] = [[-1e9, `${w.p}_pingpong_ready`]];
      for (const h of this.hits) {
        if (h.who !== i) continue;
        const bp = au.beatPeriod(h.t) * step;
        ks.push([h.t, `${w.p}_pingpong_hit`], [h.t + Math.min(0.36, bp * (h.smash ? 0.75 : 0.55)), `${w.p}_pingpong_ready`]);
      }
      this.keys[i] = ks;
    });
    // 紙上的留言：標準 v2 的字級；紙的寬高跟著留言（靠右釘）
    const c = this.fg.ctx;
    const w = SHEET.w - PAD.x * 2, hmax = SHEET.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    this.sheet.h = Math.min(SHEET.h, Math.max(210, PAD.top + this.note.height + PAD.bottom + 12));
    this.sheet.w = Math.min(SHEET.w, tightenNote(c, this.note, 320) + PAD.x * 2);
    this.sheet.x = SHEET.x + SHEET.w - this.sheet.w;
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：地板線、牆上的紙與小燈、球桌（桌面、網子、桌腳）。畫一次。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ink = inkFor(false, { fill: rgba('ink2') });
    // 地板與牆的交界、踢腳板
    inkLine(c, [{ x: 60, y: FLOOR - 150 }, { x: 1860, y: FLOOR - 150 }], { ink, w: 0.4, seed: 2, color: rgba('bone', 0.1) });
    inkLine(c, [{ x: 40, y: FLOOR + 2 }, { x: 1880, y: FLOOR + 2 }], { ink, w: 0.6, seed: 3, color: rgba('bone', 0.22) });
    // 紙直接釘在牆上（不要再多一塊板子：容器只比字多一點邊）
    const S = this.sheet;
    // 紙：往右下的影子、象牙白、兩顆圖釘
    c.save();
    c.translate(S.x + S.w / 2, S.y + S.h / 2);
    c.rotate(S.rot);
    c.fillStyle = rgba('ink', 0.55);
    c.fillRect(-S.w / 2 + 8, -S.h / 2 + 10, S.w, S.h);
    c.fillStyle = mixRgba('bone', 'cream', 0.35);
    c.fillRect(-S.w / 2, -S.h / 2, S.w, S.h);
    const shade = c.createLinearGradient(0, -S.h / 2, 0, S.h / 2);
    shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, rgba('sepia', 0.1));
    c.fillStyle = shade;
    c.fillRect(-S.w / 2, -S.h / 2, S.w, S.h);
    for (const px of [-S.w / 2 + 26, S.w / 2 - 26]) {
      c.fillStyle = rgba('ink', 0.4); c.beginPath(); c.arc(px + 3, -S.h / 2 + 20, 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = rgba('signal', 0.9); c.beginPath(); c.arc(px, -S.h / 2 + 17, 7, 0, Math.PI * 2); c.fill();
    }
    c.font = font(F.mono(500), 14);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.5);
    c.textAlign = 'right';
    c.fillText('TABLE 3 · 21:00', S.w / 2 - PAD.x, -S.h / 2 + 30);
    c.restore();
    // 牆上的小燈（照著紙）
    const lx = S.x + S.w / 2, ly = S.y - 44;
    inkPoly(c, [{ x: lx - 34, y: ly - 18 }, { x: lx + 34, y: ly - 18 }, { x: lx + 22, y: ly }, { x: lx - 22, y: ly }], { ink, fill: rgba('ink2'), w: 0.7, seed: 6, color: rgba('bone', 0.4) });
    this.drawTable(c, ink);
    L.upload();
  }

  /** 球桌：桌面是一條斜斜的平行四邊形（看得到一點桌面）、白色的邊線與中線、網子、四隻桌腳。 */
  private drawTable(c: CanvasRenderingContext2D, ink: Ink) {
    const f0 = { x: TX0, y: TOP }, f1 = { x: TX1, y: TOP }, b0 = { x: TX0 + TSKEW, y: TOP - TDEPTH }, b1 = { x: TX1 + TSKEW, y: TOP - TDEPTH };
    // 桌腳（後面兩隻淡一點）
    for (const [x, a] of [[TX0 + 90 + TSKEW, 0.35], [TX1 - 90 + TSKEW, 0.35], [TX0 + 70, 0.8], [TX1 - 70, 0.8]] as const) {
      inkLine(c, [{ x, y: TOP + 12 }, { x, y: FLOOR - (a < 0.5 ? 24 : 0) }], { ink, w: 1.2, seed: x, color: rgba('bone', 0.3 * a) });
    }
    inkLine(c, [{ x: TX0 + 70, y: TOP + 170 }, { x: TX1 - 70, y: TOP + 170 }], { ink, w: 0.6, seed: 31, color: rgba('bone', 0.14) });
    // 桌面（深色，比地板亮一點；燈打在中間）
    const g = c.createLinearGradient(TX0, 0, TX1, 0);
    g.addColorStop(0, mixRgba('ink2', 'bone', 0.05)); g.addColorStop(0.5, mixRgba('ink2', 'bone', 0.12)); g.addColorStop(1, mixRgba('ink2', 'bone', 0.05));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(f0.x, f0.y); c.lineTo(b0.x, b0.y); c.lineTo(b1.x, b1.y); c.lineTo(f1.x, f1.y); c.closePath(); c.fill();
    // 桌子的厚度（前緣）
    c.fillStyle = rgba('ink2');
    c.fillRect(TX0, TOP, TX1 - TX0, 12);
    // 白色的邊線與中線（中線沿著長邊、在深度的正中間）
    c.strokeStyle = rgba('bone', 0.55);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(f0.x, f0.y); c.lineTo(f1.x, f1.y); c.lineTo(b1.x, b1.y); c.lineTo(b0.x, b0.y); c.closePath();
    c.moveTo(TX0 + TSKEW / 2, TOP - TDEPTH / 2); c.lineTo(TX1 + TSKEW / 2, TOP - TDEPTH / 2);
    c.stroke();
    c.strokeStyle = rgba('bone', 0.18); c.lineWidth = 1;
    c.beginPath(); c.moveTo(TX0, TOP + 12); c.lineTo(TX1, TOP + 12); c.stroke();
    // 網子：網柱、細格、上緣白帶
    const n0 = { x: NETX, y: TOP + 2 }, n1 = { x: NETX + TSKEW, y: TOP - TDEPTH };
    c.save();
    c.strokeStyle = rgba('bone', 0.2);
    c.lineWidth = 1;
    c.beginPath();
    for (let k = 0; k <= 8; k++) { const x = lerp(n0.x, n1.x, k / 8), y = lerp(n0.y, n1.y, k / 8); c.moveTo(x, y); c.lineTo(x, y - NET_H); }
    for (let k = 1; k < 5; k++) { c.moveTo(n0.x, n0.y - (NET_H * k) / 5); c.lineTo(n1.x, n1.y - (NET_H * k) / 5); }
    c.stroke();
    c.restore();
    inkLine(c, [{ x: n0.x, y: n0.y - NET_H }, { x: n1.x, y: n1.y - NET_H }], { ink, w: 1.4, seed: 32, color: rgba('bone', 0.8) });
    inkLine(c, [{ x: n0.x, y: n0.y + 8 }, { x: n0.x, y: n0.y - NET_H - 4 }], { ink, w: 1, seed: 33 });
  }

  /** 吊燈晃的角度（-1..1 的比例，乘上擺幅）：拍點上被推一下的鐘擺。 */
  private swingAt(t: number) {
    const au = this.ctx.audio;
    const bar = au.barAt(t);
    return 0.035 * Math.sin(bar * Math.PI) + 0.01 * beatKick(au, t, 0.4);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const sw = this.swingAt(t);
    this.room.u.swing!.value = sw;
    this.room.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);

    // 兩個人（這一層最先畫：打光只染紙偶）
    this.drawPlayer(c, 0, t);
    this.drawPlayer(c, 1, t);
    puppetLight(c, [0, FLOOR - SZ * 1.3, W, SZ * 1.3 + 20], rgba('ink', 0.1), rgba('ink', 0.62));

    this.drawLamp(c, t, sw);
    this.drawLyric(c, t, rv);
    this.drawBall(c, t);
    this.drawSheet(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：慢慢往右搖、推近；殺球的那一下頓一下
    const push = ease.inOutCubic(f.p);
    let jolt = 0;
    for (const h of this.hits) if (h.smash && t >= h.bounce && t < h.bounce + 0.2) jolt = 1 - (t - h.bounce) / 0.2;
    return { bloom: 0.75, vignette: 0.5, zoom: 1 + 0.028 * push + 0.006 * jolt, shake: [-30 * push, 3 * jolt] };
  }

  /** 吊燈：一條線垂下來、燈罩（梯形），燈泡是亮的；光錐裡的灰塵。 */
  private drawLamp(c: CanvasRenderingContext2D, t: number, sw: number) {
    const ink = inkFor(false, { fill: rgba('ink2') });
    const hx = LAMP.x + sw * LAMP.len, hy = LAMP.len;
    inkLine(c, [{ x: LAMP.x, y: 0 }, { x: hx, y: hy - 30 }], { ink, w: 0.5, seed: 41, color: rgba('bone', 0.35) });
    c.save();
    c.translate(hx, hy);
    c.rotate(-sw);
    inkPoly(c, [{ x: -16, y: -34 }, { x: 16, y: -34 }, { x: 70, y: 8 }, { x: -70, y: 8 }], { ink, fill: rgba('ink2'), w: 0.8, seed: 42, color: rgba('bone', 0.5) });
    c.restore();
    const e = LIN.ember;
    this.glow.seg2(hx - 40, hy + 8, hx + 40, hy + 8, 5, [e[0] * 2.4, e[1] * 2.4, e[2] * 2.4], 0.9);
    // 灰塵（只在光錐裡）
    c.save();
    c.fillStyle = rgba('bone', 1);
    for (let k = 0; k < 30; k++) {
      const yy = hy + 40 + ((hash(k, 2) * 380 + t * (8 + 10 * hash(k, 3))) % 380);
      const spread = (yy - hy) * 0.55;
      const x = hx + (hash(k, 1) - 0.5) * 2 * spread + Math.sin(t * 0.4 + k) * 12;
      c.globalAlpha = 0.05 + 0.1 * hash(k, 4) * (0.6 + 0.4 * Math.sin(t * 1.3 + k * 2));
      c.beginPath(); c.arc(x, yy, 1 + 1.3 * hash(k, 5), 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** 一個人：姿勢時間軸＋拍點前往後帶、擊球往前送（殺球更大）＋對手擊球時重心換一下＋呼吸與拍子。 */
  private drawPlayer(c: CanvasRenderingContext2D, i: 0 | 1, t: number) {
    const au = this.ctx.audio, w = WHO[i];
    const bp = au.beatPeriod(t);
    let lift = 0, rot = 0, squash = breathe(t, 0.008, 2.9, i * 0.5) + 0.014 * beatKick(au, t, 0.3);
    for (const h of this.hits) {
      const d = t - h.t;
      if (d < -bp * 1.2 || d > bp * 1.2) continue;
      if (h.who === i) {
        const amp = h.smash ? 1.8 : 1;
        if (d < 0) rot -= w.dir * 0.045 * amp * prog(t, h.t - bp * 0.45, h.t, ease.inOutCubic);
        else rot += w.dir * 0.06 * amp * Math.exp(-d / (bp * 0.3));
        if (d >= 0 && d < 0.16) squash += 0.045 * amp * (1 - d / 0.16);
        if (h.smash && d > -bp * 0.4 && d < bp * 0.3) lift = Math.max(lift, 14 * Math.sin(Math.PI * clamp((d + bp * 0.4) / (bp * 0.7))));
      } else {
        const u = (t - h.t + 0.03) / 0.22;
        if (u > 0 && u < 1) lift = Math.max(lift, 7 * Math.sin(Math.PI * u));
      }
    }
    const ent = puppetIn(t, this.ctx.start + 0.05 + i * 0.12, 0.45);
    if (ent.alpha <= 0) return;
    const o: PuppetOpts = { h: SZ, flip: w.flip, rot, pivot: 0.4, squash, spin: ent.spin, alpha: ent.alpha };
    puppetShadow(c, w.p, w.x, FLOOR, { h: SZ, lift, alpha: 0.8 * ent.alpha, wide: 1.3, color: '0,0,0' });
    drawPick(c, this.keys[i]!, t, w.x, FLOOR - lift, o);
    if (ent.k < 1) {
      sparkHead(this.glow, w.x, FLOOR - 6, t, 0.8);
      sparkParticles(this.glow, t, () => ({ x: w.x, y: FLOOR - 6 }), { rate: 60, life: 0.3, speed: 150, seed: i + 1 });
    }
  }

  /** 第 k 球這一格的位置：拍面 → 對方桌面彈一次 → 對方拍面（殺球壓低）。 */
  private ballPos(k: number, t: number): Pt | null {
    const h = this.hits[k], n = this.hits[k + 1];
    if (!h) return null;
    const from = this.contact[h.who];
    const to = this.contact[h.who ? 0 : 1];
    const t1 = n ? n.t : h.t + (h.bounce - h.t) * 2.2;
    const tableY = TOP - TDEPTH / 2;
    if (t < h.bounce) {
      const u = clamp((t - h.t) / Math.max(0.05, h.bounce - h.t));
      const peak = h.smash ? 10 : 70;
      return { x: lerp(from.x, h.bx, u), y: lerp(from.y, tableY - BALL_R, u) - 4 * peak * u * (1 - u) };
    }
    const u = clamp((t - h.bounce) / Math.max(0.05, t1 - h.bounce));
    const peak = h.smash ? 40 : 60;
    return { x: lerp(h.bx, to.x, u), y: lerp(tableY - BALL_R, to.y, u) - 4 * peak * u * (1 - u) };
  }

  /** 球：白色的小點、拖著會發光的訊號色軌跡；擊球的火花；彈在桌上的一圈光（殺球更亮）。 */
  private drawBall(c: CanvasRenderingContext2D, t: number) {
    let k = -1;
    for (let i = 0; i < this.hits.length; i++) if (this.hits[i]!.t <= t) k = i;
    if (k < 0) {
      // 發球前：球停在宣文手邊
      if (t > this.ctx.start + 0.45 && this.hits.length) {
        const p = this.contact[0];
        c.fillStyle = rgba('bone');
        c.beginPath(); c.arc(p.x + 6, p.y - 26 - 10 * Math.abs(Math.sin(t * 5)), BALL_R, 0, Math.PI * 2); c.fill();
      }
      return;
    }
    const h = this.hits[k]!;
    const sg = LIN.signal, e = LIN.ember;
    // 軌跡：往回取 0.2 秒
    const trail: Pt[] = [];
    for (let j = 14; j >= 0; j--) {
      const tt = t - j * 0.014;
      let kk = k;
      while (kk > 0 && this.hits[kk]!.t > tt) kk--;
      const p = this.ballPos(kk, tt);
      if (p) trail.push(p);
    }
    for (let j = 1; j < trail.length; j++) {
      const a = j / trail.length;
      const m = h.smash ? 3.2 : 2.2;
      this.glow.seg2(trail[j - 1]!.x, trail[j - 1]!.y, trail[j]!.x, trail[j]!.y, 1 + 3.5 * a, [sg[0] * m, sg[1] * m, sg[2] * m], 0.1 + 0.8 * a * a);
    }
    const p = this.ballPos(k, t)!;
    // 桌面上的影子（球在桌子上方的時候）
    if (p.x > TX0 && p.x < TX1) {
      const up = clamp((TOP - TDEPTH / 2 - p.y) / 160);
      c.fillStyle = rgba('ink', 0.5 * (1 - up));
      c.beginPath(); c.ellipse(p.x, TOP - TDEPTH / 2 + 2, BALL_R * (1.6 - up * 0.6), BALL_R * 0.5, 0, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = rgba('bone');
    c.beginPath(); c.arc(p.x, p.y, BALL_R, 0, Math.PI * 2); c.fill();
    this.glow.seg2(p.x, p.y, p.x + 0.01, p.y, 10, [e[0] * 0.8, e[1] * 0.8, e[2] * 0.8], 0.5);
    // 擊球：拍面炸一圈短線
    const ki = 1 - clamp((t - h.t) / 0.14);
    if (ki > 0) {
      const cp = this.contact[h.who];
      for (let r = 0; r < 7; r++) {
        const ang = (r / 7) * Math.PI * 2 + 0.3, r0 = 12 + (1 - ki) * 24, r1 = r0 + 11 * ki;
        this.glow.seg2(cp.x + Math.cos(ang) * r0, cp.y + Math.sin(ang) * r0, cp.x + Math.cos(ang) * r1, cp.y + Math.sin(ang) * r1, 2, [e[0] * 3, e[1] * 3, e[2] * 3], ki);
      }
    }
    // 彈在桌上：一圈扁扁的光（在桌面上），殺球更亮更大
    for (const q of [this.hits[k - 1], h]) {
      if (!q || t < q.bounce) continue;
      const kb = 1 - clamp((t - q.bounce) / (q.smash ? 0.45 : 0.3));
      if (kb <= 0) continue;
      const m = q.smash ? 4 : 2.4, R = (q.smash ? 18 : 10) + (1 - kb) * (q.smash ? 70 : 40);
      const pts: Pt[] = [];
      for (let j = 0; j <= 24; j++) { const a = (j / 24) * Math.PI * 2; pts.push({ x: q.bx + TSKEW / 2 + Math.cos(a) * R, y: TOP - TDEPTH / 2 + Math.sin(a) * R * 0.18 }); }
      this.glow.polyline(pts, 1.6, [sg[0] * m, sg[1] * m, sg[2] * m], kb);
    }
  }

  /**
   * 歌詞：球桌上方一行，照跟唱規則逐字亮；每次球彈在桌上，正在唱的詞被彈起來（跳一下再落回來），
   * 旁邊的字輕輕跟著晃（越遠越小）。
   */
  private drawLyric(c: CanvasRenderingContext2D, t: number, rv: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    if (!ly) return;
    const st = { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, maxWidth: LYR.w, align: 'center' as const, lineHeight: 1.12 };
    const lay = layoutLyric(c, ly.line, st);
    // 最近一次彈地
    let tb = -1e9, hb: Hit | null = null;
    for (const h of this.hits) if (h.bounce <= t && h.bounce > tb) { tb = h.bounce; hb = h; }
    const since = t - tb;
    const jump = since >= 0 && since < 0.32 ? Math.sin(Math.PI * (since / 0.32)) : 0;
    // 正在唱（或下一個要唱）的字
    let ai = -1;
    lay.words.forEach((pw, i) => { if (ai < 0 && Lyrics.wordProgress(pw.word, t) < 1 && pw.word.start - 0.25 <= t) ai = i; });
    c.save();
    c.font = font(st.family, lay.size);
    c.textBaseline = 'alphabetic';
    const y0 = LYR.y - (lay.height - lay.size);
    lay.words.forEach((pw, i) => {
      const p = Lyrics.wordProgress(pw.word, t);
      const dist = ai < 0 ? 9 : Math.abs(i - ai);
      const hop = jump * (hb?.smash ? 30 : 20) * (dist === 0 ? 1 : Math.max(0, 0.28 - dist * 0.08));
      const x = LYR.x + pw.x, y = y0 + pw.y - hop;
      c.globalAlpha = ly.k * rv;
      c.fillStyle = p >= 1 ? rgba('bone', 0.94) : p > 0 ? rgba('signal') : rgba('bone', 0.28);
      c.fillText(pw.word.w, x, y);
    });
    // 韓文歌的原文（layoutLyric 排在中文正下方，height 已經算進去，所以中文往上讓了位置）：
    // 比中文安靜——唱到、唱完都是淡兩成的紙白（不用訊號色），被球彈起來的幅度也小一半
    const sub = lay.sub;
    if (sub) {
      c.font = font(st.family, sub.lay.size);
      let si = -1;
      sub.lay.words.forEach((pw, i) => { if (si < 0 && Lyrics.wordProgress(pw.word, t) < 1 && pw.word.start - 0.25 <= t) si = i; });
      sub.lay.words.forEach((pw, i) => {
        const p = Lyrics.wordProgress(pw.word, t);
        const dist = si < 0 ? 9 : Math.abs(i - si);
        const hop = 0.5 * jump * (hb?.smash ? 30 : 20) * (dist === 0 ? 1 : Math.max(0, 0.28 - dist * 0.08));
        c.globalAlpha = ly.k * rv;
        c.fillStyle = p > 0 ? rgba('bone', 0.94 * 0.8) : rgba('bone', 0.28);
        c.fillText(pw.word.w, LYR.x + pw.x, y0 + sub.dy + pw.y - hop);
      });
    }
    c.restore();
  }

  /** 紙上的主打留言：第一球起一個字一個字寫上去（深墨手寫字），寫完署名淡入；在紙面上垂直置中，跟紙一起稍微歪。 */
  private drawSheet(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const S = this.sheet;
    const t0 = Math.min(this.hits[0]?.t ?? this.ctx.start + 0.45, this.ctx.start + 0.45);
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.025, 0.09);
    const done = t0 + total * per;
    const top = S.y + PAD.top, h = S.h - PAD.top - PAD.bottom;
    c.save();
    c.translate(S.x + S.w / 2, S.y + S.h / 2);
    c.rotate(S.rot);
    c.translate(-(S.x + S.w / 2), -(S.y + S.h / 2));
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
    drawNote(c, n, S.x + PAD.x, top + Math.max(0, (h - n.height) * 0.5), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.6), sigColor: rgba('sepia', 0.72), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
