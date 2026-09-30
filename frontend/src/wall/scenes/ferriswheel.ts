// 摩天輪（暗、date、日常服一）：鏡頭在摩天輪的車廂裡，宣文與孟庭並肩坐在後面的長椅上（正面），孟庭靠在宣文肩上；
// 身後是一整片大窗，窗外是巨大的摩天輪——細線的輪框（兩圈＋之字形的桁架）從窗子上緣拱過去，輻條往下收向看不到的輪軸，
// 輪框上的燈泡照拍子一顆一顆跑（小節線上全部一閃），別的車廂慢慢從輪框下經過，再往下是很遠的城市燈海。
// 角色是 Codex 畫的紙偶（cp_gondola_1、_2，_puppet.ts），車廂、摩天輪、城市、字是程式畫的。
//  - **主打留言**：右半邊的窗玻璃起了一層霧，孟庭往窗外一指（cp_gondola_2），霧上就一個字一個字被寫出留言——字是擦掉霧的地方，
//    透出後面的夜空（深色的字、淡霧的底），寫完署名、再一個小節線孟庭靠回宣文肩上。照標準 v2：字 40～60、署名 26～32，霧的那一塊 ≤ 780 × 430。
//    沒有留言時霧上寫邀請（字小）。
//  - 歌詞：沿著窗外的輪框（拱形）逐字亮，火花騎在正在唱的字上。輪框是繞輪軸轉的圓，轉起來形狀不變，所以歌詞穩穩地貼在上面；
//    燈泡、輻條、別的車廂才看得出在轉。比留言小一級。
//  - 車廂輕輕晃（窗外的景跟著反方向晃），兩人跟著拍子輕輕點頭；鏡頭整個窗格慢慢推近。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, loadText } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import { lyricAt, lyricSubOf, subGap, barAfter, beatAfter, sparkHead, msgChars } from './_motifs';
import { lyricOnPath, drawNote, type Pt, type Note } from './_couple';
import { loadPuppets, drawPick, puppetShadow, puppetIn, puppetLight, breathe, beatKick, noteV2, tightenNote } from './_puppet';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'date', paper: false, energy: [0, 0.8], bars: [4, 8] };

/** 兩人坐的位置（腳底錨點）與場景尺度（坐姿那張圖的高度）。 */
const CX = 600, FEET = 1030, SZ = 700;
/** 長椅的座面高度（坐姿那張圖的屁股約在身高的 46%）。 */
const SEAT = FEET - SZ * 0.46;
/** 大窗（車廂的後牆）：左、上、右、下。 */
const WIN = { x0: 70, y0: 70, x1: 1850, y1: 760 };
/** 右半邊起霧、寫留言的那一塊（最大；標準 v2）。 */
const FOG = { x: 1080, y: 250, w: 740, h: 420 };
const PAD = 40;
/** 摩天輪：輪軸在畫面下方很遠的地方，輪框從窗子上緣拱過去；轉速（弧度／秒）。 */
const HUB = { x: 900, y: 2500 }, R_OUT = 2280, R_IN = 2230, SPIN = 0.012;
const INVITE = '掃描右下角 QR code，把祝福寫上大螢幕';
const SPRITES = ['cp_gondola_1', 'cp_gondola_2'];

/** 窗外的夜空：上面深、往下（城市那邊）越暖，加一點點光害的霧。 */
const SKY = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float y = p.y / ${H}.0;
    vec3 col = mix(C_INK, mix(C_INK2, C_BLOOD, 0.3), smoothstep(0.1, 0.75, y));
    col += C_SIGNAL * 0.035 * exp(-pow((p.y - 700.0) / 160.0, 2.0));
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

export default class Ferriswheel extends Scene {
  sky = shared('ferriswheel.sky', SKY);
  /** 窗外的城市燈海（低解析度：很遠、本來就是散景）。 */
  city = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  /** 車廂內部（牆、窗框、長椅），窗子挖空；畫一次。 */
  cabin = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  /** 摩天輪的細線與燈泡（畫在車廂的牆後面）。 */
  wheel = this.track(new LineBatch(4096, { screen2D: true, blend: 'add' }));
  glow = this.track(new LineBatch(512, { screen2D: true, blend: 'add' }));
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  fogBox = { ...FOG };
  /** 霧的底圖（畫一次）與寫字用的畫布（寫的時候每格重畫，寫完就不再動）。 */
  fogBase: HTMLCanvasElement | null = null;
  fogCv: HTMLCanvasElement | null = null;
  fogShown = -1;
  keys: [number, string][] = [];
  tw0 = 0; per = 0.05; twd = 0;
  lyricSize = 52;
  rimPath: Pt[] = [];

  override async init() {
    const { audio: au } = this.ctx;
    const s = this.ctx.start;
    await loadText('一位賓客' + INVITE);
    this.track(await loadPuppets(SPRITES));
    const c = this.fg.ctx;
    // 霧上的留言：手寫字、標準 v2；霧的大小跟著留言（右緣、垂直中心固定）
    const fam = F.hand(400);
    const tw = FOG.w - PAD * 2, th = FOG.h - PAD * 2;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, tw, th, { family: fam }) : noteV2(c, INVITE, null, tw * 0.8, th * 0.5, { max: 40, family: fam });
    const w = Math.min(FOG.w, tightenNote(c, this.note, 300) + PAD * 2);
    const h = Math.min(FOG.h, this.note.height + PAD * 2);
    this.fogBox = { x: FOG.x + FOG.w - w, y: FOG.y + (FOG.h - h) / 2, w, h };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    this.makeFog();

    // 時間軸：第一拍孟庭往窗外一指（gondola_2），霧上開始寫字（最多 1.6 秒）；寫完之後的小節線靠回宣文肩上
    const total = this.msg ? msgChars(this.note.fit) : 0;
    this.per = clamp(1.6 / Math.max(1, total), 0.03, 0.1);
    this.tw0 = beatAfter(au, s + 0.4);
    this.twd = this.tw0 + total * this.per;
    const back = barAfter(au, this.twd + au.beatPeriod(s) * 0.5);
    this.keys = [[-1e9, 'cp_gondola_1'], [this.tw0 - 0.05, 'cp_gondola_2'], [back, 'cp_gondola_1']];

    // 歌詞的路：輪框外圈再往上一點的拱形（左邊到霧的上緣為止）
    for (let i = 0; i <= 60; i++) {
      const x = lerp(150, 1780, i / 60);
      this.rimPath.push({ x, y: this.rimY(x, R_OUT) - 20 });
    }
    this.drawCabin();
  }

  /** 輪框（半徑 r 的圓）在 x 的高度：圓的上半，在畫面上是一道拱。 */
  private rimY(x: number, r: number) {
    return HUB.y - Math.sqrt(Math.max(0, r * r - (x - HUB.x) ** 2));
  }

  /** 霧的底：淡淡的一層（中間濃、邊緣散開），上面有很細的水珠。寫字的時候從這張複製、把字的地方擦掉。 */
  private makeFog() {
    const B = this.fogBox, m = 60;
    const mk = () => { const cv = document.createElement('canvas'); cv.width = Math.ceil(B.w + m * 2); cv.height = Math.ceil(B.h + m * 2); return cv; };
    const base = mk(), c = base.getContext('2d')!;
    // 橢圓的霧（跟著字的範圍），邊緣在畫布裡面就散到 0，不會有直的邊
    c.save();
    c.translate(m + B.w / 2, m + B.h / 2);
    c.scale((B.w / 2 + m * 0.9) / 100, (B.h / 2 + m * 0.9) / 100);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 100);
    g.addColorStop(0, rgba('bone', 0.58));
    g.addColorStop(0.62, rgba('bone', 0.5));
    g.addColorStop(1, rgba('bone', 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, 100, 0, Math.PI * 2); c.fill();
    c.restore();
    // 水珠：很小的亮點（種子固定）
    for (let i = 0; i < 260; i++) {
      const x = m + B.w * hash(i, 71), y = m + B.h * hash(i, 72), r = 0.6 + 1.6 * hash(i, 73) ** 3;
      c.fillStyle = rgba('bone', 0.2 + 0.3 * hash(i, 74));
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    this.fogBase = base;
    this.fogCv = mk();
  }

  /** 把霧畫到寫字用的畫布上，擦掉已經寫出來的字（字 = 透出後面的夜空）；字底下拖一兩道水痕。 */
  private updateFog(shown: number, sigK: number) {
    const cv = this.fogCv!, c = cv.getContext('2d')!, n = this.note!, B = this.fogBox, m = 60;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, cv.width, cv.height);
    c.drawImage(this.fogBase!, 0, 0);
    c.globalCompositeOperation = 'destination-out';
    const y = m + PAD + Math.max(0, (B.h - PAD * 2 - n.height) * 0.45);
    drawNote(c, n, m + PAD, y, { chars: shown, color: 'rgba(0,0,0,0.92)', sigColor: 'rgba(0,0,0,0.8)', sigK });
    // 擦掉霧的地方是乾淨的玻璃：比霧暗，再疊一層很淡的墨，字才清楚（不然窗外的燈會從字裡透出來、搶掉字形）
    c.globalCompositeOperation = 'source-over';
    drawNote(c, n, m + PAD, y, { chars: shown, color: rgba('ink', 0.5), sigColor: rgba('ink', 0.4), sigK });
    c.globalCompositeOperation = 'destination-out';
    // 水痕：幾個字的底下往下流一小段
    const lines = n.fit.lines;
    c.lineCap = 'round';
    let k = 0;
    for (let i = 0; i < lines.length; i++) {
      const cnt = Array.from(lines[i]!).length;
      for (let j = 0; j < cnt; j++, k++) {
        if (k >= shown || hash(k, 81) > 0.16) continue;
        const x = m + PAD + (j + 0.5) * n.fit.size * 0.95, y0 = y + n.fit.size * 0.95 + i * n.fit.lineHeight;
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(x, y0); c.lineTo(x + 1, y0 + 14 + 26 * hash(k, 82)); c.stroke();
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  /** 車廂內部（畫一次）：深色的牆、窗子挖空（圓角）、窗框的細亮邊、天花板的小燈、左邊一張長椅（右下角 HUD 那一塊只有牆）。 */
  private drawCabin() {
    const L = this.cabin, c = L.ctx;
    L.clear();
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mixRgba('ink2', 'blood', 0.12));
    g.addColorStop(1, rgba('ink'));
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // 挖窗
    const win = new Path2D();
    const r = 36;
    win.roundRect(WIN.x0, WIN.y0, WIN.x1 - WIN.x0, WIN.y1 - WIN.y0, r);
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.fill(win);
    c.restore();
    // 窗框：一圈細亮邊（天花板的燈照到）
    c.strokeStyle = mixRgba('ink2', 'bone', 0.22);
    c.lineWidth = 5;
    c.stroke(win);
    c.strokeStyle = rgba('ink', 0.9);
    c.lineWidth = 2;
    c.beginPath(); c.roundRect(WIN.x0 - 6, WIN.y0 - 6, WIN.x1 - WIN.x0 + 12, WIN.y1 - WIN.y0 + 12, r + 6); c.stroke();
    // 窗台的扶手
    c.fillStyle = mixRgba('ink2', 'ash', 0.2);
    c.fillRect(WIN.x0 - 10, WIN.y1 - 6, WIN.x1 - WIN.x0 + 20, 12);
    // 長椅：靠背、座墊、前面的板子（深色的皮）
    const bx0 = CX - 380, bx1 = CX + 380, back = SEAT - SZ * 0.3;
    c.fillStyle = mixRgba('ink2', 'blood', 0.3);
    c.beginPath(); c.roundRect(bx0, back, bx1 - bx0, SEAT - back + 10, 22); c.fill();
    c.fillStyle = mixRgba('ink2', 'blood', 0.4);
    c.beginPath(); c.roundRect(bx0 - 16, SEAT - 14, bx1 - bx0 + 32, 44, 16); c.fill();
    c.fillStyle = mixRgba('ink', 'blood', 0.18);
    c.fillRect(bx0, SEAT + 30, bx1 - bx0, FEET - SEAT - 30);
    c.strokeStyle = rgba('bone', 0.08);
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(bx0 + 20, back + 60); c.lineTo(bx1 - 20, back + 60); c.moveTo(bx0 + 10, SEAT - 12); c.lineTo(bx1 - 10, SEAT - 12); c.stroke();
    // 地板
    c.fillStyle = rgba('ink');
    c.fillRect(0, FEET, W, H - FEET);
    c.strokeStyle = rgba('bone', 0.06);
    c.beginPath(); c.moveTo(0, FEET + 1); c.lineTo(W, FEET + 1); c.stroke();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    // 車廂晃：窗外的景跟著反方向很慢地晃（繞窗子上方的吊點）
    const sw = 0.006 * Math.sin((t - s) * 0.9) + 0.003 * Math.sin((t - s) * 2.3);
    this.wheel.clear();
    this.glow.clear();
    this.sky.render(renderer, out);
    this.drawCity(t, sw);
    comp.draw(renderer, this.city.upload(), out);
    this.drawWheel(t, sw);
    this.wheel.render(renderer, out);
    comp.draw(renderer, this.cabin.texture, out);

    const L = this.fg; L.clear();
    const c = L.ctx;
    // ---- 兩個人（這一層最先畫：打光只染紙偶）
    const en = puppetIn(t, s + 0.05, 0.5);
    if (en.alpha > 0) {
      // 跟著拍子輕輕點頭（整個人壓一下）
      const sq = breathe(t, 0.006, 3.4) + 0.012 * beatKick(au, t, 0.3);
      puppetShadow(c, 'cp', CX, FEET, { h: SZ, wide: 1.2, alpha: 0.7, color: '0,0,0' });
      drawPick(c, this.keys, t, CX, FEET, { h: SZ, spin: en.spin, alpha: en.alpha, squash: sq });
      // 天花板的小燈（暖）從上面照；窗外的燈泡在小節線一閃，淡淡地打在臉上
      puppetLight(c, [0, FEET - SZ * 1.1, 1300, SZ * 1.15], rgba('ink', 0.1), rgba('ink', 0.5));
      const flash = Math.exp(-Math.max(0, t - au.timeOfBar(Math.floor(au.barAt(t)))) / 0.25);
      if (flash > 0.02) puppetLight(c, [0, FEET - SZ * 1.1, 1300, SZ * 0.6], rgba('signal', 0.1 * flash), rgba('signal', 0));
    }
    // ---- 霧上的留言
    this.drawFog(c, t);
    // ---- 歌詞沿著輪框
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const path = sw ? this.rimPath.map((p) => this.sway(p, sw)) : this.rimPath;
      // 韓文歌：原文副行接在中文下面、沿同一條弧線；整行往外（上）推一個副行的距離，原文才坐在輪框上面、不壓在桁架與燈泡上
      const off = lyricSubOf(ly.line) ? subGap(this.lyricSize) - 8 : 0;
      const r = lyricOnPath(c, ly.line, t, path, { family: F.archivo(100, this.msg ? 600 : 700), size: this.lyricSize, minSize: 40, offset: off, alpha: ly.k * prog(t, s, s + 0.6), unsung: rgba('bone', 0.26) });
      if (r.head) sparkHead(this.glow, r.head.x, r.head.y - 4, t, 0.45, 0.8);
    }
    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    const push = ease.inOutCubic(f.p);
    return { bloom: 0.8, vignette: 0.55, zoom: 1 + 0.03 * push, shake: [-(CX + 240 - W / 2) * 0.03 * push, -(520 - H / 2) * 0.03 * push] };
  }

  /** 窗外的景跟著車廂晃（繞窗子上方的吊點轉 sw 弧度）。 */
  private sway(p: Pt, sw: number): Pt {
    const ox = 960, oy = -200;
    const cs = Math.cos(sw), sn = Math.sin(sw);
    return { x: ox + (p.x - ox) * cs - (p.y - oy) * sn, y: oy + (p.x - ox) * sn + (p.y - oy) * cs };
  }

  /**
   * 摩天輪：輪框兩圈（外圈、內圈）＋之字形的桁架、往下收向輪軸的輻條、輪框上的燈泡（照拍子一顆一顆跑、小節線全部一閃）、
   * 掛在輪框下面慢慢經過的別的車廂（剪影＋亮著的小窗）。都用 LineBatch 畫細線，畫在車廂的牆後面。
   */
  private drawWheel(t: number, sw: number) {
    const au = this.ctx.audio, lb = this.wheel;
    const rot = t * SPIN;
    const P = (a: number, r: number) => this.sway({ x: HUB.x + Math.cos(a) * r, y: HUB.y + Math.sin(a) * r }, sw);
    const bone = LIN.bone, sg = LIN.signal, em = LIN.ember;
    const faint: [number, number, number] = [bone[0] * 0.3, bone[1] * 0.3, bone[2] * 0.3];
    // 看得到的那一段角度（輪框在窗子上方那一截）
    const a0 = -Math.PI / 2 - 0.5, a1 = -Math.PI / 2 + 0.5;
    const ring = (r: number, wdt: number, col: [number, number, number], alpha: number) => {
      const pts: Pt[] = [];
      for (let a = a0; a <= a1 + 1e-6; a += 0.01) pts.push(P(a, r));
      lb.polyline(pts, wdt, col, alpha);
    };
    ring(R_OUT, 2, faint, 0.9);
    ring(R_IN, 1.5, faint, 0.8);
    // 桁架：外圈與內圈之間的之字形，跟著輪子轉
    // 第 j 格固定在輪子上（世界角度 j·step），畫面上的角度 = j·step + rot
    const step = 0.012;
    for (let j = Math.ceil((a0 - rot) / step); j * step + rot < a1; j++) {
      const a = j * step + rot;
      const odd = ((j % 2) + 2) % 2 === 1;
      const p = P(a, odd ? R_OUT : R_IN), q = P(a + step, odd ? R_IN : R_OUT);
      lb.seg2(p.x, p.y, q.x, q.y, 1, faint, 0.55);
    }
    // 輻條：24 根，從輪框往下收（只畫到窗子下緣以下一點）
    for (let i = 0; i < 24; i++) {
      const a = rot + (i / 24) * Math.PI * 2;
      const ang = ((a - (-Math.PI / 2)) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      if (Math.abs(ang) > 0.55) continue;
      const p = P(a, R_IN), q = P(a, R_IN - 900);
      lb.seg2(p.x, p.y, q.x, q.y, 1.4, faint, 0.5);
      // 兩根輻條之間的斜撐
      const p2 = P(a + Math.PI / 24, R_IN - 420);
      lb.seg2(p.x, p.y, p2.x, p2.y, 1, faint, 0.3);
    }
    // 燈泡：輪框上每 0.01 弧度一顆（跟著轉），每拍往前跑一格、每四顆亮一顆；小節線上全部一閃
    const beat = Math.floor(au.beatAt(t));
    const barFlash = Math.exp(-Math.max(0, t - au.timeOfBar(Math.floor(au.barAt(t)))) / 0.22);
    const bstep = 0.01;
    for (let j = Math.ceil((a0 - rot) / bstep); j * bstep + rot < a1; j++) {
      const a = j * bstep + rot;
      const on = (((j + beat) % 4) + 4) % 4 === 0;
      const lum = Math.max(on ? 1 : 0.18, barFlash);
      const p = P(a, (R_OUT + R_IN) / 2);
      lb.seg2(p.x, p.y, p.x + 0.01, p.y, on ? 7 : 5, [em[0] * 2 * lum, em[1] * 1.8 * lum, em[2] * 1.3 * lum], 0.9);
    }
    // 別的車廂：每 1/24 圈一個，掛在外圈下面（沒有燈泡那麼亮，只是剪影＋兩扇亮著的小窗）
    for (let i = 0; i < 24; i++) {
      const a = rot + (i / 24) * Math.PI * 2 + 0.13;
      const ang = ((a + Math.PI / 2) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      if (Math.abs(ang) > 0.5) continue;
      const top = P(a, R_OUT);
      const cx = top.x, cy = top.y + 130;
      // 霧後面的車廂不畫（真的霧會把它糊掉；畫出來的線會從字裡透出來）
      const F2 = this.fogBox;
      if (cx > F2.x - 70 && cx < F2.x + F2.w + 70 && cy > F2.y - 70 && cy < F2.y + F2.h + 70) continue;
      lb.seg2(top.x, top.y, cx, cy - 66, 2, faint, 0.7);
      // 車廂：圓圓的膠囊外形、頂上一個小蓋子、中間一排小窗（亮著）
      const w = 104, h = 132;
      const pts: Pt[] = [];
      for (let k = 0; k <= 32; k++) {
        const u = (k / 32) * Math.PI * 2;
        pts.push({ x: cx + Math.sign(Math.cos(u)) * Math.pow(Math.abs(Math.cos(u)), 0.6) * w / 2, y: cy + Math.sign(Math.sin(u)) * Math.pow(Math.abs(Math.sin(u)), 0.75) * h / 2 });
      }
      lb.polyline(pts, 1.6, [bone[0] * 0.45, bone[1] * 0.45, bone[2] * 0.45], 0.8);
      lb.seg2(cx - 16, cy - h / 2 - 2, cx + 16, cy - h / 2 - 2, 5, faint, 0.8);
      const lit = 0.55 + 0.45 * Math.sin(t * 0.7 + i);
      for (let k = -1; k <= 1; k++) lb.seg2(cx + k * 30 - 10, cy - 8, cx + k * 30 + 10, cy - 8, 30, [sg[0] * 0.3 * lit, sg[1] * 0.26 * lit, sg[2] * 0.18 * lit], 0.6);
    }
  }

  /** 窗外很遠的城市燈海：散景的光點慢慢往下沉（車廂在往上升），有暖有冷。畫在低解析度的一層。 */
  private drawCity(t: number, sw: number) {
    const L = this.city, c = L.ctx;
    L.clear();
    for (let i = 0; i < 150; i++) {
      const band = 200;
      const y = 560 + ((hash(i, 91) * band + t * 5) % band);
      const p = this.sway({ x: WIN.x0 + (WIN.x1 - WIN.x0) * hash(i, 92), y }, sw);
      const r = 3 + 9 * hash(i, 93) ** 2;
      const warm = hash(i, 94) < 0.7;
      const a = (0.25 + 0.5 * hash(i, 95)) * clamp((y - 560) / 40) * clamp((760 - y) / 40);
      c.fillStyle = warm ? mixRgba('signal', 'bone', 0.4, a) : mixRgba('ash', 'bone', 0.5, a * 0.7);
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
    }
  }

  /** 霧上的留言：寫的時候每格重畫（擦掉的字越來越多），寫完就用同一張不再重畫。 */
  private drawFog(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n || !this.fogCv) return;
    const B = this.fogBox, m = 60;
    const shown = this.msg ? Math.max(0, Math.floor((t - this.tw0) / this.per)) : Infinity;
    const sigK = this.msg ? prog(t, this.twd + 0.1, this.twd + 0.5) : 1;
    // 量化署名的淡入（十階）：寫完之後只有十次重畫，之後同一張圖
    const key = Math.min(shown, 9999) * 16 + Math.round(sigK * 10);
    if (key !== this.fogShown) { this.updateFog(shown, Math.round(sigK * 10) / 10); this.fogShown = key; }
    c.save();
    // 霧在玻璃上：不要超出窗框
    c.beginPath(); c.roundRect(WIN.x0, WIN.y0, WIN.x1 - WIN.x0, WIN.y1 - WIN.y0, 36); c.clip();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.8);
    c.drawImage(this.fogCv, B.x - m, B.y - m);
    c.restore();
  }
}
