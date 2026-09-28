// 手機通知（暗）：新人的手機鎖定畫面，橫放、螢幕佔滿整個畫面（四角是螢幕的圓角、左邊一個前鏡頭挖孔）。
//  - 左上：鎖頭、日期（婚禮那天）、大時鐘。時鐘顯示的是「這首歌唱到第幾秒」，而且只在拍點上跳——
//    秒數換的時候那一位數字往上捲走、新的從下面捲上來，冒號跟著拍子閃。
//  - 右邊：通知一則一則滑下來。主打留言是最上面那張展開的通知（手寫字，讀得到），落在第一個小節線；
//    下面是一疊冷面的系統通知（「心率 132 BPM，跟著音樂跳」「今晚可以晚點睡」），每個小節換一張疊上去。
//  - 下面整條：音樂播放器的小卡，歌詞在這裡逐字跟唱；純音樂時變成跟著音樂跳的頻譜。
//  - 桌布是 shader：以右下角外的一點為圓心的細同心圓版畫線，每一下大鼓送出一圈訊號色的波紋沿著線跑出去；
//    通知卡片的地方桌布變成霧面玻璃（線淡掉、底提亮）。
//  - 窗格開始時螢幕是暗的，第一拍「亮起來」；最後一拍鎖頭彈開（解鎖）。
// 畫法：桌布＋霧面卡片一個全螢幕 shader（卡片位置每格傳進去），字與圖示一張 Canvas2D（fast）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, lerp, prog, pulse, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { layoutLyric, drawLyric, drawHeart, fillWithHearts, WEDDING_DATE, COUPLE_ZH, lyricAt, type LyricStyle } from './_motifs';
import { grid, windowLines, rrect, pad, mss, settle, type Grid } from './_t5';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0.1, 0.8], bars: [4, 8] };

// ---------------------------------------------------------------- 版面
const LX = 150; // 左欄（時鐘）
const NX = 720, NW = 620; // 通知欄 x 720..1340
const NTOP = 128;
const NBOT = 764;
const MC = { x: 150, y: 780, w: 1190, h: 204 }; // 音樂小卡 y 780..984
const MAXC = 6; // shader 裡的卡片數

const LYRIC: LyricStyle = { family: F.archivo(100, 700), size: 60, minSize: 48, maxWidth: MC.w - 220, align: 'left', lineHeight: 1.12 };

// ---------------------------------------------------------------- 桌布＋霧面卡片
const BG = () => new FSPass(/* glsl */ `
  uniform float t; uniform float wake; uniform float kicks[8]; uniform vec4 cards[${MAXC}]; uniform float cardA[${MAXC}];
  float box(vec2 p, vec4 r, float rad) { vec2 c = r.xy + r.zw * 0.5; return sdBox(p - c, r.zw * 0.5 - rad) - rad; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下
    vec2 C = vec2(1560.0, 1320.0); // 同心圓的圓心在右下角外面
    float d = length(p - C);
    // 底：左上稍亮的暗色
    vec3 col = C_INK + (C_INK2 - C_INK) * (0.4 + 0.9 * (1.0 - smoothstep(300.0, 1900.0, length(p - vec2(300.0, 150.0)))));
    // 細同心圓（版畫線）：粗細跟著慢慢變的雜訊，讓它有刻出來的手感
    float dark = 0.08 + 0.14 * (0.5 + 0.5 * fbm(p / 700.0 + vec2(0.0, t * 0.01), 3));
    float ln = hatch(d / 19.0, dark);
    // 大鼓的波紋：每一下送出一圈，沿著線往外跑、慢慢淡掉
    float ring = 0.0;
    for (int i = 0; i < 8; i++) {
      // 不用 continue（D3D 編譯展開迴圈時會有警告）：用 live 把不在時間內的波紋乘掉
      float age = t - kicks[i];
      float live = step(0.0, age) * step(age, 3.0);
      float x = (d - max(age, 0.0) * 820.0) / 46.0;
      ring += live * exp(-x * x) * exp(-max(age, 0.0) * 1.4);
    }
    // 霧面卡片：卡片裡的線淡掉、底提亮一點，邊緣一條細亮線
    float inCard = 0.0, edge = 0.0;
    for (int i = 0; i < ${MAXC}; i++) {
      float dc = box(p, cards[i], 30.0);
      float a = aaFill(dc) * cardA[i];
      inCard = max(inCard, a);
      edge = max(edge, aaStroke(dc, 1.2) * cardA[i]);
    }
    vec3 lineCol = C_BONE * 0.034 + C_SIGNAL * ring * 0.5;
    col += lineCol * ln * (1.0 - 0.8 * inCard);
    col += C_SIGNAL * ring * 0.018 * (1.0 - inCard);
    col = mix(col, mix(C_INK2, C_GRAPHITE, 0.22) + C_BONE * 0.012, inCard * 0.9);
    col += C_BONE * edge * 0.13;
    // 螢幕的圓角與前鏡頭挖孔（外面是機身的黑）
    float scr = aaFill(box(p, vec4(18.0, 18.0, ${W - 36}.0, ${H - 36}.0), 74.0));
    float hole = aaFill(length(p - vec2(58.0, 540.0)) - 15.0);
    col *= wake;
    col = mix(C_INK * 0.25, col, scr);
    col = mix(col, C_INK * 0.15, hole);
    col += C_BONE * aaStroke(length(p - vec2(58.0, 540.0)) - 15.0, 1.0) * 0.06;
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, wake: { value: 1 }, kicks: { value: new Array(8).fill(-99) },
  cards: { value: Array.from({ length: MAXC }, () => new THREE.Vector4()) }, cardA: { value: new Array(MAXC).fill(0) },
});

interface Note { app: string; icon: string; title: string; body: string; ago: string }
/** 冷面的系統通知（只開溫柔的玩笑）。{bpm}、{n} 會換成這首歌的速度、第幾首。 */
const SYSTEM: Note[] = [
  { app: '健康', icon: '♥', title: '心率偵測', body: '目前 {bpm} BPM，跟著音樂跳', ago: '現在' },
  { app: '行事曆', icon: '13', title: '婚禮', body: '進行中 · 全天 · 請盡情享受', ago: '今天' },
  { app: '電量', icon: '▮', title: '電量 100%', body: '今天特別有電', ago: '1 分鐘前' },
  { app: '提醒事項', icon: '✓', title: '別忘了', body: '拿喜餅、跟新人合照、寫一則祝福', ago: '3 分鐘前' },
  { app: '鬧鐘', icon: '◷', title: '明天的鬧鐘已關閉', body: '今晚可以晚點睡', ago: '5 分鐘前' },
  { app: '訊息', icon: '…', title: '芃芃', body: '汪（1 則新訊息）', ago: '8 分鐘前' },
  { app: '音樂', icon: '♪', title: '今晚的歌單', body: '第 {n} 首，還有好多首', ago: '10 分鐘前' },
];
const SYS_TEXT = SYSTEM.map((n) => n.app + n.title + n.body + n.ago).join('');

interface Card { note: Note; t0: number }

export default class Phone extends Scene {
  bg = shared('phone.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  /** 主打那張通知：出現時間、排好的留言、卡片高度。 */
  tHero = 0;
  heroFit: FitResult | null = null;
  heroH = 0;
  heroTitle = '';
  /** 下面那一疊：每張出現的時間。 */
  stack: Card[] = [];
  date = '';
  /** 時鐘每一位數字的格寬。 */
  digitW = 0;
  colonW = 0;

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    const c = this.layer.ctx;
    const [yy, mm, dd] = String(WEDDING_DATE).split('-').map(Number) as [number, number, number];
    const dow = new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay();
    this.date = `${mm}月${dd}日 星期${'日一二三四五六'[dow]}`;
    const lines = windowLines(lyrics, s, e);
    await loadText(`${SYS_TEXT}${this.date}祝福傳來新人的手機掃描右下角你的祝福就會跳出通知純音樂間奏中則通知已收到第首${COUPLE_ZH}${song.title}${song.artist}${this.msg ? this.msg.text + this.msg.name : ''}${lines.map((l) => l.text).join('')}`);
    const bpm = Math.round(au.bpm);
    const fill = (n: Note): Note => ({ ...n, body: n.body.replace('{bpm}', String(bpm)).replace('{n}', String(song.index)) });

    // 主打的通知：第一個小節線（第一拍之後至少一拍）滑下來
    this.tHero = Math.max(g.b0 + g.beat, g.bar0);
    if (this.tHero > s + g.beat * 3) this.tHero = g.b0 + g.beat;
    const m = this.msg;
    const body = m ? m.text : '掃描右下角 QR code，你的祝福就會跳出通知';
    this.heroTitle = m ? `${m.name || '一位賓客'} 傳來祝福` : '新人的手機';
    // 主打卡片＋下面一疊（至少 110 高）要放得進通知欄：留言的框高由此決定
    this.heroFit = fitText(c, body, m ? F.hand(400) : F.hei(500), NW - 60, NBOT - NTOP - 18 - 110 - 190, { min: 44, max: 64, lineHeight: 1.26, maxLines: 6 });
    this.heroH = 24 + 44 + 18 + 40 + 14 + this.heroFit.height + this.heroFit.size * 0.3 + 26;

    // 一疊系統通知：第一拍先來一張，主打之後每個小節再疊一張（窗格裡最多六張）
    const start = Math.floor(hash(this.ctx.params.seed ?? 1, song.index) * SYSTEM.length);
    const order = SYSTEM.map((_, i) => fill(SYSTEM[(start + i) % SYSTEM.length]!));
    this.stack.push({ note: order[0]!, t0: -Infinity }); // 窗格開始前就在的
    this.stack.push({ note: order[1]!, t0: g.b0 });
    let k = 2;
    for (const b of g.bars) if (b > this.tHero + g.beat * 1.5 && b < e - g.beat && k < order.length) this.stack.push({ note: order[k++]!, t0: b });

    // 時鐘的格寬：所有數字裡最寬的（數字捲動時不會左右跳）
    c.font = font(F.archivo(62, 300), 250);
    this.digitW = Math.max(...'0123456789'.split('').map((d) => c.measureText(d).width));
    this.colonW = c.measureText(':').width + 10;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics, song } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, g = this.g;
    // 螢幕在第一拍亮起來（之前是「抬起來還沒亮」的暗）
    const wake = 0.28 + 0.72 * prog(t, g.b0 - 0.04, g.b0 + 0.22, ease.outExpo);
    const unlockT = e - g.beat * 0.9;
    const unlock = prog(t, unlockT, unlockT + 0.3, ease.outBack);
    const exit = prog(t, e - 0.28, e, ease.inCubic);

    // ---- 卡片位置（每格算，彈簧）
    const heroIn = settle(t, this.tHero, 2.2, 0.7);
    const heroY = NTOP;
    const stackTop = lerp(NTOP, NTOP + this.heroH + 18, clamp(heroIn, 0, 1.1));
    const cards: [number, number, number, number, number][] = []; // x y w h alpha
    if (t >= this.tHero) cards.push([NX, heroY - (1 - clamp(heroIn)) * 60, NW, this.heroH * clamp(0.6 + 0.4 * heroIn, 0, 1.05), clamp(heroIn * 2)]);
    // 疊：最新的在前面，後面的兩張只露出一條邊
    const shown = this.stack.filter((cd) => cd.t0 <= t);
    const front = shown[shown.length - 1];
    // 一疊的前面那張：主打很長時壓扁（只剩標題），還放不下就不畫
    const FH = Math.min(150, NBOT - stackTop);
    const room = NBOT - stackTop;
    const pile = Math.min(2, shown.length - 1);
    if (FH >= 100) for (let i = pile; i >= 1; i--) cards.push([NX + 18 * i, Math.min(stackTop + FH - 20 + 14 * i, NBOT - 10), NW - 36 * i, 30, 0.7 - 0.2 * i]);
    let frontIn = 1;
    if (front && FH >= 100) {
      frontIn = front.t0 === -Infinity ? 1 : settle(t, front.t0, 2.4, 0.66);
      cards.push([NX, stackTop - (1 - clamp(frontIn)) * 40, NW, FH, clamp(frontIn * 2)]);
    }
    // 音樂小卡
    cards.push([MC.x, MC.y, MC.w, MC.h, 1]);
    const bgU = this.bg.u;
    bgU.t!.value = t; bgU.wake!.value = wake * (1 - 0.6 * exit);
    const kk = bgU.kicks!.value as number[];
    const ev = au.events('kick', t - 3, t + 0.001).slice(-8);
    for (let i = 0; i < 8; i++) kk[i] = ev[i]?.[0] ?? -99;
    const cv = bgU.cards!.value as THREE.Vector4[], ca = bgU.cardA!.value as number[];
    for (let i = 0; i < MAXC; i++) {
      const cd = cards[i];
      if (cd && room > 0) { cv[i]!.set(cd[0], cd[1], cd[2], cd[3]); ca[i] = cd[4] * wake; } else ca[i] = 0;
    }
    this.bg.render(renderer, out);

    const L = this.layer; L.clear();
    const c = L.ctx;
    c.globalAlpha = (0.35 + 0.65 * wake) * (1 - exit);
    this.status(c, t);
    this.clock(c, t, unlock);
    if (t >= this.tHero) this.heroCard(c, t, heroY - (1 - clamp(heroIn)) * 60, clamp(heroIn * 2));
    if (front && FH >= 100) {
      c.save();
      c.beginPath(); c.rect(NX - 10, stackTop - 60, NW + 20, NBOT - stackTop + 60); c.clip();
      this.sysCard(c, front.note, NX, stackTop - (1 - clamp(frontIn)) * 40, FH, clamp(frontIn * 2), shown.length - 1);
      c.restore();
    }
    this.music(c, t, lyrics.has && lyricAt(lyrics, t) !== null, song.title, song.artist);
    comp.draw(renderer, L.upload(), out);
    void s;
    return {
      bloom: 0.55, vignette: 0.3,
      zoom: 1 + 0.006 * pulse(t, this.tHero, 0.15) + 0.004 * pulse(t, front?.t0 ?? -9, 0.12),
      popupAvoid: [[LX - 20, 120, 620, 560], [NX - 10, NTOP - 10, NW + 20, NBOT - NTOP + 20], [MC.x - 10, MC.y - 10, MC.w + 20, MC.h + 20]],
    };
  }

  // ---------------------------------------------------------------- 左欄
  private status(c: CanvasRenderingContext2D, t: number) {
    const { audio: au } = this.ctx;
    c.font = font(F.mono(500), 20); c.letterSpacing = '2px'; c.fillStyle = rgba('bone', 0.8);
    c.fillText('LOVE  5G', 118, 78);
    c.letterSpacing = '0px';
    // 右上：訊號格（跟著頻段跳）、電池 100%
    const x = 1690, y = 78;
    const v = [au.env('low', t), au.env('mid', t), au.env('high', t), au.env('rms', t)];
    v.forEach((a, i) => { const hh = 6 + i * 4; c.fillStyle = rgba('bone', 0.35 + 0.6 * clamp(a * 1.6)); c.fillRect(x + i * 9, y - hh, 6, hh); });
    c.strokeStyle = rgba('bone', 0.8); c.lineWidth = 2;
    rrect(c, x + 52, y - 20, 50, 22, 6); c.stroke();
    c.fillStyle = rgba('bone', 0.85); rrect(c, x + 56, y - 16, 42, 14, 3); c.fill();
    c.fillRect(x + 104, y - 13, 3, 8);
  }

  /** 鎖頭、日期、大時鐘、兩個小工具。 */
  private clock(c: CanvasRenderingContext2D, t: number, unlock: number) {
    const { audio: au, song, live } = this.ctx;
    // 鎖頭：最後一拍彈開
    const lx = LX + 4, ly = 150;
    c.strokeStyle = rgba('bone', 0.9); c.lineWidth = 4; c.lineCap = 'round';
    const lift = 14 * unlock;
    c.beginPath();
    c.moveTo(lx + 5, ly + 24); c.lineTo(lx + 5, ly + 14 - lift);
    c.arc(lx + 17, ly + 14 - lift, 12, Math.PI, 0);
    // 右腳：鎖著時插進鎖身，打開時縮在上面
    c.lineTo(lx + 29, ly + 24 - lift * 1.6);
    c.stroke();
    c.fillStyle = rgba('bone', 0.9); rrect(c, lx, ly + 22, 34, 28, 6); c.fill();
    // 日期
    c.font = font(F.hei(500), 40); c.fillStyle = rgba('bone', 0.92);
    c.fillText(this.date, LX, 262);
    // 大時鐘：這首歌唱到第幾秒，只在拍點上換
    const bt = t >= au.beats[0]! ? au.timeOfBeat(Math.floor(au.beatAt(t) + 1e-6)) : t;
    const cur = Math.floor(bt + 1e-3);
    const prevBt = t >= au.beats[0]! ? au.timeOfBeat(Math.floor(au.beatAt(t) + 1e-6) - 1) : t - 1;
    const prev = Math.floor(prevBt + 1e-3);
    const r = prog(t, bt, bt + 0.32, ease.outExpo);
    const fmt = (x: number) => `${pad(Math.floor(x / 60), 2)}:${pad(x % 60, 2)}`;
    const a = fmt(prev), b = fmt(cur);
    const size = 250, base = 520;
    c.font = font(F.archivo(62, 300), size);
    let x = LX - 10;
    for (let i = 0; i < b.length; i++) {
      const ch = b[i]!, old = a[i]!;
      const cw = ch === ':' ? this.colonW : this.digitW;
      if (ch === ':') {
        // 冒號：每拍的前半亮
        const on = f01(au.beatAt(t)) < 0.5;
        c.fillStyle = rgba('bone', on ? 0.95 : 0.35);
        c.fillText(':', x + 2, base - 18);
      } else {
        c.save();
        c.beginPath(); c.rect(x - 4, base - size * 0.8, cw + 8, size * 0.86); c.clip();
        const dx = x + (cw - c.measureText(ch).width) / 2;
        if (ch !== old && r < 1) {
          c.fillStyle = rgba('bone', 0.96 * (1 - r)); c.fillText(old, x + (cw - c.measureText(old).width) / 2, base - r * size * 0.8);
          c.fillStyle = rgba('signal', 1); c.fillText(ch, dx, base + (1 - r) * size * 0.8);
        } else {
          // 剛換上的數字先是訊號色，半拍內冷卻成紙白
          const hot = ch !== old ? 1 - prog(t, bt + 0.32, bt + 0.32 + this.g.beat * 0.6) : 0;
          c.fillStyle = mixRgba('bone', 'signal', hot, 0.96); c.fillText(ch, dx, base);
        }
        c.restore();
      }
      x += cw;
    }
    // 小工具：心率（這首歌的 BPM）、第幾首、已收到幾則
    const kick = au.hit('kick', t, 0.14);
    const wy = 610;
    const pill = (px: number, label: string, val: string) => {
      c.font = font(F.mono(500), 22); c.letterSpacing = '1px';
      const w = c.measureText(val).width + 76 + label.length * 22;
      c.fillStyle = rgba('bone', 0.08); rrect(c, px, wy - 40, w, 58, 29); c.fill();
      c.fillStyle = rgba('bone', 0.9); c.fillText(val, px + 44 + label.length * 22, wy - 3);
      c.letterSpacing = '0px';
      c.font = font(F.hei(500), 22); c.fillStyle = rgba('ash', 0.95); c.fillText(label, px + 38, wy - 3);
      return w;
    };
    drawHeart(c, LX + 20, wy - 11, 22 * (1 + 0.25 * kick));
    const w1 = pill(LX, '心率', `${Math.round(au.bpm)} BPM`);
    c.font = font(F.hei(700), 22); c.fillStyle = rgba('signal', 0.95); c.fillText('♪', LX + w1 + 36, wy - 3);
    pill(LX + w1 + 18, '', `NO.${pad(song.index, 2)} / ${pad(song.count, 2)}`);
    c.font = font(F.mono(500), 18); c.letterSpacing = '3px'; c.fillStyle = rgba('ash', 0.8);
    c.fillText(`已收到 ${pad(live.count)} 則祝福`, LX, wy + 60);
    c.letterSpacing = '0px';
  }

  // ---------------------------------------------------------------- 通知
  private heroCard(c: CanvasRenderingContext2D, t: number, y: number, a: number) {
    const m = this.msg, fit = this.heroFit!;
    c.save();
    c.globalAlpha *= a;
    const x = NX;
    this.icon(c, x + 26, y + 24, m ? '♥' : '♪', true);
    c.font = font(F.mono(500), 19); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.95);
    c.fillText(m ? `祝福 · No.${pad(m.n)}${m.couple ? ' · FROM THE COUPLE' : ''}` : '祝福', x + 88, y + 54);
    c.textAlign = 'right'; c.fillText('現在', x + NW - 28, y + 54); c.textAlign = 'left';
    c.letterSpacing = '0px';
    c.font = font(F.hei(700), 32); c.fillStyle = rgba('bone', 0.96);
    c.fillText(this.heroTitle, x + 28, y + 24 + 44 + 18 + 32);
    c.font = font(m ? F.hand(400) : F.hei(500), fit.size); c.fillStyle = rgba('bone', 0.95);
    const by = y + 24 + 44 + 18 + 40 + 14 + fit.size * 0.92;
    fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x + 28, by + i * fit.lineHeight));
    c.restore();
  }

  private sysCard(c: CanvasRenderingContext2D, n: { app: string; icon: string; title: string; body: string; ago: string }, x: number, y: number, h: number, a: number, more: number) {
    c.save();
    c.globalAlpha *= a;
    this.icon(c, x + 26, y + 24, n.icon, false);
    c.font = font(F.mono(500), 18); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.9);
    c.fillText(n.app, x + 88, y + 52);
    c.textAlign = 'right'; c.fillText(more > 0 ? `${n.ago} · 還有 ${more} 則` : n.ago, x + NW - 28, y + 52); c.textAlign = 'left';
    c.letterSpacing = '0px';
    c.font = font(F.hei(700), 28); c.fillStyle = rgba('bone', 0.92);
    c.fillText(n.title, x + 28, y + 100);
    if (h >= 140) { c.font = font(F.hei(400), 27); c.fillStyle = rgba('bone', 0.72); c.fillText(n.body, x + 28, y + 136); }

    c.restore();
  }

  /** 圓角方形的 App 圖示（自己設計的：一個符號）。 */
  private icon(c: CanvasRenderingContext2D, x: number, y: number, glyph: string, hot: boolean) {
    c.fillStyle = hot ? rgba('signal', 0.95) : mixRgba('graphite', 'ink2', 0.1);
    rrect(c, x, y, 46, 46, 12); c.fill();
    if (glyph === '♥') { drawHeart(c, x + 23, y + 24, 28, hot ? rgba('ink') : rgba('rose')); return; }
    c.font = font(glyph.length > 1 && /\d/.test(glyph) ? F.mono(600) : F.hei(900), glyph.length > 1 ? 20 : 26);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = hot ? rgba('ink') : rgba('bone', 0.9);
    c.fillText(glyph, x + 23, y + 25);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  // ---------------------------------------------------------------- 音樂小卡
  private music(c: CanvasRenderingContext2D, t: number, singing: boolean, title: string, artist: string) {
    const { audio: au, lyrics } = this.ctx;
    const x = MC.x, y = MC.y;
    // 封面：細同心圓，大鼓一打就縮一下
    const kick = au.hit('kick', t, 0.12);
    const ax = x + 22, ay = y + 22, as = 160;
    c.save();
    c.fillStyle = mixRgba('blood', 'ink2', 0.35); rrect(c, ax, ay, as, as, 18); c.fill();
    c.beginPath(); c.roundRect(ax, ay, as, as, 18); c.clip();
    c.strokeStyle = rgba('signal', 0.55); c.lineWidth = 1.3;
    const cx = ax + as / 2, cy = ay + as / 2;
    for (let r = 10; r < 120; r += 9) { c.beginPath(); c.arc(cx, cy, r * (1 - 0.04 * kick), 0, Math.PI * 2); c.stroke(); }
    drawHeart(c, cx, cy + 2, 34 * (1 + 0.15 * kick));
    c.restore();
    // 歌名、歌手（小）
    const tx = x + 210;
    c.font = font(F.mono(500), 19); c.letterSpacing = '2px'; c.fillStyle = rgba('ash', 0.95);
    const head = `♪ ${title || '今晚的歌'}${artist ? ' · ' + artist : ''}`;
    c.fillText(head.length > 48 ? head.slice(0, 47) + '…' : head, tx, y + 50);
    c.letterSpacing = '0px';
    // 歌詞（或純音樂的頻譜）
    const ly = lyricAt(lyrics, t);
    if (singing && ly) {
      const lay = layoutLyric(c, ly.line, LYRIC);
      const top = lay.rows.length > 1 ? y + 100 : y + 128;
      c.save(); c.translate(tx, top);
      drawLyric(c, ly.line, t, { ...LYRIC, active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3) }, lay, ly.k);
      c.restore();
    } else {
      // 間奏：跟著音樂跳的頻譜＋一行小字
      const N = 40, bw = (MC.w - 260) / N;
      for (let i = 0; i < N; i++) {
        const v = au.env(['low', 'bass', 'mid', 'other', 'high'][i % 5]!, t - i * 0.012) * (0.6 + 0.4 * hash(i, 3));
        const hh = 8 + 64 * v;
        c.fillStyle = rgba(i / N < prog(t, this.ctx.start, this.ctx.end) ? 'signal' : 'bone', 0.75);
        rrect(c, tx + i * bw, y + 128 - hh, bw * 0.55, hh, 2); c.fill();
      }
      c.font = font(F.hei(500), 26); c.fillStyle = rgba('ash', 0.9);
      c.fillText(lyrics.has ? '間奏中' : '純音樂', tx, y + 170);
    }
    // 進度條（整首歌）＋時間
    const dur = au.duration, p = clamp(t / dur);
    const px0 = tx, px1 = MC.x + MC.w - 150, py = y + MC.h - 22;
    c.fillStyle = rgba('bone', 0.18); c.fillRect(px0, py, px1 - px0, 4);
    c.fillStyle = rgba('bone', 0.85); c.fillRect(px0, py, (px1 - px0) * p, 4);
    c.beginPath(); c.arc(px0 + (px1 - px0) * p, py + 2, 7, 0, Math.PI * 2); c.fill();
    c.font = font(F.mono(500), 18); c.fillStyle = rgba('ash', 0.9);
    c.fillText(`${mss(t)} / ${mss(dur)}`, px1 + 18, py + 7);
  }
}

const f01 = (x: number) => x - Math.floor(x);
