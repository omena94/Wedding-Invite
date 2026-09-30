// 夾娃娃機（暗）：一台夾娃娃機，從正面的玻璃看進去，裡面堆滿扭蛋（three.js 真的 3D，爪子、扭蛋有高光）。
//  - 第一拍起爪子照拍子一格一格移：一拍往右、一拍往後（像有人在推搖桿，每一下都「頓」一下停住），
//    下一拍往下降、張爪，再一拍「喀」地夾住一顆訊號色的扭蛋，拉上來、搬回取物口上方、放開——扭蛋掉進洞裡。
//    窗格短的時候動作改成半拍或四分之一拍一個，一定來得及。
//  - 扭蛋從下面的取物口滾出來、「啵」地打開，裡面的紙條飛到右邊攤開＝主打留言（一個字一個字印出來、署名、冷面的註腳）。
//    沒有留言：紙條寫「銘謝惠顧」與邀請。新人的留言標「新人特別獎」。
//  - 機台上方的燈箱＝歌詞（逐字跟唱），燈箱邊的燈泡、機台兩側的燈條跟著拍子跑；夾住、放開的時候按鈕亮。
// 手法：3D 只畫玻璃窗那一塊（小張的 MSAA 目標，省顯示記憶體），機台外殼、控制台、紙條用 Canvas2D 疊上去。
// 2026-09-29 依「MV 融合原則」：紙條飛到鏡頭前面、放大成畫面的焦點（真的紙：影子、撕邊、微微歪），
// 紙條落下時後面的機台暗下來（對焦到紙條上）；歌詞小一級；拿掉「今日獎品」框、READY、CREDIT、取物口標籤與編號。
// 同日「留言尺寸與版面比例標準 v2」：機台是主視覺，紙條縮到 ≤ 628 × 430、飛到機台右邊，留言 40～60 px；
// 夾完之後爪子進入「待機展示」：每個小節線甩到一個新的位置停住（強烈緩動、有慣性的晃）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT, clearRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp, pulse, TAU } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, signature, fillWithHearts, lyricSubOf } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { stagger, pad3, mono, tag } from './_t11';
import { ClawRig, HOME, HOLD, CAP_R, CHUTE, BOX } from './clawmachine-rig';
import { fillGlyph, type Rect } from './_t9';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.35, 1], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面
const CAB = { x0: 128, x1: 1192 };
const HEAD = { x: 170, y: 96, w: 980, h: 156 };
const WIN = { x: 180, y: 264, w: 960, h: 536 };
const DOOR = { x: 214, y: 924, w: 226, h: 104 };
/** 紙條落定的位置（機台右邊）；高度看內容，最多 430，底部在 y ≈ 700（右下角 QR 區上面）。 */
const SLIP = { x: 1210, y: 250, w: 612, maxH: 430 };
const LYR = { w: 880 };
const FAM_MSG = F.hand(400);
const LOSE = '銘謝惠顧';
const INVITE = '這次夾到的是空氣。掃描右下角 QR code，放一份祝福進來。';
const FOOT = '＊本獎品不得兌換現金，但可以兌換擁抱。';

/** 3D 鏡頭：主點在玻璃窗的中心。 */
const CAMP = { x: 0.15, y: 2.25, z: 14, ty: 1.72 };

const ROOM = () => new FSPass(/* glsl */ `
  uniform float k; uniform float led;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 遊樂場的暗處：機台的光打在後面的牆與地上
    vec3 col = C_INK * (0.85 + 0.15 * fbm(p / 500.0, 3));
    float g = exp(-pow(length((p - vec2(660.0, 540.0)) / vec2(820.0, 640.0)), 2.0));
    col += mix(C_BLOOD, C_SIGNAL, 0.4) * 0.1 * g * (0.8 + 0.4 * led) * k;
    // 地板：機台前面一片反光
    col += C_SIGNAL * 0.03 * smoothstep(1000.0, 1080.0, p.y) * exp(-pow((p.x - 660.0) / 600.0, 2.0));
    fragColor = vec4(col, 1.0);
  }`, { k: { value: 1 }, led: { value: 0 } });

interface Glyph { ch: string; x: number; y: number; t: number }

export default class ClawMachine extends Scene {
  rig = shared('clawmachine.rig', () => new ClawRig());
  room = shared('clawmachine.room', ROOM);
  /** 玻璃窗那一塊的 3D（MSAA，扭蛋的邊才不會一直閃）。整晚共用一張，不釋放。 */
  rt = shared('clawmachine.msaa', () => makeRT(WIN.w, WIN.h, { samples: 4 }));
  cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  guard = this.track(new LineBatch(256, { screen2D: false, blend: 'add' }));
  still = this.track(new Layer2D(W, H, undefined, { fast: true }));
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  hot = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 151 + (this.msg?.id ?? 0) * 17) >>> 0;
  pick = 0;
  target = new THREE.Vector3();
  /** 動作的時間：往右、往後、下降、夾住、拉起、搬回、放開；扭蛋從取物口出來、紙條攤開。 */
  tA = 0; u = 0.5; tRel = 0; tOut = 0; tSlip = 0;
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  slipH = 300;
  sig = ''; sigT = Infinity; footT = Infinity;
  avoid: Rect[] = [];
  lyrSize = 52;
  sigSize = 30;

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.sig = m ? (m.couple ? '—— 新郎新娘' : signature(m.name)) : '';
    await loadText(`${m?.text ?? ''}${this.sig}${LOSE}${INVITE}${FOOT}${song.title}恭喜獲得獎品新人特別獎今日每次都中一則祝福取物口投幣一次＝一輩子祝福夾夾樂`);
    const rig = this.rig;
    // ---- 要夾哪一顆：第二、三層、靠前面中間的幾顆裡面挑（每個窗格不一樣）
    const cands = rig.caps.map((c, i) => ({ i, c })).filter(({ c }) => c.p.y > CAP_R + 0.3 && c.p.x > -1.2 && c.p.x < 2.2 && c.p.z > -0.6);
    cands.sort((a, b) => (b.c.p.y + b.c.p.z * 0.4) - (a.c.p.y + a.c.p.z * 0.4));
    const pickC = cands[Math.floor(hash(this.seed, 1) * Math.min(4, cands.length))] ?? cands[0]!;
    this.pick = pickC.i;
    this.target.copy(pickC.c.p);
    // ---- 時間：一個動作一個單位 u（拍、半拍或四分之一拍），紙條最晚在兩小節或窗格的四成內出來
    const beat = au.beatPeriod(s);
    this.tA = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    const bar = au.timeOfBar(au.barAt(this.tA) + 1) - this.tA;
    const budget = Math.min(2 * bar, 0.42 * (e - s));
    this.u = [1, 0.5, 0.25].map((k) => beat * k).find((u) => 5.5 * u + 0.8 <= budget) ?? beat * 0.25;
    const bA = au.beatAt(this.tA), ub = this.u / beat;
    const T = (k: number) => au.timeOfBeat(bA + k * ub);
    this.tRel = T(5.5);
    this.tOut = this.tRel + 0.42;
    this.tSlip = this.tOut + 0.18;
    // ---- 紙條：留言（或銘謝惠顧）
    const c = this.layer.ctx;
    const text = m ? m.text : INVITE;
    // 紙條最高 SLIP.maxH：扣掉標頭、署名、註腳後才是留言的高度（署名永遠在最後一行下面）；字級照標準 v2
    const head = 70, bigLose = m ? 0 : 84, tail = m ? 104 : 44;
    const room = SLIP.maxH - head - bigLose - tail;
    const o = { min: V2.msgMin, max: m ? msgMaxFor(text) : 40, lineHeight: 1.24, maxLines: 6 };
    const fam = m ? FAM_MSG : F.hand(400);
    const fit = this.fit = fitClauses(c, text, fam, SLIP.w - 100, room, o) ?? fitText(c, text, fam, SLIP.w - 100, room, o);
    this.lyrSize = lyricV2(m ? fit.size : null);
    this.sigSize = sigV2(fit.size);
    const top = SLIP.y + head + bigLose + fit.size * 0.9;
    c.font = font(m ? FAM_MSG : F.hand(400), fit.size);
    const pos: { ch: string; x: number; y: number }[] = [];
    fit.lines.forEach((ln, li) => {
      let x = SLIP.x + 50;
      for (const ch of Array.from(ln)) { pos.push({ ch, x, y: top + li * fit.lineHeight }); x += c.measureText(ch).width; }
    });
    const times = stagger(au, this.tSlip + 0.35, pos.length, Math.min(bar * 1.5, Math.max(0.6, 0.3 * (e - s))));
    this.glyphs = pos.map((p, i) => ({ ...p, t: times[i]! }));
    const tLast = times[times.length - 1] ?? this.tSlip;
    this.sigT = tLast + beat * 0.5;
    this.footT = this.sigT + beat;
    this.slipH = head + bigLose + fit.height + tail;
    this.drawStill();
    // ---- 即時小卡避開：燈箱的歌詞、紙條
    this.avoid = [[HEAD.x, HEAD.y, HEAD.w, HEAD.h], [SLIP.x - 20, SLIP.y - 20, SLIP.w + 40, this.slipH + 40], [SLIP.x - 20, SLIP.y - 20, SLIP.w + 40, this.slipH + 40]];
    void lyrics;
  }

  /** 燈箱的歌詞樣式。韓文歌（有原文副行）時中文小一點（最多 46），燈箱裡才塞得下兩行又不擠。 */
  private lyrStyle(line: Parameters<typeof layoutLyric>[1]) {
    return { family: F.archivo(100, 800), size: lyricSubOf(line) ? Math.min(this.lyrSize, 46) : this.lyrSize, minSize: V2.lyrMin, maxWidth: LYR.w, align: 'center' as const, lineHeight: 1.08 };
  }
  private layLyric(line: Parameters<typeof layoutLyric>[1]) {
    return layoutLyric(this.layer.ctx, line, this.lyrStyle(line));
  }

  /** 機台外殼（玻璃窗挖空）、燈箱底、控制台、取物口、右邊「今日獎品」的小牌子：畫一次。 */
  private drawStill() {
    const L = this.still, c = L.ctx;
    L.clear();
    // 外殼：深色烤漆、兩側鉻條
    const g = c.createLinearGradient(CAB.x0, 0, CAB.x1, 0);
    g.addColorStop(0, rgba('ink2', 1)); g.addColorStop(0.5, mixRgba('ink2', 'graphite', 0.18)); g.addColorStop(1, rgba('ink2', 1));
    c.fillStyle = g;
    c.beginPath(); c.roundRect(CAB.x0, 76, CAB.x1 - CAB.x0, H - 60, 26); c.fill();
    c.strokeStyle = rgba('ash', 0.35); c.lineWidth = 2; c.stroke();
    // 燈箱：壓克力（很淡的訊號色）
    c.fillStyle = mixRgba('ink', 'blood', 0.22);
    c.beginPath(); c.roundRect(HEAD.x, HEAD.y, HEAD.w, HEAD.h, 18); c.fill();
    c.strokeStyle = rgba('graphite', 0.9); c.lineWidth = 2; c.stroke();
    // 玻璃窗：挖空（3D 從下面透出來），鉻框
    c.save(); c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.roundRect(WIN.x, WIN.y, WIN.w, WIN.h, 20); c.fill();
    c.restore();
    c.strokeStyle = rgba('ash', 0.55); c.lineWidth = 6;
    c.beginPath(); c.roundRect(WIN.x - 3, WIN.y - 3, WIN.w + 6, WIN.h + 6, 22); c.stroke();
    c.strokeStyle = rgba('bone', 0.25); c.lineWidth = 1.2;
    c.beginPath(); c.roundRect(WIN.x - 7, WIN.y - 7, WIN.w + 14, WIN.h + 14, 26); c.stroke();
    // 控制台：斜斜的面板、投幣口
    c.fillStyle = mixRgba('ink2', 'graphite', 0.3);
    c.beginPath(); c.moveTo(CAB.x0 + 20, 820); c.lineTo(CAB.x1 - 20, 820); c.lineTo(CAB.x1 - 6, 906); c.lineTo(CAB.x0 + 6, 906); c.closePath(); c.fill();
    c.strokeStyle = rgba('ash', 0.4); c.lineWidth = 1.5; c.stroke();
    c.fillStyle = rgba('ink'); c.fillRect(900, 846, 12, 40);
    c.strokeStyle = rgba('ash', 0.6); c.lineWidth = 1.5; c.strokeRect(886, 838, 40, 56);
    tag(c, '投幣　一次＝一輩子', 944, 872, { size: 16, tracking: 2, color: rgba('ash', 0.55) });
    // 取物口
    c.fillStyle = rgba('ink'); c.beginPath(); c.roundRect(DOOR.x, DOOR.y, DOOR.w, DOOR.h, 10); c.fill();
    c.strokeStyle = rgba('ash', 0.5); c.lineWidth = 2; c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const rig = this.rig;
    const u = this.u, beat = au.beatPeriod(t);
    const bA = au.beatAt(this.tA), ub = u / beat;
    const T = (k: number) => au.timeOfBeat(bA + k * ub);

    // ---- 爪子的動作（全部是 t 的函數）
    const tg = this.target;
    const grabY = tg.y + HOLD;
    const mx = prog(t, T(0) - 0.02, T(0) + 0.75 * u, ease.outExpo);
    const mz = prog(t, T(1) - 0.02, T(1) + 0.75 * u, ease.outExpo);
    const dn = prog(t, T(2), T(2) + 0.85 * u, ease.outCubic);
    const grab = prog(t, T(3), T(3) + 0.22 * u, ease.outCubic);
    const up = prog(t, T(3.5), T(3.5) + 0.85 * u, ease.inOutCubic);
    const back = prog(t, T(4.5), T(4.5) + 0.9 * u, ease.inOutCubic);
    const rel = prog(t, this.tRel, this.tRel + 0.12, ease.outCubic);
    let x = lerp(HOME.x, tg.x, mx), z = lerp(HOME.z, tg.z, mz);
    x = lerp(x, HOME.x, back); z = lerp(z, HOME.z, back);
    // 待機展示：放開後的下一個小節線起，每個小節線甩到一個新位置（outExpo 停住、再晃一下）
    const idle0 = au.timeOfBar(Math.ceil(au.barAt(this.tRel + 0.6) - 1e-6));
    let idleSway = 0;
    if (t >= idle0) {
      const bi = Math.floor(au.barAt(t) + 1e-4), tb = au.timeOfBar(bi), b0i = Math.round(au.barAt(idle0));
      const spot = (k: number) => k < b0i ? { x: HOME.x, z: HOME.z } : { x: -1.8 + 3.8 * hash(k, this.seed, 7), z: -1.2 + 2.2 * hash(k, this.seed, 8) };
      const a = spot(bi - 1), bpos = spot(bi);
      const k = prog(t, tb, tb + 0.55 * au.beatPeriod(t) * 2, ease.outExpo);
      x = lerp(a.x, bpos.x, k); z = lerp(a.z, bpos.z, k);
      idleSway = 0.06 * Math.sin((t - tb) * 14) * pulse(t, tb + 0.25, 0.25);
    }
    const y = lerp(lerp(HOME.y, grabY, dn), HOME.y, up);
    // 爪子：平常半開，下降時張開，夾住時收到扭蛋上，放開再張開，之後慢慢收回半開
    let open = lerp(0.62, 0.98, prog(t, T(2), T(2) + 0.5 * u));
    open = lerp(open, 0.6, grab);
    open = lerp(open, 1.0, rel);
    open = lerp(open, 0.62, prog(t, this.tRel + 0.4, this.tRel + 0.9, ease.inOutCubic));
    // 移動的時候爪子會晃一下（慣性）
    const sway = 0.05 * (Math.sin((t - T(0)) * 18) * pulse(t, T(0) + 0.3 * u, 0.2) + Math.sin((t - T(4.5)) * 16) * pulse(t, T(4.5) + 0.7 * u, 0.25));
    rig.pose(x, y, z, open);
    rig.claw.rotation.z = sway + idleSway;
    // 被選中的扭蛋：夾住之前在堆裡、夾住後跟著爪子、放開後掉進洞裡（重力）
    rig.hide(this.pick);
    const held = t >= T(3) && t < this.tRel;
    const cp = new THREE.Vector3();
    if (t < T(3)) cp.copy(tg);
    else if (held) cp.set(x, y - HOLD, z);
    else { const ft = t - this.tRel; cp.set(HOME.x, HOME.y - HOLD - 0.5 * 26 * ft * ft, HOME.z); }
    rig.chosen.position.copy(cp);
    rig.chosen.visible = cp.y > -2;
    rig.chosen.quaternion.copy(rig.caps[this.pick]!.q);
    // ---- 顏色（主題會換）
    const V = (k: keyof typeof LIN, s2 = 1) => new THREE.Vector3(LIN[k][0] * s2, LIN[k][1] * s2, LIN[k][2] * s2);
    const led = 0.5 + 0.5 * f.a.kick;
    (rig.metal.uniforms.uTop!.value as THREE.Vector3).copy(V('ash', 0.75));
    (rig.metal.uniforms.uBot!.value as THREE.Vector3).copy(V('ash', 0.75));
    (rig.pileMat.uniforms.uBot!.value as THREE.Vector3).copy(V('bone', 0.62));
    (rig.chosenMat.uniforms.uTop!.value as THREE.Vector3).copy(V('signal', 1));
    (rig.chosenMat.uniforms.uBot!.value as THREE.Vector3).copy(V('bone', 0.7));
    rig.chosenMat.uniforms.uGlow!.value = 0.15 + 0.35 * (held ? 1 : 0);
    for (const m of [rig.metal, rig.pileMat, rig.chosenMat, rig.wallMat, rig.ledMat]) m.uniforms.uLed!.value = led;

    // ---- 3D：只畫玻璃窗那一塊
    const cam = this.cam;
    const grabShake = pulse(t, T(3), 0.08) * 0.025;
    // 鏡頭：整個窗格很慢地往左推近一點（跟著爪子搬回去的方向）
    const drift = ease.inOutCubic(clamp((t - this.ctx.start) / Math.max(1, this.ctx.end - this.ctx.start)));
    cam.position.set(CAMP.x - 0.35 * drift, CAMP.y + grabShake, CAMP.z - 0.5 * drift);
    cam.lookAt(CAMP.x - 0.3 * drift, CAMP.ty, 0);
    // 主點放在玻璃窗中心：虛擬的整張畫面是 W×H，這張目標是其中窗戶那一塊
    cam.setViewOffset(W, H, WIN.x + (W / 2 - (WIN.x + WIN.w / 2)), WIN.y + (H / 2 - (WIN.y + WIN.h / 2)), WIN.w, WIN.h);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    clearRT(renderer, this.rt, [LIN.ink[0] * 0.3, LIN.ink[1] * 0.3, LIN.ink[2] * 0.3]);
    renderer.setRenderTarget(this.rt);
    renderer.render(rig.scene, cam);
    // 取物口的壓克力擋板（細線）
    const gb = this.guard; gb.clear();
    const bone = LIN.bone, a = 0.35;
    const ed = (p: number[], q: number[]) => gb.seg(p[0]!, p[1]!, p[2]!, q[0]!, q[1]!, q[2]!, 1.4, bone[0] * a, bone[1] * a, bone[2] * a, 1);
    const X0 = BOX.x0 + 0.02, X1 = CHUTE.x1, Z0 = CHUTE.z0, Z1 = BOX.z1 - 0.02, Hh = CHUTE.h;
    ed([X0, Hh, Z0], [X1, Hh, Z0]); ed([X1, Hh, Z0], [X1, Hh, Z1]); ed([X1, 0, Z0], [X1, Hh, Z0]); ed([X1, 0, Z1], [X1, Hh, Z1]);
    ed([X0, 0, Z0], [X1, 0, Z0]); ed([X1, 0, Z0], [X1, 0, Z1]);
    gb.render(renderer, this.rt, cam);
    // 疊到畫面：房間 → 玻璃窗的 3D（只蓋窗戶那一塊）
    this.room.u.led!.value = led;
    this.room.render(renderer, out);
    const sx = W / WIN.w, sy = H / WIN.h;
    const cx = (WIN.x + WIN.w / 2) / W, cy = 1 - (WIN.y + WIN.h / 2) / H;
    comp.draw(renderer, this.rt.texture, out, { mode: 'replace', premult: false, scale: [sx, sy], offset: [-(cx - 0.5) * sx, -(cy - 0.5) * sy] });
    comp.draw(renderer, this.still.texture, out);

    // ---- 2D：燈箱歌詞、燈泡、控制台、取物口、紙條
    const Ly = this.layer, Ht = this.hot;
    Ly.clear(); Ht.clear();
    const c = Ly.ctx, hc = Ht.ctx;
    c.save(); hc.save();
    this.glassSheen(c, t);
    this.header(c, hc, t, f);
    this.controls(c, hc, t, f, T, held);
    this.prize(c, hc, t);
    c.restore(); hc.restore();
    comp.draw(renderer, Ly.upload(), out);
    comp.draw(renderer, Ht.upload(), out, { mode: 'add', tint: [2, 2, 2] });
    void s;
    return { bloom: 0.8, vignette: 0.5, halation: 0.3, zoom: 1 + 0.004 * f.a.kick + 0.006 * pulse(t, T(3), 0.12), popupAvoid: this.avoid };
  }

  /** 玻璃上一道斜斜的反光。 */
  private glassSheen(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.beginPath(); c.roundRect(WIN.x, WIN.y, WIN.w, WIN.h, 20); c.clip();
    const x0 = WIN.x + 120 + 30 * Math.sin(t * 0.3);
    const g = c.createLinearGradient(x0, WIN.y, x0 + 260, WIN.y + 120);
    g.addColorStop(0, rgba('bone', 0)); g.addColorStop(0.5, rgba('bone', 0.05)); g.addColorStop(1, rgba('bone', 0));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(x0, WIN.y); c.lineTo(x0 + 180, WIN.y); c.lineTo(x0 - 160, WIN.y + WIN.h); c.lineTo(x0 - 340, WIN.y + WIN.h); c.closePath(); c.fill();
    c.restore();
  }

  /** 燈箱：機台名字、歌詞（逐字跟唱）、邊上一圈跑馬燈泡。 */
  private header(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, f: Frame) {
    const { lyrics, song } = this.ctx;
    const cx = HEAD.x + HEAD.w / 2;
    // 燈泡：一圈，兩顆亮一顆暗，一拍走一格
    const n = 34, step = Math.floor(f.beat + 1e-4);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const per = 2 * (HEAD.w + HEAD.h);
      let d = u * per, bx: number, by: number;
      if (d < HEAD.w) { bx = HEAD.x + d; by = HEAD.y; } else if ((d -= HEAD.w) < HEAD.h) { bx = HEAD.x + HEAD.w; by = HEAD.y + d; } else if ((d -= HEAD.h) < HEAD.w) { bx = HEAD.x + HEAD.w - d; by = HEAD.y + HEAD.h; } else { d -= HEAD.w; bx = HEAD.x; by = HEAD.y + HEAD.h - d; }
      const on = (i + step) % 3 !== 0;
      c.fillStyle = on ? rgba('ember', 0.95) : rgba('graphite', 0.8);
      c.beginPath(); c.arc(bx, by, 4.5, 0, TAU); c.fill();
      if (on) { hc.fillStyle = rgba('signal', 0.7); hc.beginPath(); hc.arc(bx, by, 6, 0, TAU); hc.fill(); }
    }
    const ly = lyricAt(lyrics, t);
    const lay = ly ? this.layLyric(ly.line) : null;
    // 韓文歌（有原文副行）：燈箱高度固定，中文＋原文整組在燈箱裡置中；中文折成兩行還放不下時，機台名字那一行小字先收起來
    let subBase = 0, title = true;
    if (lay?.sub) {
      const sl = lay.sub.lay, hTop = lay.size * 0.82;
      const total = hTop + lay.sub.dy + (sl.height - sl.size) + sl.size * 0.22;
      const bottom = HEAD.y + HEAD.h - 8;
      if (total > bottom - (HEAD.y + 44)) title = false;
      const top = title ? HEAD.y + 44 : HEAD.y + 12;
      subBase = top + Math.max(0, bottom - top - total) / 2 + hTop;
    }
    if (title) mono(c, 'LOVE CATCHER　·　祝福夾夾樂', cx, HEAD.y + 34, { size: 14, tracking: 5, color: rgba('signal', 0.6), align: 'center', weight: 600 });
    if (ly && lay) {
      const st = this.lyrStyle(ly.line);
      const base = lay.sub ? subBase : lay.rows.length > 1 ? HEAD.y + 88 : HEAD.y + 112;
      const dy = (1 - ease.outExpo(ly.k)) * 10;
      c.save(); c.translate(cx, base + dy); drawLyric(c, ly.line, t, st, lay, ly.k); c.restore();
      hc.save(); hc.translate(cx, base + dy); drawLyric(hc, ly.line, t, { ...st, sung: 'rgba(0,0,0,0)', unsung: 'rgba(0,0,0,0)', active: rgba('signal', 0.7) }, lay, ly.k); hc.restore();
    } else if (!lyrics.linesIn(this.ctx.start - 1, this.ctx.end + 1).length) {
      c.font = font(F.archivo(100, 800), 56); c.fillStyle = rgba('bone', 0.9); c.textAlign = 'center';
      c.fillText(song.title, cx, HEAD.y + 112);
      c.textAlign = 'left';
    }
  }

  /** 控制台：搖桿（跟著爪子移動的方向倒）、按鈕（下降／夾住時亮）、兩側燈條。 */
  private controls(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number, f: Frame, T: (k: number) => number, held: boolean) {
    const u = this.u;
    // 搖桿往哪邊倒：往右（第一個動作）、往上（往後）、往左下（搬回）
    let jx = 0, jy = 0;
    if (t >= T(0) && t < T(0) + 0.8 * u) jx = 1;
    if (t >= T(1) && t < T(1) + 0.8 * u) jy = -1;
    if (t >= T(4.5) && t < T(4.5) + 0.9 * u) { jx = -0.8; jy = 0.6; }
    const bx = 330, by = 868;
    c.fillStyle = rgba('ink'); c.beginPath(); c.ellipse(bx, by + 8, 42, 14, 0, 0, TAU); c.fill();
    c.strokeStyle = rgba('ash', 0.8); c.lineWidth = 7; c.lineCap = 'round';
    const kx = bx + jx * 18, ky = by - 46 + jy * 8;
    c.beginPath(); c.moveTo(bx, by + 4); c.lineTo(kx, ky); c.stroke();
    c.fillStyle = rgba('signal'); c.beginPath(); c.arc(kx, ky, 17, 0, TAU); c.fill();
    c.fillStyle = rgba('ember', 0.8); c.beginPath(); c.arc(kx - 5, ky - 5, 5, 0, TAU); c.fill();
    // 按鈕：下降到夾住那一段亮，放開時再閃一下
    const lit = (t >= T(2) && t < T(3.5)) || (t >= this.tRel && t < this.tRel + 0.2);
    c.fillStyle = rgba('ink'); c.beginPath(); c.ellipse(560, 874, 46, 16, 0, 0, TAU); c.fill();
    c.fillStyle = lit ? rgba('signal') : rgba('blood', 0.8); c.beginPath(); c.ellipse(560, 866, 38, 13, 0, 0, TAU); c.fill();
    if (lit) { hc.fillStyle = rgba('signal', 0.9); hc.beginPath(); hc.ellipse(560, 866, 40, 15, 0, 0, TAU); hc.fill(); }
    tag(c, '夾', 560, 872, { size: 16, tracking: 0, color: lit ? rgba('ink') : rgba('bone', 0.8), align: 'center', weight: 700 });
    void held;
    // 兩側燈條：一拍往上跑一段
    for (const lx of [CAB.x0 + 12, CAB.x1 - 12]) {
      for (let i = 0; i < 22; i++) {
        const y = 1040 - i * 44;
        const on = (i + Math.floor(f.beat * 2 + 1e-4)) % 4 === 0;
        c.fillStyle = on ? rgba('signal', 0.95) : rgba('graphite', 0.7);
        c.fillRect(lx - 3, y - 12, 6, 24);
        if (on) { hc.fillStyle = rgba('signal', 0.7); hc.fillRect(lx - 4, y - 14, 8, 28); }
      }
    }
  }

  /** 取物口：扭蛋滾出來、啵地打開，紙條飛到右邊攤開，留言一個字一個字印出來。 */
  private prize(c: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, t: number) {
    const m = this.msg, fit = this.fit!;
    const tO = this.tOut, tS = this.tSlip;
    // 取物口的擋板：扭蛋出來時往上掀
    const flap = prog(t, tO - 0.05, tO + 0.1, ease.outCubic) * (1 - prog(t, tO + 0.5, tO + 0.8));
    c.fillStyle = mixRgba('ink2', 'graphite', 0.4);
    c.fillRect(DOOR.x + 6, DOOR.y + 6, DOOR.w - 12, (DOOR.h - 12) * (1 - flap * 0.85));
    c.strokeStyle = rgba('ash', 0.4); c.lineWidth = 1; c.strokeRect(DOOR.x + 6, DOOR.y + 6, DOOR.w - 12, (DOOR.h - 12) * (1 - flap * 0.85));
    // 扭蛋：滾出來、打開（上下兩半分開）
    if (t >= tO && t < tS + 0.3) {
      const k = prog(t, tO, tS, ease.outCubic), open = prog(t, tS, tS + 0.25, ease.outCubic);
      const px = DOOR.x + DOOR.w / 2 + k * 40, py = DOOR.y + DOOR.h - 36;
      c.save(); c.globalAlpha = 1 - open * 0.8;
      c.fillStyle = rgba('bone', 0.85); c.beginPath(); c.arc(px, py + open * 14, 30, 0, Math.PI); c.fill();
      c.fillStyle = rgba('signal'); c.beginPath(); c.arc(px, py - open * 30, 30, Math.PI, TAU); c.fill();
      c.restore();
      hc.fillStyle = rgba('signal', 0.6 * (1 - open)); hc.beginPath(); hc.arc(px, py, 34, 0, TAU); hc.fill();
    }
    if (t < tS) return;
    // 紙條：從取物口飛到右邊（強烈緩動），邊飛邊轉正、變大
    const fly = prog(t, tS, tS + 0.45, ease.outExpo);
    const fromX = DOOR.x + DOOR.w / 2, fromY = DOOR.y + 30;
    const cxS = SLIP.x + SLIP.w / 2, cyS = SLIP.y + this.slipH / 2;
    const px = lerp(fromX, cxS, fly), py = lerp(fromY, cyS, fly) - Math.sin(fly * Math.PI) * 120;
    const sc = lerp(0.12, 1, fly), rot = lerp(0.6, -0.018, fly);
    // 對焦到紙條上：紙條飛出來時，後面的機台慢慢暗下來
    c.fillStyle = rgba('ink', 0.22 * fly); c.fillRect(CAB.x0 - 20, HEAD.y + HEAD.h + 6, CAB.x1 - CAB.x0 + 40, H);
    c.save();
    c.translate(px, py); c.rotate(rot); c.scale(sc, sc); c.translate(-cxS, -cyS);
    const x0 = SLIP.x, y0 = SLIP.y, w = SLIP.w, h = this.slipH;
    const paperPath = new Path2D();
    paperPath.moveTo(x0, y0 + 8);
    for (let i = 0; i <= 40; i++) paperPath.lineTo(x0 + (i / 40) * w, y0 + (i % 2 ? 0 : 8));
    paperPath.lineTo(x0 + w, y0 + h); paperPath.lineTo(x0, y0 + h); paperPath.closePath();
    // 影子（紙離機台有一段距離：柔、偏右下）
    c.save(); c.filter = 'blur(18px)'; c.translate(16, 26); c.fillStyle = rgba('ink', 0.75); c.fill(paperPath); c.restore();
    // 紙：上緣是撕下來的鋸齒；一點點由上往下的明暗（紙微微彎）
    const pg = c.createLinearGradient(0, y0, 0, y0 + h);
    pg.addColorStop(0, rgba('paper')); pg.addColorStop(1, mixRgba('paper', 'ash', 0.12));
    c.fillStyle = pg; c.fill(paperPath);
    // 紙條的標頭（小）
    const headTxt = m ? (m.couple ? '新人特別獎' : '恭喜獲得') : '開獎結果';
    tag(c, headTxt, x0 + 50, y0 + 52, { size: 20, tracking: 6, color: rgba('blood', 0.85), weight: 700 });
    c.fillStyle = rgba('sepia', 0.25); c.fillRect(x0 + 50, y0 + 66, w - 100, 1.2);
    if (!m) {
      c.font = font(F.hand(700), 60); c.fillStyle = rgba('sepia'); c.fillText(LOSE, x0 + 50, y0 + 70 + 64);
    }
    // 留言：一個字一個字印出來
    c.font = font(m ? FAM_MSG : F.hand(400), fit.size);
    for (const g of this.glyphs) {
      if (t < g.t) break;
      const heat = 1 - clamp((t - g.t) / 0.35);
      const base = g.ch === '♥' ? 'rose' : 'sepia';
      fillGlyph(c, g.ch, g.x, g.y, heat > 0 ? mixRgba(base, 'blood', heat) : rgba(base, m ? 1 : 0.85));
    }
    if (m && t >= this.sigT) {
      c.globalAlpha = prog(t, this.sigT, this.sigT + 0.25);
      c.font = font(FAM_MSG, this.sigSize); c.fillStyle = rgba('sepia', 0.85); c.textAlign = 'right';
      c.fillText(this.sig, x0 + w - 50, y0 + h - 54);
      c.textAlign = 'left';
      c.globalAlpha = 1;
    }
    if (t >= this.footT) {
      c.globalAlpha = prog(t, this.footT, this.footT + 0.3);
      mono(c, FOOT, x0 + 50, y0 + h - 22, { size: 13, tracking: 1, color: rgba('sepia', 0.55) });
      c.globalAlpha = 1;
    }
    c.restore();
    void fillWithHearts;
  }
}
