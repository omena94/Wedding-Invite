// 極光（暗）：北國的雪原上空，三層極光的光幕跟著音樂起伏。
//  - 光幕是垂直的光線（一條條細的光柱）掛在一條會擺動的下緣上；下緣最亮（ember → signal），往上淡成暗部（blood）。
//    光幕側過來的皺褶特別亮。每一拍整片光幕往右「掃」一段（強烈緩動，掃完停住），大鼓時亮一下，段落能量越高光幕越高。
//  - 歌詞浮在光幕上緣的皺褶裡（天空上方，逐字跟唱；字後面的光幕暗一點，字才讀得清楚）。
//  - 雪原：地平線上一排針葉樹的剪影，雪面被極光照亮（靠地平線亮、近處暗），細細的雪粒在 hi-hat 上閃。
//  - 主打留言寫在雪地上：兩串腳印（一大一小、並肩）在拍點一步一步從左走到右——看不到人，只看到腳印一個一個出現——
//    腳印走過的地方，雪地上的字就浮出來（壓進雪裡的字：上緣一道陰影、字本身映著天光）。
//  - 冷面註記：「極光指數 Kp 9　能見度：一輩子」。
//  - 沒有主打留言：雪地上寫「今晚的極光，是為你們加班的。」＋邀請；純音樂：天空寫歌名。
// 畫法：天空、極光、星星、樹、雪原在一個 shader；腳印、留言、歌詞畫在一張 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText, measure } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, lerp } from '../engine/util';
import type { FitResult } from '../engine/text';
import { lyricAt, layoutLyric, drawLyric, beatAfter, signature, COUPLE_ZH, type LyricStyle } from './_motifs';
import { fitMsg, no3, lyricSize, slowPush, INVITE_SMALL, type Rect } from './_t20';

export const spec: PlateSpecDecl = { group: 'type', family: 'water', paper: false, energy: [0.15, 0.8], bars: [4, 8] };

/** 地平線（y 向下）。 */
const HZ = 596;
const LYR = { x: 150, y: 250, maxW: 1150 };
const LYR_STYLE: LyricStyle = { family: F.archivo(100, 700), size: 64, minSize: 50, maxWidth: LYR.maxW, align: 'left', lineHeight: 1.12 };
/** 雪地上的字。 */
const BOX = { x: 150, y: 716, w: 1160, h: 250 };
const MSG_FAM = F.hand(700);
const NO_MSG = '今晚的極光，是為你們加班的。';
const NOTE = '極光指數 Kp 9　能見度：一輩子';
/** 兩串腳印的 y（遠一點的那串在上面）與腳印大小。 */
const TRAIL = [{ y: 662, w: 27, h: 9 }, { y: 694, w: 23, h: 8 }];

const FRAG = /* glsl */ `
uniform float uT, uIn, uKick, uHat, uE;
uniform vec3 uPh;       // 三層光幕的相位（每拍往右掃一段）
uniform vec4 uClear;    // 歌詞的範圍：光幕在這裡暗一點
uniform vec4 uMsg;      // 雪地上留言的範圍：雪在這裡暗一點（字才是焦點）
uniform float uFocus;   // 留言出現了：極光收一點，焦點讓給留言
float hz(float x) { return ${HZ}.0 + 10.0 * sin(x * 0.0031 + 1.3) + 6.0 * sin(x * 0.0083 + 0.4); }

// 一層光幕：回傳 (強度, 離下緣多高)
vec2 curtain(vec2 p, float base, float amp, float fr, float ph, float hgt, float seed) {
  float x = p.x;
  float a1 = x * fr + ph, a2 = x * fr * 2.7 + ph * 1.35 + seed;
  float e = base + amp * (0.62 * sin(a1) + 0.38 * sin(a2));
  float de = amp * (0.62 * fr * cos(a1) + 0.38 * fr * 2.7 * cos(a2));
  // 皺褶側過來（下緣很陡）的地方光比較集中
  float fold = 1.0 + 2.4 * smoothstep(0.15, 1.2, abs(de));
  float up = e - p.y;
  float I = up > 0.0 ? exp(-up / hgt) * (0.35 + 0.65 * exp(-up / (hgt * 0.35))) : exp(up / 5.0);
  // 光柱：沿著 x 的細條紋，慢慢流動
  float rays = 0.45 + 0.55 * smoothstep(-0.3, 0.8, snoise(vec2(x / 7.5 + seed * 13.0, uT * 0.25 + seed)));
  rays *= 0.7 + 0.3 * snoise(vec2(x / 41.0 - uT * 0.1, seed));
  // 沿著 x 有亮有暗（一段一段的光幕，中間露出夜空）
  float seg = 0.2 + 0.8 * smoothstep(-0.35, 0.55, snoise(vec2(x / 520.0 - ph * 0.3, seed * 5.0)));
  return vec2(I * rays * fold * seg, up);
}

void main() {
  vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
  float h = hz(p.x);
  vec3 col;
  if (p.y < h + 1.0) {
    // ---- 天空
    col = C_INK * 0.85 + C_INK2 * 0.4 * smoothstep(0.0, h, p.y);
    // 星星
    vec2 id = floor(p / 22.0), f = fract(p / 22.0) - 0.5;
    float hs = hash12(id);
    vec2 o = (hash22(id + 3.0) - 0.5) * 0.7;
    float st = step(0.93, hs) * smoothstep(1.4, 0.0, length(f - o) * 22.0) * (0.5 + 0.5 * sin(uT * 3.0 + hs * 60.0));
    // 光幕（遠 → 近）
    float gain = (0.75 + 0.6 * uKick) * uIn * (1.0 - 0.28 * uFocus);
    float hgt = 95.0 + 130.0 * uE;
    vec2 c1 = curtain(p, 330.0, 50.0, 0.0034, uPh.x, hgt * 0.8, 0.3);
    vec2 c2 = curtain(p, 420.0, 70.0, 0.0024, uPh.y, hgt, 1.7);
    vec2 c3 = curtain(p, 505.0, 46.0, 0.0041, uPh.z, hgt * 0.7, 2.9);
    vec2 q = abs(p - (uClear.xy + uClear.zw * 0.5)) - uClear.zw * 0.5;
    float dim = 1.0 - 0.62 * (1.0 - smoothstep(-10.0, 70.0, max(q.x, q.y)));
    vec3 aur = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      vec2 c = i == 0 ? c1 : i == 1 ? c2 : c3;
      float w = i == 0 ? 0.55 : i == 1 ? 0.9 : 0.75;
      // 下緣 ember、中段 signal、上面淡成 blood
      vec3 tint = mix(C_EMBER, C_SIGNAL, smoothstep(4.0, 60.0, c.y));
      tint = mix(tint, C_BLOOD * 1.3, smoothstep(70.0, 260.0, c.y));
      aur += tint * c.x * w;
    }
    col += aur * 0.62 * gain * dim;
    col += C_BONE * st * 0.5 * (1.0 - clamp(length(aur), 0.0, 1.0)) * uIn;
    // 地平線上的光（雪反射上來的）
    col += C_SIGNAL * 0.05 * exp(-(h - p.y) / 60.0) * uIn;
    // 針葉樹的剪影：左右兩叢
    float tree = 0.0;
    for (int k = 0; k < 14; k++) {
      float fk = float(k);
      float bx = fk < 5.0 ? 40.0 + fk * 46.0 + 18.0 * sin(fk * 3.1) : 1480.0 + (fk - 5.0) * 52.0 + 20.0 * sin(fk * 1.7);
      float th = 60.0 + 70.0 * fract(sin(fk * 12.9898) * 43758.5453);
      float qy = (h + 4.0 - p.y) / th;
      if (qy < 0.0 || qy > 1.0) continue;
      float wdt = th * 0.24 * (1.0 - qy) * (0.72 + 0.28 * fract(qy * 5.0));
      tree = max(tree, 1.0 - smoothstep(wdt - 0.8, wdt + 0.8, abs(p.x - bx)));
    }
    col = mix(col, C_INK * 0.6, tree);
  } else {
    // ---- 雪原：靠地平線被極光照亮、近處暗；風吹的雪紋；雪粒在 hi-hat 上閃
    float d = (p.y - h) / (${H}.0 - h);
    // 雪：靠地平線被極光照得暖暖亮亮，往近處暗下去（字是紙白的，雪不能太亮）；大片的起伏陰影
    float lit = exp(-d * 3.2);
    vec3 snow = mix(C_INK2, C_BONE, 0.035 + 0.1 * lit) + C_SIGNAL * 0.05 * lit;
    snow *= 0.85 + 0.15 * smoothstep(-0.6, 0.6, snoise(vec2(p.x / 420.0, p.y / 90.0)));
    // 風吹出來的雪紋：細細的弧線，越近越疏
    float sp = 8.0 + 44.0 * d;
    float rip = pxLine(abs(fract((p.y + 14.0 * sin(p.x / 230.0) + 6.0 * sin(p.x / 71.0)) / sp) - 0.5) * sp, 0.3, 1.0);
    snow += C_BONE * 0.018 * rip * (0.5 + 0.5 * snoise(p / 160.0)) * (1.0 - d * 0.5);
    // 雪粒的閃光：圓的小點（不是方格），hi-hat 時多閃一點
    vec2 gid = floor(p / 9.0), gf = fract(p / 9.0) - 0.5;
    vec2 go = (hash22(gid + 5.0) - 0.5) * 0.6;
    float g = step(0.965, hash12(gid)) * smoothstep(0.16, 0.0, length(gf - go)) * (0.35 + 0.65 * sin(uT * 6.0 + hash12(gid + 1.0) * 30.0)) * (0.6 + uHat);
    snow += C_BONE * max(g, 0.0) * 0.45 * (1.0 - d * 0.5);
    // 留言後面的雪暗一點（很柔的暗角，不是框）
    vec2 mq = abs(p - (uMsg.xy + uMsg.zw * 0.5)) - uMsg.zw * 0.5;
    snow *= 1.0 - 0.32 * uFocus * (1.0 - smoothstep(-30.0, 140.0, max(mq.x, mq.y)));
    col = snow * (0.4 + 0.6 * uIn);
    col = mix(col, C_INK, pxLine(abs(p.y - h), 0.6, 1.4) * 0.4);
  }
  fragColor = vec4(col, 1.0);
}`;

const BG = () => new FSPass(FRAG, {
  uT: { value: 0 }, uIn: { value: 1 }, uKick: { value: 0 }, uHat: { value: 0 }, uE: { value: 0.5 },
  uPh: { value: new THREE.Vector3() }, uClear: { value: new THREE.Vector4() },
  uMsg: { value: new THREE.Vector4() }, uFocus: { value: 0 },
});

interface Print { x: number; y: number; w: number; h: number; t: number; rot: number }
interface Glyph { ch: string; x: number; y: number }

export default class Aurora extends Scene {
  bg = shared('aurora.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 71 + (this.msg?.id ?? 0) * 37) >>> 0;
  b0 = 0;
  prints: Print[] = [];
  /** 腳印走到哪裡（時間 → x）：字在這個 x 左邊的才浮出來。 */
  walk: { t: number; x: number }[] = [];
  fit: FitResult | null = null;
  glyphs: Glyph[] = [];
  sig: { text: string; x: number; y: number; size: number } | null = null;
  tag: { x: number; y: number } | null = null;
  invite: { x: number; y: number } | null = null;
  title = '';
  avoid: Rect[] = [];
  /** 歌詞的樣式：有留言時比留言小一號，沒有留言時歌詞是焦點。 */
  lyr: LyricStyle = LYR_STYLE;
  msgBox: Rect = [0, 0, 0, 0];

  override async init() {
    const { audio: au, song, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    this.b0 = beatAfter(au, s + 0.05);
    const beat = au.beatPeriod(this.b0);
    this.title = `♪  ${song.title}${song.artist ? '  —  ' + song.artist : ''}`;
    const text = m ? m.text : NO_MSG;
    const sigText = m ? (m.couple ? `—— ${COUPLE_ZH}` : signature(m.name)) : '';
    const lines = lyrics.linesIn(s - 2, e + 1);
    await loadText(text + sigText + NO_MSG + INVITE_SMALL + NOTE + this.title + lines.map((l) => l.text).join('') + 'FROM THE COUPLE · 新人No.0123456789');

    // ---- 腳印：半拍一步，一小節內（最長 2 秒，太短的窗格再快一點）從左走到畫面外
    const stepT = beat / 2;
    const bar = Math.max(beat * 2, au.timeOfBar(au.barAt(this.b0) + 1) - this.b0);
    const cross = Math.min(Math.max(bar, 1.2), 2.2, (e - this.b0) * 0.5);
    const nSteps = Math.max(6, Math.round(cross / stepT));
    const stride = (1400 - 40) / nSteps;
    for (let k = 0; k <= nSteps + 5; k++) {
      const t = this.b0 + k * stepT;
      const x = 40 + k * stride;
      this.walk.push({ t, x });
      TRAIL.forEach((tr, ti) => {
        const side = (k + ti) % 2 ? 1 : -1;
        const jit = hash(this.seed, k, ti);
        this.prints.push({ x: x + ti * 26 + (jit - 0.5) * 8, y: tr.y + side * tr.h * 1.2, w: tr.w, h: tr.h, t: t + ti * 0.04, rot: (jit - 0.5) * 0.12 });
      });
    }

    // ---- 雪地上的字
    const c = this.layer.ctx;
    const tagH = m?.couple ? 34 : 0;
    const sigSize = 42;
    const reserve = m ? sigSize + 14 : 56;
    this.fit = fitMsg(c, text, MSG_FAM, BOX.w, BOX.h - reserve - tagH, { min: 44, max: m ? 96 : 54, lineHeight: 1.24, maxLines: 4, oneLine: 64 });
    const fit = this.fit;
    this.lyr = { ...LYR_STYLE, size: lyricSize(m ? fit.size : null, 60), minSize: 48 };
    const blockH = tagH + fit.height + reserve;
    const top = BOX.y + (BOX.h - blockH) / 2;
    fit.lines.forEach((ln, i) => {
      const lay = layout(ln, MSG_FAM, fit.size);
      const y = top + tagH + fit.size * 0.9 + i * fit.lineHeight;
      for (const g of lay.glyphs) this.glyphs.push({ ch: g.ch, x: BOX.x + g.x, y });
    });
    if (m) {
      const sw = measure(sigText, MSG_FAM, sigSize);
      this.sig = { text: sigText, x: BOX.x + Math.max(fit.width, sw) - sw, y: top + tagH + fit.height + 10 + sigSize * 0.9, size: sigSize };
      if (m.couple) this.tag = { x: BOX.x, y: top + 14 };
    } else {
      this.invite = { x: BOX.x, y: top + fit.height + 46 };
    }
    for (const line of lines) layoutLyric(c, line, this.lyr);
    const bw = Math.max(fit.width, m ? 0 : measure(INVITE_SMALL, F.hei(500), 28));
    this.avoid = [[LYR.x - 20, LYR.y - 150, LYR.maxW + 40, 180], [BOX.x - 20, top - 20, bw + 40, blockH + 30]];
    this.msgBox = [BOX.x - 10, top - 10, bw + 20, blockH + 10];
  }

  /** 腳印走到的 x（字在它左邊的浮出來）。 */
  private reach(t: number) {
    const w = this.walk;
    if (t < w[0]!.t) return -100;
    for (let i = w.length - 1; i >= 0; i--) if (t >= w[i]!.t) return w[i]!.x + (i + 1 < w.length ? (w[i + 1]!.x - w[i]!.x) * ease.outCubic(clamp((t - w[i]!.t) / (w[i + 1]!.t - w[i]!.t))) : 0);
    return -100;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    const u = this.bg.u;
    // 每拍往右掃一段（outExpo，掃完停住）；三層速度不同
    const beats = Math.max(0, au.beatAt(t) - au.beatAt(s));
    const sweep = Math.floor(beats) + ease.outExpo(clamp((beats % 1) / 0.5));
    (u.uPh!.value as THREE.Vector3).set(-sweep * 0.22 + t * 0.05, -sweep * 0.34 - t * 0.03 + 2.0, -sweep * 0.45 + 4.1);
    u.uT!.value = t;
    u.uKick!.value = f.a.kick;
    u.uHat!.value = f.a.hat;
    u.uE!.value = clamp(0.3 + 0.7 * au.energyAt(t));
    u.uIn!.value = prog(t, s, s + 0.5, ease.outCubic);
    (u.uClear!.value as THREE.Vector4).set(LYR.x - 20, LYR.y - 110, LYR.maxW + 40, 150);
    (u.uMsg!.value as THREE.Vector4).set(...this.msgBox);
    // 腳印開始走之後極光慢慢收、雪地上的字後面暗下來（沒有主打留言時歌詞是焦點，極光照樣亮）
    u.uFocus!.value = this.msg ? prog(t, this.b0, this.b0 + 1.2, ease.inOutCubic) : 0;
    this.bg.render(renderer, out);

    const L = this.layer;
    L.clear();
    const c = L.ctx;
    this.drawPrints(c, t);
    this.drawMessage(c, t);
    this.drawLyrics(c, t);
    this.drawNotes(c, t);
    comp.draw(renderer, L.upload(), out);
    return { bloom: 0.8, vignette: 0.4, popupAvoid: this.avoid, zoom: slowPush(f.p) };
  }

  /** 腳印：一個一個在拍點「踩」下去（鞋底＋鞋跟，往右走），壓痕是暗的、遠側一道被照亮的邊。 */
  private drawPrints(c: CanvasRenderingContext2D, t: number) {
    c.save();
    for (const p of this.prints) {
      if (t < p.t || p.x > W + 40) continue;
      const k = ease.outBack(prog(t, p.t, p.t + 0.14));
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.scale(k, k);
      c.fillStyle = rgba('ink', 0.6);
      c.beginPath();
      c.ellipse(2, 0, p.w * 0.42, p.h * 0.5, 0, 0, Math.PI * 2);
      c.ellipse(-p.w * 0.55, 0, p.w * 0.22, p.h * 0.42, 0, 0, Math.PI * 2);
      c.fill();
      // 壓痕的遠側（上緣）被天光照到
      c.strokeStyle = rgba('bone', 0.3);
      c.lineWidth = 1;
      c.beginPath(); c.ellipse(2, 0.6, p.w * 0.42, p.h * 0.5, 0, Math.PI + 0.3, Math.PI * 2 - 0.3); c.stroke();
      c.restore();
    }
    c.restore();
  }

  /** 雪地上的字：腳印走過才浮出來；上緣一道陰影（壓進雪裡）、字本身映著天光。 */
  private drawMessage(c: CanvasRenderingContext2D, t: number) {
    const fit = this.fit;
    if (!fit) return;
    const rx = this.reach(t);
    c.save();
    c.font = font(MSG_FAM, fit.size);
    c.textBaseline = 'alphabetic';
    for (const g of this.glyphs) {
      const a = clamp((rx - g.x) / 90);
      if (a <= 0) continue;
      c.globalAlpha = a;
      c.fillStyle = rgba('ink', 0.7);
      c.fillText(g.ch, g.x, g.y - 2.5);
      c.fillStyle = g.ch === '♥' ? rgba('rose') : rgba('bone', 0.95);
      c.fillText(g.ch, g.x, g.y);
    }
    const last = rx > (this.glyphs[this.glyphs.length - 1]?.x ?? 0) + 60;
    const tEnd = this.walk.find((w) => w.x > W)?.t ?? this.b0 + 2;
    if (this.sig && last) {
      c.globalAlpha = prog(t, tEnd - 0.4, tEnd);
      c.font = font(MSG_FAM, this.sig.size);
      c.fillStyle = rgba('signal', 0.9);
      c.fillText(this.sig.text, this.sig.x, this.sig.y);
    }
    if (this.tag) {
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.3);
      c.font = font(F.mono(500), 16); c.letterSpacing = '4px'; c.fillStyle = rgba('signal', 0.9);
      c.fillText('FROM THE COUPLE · 新人', this.tag.x, this.tag.y);
      c.letterSpacing = '0px';
    }
    if (this.invite && last) {
      c.globalAlpha = prog(t, tEnd - 0.4, tEnd);
      c.font = font(F.hei(500), 28); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.95);
      c.fillText(INVITE_SMALL, this.invite.x, this.invite.y);
      c.letterSpacing = '0px';
    }
    c.restore();
  }

  /** 天空裡的歌詞（逐字跟唱）。 */
  private drawLyrics(c: CanvasRenderingContext2D, t: number) {
    const { lyrics } = this.ctx;
    if (!lyrics.has) {
      c.save();
      c.globalAlpha = prog(t, this.b0, this.b0 + 0.5) * 0.85;
      c.font = font(F.mono(500), 22); c.letterSpacing = '4px'; c.fillStyle = rgba('ash');
      c.fillText(this.title.toUpperCase(), LYR.x, LYR.y);
      c.restore();
      return;
    }
    const ly = lyricAt(lyrics, t);
    if (!ly) return;
    const lay = layoutLyric(c, ly.line, this.lyr);
    c.save();
    c.translate(LYR.x, LYR.y - (lay.rows.length - 1) * lay.size * (this.lyr.lineHeight ?? 1.18));
    drawLyric(c, ly.line, t, this.lyr, lay, ly.k);
    c.restore();
  }

  private drawNotes(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.2, this.ctx.start + 0.7);
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('ash', 0.7);
    c.fillText(`${this.msg ? no3(this.msg.n) + '　' : ''}${NOTE}`, LYR.x, 120);
    c.restore();
    void lerp;
  }
}
