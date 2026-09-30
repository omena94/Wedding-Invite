// 深夜寫程式（暗、work）：半夜的書房，側面看。宣文坐在辦公椅上對著雙螢幕敲鍵盤，孟庭穿著護理服下班回來，從後面抱住他。
// 角色是 Codex 畫的紙偶（_puppet.ts，work 組）；房間、桌子、螢幕、程式碼用程式畫。
//  - 敲鍵盤一拍一下（type_1／type_2 輪流），每一下鍵盤閃一下、螢幕上的程式多打幾個字。
//  - 左邊的小螢幕是建置狀態：一開始是紅燈「✕」，**小節線上變綠燈「✓」**（一圈火花炸開），宣文坐在椅子上舉雙手歡呼。
//  - 左邊（畫面外）的門打開、暖光鋪進來，孟庭從左邊走進來（一拍一步），**在小節線上從後面抱住他**（兩人一起的紙偶）；
//    之後每個小節線換一次：宣文轉頭、兩人相視而笑，頭上冒一顆小愛心。
//  - **焦點是主打留言**：右邊大螢幕上的一則程式碼審查（review）留言，逐字打出來、署名；照「留言尺寸與版面比例標準 v2」：
//    字 40～60，留言那一塊最大 680 × 250（在螢幕的下半部）。螢幕上其他字（檔名、程式碼、approved）都很小很淡。
//    沒有留言時螢幕上寫邀請、字淡，歌詞變主角。
//  - 歌詞寫在左上的牆上，前面一個小小的「$ git commit -m」，比留言小一級（標準 v2：40～52）。
//  - 光：螢幕是房間唯一的光（冷白，建置過了之後帶一點訊號色），紙偶上亮下暗、右邊亮左邊暗；門打開後左邊多一道暖光。
//    鏡頭：整個窗格慢慢推近大螢幕。
//  - 窗格短時事件往前擠：兩三個小節線的窗格一開始就在綠燈的前一刻、孟庭已經在房間裡。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, layoutLyric, drawLyric, sparkParticles } from './_motifs';
import { inkFor, inkLine, inkPoly, heartPop, type Pt, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawCycle, puppetPoint, puppetShadow, puppetLight, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { INVITE, enter, writeNote, sideLight, barsIn, at } from './_c7';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'work', paper: false, energy: [0.25, 0.9], bars: [4, 8] };

const FLOOR = 905;
/** 場景尺度：宣文站直的身高（px）。 */
const SZ = 640;
/** 宣文的椅子（腳底錨點 = 椅子的中心）。 */
const AL_X = 600;
/** 門在畫面左邊外面：打開時暖光從左邊鋪進來（地上一道楔形、牆上一片），孟庭從左邊走進來。 */
const DOOR = { x: -120, w: 190, top: FLOOR - 770 };
/** 右邊的大螢幕（外框）與寫留言的那一塊（螢幕下半部）。 */
const MON = { x: 1010, y: 150, w: 790, h: 450 };
const CMT = { x: MON.x + 74, y: MON.y + 196, w: 680, h: 230 };
/** 左上牆上的歌詞。 */
const WALL = { x: 128, y: 164, w: 800 };
const POSES = ['xw_work_type_1', 'xw_work_type_2', 'xw_work_yes', 'mt_work_walk_1', 'mt_work_walk_2', 'cp_work_backhug_1', 'cp_work_backhug_2'];
/** 螢幕上打的程式（冷面笑話）：一拍打幾個字，打完一行換下一行。 */
const CODE = ['  const home = alan + omena;', '  while (together) love++;', '  home.lights = "on";', '  return forever;', '}'];
const CODE_HEAD = ['function marry(alan, omena) {'];

/**
 * 房間的底：螢幕照在牆上的一大團冷光（建置過了之後帶一點訊號色）、地板比牆亮一點點、門打開時門口與地上的暖光。
 * 用 shader 算（浮點＋一點點抖色）：Canvas2D 的淡漸層只有幾個 8 位元的階，大螢幕上會看到一圈一圈的。
 */
const ROOM = () => new FSPass(/* glsl */ `
  uniform float door; uniform float pass; uniform float flick;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK;
    vec2 q = (p - vec2(${MON.x + MON.w / 2}.0, ${MON.y + MON.h / 2 + 30}.0)) / vec2(900.0, 560.0);
    float g = exp(-dot(q, q) * 1.5);
    vec3 tint = mix(mix(C_BONE, C_BLOOD, 0.4), mix(C_BONE, C_SIGNAL, 0.45), pass);
    col += tint * 0.05 * g * flick;
    float fl = smoothstep(${FLOOR - 2}.0, ${FLOOR + 2}.0, p.y);
    col += C_BONE * 0.012 * fl * (1.0 - 0.6 * smoothstep(${FLOOR}.0, ${H}.0, p.y));
    // 門口（畫面左邊外面）的暖光：牆上從左邊漫進來一片，地上一道往右下展開的楔形，離門越遠越淡
    vec3 warm = mix(C_EMBER, C_BONE, 0.35);
    float d = max(p.y - ${FLOOR}.0, 0.0);
    float x0 = ${DOOR.x}.0 + d * 0.6, x1 = ${DOOR.x + DOOR.w}.0 + d * 2.6;
    float wedge = fl * smoothstep(x0 - 30.0, x0 + 30.0, p.x) * (1.0 - smoothstep(x1 - 80.0, x1 + 40.0, p.x)) * exp(-d / 150.0);
    float spill = exp(-pow(max(p.x - ${DOOR.x + DOOR.w}.0, 0.0) / 340.0, 2.0)) * (1.0 - fl) * smoothstep(${DOOR.top - 80}.0, ${FLOOR}.0, p.y);
    col += warm * door * (0.06 * wedge + 0.035 * spill);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { door: { value: 0 }, pass: { value: 0 }, flick: { value: 1 } });

export default class Debug extends Scene {
  room = shared('debug.room', ROOM);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(2048, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  cmt = { ...CMT };
  lyricSize = 52;
  /** 事件：綠燈、門開、孟庭開始走、抱住（-1 = 這個窗格沒有）、之後每個小節線。 */
  tGreen = 0;
  tDoor = 0;
  tWalk = 0;
  tHug = -1;
  hugBars: number[] = [];
  /** 鍵盤（手底下）、孟庭走到的位置（抱住那張圖裡她的腳）、門口。 */
  keys: Pt = { x: 0, y: 0 };
  herX = 0;
  doorX = -140;
  /** 坐辦公椅的幾張（歡呼、後抱）要畫在哪、放大多少，椅子才跟打字那張疊在一起（Codex 每張各自縮放過）。 */
  align: Record<string, { x: number; y: number; scale: number }> = {};
  deskX0 = 700;
  msgT0 = 0;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('$ git commit -m// 編譯中…一位賓客review · approvedwedding.tsbuild #0313passedfailed✓✕' + INVITE + CODE.join('') + CODE_HEAD.join(''));
    this.track(await loadPuppets(POSES));
    const s = this.ctx.start, e = this.ctx.end;
    const bars = barsIn(au, s, e, 0.5);
    const n = bars.length;
    // 窗格夠長：先打一小節字、第二個小節線綠燈、再兩小節孟庭抱住；短的窗格往前擠
    this.tGreen = at(bars, n >= 5 ? 1 : 0);
    this.tHug = n >= 2 ? at(bars, n >= 5 ? 3 : n >= 3 ? 2 : 1) : -1;
    this.hugBars = this.tHug > 0 ? bars.filter((b) => b > this.tHug + 0.05) : [];
    this.keys = puppetPoint('xw_work_type_1', 'keys', AL_X, FLOOR, { h: SZ }) ?? { x: AL_X + SZ * 0.3, y: FLOOR - SZ * 0.42 };
    // 椅子上的兩個對應點（sprites.json 的 c1、c2）：算出每一張要放大多少、畫在哪，椅子才會疊在打字那張的椅子上
    const r1 = puppetPoint('xw_work_type_1', 'c1', AL_X, FLOOR, { h: SZ }), r2 = puppetPoint('xw_work_type_1', 'c2', AL_X, FLOOR, { h: SZ });
    for (const name of ['xw_work_yes', 'cp_work_backhug_1', 'cp_work_backhug_2']) {
      const p1 = puppetPoint(name, 'c1', 0, 0, { h: SZ }), p2 = puppetPoint(name, 'c2', 0, 0, { h: SZ });
      if (!r1 || !r2 || !p1 || !p2) { this.align[name] = { x: AL_X, y: FLOOR, scale: 1 }; continue; }
      const sc = Math.hypot(r2.x - r1.x, r2.y - r1.y) / Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      this.align[name] = { x: r1.x - p1.x * sc, y: r1.y - p1.y * sc, scale: sc };
    }
    const hug = this.align.cp_work_backhug_1!;
    this.herX = puppetPoint('cp_work_backhug_1', 'feet', hug.x, hug.y, { h: SZ, scale: hug.scale })?.x ?? AL_X - SZ * 0.36;
    this.deskX0 = this.keys.x - 70;
    // 孟庭從門口走到椅子後面：一拍一步（步幅約身高的 0.16），剛好在抱住的小節線前走到
    const bp = au.beatPeriod(this.tHug > 0 ? this.tHug : s);
    const steps = Math.max(3, Math.round((this.herX - this.doorX) / (SZ * 0.16)));
    const arrive = this.tHug > 0 ? this.tHug - 0.02 : e + bp * 2;
    this.tWalk = arrive - steps * bp;
    this.tDoor = this.tWalk - bp * 0.9;
    // 留言：大螢幕下半部的一則 review，標準 v2 的字級；寬跟著字縮（左邊對齊留言的線）
    const c = this.fg.ctx;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, CMT.w, CMT.h) : noteV2(c, INVITE, null, CMT.w, CMT.h * 0.5, { max: 44 });
    tightenNote(c, this.note, 300);
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.msgT0 = Math.min(s + 0.9, this.tGreen);
    this.drawBackground();
  }

  /** 不會動的：地板、門框、桌子、鍵盤、兩個螢幕的外框與大螢幕上的小字（畫一次）。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ink = inkFor(false, { fill: rgba('ink2') });
    // 地板線（很淡）
    c.strokeStyle = rgba('bone', 0.1); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(60, FLOOR); c.lineTo(1860, FLOOR); c.stroke();
    // 桌子：桌面（有厚度）、兩隻細腳；右邊一個抽屜櫃
    const top = this.keys.y + 14, x0 = this.deskX0, x1 = 1330;
    c.fillStyle = mixRgba('ink2', 'bone', 0.05);
    c.fillRect(x0, top, x1 - x0, 16);
    inkLine(c, [{ x: x0, y: top }, { x: x1, y: top }], { ink, w: 0.9, t: 0, seed: 5, color: rgba('bone', 0.45) });
    inkLine(c, [{ x: x0, y: top + 16 }, { x: x1, y: top + 16 }], { ink, w: 0.5, t: 0, seed: 6, color: rgba('bone', 0.2) });
    for (const x of [x0 + 26, x1 - 26]) inkLine(c, [{ x, y: top + 16 }, { x, y: FLOOR }], { ink, w: 0.7, t: 0, seed: x, color: rgba('bone', 0.3) });
    c.fillStyle = rgba('ink2', 0.9);
    c.fillRect(x1 - 230, top + 16, 180, FLOOR - top - 16);
    c.strokeStyle = rgba('bone', 0.14); c.lineWidth = 1;
    c.strokeRect(x1 - 230, top + 16, 180, FLOOR - top - 16);
    for (let k = 1; k < 3; k++) { const y = top + 16 + ((FLOOR - top - 16) * k) / 3; c.beginPath(); c.moveTo(x1 - 230, y); c.lineTo(x1 - 50, y); c.stroke(); }
    // 鍵盤（在手底下）
    const K = this.keys;
    c.fillStyle = mixRgba('ink2', 'bone', 0.12);
    c.beginPath(); c.moveTo(K.x - 70, top); c.lineTo(K.x + 70, top); c.lineTo(K.x + 62, top - 8); c.lineTo(K.x - 64, top - 8); c.closePath(); c.fill();
    // 馬克杯（冷掉的咖啡）
    const mx = x1 - 120;
    inkPoly(c, [{ x: mx, y: top - 44 }, { x: mx + 34, y: top - 44 }, { x: mx + 31, y: top }, { x: mx + 3, y: top }], { ink, w: 0.6, t: 0, seed: 8, fill: rgba('ink2'), color: rgba('bone', 0.4) });
    // 小螢幕（建置狀態）：側著朝向宣文，只看得到斜斜的一面（畫面在 render 裡）
    const S = this.small();
    inkPoly(c, S.frame, { ink, w: 0.8, t: 0, seed: 9, fill: rgba('ink'), color: rgba('bone', 0.4) });
    inkLine(c, [{ x: S.cx, y: S.bottom }, { x: S.cx, y: top }], { ink, w: 1.2, t: 0, seed: 10, color: rgba('bone', 0.35) });
    // 大螢幕：外框（有厚度）、支架、底座
    const M = MON;
    inkLine(c, [{ x: M.x + M.w * 0.5, y: M.y + M.h }, { x: M.x + M.w * 0.5 - 10, y: top }], { ink, w: 1.6, t: 0, seed: 11, color: rgba('bone', 0.3) });
    c.fillStyle = rgba('ink2');
    c.fillRect(M.x + M.w * 0.5 - 70, top - 6, 130, 6);
    c.fillStyle = rgba('ink');
    c.fillRect(M.x + 8, M.y + 8, M.w, M.h);
    c.fillStyle = mixRgba('ink', 'bone', 0.03);
    c.fillRect(M.x, M.y, M.w, M.h);
    inkPoly(c, [{ x: M.x, y: M.y }, { x: M.x + M.w, y: M.y }, { x: M.x + M.w, y: M.y + M.h }, { x: M.x, y: M.y + M.h }], { ink, w: 0.8, t: 0, seed: 12, color: rgba('bone', 0.35) });
    // 螢幕上的小字：檔名、上面一條分頁列
    c.fillStyle = rgba('bone', 0.06);
    c.fillRect(M.x + 14, M.y + 14, M.w - 28, 34);
    c.font = font(F.mono(500), 16);
    c.fillStyle = rgba('ash', 0.55);
    c.fillText('wedding.ts', M.x + 34, M.y + 37);
    c.fillStyle = rgba('ash', 0.35);
    c.fillText('build #0313', M.x + M.w - 200, M.y + 37);
    // 程式碼的前兩行（不會變）
    c.font = font(F.mono(400), 17);
    CODE_HEAD.forEach((ln, i) => { c.fillStyle = rgba('ash', 0.3); c.fillText(String(i + 1).padStart(2, ' '), M.x + 30, M.y + 82 + i * 26); c.fillStyle = rgba('bone', 0.34); c.fillText(ln, M.x + 70, M.y + 82 + i * 26); });
    // review 那一塊：左邊一條訊號色的細線、上面一行小小的「review · approved」
    c.fillStyle = rgba('signal', 0.7);
    c.fillRect(CMT.x - 26, CMT.y - 34, 3, CMT.h + 40);
    c.fillStyle = rgba('bone', 0.12);
    c.beginPath(); c.arc(CMT.x + 9, CMT.y - 22, 9, 0, Math.PI * 2); c.fill();
    c.font = font(F.mono(500), 16);
    c.fillStyle = rgba('ash', 0.6);
    c.fillText('review · approved', CMT.x + 28, CMT.y - 16);
    // 左上牆上的小標
    c.font = font(F.mono(500), 17);
    c.fillStyle = rgba('ash', 0.45);
    c.fillText('$ git commit -m', WALL.x, WALL.y);
    L.upload();
  }

  /** 小螢幕（桌上、大螢幕左邊，斜斜地朝向宣文）：外框四個角、畫面中心、下緣。 */
  private small() {
    const top = this.keys.y + 14;
    const x0 = this.deskX0 + 150, x1 = x0 + 170, y0 = top - 250, y1 = top - 80;
    return { frame: [{ x: x0, y: y0 + 18 }, { x: x1, y: y0 }, { x: x1, y: y1 + 8 }, { x: x0, y: y1 }], cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + 4, bottom: y1 + 4 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const bp = au.beatPeriod(t);
    const pass = t >= this.tGreen ? 1 : 0;
    const door = prog(t, this.tDoor, this.tDoor + 0.5, ease.outCubic);
    this.room.u.door!.value = door;
    this.room.u.pass!.value = pass;
    this.room.u.flick!.value = 0.92 + 0.08 * beatKick(au, t, 0.18) + 0.25 * Math.exp(-Math.max(0, t - this.tGreen) / 0.5) * pass;
    this.room.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();

    // ---- 人（這一層最先畫：打光只染紙偶）
    this.drawPeople(c, t, bp);
    puppetLight(c, [0, FLOOR - SZ * 1.2, 1100, SZ * 1.2 + 30], rgba('ink', 0.1), rgba('ink', 0.55));
    sideLight(c, [100, FLOOR - SZ * 1.2, 1000, SZ * 1.2 + 30], mixRgba('bone', 'signal', 0.3 * pass, 0.1), rgba('ink', 0.35));

    // ---- 兩個螢幕的畫面
    this.drawSmall(c, t, pass);
    this.drawCode(c, t);
    this.drawComment(c, t);
    this.drawLyric(c, t);

    // 鍵盤：每一下打字閃一下（綠燈之前；抱住之後手還在鍵盤上，照樣敲）
    const k = beatKick(au, t, 0.12);
    if (t > s + 0.5 && k > 0.05) {
      const e = LIN.ember, K = this.keys;
      this.glow.seg2(K.x - 30 + 30 * hash(Math.floor(au.beatAt(t))), K.y + 8, K.x - 10 + 30 * hash(Math.floor(au.beatAt(t))), K.y + 8, 3, [e[0] * 2, e[1] * 2, e[2] * 2], 0.7 * k);
    }
    // 綠燈的那一下：小螢幕炸一圈火花
    if (t >= this.tGreen && t < this.tGreen + 0.5) {
      const S = this.small();
      sparkParticles(this.glow, t, (tb) => (tb >= this.tGreen && tb < this.tGreen + 0.12 ? { x: S.cx, y: S.cy } : null), { rate: 160, life: 0.4, speed: 260, seed: 7 });
    }

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：整個窗格慢慢推近大螢幕（最多 1.035 倍）
    const push = ease.inOutCubic(f.p);
    const cx = MON.x + MON.w / 2, cy = MON.y + MON.h / 2;
    return { bloom: 0.6, vignette: 0.55, zoom: 1 + 0.035 * push, shake: [-(cx - W / 2) * 0.035 * push, -(cy - H / 2) * 0.035 * push] };
  }

  /** 宣文敲鍵盤（綠燈時舉手歡呼）；孟庭走進來，抱住之後換成兩人一起的紙偶。 */
  private drawPeople(c: CanvasRenderingContext2D, t: number, bp: number) {
    const au = this.ctx.audio, s = this.ctx.start;
    const hugging = this.tHug > 0 && t >= this.tHug;
    // 孟庭（先畫：她走在椅子後面）：門開了之後走進來（一拍一步、一步一彈），走到椅子後面
    if (!hugging && t >= this.tWalk) {
      const u = clamp((t - this.tWalk) / Math.max(0.1, (this.tHug > 0 ? this.tHug : this.ctx.end) - this.tWalk));
      const x = lerp(this.doorX, this.herX, u);
      const b = hop(au.beatAt(t), 1) * 7;
      // 從畫面左邊走進來：一開始只照到門口的暖光（淡入）
      const a = prog(t, this.tWalk, this.tWalk + bp * 0.8);
      puppetShadow(c, 'mt', x, FLOOR, { h: SZ, lift: b, alpha: 0.7 * a, color: '0,0,0' });
      drawCycle(c, au, t, ['mt_work_walk_1', 'mt_work_walk_2'], 1, x, FLOOR - b, { h: SZ, alpha: a, squash: breathe(t, 0.008, 2.6, 0.3) });
    }
    const en = enter(this.glow, t, s + 0.05, AL_X, FLOOR - 6, 1);
    if (en) {
      const base: PuppetOpts = { h: SZ, spin: en.spin, alpha: en.alpha, pivot: 0.3 };
      puppetShadow(c, 'xw', AL_X, FLOOR, { h: SZ, wide: hugging ? 2.2 : 1.5, alpha: 0.8 * en.alpha, color: '0,0,0' });
      if (hugging) {
        // 抱住：每個小節線換一次（宣文轉頭、兩人相視而笑），拍點上一起輕輕晃
        let i = 0;
        for (const b of this.hugBars) if (t >= b) i++;
        const name = i % 2 ? 'cp_work_backhug_2' : 'cp_work_backhug_1';
        const prev = i % 2 ? 'cp_work_backhug_1' : 'cp_work_backhug_2';
        const since = t - (i ? this.hugBars[i - 1]! : this.tHug);
        const o = { ...base, rot: -0.012 * beatKick(au, t, 0.4), squash: breathe(t, 0.01, 2.8) + 0.03 * Math.exp(-(t - this.tHug) / 0.2) };
        const A = this.align[name]!, P = this.align[prev]!;
        drawPuppet(c, name, A.x, A.y, { ...o, scale: A.scale });
        // 換圖時舊的一張疊在上面淡掉（剛抱住的那一下是走路的孟庭＋打字的宣文）
        if (since < 0.06) {
          const fade = { ...o, alpha: (1 - since / 0.06) * en.alpha };
          if (i) drawPuppet(c, prev, P.x, P.y, { ...fade, scale: P.scale });
          else { drawPuppet(c, 'xw_work_type_1', AL_X, FLOOR, fade); drawPuppet(c, 'mt_work_walk_1', this.herX, FLOOR, fade); }
        }
      } else if (t >= this.tGreen && t < this.tGreen + bp * 1.6) {
        // 綠燈：舉手歡呼（整個人往上一送）
        const u = (t - this.tGreen) / (bp * 1.6);
        const A = this.align.xw_work_yes!;
        drawPuppet(c, 'xw_work_yes', A.x, A.y, { ...base, scale: A.scale, squash: -0.04 * Math.sin(Math.PI * clamp(u * 2)) + 0.03 * Math.exp(-(t - this.tGreen) / 0.1) });
      } else {
        // 打字：一拍一下，拍點上身體往前壓一點
        const kick = beatKick(au, t, 0.2);
        drawCycle(c, au, t, ['xw_work_type_1', 'xw_work_type_2'], 1, AL_X, FLOOR, { ...base, rot: 0.012 * kick, squash: 0.012 * kick + breathe(t, 0.008, 3.1) });
      }
    }
    // 抱住的那一刻與之後每個小節線：兩人頭上冒一顆小愛心
    if (this.tHug > 0) {
      for (const b of [this.tHug, ...this.hugBars]) {
        const k = (t - b) / 1.1;
        if (k > 0 && k < 1) heartPop(c, AL_X - SZ * 0.2, FLOOR - SZ * 0.95, 34, k);
      }
    }
  }

  /** 小螢幕：建置狀態。綠燈之前紅色「✕」、一直轉的點；小節線上變綠色「✓」。 */
  private drawSmall(c: CanvasRenderingContext2D, t: number, pass: number) {
    const S = this.small(), au = this.ctx.audio;
    const col = pass ? rgba('gingham') : rgba('collar');
    c.save();
    c.beginPath(); S.frame.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.clip();
    c.fillStyle = pass ? mixRgba('ink', 'gingham', 0.18) : mixRgba('ink', 'collar', 0.14);
    c.fillRect(S.cx - 100, S.cy - 110, 200, 220);
    // 大大的狀態燈（斜著看，壓扁成橢圓）
    const pop = pass ? 1 + 0.25 * Math.exp(-(t - this.tGreen) / 0.12) : 1;
    c.fillStyle = col;
    c.beginPath(); c.ellipse(S.cx, S.cy - 16, 30 * 0.8 * pop, 30 * pop, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('ink', 0.9); c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath();
    if (pass) { c.moveTo(S.cx - 12, S.cy - 16); c.lineTo(S.cx - 3, S.cy - 5); c.lineTo(S.cx + 13, S.cy - 30); }
    else { c.moveTo(S.cx - 10, S.cy - 28); c.lineTo(S.cx + 10, S.cy - 4); c.moveTo(S.cx + 10, S.cy - 28); c.lineTo(S.cx - 10, S.cy - 4); }
    c.stroke();
    // 下面三條測試的進度條：綠燈之前一拍跑一格
    for (let i = 0; i < 3; i++) {
      const y = S.cy + 30 + i * 14;
      c.fillStyle = rgba('bone', 0.1);
      c.fillRect(S.cx - 56, y, 112, 6);
      const fill = pass ? 1 : clamp(((au.beatAt(t) + i * 1.3) % 4) / 4);
      c.fillStyle = pass ? rgba('gingham', 0.8) : rgba('collar', 0.7);
      c.fillRect(S.cx - 56, y, 112 * fill, 6);
    }
    c.restore();
  }

  /** 大螢幕上的程式：一拍打三四個字（從第三行開始），最後一行有一個一閃一閃的游標。 */
  private drawCode(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio, M = MON;
    const typed = Math.max(0, Math.floor((au.beatAt(t) - au.beatAt(this.ctx.start + 0.5)) * 3.5));
    // 把已經打好的字攤開成一行一行；最多顯示兩行（打完的往上捲走，下面要留給 review 留言）
    const lines: string[] = [];
    let left = typed;
    for (const ln of CODE) { if (left <= 0) break; lines.push(ln.slice(0, left)); left -= ln.length; }
    if (!lines.length) lines.push('');
    const show = lines.slice(-2);
    const first = lines.length - show.length;
    c.save();
    c.font = font(F.mono(400), 17);
    show.forEach((ln, i) => {
      const y = M.y + 82 + (i + 1) * 26;
      c.fillStyle = rgba('ash', 0.3);
      c.fillText(String(first + i + 2).padStart(2, ' '), M.x + 30, y);
      c.fillStyle = rgba('bone', 0.5);
      c.fillText(ln, M.x + 70, y);
      if (i === show.length - 1 && Math.floor(t * 2.4) % 2 === 0) {
        c.fillStyle = rgba('signal', 0.8);
        c.fillRect(M.x + 72 + c.measureText(ln).width, y - 15, 9, 19);
      }
    });
    c.restore();
  }

  /** 大螢幕下半部的 review 留言：一個字一個字打出來、寫完署名淡入。 */
  private drawComment(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    writeNote(c, n, CMT.x, CMT.y + 18, t, this.msgT0, { msg: !!this.msg, color: rgba('bone', 0.97), faint: rgba('ash', 0.8), sig: rgba('ash', 0.95), dur: 1.5 });
    c.restore();
  }

  /** 左上牆上的歌詞：照跟唱規則逐字亮。間奏與純音樂時留一行淡淡的「// 編譯中…」。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const ly = lyricAt(this.ctx.lyrics, t);
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    if (ly) {
      const big = !this.msg;
      const st = { family: F.archivo(100, big ? 800 : 700), size: this.lyricSize, minSize: 40, maxWidth: WALL.w, unsung: rgba('bone', 0.24), sung: rgba('bone', big ? 0.94 : 0.84), active: rgba('signal') };
      const lay = layoutLyric(c, ly.line, st);
      c.translate(WALL.x, WALL.y + 26 + lay.size * 0.84);
      drawLyric(c, ly.line, t, st, lay, ly.k);
    } else {
      c.font = font(F.mono(400), 30);
      c.fillStyle = rgba('ash', 0.4);
      c.fillText('// 編譯中…', WALL.x, WALL.y + 62);
    }
    c.restore();
  }
}
