#!/usr/bin/env node
// 產生大螢幕的版面清單（src/wall/plateCatalog.ts），給後台「大螢幕版面」頁用：中文名稱、系列、亮暗、有沒有人物、一句話點子。
// 來源是 docs/wall/CATALOG.md 的表格＋最早的 11 個版面；只列 scenes/ 裡真的有的檔（沒做或被拿掉的不列）。
// 新增或刪除版面後跑一次：node scripts/wall-catalog.mjs（主導者 commit 時加 --tracked，只列已經進 git 的版面）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(path.join(ROOT, '..', 'docs', 'wall', 'CATALOG.md'), 'utf8');

// 最早的 11 個版面（CATALOG 只列名字，這裡補中文名與分類）
const ORIGINAL = [
  ['title', '歌名卡／邀請卡', 'title', false, '每首歌開頭的歌名卡；每隔幾分鐘出現一次放大 QR 的邀請卡'],
  ['karaoke', '跟唱', 'type', false, '最單純的版面：留言與逐字跟唱的歌詞'],
  ['sparkler', '仙女棒寫字', 'light', false, '仙女棒的火花在暗色信紙上一個字一個字寫出留言'],
  ['slam', '大字重擊', 'type', false, '副歌用：歌詞或留言一拍一組大字打上來'],
  ['certificate', '結婚書約', 'doc', false, '桌上的祝福登記表，留言是祝福內容，最後蓋章'],
  ['heartbeat', '心電圖', 'machine', false, '暗房裡的監護儀，心跳跟著大鼓；留言是前面的醫囑紙條'],
  ['stars', '星空', 'nature', false, '電影感夜空：留言是天上的大字，每個字跟著一顆星亮起'],
  ['banknote', '愛情準備銀行', 'doc', true, '桌上一張鈔票，雕刻紋與交扣的戒指，留言印在鈔票上'],
  ['mosaic', '祝福牆', 'type', false, '很多則留言排成牆，主打那則放大、其他退成背景'],
  ['fireworks', '煙火', 'light', false, '火花升空炸開，夜空裡的留言被煙火照亮'],
  ['vinyl', '黑膠唱片', 'machine', false, '唱片在轉，歌詞沿溝紋；留言是桌上的紙卡'],
];

const rows = [];
for (const [name, title, family, light, idea] of ORIGINAL) rows.push({ name, title, family, light, couple: false, idea });
let section = '', sub = '';
for (const line of md.split(/\r?\n/)) {
  if (line.startsWith('## ')) { section = line; sub = ''; }
  // 雙語那一段把「新人互動」放在第三層標題（### 雙語・新人互動）
  if (line.startsWith('### ')) sub = line;
  const m = /^\| `([a-z0-9]+)` \| ([^|]+) \| ([a-z]+) \| (亮|暗) \| (.+) \|\s*$/.exec(line);
  if (!m) continue;
  const [, name, title, family, tone, idea] = m;
  if (rows.some((r) => r.name === name)) continue;
  rows.push({ name, title: title.trim(), family, light: tone === '亮', couple: section.includes('新人互動') || sub.includes('新人互動'), idea: idea.trim() });
}
const scenes = path.join(ROOT, 'src', 'wall', 'scenes');
// --tracked：只算已經加進 git 的版面（主導者 commit 時用）。很多同事同時在 scenes/ 寫版面，
// 還沒驗收的檔不能出現在正式站的後台清單裡（會沒有縮圖、預覽也會壞）。
const tracked = process.argv.includes('--tracked')
  ? new Set(execSync('git ls-files src/wall/scenes', { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).map((f) => path.basename(f, '.ts')))
  : null;
const built = rows.filter((r) => existsSync(path.join(scenes, `${r.name}.ts`)) && (!tracked || tracked.has(r.name)));
// 雙語版面（有翻譯的歌只排這種）：看版面檔自己宣告的 spec.bilingual。
// --tracked 讀「要 commit 的版本」（git 暫存區），不讀工作目錄：同事可能正在改某個版面、先加了 bilingual 還沒交件，
// 讀工作目錄會讓後台清單標成雙語、但 commit 進去的版面檔沒有（2026-09-30 boarding 等三個發生過）。
const source = (name) => tracked
  ? execSync(`git show :./src/wall/scenes/${name}.ts`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  : readFileSync(path.join(scenes, `${name}.ts`), 'utf8');
for (const r of built) r.bilingual = /\bbilingual\s*:\s*true\b/.test(source(r.name));
const out = `// 自動產生（node scripts/wall-catalog.mjs），不要手改：大螢幕版面清單，後台「大螢幕版面」頁用。
export interface PlateInfo { name: string; title: string; family: string; light: boolean; couple: boolean; bilingual: boolean; idea: string }
export const PLATE_CATALOG: PlateInfo[] = ${JSON.stringify(built, null, 1)};
`;
writeFileSync(path.join(ROOT, 'src', 'wall', 'plateCatalog.ts'), out);
const missing = rows.filter((r) => !built.includes(r)).map((r) => r.name);
console.log(`版面 ${built.length} 個（清單上還沒做或已拿掉：${missing.length} 個）`);
