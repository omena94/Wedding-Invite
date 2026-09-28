// 開發模式（/wall?dev=1）與截圖用的假資料：不連後端、不碰正式資料。
// 留言是自己編的，長短、中英混雜、emoji 都有，拿來測版面在各種情況下排不排得好。
// 歌詞一樣是自己編的佔位句（不用真的歌詞），時間照測試音檔的節拍排。
import type { AudioData } from '../engine/audio';
import { fmtTime } from '../lyrics/lrc';
import type { RawMessage } from '../pool';

export const DEV_MESSAGES: RawMessage[] = [
  { id: 1, name: '宣文 & 孟庭', text: '謝謝大家今天來，吃飽喝足、玩得開心！', source: 'couple' },
  { id: 2, name: '小安', text: '新婚快樂！！！' },
  { id: 3, name: '阿哲', text: '從大學看你們吵吵鬧鬧到現在，終於等到這一天，要一直這麼幸福下去喔 💕' },
  { id: 4, name: '', text: '百年好合 早生貴子 🎉🎉' },
  { id: 5, name: 'Jessica', text: 'Congrats Alan & Omena! So happy for you two ❤️' },
  { id: 6, name: '大舅', text: '祝福你們相親相愛，白頭偕老。' },
  { id: 7, name: '同事 Kevin', text: '恭喜恭喜～下週上班記得發喜糖' },
  { id: 8, name: '孟庭的高中同學們', text: '孟庭今天超美！宣文要好好照顧我們家的公主，不然我們會找你算帳 😤' },
  { id: 9, name: 'Mia', text: '🥰🥰🥰' },
  { id: 10, name: '阿嬤', text: '乖孫結婚了，阿嬤足歡喜！' },
  { id: 11, name: '小胖', text: '今天的牛排好好吃，祝你們永遠甜蜜，像今天的甜點一樣' },
  { id: 12, name: 'Leo', text: '新婚愉快，早日脫離蜜月期開始吵架（誤）' },
  { id: 13, name: '宣文的室友', text: '恭喜你終於不用再自己煮泡麵了！' },
  { id: 14, name: '', text: '要幸福喔！' },
  { id: 15, name: '雅婷', text: '謝謝你們讓我見證這麼美好的一天，希望你們每天都像今天一樣開心、每一年都比前一年更愛對方。' },
  { id: 16, name: 'Ken', text: 'Cheers! 🥂 To love, laughter and happily ever after.' },
  { id: 17, name: '表妹', text: '姐姐姐夫新婚快樂，記得帶我去度蜜月（開玩笑的）' },
  { id: 18, name: '老闆', text: '祝兩位永結同心，家庭事業兩得意。' },
];

/** 模擬現場新留言（/wall?dev=1&sim=1 每隔幾秒丟一則進來）。 */
export const DEV_LIVE: Omit<RawMessage, 'id'>[] = [
  { name: '剛到的阿姨', text: '哇～螢幕好漂亮！新婚快樂！' },
  { name: '桌 7', text: '第七桌全體祝你們永浴愛河！' },
  { name: 'Amy', text: 'You two are perfect together ♡' },
  { name: '', text: '乾杯！！' },
  { name: '小明', text: '祝你們一輩子都像今天這麼幸福，吵架了就想想今天大家都在看 😂' },
];

/** 佔位歌詞（自己寫的句子，不是任何歌的歌詞）。 */
const DUMMY_LINES = [
  '今晚的燈 都為你們亮起', 'Every light tonight is shining for you', '我們舉杯 慶祝這一天', '從今以後 一起走好遠',
  '把笑聲留在 這個晚上', 'Hold my hand and never let go', '一首一首歌 一句一句話', '謝謝你們 陪我們長大',
];

/**
 * 沒有 .lrc 的測試音檔：從第一個小節線後兩小節開始，每兩小節一句（中間偶爾空一段當間奏）。
 */
export function dummyLrc(au: AudioData): string {
  const out: string[] = [];
  const bar = (i: number) => au.timeOfBar(i);
  let k = 0;
  for (let b = 2; bar(b + 2) < au.duration - 4; b += 2) {
    if (b % 16 === 14) continue; // 每 16 小節空一句
    out.push(`[${fmtTime(bar(b))}]${DUMMY_LINES[k++ % DUMMY_LINES.length]}`);
  }
  return out.join('\n');
}
