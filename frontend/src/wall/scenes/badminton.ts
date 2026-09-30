// 羽球對打（暗、sport）：夜裡的體育館，側面看宣文與孟庭隔網對打。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 擊球一定落在拍點上：每一拍（快歌兩拍）一球，宣文、孟庭輪流打。預備（ready，拍點前身體往後帶一下）→ 拍點上換成收拍（swing）→ 回到預備；
//    小節線上的那一球是跳殺：起跳、最高點剛好在拍點上擊球（smash 那張）、落地壓扁回彈，球壓低直直往下。對手在對方擊球那一刻原地小跳（split step）。
//  - 羽球飛過的拋物線留下訊號色的細線（加亮、會發光），擊球的瞬間拍面炸一圈短線；擊球點就是圖上球拍面的位置（manifest 的道具點）。
//  - 歌詞沿著高遠球的弧線排（lyricOnPath），比留言小一級（標準 v2：40～52），球就從字上面飛過去。
//  - **焦點是主打留言**：寫在右上吊著的記分板上（有厚度、頂上打光、兩條吊鍊，是體育館裡的東西，不是介面卡片）；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、板子最大 630 × 420、放在畫面右上，高度跟著留言長短。
//    板子上只留一個小小的「LOVE · ALL」（羽球開賽的報分：零比零）。沒有留言時板子寫邀請。
//  - 鏡頭：整個窗格慢慢推近、往記分板那邊飄一點；大鼓時輕輕一頓。燈光裡飄著細細的灰塵。
//  - 開場：兩個紙偶從側面翻正進場（仙女棒的火花在腳邊），之後才發球。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { lyricAt, lyricSubOf, beatAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, inkLine, shuttle, arcAt, arcPts, lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPick, puppetPoint, puppetShadow, puppetIn, puppetLight, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'sport', paper: false, energy: [0.4, 1], bars: [4, 8] };

const FLOOR = 880;
const SZ = 380; // 場景尺度：宣文的身高（px）
const AX = 300, OX = 1040, NET = 670;
/** 記分板（右上吊著）：最大的尺寸（標準 v2：寬 ≤ 860、高 ≤ 430）；實際高度跟著留言長短。寫字的範圍是板面往內縮一圈。 */
const BOARD = { x: 1190, y: 110, w: 630, h: 420 };
const PAD = { x: 40, top: 68, bottom: 34 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
/** 高遠球弧線的頂點（y）：頂點上的歌詞字頂要離上緣 96 px 以上。 */
const APEX = 196;
/** 跳殺跳多高（px）。 */
const JUMP = SZ * 0.2;
/** 擊球前身體往後帶的角度（弧度）：擊球點照這個角度算，拍面才剛好碰到球。 */
const WIND = 0.07;
/** 擊球之後預備姿勢再停幾格才換收拍（火花炸在拍面上，再看到揮過去）。 */
const IMPACT = 0.06;
const WHO = [
  { p: 'xw', x: AX, flip: false, dir: 1 },
  { p: 'mt', x: OX, flip: true, dir: -1 },
] as const;
const POSES = WHO.flatMap(({ p }) => [`${p}_bad_ready`, `${p}_bad_swing`, `${p}_bad_smash`]);

interface Hit { t: number; who: 0 | 1; smash: boolean }

/**
 * 體育館的底：天花板的燈讓球場上方一團很淡的光。用 shader 算（浮點＋一點點抖色）：
 * Canvas2D 的淡漸層只有幾個 8 位元的階，大螢幕上會看到一圈一圈的。
 */
const HALL = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = (p - vec2(700.0, 330.0)) / vec2(950.0, 720.0);
    float lamp = exp(-dot(q, q) * 2.4);
    vec3 col = C_INK + C_BONE * 0.011 * lamp;
    col += (hash12(p + 0.5) - 0.5) * 0.0025;
    fragColor = vec4(col, 1.0);
  }`);

export default class Badminton extends Scene {
  hall = shared('badminton.hall', HALL);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  hits: Hit[] = [];
  /** 兩個人的擊球點：高遠球（預備姿勢的拍面）與跳殺（最高點的拍面）。 */
  contact: [Pt, Pt] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  smashAt: [Pt, Pt] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  arc: Pt[] = [];
  /** 每個人的姿勢時間軸（[開始時間, 圖名]）。 */
  keys: [number, string][][] = [[], []];
  note: Note | null = null;
  board = { ...BOARD };
  msgT0 = 0;
  lyricSize = 52;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(POSES));
    // 擊球點：圖上球拍面的位置（預備姿勢 = 高遠球；跳到最高點的 smash = 跳殺）
    WHO.forEach((w, i) => {
      this.contact[i] = puppetPoint(`${w.p}_bad_ready`, 'racket', w.x, FLOOR, { h: SZ, flip: w.flip, rot: -w.dir * WIND, pivot: 0.45 })!;
      this.smashAt[i] = puppetPoint(`${w.p}_bad_smash`, 'racket', w.x, FLOOR - JUMP, { h: SZ, flip: w.flip, rot: w.dir * 0.1, pivot: 0.45 })!;
    });
    this.arc = arcPts(this.contact[0], this.contact[1], Math.min(this.contact[0].y, this.contact[1].y) - APEX, 64);
    // 擊球表：開場進場之後第一個拍點發球，一拍一球（太快的歌兩拍一球）；小節線上的是跳殺
    const tStart = this.ctx.start + 0.55;
    const step = au.beatPeriod(this.ctx.start) < 0.38 ? 2 : 1;
    let b = Math.ceil(au.beatAt(beatAfter(au, tStart + 0.2)) - 1e-6);
    let who: 0 | 1 = 0;
    for (let k = 0; k < 200; k++) {
      const t = au.timeOfBeat(b);
      if (t > this.ctx.end + 1) break;
      const bar = au.barAt(t);
      this.hits.push({ t, who, smash: k > 0 && Math.abs(bar - Math.round(bar)) < 0.05 });
      who = who ? 0 : 1;
      b += step;
    }
    // 姿勢時間軸：一般球在拍點換成收拍、停一下回到預備；跳殺整段在空中用 smash
    WHO.forEach((w, i) => {
      const ks: [number, string][] = [[-1e9, `${w.p}_bad_ready`]];
      for (const h of this.hits) {
        if (h.who !== i) continue;
        const bp = au.beatPeriod(h.t);
        if (h.smash) { const air = this.airOf(h); ks.push([h.t - air / 2, `${w.p}_bad_smash`], [h.t + air / 2, `${w.p}_bad_ready`]); }
        else ks.push([h.t + IMPACT, `${w.p}_bad_swing`], [h.t + Math.min(0.42, bp * 0.8), `${w.p}_bad_ready`]);
      }
      this.keys[i] = ks;
    });
    // 留言：標準 v2 的字級
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, h = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, h) : noteV2(c, INVITE, null, w, h * 0.5, { max: 44 });
    // 板子的寬高都跟著留言（短的留言不要掛一大塊空板子），靠右吊著
    this.board.h = Math.min(BOARD.h, Math.max(250, PAD.top + this.note.height + PAD.bottom + 18));
    this.board.w = Math.min(BOARD.w, tightenNote(c, this.note, 320) + PAD.x * 2);
    this.board.x = BOARD.x + BOARD.w - this.board.w;
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = this.hits[0]?.t ?? this.ctx.start + 0.6;
    this.drawBackground();
  }

  /** 跳殺在空中的時間：最高點落在擊球的拍點上。 */
  private airOf(h: Hit) { return Math.min(0.6, this.ctx.audio.beatPeriod(h.t) * 1.2); }

  /** 不會動的：球場地板、場線、網子、記分板（畫一次）。 */
  private drawBackground() {
    const c = this.bg.ctx, ink = inkFor(false);
    this.bg.clear();
    // 地板：比底色亮一點點的一條，往遠處淡掉
    const g = c.createLinearGradient(0, FLOOR - 40, 0, H);
    g.addColorStop(0, rgba('ink2', 0));
    g.addColorStop(0.2, rgba('ink2', 1));
    g.addColorStop(1, rgba('ink2', 0.6));
    c.fillStyle = g;
    c.fillRect(0, FLOOR - 40, W, H - FLOOR + 40);
    inkLine(c, [{ x: 90, y: FLOOR }, { x: 1830, y: FLOOR }], { ink, w: 0.8, t: 0, seed: 3 });
    // 場線（透視的地板線，很淡）
    c.strokeStyle = rgba('bone', 0.08);
    c.lineWidth = 1.5;
    for (const x of [150, 520, NET, 820, 1220]) { c.beginPath(); c.moveTo(x, FLOOR + 4); c.lineTo(x + (x - NET) * 0.35, FLOOR + 70); c.stroke(); }
    c.beginPath(); c.moveTo(60, FLOOR + 36); c.lineTo(1860, FLOOR + 36); c.stroke();
    // 網子：側面看幾乎是「側著」的，所以畫成稍微斜一點的平行四邊形（近的柱子低一點、遠的高一點），網面細格、上緣白帶
    const nh = SZ * 0.86, band = SZ * 0.2;
    const n0 = { x: NET - 20, y: FLOOR + 24 }, n1 = { x: NET + 22, y: FLOOR - 14 };
    const top0 = { x: n0.x, y: n0.y - nh }, top1 = { x: n1.x, y: n1.y - nh };
    c.save();
    c.strokeStyle = rgba('bone', 0.16);
    c.lineWidth = 1;
    c.beginPath();
    for (let k = 1; k < 7; k++) { const x = n0.x + ((n1.x - n0.x) * k) / 7, y = top0.y + ((top1.y - top0.y) * k) / 7; c.moveTo(x, y); c.lineTo(x, y + band); }
    for (let y = 0; y <= band; y += 8) { c.moveTo(top0.x, top0.y + y); c.lineTo(top1.x, top1.y + y); }
    c.stroke();
    c.restore();
    inkLine(c, [n1, top1], { ink, w: 0.8, t: 0, seed: 4 });
    inkLine(c, [n0, top0], { ink, w: 1.1, t: 0, seed: 5 });
    inkLine(c, [top0, top1], { ink, w: 1.8, t: 0, seed: 7 });
    inkLine(c, [{ x: top0.x, y: top0.y + band }, { x: top1.x, y: top1.y + band }], { ink, w: 0.6, t: 0, seed: 9 });
    // 記分板：兩條吊鍊、下緣看得到板子的厚度、板面上亮下暗（體育館頂上的燈打下來）
    const B = this.board;
    for (const x of [B.x + 70, B.x + B.w - 70]) {
      c.strokeStyle = rgba('bone', 0.3); c.lineWidth = 2; c.setLineDash([7, 5]);
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, B.y - 6); c.stroke();
      c.setLineDash([]);
    }
    c.fillStyle = rgba('ink');
    c.beginPath(); c.moveTo(B.x + 4, B.y + B.h); c.lineTo(B.x + B.w - 4, B.y + B.h); c.lineTo(B.x + B.w - 16, B.y + B.h + 14); c.lineTo(B.x + 16, B.y + B.h + 14); c.closePath(); c.fill();
    inkLine(c, [{ x: B.x + 4, y: B.y + B.h }, { x: B.x + 16, y: B.y + B.h + 14 }, { x: B.x + B.w - 16, y: B.y + B.h + 14 }, { x: B.x + B.w - 4, y: B.y + B.h }], { ink, w: 0.7, t: 0, seed: 23, taper: 0.1 });
    const face = c.createLinearGradient(0, B.y, 0, B.y + B.h);
    face.addColorStop(0, mix('ink2', 0.07));
    face.addColorStop(0.35, rgba('ink2'));
    face.addColorStop(1, rgba('ink'));
    c.fillStyle = face;
    c.fillRect(B.x, B.y, B.w, B.h);
    inkLine(c, [{ x: B.x, y: B.y }, { x: B.x + B.w, y: B.y }, { x: B.x + B.w, y: B.y + B.h }, { x: B.x, y: B.y + B.h }, { x: B.x, y: B.y }], { ink, w: 1, t: 0, seed: 21, taper: 0.05 });
    c.strokeStyle = rgba('bone', 0.1); c.lineWidth = 1;
    c.strokeRect(B.x + 12, B.y + 12, B.w - 24, B.h - 24);
    // 板子上唯一的小字：報分
    c.font = font(F.mono(500), 17);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('ash', 0.55);
    c.fillText('LOVE · ALL', B.x + PAD.x, B.y + 46);
    c.letterSpacing = '0px';
    this.bg.upload();
  }

  /** 這一格：最近一次擊球是第幾球。 */
  private lastHit(t: number) {
    let i = -1;
    for (let k = 0; k < this.hits.length; k++) if (this.hits[k]!.t <= t) i = k;
    return i;
  }

  /** 這一球在哪裡擊球：一般球是預備姿勢的拍面、跳殺是最高點的拍面。 */
  private hitPt(h: Hit) { return h.smash ? this.smashAt[h.who] : this.contact[h.who]; }

  /** 第 k 球的路：從這一球的擊球點飛到下一球的擊球點（下一球是跳殺就飛到對方跳起來的拍面）；跳殺壓低直直往下。 */
  private arcOf(k: number, u: number) {
    const h = this.hits[k]!, n = this.hits[k + 1];
    const from = this.hitPt(h), to = n ? this.hitPt(n) : this.contact[h.who ? 0 : 1];
    return arcAt(from, to, h.smash ? 40 : Math.max(40, Math.min(from.y, to.y) - APEX), u);
  }

  /** 一個人這一格的紙偶：姿勢時間軸＋跳殺的拋物線＋擊球前往後帶、擊球後往前送＋對手擊球時的小跳＋呼吸與拍子。 */
  private drawPlayer(c: CanvasRenderingContext2D, i: 0 | 1, t: number) {
    const au = this.ctx.audio, w = WHO[i];
    const bp = au.beatPeriod(t);
    let lift = 0, squash = breathe(t, 0.008, 3.1, i * 0.4) + 0.012 * beatKick(au, t, 0.3), rot = 0;
    for (const h of this.hits) {
      const d = t - h.t;
      if (d < -bp * 1.5 || d > bp * 1.5) continue;
      if (h.who === i) {
        if (h.smash) {
          const air = this.airOf(h);
          const j = jumpArc(t, h.t - air / 2, h.t + air / 2, JUMP, { crouch: 0.1, land: 0.14 });
          lift = -j.y; squash = j.squash;
          rot += w.dir * (j.air ? 0.1 * Math.sin(Math.PI * j.u) : 0);
        } else {
          // 預備：拍點前 0.35 拍身體往後帶，擊球後停幾格（拍面在球上），再往前送、慢慢收回
          const e = d - IMPACT;
          rot += -w.dir * WIND * prog(t, h.t - bp * 0.35, h.t, ease.inOutCubic) * (e < 0 ? 1 : 0);
          if (e >= 0) rot += w.dir * 0.06 * Math.exp(-e / (bp * 0.35));
          if (e >= 0 && e < 0.2) squash += 0.05 * (1 - e / 0.2);
        }
      } else {
        // 對方擊球的那一刻：原地小跳（split step）
        const u = (t - h.t + 0.05) / 0.26;
        if (u > 0 && u < 1) lift = Math.max(lift, 12 * Math.sin(Math.PI * u));
      }
    }
    const s = this.ctx.start;
    const ent = puppetIn(t, s + 0.05 + i * 0.12, 0.45);
    if (ent.alpha <= 0) return;
    const o: PuppetOpts = { h: SZ, flip: w.flip, rot, pivot: 0.45, squash, spin: ent.spin, alpha: ent.alpha };
    puppetShadow(c, w.p, w.x, FLOOR, { h: SZ, lift, alpha: 0.85 * ent.alpha, wide: 1.25, color: '0,0,0' });
    drawPick(c, this.keys[i]!, t, w.x, FLOOR - lift, o);
    // 進場：仙女棒的火花在腳邊
    if (ent.k < 1) {
      const px = w.x, py = FLOOR - 6;
      sparkHead(this.glow, px, py, t, 0.8);
      sparkParticles(this.glow, t, () => ({ x: px, y: py }), { rate: 60, life: 0.3, speed: 160, seed: i + 1 });
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    this.hall.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const ink = inkFor(false);
    const rv = prog(t, s, s + 0.55, ease.inOutCubic);

    // 兩個人（這一層最先畫：打光只染紙偶）。體育館的燈在上面：頭頂亮、往腳底暗，白衣服才不會比記分板上的字還搶眼
    this.drawPlayer(c, 0, t);
    this.drawPlayer(c, 1, t);
    puppetLight(c, [0, FLOOR - SZ * 1.5, NET + 560, SZ * 1.5 + 40], rgba('ink', 0.12), rgba('ink', 0.5));

    this.dust(c, t);
    // 歌詞：沿著高遠球的弧線，比留言小一級
    const ly = lyricAt(lyrics, t);
    // 韓文歌：原文副行排在弧線更裡面一圈；弧頂很尖，越裡面的字擠得越厲害，整塊往外推一點（上緣仍離畫面頂 ≥ 96）
    if (ly) lyricOnPath(c, ly.line, t, this.arc, { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, offset: lyricSubOf(ly.line) ? 40 : 18, alpha: ly.k * rv, unsung: rgba('bone', 0.26) });

    // 羽球與軌跡
    const i = this.lastHit(t);
    if (i >= 0) {
      const h = this.hits[i]!, n = this.hits[i + 1];
      const t1 = n ? n.t : h.t + bp;
      const tau = clamp((t - h.t) / Math.max(0.05, t1 - h.t));
      const u = tau * (1.35 - 0.35 * tau); // 羽球：出去很快、到對面變慢
      // 這一球飛過的路：越靠近球越亮（加亮 → 發光）
      let prev: Pt | null = null;
      const sg = LIN.signal;
      for (let k = 0; k <= 28; k++) {
        const q = this.arcOf(i, (k / 28) * u);
        if (prev) { const w = k / 28; this.glow.seg2(prev.x, prev.y, q.x, q.y, 1.2 + 1.6 * w, [sg[0] * 2.2, sg[1] * 2.2, sg[2] * 2.2], 0.15 + 0.7 * w * w); }
        prev = q;
      }
      // 上一球的弧線慢慢淡掉
      if (i > 0) {
        const fade = 1 - prog(t, h.t, h.t + bp * 1.2);
        if (fade > 0) { const pts: Pt[] = []; for (let k = 0; k <= 24; k++) pts.push(this.arcOf(i - 1, k / 24)); this.glow.polyline(pts, 1, [sg[0] * 1.2, sg[1] * 1.2, sg[2] * 1.2], 0.3 * fade); }
      }
      const q = this.arcOf(i, u);
      shuttle(c, q.x, q.y, q.ang, { ink, t, h: SZ });
      // 擊球的瞬間：拍面炸一圈短線
      const k = 1 - clamp((t - h.t) / 0.16);
      if (k > 0) {
        const cp = this.hitPt(h), e = LIN.ember;
        for (let r = 0; r < 7; r++) {
          const ang = (r / 7) * Math.PI * 2 + 0.3, r0 = 16 + (1 - k) * 30, r1 = r0 + 14 * k;
          this.glow.seg2(cp.x + Math.cos(ang) * r0, cp.y + Math.sin(ang) * r0, cp.x + Math.cos(ang) * r1, cp.y + Math.sin(ang) * r1, 2, [e[0] * 3, e[1] * 3, e[2] * 3], k);
        }
      }
    } else if (t > s + 0.45 && this.hits.length) {
      // 發球前：球停在宣文的拍面上方
      const cp = this.contact[0];
      shuttle(c, cp.x + 4, cp.y - 26, -Math.PI / 2, { ink, t, h: SZ });
    }

    this.drawMessage(c, t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢推近、往記分板那邊飄；大鼓時輕輕一頓（最多推 1.035 倍，字離邊界的距離已經算進去）
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.7, vignette: 0.5, zoom: 1 + 0.03 * push + 0.004 * f.a.kick, shake: [-26 * push, 4 * push] };
  }

  /** 燈光裡的灰塵：幾十顆很淡的小點慢慢飄（確定性：位置只看 t 與編號）。 */
  private dust(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.fillStyle = rgba('bone', 1);
    for (let k = 0; k < 26; k++) {
      const x = 260 + hash(k, 1) * 880 + Math.sin(t * 0.3 + k) * 30;
      const y = 140 + ((hash(k, 2) * 640 - t * (6 + 10 * hash(k, 3))) % 640 + 640) % 640;
      const a = 0.05 + 0.1 * hash(k, 4) * (0.6 + 0.4 * Math.sin(t * 1.3 + k * 2));
      c.globalAlpha = a;
      c.beginPath(); c.arc(x, y, 1 + 1.4 * hash(k, 5), 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  /** 記分板上的主打留言：第一球起一個字一個字翻出來，寫完署名淡入；在板面上垂直置中。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.board;
    const x = B.x + PAD.x, top = B.y + PAD.top, h = B.h - PAD.top - PAD.bottom;
    const y = top + Math.max(0, (h - n.height) * 0.42);
    const total = msgChars(n.fit);
    const per = clamp(1.4 / Math.max(1, total), 0.025, 0.09);
    const chars = this.msg ? Math.max(0, (t - this.msgT0) / per) : Infinity;
    const done = this.msgT0 + total * per;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    drawNote(c, n, x, y, { chars, color: this.msg ? rgba('bone', 0.97) : rgba('ash', 0.85), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5) });
    c.restore();
  }
}

/** 底色往紙白混一點（板面頂上被燈照到）。 */
const mix = (k: string, a: number) => {
  const p = rgba(k).match(/\d+/g)!.map(Number), q = rgba('bone').match(/\d+/g)!.map(Number);
  return `rgba(${[0, 1, 2].map((i) => Math.round(p[i]! + (q[i]! - p[i]!) * a)).join(',')},1)`;
};
