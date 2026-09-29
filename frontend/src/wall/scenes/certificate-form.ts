// 祝福登記表（certificate）的「印好的表格」：版面座標、文案、畫表格本身（表頭、欄位、勾選框、註腳）。
// 座標是「紙面座標」（1 單位 = 鏡頭 z = 1 時螢幕上的 1 px）。v2（2026-09-28）起鏡頭拉遠到整張桌面都看得到
// （讀字的時候 z ≈ Z_READ），所以這裡的字級都是「螢幕字級 ÷ Z_READ」：標準是螢幕上的 px。
// 所有墨都用分色編碼畫（見 certificate-glsl.ts）：這裡只用 PRINT()（G 色版 = 印刷的墨），手寫、打字與印章在主檔畫。
// MV 融合原則：印刷的部分是配角——細線、淡墨、小字（螢幕上 ≤ 22 px），讓寫上去的祝福成為整張紙上最黑的字。
import { F, font, measure } from '../engine/type';
import { hash, TAU } from '../engine/util';
import { COUPLE_ZH, DATE_DOTS } from './_motifs';

type Ctx2 = CanvasRenderingContext2D;

// 分色編碼的墨（用 'lighter' 疊在不透明的黑底上，shader 再換成色票的顏色）。這些不是顏色，是色版。
export const TYPE = (a = 1) => `rgba(255,0,0,${a})`;
export const PRINT = (a = 1) => `rgba(0,255,0,${a})`;
export const SIG = (a = 1) => `rgba(0,0,255,${a})`;

/** 讀字時鏡頭的縮放（紙面 → 螢幕）。字級照這個換算：螢幕 44 px 的字，紙面上是 44 / Z_READ。 */
export const Z_READ = 0.68;
/** 螢幕字級 → 紙面字級。 */
export const onPaper = (px: number) => px / Z_READ;

/** 表格的版面（紙面座標）。 */
export const L = {
  /** 紙張本身：擺在桌上，四周是桌面（v2：整張紙與桌上的筆、印章、茶杯都在畫面裡）。 */
  sheet: { x0: 66, y0: 46, x1: 1854, y1: 1034 },
  x0: 176, x1: 1744,
  /** 表頭：一行小字＋細雙線。 */
  head: { y: 128, rule: 156 },
  /** 主欄（歌詞、祝福內容、簽名）：螢幕上約 730 px 寬（留言區 ≤ 860）。 */
  col: { x0: 196, x1: 1270 },
  /** 右欄（勾選、方章、註腳）。 */
  right: { x0: 1350, x1: 1716 },
  /** 現場歌詞：兩行線（行距 90，螢幕上的字 40～52 px）。 */
  lyric: { label: 240, rows: [332, 422] },
  /** 祝福內容：四行線，行距 90（兩行以上時字級最多約 72 紙面 px，螢幕 ≈ 49）。 */
  msg: { label: 516, rows: [612, 702, 792, 882] },
  sig: { y: 982, x: 340, w: 560 },
  checks: { label: 240, y0: 316, gap: 60, box: 30 },
  seal: { label: 578, x: 1350, y: 612, box: 262, side: 244 },
  /** 號碼機蓋編號的位置：表頭右端（靠右對齊）。 */
  numberAt: { x: 1744, y: 128 },
  /** 註腳：右欄最下面（主欄最下面是簽名）。 */
  foot: { x: 1350, y: 1000 },
  holes: [330, 770],
  holeX: 110,
} as const;

/** 印刷字的字級（紙面 px）。螢幕上約 16～21 px：看得出是表格，但不搶留言。 */
export const FS = { title: 32, code: 18, label: 24, check: 28, note: 22, gap: 30 } as const;
export const CHECK_FONT = () => F.hei(500);
export const CHECK_TRACK = 4;

/** 勾選項目：同一晚會出現很多張，依種子換一組，最後一格永遠是「以上皆是」。 */
const CHECK_SETS = [
  ['百年好合', '永浴愛河', '早生貴子', '以上皆是'],
  ['白頭偕老', '永結同心', '甜甜蜜蜜', '以上皆是'],
  ['相親相愛', '幸福美滿', '天天開心', '以上皆是'],
];
/** 新人自己的留言（歡迎詞）配的勾選項目：新人關心的是大家吃飽沒。 */
const COUPLE_CHECKS = ['吃得飽', '喝得開心', '玩得盡興', '以上皆是'];
/** 冷面註腳（只開溫柔的玩笑）：一張表只印一句。 */
const NOTES = [
  '＊本祝福一經送出，恕不退還。',
  '＊本表一式兩份，新人各執一份。',
  '＊祝福有效期限：永久。',
  '＊請以愛心填寫，塗改無效。',
  '＊祝福份量不限，多填不罰。',
];

export interface FormCopy {
  /** 表格編號（表頭的 FORM 0313：用婚禮的月日）。 */
  form: string;
  /** 編號：No.042／SONG 03（號碼機蓋上去）。 */
  no: string;
  /** 第 1 欄的標題。 */
  field2: string;
  checks: string[];
  note: string;
  /** 方章的四個字（左上、右上、左下、右下）。 */
  seal: string;
}

export function makeCopy(seed: number, o: { no: string; field2: string; couple: boolean }): FormCopy {
  const [, mm = '03', dd = '13'] = DATE_DOTS.split(' · ');
  return {
    form: `FORM ${mm}${dd}`,
    no: o.no,
    field2: o.field2,
    checks: o.couple ? COUPLE_CHECKS : CHECK_SETS[Math.floor(hash(seed, 2) * CHECK_SETS.length)]!,
    note: NOTES[Math.floor(hash(seed, 3) * NOTES.length)]!,
    seal: o.couple ? '謝謝大家' : '百年好合',
  };
}

/** 這張表會畫到的固定中文字（init 時 loadText）。 */
export const FORM_TEXT = [
  '祝福登記表現場歌詞播放歌曲祝福內容祝福項目簽名核准章新人（）·',
  '間奏中本曲為純音樂，請自行哼唱一位賓客全體賓客今晚的歌手代唱掃描右下角把祝福寫上大螢幕。以下空白♪',
  ...CHECK_SETS.flat(), ...COUPLE_CHECKS, ...NOTES, '百年好合謝謝大家', COUPLE_ZH,
].join('');

/** 欄位標題：黑體小字＋字距，淡淡的印刷墨（配角）。 */
function label(c: Ctx2, zh: string, x: number, y: number) {
  c.fillStyle = PRINT(0.58);
  c.font = font(F.hei(700), FS.label); c.letterSpacing = '7px';
  c.fillText(zh, x, y);
  c.letterSpacing = '0px';
}

/** 畫印好的表格（G 色版）。 */
export function drawForm(c: Ctx2, cp: FormCopy) {
  const { x0, x1, head, col, right } = L;
  c.save();
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  // 打孔的補強圈（孔本身在 shader 裡挖）
  c.strokeStyle = PRINT(0.16); c.lineWidth = 1.4;
  for (const yy of L.holes) { c.beginPath(); c.arc(L.holeX, yy, 27, 0, TAU); c.stroke(); }

  // ---- 表頭：標題小字＋很小的表號，下面細雙線（編號在右端，由主檔的號碼機蓋上去）
  c.fillStyle = PRINT(0.85);
  c.font = font(F.hei(700), FS.title); c.letterSpacing = '14px';
  c.fillText('祝福登記表', col.x0, head.y);
  const tw = measure('祝福登記表', F.hei(700), FS.title, 14);
  c.fillStyle = PRINT(0.45);
  c.font = font(F.mono(500), FS.code); c.letterSpacing = '4px';
  c.fillText(cp.form, col.x0 + tw + 22, head.y);
  c.letterSpacing = '0px';
  c.fillStyle = PRINT(0.7); c.fillRect(x0, head.rule, x1 - x0, 2.2);
  c.fillStyle = PRINT(0.45); c.fillRect(x0, head.rule + 7, x1 - x0, 1.1);

  // ---- 現場歌詞（沒有留言時是「播放歌曲」）
  label(c, cp.field2, col.x0, L.lyric.label);
  c.fillStyle = PRINT(0.24);
  for (const y of L.lyric.rows) c.fillRect(col.x0, y + 18, col.x1 - col.x0, 1.4);

  // ---- 祝福內容（主角的欄：線比較清楚，像真的要人寫字的格子）
  label(c, '祝福內容', col.x0, L.msg.label);
  c.fillStyle = PRINT(0.3);
  for (const y of L.msg.rows) c.fillRect(col.x0, y + 20, col.x1 - col.x0, 1.5);

  // ---- 簽名
  label(c, '簽名', col.x0, L.sig.y);
  c.fillStyle = PRINT(0.45); c.fillRect(L.sig.x - 10, L.sig.y + 16, L.sig.w + 10, 1.6);

  // ---- 祝福項目（右欄，直排的勾選框：小字、淡一點，等一下被紅筆勾的那一格才是重點）
  label(c, '祝福項目', right.x0, L.checks.label);
  cp.checks.forEach((txt, i) => {
    const y = L.checks.y0 + i * L.checks.gap;
    const b = L.checks.box;
    c.strokeStyle = PRINT(0.62); c.lineWidth = 2;
    c.strokeRect(right.x0 + 2, y - b + 2, b, b);
    c.fillStyle = PRINT(0.66);
    c.font = font(CHECK_FONT(), FS.check); c.letterSpacing = `${CHECK_TRACK}px`;
    c.fillText(txt, right.x0 + b + 22, y);
    c.letterSpacing = '0px';
  });

  // ---- 核准章（虛線框：蓋章的地方，等一下的章會稍微超出去）
  label(c, '核准章', right.x0, L.seal.label);
  c.strokeStyle = PRINT(0.3); c.lineWidth = 1.6;
  c.setLineDash([9, 8]);
  c.strokeRect(L.seal.x, L.seal.y, L.seal.box, L.seal.box);
  c.setLineDash([]);

  // ---- 註腳（一句冷面的玩笑）
  c.fillStyle = PRINT(0.5);
  c.font = font(F.hei(500), FS.note); c.letterSpacing = '2px';
  c.fillText(cp.note, L.foot.x, L.foot.y);
  c.letterSpacing = '0px';
  c.restore();
}
