// 批次 T12（科學 B：magnet、prism、microscope、venn、piechart、hourglass）共用的小工具：
//  - 亮版面的跟唱：紙上的訊號色太淡，正在唱的字改用訊號色的暗部（blood），底下墊一道訊號色的螢光筆，訊號色照樣在畫面上
//  - 窗格裡最長的一句歌詞要幾行（給 popupAvoid 算歌詞的範圍：小卡在出現那一刻就決定位置，要回傳整個窗格會用到的範圍）
//  - 字的「點雲」：把排好的留言光柵化成點，每個點記得自己屬於第幾個字（鐵粉、沙粒一個字一個字聚過來用）
// mono 標籤、逐字時間表、紙張等沿用 _t11.ts。
import { Lyrics, type Line } from '../engine/lyrics';
import { F, font, layout, textPoints } from '../engine/type';
import { rgba } from '../engine/palette';
import { layoutLyric, drawLyric, type LyricStyle, type LyricLayout } from './_motifs';
import { fitText, type FitResult } from '../engine/text';

/** 右下角 HUD（QR）：字不要進到 x ≥ 1360 且 y ≥ 830。 */
export const HUD = { x: 1360, y: 830 };

/**
 * 歌詞的字級（MV 融合原則：一格只有一個焦點）。有主打留言時留言是主角、歌詞是配角：比留言小一截（至少 48 px）；
 * 沒有留言時歌詞就是主角。
 */
export function lyricSizeFor(msgSize: number | null, solo = 64): number {
  return msgSize === null ? solo : Math.max(48, Math.min(56, Math.round(msgSize * 0.7)));
}

/** 亮版面的歌詞樣式：唱完是墨色、還沒唱是三成墨、正在唱是訊號色的暗部。 */
export function paperLyric(size: number, maxWidth: number, o: Partial<LyricStyle> = {}): LyricStyle {
  return { family: F.archivo(100, 800), size, minSize: 48, maxWidth, active: rgba('blood'), sung: rgba('sepia', 0.95), unsung: rgba('sepia', 0.26), ...o };
}

/**
 * 畫一行歌詞（已經 translate 到對齊點）。`hi`：正在唱的字底下墊一道螢光筆（訊號色，跟著唱的進度長出來），
 * 亮版面用；暗版面不用墊。回傳正在唱的字的筆尖位置。
 */
export function lyricLine(c: CanvasRenderingContext2D, line: Line, t: number, st: LyricStyle, alpha = 1, hi = false): { x: number; y: number } | null {
  const lay = layoutLyric(c, line, st);
  if (hi) {
    c.save();
    c.globalAlpha = alpha;
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      if (p <= 0 || p >= 1) continue;
      c.fillStyle = rgba('signal', 0.42);
      c.fillRect(pw.x - lay.size * 0.06, pw.y - lay.size * 0.42, (pw.w + lay.size * 0.12) * p, lay.size * 0.5);
    }
    c.restore();
  }
  return drawLyric(c, line, t, st, lay, alpha);
}

/** 窗格 [s, e] 裡的歌詞，用這個樣式排最多幾行（0 = 這個窗格沒有歌詞）。 */
export function lyricRows(c: CanvasRenderingContext2D, lines: Line[], st: LyricStyle): number {
  let rows = 0;
  for (const line of lines) rows = Math.max(rows, layoutLyric(c, line, st).rows.length);
  return rows;
}

/** 一行歌詞排出來的高度（第一行基線以上的字高＋其他行）。 */
export const lyricHeight = (lay: LyricLayout) => lay.height;

/**
 * 韓文歌的原文副行（drawLyric 自動畫在主行下面）讓歌詞變深：窗格裡有副行的句子，副行最後一排基線在主行最後一排基線
 * 以下最多多深（0 = 這一格沒有副行，版面照舊）。給「歌詞下面要讓出來的範圍」用（鐵粉的空白區等）。
 * 要在 render 裡算：副行開關是引擎每個窗格設的（有主打留言的窗格收起來）。
 */
export function subDepth(c: CanvasRenderingContext2D, lines: Line[], st: LyricStyle): number {
  let d = 0;
  for (const line of lines) {
    const lay = layoutLyric(c, line, st);
    if (lay.sub) d = Math.max(d, lay.height - lay.size - lay.rows[lay.rows.length - 1]!.y);
  }
  return d;
}

/**
 * 歌詞在上方、下面緊接著主視覺（圓餅圖、稜鏡、文氏圖）的版面：原來的設計替歌詞留了「兩排主行」的深度。
 * 主行折兩排又有原文副行時會比這個深、壓到下面的圖——整段往上挪，最多挪到字頂離畫面上緣 96 px。
 * 回傳往上挪幾 px；沒有翻譯的歌、或主行＋副行還在原本的深度內，都是 0（畫面跟原本一模一樣）。
 * 用整個窗格最深的那一句算（同一格裡歌詞的位置不跳）。base = 主行第一排基線（畫面 px）。
 */
export function subLift(c: CanvasRenderingContext2D, lines: Line[], st: LyricStyle, base: number): number {
  let d = 0;
  for (const line of lines) {
    const lay = layoutLyric(c, line, st);
    if (lay.sub) d = Math.max(d, lay.height - lay.size);
  }
  if (d <= 0) return 0;
  const room = st.size * (st.lineHeight ?? 1.18);
  return Math.max(0, Math.min(d - room, base - st.size * 0.9 - 96));
}

export interface GlyphPts {
  /** 點的座標（畫面座標）與它屬於第幾個字。 */
  x: Float32Array;
  y: Float32Array;
  g: Uint16Array;
  n: number;
  /** 每個字：字元、左邊界、基線、寬度。 */
  glyphs: { ch: string; x: number; y: number; w: number }[];
}

/**
 * 把排好的幾行字光柵化成點（間距 step，稍微抖一下）。lines 的第 i 行基線在 y0 + i × lineHeight，
 * align = 'center' 時以 x 為中線。每個點記下它落在哪個字裡（用字的左右邊界判斷）。
 */
export function glyphPoints(lines: string[], family: string, size: number, x: number, y0: number, lineHeight: number, step: number, align: 'left' | 'center' = 'left', seed = 1): GlyphPts {
  const xs: number[] = [], ys: number[] = [], gs: number[] = [];
  const glyphs: GlyphPts['glyphs'] = [];
  lines.forEach((ln, li) => {
    const lay = layout(ln, family, size);
    const lx = align === 'center' ? x - lay.width / 2 : x;
    const by = y0 + li * lineHeight;
    const base = glyphs.length;
    for (const gl of lay.glyphs) glyphs.push({ ch: gl.ch, x: lx + gl.x, y: by, w: gl.w });
    const pts = textPoints(ln, family, size, step, seed + li * 131);
    for (const p of pts) {
      // 落在哪個字：最後一個左邊界 ≤ x 的字（空白字元不會有點）
      let k = 0;
      for (let j = 0; j < lay.glyphs.length; j++) if (lay.glyphs[j]!.x <= p.x + 0.5) k = j;
      xs.push(lx + p.x); ys.push(by + p.y); gs.push(base + k);
    }
  });
  return { x: Float32Array.from(xs), y: Float32Array.from(ys), g: Uint16Array.from(gs), n: xs.length, glyphs };
}

/** 一段文字用某個字族、字級排開的寬度（量字用的小工具）。 */
export function textW(c: CanvasRenderingContext2D, s: string, family: string, size: number) {
  c.font = font(family, size);
  return c.measureText(s).width;
}

/**
 * 跟 fitText 一樣找最大字級，但行數少一點也放得夠大（至少最大字級的 good 倍）時選少的那種：
 * 「新婚快樂！！！」排成一行大字，比「新婚／快樂！！！」兩行更大一點好讀。長留言不受影響（字級不到 big 就照原本的排法）。
 */
export function fitFew(c: CanvasRenderingContext2D, text: string, family: string, w: number, h: number, o: { min?: number; max?: number; lineHeight?: number; maxLines?: number }, good = 0.72, big = 80): FitResult {
  const full = fitText(c, text, family, w, h, o);
  for (let n = 1; n < full.lines.length; n++) {
    const r = fitText(c, text, family, w, h, { ...o, maxLines: n });
    // 長留言本來就小：只有換完還是大字（≥ big）才少排一行
    if (r.lines.length <= n && r.size >= full.size * good && r.size >= Math.max(big, o.min ?? 0)) return r;
  }
  return full;
}
