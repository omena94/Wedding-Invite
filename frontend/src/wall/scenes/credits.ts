// 片尾名單（批次 T6・螢幕 B，暗）：電影院銀幕上的片尾名單，用放映機放出來的樣子。
//  - 名單以畫面中線偏左的「脊線」對齊：職稱靠右、名字靠左（片尾名單的老規矩），往上捲；
//    捲動跟著拍子：每一拍一開始衝一下、拍尾放慢（「頓一下」），像放映機一格一格拉片。
//  - 捲到主打留言那一段就停住：名字（訊號色）＋留言（手寫字，置中），停到讀得完再繼續往下捲：
//    其他賓客的署名（「共同演出」）、本片歌曲、工作人員（攝影：在場每一支手機；燈光：仙女棒……）、冷面的聲明，
//    最後停在「宣文 & 孟庭（未完，待續）」。
//  - 歌詞是銀幕下緣的字幕（逐字跟唱，置中在脊線上）。
//  - 片子的質感：上下黑邊（寬銀幕）、放映機的亮斑、每格一點點的閃爍與片門抖動（大鼓一打抖大一點）、灰塵與偶爾的刮痕。
// 手法：整條名單在 init 排好、畫在一張很長的 Canvas 圖層上只上傳一次；每一格用一個 GLSL pass 去取樣（捲動、片門抖動、
// 上下漸隱、灰塵刮痕、黑邊都在這個 pass 裡），字幕是另一張小圖層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, hash, lerp, frameIdx } from '../engine/util';
import { readSeconds, type FitResult } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, drawMessage, COUPLE_ZH, COUPLE_EN, DATE_DOTS } from './_motifs';
import { fitMessage, inOut, subRect, type Rect } from './_t6';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0, 0.7], bars: [6, 12], minMessages: 3, weight: 1 };

// ---------------------------------------------------------------- 版面
const SPINE = 720; // 脊線在畫面上的 x
const RX = 100, RW = 1240; // 名單圖層在畫面上的左緣與寬（脊線在圖層的 620）
const SP = SPINE - RX;
const BAR_T = 96, BAR_B = 984; // 上下黑邊（寬銀幕）
const VIEW = { t: 116, b: 820 }; // 名單看得到的範圍（上下各一段漸隱）
const VIEW_C = 452; // 主打留言停在這裡（名單可見範圍的中間）
const SUB = { x: 96, y: 850, w: 1248, h: 130 }; // 字幕的小圖層
const [GROOM, BRIDE] = COUPLE_ZH.split(/\s*&\s*/) as [string, string];
const CREW: [string, string][] = [
  ['攝影', '在場每一支手機'], ['燈光', '仙女棒'], ['餐飲', '主廚與外場的大家'], ['音樂', '今晚的歌單'],
  ['伴郎伴娘', '一路陪伴的好朋友們'], ['特別感謝', '雙方家長'], ['', '今天到場的每一位'],
];
const NOTES = ['本片純屬真實，如有雷同，實屬緣分。', '片中動物皆為本色演出，拍攝期間只有被摸頭。'];
const TEXT = `演出新郎新娘特別演出博美祝福共同演出本片歌曲演唱工作人員未完待續你的名字也可以出現在這裡掃描右下角寫一則給新人${CREW.flat().join('')}${NOTES.join('')}${GROOM}${BRIDE}`;

// 背景：暗場、放映機的亮斑，逐格一點點閃爍
const BG = () => new FSPass(/* glsl */ `
  uniform float flick; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float r = length((p - vec2(${SPINE}.0, 500.0)) / vec2(1150.0, 640.0));
    vec3 col = C_INK * 0.85 + (C_INK2 - C_INK) * 1.6 * exp(-r * r * 1.8) * flick * k;
    fragColor = vec4(col, 1.0);
  }`, { flick: { value: 1 }, k: { value: 1 } });

// 名單＋片子的質感：取樣很長的名單圖層（fast：預乘、sRGB → 自己解），上下漸隱；灰塵、刮痕、黑邊
const FILM = () => new FSPass(/* glsl */ `
  uniform sampler2D roll; uniform vec2 rollPos; uniform vec2 rollSize; uniform float flick; uniform float k;
  uniform float fi; uniform float scratchX; uniform float scratchA;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    vec4 col = vec4(0.0);
    // 名單
    vec2 q = (p - rollPos) / rollSize;
    if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) {
      vec4 c = texture(roll, vec2(q.x, 1.0 - q.y));
      c.rgb = c.a > 0.0 ? toLinear(c.rgb / c.a) * c.a : vec3(0.0);
      float m = smoothstep(${VIEW.t}.0, ${VIEW.t + 90}.0, p.y) * (1.0 - smoothstep(${VIEW.b - 90}.0, ${VIEW.b}.0, p.y));
      col = c * m * flick * k;
    }
    // 灰塵：每格換位置的幾顆小點（深色是片上的髒點，亮色是刮掉乳劑的地方）
    for (int i = 0; i < 7; i++) {
      vec2 h = hash22(vec2(fi, float(i) * 7.13));
      vec2 c = h * vec2(${W}.0, ${BAR_B - BAR_T}.0) + vec2(0.0, ${BAR_T}.0);
      float sz = 0.8 + 2.4 * hash12(vec2(fi, float(i)));
      float d = length((p - c) * vec2(1.0, 0.6 + hash12(vec2(float(i), fi))));
      float a = (1.0 - smoothstep(sz * 0.5, sz, d)) * step(0.45, hash12(vec2(fi * 1.3, float(i))));
      vec3 dc = hash12(vec2(float(i), fi * 0.7)) > 0.5 ? C_BONE * 0.55 : vec3(0.0);
      col = col * (1.0 - a * 0.8) + vec4(dc, 1.0) * a * 0.8 * k;
    }
    // 刮痕：偶爾一條細細的直線，跟著片子抖
    float sx = abs(p.x - scratchX - 3.0 * sin(p.y * 0.013 + fi));
    float sa = scratchA * (1.0 - smoothstep(0.4, 1.3, sx)) * (0.6 + 0.4 * hash12(vec2(floor(p.y / 6.0), fi)));
    col = col * (1.0 - sa * 0.5) + vec4(C_BONE * 0.3, 1.0) * sa * 0.5 * k;
    // 寬銀幕的黑邊
    float bar = 1.0 - step(${BAR_T}.0, p.y) * step(p.y, ${BAR_B}.0);
    col = mix(col, vec4(0.0, 0.0, 0.0, 1.0), bar);
    fragColor = col;
  }`, {
  roll: { value: null }, rollPos: { value: new THREE.Vector2() }, rollSize: { value: new THREE.Vector2(1, 1) }, flick: { value: 1 }, k: { value: 1 },
  fi: { value: 0 }, scratchX: { value: 0 }, scratchA: { value: 0 },
}, { blending: THREE.CustomBlending, transparent: true });

interface Item { y: number; draw: (c: CanvasRenderingContext2D, y: number) => void }

export default class Credits extends Scene {
  bg = shared('credits.bg', BG);
  film = shared('credits.film', () => {
    const p = FILM();
    const m = p.mat;
    m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    return p;
  });
  roll!: Layer2D;
  sub = this.track(new Layer2D(SUB.w, SUB.h, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  items: Item[] = [];
  rollH = 2000;
  msgC = 0; // 主打留言那一段的中心（名單座標）
  endC = 0; // 最後一張卡的中心
  castTop = 0;
  /** 主打留言那一段的上下緣（名單座標），即時小卡避開用。 */
  msgSpan: [number, number] = [0, 0];
  fit: FitResult | null = null;
  tA = 0; tB = 0; y0 = 0; yA = 0; yEnd = 0; v1 = 100;
  private drawn = false;

  override async init() {
    const { audio: au, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const others = ((this.ctx.params.messages ?? []) as Msg[]).filter((m) => m.id !== this.msg?.id);
    // 共同演出：其他賓客有署名的（新人自己的留言、沒填名字的不列）
    const names = [...new Set(others.filter((m) => !m.couple && m.name).map((m) => m.name))].slice(0, 20);
    await loadText(TEXT + song.title + song.artist + names.join(''));
    this.layout(names);
    this.roll = this.track(new Layer2D(RW, this.rollH, 1, { fast: true }));
    // 時間：主打留言在第一拍後一小節停到中間，停到讀得完（不超過窗格結尾前一拍半），再往下捲到最後一張卡
    const b0 = beatAfter(au, s + 0.05), beat = au.beatPeriod(b0);
    this.tA = Math.min(b0 + 4 * beat, s + (e - s) * 0.4);
    const read = this.msg ? readSeconds(this.msg.text) + 0.6 : 0;
    this.tB = Math.min(this.tA + read, e - 1.5 * beat);
    if (this.tB < this.tA) this.tB = this.tA;
    this.yA = VIEW_C - this.msgC; // 名單的上緣在畫面上的 y（主打留言置中時）
    this.y0 = Math.min(VIEW.t + 40 - this.castTop, this.yA + 170 * (this.tA - s)); // 開場：演出名單在最上面（或照速度往回推）
    this.yEnd = VIEW_C - this.endC;
    this.v1 = clamp((this.yA - this.yEnd) / Math.max(0.5, e - this.tB - 0.8), 70, 230);
  }

  /** 把整條名單排好（名單座標：圖層左上角為原點，脊線在 x = SP）。 */
  private layout(names: string[]) {
    const { song } = this.ctx;
    const mc = document.createElement('canvas').getContext('2d')!;
    let y = 120;
    const push = (h: number, draw: Item['draw']) => { this.items.push({ y, draw }); y += h; };
    const header = (zh: string, en: string) => push(110, (c, yy) => {
      c.textAlign = 'center';
      c.font = font(F.serif(400, true), 30); c.fillStyle = rgba('ash', 0.85);
      c.fillText(en, SP, yy + 30);
      c.font = font(F.hei(700), 30); c.letterSpacing = '10px'; c.fillStyle = rgba('bone', 0.9);
      c.fillText(zh, SP + 5, yy + 76);
      c.letterSpacing = '0px'; c.textAlign = 'left';
    });
    const row = (job: string, name: string, big = true) => push(big ? 78 : 64, (c, yy) => {
      c.font = font(F.hei(500), 27); c.letterSpacing = '5px'; c.fillStyle = rgba('ash', 0.9); c.textAlign = 'right';
      c.fillText(job, SP - 34, yy + 42);
      c.letterSpacing = '0px'; c.textAlign = 'left';
      c.font = font(F.ming(700), big ? 46 : 38); c.fillStyle = rgba('bone', 0.96);
      c.fillText(name, SP + 30, yy + 46);
    });
    // 演出
    this.castTop = y;
    header('演出', 'Starring');
    row('新郎', GROOM); row('新娘', BRIDE); row('特別演出', '芃芃（博美）'); row('特別演出', 'QQ（博美）');
    y += 110;
    // 主打留言
    const m = this.msg;
    const top = y;
    header('祝福', 'With Love From');
    if (m) {
      this.fit = fitMessage(mc, `「${m.text}」`, F.hand(400), RW - 160, 300, { min: 44, max: 68, lineHeight: 1.3 });
      const fit = this.fit;
      push(92, (c, yy) => {
        c.textAlign = 'center'; c.font = font(F.ming(700), 60); c.fillStyle = rgba('signal');
        c.fillText(m.name || '一位賓客', SP, yy + 62);
        if (m.couple) { c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash'); c.fillText('FROM THE COUPLE', SP, yy + 92); c.letterSpacing = '0px'; }
        c.textAlign = 'left';
      });
      y += 20;
      push(fit.height + 30, (c, yy) => {
        c.font = font(F.hand(400), fit.size);
        fit.lines.forEach((ln, i) => {
          const one: FitResult = { ...fit, lines: [ln] };
          drawMessage(c, one, F.hand(400), SP, yy + fit.size * 0.9 + i * fit.lineHeight, { align: 'center', color: rgba('bone', 0.96) });
        });
      });
    } else {
      push(200, (c, yy) => {
        c.textAlign = 'center';
        c.font = font(F.hand(400), 58); c.fillStyle = rgba('bone', 0.95);
        c.fillText('你的名字，也可以出現在這裡', SP, yy + 70);
        c.font = font(F.hei(500), 28); c.fillStyle = rgba('ash', 0.95);
        c.fillText('掃描右下角 QR code，寫一則給新人', SP, yy + 140);
        c.textAlign = 'left';
      });
    }
    this.msgC = (top + y) / 2 + 10;
    this.msgSpan = [top, y];
    y += 130;
    // 共同演出：其他賓客的署名，兩欄
    if (names.length) {
      header('共同演出', 'Also Starring');
      for (let i = 0; i < names.length; i += 2) {
        const a = names[i]!, b = names[i + 1];
        push(58, (c, yy) => {
          c.font = font(F.ming(400), 36); c.fillStyle = rgba('bone', 0.9);
          c.textAlign = 'right'; c.fillText(a, SP - 34, yy + 40);
          c.textAlign = 'left'; if (b) c.fillText(b, SP + 34, yy + 40);
        });
      }
      y += 110;
    }
    // 本片歌曲
    header('本片歌曲', 'Music');
    push(150, (c, yy) => {
      c.textAlign = 'center';
      c.font = font(F.ming(700), 44); c.fillStyle = rgba('bone', 0.96);
      c.fillText(`《${song.title || '今晚的歌'}》`, SP, yy + 50);
      if (song.artist) { c.font = font(F.hei(500), 28); c.fillStyle = rgba('ash', 0.95); c.fillText(`演唱　${song.artist}`, SP, yy + 104); }
      c.textAlign = 'left';
    });
    y += 90;
    // 工作人員
    header('工作人員', 'Crew');
    for (const [j, n] of CREW) row(j, n, false);
    y += 120;
    push(130, (c, yy) => {
      c.textAlign = 'center'; c.font = font(F.hei(400), 25); c.fillStyle = rgba('ash', 0.85);
      NOTES.forEach((n, i) => c.fillText(n, SP, yy + 30 + i * 44));
      c.textAlign = 'left';
    });
    y += 200;
    // 最後一張卡
    const endTop = y;
    push(300, (c, yy) => {
      c.textAlign = 'center';
      c.font = font(F.ming(900), 76); c.fillStyle = rgba('bone', 0.97);
      c.fillText(COUPLE_ZH, SP, yy + 76);
      c.font = font(F.serif(400, true), 42); c.fillStyle = rgba('ash', 0.95);
      c.fillText(COUPLE_EN, SP, yy + 138);
      c.font = font(F.mono(500), 20); c.letterSpacing = '6px';
      c.fillText(DATE_DOTS, SP + 3, yy + 186);
      c.letterSpacing = '0px';
      c.font = font(F.ming(700), 40); c.fillStyle = rgba('signal', 0.95);
      c.fillText('（未完，待續）', SP, yy + 262);
      c.textAlign = 'left';
    });
    this.endC = endTop + 150;
    this.rollH = Math.ceil(y + 400);
  }

  private drawRoll() {
    const c = this.roll.ctx;
    this.roll.clear();
    c.textBaseline = 'alphabetic';
    for (const it of this.items) it.draw(c, it.y);
    this.roll.upload();
  }

  /** 拍子彎過的時間：每一拍一開始衝一下、拍尾放慢（捲動「頓一下」）。 */
  private beatWarp(t: number) {
    const b = this.ctx.audio.beatAt(t), i = Math.floor(b), x = b - i;
    return i + 0.6 * x + 0.4 * (1 - (1 - x) ** 3);
  }

  /** 名單上緣在畫面上的 y。 */
  private rollY(t: number) {
    const s = this.ctx.start;
    const wS = this.beatWarp(s), wA = this.beatWarp(this.tA), w = this.beatWarp(t);
    if (t < this.tA) {
      const u = clamp((w - wS) / Math.max(1e-3, wA - wS));
      return lerp(this.y0, this.yA, 1 - (1 - u) ** 2); // 一開始就在捲，慢慢停在主打留言
    }
    if (t < this.tB) return this.yA;
    // 停夠了：慢慢起步，照拍子往下捲，捲到最後一張卡停住
    const wB = this.beatWarp(this.tB);
    const beat = this.ctx.audio.beatPeriod(t);
    const dt = (w - wB) * beat;
    const ramp = 0.6 * beat;
    const dist = this.v1 * (dt < ramp ? (dt * dt) / (2 * ramp) : dt - ramp / 2);
    return Math.max(this.yEnd, this.yA - dist);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const k = inOut(t, s, e, 0.25, 0.35);
    if (!this.drawn) { this.drawRoll(); this.drawn = true; }
    const fi = frameIdx(t);
    // 放映機：逐格閃爍、片門抖動（大鼓時抖大一點）
    const flick = 1 + (hash(fi, 3) - 0.5) * 0.07;
    const kick = f.a.kick;
    const wx = (hash(fi, 1) - 0.5) * 1.4, wy = (hash(fi, 2) - 0.5) * 1.8 + 2.5 * kick;
    this.bg.u.flick!.value = flick;
    this.bg.u.k!.value = k;
    this.bg.render(renderer, out);
    const ry = this.rollY(t);
    const F2 = this.film;
    F2.u.roll!.value = this.roll.texture;
    (F2.u.rollPos!.value as THREE.Vector2).set(RX + wx, ry + wy);
    (F2.u.rollSize!.value as THREE.Vector2).set(RW, this.rollH);
    F2.u.flick!.value = flick;
    F2.u.k!.value = k;
    F2.u.fi!.value = fi % 997;
    // 刮痕：大約每兩秒有一段時間出現，位置每段換一次
    const seg = Math.floor(t * 0.7);
    F2.u.scratchA!.value = hash(seg, 11) < 0.4 ? 0.3 + 0.3 * hash(fi, 5) : 0;
    F2.u.scratchX!.value = 180 + hash(seg, 12) * 1500;
    F2.render(renderer, out);
    // 字幕（歌詞）：置中在脊線上，銀幕下緣
    const S = this.sub; S.clear();
    const c = S.ctx;
    c.globalAlpha = k;
    c.textBaseline = 'alphabetic';
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: F.archivo(100, 700), size: 54, minSize: 48, maxWidth: SUB.w - 40, align: 'center' as const, lineHeight: 1.12 };
      const lay = layoutLyric(c, ly.line, st);
      const yb = SUB.h - 24 - (lay.height - lay.size);
      // 字幕的陰影（片子上燒進去的字幕常常有一圈暗邊，讀起來才清楚）
      c.save(); c.translate(SPINE - SUB.x + 2, yb + 3);
      drawLyric(c, ly.line, t, { ...st, active: rgba('ink', 0.85), sung: rgba('ink', 0.85), unsung: rgba('ink', 0.4) }, lay, ly.k);
      c.restore();
      c.save(); c.translate(SPINE - SUB.x, yb);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else if (!lyrics.has) {
      c.font = font(F.mono(500), 22); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.75); c.textAlign = 'center';
      c.fillText(`♪　${song.title || ''}`, SPINE - SUB.x, SUB.h - 40);
      c.textAlign = 'left'; c.letterSpacing = '0px';
    }
    comp.draw(renderer, S.upload(), out, { ...subRect(SUB.x, SUB.y, SUB.w, SUB.h), opacity: flick });
    // 避開：主打留言停住時的那一段（名字＋留言，實際的字寬）與字幕
    const mw = Math.min(RW - 120, (this.fit?.width ?? 800) + 60);
    const avoid: Rect[] = [[SPINE - mw / 2, this.yA + this.msgSpan[0], mw, this.msgSpan[1] - this.msgSpan[0]], [SUB.x, SUB.y, SUB.w, SUB.h]];
    return { bloom: 0.5, vignette: 0.55, grain: 0.085, halation: 0.35, popups: 0.9, popupAvoid: avoid };
  }
}
