// 共撐一把傘（暗、date）：下雨的夜晚街角，宣文和孟庭擠在同一把傘下，從左邊走進來（一拍一步），在小節線停在路燈下、面對面。
// 角色是 Codex 畫的紙偶（_puppet.ts）；傘也是圖上畫好的，程式只用圖上量好的傘緣（道具點 rimL、top、rimR）算「傘下是乾的」。
//  - 雨：斜斜的細線（GPU 線），在 hi-hat 上一起亮一下；路燈的光錐裡特別亮。**雨打到傘就停**（傘下沒有雨），傘緣濺起小水花。
//  - 地上是濕的：兩人的倒影（上下顛倒、淡、被細細的波紋切開）、路燈的倒影一條光；右邊咖啡店的遮雨棚在拍點上滴水。
//  - **歌詞在水坑裡**：地上一窪水，歌詞一個字一個字浮在水面上跟唱（每個字輕輕晃），雨滴落下的漣漪在 hi-hat 上一圈一圈擴開。
//    韓文歌有中文翻譯時（2026-09-30）：中文往上浮一點，原文小一號浮在它下面（原文自己的逐字時間，唱到、唱完都是白色、淡一點）。
//  - **焦點是主打留言**：右邊咖啡店亮著暖光的大玻璃窗，留言像寫在玻璃上的手寫字（淺色），玻璃上有幾道往下流的雨痕；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、窗最大 700 × 380，高度跟著留言。沒有留言時窗上寫邀請、字淡，歌詞變主角。
//  - 暗版面：紙偶打光（上面被路燈照到、腳底暗，_c3 的 Lit）。鏡頭跟著兩人往右搖一點，停下來之後慢慢推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, barAfter, msgChars, lyricSubOf, subSizeFor, subGap } from './_motifs';
import { drawNote, type Note, type Pt } from './_couple';
import { loadPuppets, drawPuppet, puppetShadow, puppetIn, puppetBox, puppetPoint, breathe, beatKick, landSquash, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { Lit, layoutChars, drawChars, INVITE } from './_c3';
import type { Lyrics } from '../engine/lyrics';

export const spec: PlateSpecDecl = { group: 'couple', family: 'date', paper: false, energy: [0, 0.7], bars: [4, 8] };

const SZ = 480;
/** 撐傘的圖連傘一起量（傘頂到腳底 656、宣文 600，見 c3-date 的 sprites.json）：放大回來，宣文才是 SZ 高。 */
const UMB = 656 / 600;
/** 人行道（腳底）。 */
const FLOOR = 842;
/** 路燈：柱子 x、燈頭 y；兩人停下來的地方（燈下）。 */
const LAMP = { x: 700, y: 176 };
const STOP_X = 660;
/** 咖啡店的玻璃窗：最大範圍（標準 v2）與寫字內距；遮雨棚在窗的上面。 */
const WIN = { x: 1070, y: 250, w: 700, h: 380 };
const PAD = { x: 44, top: 44, bottom: 34 };
/** 地上的水坑（歌詞浮在上面）：中心、半徑；歌詞基線。 */
const PUDDLE = { cx: 700, cy: 952, rx: 560, ry: 58 };
const LYR_Y = 972;
const POSES = ['cp_umbrella_walk_1', 'cp_umbrella_walk_2', 'cp_umbrella_stop'];
const RAIN = 260;

/** 街角：天空很暗、遠處的樓；路燈一圈暖光、濕的地面上一條燈的倒影。 */
const STREET = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float ground = smoothstep(${FLOOR - 1}.0, ${FLOOR + 1}.0, p.y);
    vec3 col = mix(C_INK2, C_INK, 0.3 + 0.5 * p.y / ${H}.0);
    // 路燈的光錐：從燈頭往下張開
    float dy = max(p.y - ${LAMP.y}.0, 0.0);
    float cone = exp(-pow((p.x - ${LAMP.x}.0) / (40.0 + dy * 0.42), 2.0)) * smoothstep(${LAMP.y}.0, ${LAMP.y + 40}.0, p.y) * (1.0 - ground);
    vec2 q = (p - vec2(${LAMP.x}.0, ${LAMP.y}.0)) / vec2(160.0, 120.0);
    float halo = exp(-dot(q, q) * 1.6);
    col += mix(C_EMBER, C_BONE, 0.4) * (0.035 * cone + 0.08 * halo);
    // 濕的地面：暗、燈的倒影是一條往下拉長的光（被細波紋切開）
    float gy = p.y - ${FLOOR}.0;
    float refl = exp(-pow((p.x - ${LAMP.x}.0) / (26.0 + gy * 0.12), 2.0)) * exp(-gy / 190.0) * ground;
    float rip = 0.65 + 0.35 * sin(gy * 0.9 + sin(p.x * 0.05) * 2.0);
    col = mix(col, C_INK * 0.85, ground * 0.5);
    col += mix(C_EMBER, C_BONE, 0.4) * 0.07 * refl * rip;
    // 窗的暖光灑在地上
    vec2 w = (p - vec2(${WIN.x + WIN.w / 2}.0, ${FLOOR + 40}.0)) / vec2(520.0, 90.0);
    col += C_EMBER * 0.02 * exp(-dot(w, w) * 1.4) * ground;
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

export default class Umbrella extends Scene {
  street = shared('umbrella.street', STREET);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  rain = this.track(new LineBatch(RAIN * 2 + 256, { screen2D: true, blend: 'add' }));
  lit = new Lit(1000, 1000);
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  win = { ...WIN };
  lyricSize = 50;
  /** 起步、停下（小節線）的拍。 */
  b0 = 0;
  bStop = 0;
  tStop = 0;
  x0 = -260;

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(POSES));
    // 走幾拍：窗格的前三分之一左右（至少一小節），停下來的那一下在小節線
    this.b0 = Math.ceil(au.beatAt(this.ctx.start + 0.1) - 1e-6);
    const bar = au.timeOfBar(Math.round(au.barAt(this.ctx.start)) + 1) - au.timeOfBar(Math.round(au.barAt(this.ctx.start)));
    const want = this.ctx.start + clamp((this.ctx.end - this.ctx.start) * 0.3, bar * 0.8, bar * 2.2);
    this.tStop = barAfter(au, want);
    this.bStop = Math.round(au.beatAt(this.tStop));
    if (this.bStop - this.b0 < 3) { this.bStop = this.b0 + 3; this.tStop = au.timeOfBeat(this.bStop); }
    // 玻璃窗上的留言：標準 v2 的字級；窗的寬高跟著留言（上緣固定）
    const c = this.fg.ctx;
    const w = WIN.w - PAD.x * 2, hmax = WIN.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.55, { max: 44 });
    const ww = Math.min(WIN.w, Math.max(tightenNote(c, this.note, 400) + PAD.x * 2, 500));
    const wh = Math.min(WIN.h, Math.max(230, PAD.top + this.note.height + PAD.bottom + 8));
    this.win = { x: WIN.x + WIN.w - ww, y: WIN.y, w: ww, h: wh };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.drawBackground();
  }

  /** 不會動的：遠處的樓與窗、路燈、咖啡店的門面與暖光的玻璃窗、遮雨棚、人行道的邊。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    // 遠處的樓（剪影）與幾扇亮著的窗
    c.fillStyle = rgba('ink', 0.75);
    const blds: [number, number, number][] = [[0, 520, 260], [240, 430, 200], [420, 560, 180], [820, 470, 240]];
    for (const [x, top, w] of blds) c.fillRect(x, top, w, FLOOR - top);
    c.fillStyle = mixRgba('ember', 'ink', 0.55, 0.5);
    for (let i = 0; i < 18; i++) {
      const b = blds[i % blds.length]!;
      if (hash(i, 3) < 0.45) continue;
      c.fillRect(b[0] + 20 + Math.floor(hash(i, 1) * (b[2] - 50)), b[1] + 30 + Math.floor(hash(i, 2) * 200), 12, 16);
    }
    // 咖啡店：門面（比背景亮一點的牆）、暖光的玻璃窗、窗框
    const K = this.win;
    c.fillStyle = mixRgba('ink2', 'bone', 0.03);
    c.fillRect(K.x - 60, 120, W - (K.x - 60), FLOOR - 120);
    const g = c.createLinearGradient(0, K.y, 0, K.y + K.h);
    // 店裡是暖黃的燈（固定的橘色，不跟主題換：鎢絲燈的顏色）；上面亮、下面暗一點
    g.addColorStop(0, mixRgba('fur', 'ink', 0.42));
    g.addColorStop(1, mixRgba('fur', 'ink', 0.64));
    c.fillStyle = g;
    c.fillRect(K.x, K.y, K.w, K.h);
    // 兩盞吊燈：細線垂下來、燈罩、往下的一團光
    for (const fx of [0.22, 0.78]) {
      const lx = K.x + K.w * fx, ly = K.y + 34;
      const rg = c.createRadialGradient(lx, ly + 20, 0, lx, ly + 20, 150);
      rg.addColorStop(0, mixRgba('fur', 'bone', 0.5, 0.22));
      rg.addColorStop(1, mixRgba('fur', 'bone', 0.5, 0));
      c.fillStyle = rg;
      c.fillRect(lx - 150, ly - 40, 300, 220);
      c.strokeStyle = rgba('ink', 0.5);
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(lx, K.y); c.lineTo(lx, ly - 8); c.stroke();
      c.fillStyle = rgba('ink', 0.55);
      c.beginPath(); c.moveTo(lx - 16, ly + 6); c.lineTo(lx + 16, ly + 6); c.lineTo(lx + 8, ly - 8); c.lineTo(lx - 8, ly - 8); c.closePath(); c.fill();
      c.fillStyle = mixRgba('fur', 'bone', 0.6);
      c.beginPath(); c.ellipse(lx, ly + 7, 12, 3, 0, 0, Math.PI * 2); c.fill();
    }
    // 窗裡面：吧台的影子（很淡，不搶字）
    c.fillStyle = rgba('ink', 0.22);
    c.fillRect(K.x, K.y + K.h * 0.8, K.w, K.h * 0.2);
    // 玻璃的反光：兩道斜的淡光
    c.save();
    c.beginPath(); c.rect(K.x, K.y, K.w, K.h); c.clip();
    c.fillStyle = rgba('bone', 0.05);
    for (const off of [0.18, 0.3]) {
      const x0 = K.x + K.w * off;
      c.beginPath(); c.moveTo(x0, K.y); c.lineTo(x0 + 70, K.y); c.lineTo(x0 - 90, K.y + K.h); c.lineTo(x0 - 160, K.y + K.h); c.closePath(); c.fill();
    }
    c.restore();
    c.strokeStyle = rgba('ink', 0.9);
    c.lineWidth = 10;
    c.strokeRect(K.x - 5, K.y - 5, K.w + 10, K.h + 10);
    // 窗下的牆裙與門
    c.fillStyle = rgba('ink', 0.4);
    c.fillRect(K.x - 60, K.y + K.h + 5, W - (K.x - 60), FLOOR - (K.y + K.h + 5));
    // 遮雨棚：窗上面一片斜斜的條紋布
    const aw = { x0: K.x - 50, x1: Math.min(W - 40, K.x + K.w + 40), y0: K.y - 90, y1: K.y - 24 };
    for (let x = aw.x0, i = 0; x < aw.x1; x += 44, i++) {
      c.fillStyle = i % 2 ? mixRgba('bone', 'ink', 0.72) : mixRgba('signal', 'ink', 0.72);
      c.beginPath(); c.moveTo(x, aw.y0); c.lineTo(Math.min(x + 44, aw.x1), aw.y0); c.lineTo(Math.min(x + 44, aw.x1) + 8, aw.y1); c.lineTo(x + 8, aw.y1); c.closePath(); c.fill();
    }
    // 路燈：細柱、燈頭
    c.strokeStyle = rgba('ink', 0.95);
    c.lineWidth = 10;
    // 柱子在兩人停下來的地方右邊，燈臂彎回來把燈頭伸到兩人頭上
    c.beginPath(); c.moveTo(LAMP.x + 190, FLOOR + 4); c.lineTo(LAMP.x + 190, LAMP.y + 30); c.quadraticCurveTo(LAMP.x + 190, LAMP.y - 22, LAMP.x + 120, LAMP.y - 20); c.lineTo(LAMP.x + 20, LAMP.y - 18); c.stroke();
    c.fillStyle = rgba('ink', 0.95);
    c.beginPath(); c.moveTo(LAMP.x - 34, LAMP.y); c.lineTo(LAMP.x + 34, LAMP.y); c.lineTo(LAMP.x + 20, LAMP.y - 24); c.lineTo(LAMP.x - 20, LAMP.y - 24); c.closePath(); c.fill();
    c.fillStyle = mixRgba('ember', 'bone', 0.5);
    c.beginPath(); c.ellipse(LAMP.x, LAMP.y + 2, 26, 6, 0, 0, Math.PI * 2); c.fill();
    // 人行道的邊（一條淡淡的亮線）
    c.fillStyle = rgba('bone', 0.06);
    c.fillRect(0, FLOOR + 2, W, 2);
    // 水坑：比地面更暗、邊緣有一圈很淡的亮
    c.save();
    c.translate(PUDDLE.cx, PUDDLE.cy);
    c.scale(1, PUDDLE.ry / PUDDLE.rx);
    const pg = c.createRadialGradient(0, 0, PUDDLE.rx * 0.6, 0, 0, PUDDLE.rx);
    pg.addColorStop(0, rgba('ink', 0.55));
    pg.addColorStop(0.92, rgba('ink', 0.45));
    pg.addColorStop(1, rgba('ink', 0));
    c.fillStyle = pg;
    c.beginPath(); c.arc(0, 0, PUDDLE.rx, 0, Math.PI * 2); c.fill();
    c.restore();
    L.upload();
  }

  /** 兩人這一格在哪：一拍一步往右走（拍點上一步落地），停在燈下。 */
  private coupleAt(t: number) {
    const au = this.ctx.audio;
    const steps = this.bStop - this.b0;
    const b = au.beatAt(t) - this.b0;
    const stride = (STOP_X - this.x0) / steps;
    if (b >= steps) return { x: STOP_X, walking: false, u: 0, i: steps };
    const i = Math.floor(Math.max(b, 0)), u = Math.max(b, 0) - i;
    return { x: this.x0 + stride * (Math.max(b, 0)), walking: true, u, i };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.street.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.rain.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);
    const hat = f.a.hat;

    this.drawWindowText(c, t);

    // ---- 兩人（倒影先畫、再畫本人）
    const P = this.coupleAt(t);
    const name = P.walking ? (P.i % 2 === 0 ? 'cp_umbrella_walk_1' : 'cp_umbrella_walk_2') : 'cp_umbrella_stop';
    const squash = P.walking ? 0.03 * Math.exp(-P.u / 0.14) : landSquash(t, this.tStop, 0.07, 0.3) + breathe(t, 0.006, 3.2) + 0.008 * beatKick(au, t, 0.3);
    const lift = P.walking ? 6 * Math.sin(Math.PI * P.u) : 0;
    const o: PuppetOpts = { h: SZ, scale: UMB, squash, rot: P.walking ? 0.015 * Math.sin(Math.PI * 2 * P.u) : 0, pivot: 0.2 };
    const box = puppetBox('cp_umbrella_stop', P.x, FLOOR, { h: SZ, scale: UMB });
    const pad = 60;
    const lb: [number, number, number, number] = [box[0] - pad, box[1] - pad, box[2] + pad * 2, box[3] + pad * 1.5];
    puppetShadow(c, 'cp', P.x, FLOOR, { h: SZ, wide: 1.2, alpha: 0.6, color: '0,0,0' });
    this.lit.draw(c, lb, rgba('ink', 0.02), rgba('ink', 0.5), (sc) => drawPuppet(sc, name, P.x, FLOOR - lift, o));
    // 倒影：同一張染好的紙偶上下顛倒再貼一次（不重畫紙偶）、很淡，被幾條水平的暗線切開（濕地上的波紋）
    c.save();
    c.globalAlpha = 0.1;
    c.translate(0, FLOOR * 2 + 6);
    c.scale(1, -1);
    this.lit.again(c);
    c.restore();
    c.fillStyle = rgba('ink', 0.35);
    for (let i = 0; i < 9; i++) {
      const y = FLOOR + 12 + i * 16 + ((t * 20 + i * 7) % 16);
      c.fillRect(P.x - box[2] * 0.6, y, box[2] * 1.2, 3);
    }

    // 傘：從圖上的道具點量出來的傘緣（沒有量到就用外框估）
    const rimL = puppetPoint(name, 'rimL', P.x, FLOOR - lift, o) ?? { x: box[0] + box[2] * 0.08, y: box[1] + box[3] * 0.2 };
    const rimR = puppetPoint(name, 'rimR', P.x, FLOOR - lift, o) ?? { x: box[0] + box[2] * 0.92, y: box[1] + box[3] * 0.2 };
    const top = puppetPoint(name, 'top', P.x, FLOOR - lift, o) ?? { x: box[0] + box[2] * 0.5, y: box[1] };

    this.drawRain(t, hat, rimL, top, rimR);
    this.drawPuddle(c, t, lyrics, rv, hat);
    this.drawDrips(c, t);

    comp.draw(renderer, L.upload(), out);
    if (this.rain.count) this.rain.render(renderer, out);
    // 鏡頭：跟著兩人往右搖一點，停下來之後慢慢推近
    const push = ease.inOutCubic(prog(t, this.tStop, this.ctx.end));
    return { bloom: 0.6, vignette: 0.55, grain: 0.055, zoom: 1.02 + 0.025 * push, shake: [-(lerp(P.x, 960, 0.6) - W / 2) * 0.04, -(560 - H / 2) * 0.03 * push] };
  }

  /**
   * 雨：斜斜往下的細線，hi-hat 上一起亮一下、路燈的光錐裡亮很多。碰到傘面就停（傘下是乾的），傘緣濺起一點水花。
   */
  private drawRain(t: number, hat: number, rimL: Pt, top: Pt, rimR: Pt) {
    const bone = LIN.bone, ember = LIN.ember;
    const slant = 0.2, speed = 1500, len = 56;
    // 傘面：左緣 → 頂 → 右緣 的折線（線性插值），在這個 x 範圍內，雨下到傘面就停
    const canopyY = (x: number) => {
      if (x < rimL.x || x > rimR.x) return Infinity;
      return x < top.x ? lerp(rimL.y, top.y, (x - rimL.x) / Math.max(1, top.x - rimL.x)) : lerp(top.y, rimR.y, (x - top.x) / Math.max(1, rimR.x - top.x));
    };
    for (let i = 0; i < RAIN; i++) {
      const y1 = ((t * speed * (0.85 + 0.3 * hash(i, 2)) + hash(i, 3) * 1400) % 1400) - 160;
      const y0 = y1 - len;
      const xb = hash(i, 1) * 2200 - 150;
      const x0 = xb + y0 * slant;
      let x1 = xb + y1 * slant;
      let yy1 = y1;
      const cy = canopyY(x1);
      if (yy1 > cy) {
        if (y0 > cy) continue;
        // 打到傘面：截在傘面上
        const k = (cy - y0) / (y1 - y0);
        yy1 = cy; x1 = x0 + (x1 - x0) * k;
      }
      // 地面以下不畫（打在地上）；右下角 HUD 區（x ≥ 1340）在 y 820 就停，那一塊保持乾淨
      const bottom = x1 > 1340 ? 820 : FLOOR + 40;
      if (y0 > bottom) continue;
      if (yy1 > bottom) { const k = (bottom - y0) / (yy1 - y0); yy1 = bottom; x1 = x0 + (x1 - x0) * k; }
      const cone = Math.exp(-(((x1 - LAMP.x) / (40 + Math.max(0, yy1 - LAMP.y) * 0.42)) ** 2)) * (yy1 > LAMP.y ? 1 : 0);
      const a = (0.08 + 0.1 * hat) + cone * (0.35 + 0.25 * hat);
      const col: [number, number, number] = [lerp(bone[0], ember[0], cone * 0.5), lerp(bone[1], ember[1], cone * 0.5), lerp(bone[2], ember[2], cone * 0.5)];
      this.rain.polyline([{ x: x0, y: y0 }, { x: x1, y: yy1 }], 1.2, col, a);
    }
    // 傘緣滴下來的水珠：兩邊各一串，拍點上掉一滴
    const au = this.ctx.audio;
    const b = au.beatAt(t), u = b - Math.floor(b);
    for (const r of [rimL, rimR]) {
      const y = r.y + 4 + u * u * 160;
      if (y > FLOOR) continue;
      this.rain.polyline([{ x: r.x, y }, { x: r.x, y: y + 10 }], 2, [bone[0], bone[1], bone[2]], 0.4 * (1 - u));
    }
  }

  /** 水坑：歌詞浮在水面上（每個字輕輕上下晃），hi-hat 上雨滴落下、一圈一圈的漣漪。 */
  private drawPuddle(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics, rv: number, hat: number) {
    const au = this.ctx.audio;
    // 漣漪：每半拍一顆，位置用種子挑，在水坑裡擴開
    const hb = Math.floor(au.beatAt(t) * 2);
    c.save();
    c.lineWidth = 1.4;
    for (let k = hb - 3; k <= hb; k++) {
      const t0 = au.timeOfBeat(k / 2), d = (t - t0) / 1.1;
      if (d < 0 || d > 1) continue;
      const a = hash(k, 1) * Math.PI * 2, r = Math.sqrt(hash(k, 2)) * 0.85;
      const x = PUDDLE.cx + Math.cos(a) * PUDDLE.rx * r, y = PUDDLE.cy + Math.sin(a) * PUDDLE.ry * r;
      c.strokeStyle = rgba('bone', 0.22 * (1 - d) * (0.6 + 0.6 * hat));
      c.beginPath(); c.ellipse(x, y, 8 + 70 * d, (8 + 70 * d) * 0.22, 0, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
    const ly = lyricAt(lyrics, t);
    if (!ly) return;
    const fam = F.archivo(100, this.msg ? 600 : 700);
    const lay = layoutChars(c, ly.line, fam, this.lyricSize, PUDDLE.rx * 1.75, 40);
    const sub = lyricSubOf(ly.line);
    // 原文副行：歌詞基線離下緣只剩一百多 px，放不下第二排——中文往上浮一個副行的距離，原文浮在原本的基線上
    const y = sub ? LYR_Y - subGap(lay.size) : LYR_Y;
    const sung = rgba('bone', this.msg ? 0.8 : 0.94);
    c.save();
    c.globalAlpha = ly.k * rv;
    drawChars(c, ly.line, lay, fam, PUDDLE.cx - lay.width / 2, y, t, { unsung: rgba('bone', 0.26), sung, active: rgba('signal') },
      (i) => ({ dy: Math.sin(t * 2.2 + i * 0.7) * 2.5, rot: Math.sin(t * 1.7 + i) * 0.03 }));
    c.restore();
    if (sub) {
      // 同一窪水、一樣輕輕晃（相位錯開）；比中文安靜：唱到、唱完都是唱完的白、淡兩成，不用訊號色
      const ss = subSizeFor(lay.size);
      const sl = layoutChars(c, sub, fam, ss, PUDDLE.rx * 1.75, Math.min(ss, 26));
      const quiet = rgba('bone', (this.msg ? 0.8 : 0.94) * 0.8);
      c.save();
      c.globalAlpha = ly.k * rv;
      drawChars(c, sub, sl, fam, PUDDLE.cx - sl.width / 2, LYR_Y, t, { unsung: rgba('bone', 0.26), sung: quiet, active: quiet },
        (i) => ({ dy: Math.sin(t * 2.2 + i * 0.7 + 1.3) * 2, rot: Math.sin(t * 1.7 + i + 0.6) * 0.025 }));
      c.restore();
    }
  }

  /** 遮雨棚在拍點上滴水：棚的前緣掉下幾滴，落到地上濺開。 */
  private drawDrips(c: CanvasRenderingContext2D, t: number) {
    const au = this.ctx.audio;
    const K = this.win, x0 = K.x - 40, x1 = Math.min(W - 40, K.x + K.w + 40), y0 = K.y - 24;
    const b = Math.floor(au.beatAt(t));
    c.save();
    for (let k = b - 1; k <= b; k++) {
      const tb = au.timeOfBeat(k), d = t - tb;
      if (d < 0) continue;
      for (let j = 0; j < 3; j++) {
        const x = lerp(x0, x1, hash(k, j, 4));
        if (x > 1340) continue;
        const y = y0 + 0.5 * 2600 * d * d;
        if (y < FLOOR) {
          c.fillStyle = rgba('bone', 0.5);
          c.beginPath(); c.ellipse(x, y, 2, 5, 0, 0, Math.PI * 2); c.fill();
        } else {
          const e = (d - Math.sqrt((2 * (FLOOR - y0)) / 2600)) / 0.3;
          if (e < 0 || e > 1) continue;
          c.strokeStyle = rgba('bone', 0.3 * (1 - e));
          c.beginPath(); c.ellipse(x, FLOOR + 6, 6 + 26 * e, (6 + 26 * e) * 0.25, 0, 0, Math.PI * 2); c.stroke();
        }
      }
    }
    c.restore();
  }

  /** 玻璃窗上的留言：開場後一個字一個字寫上去（淺色手寫字），寫完署名淡入；幾道雨痕從上往下流（在字的旁邊）。 */
  private drawWindowText(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const K = this.win;
    const t0 = this.ctx.start + 0.6;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.1);
    const done = t0 + total * per;
    const top = K.y + PAD.top, h = K.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    drawNote(c, n, K.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('bone', 0.95) : rgba('bone', 0.6), sigColor: rgba('bone', 0.72), sigK: prog(t, done + 0.1, done + 0.5),
    });
    // 雨痕：玻璃上幾條往下流的細線（淡）
    c.strokeStyle = rgba('bone', 0.1);
    c.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const x = K.x + 16 + hash(i, 7) * (K.w - 32), ph = ((t - this.ctx.start) * (0.08 + 0.06 * hash(i, 8)) + hash(i, 9)) % 1;
      const y1 = K.y + ph * K.h;
      c.beginPath(); c.moveTo(x, Math.max(K.y, y1 - 60)); c.lineTo(x + 1, y1); c.stroke();
      c.fillStyle = rgba('bone', 0.16);
      c.beginPath(); c.arc(x + 1, y1, 2.5, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
}
