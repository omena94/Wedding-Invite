// 手機燈海（暗、live、慢歌）：慢歌的時候全場亮起手機的手電筒，一片白色的光點左右搖擺像星海；宣文和孟庭靠在一起。
// 角色是 Codex 畫的紙偶（_puppet.ts、素材組 live 的中景 cp_live_near_*：只畫到大腿，鏡頭比較近）；星海、手機是程式畫的（_c9.ts）。
//  - 星海（shader）：看台上一排一排手機的光（近的大、糊成一顆顆光斑），每兩拍往左、往右擺一次，一閃一閃；右下角 HUD 的地方淡掉。
//  - 兩個人：一開始兩人靠在一起、各舉一支開著手電筒的手機跟著慢慢晃（near_sway）；**第一個小節線宣文把手機往前伸向鏡頭**（near_show），
//    手機從他的拳頭一下子放大到鏡頭前面（拍點上），螢幕上是**主打留言**——演唱會裡大家會把手機螢幕的字舉給台上看，這支是舉給新人看的。
//    孟庭一直靠在他肩上，手機的手電筒亮著。手環每兩拍亮一下。
//  - 手機的螢幕照「留言尺寸與版面比例標準 v2」：字 40～60、手機最大 660 × 380，高度跟著留言。沒有留言時宣文不伸手，畫面只有歌詞。
//  - 歌詞在畫面左上（兩人旁邊的暗處），逐字跟唱，比留言小一級；手機在它下面，兩組字不擠在一起。
//  - 鏡頭：整個窗格很慢地推近，像慢歌的長鏡頭。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { lyricAt, barAfter, msgChars, layoutLyric, drawLyric, type LyricStyle } from './_motifs';
import { drawNote, type Note } from './_couple';
import { loadPuppets, hasPuppet, drawPick, puppetPoint, puppetLight, breathe, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { glow, phoneBack, roundRect, type Pt } from './_c9';

export const spec: PlateSpecDecl = { bilingual: true, group: 'couple', family: 'live', paper: false, energy: [0, 0.62], bars: [4, 8] };

/** 中景紙偶：h = 圖的外框（從大腿到舉起來的拳頭）在畫面上的高度；腳底錨點（大腿的切口）在畫面下緣外面。 */
const NH = 900, CX = 860, GROUND = 1130;
const SWAY = 'cp_live_near_sway', SHOW = 'cp_live_near_show';
/** 大手機：最大寬高（標準 v2）、螢幕的內距、手機中心離拳頭多遠。 */
const PHONE = { wMax: 640, hMax: 370, wMin: 460, hMin: 250, dx: -150, dy: 26 };
const PAD = { x: 44, top: 44, bottom: 34 };
/** 歌詞：畫面左上的暗處。 */
const LYR = { x: 110, y: 330, w: 460 };

/**
 * 手機燈海：看台上一排一排手機手電筒的光，近的大、糊成光斑（淺景深），每兩拍往左、往右擺一次、一閃一閃；
 * 只有六成的人開著手電筒。右下角 HUD 的地方淡掉。
 */
const SEA = () => new FSPass(/* glsl */ `
  uniform float uT, uSwing, uOn;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK;
    float cx = (p.x - 960.0) / 960.0;
    float yy = p.y + 34.0 * cx * cx;
    // 排距變化小一點（景深很淺：背景的光斑差不多大）
    float u = clamp((yy - 110.0) / 900.0, 0.0, 1.0);
    float row = floor(20.0 * pow(u, 0.75));
    float y0 = 110.0 + pow(row / 20.0, 1.0 / 0.75) * 900.0;
    float y1 = 110.0 + pow((row + 1.0) / 20.0, 1.0 / 0.75) * 900.0;
    float pitch = max(3.0, y1 - y0);
    float fr = (yy - y0) / pitch;
    float inSea = step(110.0, yy);
    // 看台：很暗，一點點暖色的環境光（場燈都關了，只剩手機）
    col += (C_INK2 * 0.35 + C_BLOOD * 0.02) * inSea * (0.6 + 0.4 * u);
    // 光斑：一格一顆，只在自己那一格裡（邊緣之前降到 0）
    float sx = pitch * 1.55;
    float xr = p.x - uSwing * pitch * 0.55 + hash11(row * 3.7) * sx;
    float cell = floor(xr / sx);
    float h = hash12(vec2(cell, row + 11.0));
    vec2 d = vec2((fract(xr / sx) - 0.5 - (h - 0.5) * 0.25) * sx, (fr - 0.5 - (hash12(vec2(row, cell + 7.0)) - 0.5) * 0.2) * pitch);
    float R = pitch * 0.2 + 0.6;
    float dist = length(d);
    float disc = 1.0 - smoothstep(R * 0.8, R, dist);
    float rim = smoothstep(R * 0.55, R * 0.92, dist) * disc;
    float core = 1.0 - smoothstep(0.0, R * 0.35, dist);
    float tw = 0.75 + 0.25 * sin(uT * (1.3 + 2.0 * h) + h * 40.0);
    float on = step(0.4, h);
    vec3 lc = mix(C_BONE, C_EMBER, step(0.93, h) * 0.6);
    float bright = (disc * 0.22 + rim * 0.18 + core * (0.55 - 0.35 * u)) * tw * on * (1.0 - 0.35 * u);
    float hud = smoothstep(1300.0, 1420.0, p.x) * smoothstep(780.0, 880.0, p.y);
    col += lc * bright * 0.7 * uOn * inSea * (1.0 - hud) * (0.45 + 0.55 * smoothstep(0.0, 0.5, u));
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`, { uT: { value: 0 }, uSwing: { value: 0 }, uOn: { value: 0 } });

export default class Phonelights extends Scene {
  sea = shared('phonelights.sea', SEA);
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  gl = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  keys: [number, string][] = [];
  phone = { w: 0, h: 0 };
  tShow = Infinity;
  msgT0 = 0;
  lyricSize = 52;
  ok = false;

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadText('一位賓客 ·♥100%');
    this.ok = hasPuppet(SWAY);
    this.track(await loadPuppets([SWAY, SHOW].filter(hasPuppet)));
    // 有留言：第一個小節線宣文把手機伸向鏡頭（太晚就在開場後一拍）
    if (this.msg && hasPuppet(SHOW)) {
      this.tShow = barAfter(au, s + 0.5);
      if (this.tShow > s + 2.2) this.tShow = s + Math.min(1.2, au.beatPeriod(s) * 2);
      this.keys = [[-1e9, SWAY], [this.tShow - 0.05, SHOW]];
      this.msgT0 = this.tShow + 0.4;
    } else this.keys = [[-1e9, SWAY]];
    // 手機螢幕上的留言：標準 v2；手機的寬高跟著留言
    const c = this.fg.ctx;
    if (this.msg) {
      const tw = PHONE.wMax - PAD.x * 2, th = PHONE.hMax - PAD.top - PAD.bottom;
      this.note = noteV2(c, this.msg.text, this.msg.name, tw, th);
      this.phone.w = Math.min(PHONE.wMax, Math.max(PHONE.wMin, tightenNote(c, this.note, 300) + PAD.x * 2));
      this.phone.h = Math.min(PHONE.hMax, Math.max(PHONE.hMin, PAD.top + this.note.height + PAD.bottom));
    }
    this.lyricSize = lyricV2(this.note ? this.note.fit.size : null);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const beat = au.beatAt(t);
    const on = prog(t, s, s + 0.6);
    // 兩拍往左、兩拍往右（慢歌的搖擺）
    const swing = Math.sin((beat / 2) * Math.PI);
    const u = this.sea.u;
    u.uT!.value = t; u.uSwing!.value = swing; u.uOn!.value = on;
    this.sea.render(renderer, out);

    const L = this.fg; L.clear();
    const c = L.ctx;
    const G = this.gl; G.clear();
    const g = G.ctx;

    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    let fr = '';
    if (this.ok) {
      const o: PuppetOpts = { h: NH, rot: swing * 0.018, pivot: 0.05, squash: breathe(t, 0.006, 3.8) };
      fr = drawPick(c, this.keys, t, CX, GROUND, o, 0.08);
      // 手機的光從前面照上來：頭與肩膀亮、往下（大腿）暗下去
      puppetLight(c, [CX - 560, 0, 1120, H], rgba('ink', 0.1), rgba('ink', 0.7));
      const pt = (k: string) => puppetPoint(fr, k, CX, GROUND, o);
      // 手環：兩拍亮一下
      const pulse = Math.pow(Math.max(0, Math.cos(beat * Math.PI)), 6);
      for (const k of fr === SHOW ? ['band2'] : ['band', 'band2']) { const b = pt(k); if (b) glow(g, mixRgba('bone', 'signal', 0.35), b.x, b.y, 44, 0.35 + 0.45 * pulse); }  // 伸手的時候宣文的手環在手機後面
      // 舉著的手機（開著手電筒）：孟庭一直舉著；宣文在伸手之前也舉著
      const p2 = pt('phone2');
      if (p2) this.torch(c, g, p2, 0.12 + swing * 0.05);
      const p1 = pt('phone');
      if (p1 && fr === SWAY) this.torch(c, g, p1, -0.15 + swing * 0.05);
      // 伸向鏡頭的大手機（螢幕上是留言）
      if (p1 && fr === SHOW) this.drawPhone(c, t, p1);
    }

    // ---- 歌詞：畫面左上
    const ly = lyricAt(this.ctx.lyrics, t);
    if (ly) {
      const st: LyricStyle = { family: F.archivo(100, 700), size: this.lyricSize, minSize: 40, maxWidth: LYR.w, align: 'left', active: rgba('signal'), sung: rgba('bone', 0.95), unsung: rgba('bone', 0.3) };
      const lay = layoutLyric(c, ly.line, st);
      c.save();
      c.translate(LYR.x, LYR.y - (lay.height - lay.size) / 2);
      drawLyric(c, ly.line, t, st, lay, ly.k * on);
      c.restore();
    }

    comp.draw(renderer, L.upload(), out);
    comp.draw(renderer, G.upload(), out, { mode: 'add', tint: [1.6, 1.6, 1.6] });
    // 鏡頭：很慢地推近（慢歌的長鏡頭）
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.8, vignette: 0.6, zoom: 1 + 0.04 * push, shake: [-(CX - 200 - W / 2) * 0.04 * push, -40 * 0.04 * push] };
  }

  /** 舉著的手機：背面朝鏡頭、手電筒亮著（光暈在加亮層）。 */
  private torch(c: CanvasRenderingContext2D, g: CanvasRenderingContext2D, fist: Pt, ang: number) {
    const fl = phoneBack(c, fist, ang, NH * 0.62);
    glow(g, rgba('bone'), fl.x, fl.y, 70, 0.9);
    glow(g, rgba('bone'), fl.x, fl.y, 18, 1);
  }

  /**
   * 伸向鏡頭的大手機：小節線上從拳頭的位置一下子放大到鏡頭前（outBack），螢幕朝鏡頭、上面是留言（一個字一個字打出來，署名淡入）。
   * 手機蓋在拳頭前面（手指被機身擋住）；螢幕暗色、手寫字、左上一道玻璃的反光，機身一圈細亮邊。
   */
  private drawPhone(c: CanvasRenderingContext2D, t: number, fist: Pt) {
    const n = this.note;
    if (!n) return;
    const k = ease.outBack(prog(t, this.tShow, this.tShow + 0.38));
    if (k <= 0.01) return;
    const P = this.phone;
    const cx = fist.x + PHONE.dx * k, cy = fist.y + PHONE.dy * k;
    const sc = 0.2 + 0.8 * k;
    const w = P.w * sc, h = P.h * sc;
    const x = cx - w / 2, y = cy - h / 2;
    c.save();
    // 機身與影子
    c.fillStyle = rgba('ink', 0.45);
    roundRect(c, x + 14 * sc, y + 18 * sc, w, h, 34 * sc); c.fill();
    c.fillStyle = mixRgba('ink', 'graphite', 0.25);
    roundRect(c, x, y, w, h, 34 * sc); c.fill();
    c.strokeStyle = mixRgba('bone', 'signal', 0.2, 0.5);
    c.lineWidth = 2;
    c.stroke();
    // 螢幕
    const b = 12 * sc;
    const scr = c.createLinearGradient(0, y, 0, y + h);
    scr.addColorStop(0, mixRgba('ink2', 'signal', 0.08));
    scr.addColorStop(1, rgba('ink2'));
    c.fillStyle = scr;
    roundRect(c, x + b, y + b, w - b * 2, h - b * 2, 24 * sc); c.fill();
    // 玻璃的反光：左上一道很淡的斜光
    c.save();
    roundRect(c, x + b, y + b, w - b * 2, h - b * 2, 24 * sc); c.clip();
    const gl = c.createLinearGradient(x, y, x + w * 0.5, y + h);
    gl.addColorStop(0, rgba('bone', 0.08)); gl.addColorStop(0.45, rgba('bone', 0.02)); gl.addColorStop(0.46, rgba('bone', 0)); gl.addColorStop(1, rgba('bone', 0));
    c.fillStyle = gl;
    c.fillRect(x, y, w, h);
    c.restore();
    // 前鏡頭（橫拿時在左邊中間）
    c.fillStyle = rgba('ink');
    c.beginPath(); c.arc(x + b * 0.5 + 2, cy, Math.max(1.5, 4 * sc), 0, Math.PI * 2); c.fill();
    c.restore();
    if (k < 0.95) return;
    const total = msgChars(n.fit);
    const per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    const done = this.msgT0 + total * per;
    const top = y + PAD.top, hh = P.h - PAD.top - PAD.bottom;
    drawNote(c, n, x + (P.w - n.width) / 2, top + Math.max(0, (hh - n.height) * 0.45), {
      chars: (t - this.msgT0) / per, color: rgba('bone', 0.96), sigColor: rgba('ash', 0.95), sigK: prog(t, done + 0.1, done + 0.5),
    });
    // 字寫在螢幕上：沒有別的介面元素，只有右上角一顆很小的電量格（冷面的小細節）
    c.save();
    c.font = font(F.mono(500), 15);
    c.fillStyle = rgba('ash', 0.45);
    c.textAlign = 'right';
    c.fillText('100%', x + P.w - 30, y + 30);
    c.restore();
  }
}
