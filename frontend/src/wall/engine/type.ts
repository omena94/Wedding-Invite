// Typography: font registry (Canvas2D via FontFace + outlines via opentype.js),
// glyph layout, text outlines as Path2D, and point sampling of text for particle effects.
//
// 複製自 pdoom-video（MIT，見 ./LICENSE）並改成婚禮版：
//  - 拉丁字（Archivo、Cormorant、IBM Plex Mono）照 pdoom 的做法自己帶 TTF（/wall-fonts/），用 FontFace 註冊。
//  - 留言與歌詞多半是中文（也有韓文、簡體），所以每個字族後面都接一串 CJK 備援字型（Google Fonts，依 unicode-range 分片、
//    用到哪些字才下載哪幾片）。畫一段新文字之前要先 await loadText(text)，不然第一格會用系統字頂替。
//  - font() 會帶字重：Archivo 900 後面接的思源黑體也是 900，中英混排粗細才一致；FontFace 註冊時也帶上字重，
//    瀏覽器才不會對拉丁字做假粗體。
//  - 手寫聲音（pdoom 用單線筆畫字）中文沒有單線字型，改用霞鶩文楷；「寫出來」的效果用遮罩掃過去做（見 scenes/_motifs.ts）。
//  - 外框（opentype.js）只支援拉丁字；中文要點雲、遮罩請用 textPoints / 光柵化。
import * as opentype from 'opentype.js';

/**
 * Font keys. Archivo comes in static width instances (w = wdth*10) x weights so we can
 * animate width in discrete steps: 620, 750, 1000, 1250 and weights 300/500/700/900.
 * （婚禮版只帶四種寬度，檔案小一點；F.archivo 會挑最接近的。）
 */
export const ARCHIVO_WIDTHS = [620, 750, 1000, 1250] as const;
export const ARCHIVO_WEIGHTS = [300, 500, 700, 900] as const;

/** 字族後面接的 CJK 備援（依序：繁中、簡中、韓文、符號〔愛心 ♥〕）。 */
const CJK_SANS = '"Noto Sans TC", "Noto Sans SC", "Noto Sans KR", "Noto Sans Symbols 2", sans-serif';
const CJK_SERIF = '"Noto Serif TC", "Noto Serif SC", "Noto Serif KR", "Noto Sans Symbols 2", serif';
const CJK_HAND = '"LXGW WenKai TC", "Noto Serif TC", "Noto Serif SC", "Noto Serif KR", "Noto Sans Symbols 2", serif';

/** `features`: OpenType features switched on for the face (Canvas2D has no font-feature-settings). */
type FontDef = { family: string; file: string; weight: number; features?: string };
const DEFS: FontDef[] = [];
for (const w of ARCHIVO_WIDTHS) for (const wt of ARCHIVO_WEIGHTS) DEFS.push({ family: `Archivo-${w}-${wt}`, file: `Archivo-w${w}-${wt}.ttf`, weight: wt });
for (const wt of [400, 800]) DEFS.push({ family: `ArchivoItalic-1000-${wt}`, file: `ArchivoItalic-w1000-${wt}.ttf`, weight: wt });
// Cormorant defaults to old-style figures ("10" reads as "IO" at display sizes): lining figures instead
for (const wt of [400, 600]) {
  DEFS.push({ family: `Cormorant-${wt}`, file: `Cormorant-${wt}.ttf`, weight: wt, features: '"lnum" 1' });
  DEFS.push({ family: `CormorantItalic-${wt}`, file: `CormorantItalic-${wt}.ttf`, weight: wt, features: '"lnum" 1' });
}
for (const [n, f] of [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold']] as const)
  DEFS.push({ family: `Plex-${n}`, file: `IBMPlexMono-${f}.ttf`, weight: n });

/** 每個字族的 CSS 字重與備援串（font() 用）。 */
interface FamilyMeta { weight: number; css: string }
const META = new Map<string, FamilyMeta>();
for (const d of DEFS) {
  const cjk = d.family.startsWith('Cormorant') ? CJK_SERIF : CJK_SANS;
  META.set(d.family, { weight: d.weight, css: `"${d.family}", ${cjk}` });
}
// 純 CJK 的「字族」：沒有拉丁 TTF，直接用 Google Fonts 的字型（拉丁字也用它們自己的）
const CJK_ROLES = {
  hei: { weights: [300, 500, 700, 900], css: CJK_SANS }, // 思源黑體：留言的大字、標籤
  ming: { weights: [400, 700, 900], css: CJK_SERIF }, // 思源宋體：典雅的聲音（名字、證書）
  hand: { weights: [400, 700], css: CJK_HAND }, // 霞鶩文楷：手寫的聲音（仙女棒寫的字、卡片）
} as const;
for (const [role, r] of Object.entries(CJK_ROLES)) for (const wt of r.weights) META.set(`${role}-${wt}`, { weight: wt, css: r.css });

/** Convenience family names. */
export const F = {
  /** Archivo at nearest available width/weight. width in [62..125] (percent), weight 300..900 */
  archivo(width = 100, weight = 700): string {
    const w = nearest(ARCHIVO_WIDTHS as unknown as number[], width * 10);
    const wt = nearest(ARCHIVO_WEIGHTS as unknown as number[], weight);
    return `Archivo-${w}-${wt}`;
  },
  archivoItalic(_width = 100, weight = 800): string {
    return `ArchivoItalic-1000-${weight < 600 ? 400 : 800}`;
  },
  serif(weight = 400, italic = false): string {
    return `${italic ? 'CormorantItalic' : 'Cormorant'}-${weight < 500 ? 400 : 600}`;
  },
  mono(weight = 400, _italic = false): string {
    return `Plex-${nearest([300, 400, 500, 600], weight)}`;
  },
  /** 思源黑體（中文大字、標籤）。 */
  hei(weight = 900): string { return `hei-${nearest([...CJK_ROLES.hei.weights], weight)}`; },
  /** 思源宋體（典雅：名字、證書、鈔票）。 */
  ming(weight = 700): string { return `ming-${nearest([...CJK_ROLES.ming.weights], weight)}`; },
  /** 霞鶩文楷（手寫：仙女棒寫字、小卡）。 */
  hand(weight = 400): string { return `hand-${nearest([...CJK_ROLES.hand.weights], weight)}`; },
};

function nearest(list: number[], v: number) {
  let best = list[0]!;
  for (const x of list) if (Math.abs(x - v) < Math.abs(best - v)) best = x;
  return best;
}

/** CSS font string for Canvas2D（含字重與 CJK 備援）。 */
export const font = (family: string, sizePx: number) => {
  const m = META.get(family);
  return m ? `${m.weight} ${sizePx}px ${m.css}` : `${sizePx}px "${family}", ${CJK_SANS}`;
};

const otCache = new Map<string, opentype.Font>();
const bufCache = new Map<string, ArrayBuffer>();

/** Google Fonts 的 CJK 字型（依 unicode-range 分片）。display=block：字還沒到時畫布量到的寬度才不會是備援字。 */
const CJK_CSS = 'https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;700&family=Noto+Sans+TC:wght@300;500;700;900&family=Noto+Serif+TC:wght@400;700;900&family=Noto+Sans+SC:wght@300;500;700;900&family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+KR:wght@300;500;700;900&family=Noto+Serif+KR:wght@400;700;900&family=Noto+Sans+Symbols+2&display=block';

function loadCss(href: string) {
  return new Promise<void>((res) => {
    if (document.querySelector(`link[href="${href}"]`)) return res();
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    // 會場網路斷掉也不能卡住開機：失敗就用系統字（微軟正黑體等）頂著
    l.onload = () => res(); l.onerror = () => res();
    document.head.appendChild(l);
    setTimeout(res, 8000);
  });
}

export async function loadFonts(): Promise<void> {
  await Promise.all([
    loadCss(CJK_CSS),
    ...DEFS.map(async (d) => {
      const buf = await (await fetch(`/wall-fonts/${d.file}`)).arrayBuffer();
      bufCache.set(d.family, buf);
      const ff = new FontFace(d.family, buf, { weight: String(d.weight), ...(d.features ? { featureSettings: d.features } : {}) });
      await ff.load();
      document.fonts.add(ff);
    }),
  ]);
  await document.fonts.ready;
  // 介面上固定會出現的中文先載好
  await loadText('掃描留言給新人祝福第則首歌現正播放新郎新娘宣文孟庭百年好合永浴愛河早生貴子核准登記表姓名內容日期簽章謝謝大家♥０１２３４５６７８９');
}

/** CJK 字族與要準備的字重（loadText 用）。 */
const CJK_LOAD: [string, number[]][] = [
  ['Noto Sans TC', [300, 500, 700, 900]], ['Noto Serif TC', [400, 700, 900]], ['LXGW WenKai TC', [400, 700]],
  ['Noto Sans SC', [300, 500, 700, 900]], ['Noto Serif SC', [400, 700, 900]],
  ['Noto Sans KR', [300, 500, 700, 900]], ['Noto Serif KR', [400, 700, 900]], ['Noto Sans Symbols 2', [400]],
];

/**
 * 讓這段文字用到的 CJK 分片都下載好（每個字族、每個字重）。只會下載 unicode-range 有交集的分片，所以很便宜。
 * 最多等 `timeout` 毫秒：網路不好時寧可先用系統字，也不要讓畫面停住。
 */
export async function loadText(text: string, timeout = 6000): Promise<void> {
  if (!text) return;
  const jobs = CJK_LOAD.flatMap(([fam, wts]) => wts.map((w) => document.fonts.load(`${w} 40px "${fam}"`, text).catch(() => [])));
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, timeout))]);
}

/** opentype.js Font for outline work (lazy-parsed). 只有拉丁字型有。 */
export function ot(family: string): opentype.Font {
  let f = otCache.get(family);
  if (!f) {
    const buf = bufCache.get(family);
    if (!buf) throw new Error(`font not loaded: ${family}`);
    f = opentype.parse(buf);
    otCache.set(family, f);
  }
  return f;
}

export interface Glyph {
  ch: string;
  i: number; // char index in string
  x: number; // left edge (px), relative to the text origin
  w: number; // advance width (px)
}
export interface TextLayout {
  text: string;
  family: string;
  size: number;
  width: number; // total advance width
  ascent: number;
  descent: number;
  glyphs: Glyph[];
}

let measureCtx: CanvasRenderingContext2D | null = null;
function mctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

/**
 * Per-glyph horizontal layout with the font's kerning, for drawing glyphs one by one.
 * Glyph i sits at the width of text[0..i] minus its own advance, so the kerning between it and the
 * previous glyph moves *it* (the width of text[0..i) alone leaves that pair out: every kern would land
 * one glyph late, e.g. the Y–o kern of "Your" pushing the u into the o). `w` is the glyph's own advance.
 * `tracking` is extra letter spacing in px.
 */
export function layout(text: string, family: string, size: number, tracking = 0): TextLayout {
  const c = mctx();
  c.font = font(family, size);
  const glyphs: Glyph[] = [];
  const chars = Array.from(text);
  let prefix = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    prefix += ch;
    const w = c.measureText(ch).width;
    glyphs.push({ ch, i, x: c.measureText(prefix).width - w + i * tracking, w });
  }
  const m = c.measureText(text || 'M');
  return {
    text, family, size,
    width: (text ? m.width : 0) + Math.max(0, chars.length - 1) * tracking,
    ascent: m.fontBoundingBoxAscent ?? size * 0.8,
    descent: m.fontBoundingBoxDescent ?? size * 0.2,
    glyphs,
  };
}

/**
 * x (px) of glyph `index` in `text` set as one kerned run — where to start drawing text[index..] when a
 * word is split into separately drawn pieces (sung/unsung colours, a clipped wipe). Measuring
 * text[0..index) instead would drop the kern between the two pieces. Past the end: the run's width.
 */
export function glyphX(text: string, index: number, family: string, size: number, tracking = 0): number {
  const chars = Array.from(text);
  if (index <= 0) return 0;
  if (index >= chars.length) return measure(text, family, size, tracking);
  const c = mctx();
  c.font = font(family, size);
  return c.measureText(chars.slice(0, index + 1).join('')).width - c.measureText(chars[index]!).width + index * tracking;
}

/**
 * Typographic punctuation for display text: curly apostrophes and quotes, the ellipsis character.
 * Leading elisions (’cause, ’til, ’em, ’90s) get an apostrophe, not an opening quote.
 */
export function smart(s: string): string {
  return s
    .replace(/\.\.\./g, '…')
    .replace(/(^|[\s([{—–-])'(?=(?:cause|cos|til|em|round|n|tis|twas|\d0s)\b)/gi, '$1’')
    .replace(/(^|[\s([{—–-])'/g, '$1‘')
    .replace(/'/g, '’')
    .replace(/(^|[\s([{—–-])"/g, '$1“')
    .replace(/"/g, '”');
}

/** Typewriter quotes back (mono UI text that shows a lyric as typed input or code). */
export const plain = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');

export function measure(text: string, family: string, size: number, tracking = 0) {
  const c = mctx();
  c.font = font(family, size);
  return c.measureText(text).width + Math.max(0, Array.from(text).length - 1) * tracking;
}

/** Largest font size (<= max) at which text fits in maxWidth. */
export function fitSize(text: string, family: string, maxWidth: number, max = 400, tracking = 0) {
  const w = measure(text, family, 100, tracking * 100 / max);
  return Math.min(max, (100 * maxWidth) / Math.max(1, w));
}

/**
 * Outline of text as opentype commands at (x, baselineY). Glyphs are placed one by one at the
 * Canvas2D-measured positions (so outlines line up with fillText) — this also sidesteps
 * opentype.js's unsupported GSUB lookups (e.g. Archivo's ccmp) that crash font.getPath().
 * 只支援拉丁字型（F.archivo / F.serif / F.mono）；中文請改用光柵化。
 */
export function textPathCommands(text: string, family: string, size: number, x = 0, y = 0, tracking = 0) {
  const f = ot(family);
  const lay = layout(text, family, size, tracking);
  const cmds: opentype.PathCommand[] = [];
  for (const g of lay.glyphs) cmds.push(...f.charToGlyph(g.ch).getPath(x + g.x, y, size).commands);
  return cmds;
}

/** Outline of text as a Path2D at (x, baselineY). 只支援拉丁字型。 */
export function textPath2D(text: string, family: string, size: number, x = 0, y = 0, tracking = 0): Path2D {
  const p = new opentype.Path();
  p.commands = textPathCommands(text, family, size, x, y, tracking);
  return new Path2D(p.toPathData(3));
}

/**
 * Sample points inside the filled text (rasterized at `size`) on a jittered grid with spacing `step`.
 * Returns points relative to the text origin (left, baseline). Great for "text made of atoms".
 * （光柵化取樣，中文也可以用。）
 */
export function textPoints(text: string, family: string, size: number, step = 6, seed = 1): { x: number; y: number }[] {
  const lay = layout(text, family, size);
  const pad = Math.ceil(size * 0.3);
  const W = Math.ceil(lay.width + pad * 2), H = Math.ceil(size * 1.6);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.font = font(family, size);
  c.fillStyle = '#fff';
  c.textBaseline = 'alphabetic';
  const base = Math.round(size * 1.15);
  c.fillText(text, pad, base);
  const data = c.getImageData(0, 0, W, H).data;
  const out: { x: number; y: number }[] = [];
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const jx = x + (rnd() - 0.5) * step * 0.8, jy = y + (rnd() - 0.5) * step * 0.8;
      const ix = Math.max(0, Math.min(W - 1, Math.round(jx))), iy = Math.max(0, Math.min(H - 1, Math.round(jy)));
      if (data[(iy * W + ix) * 4 + 3]! > 128) out.push({ x: jx - pad, y: jy - base });
    }
  }
  return out;
}
