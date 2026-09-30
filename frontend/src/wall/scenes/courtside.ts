// 場邊看球（暗、hoops）：夜裡的室內球場，宣文和孟庭穿著自己設計的 A&O 情侶球衣（寶藍配金黃、背號宣文 420／孟庭 87）坐在場邊第一排，
// 孟庭抱著一桶爆米花。角色是 Codex 畫的紙偶（_puppet.ts、素材組 hoops）；球員、觀眾是程式畫的剪影（_c8.ts，不畫真實球隊與聯盟）。
//  - 球場在右邊：六個剪影球員照拍子跑位（一拍兩步），持球的那個一拍運一下球（球在拍點落地）。
//    每兩小節一次快攻：小節線上灌籃（跳到最高點剛好把球塞進籃框），網子往下甩；場館大螢幕上的比分 +2。
//  - 兩個人：平常坐著看球、跟著拍子點頭；每小節第三拍宣文丟一顆爆米花進嘴裡、孟庭往前傾（sit_2）；
//    灌籃的那一拍兩人從座位上跳起來歡呼（cheer），孟庭把爆米花桶舉高，爆米花噴出來（程式畫的，受重力掉下來），落地壓扁回彈，兩拍後坐回去。
//    後面看台的觀眾剪影跟著拍子晃，進球時一起站起來舉手。
//  - **焦點是主打留言**：寫在吊在球場上方的場館大螢幕上（有厚度、吊纜、底下一圈 LED），第一拍起一個字一個字打出來；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、螢幕最大 820 × 400，寬高跟著留言。螢幕上只有一行小小的比分。沒有留言時寫邀請。
//  - 歌詞跑在看台前緣那條環場 LED 帶上（lyricOnPath，逐字跟唱），比留言小一級。
//  - 光線：場館的燈從上面打下來，球場中間一團暖光；紙偶上亮下暗（puppetLight），白襪、白 T 不會比留言還亮。
//    鏡頭整個窗格慢慢推近兩個人，灌籃時畫面輕輕一震。右下角 HUD：只有地板，球員不會跑進去。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, pulse } from '../engine/util';
import { lyricAt, lyricSubOf, subSizeFor, subGap, barAfter, beatAfter, msgChars } from './_motifs';
import { lyricOnPath, drawNote, type Note } from './_couple';
import { loadPuppets, drawPick, pick, puppetPoint, puppetShadow, puppetIn, puppetLight, jumpArc, breathe, beatKick, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { drawPlayer, playerPose, makeCrowd, CrowdLayer, basketball, drawHoop, popcorn, seats, sine01, crowdShade, lyricRows, teamRgba, TEAM_TAG, jumbotronShell, ledBand, scanPattern, type Hoop, type Pt, type PlayerPose } from './_c8';

export const spec: PlateSpecDecl = { group: 'couple', family: 'hoops', paper: false, energy: [0.45, 1], bars: [4, 8] };

/** 兩個人：左下角的場邊座位（腳踩的地面 y、場景尺度 = 宣文站直的身高）。 */
const CX = 380, GROUND = 992, SZ = 470;
/** 坐姿圖要縮多少才跟站姿（歡呼）一樣大（量兩張圖裡宣文的頭）。 */
const SEAT_K = 0.88;
/** 球場：球員的腳底在 COURT_Y0（遠）～COURT_Y1（近）之間；籃框在右邊（籃板在籃框右邊）。 */
const COURT_Y0 = 772, COURT_Y1 = 826;
const HOOP: Hoop = { x: 1598, y: 452, d: 54, side: 1, floor: 792 };
/** 場館大螢幕（主打留言）：最大範圍（標準 v2：寬 ≤ 860、高 ≤ 430）、中心 x、上緣；寫字的內距（上面留一條比分）。 */
const JUMBO = { cx: 1090, top: 58, w: 820, h: 360 };
const PAD = { x: 46, top: 74, bottom: 34 };
/** 環場 LED 帶（歌詞）：y 範圍與歌詞沿著的線（太長的句子折兩排時整段往上挪，兩排都在帶子裡）。 */
const RIBBON = { x0: 640, x1: W + 20, y0: 466, y1: 580, lx0: 670, lx1: 1520, base: 538, base2: 514 };
/** 韓文歌時 LED 帶往上長多少（px）。 */
const KO_UP = 64;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const LABEL = 'FAN CAM · 場邊祝福';
const POSES = ['cp_hoops_sit_1', 'cp_hoops_sit_2', 'cp_hoops_cheer'];
/** 球員：跟隊伍中心的距離、深度（0 遠 1 近）、跑步相位差。0 號持球灌籃、3 號是防守的。 */
const TEAM = [
  { off: 0, v: 0.7, ph: 0 },
  { off: -170, v: 0.15, ph: 1.3 },
  { off: -300, v: 0.9, ph: 2.1 },
  { off: 95, v: 0.35, ph: 0.6 },
  { off: -70, v: 1, ph: 2.9 },
  { off: -235, v: 0.05, ph: 1.8 },
];
const BALL_R = 11;

/**
 * 場館：很暗的底、天花板的燈打下來的幾道很淡的光束、球場中間一團暖光（地板上有反光）、看台往上越來越暗。
 * 用 shader 算（浮點＋一點點抖色）：Canvas2D 的淡漸層只有幾個 8 位元的階，大螢幕上會看到一圈一圈的。
 */
const ARENA = () => new FSPass(/* glsl */ `
  uniform float flash;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float floorK = smoothstep(${COURT_Y0 - 30}.0, ${COURT_Y0 + 10}.0, p.y);
    // 看台：往上越暗，中間被場燈照到一點
    vec2 q = (p - vec2(1180.0, 520.0)) / vec2(1100.0, 520.0);
    float stands = exp(-dot(q, q) * 1.6) * (1.0 - floorK);
    // 光束：從天花板斜斜打下來的四道，很淡
    float beams = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float x0 = 760.0 + fi * 300.0, tilt = (fi - 1.5) * 0.18;
      float d = abs(p.x - (x0 + (p.y - 0.0) * tilt)) / (40.0 + p.y * 0.12);
      beams += exp(-d * d * 2.0) * smoothstep(${COURT_Y0 + 20}.0, 0.0, p.y) * 0.5;
    }
    // 地板：暖一點的木頭色，球場中間一團光、近處的反光
    vec2 f = (p - vec2(1150.0, 820.0)) / vec2(760.0, 170.0);
    float pool = exp(-dot(f, f) * 1.4);
    vec3 wood = C_INK2 + C_BLOOD * 0.05;
    vec3 col = mix(C_INK, wood, floorK) + C_BONE * (0.02 * stands + 0.006 * beams) + (C_BLOOD * 0.09 + C_BONE * 0.02) * pool * floorK;
    col += C_BONE * 0.025 * flash;
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { flash: { value: 0 } });

export default class Courtside extends Scene {
  arena = shared('courtside.arena', ARENA);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 不會動、但要蓋在觀眾前面的東西（大螢幕的殼、LED 帶、籃板與柱子）：init 畫好，每格貼一次。 */
  mid = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  scores: number[] = [];
  keys: [number, string][] = [];
  crowd: CrowdLayer | null = null;
  note: Note | null = null;
  jumbo = { x: JUMBO.cx - JUMBO.w / 2, y: JUMBO.top, w: JUMBO.w, h: JUMBO.h };
  lyricSize = 52;
  /** 環場 LED 帶：韓文歌（沒有留言、有原文）時往上長 KO_UP，中文與原文兩段都在帶子上（蓋住最前排的觀眾，像更高的廣告看板）。 */
  rib: typeof RIBBON = RIBBON;
  msgT0 = 0;
  /** 灌籃：腳底離籃框中心多遠（x）、跳多高，手才剛好碰到籃框。 */
  dunk = { x: 0, lift: 0 };
  scan: CanvasPattern | null = null;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客新人留言0123456789' + INVITE + LABEL + 'A&O GUEST · ♥');
    this.track(await loadPuppets(POSES));
    // 進球：開場一小段之後的小節線，之後每兩小節一次（窗格太短就在下一拍）
    let T = barAfter(au, s + 1.6);
    if (T > e - 1.0) T = beatAfter(au, s + 1.1);
    for (let k = 0; k < 10 && T < e - 0.7; k++) {
      this.scores.push(T);
      T = au.timeOfBar(Math.round(au.barAt(T)) + 2);
    }
    // 兩個人的姿勢時間軸：平常坐著（sit_1）；每小節第三拍吃爆米花（sit_2，一拍）；進球前一拍往前傾；進球那一拍跳起來歡呼，兩拍後坐回去
    const ks: [number, string][] = [[-1e9, 'cp_hoops_sit_1']];
    const busy = (t: number) => this.scores.some((S) => t > S - au.beatPeriod(S) * 1.6 && t < S + au.beatPeriod(S) * 2.6);
    for (let b = Math.ceil(au.barAt(s)) - 1; au.timeOfBar(b) < e; b++) {
      const t3 = au.timeOfBeat(Math.round(au.beatAt(au.timeOfBar(b))) + 2);
      if (t3 > s + 0.6 && !busy(t3)) ks.push([t3, 'cp_hoops_sit_2'], [t3 + au.beatPeriod(t3) * 0.9, 'cp_hoops_sit_1']);
    }
    for (const S of this.scores) {
      const bp = au.beatPeriod(S);
      ks.push([S - bp, 'cp_hoops_sit_2'], [S, 'cp_hoops_cheer'], [S + bp * 2.3, 'cp_hoops_sit_1']);
    }
    this.keys = ks.sort((a, b) => a[0] - b[0]);
    // 灌籃的位置：跳到最高時手剛好在籃框上方一點（剪影的手的位置照 _c8 的骨架算）
    const h0 = lerp(182, 214, TEAM[0]!.v);
    const hand = playerPose(0, 0, { h: h0, pose: 'jump', fill: '' }).hand;
    this.dunk = { x: -8 - hand.x, lift: this.floorOf(0) - (HOOP.y - 16 - hand.y) };
    // 看台上的觀眾（大螢幕、籃板擋住的地方照樣排：觀眾畫在最後面，會被蓋住）
    // 大螢幕上的留言：標準 v2 的字級；螢幕的寬高跟著留言
    const c = this.fg.ctx;
    const w = JUMBO.w - PAD.x * 2, hmax = JUMBO.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const jh = Math.min(JUMBO.h, Math.max(230, PAD.top + this.note.height + PAD.bottom + 14));
    // 最窄也要放得下上面那一排比分（A&O 101 · FAN CAM · 97 GUEST）
    const jw = Math.min(JUMBO.w, tightenNote(c, this.note, 640) + PAD.x * 2);
    this.jumbo = { x: JUMBO.cx - jw / 2, y: JUMBO.top, w: jw, h: jh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    if (!this.msg && this.ctx.lyrics.linesIn(s - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l))) this.rib = { ...RIBBON, y0: RIBBON.y0 - KO_UP };
    this.msgT0 = beatAfter(au, s + 0.35);
    this.scan = scanPattern(c);
    this.crowd = new CrowdLayer(makeCrowd(-20, W + 20, 440, 8, { r: 9, gap: 40, rowH: 38, shrink: 0.94, seed: 5, skip: (x, y) => x < 610 && y > 380 }), (cc) => crowdShade(cc, 150, 470), rgba('bone', 0.04), SCALE);
    this.drawBackground();
    this.drawMid();
  }

  /** 第 i 個球員的腳底 y（深度：遠的高、近的低）。 */
  private floorOf(i: number) { return lerp(COURT_Y0, COURT_Y1, TEAM[i]!.v); }

  /** 不會動的：地板的場線、場邊的座椅（兩個人後面）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 場線：遠的邊線、罰球區（右邊，透視壓扁）、中線；很淡
    c.strokeStyle = rgba('bone', 0.1);
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(560, COURT_Y0 - 14); c.lineTo(1880, COURT_Y0 - 14);
    c.moveTo(430, 948); c.lineTo(1350, 948);
    c.moveTo(900, COURT_Y0 - 14); c.lineTo(860, 948);
    c.stroke();
    c.beginPath();
    c.moveTo(1420, COURT_Y0 - 14); c.lineTo(1400, 900); c.lineTo(1360, 900);
    c.moveTo(1400, 858); c.ellipse(1400, 858, 150, 34, 0, Math.PI * 0.5, Math.PI * 1.5);
    c.stroke();
    // 中圈（透視的橢圓，只露出一段）
    c.beginPath(); c.ellipse(880, 860, 190, 42, 0, 0, Math.PI * 2); c.stroke();
    // 場邊的座椅：兩個人坐在中間兩張，旁邊空著
    const step = SZ * 0.38;
    const xs = [-2, -1, 0, 1, 2].map((k) => CX - SZ * 0.19 + k * step);
    seats(c, xs, GROUND - 8, SZ * 0.9, { fill: mixRgba('ink', 'ink2', 0.7), edge: rgba('bone', 0.08) });
    // 座位前面那條地面的線
    c.fillStyle = rgba('ink', 0.5);
    c.fillRect(0, GROUND + 18, 760, H - GROUND - 18);
    L.upload();
  }

  /** 大螢幕的殼、環場 LED 帶、籃板與柱子（畫在一張備用的層，每格貼到 fg 上：觀眾在它們後面）。 */
  private drawMid() {
    const L = this.mid, c = L.ctx;
    L.clear();
    // 環場 LED 帶
    const R = this.rib;
    ledBand(c, { x: R.x0, y: R.y0, w: R.x1 - R.x0, h: R.y1 - R.y0 });
    // 籃板、柱子、籃框後半圈（網與前半圈每格畫：進球時會甩）
    drawHoop(c, HOOP, 'back', { line: rgba('bone', 0.5), glass: rgba('bone', 0.08), pole: mixRgba('ink2', 'bone', 0.06) });
    // 大螢幕：兩條吊纜、有厚度的殼、螢幕面
    const J = this.jumbo;
    jumbotronShell(c, J);
    // 螢幕上緣的比分條：一條細線隔開
    c.fillStyle = rgba('bone', 0.08);
    c.fillRect(J.x + 20, J.y + 44, J.w - 40, 1);
  }

  /** 隊伍中心 x：開場從中場往籃框推進，每次進球後退回中場、再推進到下一次進球。 */
  private packX(t: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const X_BACK = 960, X_ATK = HOOP.x + this.dunk.x - 120;
    let prev = s - 0.5;
    for (const S of this.scores) {
      const air = this.airOf(S);
      const take = S - air * 0.55;
      if (t < take) {
        const ret1 = prev < s ? s - 0.5 : prev + 0.5 + Math.min(au.beatPeriod(S) * 3, (take - prev) * 0.42);
        if (prev >= s && t < ret1) return lerp(X_ATK, X_BACK, sine01((t - prev - 0.5) / Math.max(0.1, ret1 - prev - 0.5)));
        return lerp(X_BACK, X_ATK, sine01((t - ret1) / Math.max(0.2, take - ret1)));
      }
      prev = S;
    }
    if (prev < s) return lerp(X_BACK, X_ATK, sine01((t - s) / 6));
    return lerp(X_ATK, X_BACK, sine01((t - prev - 0.5) / (au.beatPeriod(prev) * 3)));
  }

  private airOf(S: number) { return clamp(this.ctx.audio.beatPeriod(S) * 1.25, 0.5, 0.8); }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    let hit = 0;
    for (const S of this.scores) hit = Math.max(hit, pulse(t, S, 0.25));
    this.arena.u.flash!.value = hit;
    this.arena.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;

    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    let lift = 0, squash = breathe(t, 0.008, 3.3) + 0.018 * beatKick(au, t, 0.25);
    let burst: number | null = null;
    for (const S of this.scores) {
      const air = Math.min(0.55, bp * 1.1);
      if (t > S - 0.15 && t < S + air + 0.4) {
        const j = jumpArc(t, S, S + air, 64, { crouch: 0.08, land: 0.14 });
        lift = -j.y; squash = j.squash;
      }
      if (t >= S) burst = S;
    }
    const ent = puppetIn(t, s + 0.05, 0.5);
    // Codex 畫的坐姿比站姿大一號（頭大了一成多）：坐著的兩張縮回來，跳起來時兩個人才不會突然變小
    const seated = pick(this.keys, t).startsWith('cp_hoops_sit');
    const o: PuppetOpts = { h: SZ, squash, spin: ent.spin, alpha: ent.alpha, pivot: 0.3, scale: seated ? SEAT_K : 1 };
    if (ent.alpha > 0) {
      puppetShadow(c, 'cp', CX, GROUND, { h: SZ, lift, alpha: 0.75 * ent.alpha, wide: 1.05, color: '0,0,0' });
      drawPick(c, this.keys, t, CX, GROUND - lift, o);
      // 場燈從上面打下來：上亮下暗（白襪、球鞋不要比螢幕上的字還亮）
      puppetLight(c, [CX - 330, GROUND - SZ * 1.5, 660, SZ * 1.5 + 40], rgba('ink', 0.1), rgba('ink', 0.5));
    }

    // ---- 大螢幕的殼、LED 帶、籃板（蓋在觀眾前面）
    c.drawImage(this.mid.canvas, 0, 0, W, H);
    this.drawScreen(c, t, hit);
    this.drawRibbon(c, t);

    // ---- 球員、球、網
    this.drawCourt(c, t);

    // ---- 爆米花（進球時從桶子噴出來）
    if (burst !== null && t - burst < 1.6) {
      const air = Math.min(0.55, bp * 1.1);
      const j = jumpArc(burst + air * 0.3, burst, burst + air, 64);
      const src = puppetPoint('cp_hoops_cheer', 'bucket', CX, GROUND + j.y, { ...o, squash: 0 }) ?? { x: CX + 90, y: GROUND - SZ * 1.2 };
      popcorn(c, src, burst + air * 0.3, t, { n: 28, floor: GROUND + 20, speed: 640, seed: 7 });
    }

    // ---- 看台的觀眾：畫在這一層所有東西的後面（destination-over），跟著拍子晃、進球時站起來
    let cheer = 0;
    for (const S of this.scores) cheer = Math.max(cheer, prog(t, S, S + 0.15) * (1 - prog(t, S + bp * 1.5, S + bp * 3.5)));
    c.save();
    c.globalCompositeOperation = 'destination-over';
    this.crowd?.draw(c, { bounce: beatKick(au, t, 0.3), cheer, t });
    c.restore();

    comp.draw(renderer, L.upload(), out);
    // 鏡頭：整個窗格慢慢推近兩個人；灌籃的那一下畫面輕輕一震
    const push = ease.inOutCubic(f.p);
    return {
      bloom: 0.6, vignette: 0.55, zoom: 1 + 0.03 * push,
      shake: [-(CX - W / 2) * 0.03 * push, -(GROUND - 300 - H / 2) * 0.03 * push + 5 * hit],
    };
  }

  /** 球場：六個剪影照拍子跑位，持球的運球（拍點落地），進球那一拍灌籃，網子往下甩。 */
  private drawCourt(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const beat = au.beatAt(t), bp = au.beatPeriod(t);
    const px = this.packX(t), vx = (this.packX(t + 0.05) - px) / 0.05;
    const fill = mixRgba('ink', 'ink2', 0.5), rim = rgba('bone', 0.08);
    // 這一格：灌籃中？
    let dunkS: number | null = null;
    for (const S of this.scores) { const air = this.airOf(S); if (t > S - air * 0.55 - 0.1 && t < S + bp * 2.4) dunkS = S; }
    let ball: Pt | null = null, ballRot = t * 1.2;
    const order = TEAM.map((m, i) => ({ ...m, i })).sort((a, b) => a.v - b.v); // 遠的先畫
    for (const m of order) {
      const i = m.i, h = lerp(182, 214, m.v), fy = this.floorOf(i);
      let x = px + m.off + Math.sin(t * 1.3 + m.ph) * 16, y = fy;
      let pose: PlayerPose = Math.abs(vx) > 60 ? 'run' : 'stand';
      let flip = vx < -20;
      // 停下來的時候：防守的（3～5 號）面向持球的人壓低、隊友進球後舉手
      if (i >= 3 && Math.abs(vx) < 150 && !flip) { pose = 'defend'; flip = true; }
      if ((i === 1 || i === 2) && pose === 'stand' && dunkS !== null && t > dunkS) pose = 'cheer';
      // 被灌籃的一方：垂頭站著
      let lean = 0;
      if (i >= 3 && dunkS !== null && t > dunkS && Math.abs(vx) < 150) { pose = 'stand'; lean = 0.22; }
      if (i === 0 && pose === 'run' && !flip) pose = 'dribble';
      if (i === 0 && dunkS !== null) {
        // 灌籃：起跳 → 最高點（進球的拍點）手在籃框上 → 落地、原地歡呼
        const air = this.airOf(dunkS), take = dunkS - air * 0.55, land = dunkS + air * 0.45;
        const j = jumpArc(t, take, land, this.dunk.lift, { crouch: 0.1, land: 0.12 });
        const xd = HOOP.x + this.dunk.x;
        x = lerp(xd - 120, xd + 20, sine01((t - take) / (land - take)));
        y = fy + j.y;
        pose = j.air ? 'jump' : t < take ? 'dribble' : 'cheer';
        flip = false;
      }
      // 右下角 HUD 前面不站人
      if (x > 1340) y = Math.min(y, 824);
      const r = drawPlayer(c, x, y, { h, pose, ph: beat * Math.PI * 2 + m.ph, flip, fill, rim, lean });
      if (i === 0) {
        if (dunkS !== null && t >= dunkS) {
          // 進了：從籃框掉下來、彈兩下
          const u = t - dunkS;
          const g = 1800, fall = Math.sqrt((2 * (fy - BALL_R - HOOP.y)) / g);
          let by: number;
          if (u < fall) by = HOOP.y + 0.5 * g * u * u;
          else { const u2 = u - fall, v0 = g * fall * 0.45; by = fy - BALL_R - Math.max(0, v0 * u2 - 0.5 * g * u2 * u2); }
          ball = { x: HOOP.x - 4 - Math.max(0, u - fall) * 60, y: by };
          ballRot = u * 2;
        } else if (pose === 'jump') ball = { x: r.hand.x, y: r.hand.y - BALL_R * 0.4 };
        else if (pose === 'dribble' || pose === 'run') {
          // 運球：拍點上落地、半拍回到手上
          const ph = beat - Math.floor(beat);
          const k = Math.pow(Math.sin(Math.PI * ph), 0.7);
          ball = { x: r.hand.x + 6, y: lerp(fy - BALL_R, r.hand.y + BALL_R, k) };
        }
      }
    }
    // 網與籃框前半圈（在球前面），進球時往下甩
    let sw = 0;
    for (const S of this.scores) sw = Math.max(sw, t >= S ? Math.exp(-(t - S) / 0.35) : 0);
    if (ball) basketball(c, ball.x, ball.y, BALL_R, ballRot, { dark: true });
    drawHoop(c, HOOP, 'front', { line: rgba('bone', 0.5), glass: '', pole: '', swish: sw, t });
  }

  /** 大螢幕：比分條（進球時 +2 翻一下）、主打留言一個字一個字打出來、署名；掃描線蓋在字上面。開場時螢幕由上往下亮起來。 */
  private drawScreen(c: CanvasRenderingContext2D, t: number, hit: number) {
    const J = this.jumbo, n = this.note;
    const s = this.ctx.start;
    const on = prog(t, s + 0.1, s + 0.55, ease.outCubic);
    c.save();
    c.beginPath(); c.rect(J.x, J.y, J.w, J.h * on); c.clip();
    // 比分：A&O 每進一球 +2
    let pts = 99;
    for (const S of this.scores) if (t >= S) pts += 2;
    c.font = font(F.mono(500), 20);
    c.letterSpacing = '3px';
    // 主隊（我們這隊）用隊色的金黃，客隊灰
    c.fillStyle = teamRgba('gold', 0.8);
    c.textAlign = 'left';
    c.fillText(`${TEAM_TAG.name} ${pts}`, J.x + PAD.x, J.y + 31);
    c.fillStyle = rgba('ash', 0.7);
    c.textAlign = 'right';
    c.fillText('97 GUEST', J.x + J.w - PAD.x, J.y + 31);
    c.textAlign = 'center';
    c.font = font(F.hei(500), 17);
    c.fillStyle = rgba(hit > 0.05 ? 'signal' : 'ash', hit > 0.05 ? 0.9 : 0.5);
    c.fillText(this.msg?.couple ? '新人留言' : LABEL, J.x + J.w / 2, J.y + 30);
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    if (n) {
      const total = msgChars(n.fit);
      const per = clamp(1.4 / Math.max(1, total), 0.025, 0.09);
      const done = this.msgT0 + total * per;
      const top = J.y + PAD.top, hh = J.h - PAD.top - PAD.bottom;
      drawNote(c, n, J.x + PAD.x, top + Math.max(0, (hh - n.height) * 0.45), {
        chars: this.msg ? (t - this.msgT0) / per : Infinity, color: this.msg ? rgba('bone', 0.97) : rgba('ash', 0.85), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5),
      });
    }
    if (this.scan) { c.fillStyle = this.scan; c.fillRect(J.x, J.y, J.w, J.h); }
    // 亮起來的那條掃描光
    if (on < 1) { c.fillStyle = rgba('bone', 0.5 * (1 - on)); c.fillRect(J.x, J.y + J.h * on - 2, J.w, 3); }
    c.restore();
    // 螢幕底面的一圈 LED（隊色）：平常是暗暗的寶藍，一格金黃跟著八分音符走；我們進球時整圈亮成金黃
    const au = this.ctx.audio;
    const step = Math.floor(au.beatAt(t) * 2);
    const y = J.y + J.h + 20, n2 = Math.floor((J.w - 20) / 14);
    for (let k = 0; k < n2; k++) {
      const runner = (k + step) % 8 === 0;
      c.fillStyle = hit > 0.05 ? teamRgba('gold', 0.4 + 0.45 * hit) : runner ? teamRgba('gold', 0.6) : teamRgba('blue', 0.55);
      c.fillRect(J.x + 10 + k * 14, y, 7, 3);
    }
  }

  /** 環場 LED 帶上的歌詞（逐字跟唱）；沒有歌詞時慢慢捲一排很淡的隊名與背號（隊色金黃）。 */
  private drawRibbon(c: CanvasRenderingContext2D, t: number) {
    const R = this.rib, s = this.ctx.start;
    const ly = lyricAt(this.ctx.lyrics, t);
    const rv = prog(t, s + 0.1, s + 0.6, ease.inOutCubic);
    const tall = R.y0 < RIBBON.y0;
    if (ly) {
      const family = F.archivo(100, 700);
      const two = lyricRows(c, ly.line.text, family, this.lyricSize, 40, R.lx1 - R.lx0) === 2;
      let y = two ? R.base2 : R.base;
      if (tall) {
        // 長高的帶子：中文（一或兩排）＋原文（lyricOnPath 自動畫在下面，一或兩排）整塊在帶子裡垂直置中
        const sub = lyricSubOf(ly.line), ms = two ? 40 : this.lyricSize, ss = subSizeFor(ms);
        let span = two ? ms * 1.1 : 0, bottom = ms * 0.2;
        if (sub) {
          span += subGap(ms, ss) + (lyricRows(c, sub.text, family, ss, Math.min(ss, 26), R.lx1 - R.lx0) - 1) * ss * 1.1;
          bottom = ss * 0.2;
        }
        y = (R.y0 + R.y1) / 2 - (ms * 0.8 + span + bottom) / 2 + ms * 0.8;
      }
      lyricOnPath(c, ly.line, t, [{ x: R.lx0, y }, { x: R.lx1, y }], {
        family, size: this.lyricSize, minSize: 40, alpha: ly.k * rv, unsung: rgba('bone', 0.24), sung: rgba('bone', 0.9), rowGap: 1.1,
      });
    }
    const idle = 1 - (ly ? ly.k : 0);
    if (idle > 0.02) {
      c.save();
      c.beginPath(); c.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); c.clip();
      c.font = font(F.mono(600), 24);
      c.letterSpacing = '10px';
      c.fillStyle = teamRgba('gold', 0.24 * idle * rv);
      const unit = `${TEAM_TAG.name} ♥ ${TEAM_TAG.xw} · ${TEAM_TAG.mt}   `;
      const uw = c.measureText(unit).width;
      const off = -((t * 60) % uw);
      for (let x = R.x0 + off; x < R.x1; x += uw) c.fillText(unit, x, tall ? (R.y0 + R.y1) / 2 + 8 : R.base - 6);
      c.letterSpacing = '0px';
      c.restore();
    }
  }
}
