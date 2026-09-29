// 搖滾區（暗、live）：演唱會的搖滾區，宣文和孟庭穿一樣的黑色星星音符 T、戴發光手環，站在最前面跟著唱。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 live）；舞台、燈、其他觀眾、手燈、手機、布條是程式畫的（_c9.ts）。不畫任何真實歌手、團名。
//  - 舞台在右上：一面大螢幕、左邊一座燈架塔、台口的腳燈。**大螢幕放歌詞（逐字跟唱）**，後面是 T 恤同款的星星圖案跟著拍子跳；
//    螢幕是一顆顆 LED（細格線），亮度會照到霧裡。沒有歌詞時只剩星星圖案。
//  - 燈：燈架塔上四盞往左下打、舞台地板上三盞往左上打，每一拍甩到新的角度（拍點上最快、之後慢下來），光束打在霧裡；小節線上閃一下白光。
//  - 兩個人：宣文右手舉手燈（程式畫的，燈色跟著全場一起換）、孟庭左手舉手機在錄；兩人中間拉著一條應援布條，**主打留言寫在布條上**。
//    宣文每一拍換手（兩張姿勢輪流，手燈跟著甩），孟庭兩拍換一次；每一拍跟著點一下，小節線（段落能量高每小節、其他每兩小節）兩人一起跳，
//    跳的最高點剛好在小節線上，布條跟著被舉高、落地壓扁回彈。手環每一拍亮一下。
//  - 開場：燈還沒亮，兩人只是剪影；第一拍舞台燈亮起、光束掃過來，兩人被照亮；下一拍布條從上緣往下攤開，留言一個字一個字寫上去。
//  - 布條照「留言尺寸與版面比例標準 v2」：字 40～60、布條最大 700 × 330，寬高跟著留言（兩個人站的距離跟著布條的寬）。沒有留言時寫邀請。
//  - 其他觀眾是剪影（鏡頭在眼睛的高度：遠近的人頭都在同一條線上，遠的小），舉起來的手燈跟兩人的一起變色、手機亮白光；
//    每一拍一起點頭，跳的時候一起跳。
//  - 鏡頭：整個窗格慢慢推近兩個人，大鼓時輕輕一頓。右下角 HUD 只有暗暗的地板。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, barAfter, beatAfter, msgChars, type LyricStyle } from './_motifs';
import { drawNote, type Note } from './_couple';
import { loadPuppets, hasPuppet, drawCycle, puppetPoint, puppetShadow, puppetLight, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { glow, lightStick, phoneBack, makeCrowd, drawCrowd, cloth, star, toward, type Fan, type Pt } from './_c9';

export const spec: PlateSpecDecl = { group: 'couple', family: 'live', paper: false, energy: [0.45, 1], bars: [4, 8] };

const GROUND = 1062;
/** 場景尺度：宣文站直的身高（px）。 */
const SZ = 560;
/** 鏡頭的高度（人頭的高度）：遠近的觀眾頭都在這條線附近。 */
const EYE = 540;
/** 布條：中心 x、最大寬高（標準 v2）、寫字的內距。上緣的高度照兩個人抓布條的拳頭算。 */
const BANNER = { cx: 780, wMax: 700, hMax: 330, wMin: 430 };
const PAD = { x: 38, top: 34, bottom: 26 };
/** 舞台大螢幕（歌詞）、舞台台口的高度、左邊燈架塔的 x。 */
const SCREEN = { x: 1010, y: 70, w: 830, h: 292 };
const STAGE_Y = 392;
const TOWER = 952;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const LABEL = 'LIVE';
const XW = ['xw_live_rail_1', 'xw_live_rail_2'];
const MT = ['mt_live_rail_1', 'mt_live_rail_2'];
/** 全場的手燈每小節換一次顏色（中控手燈）。 */
const LITS = ['signal', 'ember'] as const;

/** 燈：燈架塔上四盞往左下打、舞台地板上三盞往左上打（原點、平常的角度、甩的幅度）。角度 0 = 正下方、正 = 往右。 */
const RIG = [
  { x: TOWER, y: 92, a: -1.2, amp: 0.3 },
  { x: TOWER, y: 178, a: -1.0, amp: 0.3 },
  { x: TOWER, y: 264, a: -0.8, amp: 0.28 },
  { x: TOWER + 40, y: 36, a: -0.6, amp: 0.3 },
  { x: 1050, y: STAGE_Y - 6, a: Math.PI + 0.75, amp: 0.25 },
  { x: 1190, y: STAGE_Y - 6, a: Math.PI + 0.9, amp: 0.22 },
  { x: 1340, y: STAGE_Y - 6, a: Math.PI + 1.0, amp: 0.2 },
] as const;

/**
 * 場館：很暗的底、霧、七道搖頭燈的光束、大螢幕照在霧上的光、小節線的白閃。用 shader 算（浮點＋一點點抖色）：
 * Canvas2D 的淡漸層只有幾個 8 位元的階，大螢幕上會看到一圈一圈的。右下角 HUD 的地方光束淡掉。
 */
const HALL = () => new FSPass(/* glsl */ `
  uniform float uT, uFlash, uScr, uOn;
  uniform vec4 uAngA, uIntA, uColA;
  uniform vec3 uAngB, uIntB, uColB;
  vec3 beamCol(float k) { return k < 0.5 ? C_SIGNAL : k < 1.5 ? C_EMBER : C_BONE * 0.8; }
  float beam(vec2 p, vec2 o, float a, float w0, float spread, float len) {
    vec2 d = vec2(sin(a), cos(a));
    vec2 v = p - o;
    float along = dot(v, d);
    float perp = abs(v.x * d.y - v.y * d.x);
    float wd = w0 + max(along, 0.0) * spread;
    float k = perp / wd;
    return exp(-k * k * 3.0) * smoothstep(0.0, 50.0, along) * exp(-max(along, 0.0) / len) * (0.4 + 0.6 * w0 / wd);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float hz = 0.5 + 0.5 * fbm(p / 260.0 + vec2(uT * 0.05, -uT * 0.02), 3);
    vec3 col = C_INK;
    // 舞台那一側比較亮一點（整片暖暖的逆光），往左越暗
    vec2 q = (p - vec2(1450.0, 330.0)) / vec2(900.0, 460.0);
    col += (C_BLOOD * 0.07 + C_BONE * 0.01) * exp(-dot(q, q) * 1.4) * uOn;
    vec3 L = vec3(0.0);
    L += beamCol(uColA.x) * uIntA.x * beam(p, vec2(${RIG[0].x}.0, ${RIG[0].y}.0), uAngA.x, 9.0, 0.12, 1500.0);
    L += beamCol(uColA.y) * uIntA.y * beam(p, vec2(${RIG[1].x}.0, ${RIG[1].y}.0), uAngA.y, 9.0, 0.12, 1500.0);
    L += beamCol(uColA.z) * uIntA.z * beam(p, vec2(${RIG[2].x}.0, ${RIG[2].y}.0), uAngA.z, 9.0, 0.12, 1500.0);
    L += beamCol(uColA.w) * uIntA.w * beam(p, vec2(${RIG[3].x}.0, ${RIG[3].y}.0), uAngA.w, 9.0, 0.12, 1500.0);
    L += beamCol(uColB.x) * uIntB.x * beam(p, vec2(${RIG[4].x}.0, ${RIG[4].y}.0), uAngB.x, 7.0, 0.1, 1200.0);
    L += beamCol(uColB.y) * uIntB.y * beam(p, vec2(${RIG[5].x}.0, ${RIG[5].y}.0), uAngB.y, 7.0, 0.1, 1200.0);
    L += beamCol(uColB.z) * uIntB.z * beam(p, vec2(${RIG[6].x}.0, ${RIG[6].y}.0), uAngB.z, 7.0, 0.1, 1200.0);
    float hud = smoothstep(1300.0, 1400.0, p.x) * smoothstep(780.0, 860.0, p.y);
    col += L * (0.22 + 0.2 * hz) * uOn * (1.0 - 0.9 * hud);
    // 大螢幕照在霧上
    float ds = sdBox(p - vec2(${SCREEN.x + SCREEN.w / 2}.0, ${SCREEN.y + SCREEN.h / 2}.0), vec2(${SCREEN.w / 2}.0, ${SCREEN.h / 2}.0));
    col += mix(C_SIGNAL, C_BONE, 0.4) * exp(-max(ds, 0.0) / 120.0) * 0.05 * uScr * (0.6 + 0.4 * hz);
    col += C_BONE * 0.05 * uFlash;
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, {
  uT: { value: 0 }, uFlash: { value: 0 }, uScr: { value: 0 }, uOn: { value: 0 },
  uAngA: { value: new THREE.Vector4() }, uIntA: { value: new THREE.Vector4() }, uColA: { value: new THREE.Vector4() },
  uAngB: { value: new THREE.Vector3() }, uIntB: { value: new THREE.Vector3() }, uColB: { value: new THREE.Vector3() },
});

interface Who { p: 'xw' | 'mt'; frames: string[]; x: number; perBeat: number; phase: number }
interface Pts { frame: string; stick?: Pt; hold?: Pt; phone?: Pt; band?: Pt }

export default class Concert extends Scene {
  hall = shared('concert.hall', HALL);
  back = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  gl = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  banner = { x: 0, y: 0, w: 0, h: 0 };
  who: Who[] = [];
  fans: Fan[] = [];
  jumps: number[] = [];
  tLit = 0;
  tUnfurl = 0;
  msgT0 = 0;
  lyricSize = 52;
  led: CanvasPattern | null = null;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客' + INVITE + LABEL + ' ·♥');
    const xw = XW.filter(hasPuppet), mt = MT.filter(hasPuppet);
    this.track(await loadPuppets([...xw, ...mt]));
    // 燈亮在第一拍、布條在下一拍攤開；留言接著一個字一個字寫上去
    this.tLit = beatAfter(au, s + 0.12);
    this.tUnfurl = beatAfter(au, this.tLit + 0.05, 1);
    if (this.tUnfurl > s + 1.4) this.tUnfurl = this.tLit + 0.25;
    this.msgT0 = this.tUnfurl + 0.3;
    // 跳：小節線（段落能量高每小節、其他每兩小節），最高點在小節線上
    const every = (this.ctx.params.energy ?? au.energyAt(s)) > 0.62 ? 1 : 2;
    for (let T = barAfter(au, s + 0.9), k = 0; T < e - 0.3 && k < 40; k++) {
      this.jumps.push(T);
      T = au.timeOfBar(Math.round(au.barAt(T)) + every);
    }
    // 布條：標準 v2 的字級；寬高跟著留言
    const c = this.fg.ctx;
    const tw = BANNER.wMax - PAD.x * 2, th = BANNER.hMax - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th) : noteV2(c, INVITE, null, tw, th * 0.5, { max: 44 });
    const bw = Math.min(BANNER.wMax, Math.max(BANNER.wMin, tightenNote(c, this.note, 300) + PAD.x * 2));
    const bh = Math.min(BANNER.hMax, Math.max(170, PAD.top + this.note.height + PAD.bottom + 8));
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    // 兩個人站的位置：抓布條的拳頭剛好在布條上緣的兩個角
    const inset = 16;
    const hx = (n: string | undefined) => (n ? puppetPoint(n, 'hold', 0, GROUND, { h: SZ }) : null);
    const ha = hx(xw[0]) ?? { x: SZ * 0.3, y: GROUND - SZ * 0.74 };
    const hb = hx(mt[0]) ?? { x: -SZ * 0.12, y: GROUND - SZ * 0.74 };
    const bx = BANNER.cx - bw / 2;
    this.who = [
      { p: 'xw', frames: xw, x: bx + inset - ha.x, perBeat: 1, phase: 0 },
      { p: 'mt', frames: mt, x: bx + bw - inset - hb.x, perBeat: 0.5, phase: 0.3 },
    ];
    this.banner = { x: bx, y: (ha.y + hb.y) / 2 - 8, w: bw, h: bh };
    // 其他觀眾：兩人後面一整片（遠的小），舞台前面也站滿；右下角 HUD 前面只站遠的（身體不會伸進 HUD）
    this.fans = makeCrowd({ x0: -60, x1: W + 60, eye: EYE, n: 200, kNear: 0.72, kFar: 0.2, seed: 9, lift: 0.55, phone: 0.2, skip: (x, k) => x > 1320 && k > 0.45 });
    // LED 的細格線（每格蓋在螢幕上一次）
    const pc = document.createElement('canvas');
    pc.width = pc.height = 4;
    const px = pc.getContext('2d')!;
    px.fillStyle = 'rgba(0,0,0,0.34)';
    px.fillRect(3, 0, 1, 4); px.fillRect(0, 3, 3, 1);
    this.led = c.createPattern(pc, 'repeat');
    this.drawBack();
  }

  /** 不會動的：燈架塔、燈具、舞台、大螢幕的框（畫一次）。 */
  private drawBack() {
    const L = this.back, c = L.ctx;
    L.clear();
    const metal = mixRgba('ink2', 'graphite', 0.3), edge = rgba('bone', 0.1);
    // 舞台：台口一條亮邊、立面一直往下（在觀眾的頭後面）
    c.fillStyle = mixRgba('ink', 'ink2', 0.7);
    c.fillRect(TOWER - 20, STAGE_Y, W - TOWER + 20, 190);
    c.fillStyle = edge;
    c.fillRect(TOWER - 20, STAGE_Y, W - TOWER + 20, 1.5);
    c.fillStyle = mixRgba('ink2', 'graphite', 0.3);
    for (const r of RIG.slice(4)) c.fillRect(r.x - 16, STAGE_Y - 12, 32, 12);
    // 燈架塔：兩根直桿、中間的斜撐，頂上接一段橫的
    c.strokeStyle = metal;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(TOWER - 16, 20); c.lineTo(TOWER - 16, STAGE_Y);
    c.moveTo(TOWER + 16, 20); c.lineTo(TOWER + 16, STAGE_Y);
    for (let y = 20; y < STAGE_Y; y += 32) { c.moveTo(TOWER - 16, y); c.lineTo(TOWER + 16, y + 16); c.lineTo(TOWER - 16, y + 32); }
    c.moveTo(TOWER - 16, 20); c.lineTo(W + 10, 20);
    c.moveTo(TOWER - 16, 40); c.lineTo(SCREEN.x - 14, 40);
    c.stroke();
    // 燈具：掛在塔上
    c.fillStyle = mixRgba('ink2', 'graphite', 0.45);
    for (const r of RIG.slice(0, 4)) { c.beginPath(); c.arc(r.x, r.y, 13, 0, Math.PI * 2); c.fill(); }
    // 大螢幕的框（螢幕的內容每格畫）
    const S = SCREEN;
    c.fillStyle = rgba('ink');
    c.fillRect(S.x - 12, S.y - 12, S.w + 24, S.h + 24);
    c.strokeStyle = rgba('bone', 0.12);
    c.lineWidth = 1.5;
    c.strokeRect(S.x - 12, S.y - 12, S.w + 24, S.h + 24);
    L.upload();
  }

  /** 燈的角度：每一拍甩到一個新角度（拍點上最快、之後慢下來）。 */
  private rigAngle(i: number, t: number) {
    const au = this.ctx.audio, r = RIG[i]!;
    const b = Math.floor(au.beatAt(t) + 1e-6);
    const target = (k: number) => r.a + r.amp * (hash(k, i, 5) * 2 - 1);
    const u = (t - au.timeOfBeat(b)) / (au.beatPeriod(t) * 0.6);
    return toward(target(b - 1), target(b), u);
  }

  /** 跳的高度與壓扁：小節線上最高。 */
  private jumpAt(t: number, height: number) {
    const bp = this.ctx.audio.beatPeriod(t);
    const air = clamp(bp * 1.1, 0.34, 0.56);
    for (const T of this.jumps) {
      if (t > T - air / 2 - 0.2 && t < T + air / 2 + 0.35) return jumpArc(t, T - air / 2, T + air / 2, height, { crouch: 0.07, land: 0.12 });
    }
    return null;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    const bar = Math.floor(au.barAt(t) + 1e-6);
    const on = prog(t, this.tLit - 0.04, this.tLit + 0.12);
    const kick = beatKick(au, t, 0.25);
    let flash = pulse(t, this.tLit, 0.1);
    for (const T of this.jumps) flash = Math.max(flash, 0.7 * pulse(t, T, 0.07));
    const lit = LITS[((bar % 2) + 2) % 2]!;
    const litCol = rgba(lit);

    // ---- 場館、光束
    const u = this.hall.u;
    u.uT!.value = t; u.uFlash!.value = flash; u.uOn!.value = on; u.uScr!.value = on * (0.8 + 0.2 * kick);
    const ang = RIG.map((_, i) => this.rigAngle(i, t));
    const inten = RIG.map((_, i) => (0.6 + 0.4 * kick) * (0.75 + 0.25 * Math.sin(t * 1.3 + i * 2)));
    const col = RIG.map((_, i) => (i < 4 ? (i + bar) % 3 : (bar + i) % 2));
    (u.uAngA!.value as THREE.Vector4).set(ang[0]!, ang[1]!, ang[2]!, ang[3]!);
    (u.uAngB!.value as THREE.Vector3).set(ang[4]!, ang[5]!, ang[6]!);
    (u.uIntA!.value as THREE.Vector4).set(inten[0]!, inten[1]!, inten[2]!, inten[3]!);
    (u.uIntB!.value as THREE.Vector3).set(inten[4]!, inten[5]!, inten[6]!);
    (u.uColA!.value as THREE.Vector4).set(col[0]!, col[1]!, col[2]!, col[3]!);
    (u.uColB!.value as THREE.Vector3).set(col[4]!, col[5]!, col[6]!);
    this.hall.render(renderer, out);
    comp.draw(renderer, this.back.texture, out);

    const L = this.fg; L.clear();
    const c = L.ctx;
    const G = this.gl; G.clear();
    const g = G.ctx;

    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    const j = this.jumpAt(t, 38);
    const lift = j ? -j.y : 0;
    const squash = j ? j.squash : 0.02 * kick + breathe(t, 0.008, 3.2);
    // 每一拍輕輕點一下（拍點上往下沉）
    const bob = lift > 0 ? 0 : -5 * kick;
    const pts: Pts[] = [];
    this.who.forEach((w, i) => {
      if (!w.frames.length) return;
      const o: PuppetOpts = { h: SZ, squash, rot: Math.sin((au.beatAt(t) + w.phase) * Math.PI) * 0.01, pivot: 0.1 };
      puppetShadow(c, w.p, w.x, GROUND, { h: SZ, lift, alpha: 0.8, wide: 1.2, color: '0,0,0' });
      const y = GROUND - lift - bob;
      const frame = drawCycle(c, au, t, w.frames, w.perBeat, w.x, y, o);
      const pt = (k: string) => puppetPoint(frame, k, w.x, y, o) ?? undefined;
      pts[i] = { frame, stick: pt('stick'), hold: pt('hold'), phone: pt('phone'), band: pt('band') };
    });
    // 舞台的燈從右上打過來：頭頂亮、往腳底暗；燈還沒亮時兩人只是剪影
    const dark = 1 - on;
    puppetLight(c, [0, GROUND - SZ * 1.35, 1420, SZ * 1.35 + 40], rgba('ink', 0.06 + 0.82 * dark), rgba('ink', 0.5 + 0.45 * dark));

    // ---- 布條（在兩個人前面；抓布條的拳頭露在布條上面）
    this.drawBanner(c, t, pts.map((p) => p?.hold).filter((p): p is Pt => !!p), lift + bob);

    // ---- 手燈、手機（蓋在拳頭上）、手環的光
    const A = pts[0], B = pts[1];
    if (A?.stick) {
      // 手燈的方向：順著這一張圖的前臂（手環 → 拳頭），每一拍甩過去再慢慢回來
      const base = A.band ? Math.atan2(A.stick.x - A.band.x, A.band.y - A.stick.y) : 0;
      const a = base * 0.8 + 0.22 * Math.sin((au.beatAt(t) % 1) * Math.PI) * Math.sign(base || 1);
      const orb = lightStick(c, A.stick, a, SZ, { lit, on });
      glow(g, litCol, orb.x, orb.y, SZ * (0.075 + 0.015 * kick), 0.85 * on);
      glow(g, rgba('bone'), orb.x, orb.y, SZ * 0.022, 0.6 * on);
    }
    if (B?.phone && B.band) {
      const tilt = Math.atan2(B.phone.x - B.band.x, B.band.y - B.phone.y);
      phoneBack(c, B.phone, tilt + Math.sin(t * 1.7) * 0.03, SZ);
    }
    for (const p of pts) if (p?.band) glow(g, mixRgba('bone', 'signal', 0.35), p.band.x, p.band.y, SZ * 0.05, (0.3 + 0.55 * kick) * on);

    // ---- 大螢幕（歌詞）
    this.drawScreen(c, t, on, kick);

    // ---- 其他觀眾（畫在兩個人、布條後面：destination-over）與地上的暗
    c.save();
    c.globalCompositeOperation = 'destination-over';
    // 觀眾的下半身融進黑暗裡（真的演唱會只看得到頭、肩膀、舉起來的手和燈）
    const fade = c.createLinearGradient(0, EYE + 40, 0, EYE + 190);
    fade.addColorStop(0, rgba('ink', 0));
    fade.addColorStop(1, rgba('ink', 0.97));
    c.fillStyle = fade;
    c.fillRect(0, EYE + 40, W, H - EYE - 40);
    const jAll = this.jumpAt(t - 0.03, 30);
    const fl = drawCrowd(c, this.fans, {
      unit: SZ * 0.062, fill: (k) => mixRgba('ink', mixRgba('ink2', lit, 0.08), 0.5 * (1 - k)), rim: rgba(lit, 0.12 + 0.22 * on),
      bounce: kick, t, jump: jAll ? -jAll.y : 0, wave: Math.sin(au.beatAt(t) * Math.PI) * 0.22, lit: mixRgba(lit, 'bone', 0.35, 0.3 + 0.6 * on),
    });
    c.restore();
    const boneCol = rgba('bone');
    for (const l of fl) {
      if (l.prop === 'stick') glow(g, litCol, l.x, l.y, l.r * (1.15 + 0.3 * kick), (0.4 + 0.35 * hash(l.s * 97)) * on);
      else glow(g, boneCol, l.x, l.y, l.r * 1.1, 0.3 * on);
    }
    // 台口的腳燈：八分音符一格一格跑
    const step = Math.floor(au.beatAt(t) * 2);
    for (let k = 0, x = TOWER + 40; x < W - 20; k++, x += 46) glow(g, litCol, x, STAGE_Y + 6, 16, ((k + step) % 6 === 0 ? 0.7 : 0.12) * on);
    // 燈具的鏡頭
    RIG.forEach((r, i) => glow(g, i < 4 ? rgba('bone') : litCol, r.x + Math.sin(ang[i]!) * 8, r.y + Math.cos(ang[i]!) * 8, 15, (0.35 + 0.25 * kick) * on));

    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, G.upload(), out, { mode: 'add', tint: [1.6, 1.6, 1.6] });
    // 鏡頭：整個窗格慢慢推近兩個人；大鼓時輕輕一頓
    const push = ease.inOutCubic(f.p);
    return {
      bloom: 0.75, vignette: 0.55, zoom: 1 + 0.03 * push + 0.004 * f.a.kick,
      shake: [-(BANNER.cx - W / 2) * 0.03 * push, -(this.banner.y - H / 2) * 0.03 * push],
      popupAvoid: [[this.banner.x, this.banner.y, this.banner.w, this.banner.h], [SCREEN.x, SCREEN.y, SCREEN.w, SCREEN.h]],
    };
  }

  /** 布條：上緣兩個角被拳頭抓著（跟著人一起跳），第二拍從上緣往下攤開；留言一個字一個字寫上去、署名淡入。 */
  private drawBanner(c: CanvasRenderingContext2D, t: number, fists: Pt[], dy: number) {
    const B = this.banner, n = this.note;
    const unf = ease.outBack(prog(t, this.tUnfurl, this.tUnfurl + 0.42));
    const y = B.y - dy;
    if (unf <= 0.01) {
      // 還沒攤開：捲成一條，橫在兩個拳頭之間
      c.fillStyle = mixRgba('ink2', 'graphite', 0.5);
      c.fillRect(B.x + 10, y - 6, B.w - 20, 14);
      return;
    }
    c.save();
    // 拳頭的地方挖掉（拳頭蓋在布條上面）
    c.beginPath();
    c.rect(0, 0, W, H);
    for (const p of fists) { c.moveTo(p.x + SZ * 0.042, p.y); c.arc(p.x, p.y, SZ * 0.042, 0, Math.PI * 2); }
    c.clip('evenodd');
    cloth(c, B.x, y, B.w, B.h, {
      fill: mixRgba('ink2', 'graphite', 0.2), shade: rgba('ink', 0.3), edge: rgba('signal', 0.7), motif: rgba('signal', 0.75),
      unfurl: Math.min(1, unf), wave: 3.5, t, seed: 3,
    });
    c.restore();
    if (!n || unf < 0.85) return;
    const total = msgChars(n.fit);
    const per = clamp(1.4 / Math.max(1, total), 0.025, 0.09);
    const done = this.msgT0 + total * per;
    const top = y + PAD.top, hh = B.h - PAD.top - PAD.bottom;
    drawNote(c, n, B.x + (B.w - n.width) / 2, top + Math.max(0, (hh - n.height) * 0.45), {
      chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('bone', 0.96) : rgba('ash', 0.85), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5),
    });
  }

  /** 大螢幕：T 恤同款的星星圖案（跟著拍子跳）、歌詞（逐字跟唱）、LED 細格線；燈亮的那一拍由上往下亮起來。 */
  private drawScreen(c: CanvasRenderingContext2D, t: number, on: number, kick: number) {
    const S = SCREEN;
    const ly = lyricAt(this.ctx.lyrics, t);
    const lk = ly ? ly.k : 0;
    c.save();
    c.beginPath(); c.rect(S.x, S.y, S.w, S.h * on); c.clip();
    const bgc = c.createLinearGradient(0, S.y, 0, S.y + S.h);
    bgc.addColorStop(0, mixRgba('ink2', 'blood', 0.35));
    bgc.addColorStop(1, rgba('ink2'));
    c.fillStyle = bgc;
    c.fillRect(S.x, S.y, S.w, S.h);
    // 星星＋星環（T 恤圖案的放大版），拍點上放大一下
    const cx = S.x + S.w / 2, cy = S.y + S.h / 2;
    const sc = 1 + 0.06 * kick;
    c.save();
    c.translate(cx, cy);
    c.scale(sc, sc);
    c.globalAlpha = 0.2 + 0.45 * (1 - lk);
    c.strokeStyle = rgba('signal', 0.9);
    c.lineWidth = 3;
    c.beginPath(); c.ellipse(0, 6, S.w * 0.3, S.h * 0.14, -0.16, 0, Math.PI * 2); c.stroke();
    c.fillStyle = rgba('signal', 0.85);
    star(c, 0, 0, S.h * 0.32, 0.12 + Math.sin(t * 0.6) * 0.05);
    c.fill();
    c.fillStyle = rgba('bone', 0.5);
    for (let k = 0; k < 7; k++) { const a = k * 0.9 + t * 0.2; c.beginPath(); c.arc(Math.cos(a) * S.w * 0.38, Math.sin(a) * S.h * 0.36, 2.2, 0, Math.PI * 2); c.fill(); }
    c.restore();
    // 歌詞：螢幕正中間，一行（太長折兩行）
    if (ly) {
      const st: LyricStyle = { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, maxWidth: S.w - 90, align: 'center', active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3) };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(cx, cy + lay.size * 0.36 - (lay.height - lay.size) / 2);
      drawLyric(c, ly.line, t, st, lay, ly.k * on);
      c.restore();
    }
    // 小字：只有左上角一個閃的點與 LIVE，很小
    c.font = font(F.mono(500), 17);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('ash', 0.6);
    c.fillText(LABEL, S.x + 44, S.y + 36);
    c.letterSpacing = '0px';
    c.fillStyle = rgba('signal', Math.sin(t * 5) > 0 ? 0.95 : 0.3);
    c.beginPath(); c.arc(S.x + 30, S.y + 30, 5, 0, Math.PI * 2); c.fill();
    if (this.led) { c.fillStyle = this.led; c.fillRect(S.x, S.y, S.w, S.h); }
    if (on < 1) { c.fillStyle = rgba('bone', 0.6 * (1 - on)); c.fillRect(S.x, S.y + S.h * on - 2, S.w, 3); }
    c.restore();
  }
}
