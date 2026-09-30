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
  // 2026-09-28 正式站踩到的樣子（自己編的，不是真的賓客留言）：自己換行、愛心穿插、名字三個字，
  // 會排成四行——版面只留三行的位置，署名就被字蓋住了。QA 的 K 情境用它。
  { id: 19, name: '姜小姐', text: '寶貝不管怎樣你開心最重要❤️\n我們永遠是你的娘家你的後盾❤️\n要一直幸福下去喔❤️❤️❤️' },
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

/**
 * 韓文歌的佔位歌詞（自己寫的句子，不是任何歌的歌詞）與中文翻譯，測原文副行用（截圖 `--ko`、`ko` 驗收）。
 * 「|」是 <時間> 分段：大部分句子兩邊段數一樣（中文跟原文一段一段一起亮），
 * 第 8 句中文故意不分段（照原文唱的進度等比例亮），第 9 句兩邊一樣（只顯示一行）。
 */
const DUMMY_KO: [string, string][] = [
  ['오늘 밤 모든 불빛이 |너를 위해 빛나', '今晚所有的燈光 |都為你閃耀'],
  ["It's |for |sure |너와 함께라면", "It's |for |sure |只要和你在一起"],
  ['손을 잡고 걸어가자 |끝까지', '牽著手一起走 |走到最後'],
  ['우리 둘만의 노래를 불러요', '唱一首只屬於我們兩個人的歌'],
  ['처음 만난 그날처럼 설레', '像第一次見面那天一樣心動'],
  ['No, |no |doubt |in my mind |너는 나의 특별한 사람', 'No, |no |doubt |in my mind |你是我最特別的人'],
  ['Making you mine, |making you mine, |영원히', 'Making you mine, |making you mine, |直到永遠'],
  ['고마워 |내 곁에 있어줘서', '謝謝你一直在我身邊'],
  ['Ah-ah, |mine, |hmm-mmm', 'Ah-ah, |mine, |hmm-mmm'],
  ['매일 아침 눈을 뜨면 |네가 보여', '每天早上睜開眼 |就看到你'],
  ['넘쳐나는 love |난 없어 걱정', '滿滿都是 love |我一點也不擔心'],
  ['지금 이 순간을 |기억해줘', '請記住 |此刻這一瞬間'],
];

/** 跟 dummyLrc 一樣每兩小節一句；回傳原文（韓文）與翻譯（中文）兩份 LRC，時間與分段一一對應。 */
export function dummyKoLrc(au: AudioData): { lrc: string; trans: string } {
  const ko: string[] = [], zh: string[] = [];
  const bar = (i: number) => au.timeOfBar(i);
  const tagged = (s: string, t0: number, span: number) => {
    const segs = s.split('|');
    if (segs.length === 1) return s;
    return segs.map((g, k) => `<${fmtTime(t0 + (span * 0.8 * k) / segs.length)}>${g}`).join('') + `<${fmtTime(t0 + span * 0.85)}>`;
  };
  let k = 0;
  for (let b = 2; bar(b + 2) < au.duration - 4; b += 2) {
    if (b % 16 === 14) continue;
    const [a, z] = DUMMY_KO[k++ % DUMMY_KO.length]!;
    const t0 = bar(b), span = bar(b + 2) - t0;
    ko.push(`[${fmtTime(t0)}]${tagged(a, t0, span)}`);
    zh.push(`[${fmtTime(t0)}]${tagged(z, t0, span)}`);
  }
  return { lrc: ko.join('\n'), trans: zh.join('\n') };
}
