// 祝福登記表（certificate）的「印好的表格」：版面座標、文案、畫表格本身（表頭、欄位、勾選框、註腳）。
// 座標是「紙面座標」：鏡頭拉到全景（z≈0.97）時大約就是螢幕像素。鏡頭推近時整張紙一起縮放旋轉，
// 所以這裡只管紙上的東西放哪；鏡頭怎麼取景（字不能進 QR 區、離邊 96 px）在主檔算。
// 所有墨都用分色編碼畫（見 certificate-glsl.ts）：這裡只用 PRINT()（G 色版 = 印刷的墨），打字與印章在主檔畫。
import { F, font, measure } from '../engine/type';
import { hash, TAU } from '../engine/util';
import { COUPLE_EN, COUPLE_ZH, DATE_DOTS } from './_motifs';

type Ctx2 = CanvasRenderingContext2D;

// 分色編碼的墨（用 'lighter' 疊在不透明的黑底上，shader 再換成色票的顏色）。這些不是顏色，是色版。
export const TYPE = (a = 1) => `rgba(255,0,0,${a})`;
export const PRINT = (a = 1) => `rgba(0,255,0,${a})`;
export const SIG = (a = 1) => `rgba(0,0,255,${a})`;

/** 表格的版面（紙面座標）。 */
export const L = {
  x0: 176, x1: 1744,
  band: { y: 96, h: 76 },
  meta: { y: 182, h: 52, w: [560, 300, 360, 348] },
  /** 主欄（登記人、歌詞、祝福內容、簽名）。 */
  col: { x0: 196, x1: 1216 },
  /** 右欄（勾選、方章）。下緣不超過 830：再下面是螢幕右下角 QR 的地盤。 */
  right: { x0: 1300, x1: 1716 },
  name: { y: 300, x: 420, size: 50 },
  /** 字級是紙面像素：全景 z≈0.965 時螢幕上還要 ≥ 48（歌詞）／≥ 44（留言），所以下限各多留一點。 */
  lyric: { label: 364, rows: [430, 494], size: 56, min: 50 },
  msg: { label: 552, rows: [630, 716, 802], max: 74, min: 46 },
  sig: { y: 884, x: 430, w: 520 },
  checks: { label: 300, y0: 360, gap: 48, box: 26 },
  seal: { label: 564, x: 1300, y: 588, box: 220, side: 236 },
  approve: { x: 1098, y: 288, hw: 138, hh: 48 },
  /** 號碼機蓋編號的位置：資料列第二格（x0 + 第一格寬 + 12）。 */
  numberAt: { x: 176 + 560 + 12, y: 226 },
  /** 註腳：只放在左半邊（x ≤ 1000）：鏡頭推近時右下角會落進 QR 區，那裡只留白紙。 */
  foot: { rule: 944, y: 976, x1: 1000 },
  holes: [330, 770],
  holeX: 104,
} as const;

/** 勾選項目：同一晚會出現很多張，依種子換一組，最後一格永遠是「以上皆是」。 */
const CHECK_SETS = [
  ['百年好合', '永浴愛河', '早生貴子', '以上皆是'],
  ['白頭偕老', '永結同心', '甜甜蜜蜜', '以上皆是'],
  ['相親相愛', '幸福美滿', '天天開心', '以上皆是'],
];
/** 新人自己的留言（歡迎詞）配的勾選項目：新人關心的是大家吃飽沒。 */
const COUPLE_CHECKS = ['吃得飽', '喝得開心', '玩得盡興', '以上皆是'];
/** 冷面註腳（只開溫柔的玩笑）。 */
const NOTES = [
  '＊本祝福一經送出，恕不退還。',
  '＊本表一式兩份，新郎新娘各執一份。',
  '＊祝福有效期限：永久；逾期仍然有效。',
  '＊本表經新人核准後，即具永久效力。',
  '＊祝福份量不限，多填不罰。',
];

export interface FormCopy {
  /** 表格編號（表頭的 FORM 0313：用婚禮的月日）。 */
  form: string;
  /** 編號欄：No.042／SONG 03。 */
  no: string;
  /** 第 2 欄的標題（中、英）與旁邊的小字註記。 */
  field2: [string, string, string];
  checks: string[];
  notes: string[];
  /** 方章的四個字（左上、右上、左下、右下）。 */
  seal: string;
}

export function makeCopy(seed: number, o: { no: string; field2: [string, string, string]; couple: boolean }): FormCopy {
  const [, mm = '03', dd = '13'] = DATE_DOTS.split(' · ');
  const k = Math.floor(hash(seed, 3) * NOTES.length);
  const k2 = (k + 1 + Math.floor(hash(seed, 4) * (NOTES.length - 1))) % NOTES.length;
  return {
    form: `FORM ${mm}${dd}`,
    no: o.no,
    field2: o.field2,
    checks: o.couple ? COUPLE_CHECKS : CHECK_SETS[Math.floor(hash(seed, 2) * CHECK_SETS.length)]!,
    notes: [NOTES[k]!, NOTES[k2]!],
    seal: o.couple ? '謝謝大家' : '百年好合',
  };
}

/** 這張表會畫到的固定中文字（init 時 loadText）。 */
export const FORM_TEXT = [
  '祝福登記表請以正楷或愛心填寫核發單位編號登記日期有效期限永久婚禮籌備委員會登記人現場歌詞本表填寫時播放之歌曲',
  '祝福內容（請以愛心填寫，塗改無效）祝福項目（可複選）簽名請在此簽名字跡潦草者，視同真心核准章請勿超出框線已登錄',
  '間奏中本曲為純音樂，請自行哼唱新人一位不願具名的賓客全體賓客今晚的歌手代唱掃描右下角把祝福寫上大螢幕。播放歌曲祝福內容由歌手代唱逐字登錄（以下空白）♪',
  ...CHECK_SETS.flat(), ...COUPLE_CHECKS, ...NOTES, '百年好合謝謝大家核准', COUPLE_ZH,
].join('');

/** 欄位標題：「1.」＋中文（黑體、字距）＋英文小字。回傳標題右端的 x（後面接說明用）。 */
function label(c: Ctx2, n: string, zh: string, en: string, x: number, y: number) {
  c.fillStyle = PRINT(1);
  c.font = font(F.mono(600), 16); c.letterSpacing = '2px';
  c.fillText(n, x, y);
  c.font = font(F.hei(700), 21); c.letterSpacing = '5px';
  c.fillText(zh, x + 30, y);
  const w = measure(zh, F.hei(700), 21, 5) + 5;
  c.font = font(F.mono(500), 12); c.letterSpacing = '3px';
  c.fillStyle = PRINT(0.6);
  c.fillText(en, x + 30 + w + 8, y);
  c.letterSpacing = '0px';
  return x + 30 + w + 8 + measure(en, F.mono(500), 12, 3);
}

/** 畫印好的表格（G 色版）。 */
export function drawForm(c: Ctx2, cp: FormCopy) {
  const { x0, x1, band, meta, col, right } = L;
  c.save();
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  // 打孔的補強圈（孔本身在 shader 裡挖）
  c.strokeStyle = PRINT(0.2); c.lineWidth = 1;
  for (const yy of L.holes) { c.beginPath(); c.arc(L.holeX, yy, 27, 0, TAU); c.stroke(); }
  // 左邊界直排的印刷小字（表單的版次代碼，真的表格都有）
  c.save();
  c.translate(150, 900); c.rotate(-Math.PI / 2);
  c.font = font(F.mono(500), 11); c.letterSpacing = '4px'; c.fillStyle = PRINT(0.45);
  c.fillText(`${cp.form} · REV. ${DATE_DOTS.split(' · ')[0]} · PRINTED WITH LOVE`, 0, 0);
  c.restore();

  // ---- 表頭：實心色帶、字反白（difference 把 G 色版挖掉）
  c.fillStyle = PRINT(1);
  c.fillRect(x0, band.y, x1 - x0, band.h);
  c.globalCompositeOperation = 'difference';
  c.fillStyle = PRINT(1);
  c.font = font(F.archivo(125, 900), 52);
  c.fillText(cp.form, x0 + 26, band.y + 58);
  const tx = x0 + 26 + measure(cp.form, F.archivo(125, 900), 52) + 48;
  c.font = font(F.hei(700), 27); c.letterSpacing = '14px';
  c.fillText('祝福登記表', tx, band.y + 36);
  c.font = font(F.mono(500), 13); c.letterSpacing = '3px';
  c.fillText('BLESSING REGISTRATION  ·  請以正楷或愛心填寫', tx, band.y + 61);
  c.textAlign = 'right';
  c.font = font(F.mono(600), 15); c.letterSpacing = '4px';
  c.fillText(COUPLE_EN.toUpperCase(), x1 - 20, band.y + 34);
  c.font = font(F.mono(400), 13); c.letterSpacing = '3px';
  c.fillText(DATE_DOTS, x1 - 20, band.y + 59);
  c.textAlign = 'left';
  c.letterSpacing = '0px';
  c.globalCompositeOperation = 'lighter';

  // ---- 表頭下的資料列
  const cells: [string, string, string][] = [
    ['核發單位', 'ISSUED BY', `${COUPLE_ZH} 婚禮籌備委員會`],
    ['編號', 'NO.', cp.no],
    ['登記日期', 'DATE', DATE_DOTS],
    ['有效期限', 'VALID UNTIL', '永久  ∞'],
  ];
  let mx = x0;
  cells.forEach(([zh, en, v], i) => {
    // 編號欄空著：號碼是第一個拍點用號碼機「蓋」上去的（主檔的 drawNumber，位置 L.numberAt）
    c.fillStyle = PRINT(0.6);
    c.font = font(F.hei(500), 13); c.letterSpacing = '3px';
    c.fillText(zh, mx + 12, meta.y + 16);
    c.font = font(F.mono(500), 11); c.letterSpacing = '2px';
    c.fillText(en, mx + 12 + measure(zh, F.hei(500), 13, 3) + 10, meta.y + 16);
    if (i !== 1) {
      c.fillStyle = PRINT(0.95);
      c.font = font(F.hei(700), 19); c.letterSpacing = '1px';
      c.fillText(v, mx + 12, meta.y + 43);
      c.letterSpacing = '0px';
    }
    mx += meta.w[i]!;
    if (i < cells.length - 1) { c.fillStyle = PRINT(0.6); c.fillRect(mx, meta.y + 2, 1.2, meta.h - 4); }
  });
  c.fillStyle = PRINT(0.85); c.fillRect(x0, meta.y + meta.h + 6, x1 - x0, 1.6);

  // ---- 1. 登記人
  label(c, '1.', '登記人', 'NAME', col.x0, L.name.y);
  c.fillStyle = PRINT(0.4); c.fillRect(L.name.x - 10, L.name.y + 14, col.x1 - L.name.x + 10, 1.2);

  // ---- 2. 現場歌詞（標題右邊一行小字：這張表填寫時在播哪首歌）
  const [f2zh, f2en, f2note] = cp.field2;
  const lx = label(c, '2.', f2zh, f2en, col.x0, L.lyric.label);
  c.fillStyle = PRINT(0.6);
  c.font = font(F.hei(500), 15); c.letterSpacing = '1px';
  let sl = f2note;
  // 太長就截斷（只是註記，不能擠到右欄）
  while (Array.from(sl).length > 14 && measure(sl, F.hei(500), 15, 1) > col.x1 - lx - 24) sl = Array.from(sl).slice(0, -2).join('') + '…';
  c.fillText(sl, lx + 24, L.lyric.label);
  c.letterSpacing = '0px';
  c.fillStyle = PRINT(0.3);
  for (const y of L.lyric.rows) c.fillRect(col.x0, y + 14, col.x1 - col.x0, 1.1);

  // ---- 3. 祝福內容
  const mx2 = label(c, '3.', '祝福內容', 'MESSAGE', col.x0, L.msg.label);
  c.fillStyle = PRINT(0.55);
  c.font = font(F.hei(500), 15); c.letterSpacing = '1px';
  c.fillText('（請以愛心填寫，塗改無效）', mx2 + 18, L.msg.label);
  c.letterSpacing = '0px';
  c.fillStyle = PRINT(0.32);
  for (const y of L.msg.rows) c.fillRect(col.x0, y + 14, col.x1 - col.x0, 1.2);

  // ---- 4. 簽名（主欄最下面）
  label(c, '4.', '簽名', 'SIGNATURE', col.x0, L.sig.y);
  c.fillStyle = PRINT(0.6); c.fillRect(L.sig.x - 10, L.sig.y + 14, L.sig.w + 10, 1.3);
  c.font = font(F.mono(500), 11); c.letterSpacing = '3px'; c.fillStyle = PRINT(0.55);
  c.fillText('SIGN HERE', L.sig.x - 10, L.sig.y + 34);
  c.font = font(F.hei(500), 13); c.letterSpacing = '1px';
  c.fillText('字跡潦草者，視同真心', L.sig.x + 96, L.sig.y + 34);
  c.letterSpacing = '0px';

  // ---- 5. 祝福項目（右欄，直排的勾選框）
  label(c, '5.', '祝福項目', '(可複選)', right.x0, L.checks.label);
  cp.checks.forEach((txt, i) => {
    const y = L.checks.y0 + i * L.checks.gap;
    const b = L.checks.box;
    c.strokeStyle = PRINT(0.95); c.lineWidth = 2;
    c.strokeRect(right.x0 + 2, y - b + 2, b, b);
    c.fillStyle = PRINT(0.95);
    c.font = font(F.hei(500), 26); c.letterSpacing = '3px';
    c.fillText(txt, right.x0 + b + 20, y);
    c.letterSpacing = '0px';
  });

  // ---- 6. 核准章（虛線框：蓋章的地方。「請勿超出框線」——等一下的章會稍微超出去）
  const sx = label(c, '6.', '核准章', 'SEAL', right.x0, L.seal.label);
  c.fillStyle = PRINT(0.55);
  c.font = font(F.hei(500), 13); c.letterSpacing = '1px';
  c.fillText('請勿超出框線', sx + 14, L.seal.label);
  c.letterSpacing = '0px';
  c.strokeStyle = PRINT(0.45); c.lineWidth = 1.3;
  c.setLineDash([7, 6]);
  c.strokeRect(L.seal.x, L.seal.y, L.seal.box, L.seal.box);
  c.setLineDash([]);

  // ---- 註腳
  c.fillStyle = PRINT(0.85); c.fillRect(x0, L.foot.rule, L.foot.x1 - x0, 1.2);
  c.fillStyle = PRINT(0.75);
  c.font = font(F.hei(500), 16); c.letterSpacing = '1px';
  c.fillText(cp.notes[0]!, col.x0, L.foot.y);
  c.fillText(cp.notes[1]!, col.x0 + measure(cp.notes[0]!, F.hei(500), 16, 1) + 36, L.foot.y);
  c.letterSpacing = '0px';
  c.restore();
}
