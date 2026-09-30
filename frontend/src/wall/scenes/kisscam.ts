// 親親鏡頭（暗、hoops）：比賽暫停，場館的燈暗下來，大螢幕上跳出「KISS CAM」——鏡頭在觀眾席裡找來找去，
// 小節線上框到穿著 A&O 情侶球衣（寶藍配金黃，背號 420／87）的宣文和孟庭。角色是 Codex 畫的雙人紙偶（cp_hoops_kiss_1～3，_puppet.ts、素材組 hoops）。
//  - 同一組紙偶畫兩次：左邊大螢幕裡的「轉播畫面」（大、只拍到上半身，攝影師跟著動作推近拉遠），和右邊看台上真的兩個人（小、被追光打亮）。
//  - 時間軸（每個動作落在小節線，窗格短就兩拍一個）：開場大螢幕在觀眾席裡找（剪影一排排滑過去，一顆虛線愛心框晃來晃去）、
//    右邊的追光在看台上掃 → 小節線：畫面切到兩個人、愛心框「碰」一下縮進來、追光停在他們身上，兩人發現自己上了大螢幕（kiss_1）→
//    下一個小節：孟庭害羞捧臉、宣文在頭上比大愛心（kiss_2）→ 再下一個：宣文親孟庭的臉頰（kiss_3），愛心往上飄、全場觀眾剪影站起來歡呼 → 之後 2、3 輪流。
//  - **焦點是主打留言**：大螢幕下方的 LED 字幕板，一行一行像跑馬燈從右邊跑進來、停住，寫完署名淡入；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、板子最大 860 × 330，寬高跟著留言，放在左下。沒有留言時寫邀請。
//  - 歌詞跑在最上面那條環場 LED 帶（lyricOnPath，逐字跟唱），比留言小一級。
//  - 光：暫停時場燈暗、大螢幕的光照在前幾排；一道追光從天花板打下來。轉播畫面壓暗一點、蓋掃描線，才不會比字幕板上的字還搶眼。
//  - 右下角 HUD：看台在那裡是暗的欄杆與走道，不放人、不放字。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, barAfter, beatAfter, drawHeart, heartPoints, fillWithHearts, signature, lyricSubOf } from './_motifs';
import { lyricOnPath, type Note } from './_couple';
import { loadPuppets, drawPick, pick, puppetShadow, puppetIn, puppetLight, breathe, beatKick, landSquash, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';
import { makeCrowd, drawCrowd, CrowdLayer, crowdShade, jumbotronShell, ledBand, scanPattern, type Fan, type Box } from './_c8';

export const spec: PlateSpecDecl = { group: 'couple', family: 'hoops', paper: false, energy: [0.3, 0.9], bars: [4, 8] };

/** 大螢幕的螢幕面（轉播畫面）。 */
const SCREEN: Box = { x: 130, y: 196, w: 940, h: 416 };
/** 字幕板（主打留言）：左上角固定在大螢幕下面，最大寬高（標準 v2），寫字的內距。 */
const BOARD = { x: 130, y: 654, w: 860, h: 330 };
const PAD = { x: 40, top: 46, bottom: 24 };
/** 最上面的環場 LED 帶（歌詞）。 */
const BAND = { y0: 92, y1: 160, base: 143, lx0: 230, lx1: 1690 };
/**
 * 有韓文原文的窗格：LED 帶往上、往下各加寬一點（下緣貼到大螢幕外框上緣 182），中文縮到 40、原文跑在中文下面；
 * 中文的字頂還是離畫面上緣約 96 px，原文的字腳停在外框上面。
 */
const BAND_SUB = { ...BAND, y0: 86, y1: 182, base: 131 };
const LYR_SUB = 40;
/** 看台上真的兩個人：腳底、場景尺度（宣文站直的身高）。 */
const RX = 1530, RG = 790, SZ = 330;
/** 坐著的時候頭頂離腳底幾倍身高（Codex 的坐姿圖量的）：轉播畫面照這個取景。 */
const SEAT_HEAD = 0.83;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const LABEL = 'KISS CAM ♥ 場邊留言';
const POSES = ['cp_hoops_sit_1', 'cp_hoops_kiss_1', 'cp_hoops_kiss_2', 'cp_hoops_kiss_3'];
/** 轉播畫面的取景：每個姿勢的大小（場景尺度）與頭頂的高度（離螢幕上緣）；換姿勢時攝影師慢慢推過去。 */
const FRAME: Record<string, { sz: number; head: number }> = {
  cp_hoops_sit_1: { sz: 600, head: 80 },
  cp_hoops_kiss_1: { sz: 600, head: 80 },
  cp_hoops_kiss_2: { sz: 520, head: 150 },
  cp_hoops_kiss_3: { sz: 690, head: 64 },
};

/**
 * 暫停時的場館：很暗；大螢幕的光照在它前面幾排（一團冷白）、追光從天花板斜斜打到兩個人身上（一道很淡的光柱＋腳邊一圈光）。
 * 用 shader 算（浮點＋抖色），淡漸層才不會一圈一圈的。
 */
const ARENA = () => new FSPass(/* glsl */ `
  uniform vec3 spot;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = (p - vec2(${SCREEN.x + SCREEN.w / 2}.0, ${SCREEN.y + SCREEN.h / 2}.0)) / vec2(900.0, 560.0);
    float screenGlow = exp(-dot(q, q) * 1.5);
    // 追光的光柱：從天花板 (1720, 0) 到 spot.xy
    vec2 a = vec2(1720.0, -40.0), b = spot.xy;
    vec2 ab = b - a; float u = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    float d = length(p - (a + ab * u)) / mix(30.0, 190.0, u);
    float beam = exp(-d * d * 1.6) * u * spot.z;
    vec2 r = (p - spot.xy) / vec2(230.0, 250.0);
    float pool = exp(-dot(r, r) * 1.8) * spot.z;
    vec3 col = C_INK + C_BONE * (0.018 * screenGlow + 0.012 * beam + 0.03 * pool) + C_SIGNAL * 0.01 * pool;
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { spot: { value: new THREE.Vector3(0, 0, 0) } });

export default class Kisscam extends Scene {
  arena = shared('kisscam.arena', ARENA);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 大螢幕的殼、LED 帶、字幕板的底（init 畫好，每格貼到 fg：觀眾在它們後面）。 */
  mid = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  /** 這一格有沒有韓文原文副行（建構時就看：引擎只在建立這一格之前設好開關）。 */
  band = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).some((l) => !!lyricSubOf(l)) ? BAND_SUB : BAND;
  /** 找到兩個人的小節線（之前是在觀眾席裡找）。 */
  found = 0;
  keys: [number, string][] = [];
  /** 親臉頰的時間點（愛心往上飄、觀眾歡呼）。 */
  kisses: number[] = [];
  crowd: CrowdLayer | null = null;
  feedFans: Fan[] = [];
  note: Note | null = null;
  board = { ...BOARD };
  lyricSize = 52;
  msgT0 = 0;
  scan: CanvasPattern | null = null;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    await loadText('一位賓客新人留言LIVE' + INVITE + LABEL);
    this.track(await loadPuppets(POSES));
    // 找到的那一刻：開場一小段之後的小節線（窗格太短就在下一拍）；之後每小節（短窗格每兩拍）換一個動作
    let T = barAfter(au, s + 1.3);
    if (T > e - 1.4) T = beatAfter(au, s + 0.9);
    this.found = T;
    const barLen = au.timeOfBar(Math.round(au.barAt(T)) + 1) - T;
    const byBar = e - T > barLen * 2.4;
    const next = (t: number) => (byBar ? au.timeOfBar(Math.round(au.barAt(t)) + 1) : au.timeOfBeat(Math.round(au.beatAt(t)) + 2));
    const ks: [number, string][] = [[-1e9, 'cp_hoops_sit_1'], [T, 'cp_hoops_kiss_1']];
    for (let k = 0, t = next(T); t < e - 0.2 && k < 20; k++, t = next(t)) {
      const name = k % 2 ? 'cp_hoops_kiss_3' : 'cp_hoops_kiss_2';
      ks.push([t, name]);
      if (name === 'cp_hoops_kiss_3') this.kisses.push(t);
    }
    this.keys = ks;
    // 看台上的觀眾：兩個人那一區留空（他們坐第一排，前面是欄杆）
    // 轉播畫面裡的觀眾（找人的時候滑過去；找到之後在兩個人後面、很暗）
    this.feedFans = makeCrowd(SCREEN.x - 400, SCREEN.x + SCREEN.w + 400, SCREEN.y + SCREEN.h - 70, 4, { r: 44, gap: 150, rowH: 120, shrink: 0.88, seed: 4 });
    // 字幕板上的留言：標準 v2；板子的寬高跟著留言
    const c = this.fg.ctx;
    const w = BOARD.w - PAD.x * 2, hmax = BOARD.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.5, { max: 44 });
    const bh = Math.min(BOARD.h, Math.max(170, PAD.top + this.note.height + PAD.bottom + 10));
    const bw = Math.min(BOARD.w, tightenNote(c, this.note, 440) + PAD.x * 2);
    this.board = { x: BOARD.x, y: BOARD.y, w: bw, h: bh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = beatAfter(au, s + 0.3);
    this.scan = scanPattern(c, 0.2);
    this.crowd = new CrowdLayer(makeCrowd(-30, W + 30, 548, 7, { r: 20, gap: 78, rowH: 64, shrink: 0.93, seed: 11, skip: (x, y) => Math.abs(x - RX) < 200 && y > 360 }), (cc) => crowdShade(cc, 170, 600), rgba('bone', 0.04), SCALE);
    this.drawBackground();
    this.drawMid();
  }

  /** 不會動的：看台的階梯線（很淡）、兩個人前面的欄杆與走道。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    c.strokeStyle = rgba('bone', 0.035);
    c.lineWidth = 1.5;
    c.beginPath();
    for (let k = 0; k < 8; k++) { const y = 610 - k * 58 * (0.5 + 0.5 * Math.pow(0.93, k)); c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
    // 欄杆：兩個人腳下一條有厚度的矮牆，上緣一條細亮邊；下面是暗暗的走道
    c.fillStyle = mixRgba('ink', 'ink2', 0.7);
    c.fillRect(1080, RG + 4, W - 1080, 34);
    c.fillStyle = rgba('bone', 0.12);
    c.fillRect(1080, RG + 4, W - 1080, 1.5);
    c.fillStyle = rgba('ink', 0.7);
    c.fillRect(1080, RG + 38, W - 1080, H - RG - 38);
    L.upload();
  }

  /** 大螢幕的殼、最上面的 LED 帶、字幕板的底（觀眾畫在它們後面）。 */
  private drawMid() {
    const L = this.mid, c = L.ctx;
    L.clear();
    ledBand(c, { x: -10, y: this.band.y0, w: W + 20, h: this.band.y1 - this.band.y0 });
    jumbotronShell(c, SCREEN, { cables: this.band.y1 });
    const B = this.board;
    ledBand(c, { x: B.x - 8, y: B.y, w: B.w + 16, h: B.h }, { dots: 0.035, edge: 0.18 });
    c.font = font(F.hei(500), 16);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('signal', 0.55);
    c.fillText(this.msg?.couple ? '新人留言' : LABEL, B.x + PAD.x, B.y + 30);
    c.letterSpacing = '0px';
  }

  /** 追光：找人的時候在看台上掃來掃去，小節線上停在兩個人身上。回傳位置與亮度。 */
  private spot(t: number) {
    const s = this.ctx.start, T = this.found;
    const home = { x: RX, y: RG - SZ * 0.45 };
    if (t >= T) return { ...home, k: 1 };
    const u = (t - s) / Math.max(0.3, T - s);
    const sx = 1260 + 520 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2.2 + 0.4)), sy = 470 + 90 * Math.sin(u * Math.PI * 3.1);
    // 最後 0.35 秒滑到兩個人身上
    const k = prog(t, T - 0.35, T, ease.outCubic);
    return { x: lerp(sx, home.x, k), y: lerp(sy, home.y, k), k: 0.55 + 0.45 * k };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const sp = this.spot(t);
    const intro = prog(t, s, s + 0.5);
    (this.arena.u.spot!.value as THREE.Vector3).set(sp.x, sp.y, sp.k * intro);
    this.arena.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;

    // ---- 看台上真的兩個人（這一層最先畫：打光只染紙偶）：換動作時在拍點上輕輕一彈；追光照到才亮起來
    const name = pick(this.keys, t);
    let squash = breathe(t, 0.008, 3.2) + 0.014 * beatKick(au, t, 0.25);
    for (const [t0] of this.keys) squash += landSquash(t, t0, 0.06, 0.3);
    const ent = puppetIn(t, s + 0.05, 0.5);
    if (ent.alpha > 0) {
      puppetShadow(c, 'cp', RX, RG, { h: SZ, alpha: 0.7 * ent.alpha, wide: 1.1, color: '0,0,0' });
      drawPick(c, this.keys, t, RX, RG, { h: SZ, squash, spin: ent.spin, alpha: ent.alpha, pivot: 0.3 });
      const lit = t >= this.found ? 1 : clamp(1 - Math.hypot(sp.x - RX, sp.y - (RG - SZ * 0.45)) / 260);
      puppetLight(c, [RX - 260, RG - SZ * 1.3, 520, SZ * 1.3 + 30], rgba('ink', 0.08 + 0.45 * (1 - lit)), rgba('ink', 0.55));
    }

    // ---- 大螢幕的殼、LED 帶、字幕板的底
    c.drawImage(this.mid.canvas, 0, 0, W, H);
    this.drawFeed(c, t, name);
    this.drawLyric(c, t);
    this.drawBoard(c, t);

    // ---- 親臉頰：愛心從轉播畫面裡的兩個人、和看台上的兩個人身上往上飄
    for (const K of this.kisses) {
      const u = t - K;
      if (u < 0 || u > 1.6) continue;
      for (let i = 0; i < 7; i++) {
        const d = u - i * 0.06;
        if (d < 0) continue;
        const a = clamp(1 - d / 1.3) * clamp(d / 0.12);
        const hx = RX + (hash(i, 1) - 0.5) * 220 + Math.sin(d * 5 + i) * 12, hy = RG - SZ * 0.95 - d * (120 + 60 * hash(i, 2));
        drawHeart(c, hx, hy, 16 + 16 * hash(i, 3), rgba('rose', a));
      }
    }

    // ---- 看台的觀眾：畫在這一層所有東西後面（destination-over；追光照亮的是觀眾後面的看台，觀眾是逆光的剪影）。
    //      找到時「喔～」、親下去時站起來歡呼
    let cheer = 0.25 * prog(t, this.found, this.found + 0.2) * (1 - prog(t, this.found + 0.6, this.found + 1.4));
    for (const K of this.kisses) cheer = Math.max(cheer, prog(t, K, K + 0.15) * (1 - prog(t, K + 1.2, K + 2.2)));
    c.save();
    c.globalCompositeOperation = 'destination-over';
    this.crowd?.draw(c, { bounce: beatKick(au, t, 0.3), cheer, t });
    c.restore();

    comp.draw(renderer, L.upload(), out);
    // 鏡頭：慢慢推近大螢幕與字幕板那一側；親下去的那一下輕輕一推
    const push = ease.inOutCubic(f.p);
    let kick = 0;
    for (const K of this.kisses) kick = Math.max(kick, t >= K ? Math.exp(-(t - K) / 0.35) : 0);
    return { bloom: 0.65, vignette: 0.6, zoom: 1 + 0.03 * push + 0.006 * kick, shake: [(W / 2 - 700) * 0.03 * push, 0] };
  }

  /**
   * 大螢幕的轉播畫面：找人的時候觀眾剪影一排排滑過去、虛線愛心框晃來晃去；小節線上切到兩個人，愛心框「碰」一下縮進來，
   * 攝影師跟著動作推近拉遠。整個畫面壓暗一點、蓋掃描線（不要比字幕板上的字還亮）。
   */
  private drawFeed(c: CanvasRenderingContext2D, t: number, name: string) {
    const S = SCREEN, au = this.ctx.audio, s = this.ctx.start, T = this.found;
    const on = prog(t, s + 0.08, s + 0.45, ease.outCubic);
    const cx = S.x + S.w / 2;
    c.save();
    c.beginPath(); c.rect(S.x, S.y, S.w, S.h * on); c.clip();
    // 畫面的底：看台的暗色，上面亮一點
    const g = c.createLinearGradient(0, S.y, 0, S.y + S.h);
    g.addColorStop(0, mixRgba('ink2', 'bone', 0.08));
    g.addColorStop(1, mixRgba('ink2', 'ink', 0.4));
    c.fillStyle = g;
    c.fillRect(S.x, S.y, S.w, S.h);
    const found = t >= T;
    // 觀眾：找人的時候往左滑（攝影機在搖）、找到之後停在兩個人後面
    const pan = found ? 0 : ((t - s) * 260) % 300;
    c.save();
    c.translate(-pan, found ? -40 : 0);
    drawCrowd(c, this.feedFans, { fill: mixRgba('ink2', 'bone', found ? 0.06 : 0.12), rim: rgba('bone', 0.06), bounce: beatKick(au, t, 0.3), cheer: 0, t });
    c.restore();
    // 愛心框：找人時是晃來晃去的虛線；找到的那一刻從大縮到剛好框住兩個人（outBack），之後每拍輕輕跳一下。
    // 框在兩個人後面（線不要劃過臉），兩個人的頭與肩膀在愛心裡
    const hc = { x: cx, y: S.y + S.h * 0.5 };
    let size: number, wob = 0;
    if (!found) { size = S.h * 0.8; wob = Math.sin((t - s) * 5) * 60; }
    else size = S.h * lerp(2.1, 1.22, ease.outBack(clamp((t - T) / 0.4))) * (1 + 0.035 * beatKick(au, t, 0.2));
    const pts = heartPoints(72);
    c.save();
    c.translate(hc.x + wob, hc.y);
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x * size * 0.5, p.y * size * 0.5 - size * 0.08) : c.moveTo(p.x * size * 0.5, p.y * size * 0.5 - size * 0.08)));
    c.closePath();
    c.lineJoin = 'round';
    if (!found) { c.setLineDash([16, 12]); c.strokeStyle = rgba('rose', 0.55); c.lineWidth = 4; c.stroke(); }
    else {
      c.strokeStyle = rgba('rose', 0.22); c.lineWidth = 16; c.stroke();
      c.strokeStyle = rgba('rose', 0.95); c.lineWidth = 5; c.stroke();
    }
    c.restore();
    if (found) {
      // 攝影師的取景：換姿勢後 0.5 秒推過去
      let fr = FRAME[this.keys[0]![1]]!;
      let from = fr, since = 9;
      for (const [t0, n] of this.keys) if (t >= t0) { from = fr; fr = FRAME[n] ?? fr; since = t - t0; }
      const k = ease.inOutCubic(clamp(since / 0.5));
      const sz = lerp(from.sz, fr.sz, k), head = lerp(from.head, fr.head, k);
      let squash = breathe(t, 0.006, 3.2) + 0.012 * beatKick(au, t, 0.25);
      for (const [t0] of this.keys) squash += landSquash(t, t0, 0.05, 0.3);
      drawPick(c, this.keys, t, cx, S.y + head + SEAT_HEAD * sz, { h: sz, squash, pivot: 0.3 });
    }
    // 轉播畫面壓暗、掃描線、上下暗角
    c.fillStyle = rgba('ink', 0.22);
    c.fillRect(S.x, S.y, S.w, S.h);
    const v = c.createLinearGradient(0, S.y, 0, S.y + S.h);
    v.addColorStop(0, rgba('ink', 0.35)); v.addColorStop(0.25, rgba('ink', 0)); v.addColorStop(0.75, rgba('ink', 0)); v.addColorStop(1, rgba('ink', 0.45));
    c.fillStyle = v;
    c.fillRect(S.x, S.y, S.w, S.h);
    if (this.scan) { c.fillStyle = this.scan; c.fillRect(S.x, S.y, S.w, S.h); }
    // 畫面上的字：左上角 LIVE（小）、下緣 KISS CAM
    c.font = font(F.mono(600), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('rose', 0.5 + 0.5 * (Math.floor(t * 2) % 2));
    c.beginPath(); c.arc(S.x + 30, S.y + 30, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = rgba('bone', 0.7);
    c.fillText('LIVE', S.x + 44, S.y + 36);
    c.font = font(F.archivo(110, 800), 28);
    c.letterSpacing = '8px';
    c.textAlign = 'right';
    c.fillStyle = rgba('signal', found ? 0.95 : 0.6);
    c.fillText('KISS CAM', S.x + S.w - 26, S.y + 46);
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    c.restore();
  }

  /** 最上面環場 LED 帶的歌詞（逐字跟唱）。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    if (!ly) return;
    const rv = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.6, ease.inOutCubic);
    // 有原文時中文縮一級、太長寧可再縮也不要折成兩排（LED 帶放不下三排字）
    const sub = !!lyricSubOf(ly.line), Bd = this.band;
    lyricOnPath(c, ly.line, t, [{ x: Bd.lx0, y: Bd.base }, { x: Bd.lx1, y: Bd.base }], {
      family: F.archivo(100, 700), size: sub ? Math.min(this.lyricSize, LYR_SUB) : this.lyricSize, minSize: sub ? 30 : 40, alpha: ly.k * rv, unsung: rgba('bone', 0.24), sung: rgba('bone', 0.9),
    });
  }

  /** 字幕板上的主打留言：一行一行從右邊跑進來、停住（跑馬燈），寫完署名淡入。 */
  private drawBoard(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const B = this.board, f = n.fit;
    const x = B.x + PAD.x, top = B.y + PAD.top, hh = B.h - PAD.top - PAD.bottom;
    const y = top + Math.max(0, (hh - n.height) * 0.45);
    const base = y + f.size * 0.9;
    c.save();
    c.beginPath(); c.rect(B.x, B.y + 2, B.w, B.h - 4); c.clip();
    c.font = font(n.family, f.size);
    c.textBaseline = 'alphabetic';
    c.fillStyle = this.msg ? rgba('bone', 0.97) : rgba('ash', 0.85);
    let last = this.msgT0;
    f.lines.forEach((ln, i) => {
      const t0 = this.msgT0 + i * 0.22;
      last = t0 + 0.5;
      const k = this.msg ? ease.outCubic(clamp((t - t0) / 0.5)) : 1;
      if (k <= 0) return;
      fillWithHearts(c, ln, lerp(B.x + B.w + 20, x, k), base + i * f.lineHeight);
    });
    if (n.name !== null) {
      c.globalAlpha = prog(t, last + 0.1, last + 0.5);
      c.font = font(n.family, n.sig);
      c.textAlign = 'right';
      c.fillStyle = rgba('ash', 0.95);
      c.fillText(signature(n.name), x + n.width, y + f.height + n.sigRow * 0.72);
    }
    c.restore();
  }
}
