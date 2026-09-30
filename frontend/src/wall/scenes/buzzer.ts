// 絕殺（暗、hoops）：比賽最後三秒，一記三分球在空中慢動作飛向籃框。角色是 Codex 畫的雙人紙偶（cp_hoops_tense／hug，_puppet.ts、素材組 hoops）。
//  - 開場：場上的剪影球員起跳出手（不畫真實球隊、聯盟），之後整個畫面進入慢動作——球沿著高高的拋物線慢慢飛（後面拖著幾顆殘影與一條訊號色的細線），
//    計時器從 3.0 慢慢倒數，球員剪影在空中慢慢往下飄。每一拍像心跳一樣「咚」一下（鏡頭輕推、兩個人緊張地縮一下）。
//  - 兩個人在左下角場邊站著（tense）：手十指緊扣、孟庭摀著嘴（兩眼睜大）、一起抬頭看球。
//  - **小節線上球進**（計時器剛好歸零）：籃板的燈亮起來、記分板 A&O +3 反超，畫面閃一下、震一下；兩個人跳起來擁抱（hug），
//    落地後在拍點上一跳一跳；看台的觀眾剪影站起來，隊色（寶藍、金黃、白）的彩帶從上面飄下來。
//  - **焦點是主打留言**：寫在左上角吊著的記分板上（七段顯示器的比分與計時器在上面一排，留言在下面的面板）；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、板子最大 740 × 360（右邊留給球飛的路），寬高跟著留言。沒有留言時寫邀請。
//  - 歌詞沿著球飛的那道拋物線排（lyricOnPath，逐字跟唱），比留言小一級；球從字的下面飛過去。
//  - 右下角 HUD：只有地板，球員都站在左邊一點、籃框的柱子不進那一塊。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, pulse } from '../engine/util';
import { lyricAt, barAfter, beatAfter, msgChars } from './_motifs';
import { lyricOnPath, drawNote, arcAt, type Note } from './_couple';
import { loadPuppets, drawPick, puppetShadow, puppetIn, puppetLight, jumpArc, breathe, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';
import { drawPlayer, playerPose, makeCrowd, CrowdLayer, crowdShade, basketball, drawHoop, seats, seg7, streamers, teamRgba, TEAM_TAG, type Hoop, type Pt, type PlayerPose } from './_c8';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'hoops', paper: false, energy: [0.4, 1], bars: [4, 8] };

/** 球場：球員腳底、籃框（籃板在籃框右邊）。 */
const FLOOR = 800;
const HOOP: Hoop = { x: 1600, y: 468, d: 54, side: 1, floor: FLOOR };
/** 出手的球員：腳底 x、身高、起跳高度。 */
const SHOOT = { x: 900, h: 215, lift: 64 };
/** 兩個人：左下角場邊（腳底、場景尺度 = 宣文站直的身高）。 */
const CX = 420, GROUND = 995, SZ = 460;
/** 記分板：左上角吊著，最大寬高（標準 v2）；上面一排比分（ROW 高），下面寫留言的內距。 */
const BOARD = { x: 110, y: 80, w: 740, h: 360 };
const ROW = 84;
const PAD = { x: 40, top: ROW + 26, bottom: 28 };
/** 拋物線的頂點比出手點高多少（頂點上的歌詞字頂要離上緣 96 px 以上）。 */
const APEX = 170;
const BALL_R = 12;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const POSES = ['cp_hoops_tense', 'cp_hoops_hug'];
/** 其他球員：x、深度（身高倍數）、慢動作裡的姿勢（跑去搶籃板、防守）；進球後隊友歡呼（home）、對手垂頭（away）。 */
const OTHERS: { x: number; k: number; pose: PlayerPose; flip: boolean; home: boolean; lift: number }[] = [
  { x: 1000, k: 1.02, pose: 'jump', flip: true, home: false, lift: 46 },
  { x: 800, k: 0.9, pose: 'run', flip: false, home: true, lift: 0 },
  { x: 1300, k: 0.94, pose: 'defend', flip: true, home: false, lift: 0 },
  { x: 1380, k: 0.97, pose: 'run', flip: false, home: true, lift: 0 },
  { x: 1120, k: 0.86, pose: 'run', flip: false, home: false, lift: 0 },
];

/**
 * 慢動作的場館：很暗，球場上方一團冷冷的光；閃光（flash）在進球那一下整個場館亮一點。
 * 用 shader 算（浮點＋抖色），淡漸層才不會一圈一圈的。
 */
const ARENA = () => new FSPass(/* glsl */ `
  uniform float flash;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float floorK = smoothstep(${FLOOR - 40}.0, ${FLOOR}.0, p.y);
    vec2 q = (p - vec2(1250.0, 430.0)) / vec2(900.0, 480.0);
    float pool = exp(-dot(q, q) * 1.5);
    vec2 f = (p - vec2(1250.0, ${FLOOR + 30}.0)) / vec2(700.0, 120.0);
    float gloss = exp(-dot(f, f) * 1.4) * floorK;
    vec3 col = mix(C_INK, C_INK2 + C_BLOOD * 0.03, floorK) + C_BONE * (0.016 * pool + 0.03 * gloss) + C_SIGNAL * 0.04 * flash * (0.4 + pool);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { flash: { value: 0 } });

export default class Buzzer extends Scene {
  arena = shared('buzzer.arena', ARENA);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 記分板的殼、籃板與柱子（init 畫好，每格貼到 fg：觀眾在它們後面）。 */
  mid = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** R = 出手、T = 小節線上球進（計時器歸零）。 */
  R = 0; T = 0;
  release: Pt = { x: 0, y: 0 };
  arc: Pt[] = [];
  keys: [number, string][] = [];
  crowd: CrowdLayer | null = null;
  note: Note | null = null;
  board = { ...BOARD };
  lyricSize = 52;
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客新人留言' + INVITE + 'A&O GUEST FINAL QTR 4 BUZZER BEATER');
    this.track(await loadPuppets(POSES));
    // 進球的小節線：窗格四成左右的地方（慢動作至少兩秒多、最多五秒半）；窗格太短就往前挪
    let T = barAfter(au, s + clamp((e - s) * 0.42, 2.2, 5.5));
    if (T > e - 1.0) T = barAfter(au, s + 1.6);
    if (T > e - 0.9) T = beatAfter(au, s + 1.3);
    this.T = T;
    this.R = Math.min(s + 0.5, T - 0.8);
    // 出手點：跳到最高時的手（剪影的手照 _c8 的骨架算）
    this.release = playerPose(SHOOT.x, FLOOR - SHOOT.lift, { h: SHOOT.h, pose: 'jump', fill: '' }).hand;
    // 歌詞沿著拋物線中間那一段（兩端太斜、字會倒）
    const hgt = Math.min(this.release.y, HOOP.y) - APEX > 150 ? APEX : 180;
    this.arc = Array.from({ length: 49 }, (_, i) => arcAt(this.release, HOOP, hgt, 0.1 + (0.8 * i) / 48));
    this.keys = [[-1e9, 'cp_hoops_tense'], [T, 'cp_hoops_hug']];
    // 記分板上的留言：標準 v2；板子的寬高跟著留言
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, hmax = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const bh = Math.min(BOARD.h, Math.max(PAD.top + 110, PAD.top + this.note.height + PAD.bottom + 12));
    const bw = Math.min(BOARD.w, Math.max(560, tightenNote(c, this.note, 480) + PAD.x * 2));
    this.board = { x: BOARD.x, y: BOARD.y, w: bw, h: bh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.3);
    this.crowd = new CrowdLayer(makeCrowd(-20, W + 20, 470, 8, { r: 10, gap: 44, rowH: 40, shrink: 0.94, seed: 21 }), (cc) => crowdShade(cc, 170, 500), rgba('bone', 0.04), SCALE);
    this.drawBackground();
    this.drawMid();
  }

  /** 不會動的：地板的場線（很淡）、兩個人後面的座椅。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    c.strokeStyle = rgba('bone', 0.09);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(620, FLOOR - 10); c.lineTo(1880, FLOOR - 10);
    // 三分線（透視壓扁的弧）與罰球區
    c.moveTo(1740, FLOOR - 10); c.ellipse(1600, FLOOR + 40, 620, 60, 0, -Math.PI * 0.5, -Math.PI, true);
    c.moveTo(1420, FLOOR - 10); c.lineTo(1395, 900);
    c.stroke();
    const step = SZ * 0.38;
    seats(c, [-2, -1, 0, 1, 2].map((k) => CX - SZ * 0.2 + k * step), GROUND - 14, SZ * 0.95, { fill: mixRgba('ink', 'ink2', 0.7), edge: rgba('bone', 0.08) });
    c.fillStyle = rgba('ink', 0.5);
    c.fillRect(0, GROUND + 16, 780, H - GROUND - 16);
    L.upload();
  }

  /** 記分板的殼（吊鍊、外框、比分那一排的格子）、籃板與柱子。 */
  private drawMid() {
    const L = this.mid, c = L.ctx;
    L.clear();
    drawHoop(c, HOOP, 'back', { line: rgba('bone', 0.5), glass: rgba('bone', 0.07), pole: mixRgba('ink2', 'bone', 0.05) });
    const B = this.board;
    c.strokeStyle = rgba('bone', 0.25);
    c.lineWidth = 2;
    c.setLineDash([7, 5]);
    for (const x of [B.x + 70, B.x + B.w - 70]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, B.y - 10); c.stroke(); }
    c.setLineDash([]);
    c.fillStyle = mixRgba('ink', 'ink2', 0.4);
    c.fillRect(B.x - 12, B.y - 12, B.w + 24, B.h + 24);
    c.fillStyle = rgba('ink2');
    c.beginPath(); c.moveTo(B.x - 12, B.y + B.h + 12); c.lineTo(B.x + B.w + 12, B.y + B.h + 12); c.lineTo(B.x + B.w - 6, B.y + B.h + 28); c.lineTo(B.x + 6, B.y + B.h + 28); c.closePath(); c.fill();
    c.strokeStyle = rgba('bone', 0.14);
    c.lineWidth = 1.5;
    c.strokeRect(B.x - 12, B.y - 12, B.w + 24, B.h + 24);
    c.fillStyle = rgba('ink');
    c.fillRect(B.x, B.y, B.w, B.h);
    // 比分那一排：三格（主隊、計時器、客隊），下面一條細線
    c.strokeStyle = rgba('bone', 0.1);
    c.lineWidth = 1;
    c.strokeRect(B.x + 14, B.y + 12, B.w - 28, ROW - 16);
    c.beginPath();
    c.moveTo(B.x + B.w * 0.3, B.y + 12); c.lineTo(B.x + B.w * 0.3, B.y + ROW - 4);
    c.moveTo(B.x + B.w * 0.7, B.y + 12); c.lineTo(B.x + B.w * 0.7, B.y + ROW - 4);
    c.stroke();
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('ash', 0.6);
    // 隊名：各自那一格的左上角（小），比分在格子正中間的下半（板子窄的時候也不會疊在一起）
    c.font = font(F.mono(500), 13);
    c.fillStyle = teamRgba('gold', 0.7);
    c.fillText(TEAM_TAG.name, B.x + 26, B.y + 32);
    c.fillStyle = rgba('ash', 0.6);
    c.textAlign = 'right';
    c.fillText('GUEST', B.x + B.w - 26, B.y + 32);
    c.textAlign = 'center';
    c.font = font(F.mono(500), 15);
    c.fillText('QTR 4', B.x + B.w / 2, B.y + ROW - 14);
    c.textAlign = 'left';
    c.letterSpacing = '0px';
  }

  /** 慢動作的時間：出手到進球之間，場上的東西只走四分之一的速度。 */
  private slow(t: number) {
    const { R, T } = this;
    if (t < R) return t;
    if (t < T) return R + (t - R) * 0.25;
    return R + (T - R) * 0.25 + (t - T);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, { R, T } = this;
    const bp = au.beatPeriod(t);
    const hit = pulse(t, T, 0.3);
    const inSlow = t >= R && t < T;
    this.arena.u.flash!.value = hit;
    this.arena.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;

    // ---- 兩個人（這一層最先畫：打光只染紙偶）：慢動作時每一拍緊張地縮一下、微微發抖；球進的那一下跳起來抱在一起，之後一拍一跳
    let lift = 0, squash = breathe(t, 0.008, 3.1), rot = 0;
    if (t < T) { squash += 0.03 * beatKick(au, t, 0.2); rot = inSlow ? 0.004 * Math.sin(t * 37) : 0; }
    else {
      const air = Math.min(0.55, bp * 1.1);
      const j = jumpArc(t, T, T + air, 72, { crouch: 0.1, land: 0.14 });
      lift = -j.y; squash = j.squash;
      for (let k = 1; k <= 4; k++) {
        const tb = au.timeOfBeat(Math.round(au.beatAt(T + air)) + k);
        if (t > tb - 0.1 && t < tb + bp) { const h2 = jumpArc(t, tb, tb + bp * 0.5, 26, { crouch: 0.05, land: 0.08 }); if (h2.air || t > tb) { lift = -h2.y; squash = h2.squash; } }
      }
    }
    const ent = puppetIn(t, s + 0.05, 0.5);
    if (ent.alpha > 0) {
      puppetShadow(c, 'cp', CX, GROUND, { h: SZ, lift, alpha: 0.75 * ent.alpha, wide: 1.05, color: '0,0,0' });
      drawPick(c, this.keys, t, CX, GROUND - lift, { h: SZ, squash, rot, pivot: 0.3, spin: ent.spin, alpha: ent.alpha });
      puppetLight(c, [CX - 330, GROUND - SZ * 1.4, 660, SZ * 1.4 + 40], rgba('ink', 0.12 - 0.1 * hit), rgba('ink', 0.5));
    }

    // ---- 記分板的殼、籃板
    c.drawImage(this.mid.canvas, 0, 0, W, H);
    this.drawBoard(c, t, hit);

    // ---- 歌詞：沿著球飛的拋物線
    const ly = lyricAt(lyrics, t);
    const rv = prog(t, s + 0.1, s + 0.6, ease.inOutCubic);
    if (ly) lyricOnPath(c, ly.line, t, this.arc, { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, offset: 26, alpha: ly.k * rv, unsung: rgba('bone', 0.24), sung: rgba('bone', 0.9) });

    // ---- 球員與球
    this.drawPlay(c, t);

    // ---- 籃板的燈：球進的那一刻亮起來，之後兩拍在拍點上閃
    const lamp = t >= T ? Math.max(hit, (1 - prog(t, T + bp * 2, T + bp * 3)) * (0.5 + 0.5 * beatKick(au, t, 0.25))) : 0;
    if (lamp > 0.02) {
      const bx = HOOP.x + HOOP.side * (HOOP.d / 2 + HOOP.d * 0.18);
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = rgba('signal', 0.25 * lamp);
      c.fillRect(bx - 16, HOOP.y - HOOP.d * 2.0 - 12, 32, HOOP.d * 2.35 + 24);
      c.fillStyle = rgba('ember', 0.9 * lamp);
      c.fillRect(bx - 5, HOOP.y - HOOP.d * 2.0, 10, HOOP.d * 2.35);
      c.restore();
    }

    // ---- 彩帶（進球後從上面飄下來）
    // 彩帶只在記分板右邊飄（不蓋到留言）
    if (t >= T) streamers(c, T + 0.05, t, { n: 40, x0: this.board.x + this.board.w + 60, x1: 1880, colors: [teamRgba('blue', 0.95), teamRgba('gold', 0.85), teamRgba('white', 0.8)], floor: FLOOR + 40 });

    // ---- 看台的觀眾：畫在這一層所有東西後面（destination-over）；慢動作時幾乎不動，進球時整片站起來
    const cheer = prog(t, T, T + 0.15) * (1 - prog(t, T + bp * 6, T + bp * 9)) * 0.9;
    c.save();
    c.globalCompositeOperation = 'destination-over';
    this.crowd?.draw(c, { bounce: inSlow ? 0 : beatKick(au, t, 0.3), cheer, t: this.slow(t) });
    c.restore();

    comp.draw(renderer, L.upload(), out);
    // 鏡頭：慢動作時慢慢推近籃框、每一拍像心跳一樣輕推一下；球進的那一下閃、震
    const push = ease.inOutCubic(clamp((t - R) / Math.max(0.5, T - R)));
    const beatPush = inSlow ? 0.006 * beatKick(au, t, 0.35) : 0;
    return {
      bloom: 0.7, vignette: 0.55 + 0.15 * (inSlow ? 1 : 0), ca: inSlow ? 0.8 : 0.4,
      zoom: 1 + 0.025 * push * (1 - prog(t, T, T + 1.2, ease.inOutCubic)) + beatPush + 0.01 * hit,
      shake: [(W / 2 - 1200) * 0.025 * push * (1 - prog(t, T, T + 1.2, ease.inOutCubic)), 6 * hit], flash: 0.06 * hit,
    };
  }

  /** 場上：出手的球員起跳、慢動作裡慢慢飄下來；防守的跳起來封蓋；球沿著拋物線慢慢飛（殘影＋細線），小節線上進網、掉下來彈兩下。 */
  private drawPlay(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, { R, T } = this;
    const ts = this.slow(t);
    const fill = mixRgba('ink', 'ink2', 0.5), rim = rgba('bone', 0.08);
    const after = t >= T;
    // 出手的球員：出手前 0.3 秒起跳、出手在最高點；慢動作裡慢慢落下；進球後落地歡呼
    const up = prog(t, R - 0.3, R, ease.outCubic);
    const fallK = clamp((ts - R) / 0.45);
    const sl = SHOOT.lift * (t < R ? up : Math.max(0, 1 - fallK * fallK));
    const sp: PlayerPose = t < R - 0.3 ? 'dribble' : sl > 2 ? 'jump' : after ? 'cheer' : 'stand';
    const beat = au.beatAt(ts);
    OTHERS.forEach((m, i) => {
      let lift = 0;
      let pose = m.pose;
      if (m.lift) { const k = prog(t, R - 0.25, R, ease.outCubic); lift = m.lift * (t < R ? k : Math.max(0, 1 - Math.pow(clamp((ts - R) / 0.4), 2))); if (lift < 2 && t > R) pose = 'stand'; }
      if (after) pose = m.home ? 'cheer' : 'stand';
      const bob = after && m.home ? Math.abs(Math.sin((t - T) * 7 + i)) * 14 : 0;
      // 跑的人（搶籃板）：慢動作裡慢慢往籃框跑（相位用慢動作的時間，腳步也是慢的）
      const run = pose === 'run' ? Math.min(ts, T) - R : 0;
      drawPlayer(c, m.x + Math.max(0, run) * 70 + Math.sin(ts * 1.1 + i) * 6, FLOOR - lift - bob, { h: SHOOT.h * m.k, pose, ph: beat * Math.PI * 2 + i, flip: m.flip, fill, rim, lean: after && !m.home ? 0.25 : 0 });
    });
    const sh = drawPlayer(c, SHOOT.x, FLOOR - sl, { h: SHOOT.h, pose: sp, ph: beat * Math.PI * 2, fill, rim });
    // 球
    let ball: Pt;
    let rot = ts * 0.8;
    if (t < R) {
      if (sp === 'dribble') { const ph = au.beatAt(t) % 1; ball = { x: sh.hand.x + 6, y: lerp(FLOOR - BALL_R, sh.hand.y + BALL_R, Math.pow(Math.sin(Math.PI * ph), 0.7)) }; }
      else ball = { x: sh.hand.x, y: sh.hand.y - BALL_R * 0.4 };
    } else if (t < T) {
      const u = (t - R) / (T - R);
      const hgt = Math.min(this.release.y, HOOP.y) - APEX > 150 ? APEX : 180;
      // 殘影：往回幾個位置、越來越淡；一條訊號色的細線是飛過的路
      c.save();
      c.lineCap = 'round';
      const N = 24;
      for (let k = 1; k <= N; k++) {
        const a0 = arcAt(this.release, HOOP, hgt, ((k - 1) / N) * u), a1 = arcAt(this.release, HOOP, hgt, (k / N) * u);
        c.strokeStyle = rgba('signal', 0.08 + 0.5 * (k / N) ** 2);
        c.lineWidth = 1 + 2.4 * (k / N);
        c.beginPath(); c.moveTo(a0.x, a0.y); c.lineTo(a1.x, a1.y); c.stroke();
      }
      c.restore();
      for (let k = 4; k >= 1; k--) {
        const g = arcAt(this.release, HOOP, hgt, Math.max(0, u - k * 0.018));
        basketball(c, g.x, g.y, BALL_R, rot - k * 0.02, { dark: true, alpha: 0.12 * (5 - k) / 4 });
      }
      ball = arcAt(this.release, HOOP, hgt, u);
    } else {
      // 進了：從籃框掉下來、彈兩下
      const u = t - T, g = 1800, fall = Math.sqrt((2 * (FLOOR - BALL_R - HOOP.y)) / g);
      let by: number;
      if (u < fall) by = HOOP.y + 0.5 * g * u * u;
      else { const u2 = (u - fall) % (fall * 0.9), v0 = g * fall * 0.45; by = FLOOR - BALL_R - Math.max(0, v0 * u2 - 0.5 * g * u2 * u2); }
      ball = { x: HOOP.x - 4 - Math.max(0, u - fall) * 50, y: by };
      rot = u * 2;
    }
    basketball(c, ball.x, ball.y, BALL_R, rot, { dark: true });
    const sw = t >= T ? Math.exp(-(t - T) / 0.4) : 0;
    drawHoop(c, HOOP, 'front', { line: rgba('bone', 0.5), glass: '', pole: '', swish: sw, t });
  }

  /** 記分板：比分與計時器（七段顯示器）、主打留言（一個字一個字打出來、寫完署名淡入）。球進的那一下外框亮一圈。 */
  private drawBoard(c: CanvasRenderingContext2D, t: number, hit: number) {
    const B = this.board, n = this.note, { R, T } = this;
    const s = this.ctx.start;
    const on = prog(t, s + 0.1, s + 0.5, ease.outCubic);
    c.save();
    c.globalAlpha = on;
    const clock = t < R ? 3 : t < T ? 3 * (1 - (t - R) / (T - R)) : 0;
    const off = rgba('bone', 0.04);
    const home = t >= T ? 100 : 97;
    // 主隊（我們這隊）的比分用隊色金黃，反超那一下亮一點；客隊用灰白
    seg7(c, String(home), B.x + 7 + B.w * 0.15, B.y + ROW - 13, 30, teamRgba('gold', t >= T ? 0.88 : 0.75), off, 'center');
    seg7(c, '99', B.x + B.w * 0.85 - 7, B.y + ROW - 13, 30, rgba('bone', 0.6), off, 'center');
    const tenths = Math.ceil(clock * 10 - 1e-6) / 10;
    seg7(c, `0:0${tenths.toFixed(1)}`, B.x + B.w / 2, B.y + ROW - 32, 30, rgba(t >= T ? 'ember' : 'signal', t >= T ? 0.6 + 0.4 * (Math.floor(t * 4) % 2) : 0.95), off, 'center');
    if (n) {
      const total = msgChars(n.fit);
      const per = clamp(1.4 / Math.max(1, total), 0.025, 0.09);
      const done = this.msgT0 + total * per;
      const top = B.y + PAD.top, hh = B.h - PAD.top - PAD.bottom;
      drawNote(c, n, B.x + PAD.x, top + Math.max(0, (hh - n.height) * 0.42), {
        chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('bone', 0.97) : rgba('ash', 0.85), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5),
      });
    }
    c.restore();
    // 球進的那一下：外框亮一圈（訊號色，很快退掉）
    if (hit > 0.02) {
      c.save();
      c.strokeStyle = rgba('signal', 0.8 * hit);
      c.lineWidth = 3;
      c.strokeRect(B.x - 6, B.y - 6, B.w + 12, B.h + 12);
      c.restore();
    }
  }
}
