// 電腦桌面（暗）：一台老電腦的桌面（自己設計的「LOVE OS 1.0」，不像任何真的作業系統），隔著映像管看。
//  - 整張畫面用一半的解析度畫、放大時不內插（2×2 的方塊像素），再經過映像管 shader：掃描線、微微的桶狀變形、
//    暗角、一條慢慢往下走的更新帶（一小節走完一次），大鼓時螢幕亮一下。
//  - 「歌詞.txt」視窗：歌詞一句一句打在文字檔裡，照跟唱規則上色，方塊游標跟著拍子閃；純音樂時變成「播放中」的方塊頻譜。
//  - 主打留言是「新留言」通知視窗：第一拍從桌面上的「祝福」資料夾用縮放框（老電腦開視窗的那幾圈框線）打開。
//  - 右下的對話框每兩小節彈一個：「確定要永遠在一起嗎？ [是] [是]」，游標在一拍內滑過去、在小節線上按下右邊那顆，
//    下一拍對話框縮回去，再下一個小節線換下一個（「喜餅.exe 想要存取你的胃。允許嗎？ [允許] [允許一輩子]」…）。
// 畫法：桌布 shader → 中間的 render target；桌面上的東西畫在一張半解析度的 Canvas2D（fast、最近點放大）疊上去；
// 最後映像管 shader 從 render target 取樣畫到輸出。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, prog, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import type { Line } from '../engine/lyrics';
import { layoutLyric, drawLyric, lyricAt, drawHeart, fillWithHearts, signature, COUPLE_ZH, type LyricStyle } from './_motifs';
import { grid, windowLines, pad, type Grid } from './_t5';

export const spec: PlateSpecDecl = { group: 'type', family: 'screen', paper: false, energy: [0.25, 1], bars: [4, 8] };

type Rect = { x: number; y: number; w: number; h: number };
// ---------------------------------------------------------------- 版面
const MENU_Y = 44, MENU_H = 46;
const ED: Rect = { x: 128, y: 126, w: 1216, h: 330 }; // 歌詞.txt
const MSG: Rect = { x: 128, y: 492, w: 690, h: 470 }; // 新留言
const DLG: Rect = { x: 852, y: 560, w: 492, h: 250 }; // 對話框
const TITLE_H = 40;
const ICONS: { label: string; kind: 'doc' | 'folder' | 'app' | 'trash' }[] = [
  { label: '婚禮.txt', kind: 'doc' }, { label: '祝福', kind: 'folder' }, { label: '喜餅.exe', kind: 'app' }, { label: '資源回收桶', kind: 'trash' },
];
const ICON_X = 1640, ICON_Y0 = 150, ICON_DY = 150;
const LYRIC: LyricStyle = { family: F.hei(700), size: 70, minSize: 48, maxWidth: ED.w - 90, align: 'left', lineHeight: 1.25 };

/** 冷面的對話框（按鈕全都是「好」的意思）。 */
const DIALOGS: { q: string; a: string; b: string; icon: '?' | '!' }[] = [
  { q: '確定要永遠在一起嗎？', a: '是', b: '是', icon: '?' },
  { q: '喜餅.exe 想要存取你的胃。允許嗎？', a: '允許', b: '允許一輩子', icon: '!' },
  { q: '偵測到大量祝福，要全部接收嗎？', a: '接收', b: '全部接收', icon: '!' },
  { q: '要把「另一半」設為預設值嗎？', a: '是', b: '永遠是', icon: '?' },
  { q: '回憶太多，磁碟快滿了。要擴充嗎？', a: '擴充', b: '再擴充', icon: '!' },
  { q: '婚禮已儲存。要同時存成「永遠」嗎？', a: '好', b: '當然好', icon: '?' },
];
const DLG_TEXT = DIALOGS.map((d) => d.q + d.a + d.b).join('');

// ---------------------------------------------------------------- shader：桌布、映像管
const WALL = () => new FSPass(/* glsl */ `
  uniform float t;
  void main() {
    vec2 p = floor(vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y) / 2.0); // 跟桌面一樣是 2×2 的像素
    // 老桌面的點點花紋：每 4 個像素一點（很淡），再疊一點點大塊的明暗
    float dot = step(mod(p.x, 4.0), 0.5) * step(mod(p.y, 4.0), 0.5) + step(abs(mod(p.x, 4.0) - 2.0), 0.5) * step(abs(mod(p.y, 4.0) - 2.0), 0.5);
    vec3 col = mix(C_INK, C_INK2, 0.55) + (C_GRAPHITE - C_INK2) * dot * 0.13;
    fragColor = vec4(col, 1.0);
  }`, { t: { value: 0 } });

const CRT = () => new FSPass(/* glsl */ `
  uniform sampler2D src; uniform float t; uniform float bar; uniform float flash; uniform float k;
  void main() {
    // 桶狀變形（凸面玻璃）：越靠邊取樣越往外，畫面往中間擠，四角露出一點機殼
    vec2 c = vUv - 0.5;
    float r2 = dot(c * vec2(1.0, 0.75), c * vec2(1.0, 0.75));
    vec2 uv = 0.5 + c * (1.0 + 0.09 * r2) * 0.99;
    vec2 qb = abs(uv - 0.5) - (0.5 - 0.035);
    float glass = 1.0 - smoothstep(-0.0015, 0.0015, length(max(qb, 0.0)) - 0.035);
    if (glass <= 0.0) { fragColor = vec4(C_INK * 0.2, 1.0); return; }
    vec3 col = texture(src, uv).rgb;
    // 很輕的橫向模糊（電子束的寬度）：左右各取一點
    col = col * 0.7 + (texture(src, uv + vec2(1.5 / ${W}.0, 0.0)).rgb + texture(src, uv - vec2(1.5 / ${W}.0, 0.0)).rgb) * 0.15;
    // 掃描線：每 2 個像素一條（對齊方塊像素），暗的那一行留 72%
    float row = uv.y * ${H}.0;
    float scan = 0.72 + 0.28 * smoothstep(0.15, 0.6, abs(fract(row / 2.0) - 0.5) * 2.0);
    col *= scan;
    // 更新帶：一小節從上走到下
    float band = exp(-pow((1.0 - uv.y) - fract(bar), 2.0) * 900.0);
    col *= 1.0 + 0.06 * band + 0.05 * flash;
    // 螢幕邊緣的暗角與玻璃的圓角
    col *= mix(0.72, 1.0, 1.0 - smoothstep(0.55, 1.15, length(c * vec2(1.25, 1.0)) * 1.2));
    col = mix(C_INK * 0.2, col, glass);
    fragColor = vec4(col * k, 1.0);
  }`, { src: { value: null }, t: { value: 0 }, bar: { value: 0 }, flash: { value: 0 }, k: { value: 1 } });

/** 中間的 render target（整晚共用一張：這個版面同時只會有一個在畫）。 */
const RT = () => makeRT(W, H, { depthBuffer: false });

interface Dlg { i: number; tOpen: number; tClick: number; tClose: number }

export default class Desktop extends Scene {
  wall = shared('desktop.wall', WALL);
  crt = shared('desktop.crt', CRT);
  rt = shared('desktop.rt', RT);
  /** 半解析度的桌面：放大時用最近點，才會是方塊像素。 */
  layer = this.track(new Layer2D(W, H, 0.5, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  g!: Grid;
  fit: FitResult | null = null;
  tMsg = 0;
  dlgs: Dlg[] = [];
  lines: Line[] = [];
  clock = '20:13';

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const g = this.g = grid(au, s, e);
    this.layer.texture.magFilter = THREE.NearestFilter;
    this.lines = windowLines(lyrics, s, e);
    const m = this.msg;
    const mins = 18 * 60 + 30 + (Math.max(1, song.index) - 1) * 4 + Math.floor(s / 60);
    this.clock = `${pad(Math.floor(mins / 60) % 24, 2)}:${pad(mins % 60, 2)}`;
    await loadText(`${DLG_TEXT}${ICONS.map((i) => i.label).join('')}檔案編輯婚禮說明新留言還沒有好收藏行播放中這段沒有歌詞掃描右下角把祝福傳到這台電腦歌詞.txt一位賓客${COUPLE_ZH}${song.title}${m ? m.text + m.name : ''}${this.lines.map((l) => l.text).join('')}`);
    const c = this.layer.ctx;
    const text = m ? m.text : '掃描右下角 QR code，把你的祝福傳到這台電腦';
    this.fit = fitText(c, text, m ? F.hand(400) : F.hei(500), MSG.w - 80, MSG.h - TITLE_H - 190, { min: 44, max: 68, lineHeight: 1.3, maxLines: 6 });
    this.tMsg = g.b0;
    // 對話框：第一拍之後的第一個小節線（至少隔一拍）開，下一個小節線按，再一拍關；每兩小節一個
    const bars = g.bars.filter((b) => b >= g.b0 + g.beat * 0.9);
    const start = Math.floor(hash(this.ctx.params.seed ?? 1, 7) * (DIALOGS.length - 1)) + 1;
    for (let k = 0, n = 0; k < bars.length; k += 2, n++) {
      const tOpen = bars[k]!;
      const tClick = bars[k + 1] ?? tOpen + g.beat * 3;
      if (tClick > e - g.beat * 0.3) break;
      this.dlgs.push({ i: n === 0 ? 0 : (start + n) % DIALOGS.length, tOpen, tClick, tClose: tClick + g.beat });
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio: au, lyrics } = this.ctx;
    const t = f.t, s = this.ctx.start, g = this.g;
    this.wall.u.t!.value = t;
    this.wall.render(renderer, this.rt);
    const L = this.layer; L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    this.menubar(c, t);
    this.icons(c, t);
    this.editor(c, t, lyrics.has ? lyricAt(lyrics, t) : null);
    this.message(c, t);
    this.dialogs(c, t);
    comp.draw(renderer, L.upload(), this.rt);
    const barPh = au.barAt(t);
    this.crt.u.src!.value = this.rt.texture;
    this.crt.u.t!.value = t;
    this.crt.u.bar!.value = barPh - Math.floor(barPh);
    this.crt.u.flash!.value = au.hit('kick', t, 0.1);
    // 開機：一開始是一條橫線，第一個半拍內撐開成整個畫面（老映像管）
    this.crt.u.k!.value = 0.35 + 0.65 * prog(t, s, s + 0.2);
    this.crt.render(renderer, out);
    return {
      bloom: 0.6, vignette: 0.25, grain: 0.05, ca: 1.6,
      popupAvoid: [[ED.x, ED.y, ED.w, ED.h], [MSG.x, MSG.y, MSG.w, MSG.h], [DLG.x, DLG.y, DLG.w, DLG.h]],
    };
  }

  // ---------------------------------------------------------------- 零件
  /** 老式視窗：2 px 的框、條紋標題列（作用中的是訊號色）、左上角的關閉鈕、置中的標題。 */
  private window(c: CanvasRenderingContext2D, r: Rect, title: string, active: boolean) {
    c.fillStyle = rgba('ink', 1); c.fillRect(r.x, r.y, r.w, r.h);
    // 硬邊的影子（往右下 8 px）
    c.fillStyle = rgba('ink', 0.85); c.fillRect(r.x + 8, r.y + r.h, r.w, 8); c.fillRect(r.x + r.w, r.y + 8, 8, r.h);
    c.strokeStyle = rgba('bone', 0.92); c.lineWidth = 2;
    c.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    c.fillStyle = rgba('bone', 0.92); c.fillRect(r.x, r.y + TITLE_H, r.w, 2);
    // 條紋
    c.fillStyle = active ? rgba('signal', 0.9) : rgba('graphite', 0.8);
    for (let y = r.y + 10; y < r.y + TITLE_H - 6; y += 6) c.fillRect(r.x + 10, y, r.w - 20, 2);
    // 標題（挖一塊底）
    c.font = font(F.hei(700), 24);
    const tw = c.measureText(title).width + 32;
    c.fillStyle = rgba('ink', 1); c.fillRect(r.x + (r.w - tw) / 2, r.y + 4, tw, TITLE_H - 8);
    c.fillStyle = rgba('bone', 0.95); c.textAlign = 'center';
    c.fillText(title, r.x + r.w / 2, r.y + 29);
    c.textAlign = 'left';
    // 關閉鈕
    c.fillStyle = rgba('ink', 1); c.fillRect(r.x + 16, r.y + 8, 26, 24);
    c.strokeStyle = rgba('bone', 0.9); c.strokeRect(r.x + 18, r.y + 10, 22, 20);
  }

  /** 開視窗的縮放框：幾圈框線從來源往目標長大（0..1）。 */
  private zoomRects(c: CanvasRenderingContext2D, from: Rect, to: Rect, u: number) {
    if (u <= 0 || u >= 1) return;
    c.strokeStyle = rgba('bone', 0.85); c.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const k = clamp(u * 1.6 - i * 0.15);
      if (k <= 0 || k >= 1) continue;
      const e = ease.outCubic(k);
      c.strokeRect(lerp(from.x, to.x, e), lerp(from.y, to.y, e), lerp(from.w, to.w, e), lerp(from.h, to.h, e));
    }
  }

  private menubar(c: CanvasRenderingContext2D, t: number) {
    c.fillStyle = rgba('bone', 0.9); c.fillRect(0, MENU_Y, W, MENU_H);
    c.fillStyle = rgba('ink', 1); c.fillRect(0, MENU_Y + MENU_H, W, 2);
    drawHeart(c, 128, MENU_Y + 24, 26, rgba('rose'));
    c.font = font(F.hei(700), 26); c.fillStyle = rgba('ink', 1);
    ['檔案', '編輯', '婚禮', '說明'].forEach((m, i) => c.fillText(m, 172 + i * 96, MENU_Y + 33));
    c.font = font(F.mono(600), 24); c.textAlign = 'right';
    // 時鐘的冒號跟著拍子閃
    const on = ((t - this.g.b0) / this.g.beat) % 1 < 0.5;
    const [hh, mm] = this.clock.split(':');
    c.fillText(`${hh}${on ? ':' : ' '}${mm}`, W - 128, MENU_Y + 32);
    c.font = font(F.mono(500), 20);
    c.fillText('LOVE OS 1.0', W - 250, MENU_Y + 31);
    c.textAlign = 'left';
  }

  private icons(c: CanvasRenderingContext2D, t: number) {
    ICONS.forEach((ic, i) => {
      const x = ICON_X, y = ICON_Y0 + i * ICON_DY;
      // 「祝福」資料夾：留言視窗打開的那一拍被點一下（反白）
      const hot = ic.kind === 'folder' && t >= this.tMsg - 0.05 && t < this.tMsg + 0.25;
      this.iconGlyph(c, x, y, ic.kind, hot);
      c.font = font(F.hei(500), 24);
      const w = c.measureText(ic.label).width;
      c.fillStyle = hot ? rgba('bone', 0.95) : rgba('ink', 0.9); c.fillRect(x + 50 - w / 2 - 8, y + 92, w + 16, 32);
      c.fillStyle = hot ? rgba('ink', 1) : rgba('bone', 0.9);
      c.fillText(ic.label, x + 50 - w / 2, y + 116);
    });
  }

  private iconGlyph(c: CanvasRenderingContext2D, x: number, y: number, kind: string, hot: boolean) {
    const fg = hot ? rgba('signal', 1) : rgba('bone', 0.9), bg = rgba('ink', 1);
    c.lineWidth = 3; c.strokeStyle = fg; c.fillStyle = bg;
    if (kind === 'doc') {
      c.beginPath(); c.moveTo(x + 26, y + 8); c.lineTo(x + 62, y + 8); c.lineTo(x + 76, y + 22); c.lineTo(x + 76, y + 82); c.lineTo(x + 26, y + 82); c.closePath(); c.fill(); c.stroke();
      for (let k = 0; k < 4; k++) c.fillRect(x + 34, y + 34 + k * 11, 34, 3);
      c.fillStyle = fg; for (let k = 0; k < 4; k++) c.fillRect(x + 34, y + 34 + k * 11, k === 3 ? 20 : 34, 3);
    } else if (kind === 'folder') {
      c.beginPath(); c.moveTo(x + 14, y + 24); c.lineTo(x + 40, y + 24); c.lineTo(x + 46, y + 32); c.lineTo(x + 86, y + 32); c.lineTo(x + 86, y + 80); c.lineTo(x + 14, y + 80); c.closePath(); c.fill(); c.stroke();
      drawHeart(c, x + 50, y + 57, 26, hot ? rgba('signal') : rgba('rose'));
    } else if (kind === 'app') {
      c.fillRect(x + 18, y + 18, 64, 60); c.strokeRect(x + 18, y + 18, 64, 60);
      c.beginPath(); c.arc(x + 50, y + 48, 18, 0, Math.PI * 2); c.stroke();
      c.fillStyle = fg; c.fillRect(x + 18, y + 18, 64, 10);
    } else {
      c.fillRect(x + 26, y + 22, 48, 60); c.strokeRect(x + 26, y + 22, 48, 60);
      c.fillStyle = fg; c.fillRect(x + 20, y + 14, 60, 6); c.fillRect(x + 42, y + 8, 16, 6);
      for (let k = 0; k < 3; k++) c.fillRect(x + 36 + k * 12, y + 32, 3, 40);
    }
  }

  /** 歌詞.txt：一句一句打在文字檔裡（最多看得到兩句：上一句與正在唱的）。 */
  private editor(c: CanvasRenderingContext2D, t: number, ly: { line: Line; k: number } | null) {
    const { audio: au, lyrics } = this.ctx;
    const instr = !lyrics.has || this.lines.length === 0;
    this.window(c, ED, instr ? '播放中.wav' : '歌詞.txt', true);
    const x0 = ED.x + 44, y0 = ED.y + TITLE_H + 24;
    const bodyH = ED.h - TITLE_H - 70;
    const g = this.g;
    const blink = ((t - g.b0) / g.beat) % 1 < 0.55;
    if (instr) {
      // 方塊頻譜：一格一格往上疊，像老播放軟體
      const N = 36, cw = (ED.w - 88) / N;
      for (let i = 0; i < N; i++) {
        const v = au.env(['low', 'bass', 'mid', 'other', 'high', 'vocal'][i % 6]!, t - i * 0.01) * (0.55 + 0.45 * hash(i, 5));
        const cells = Math.round(v * 11);
        for (let k = 0; k < cells; k++) {
          c.fillStyle = k > 8 ? rgba('ember', 0.95) : k > 5 ? rgba('signal', 0.9) : rgba('bone', 0.75);
          c.fillRect(x0 + i * cw, y0 + bodyH - 8 - k * 18, cw - 8, 12);
        }
      }
      c.font = font(F.mono(500), 20); c.fillStyle = rgba('ash', 0.9);
      c.fillText(lyrics.has ? '（間奏）' : '這段沒有歌詞，跟著搖擺就好', x0, ED.y + ED.h - 20);
    } else {
      // 上一句（已經打完的，淡）＋這一句（照跟唱規則）
      const cur = ly?.line ?? lyrics.lastLine(t);
      if (cur) {
        const lay = layoutLyric(c, cur, LYRIC);
        const prevLine = lyrics.lines[cur.i - 1];
        const rows = lay.rows.length;
        const base = y0 + (rows > 1 ? 118 : 178);
        if (prevLine && rows === 1 && cur.start - 0.35 <= t) {
          c.font = font(F.hei(700), 48); c.fillStyle = rgba('bone', 0.32);
          c.fillText(prevLine.text, x0, y0 + 72);
        }
        c.save(); c.translate(x0, base);
        drawLyric(c, cur, t, { ...LYRIC, active: rgba('signal'), sung: rgba('bone', 0.96), unsung: rgba('bone', 0.3) }, lay, 1);
        c.restore();
        // 方塊游標：停在唱到的地方
        let cx = x0, cyy = base;
        for (const pw of lay.words) {
          const p = pw.word.start <= t ? Math.min(1, (t - pw.word.start) / Math.max(1e-3, pw.word.end - pw.word.start)) : 0;
          if (p <= 0) break;
          cx = x0 + pw.x + pw.w * p + 6; cyy = base + pw.y;
        }
        if (blink) { c.fillStyle = rgba('signal', 0.95); c.fillRect(cx, cyy - lay.size * 0.85, lay.size * 0.45, lay.size * 0.98); }
      }
      c.font = font(F.mono(500), 20); c.fillStyle = rgba('ash', 0.85);
      c.fillText(`第 ${pad((cur?.i ?? 0) + 1, 2)} 行 · UTF-8 · ${Math.round(au.bpm)} BPM`, x0, ED.y + ED.h - 20);
    }
  }

  /** 新留言：第一拍從「祝福」資料夾用縮放框打開。 */
  private message(c: CanvasRenderingContext2D, t: number) {
    const u = prog(t, this.tMsg, this.tMsg + 0.24);
    const from: Rect = { x: ICON_X + 14, y: ICON_Y0 + ICON_DY + 24, w: 72, h: 56 };
    if (u < 1) { this.zoomRects(c, from, MSG, u); return; }
    const m = this.msg, fit = this.fit!;
    const dlgOpen = this.dlgs.some((d) => t >= d.tOpen && t < d.tClose + 0.2);
    this.window(c, MSG, m ? `新留言 — No.${pad(m.n)}` : '新留言', !dlgOpen);
    const x0 = MSG.x + 40;
    let y = MSG.y + TITLE_H + 50;
    // 寄件人
    c.font = font(F.mono(500), 20); c.fillStyle = rgba('ash', 0.9);
    c.fillText(m ? (m.couple ? '寄件人：新人 · FROM THE COUPLE' : `寄件人：${m.name || '一位賓客'}`) : '寄件人：（還沒有）', x0, y);
    c.fillStyle = rgba('bone', 0.3); c.fillRect(x0, y + 16, MSG.w - 80, 2);
    y += 34;
    c.font = font(m ? F.hand(400) : F.hei(500), fit.size); c.fillStyle = rgba('bone', 0.96);
    fit.lines.forEach((ln, i) => fillWithHearts(c, ln, x0, y + fit.size * 0.95 + i * fit.lineHeight));
    // 署名與按鈕
    const by = MSG.y + MSG.h - 78;
    if (m) {
      c.font = font(F.hand(400), 32); c.fillStyle = rgba('ash', 0.95);
      c.fillText(signature(m.name), x0, by - 22);
    }
    this.button(c, MSG.x + MSG.w - 170, by, 130, '好', false, true);
    this.button(c, MSG.x + MSG.w - 340, by, 150, '收藏 ♥', false, false);
  }

  private button(c: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, pressed: boolean, def: boolean) {
    const h = 54;
    c.fillStyle = pressed ? rgba('bone', 0.95) : rgba('ink', 1);
    c.fillRect(x, y, w, h);
    c.strokeStyle = rgba('bone', 0.92); c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
    if (def) { c.lineWidth = 3; c.strokeRect(x - 5, y - 5, w + 10, h + 10); }
    c.font = font(F.hei(700), 26); c.textAlign = 'center';
    c.fillStyle = pressed ? rgba('ink', 1) : rgba('bone', 0.95);
    c.fillText(label, x + w / 2, y + 36);
    c.textAlign = 'left';
  }

  /** 對話框：開（縮放框）→ 游標滑到右邊的按鈕 → 小節線上按下 → 下一拍縮回去。 */
  private dialogs(c: CanvasRenderingContext2D, t: number) {
    const g = this.g;
    const d = this.dlgs.find((x) => t >= x.tOpen && t < x.tClose + 0.25);
    // 游標：平常停在留言視窗旁邊，對話框出現時滑向按鈕
    let cx = MSG.x + MSG.w + 60, cy = MSG.y + 120;
    if (d) {
      const dl = DIALOGS[d.i]!;
      const from: Rect = { x: DLG.x + DLG.w / 2 - 30, y: DLG.y + DLG.h / 2 - 20, w: 60, h: 40 };
      const open = prog(t, d.tOpen, d.tOpen + 0.22);
      const close = prog(t, d.tClose, d.tClose + 0.2);
      const bw = Math.max(110, 40 + dl.b.length * 30), bx = DLG.x + DLG.w - bw - 34, by = DLG.y + DLG.h - 84;
      if (open < 1) this.zoomRects(c, from, DLG, open);
      else if (close > 0) this.zoomRects(c, DLG, from, close);
      else {
        this.window(c, DLG, '', true);
        // 圖示：圓圈裡的 ? 或 !
        c.strokeStyle = rgba('bone', 0.92); c.lineWidth = 3;
        c.beginPath(); c.arc(DLG.x + 62, DLG.y + TITLE_H + 56, 28, 0, Math.PI * 2); c.stroke();
        c.font = font(F.hei(900), 34); c.fillStyle = rgba('signal', 1); c.textAlign = 'center';
        c.fillText(dl.icon === '?' ? '?' : '!', DLG.x + 62, DLG.y + TITLE_H + 68);
        c.textAlign = 'left';
        const fit = fitText(c, dl.q, F.hei(500), DLG.w - 140, 90, { min: 26, max: 32, lineHeight: 1.3, maxLines: 2 });
        c.font = font(F.hei(500), fit.size); c.fillStyle = rgba('bone', 0.95);
        fit.lines.forEach((ln, i) => c.fillText(ln, DLG.x + 112, DLG.y + TITLE_H + 50 + i * fit.lineHeight));
        const pressed = t >= d.tClick && t < d.tClick + 0.16;
        this.button(c, bx - 40 - Math.max(90, 40 + dl.a.length * 30), by, Math.max(90, 40 + dl.a.length * 30), dl.a, false, false);
        this.button(c, bx, by, bw, dl.b, pressed, true);
      }
      // 游標：開好之後一拍內滑到右邊的按鈕，按下去，之後停著
      const mv = prog(t, d.tOpen + g.beat, d.tOpen + g.beat * 2, ease.outExpo);
      cx = lerp(cx, bx + bw * 0.6, mv); cy = lerp(cy, by + 30, mv);
      if (t >= d.tClick && t < d.tClick + 0.16) cy += 3;
    }
    this.cursor(c, cx, cy);
  }

  private cursor(c: CanvasRenderingContext2D, x: number, y: number) {
    c.save();
    c.translate(Math.round(x / 2) * 2, Math.round(y / 2) * 2);
    c.beginPath();
    c.moveTo(0, 0); c.lineTo(0, 40); c.lineTo(10, 31); c.lineTo(17, 46); c.lineTo(24, 43); c.lineTo(17, 28); c.lineTo(29, 28); c.closePath();
    c.fillStyle = rgba('bone', 1); c.fill();
    c.strokeStyle = rgba('ink', 1); c.lineWidth = 2.5; c.stroke();
    c.restore();
  }
}

