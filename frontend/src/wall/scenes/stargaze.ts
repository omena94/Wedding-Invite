// 看星星（暗、date、慢歌、日常服一）：夜裡的山坡，宣文與孟庭並肩躺在草地上（頭在坡上、腳在坡下），芃芃和 QQ 在兩人腳邊睡成兩團，
// 元元（白色柴犬，比博美大）坐在坡的左邊守著大家：每一段星星亮起的拍點歪一下頭，留言寫完的那一拍仰頭對著星星長嚎，之後流星劃過時也歪頭看。
// 角色是 Codex 畫的紙偶（cp_stargaze_1～3、pp_sleep、qq_sleep、yy_sit／tilt／howl，_puppet.ts），夜空、銀河、山坡、草、螢火蟲是程式畫的。
//  - **主打留言寫在天上**（右上方）：他們指到的星星一顆一顆亮起、連成留言的字——每一拍一小段：從指尖射出一道細細的光到那幾個字的星，
//    拍點上星星一閃、那幾個字浮現（宋體、紙白），星與星之間連上很淡的星座線。前半段宣文指（cp_stargaze_1）、後半段孟庭指（_2），
//    全部亮完的下一拍兩人牽手、轉頭看對方（_3）。一小段幾個字，照字數分成最多六拍，一個半小節內寫完。寫完署名淡入。
//  - 沒有留言：他們指出一個愛心形狀的星座，底下一行小小的邀請；歌詞變主角。
//  - 歌詞沿著遠山的稜線逐字亮（比留言小一級，標準 v2）。
//  - 動畫：星星在 hi-hat 上閃、銀河很慢地轉、寫完之後每兩小節一顆流星、草在風裡晃、山腳的螢火蟲一明一滅、狗狗睡著的肚子照拍子起伏。
//  - 鏡頭：整個窗格很慢地推近天上的字。慢歌專用（能量低）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { lyricAt, beatAfter, barAfter, sparkHead, sparkParticles, heartPoints, msgChars } from './_motifs';
import { lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, puppetPoint, puppetBox, puppetShadow, puppetIn, puppetLight, breathe, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'date', paper: false, energy: [0, 0.55], bars: [4, 8] };

/** 兩人躺的位置（腳底錨點）與場景尺度。 */
const CX = 640, GROUND = 925, SZ = 420;
/** 芃芃與 QQ 睡在前景（離鏡頭近一點、大一點）的草地上，在兩人腳邊；三隻狗同一個尺度（DOG_S）。 */
const PP = { x: 420, y: 1022 }, QQ = { x: 592, y: 1040 };
const DOG_S = 1.3;
/** 元元坐在坡的左邊（離兩人的腳遠一點，不擠成一團）。 */
const YY_X = 140;
/** 天上寫留言的範圍（右上；標準 v2：≤ 860 × 430）。 */
const SKYMSG = { x: 980, y: 120, w: 800, h: 380 };
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['cp_stargaze_1', 'cp_stargaze_2', 'cp_stargaze_3', 'pp_sleep', 'qq_sleep', 'yy_sit', 'yy_tilt', 'yy_howl'];

/**
 * 夜空：上深下淡、地平線一點點暖；斜斜的一條銀河（fbm 的雲氣）；滿天的小星星（格子裡隨機一顆），在 hi-hat 上閃。
 * 星空整片很慢地轉（spin，弧度），像躺著看久了天在走。
 */
const SKY = () => new FSPass(/* glsl */ `
  uniform float t; uniform float spin; uniform float tw;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float y = p.y / ${H}.0;
    vec3 col = mix(C_INK, mix(C_INK2, C_BLOOD, 0.14), smoothstep(0.1, 0.95, y));
    // 天空繞畫面左下外的一點很慢地轉
    vec2 o = vec2(-400.0, 1500.0);
    float cs = cos(spin), sn = sin(spin);
    vec2 q = o + mat2(cs, -sn, sn, cs) * (p - o);
    // 銀河：從左下往右上的一條帶子
    float d = dot(q - vec2(900.0, 560.0), normalize(vec2(0.55, 0.83)));
    float band = exp(-d * d / (2.0 * 150.0 * 150.0));
    float n = fbm(q * 0.0035, 4) * 0.5 + 0.5;
    col += mix(C_BONE, C_SIGNAL, 0.25) * 0.05 * band * smoothstep(0.25, 0.9, n) * (1.0 - smoothstep(0.7, 0.95, y));
    // 星星：每 9 px 一格，格子裡隨機一個位置、隨機亮度；只有兩成的格子有星
    vec2 g = floor(q / 9.0);
    float h = hash12(g);
    if (h > 0.8) {
      vec2 sp = (g + 0.2 + 0.6 * hash22(g + 7.0)) * 9.0;
      float r = 0.55 + 0.9 * pow(hash12(g + 3.1), 3.0);
      float lum = pow((h - 0.8) / 0.2, 2.0) * (0.55 + 0.45 * sin(t * (1.0 + 3.0 * hash12(g + 9.0)) + h * 40.0));
      lum *= 1.0 + tw * step(0.93, hash12(g + 5.0)) * 1.6;
      float s = exp(-dot(q - sp, q - sp) / (r * r)) * lum;
      col += mix(C_BONE, C_EMBER, 0.2) * s * 0.9 * (1.0 - smoothstep(0.66, 0.8, y));
    }
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 }, spin: { value: 0 }, tw: { value: 0 } });

interface Star { x: number; y: number; t: number; first: number; group: number }

export default class Stargaze extends Scene {
  sky = shared('stargaze.sky', SKY);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  /** 留言的左上角（在天上的範圍裡靠右上）。 */
  noteAt: Pt = { x: SKYMSG.x, y: SKYMSG.y };
  /** 每一段（一拍）亮起的時間、那一段第一個字的位置（光射過去的地方）。 */
  stars: Star[] = [];
  groups: { t: number; who: 0 | 1; target: Pt }[] = [];
  /** 每個字出現的時間（逐字，照段落）。 */
  charT: number[] = [];
  done = Infinity;
  lyricSize = 52;
  ridge: Pt[] = [];
  lyricPath: Pt[] = [];

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    const c = this.fg.ctx;
    // 天上的留言：宋體、標準 v2 的字級；排好之後貼在範圍的右上
    const fam = F.ming(500);
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, SKYMSG.w, SKYMSG.h, { family: fam, lineHeight: 1.4 }) : noteV2(c, INVITE, null, SKYMSG.w * 0.7, 120, { max: 40, family: fam });
    const n = this.note;
    // 署名靠右對齊到實際的字寬（不然會對齊到範圍的右緣、跑出畫面邊界）
    if (this.msg) tightenNote(c, n, 200);
    this.noteAt = this.msg ? { x: SKYMSG.x + (SKYMSG.w - n.width) * 0.6, y: SKYMSG.y + (SKYMSG.h - n.height) * 0.35 } : { x: SKYMSG.x + 120, y: SKYMSG.y + 300 };
    this.lyricSize = lyricV2(this.msg ? n.fit.size : null);

    // 每個字的星：字的正上方偏左一點（像星座圖上標在星旁邊的字）
    const pts: Pt[] = [];
    if (this.msg) {
      c.save();
      c.font = font(n.family, n.fit.size);
      n.fit.lines.forEach((ln, i) => {
        const chars = Array.from(ln);
        let pre = '';
        const base = this.noteAt.y + n.fit.size * 0.9 + i * n.fit.lineHeight;
        for (const ch of chars) {
          const x0 = this.noteAt.x + c.measureText(pre).width, w = c.measureText(ch).width;
          pts.push({ x: x0 + w * 0.5 + (hash(pts.length, 3) - 0.5) * w * 0.7, y: base - n.fit.size * (0.95 + 0.4 * hash(pts.length, 4)) });
          pre += ch;
        }
      });
      c.restore();
    } else {
      // 沒有留言：一個愛心形狀的星座（12 顆星）
      const hp = heartPoints(12).slice(0, 12);
      for (const p of hp) pts.push({ x: 1380 + p.x * 170, y: 210 + p.y * 170 });
    }
    // 分段：每一拍一段（最多六拍），前半段宣文指、後半段孟庭指
    const total = pts.length;
    const nGroups = Math.max(1, Math.min(6, Math.ceil(total / 3)));
    const per = Math.ceil(total / nGroups);
    const b0 = beatAfter(au, s + 0.45);
    const b0i = Math.round(au.beatAt(b0));
    for (let g = 0; g < nGroups; g++) {
      const t = au.timeOfBeat(b0i + g);
      const first = g * per;
      this.groups.push({ t, who: g < nGroups / 2 ? 0 : 1, target: pts[Math.min(first, total - 1)]! });
      for (let i = first; i < Math.min(total, first + per); i++) {
        this.stars.push({ ...pts[i]!, t: t + (i - first) * 0.06, first, group: g });
        this.charT.push(t + (i - first) * 0.06);
      }
    }
    this.done = this.groups.length ? au.timeOfBeat(b0i + nGroups) : s;

    // 山坡與遠山：躺的地方從腳（左下）往頭（右上）斜上去，過了頭再往右緩緩下去接到遠山
    this.drawBackground();
    // 歌詞：沿著遠山的稜線（右半邊），字在稜線上面一點
    // 用稜線的大起伏就好（小的起伏會讓字距忽大忽小），整條抬高一點，字不會碰到山
    for (let i = 0; i <= 50; i++) {
      const x = lerp(1030, 1810, i / 50);
      this.lyricPath.push({ x, y: 772 - 46 * Math.sin(x * 0.0042 + 0.9) - 34 });
    }
  }

  /** 遠山稜線的高度。 */
  private ridgeY(x: number) {
    return 772 - 46 * Math.sin(x * 0.0042 + 0.9) - 18 * Math.sin(x * 0.011 + 2.1) - 8 * Math.sin(x * 0.031);
  }

  /** 近的山坡：腳底在 (CX - 400, GROUND) 附近，往右上斜到頭那邊的坡頂，再往右下。 */
  private hillY(x: number) {
    // 身體貼地的那一面（原圖量的）：腳在錨點左邊約 400 px、斜率約 0.2；坡頂在頭後面一點
    const crest = CX + 320;
    const y0 = GROUND + 14 - (x - (CX - 420)) * 0.205;
    if (x < crest) return y0 + 10 * Math.sin(x * 0.02);
    const yc = GROUND + 14 - (crest - (CX - 420)) * 0.205;
    return yc + Math.pow((x - crest) / 900, 1.6) * 250;
  }

  /** 不會動的：遠山（很淡的稜線光）、近的山坡（深色）、坡頂一排草的剪影。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 遠山：比近的山坡亮一點、帶一點霧（兩層分得開，人才不像浮在一團黑上）
    c.fillStyle = mixRgba('ink2', 'ash', 0.1);
    c.beginPath(); c.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) c.lineTo(x, this.ridgeY(x));
    c.lineTo(W, H); c.closePath(); c.fill();
    c.strokeStyle = rgba('signal', 0.08);
    c.lineWidth = 1.2;
    c.beginPath();
    for (let x = 0; x <= W; x += 16) (x ? c.lineTo(x, this.ridgeY(x)) : c.moveTo(x, this.ridgeY(x)));
    c.stroke();
    // 近的山坡
    c.fillStyle = rgba('ink');
    c.beginPath(); c.moveTo(0, H);
    for (let x = 0; x <= W; x += 12) c.lineTo(x, this.hillY(x));
    c.lineTo(W, H); c.closePath(); c.fill();
    c.strokeStyle = mixRgba('ink', 'bone', 0.2);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let x = 0; x <= W; x += 12) (x ? c.lineTo(x, this.hillY(x)) : c.moveTo(x, this.hillY(x)));
    c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.glow.clear();
    this.sky.u.t!.value = t;
    this.sky.u.spin!.value = (t - s) * 0.0025;
    this.sky.u.tw!.value = f.a.hat;
    this.sky.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;

    // ---- 兩個人與兩隻狗（最先畫：打光只染紙偶）
    const pose = this.poseAt(t);
    const en = puppetIn(t, s + 0.05, 0.5);
    const o = { h: SZ, spin: en.spin, alpha: en.alpha, squash: breathe(t, 0.004, 3.8) };
    if (en.alpha > 0) {
      puppetShadow(c, 'cp', CX - 40, GROUND - 60, { h: SZ, wide: 1.6, alpha: 0.5, color: '0,0,0' });
      drawPuppet(c, pose, CX, GROUND, o);
    }
    for (const [d, P, ph] of [['pp', PP, 0], ['qq', QQ, 0.5]] as const) {
      const e2 = puppetIn(t, s + 0.2 + ph * 0.2, 0.4);
      if (e2.alpha <= 0) continue;
      // 睡著：肚子照拍子很慢地起伏（兩拍一次）
      const sq = 0.03 * Math.sin((au.beatAt(t) * 0.5 + ph) * Math.PI * 2) + 0.02 * beatKick(au, t, 0.4);
      puppetShadow(c, d, P.x, P.y, { h: SZ * DOG_S, alpha: 0.5, color: '0,0,0' });
      drawPuppet(c, `${d}_sleep`, P.x, P.y, { h: SZ, scale: DOG_S, flip: d === 'qq', spin: e2.spin, alpha: e2.alpha, squash: sq });
    }
    this.drawYuan(c, t);
    // 月光從右上來：上面淡、下面（草裡）暗
    puppetLight(c, [0, GROUND - SZ * 1.3, CX + 600, H - (GROUND - SZ * 1.3)], rgba('ink', 0.18), rgba('ink', 0.6));

    // ---- 天上的留言與星星、指尖射出的光
    this.drawSkyWriting(c, t, pose);
    // ---- 歌詞沿著遠山稜線
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const r = lyricOnPath(c, ly.line, t, this.lyricPath, { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: 0, alpha: ly.k * prog(t, s, s + 0.6), unsung: rgba('bone', 0.24) });
      if (r.head) sparkHead(this.glow, r.head.x, r.head.y - 4, t, 0.45, 0.7);
    }
    // ---- 前景：草在風裡晃、螢火蟲
    this.drawGrass(c, t);
    this.drawFireflies(t);
    this.drawMeteors(t);
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：很慢地推近天上的字
    const push = ease.inOutCubic(f.p);
    const fx = SKYMSG.x + SKYMSG.w / 2, fy = SKYMSG.y + SKYMSG.h / 2;
    return { bloom: 0.8, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(fx - W / 2) * 0.03 * push, -(fy - H / 2) * 0.03 * push] };
  }

  /**
   * 元元：正面坐著守在坡上；每一段星星亮起的拍點歪一下頭（半拍），留言全部亮完的那一拍仰頭長嚎一小節（第 1、3 拍嘴邊冒聲波），
   * 之後流星劃過時也歪頭。呼吸很慢、拍點上輕輕點一下。
   */
  private drawYuan(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    const en = puppetIn(t, s + 0.3, 0.4);
    if (en.alpha <= 0) return;
    const g = this.hillY(YY_X) + 4;
    let pose = 'yy_sit';
    for (const gr of this.groups) if (t >= gr.t && t < gr.t + bp * 0.5) pose = 'yy_tilt';
    const howl = this.groups.length > 0 && t >= this.done && t < this.done + bp * 4;
    if (howl) pose = 'yy_howl';
    // 流星（每兩小節一顆，寫完之後）：劃過的那半拍歪頭
    if (!howl && t >= this.done) {
      const b = Math.floor(au.barAt(t));
      if (b % 2 === 0 && t - au.timeOfBar(b) < bp * 0.6 && au.timeOfBar(b) >= this.done) pose = 'yy_tilt';
    }
    const o = {
      h: SZ, scale: DOG_S, spin: en.spin, alpha: en.alpha, pivot: 0.2,
      rot: howl ? -0.04 * Math.sin(Math.PI * prog(t, this.done, this.done + bp * 2)) : 0,
      squash: breathe(t, 0.01, 3.4, 0.6) + 0.015 * beatKick(au, t, 0.35),
    };
    puppetShadow(c, 'yy', YY_X, g, { h: SZ * DOG_S, alpha: 0.5 * en.alpha, color: '0,0,0' });
    drawPuppet(c, pose, YY_X, g, o);
    if (howl) {
      // 聲波：嘴邊往右上（星星那邊）冒三道短弧
      const b = puppetBox('yy_howl', YY_X, g, o);
      const mx = b[0] + b[2] * 0.86, my = b[1] + b[3] * 0.1;
      for (const k of [0, 2]) {
        const tb = au.timeOfBeat(Math.round(au.beatAt(this.done)) + k);
        const u = (t - tb) / (bp * 0.9);
        if (u < 0 || u > 1) continue;
        c.save();
        c.strokeStyle = rgba('bone', 0.5 * (1 - u));
        c.lineWidth = 2.5;
        c.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const r = 16 + i * 14 + u * 30;
          c.beginPath(); c.arc(mx, my, r, -Math.PI * 0.45, -Math.PI * 0.05); c.stroke();
        }
        c.restore();
      }
    }
  }

  /** 這一格的姿勢：前半段宣文指、後半段孟庭指，全部亮完的下一拍牽手對看。 */
  private poseAt(t: number) {
    if (t >= this.done) return 'cp_stargaze_3';
    let who = 0;
    for (const g of this.groups) if (t >= g.t - this.ctx.audio.beatPeriod(t) * 0.6) who = g.who;
    return who ? 'cp_stargaze_2' : 'cp_stargaze_1';
  }

  /**
   * 天上的字：每一段在拍點前 0.35 拍從指尖射出一道光（火花在光的前端），拍點上碰到那一段第一顆星——星一閃、那幾個字浮現；
   * 已經亮的星連成星座線（很淡）。字是紙白的宋體，星是一點一點的亮光（會發光）。
   */
  private drawSkyWriting(c: CanvasRenderingContext2D, t: number, pose: string) {
    const au = this.ctx.audio;
    const bp = au.beatPeriod(t);
    const n = this.note;
    if (!n) return;
    const sg = LIN.signal, em = LIN.ember, bo = LIN.bone;
    // 光：從指尖到這一段的第一顆星
    const finger = pose === 'cp_stargaze_3' ? null : puppetPoint(pose, 'finger', CX, GROUND, { h: SZ });
    for (const g of this.groups) {
      const u = (t - (g.t - bp * 0.35)) / (bp * 0.35);
      if (!finger || u < 0 || u > 1.6) continue;
      const k = clamp(u);
      const hx = lerp(finger.x, g.target.x, ease.outCubic(k)), hy = lerp(finger.y, g.target.y, ease.outCubic(k));
      const fade = u > 1 ? 1 - (u - 1) / 0.6 : 1;
      this.glow.seg2(finger.x, finger.y, hx, hy, 1.4, [sg[0] * 1.6, sg[1] * 1.6, sg[2] * 1.6], 0.5 * fade);
      if (u < 1) sparkHead(this.glow, hx, hy, t, 0.5, 0.9);
    }
    // 星座線：已經亮的星依序連起來（同一行裡的字才連，換行不連）
    const lit = this.stars.filter((st) => t >= st.t);
    for (let i = 1; i < lit.length; i++) {
      const a = lit[i - 1]!, b = lit[i]!;
      if (Math.abs(a.y - b.y) > 40 && this.msg) continue;
      const k = clamp((t - b.t) / 0.3);
      this.glow.seg2(a.x, a.y, lerp(a.x, b.x, k), lerp(a.y, b.y, k), 1, [bo[0] * 0.5, bo[1] * 0.5, bo[2] * 0.5], 0.35);
    }
    if (!this.msg && lit.length === this.stars.length && lit.length) {
      const a = lit[lit.length - 1]!, b = lit[0]!;
      this.glow.seg2(a.x, a.y, b.x, b.y, 1, [bo[0] * 0.5, bo[1] * 0.5, bo[2] * 0.5], 0.35 * clamp((t - a.t) / 0.3));
    }
    // 星：亮起的那一下一閃，之後跟著 hi-hat 輕輕閃
    for (let i = 0; i < this.stars.length; i++) {
      const st = this.stars[i]!;
      if (t < st.t) continue;
      const flash = Math.exp(-(t - st.t) / 0.25);
      const tw = 0.75 + 0.25 * Math.sin(t * (2 + hash(i, 1) * 3) + i);
      const r = 5 + 10 * flash;
      this.glow.seg2(st.x, st.y, st.x + 0.01, st.y, r, [em[0] * (1.4 + 3 * flash) * tw, em[1] * (1.3 + 3 * flash) * tw, em[2] * (1.1 + 3 * flash) * tw], 0.9);
      if (flash > 0.2) {
        for (let k = 0; k < 4; k++) {
          const ang = (k / 4) * Math.PI * 2 + 0.3, len = 18 * flash;
          this.glow.seg2(st.x, st.y, st.x + Math.cos(ang) * len, st.y + Math.sin(ang) * len, 1.2, [sg[0] * 2, sg[1] * 2, sg[2] * 2], flash);
        }
      }
    }
    // 字：跟著自己那顆星浮現（紙白），寫完署名淡入
    const shown = this.charT.filter((ct) => t >= ct).length;
    const ink = this.msg ? rgba('bone', 0.94) : rgba('bone', 0.5);
    if (this.msg) {
      c.save();
      c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.6);
      drawNote(c, n, this.noteAt.x, this.noteAt.y, { chars: shown, color: ink, sigColor: rgba('ash', 0.9), sigK: prog(t, this.done, this.done + 0.5) });
      c.restore();
    } else {
      c.save();
      c.globalAlpha = prog(t, this.done, this.done + 0.6);
      drawNote(c, n, this.noteAt.x, this.noteAt.y, { color: ink });
      c.restore();
    }
    void msgChars;
  }

  /**
   * 前景的草：沿著山坡一叢一叢（每叢三到六根葉子，長短、歪的方向都不同），在風裡晃（每小節一陣風從左吹到右）。
   * 兩人躺的那一段比較密，蓋住身體碰到草地的地方。
   */
  private drawGrass(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const bar = au.barAt(t);
    c.save();
    c.strokeStyle = rgba('ink');
    c.lineCap = 'round';
    let x = -20, i = 0;
    while (x < W + 20) {
      const dense = x > CX - 470 && x < CX + 330;
      x += (dense ? 10 : 26) + (dense ? 14 : 40) * hash(i, 41);
      i++;
      const base = this.hillY(x) + 8;
      if (x > 1330 && base > 800) continue;
      // 風：從左往右推過去的一道波，加上一點點常駐的晃動
      const gust = Math.exp(-Math.pow(((bar % 1) * (W + 600) - 300 - x) / 260, 2));
      const blades = 3 + Math.floor(hash(i, 42) * 4);
      for (let k = 0; k < blades; k++) {
        const hh = (dense ? 22 : 12) + (dense ? 30 : 22) * hash(i, k, 43);
        const tilt = (hash(i, k, 44) - 0.5) * 0.9 + 0.1 * Math.sin(t * 1.3 + x * 0.05) + 0.45 * gust;
        const bx = x + (k - blades / 2) * 3;
        c.lineWidth = 1.2 + 1.6 * hash(i, k, 45);
        c.beginPath();
        c.moveTo(bx, base);
        c.quadraticCurveTo(bx + tilt * hh * 0.35, base - hh * 0.6, bx + tilt * hh, base - hh);
        c.stroke();
      }
    }
    c.restore();
  }

  /** 螢火蟲：山坡上方十幾顆，一明一滅地慢慢飄（只看 t 與編號）。 */
  private drawFireflies(t: number) {
    const em = LIN.ember;
    for (let k = 0; k < 14; k++) {
      const x = 120 + 1150 * hash(k, 21) + 30 * Math.sin(t * 0.4 + k);
      const y = this.hillY(x) - 30 - 120 * hash(k, 22) + 14 * Math.sin(t * 0.7 + k * 2);
      const on = Math.max(0, Math.sin(t * (0.8 + 0.6 * hash(k, 23)) + k * 1.7));
      const a = on * on;
      if (a < 0.02) continue;
      this.glow.seg2(x, y, x + 0.01, y, 6, [em[0] * 2.2 * a, em[1] * 2.4 * a, em[2] * 1.2 * a], 0.8);
    }
  }

  /** 流星：留言寫完之後，每兩小節的小節線一顆，從左上往左下斜斜劃過（避開右上的字）。 */
  private drawMeteors(t: number) {
    const au = this.ctx.audio;
    if (t < this.done) return;
    const b = Math.floor(au.barAt(t));
    for (const k of [b, b - 1]) {
      if (k % 2) continue;
      const t0 = au.timeOfBar(k);
      if (t0 < this.done) continue;
      const u = (t - t0) / 0.7;
      if (u < 0 || u > 1) continue;
      const x0 = 200 + 400 * hash(k, 31), y0 = 90 + 120 * hash(k, 32);
      const hx = x0 + 420 * u, hy = y0 + 170 * u;
      const tail = 140 * Math.sin(Math.PI * u);
      const sg = LIN.bone;
      this.glow.seg2(hx - tail * 0.93, hy - tail * 0.38, hx, hy, 1.6, [sg[0] * 2.5, sg[1] * 2.5, sg[2] * 2.5], Math.sin(Math.PI * u));
    }
  }
}
