// 祝福登記表（certificate）的「印好的表格」：版面座標、文案、畫表格本身（表頭、欄位、勾選框、註腳）。
// 座標是「紙面座標」：鏡頭拉到全景（z≈0.97）時大約就是螢幕像素。鏡頭推近時整張紙一起縮放旋轉，
// 所以這裡只管紙上的東西放哪；鏡頭怎麼取景（字不能進 QR 區、離邊 96 px）在主檔算。
// 所有墨都用分色編碼畫（見 certificate-glsl.ts）：這裡只用 PRINT()（G 色版 = 印刷的墨），打字與印章在主檔畫。
// MV 融合原則（2026-09-28）：印刷的部分是配角——細線、淡墨、小字，資訊只留一張表「看得出是表」所需的最少量，
// 讓打上去的祝福內容成為整張紙上最大、最黑的字。
import { F, font, measure } from '../engine/type';
import { hash, TAU } from '../engine/util';
import { COUPLE_ZH, DATE_DOTS } from './_motifs';

type Ctx2 = CanvasRenderingContext2D;

// 分色編碼的墨（用 'lighter' 疊在不透明的黑底上，shader 再換成色票的顏色）。這些不是顏色，是色版。
export const TYPE = (a = 1) => `rgba(255,0,0,${a})`;
export const PRINT = (a = 1) => `rgba(0,255,0,${a})`;
export const SIG = (a = 1) => `rgba(0,0,255,${a})`;

/** 表格的版面（紙面座標）。 */
export const L = {
  /** 紙張本身：全景時四周露出一點暗色的桌面（紙是擺在桌上的一張實物，不是整個畫面）。 */
  sheet: { x0: 66, y0: 46, x1: 1854, y1: 1034 },
  x0: 176, x1: 1744,
  /** 表頭：一行小字＋細雙線（不再是實心色帶，免得搶過打上去的字）。 */
  head: { y: 116, rule: 140 },
  /** 主欄（登記人、歌詞、祝福內容、簽名）。 */
  col: { x0: 196, x1: 1270 },
  /** 右欄（勾選、方章）。 */
  right: { x0: 1350, x1: 1716 },
  name: { y: 236, x: 330, size: 44 },
  /** 字級是紙面像素：全景 z≈0.965 時螢幕上還要 ≥ 48（歌詞）／≥ 44（留言），所以下限各多留一點。 */
  lyric: { label: 302, rows: [380, 442], size: 52, min: 50 },
  /** 祝福內容：整張紙的主角，行距大、字級上限高。 */
  msg: { label: 508, rows: [612, 722, 832], max: 98, min: 46 },
  sig: { y: 932, x: 330, w: 520 },
  checks: { label: 236, y0: 296, gap: 46, box: 22 },
  seal: { label: 508, x: 1350, y: 548, box: 200, side: 188 },
  /** 號碼機蓋編號的位置：表頭右端（靠右對齊）。 */
  numberAt: { x: 1744, y: 118 },
  /** 註腳：只放在左半邊（x ≤ 1000）：鏡頭推近時右下角會落進 QR 區，那裡只留白紙。 */
  foot: { y: 994 },
  holes: [330, 770],
  holeX: 110,
} as const;

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
  '＊本表一式兩份，新郎新娘各執一份。',
  '＊祝福有效期限：永久；逾期仍然有效。',
  '＊請以愛心填寫，塗改無效。',
  '＊祝福份量不限，多填不罰。',
];

export interface FormCopy {
  /** 表格編號（表頭的 FORM 0313：用婚禮的月日）。 */
  form: string;
  /** 編號：No.042／SONG 03（號碼機蓋上去）。 */
  no: string;
  /** 第 2 欄的標題。 */
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
  '祝福登記表登記人現場歌詞播放歌曲祝福內容祝福項目簽名核准章新人（）',
  '間奏中本曲為純音樂，請自行哼唱一位不願具名的賓客全體賓客今晚的歌手代唱掃描右下角把祝福寫上大螢幕。以下空白♪',
  ...CHECK_SETS.flat(), ...COUPLE_CHECKS, ...NOTES, '百年好合謝謝大家', COUPLE_ZH,
].join('');

/** 欄位標題：黑體小字＋字距，淡淡的印刷墨（配角）。 */
function label(c: Ctx2, zh: string, x: number, y: number) {
  c.fillStyle = PRINT(0.58);
  c.font = font(F.hei(700), 18); c.letterSpacing = '6px';
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
  c.strokeStyle = PRINT(0.16); c.lineWidth = 1;
  for (const yy of L.holes) { c.beginPath(); c.arc(L.holeX, yy, 27, 0, TAU); c.stroke(); }

  // ---- 表頭：標題小字＋很小的表號，下面細雙線（編號在右端，由主檔的號碼機蓋上去）
  c.fillStyle = PRINT(0.85);
  c.font = font(F.hei(700), 22); c.letterSpacing = '12px';
  c.fillText('祝福登記表', col.x0, head.y);
  const tw = measure('祝福登記表', F.hei(700), 22, 12);
  c.fillStyle = PRINT(0.45);
  c.font = font(F.mono(500), 13); c.letterSpacing = '3px';
  c.fillText(cp.form, col.x0 + tw + 18, head.y);
  c.letterSpacing = '0px';
  c.fillStyle = PRINT(0.7); c.fillRect(x0, head.rule, x1 - x0, 1.6);
  c.fillStyle = PRINT(0.45); c.fillRect(x0, head.rule + 5, x1 - x0, 0.7);

  // ---- 登記人
  label(c, '登記人', col.x0, L.name.y);
  c.fillStyle = PRINT(0.3); c.fillRect(L.name.x - 10, L.name.y + 14, col.x1 - L.name.x + 10, 1.1);

  // ---- 現場歌詞（沒有留言時是「播放歌曲」）
  label(c, cp.field2, col.x0, L.lyric.label);
  c.fillStyle = PRINT(0.24);
  for (const y of L.lyric.rows) c.fillRect(col.x0, y + 14, col.x1 - col.x0, 1);

  // ---- 祝福內容（主角的欄：線比較清楚，像真的要人寫字的格子）
  label(c, '祝福內容', col.x0, L.msg.label);
  c.fillStyle = PRINT(0.3);
  for (const y of L.msg.rows) c.fillRect(col.x0, y + 18, col.x1 - col.x0, 1.1);

  // ---- 簽名
  label(c, '簽名', col.x0, L.sig.y);
  c.fillStyle = PRINT(0.45); c.fillRect(L.sig.x - 10, L.sig.y + 14, L.sig.w + 10, 1.2);

  // ---- 祝福項目（右欄，直排的勾選框：小字、淡一點，等一下被紅筆勾的那一格才是重點）
  label(c, '祝福項目', right.x0, L.checks.label);
  cp.checks.forEach((txt, i) => {
    const y = L.checks.y0 + i * L.checks.gap;
    const b = L.checks.box;
    c.strokeStyle = PRINT(0.62); c.lineWidth = 1.6;
    c.strokeRect(right.x0 + 2, y - b + 2, b, b);
    c.fillStyle = PRINT(0.66);
    c.font = font(F.hei(500), 20); c.letterSpacing = '3px';
    c.fillText(txt, right.x0 + b + 18, y);
    c.letterSpacing = '0px';
  });

  // ---- 核准章（虛線框：蓋章的地方，等一下的章會稍微超出去）
  label(c, '核准章', right.x0, L.seal.label);
  c.strokeStyle = PRINT(0.3); c.lineWidth = 1.2;
  c.setLineDash([7, 6]);
  c.strokeRect(L.seal.x, L.seal.y, L.seal.box, L.seal.box);
  c.setLineDash([]);

  // ---- 註腳（一句冷面的玩笑）
  c.fillStyle = PRINT(0.5);
  c.font = font(F.hei(500), 16); c.letterSpacing = '2px';
  c.fillText(cp.note, col.x0, L.foot.y);
  c.letterSpacing = '0px';
  c.restore();
}
