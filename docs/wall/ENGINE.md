# 大螢幕引擎說明（給寫版面的人）

大螢幕（`/wall`）照 [pdoom-video](../../../pdoom-video) 的做法寫（MIT，原作 Giacomo Magnanini；引擎檔頭都有註明）：TypeScript + three.js，
每一格畫面都是「歌曲時間 `t`」的純函數，1920×1080 邏輯像素，後製有 bloom、光暈、底片顆粒、暗角。
跟 pdoom 不一樣的地方：

- **時間軸是即時排的**。pdoom 一首固定的歌、人工剪接；大螢幕整晚播歌單，**導演**（`src/wall/director.ts`）邊播邊排下一個「窗格」
  （幾小節長、切在拍點上），挑版面、挑要主打的留言。每個窗格 new 一個場景物件、播完就 `dispose()`。
- **兩種文字**：歌詞（逐字跟唱，來自後台的 LRC）與賓客留言（隨時會進來）。每個版面兩種都要處理。
- **中文**。拉丁字照 pdoom 自帶 TTF；中文、韓文、簡體用 Google Fonts（依字分片下載）。
- **每首歌換配色主題**（`src/wall/themes.ts`）：訊號色一家子（signal / ember / blood）、點綴色、紙色會變。**不要把顏色寫死**，
  一律用色票（Canvas2D 的 `rgba('signal')`、GLSL 的 `C_SIGNAL`、LineBatch 的 `LIN.signal`）。
- 即時留言小卡（`engine/overlay.ts`）與右下角 QR（`engine/hud.ts`）由引擎畫，版面不用管。

## 怎麼跑、怎麼看

- 截圖（主要的檢查方式——截完**用 Read 工具打開 PNG 看**）：

  ```sh
  cd frontend
  WALL_DEV_AUDIO_DIR=<放測試 mp3 的資料夾> node scripts/wall-render.mjs stills --scene sparkler --message 3 --t 1.2,2,3.5,6 --win-from 0 --win-to 12 --out ../wall-out/sparkler
  ```

  - `--scene` 版面檔名；`--message N` 主打第 N 則假留言（`src/wall/dev/fixtures.ts`：3 = 長的、2 = 很短、5 = 英文、9 = 只有愛心、15 = 最長）；
    `--params '{"variant":2}'` 額外參數；`--theme gold|champagne|rose|sage|lilac|coral` 配色；`--win-from/--win-to` 窗格範圍（秒，預設整首）；
    `--popup 7@3.0` 在 3 秒排一張即時小卡；`--song "檔名.mp3"` 選測試歌；`--scale 0.75` 省電畫質。
  - 聯絡表：`sheet --scene slam --from 20 --to 32 --n 12 --cols 4 --out ../wall-out/slam.png`
  - 效能：`perf --scene stars --from 20`（平均每格毫秒，含 GPU 同步）。**目標 < 12 ms**（會場筆電多半是內顯，要留餘裕）。
  - **標準驗收 `qa`（每個版面交件前一定要跑、一定要打開圖看）**：
    `node scripts/wall-render.mjs qa --scene <名字>`（變化款：`--params '{"variant":1}'`，檔名自動加 `.v1`）。
    十種情境（長留言、短留言、英文、只有愛心、最長 60 字、沒有留言、純音樂、慢歌、只有 2 小節、新人留言＋三張即時小卡）×
    3～6 個時間點拼成一張總表 `wall-out/qa/<名字>.jpg`，另外檢查確定性（同一時間點畫兩次要一模一樣）與效能。
    總表每格只有 320×180，細節（字有沒有爆框、有沒有被小卡蓋到、跟唱有沒有對上）要再用 `stills` 截全尺寸的看。
    需要標準測試音檔：`WALL_DEV_AUDIO_DIR` 指到放 `Test Band - Fast Pop.mp3`、`Test Band - Slow Ballad.mp3`（含 .lrc）的資料夾。
  - 指定 `--scene` 時只會載入那個版面（加上 `title`、`karaoke`），別人寫到一半的版面不會影響你；要載全部加 `--all-scenes`。
  - 很多人同時在跑截圖時，`perf` 的數字會偏高：超過 12 ms 先單獨再跑一次 `perf` 確認。
  - 導演排出來的時間軸：`timeline`。
  - 測試歌沒有 `.lrc` 時，會用自己編的佔位歌詞（`dummyLrc`，每兩小節一句）。
- 瀏覽器即時看：`npm run dev` 之後開 `http://localhost:5173/wall?dev=1`（要先設 `WALL_DEV_AUDIO_DIR` 再啟動 vite）。
  `D` 顯示除錯資訊、`←/→` 跳 5 秒、`N` 下一首、`&sim=1` 模擬現場新留言。
- 型別檢查：`npx tsc --noEmit -p src/wall`（只看自己的檔：`| grep scenes/你的版面`）。
- 截圖工具會印出 `SCENE ERRORS` 與瀏覽器錯誤——一定要看。

## 資料

- `ctx.lyrics`（`engine/lyrics.ts`）：`lines[]`，每行 `text, start, end, words[]`，每個字 `{w, start, end, o}`（`o` 是在行內的位置）。
  中文一個字一個 Word、英文一個單字一個 Word。**不要用內容找歌詞**（歌每首不一樣）：用時間找——
  `lyricAt(lyrics, t)`（`scenes/_motifs.ts`，回傳這一格該顯示的行與進出場係數）、`lyrics.lineAt(t)`、`lyrics.nextLine(t)`、`lyrics.linesIn(t0, t1)`、
  `Lyrics.wordProgress(word, t)`、`Lyrics.lineCharProgress(line, t)`。有些歌是純音樂（`lyrics.has === false`），版面要撐得住。
- `ctx.audio`（`engine/audio.ts`）：`beats[]`、`downbeats[]`、`sections[]`（多了 `energy` 0..1）、`beatAt(t)`、`barAt(t)`、`timeOfBeat(i)`、`timeOfBar(i)`、
  `beatPeriod(t)`、`nextBeat(t)`、`nextDownbeat(t)`、`energyAt(t)`、`env(name, t)`（`rms|low|mid|high|vocal|drums|bass|other`，0..1）、
  `hit(kind, t, halfLife)`（`kick|snare|hat|vocal`）。沒有分軌，vocal 之類是頻帶近似。`_motifs.ts` 有 `beatAfter(au, t, k)`、`barAfter(au, t, k)`。
- `f.a` = `{rms,low,mid,high,vocal,drums,bass,other,kick,snare,hat,vonset}`；`f.beat, f.bar, f.beatPhase, f.barPhase, f.lt, f.p`。
- `ctx.params`：`message`（這個窗格主打的留言 `Msg`，可能是 `null`）、`messages`（全部留言，祝福牆用）、`variant`、`seed`、`energy`（這段的能量）、
  其他版面自訂的。`Msg = {id, name, text, n, couple}`：`text` 已經清理過（愛心統一成 `♥`、其他 emoji 拿掉、空白收斂，最多 60 字），
  `name` 可能是空字串（署名用 `signature(name)` → 「—— 一位賓客」），`n` 是第幾則（印成 `No.042`）。
- `ctx.song`：`{title, artist, index, count, theme}`；`ctx.live`：`{count, url, shortUrl}`（留言總數、QR 指向的網址）。
- `ctx.start / ctx.end`：這個窗格的時間（秒）。窗格長度 2～16 小節不等，**版面要能在任何長度好看**：進場、主體、退場用
  `beatAfter(au, start)`、`ctx.end - beat` 之類算，不要假設固定秒數。

## 寫一個版面

一個檔 `src/wall/scenes/<名字>.ts`，預設匯出一個繼承 `Scene` 的類別（輔助檔命名 `<名字>-xxx.ts`，檔名含 `-` 的不會被當成版面）：

```ts
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';

// 很貴又不會變的（shader）放在模組層共用：一晚會 new 幾百個場景物件
const BG = () => new FSPass(`uniform float t; void main(){ fragColor = vec4(C_INK, 1.0); }`, { t: { value: 0 } });

export default class MyPlate extends Scene {
  bg = shared('myplate.bg', BG);
  text = this.track(new Layer2D());          // track()：窗格結束時自動 dispose
  msg: Msg | null = this.ctx.params.message ?? null;
  async init() { /* 預先排版：這個窗格的留言已經定了 */ }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp } = this.ctx;
    this.bg.u.t!.value = f.t;
    this.bg.render(renderer, out);              // 全螢幕 shader → out（覆蓋）
    const c = this.text.ctx; this.text.clear(); /* Canvas2D 畫字 */
    comp.draw(renderer, this.text.upload(), out); // 疊上去
    return { bloom: 0.7 };                       // 後製參數（可省略）
  }
}
```

**排程參數**寫在版面檔裡，導演會自己讀（不用改 `director.ts`）：

```ts
import type { PlateSpecDecl } from '../engine/scene';
export const spec: PlateSpecDecl = {
  energy: [0.4, 1],   // 適合的段落能量（副歌高、抒情段低）
  bars: [4, 8],       // 偏好的長度（小節）
  paper: true,        // 亮版面
  group: 'couple',    // couple = 手繪新人互動；type = 文字／圖像（預設）
  family: 'sport',    // 系列：同系列不會連著出現（見 CATALOG.md）
  variants: 2,        // 變化款數（params.variant）
  weight: 1,          // 相對機率
};
```

規則：

- **確定性**：輸出只能是 `f.t`（和 `ctx.params`、種子亂數 `mulberry32(seed)`、`hash(...)`）的函數。不要用 `Math.random()`、`Date.now()`、`performance.now()`。
  逐格閃爍用 `frameIdx(t)`。
- `render()` 必須整張覆蓋 `out`（HalfFloat 線性 HDR）。顏色是 **linear**；> ~0.92 才會發光（婚禮版門檻比 pdoom 高，紙白的字與 QR 不發光）。
  要發光的東西（火花、燒紅的字）：LineBatch 顏色乘 2～6，或畫在另一個 Layer2D 用 `comp.draw(..., { mode: 'add', tint: [1.9,1.9,1.9] })` 疊上去。
- **資源要還**：`Layer2D`、`LineBatch`、`makeRT()` 一律 `this.track(...)`；自己建的 three.js 幾何／材質在 `dispose()` 釋放（記得呼叫 `super.dispose()`）。
  shader pass 用 `shared()`。自己寫 `ShaderMaterial` 並用了 `GLSL_COMMON` 的話，uniforms 要展開 `...THEME_UNIFORMS`（不然 C_* 是黑的）。
- 效能：每格 < 12 ms。**Canvas2D 層一律用 fast 上傳**：`new Layer2D(W, H, SCALE, { fast: true })`（發光層可以用低解析度 `new Layer2D(W, H, 0.5, { fast: true })`）。
  預設的上傳方式一張要十幾毫秒；fast 的層只能交給 `comp.draw`（它會自動解碼），自己的 shader 要取樣的話得自己解預乘、轉線性。
  一個版面最多 2～3 張 Canvas2D 層，排版在 `init()` 做；每格只重畫會變的部分（不變的底圖畫一次就好，不要每格 `clear()` 重畫整張）。
- 可以回傳的後製參數：`exposure, bloom, bloomThreshold, bloomKnee, bloomRadius, halation, ca, grain, vignette, hud, frame（裁切角標，只給片頭卡）,
  qr（角落 QR，自己畫了大 QR 才設 0）, popups（即時小卡透明度，滿版大字時可調低，別設 0）, **popupAvoid**（重要文字的範圍 `[x,y,w,h][]`，
  即時小卡挑位置時避開；回傳整個窗格會用到的範圍，render 的回傳型別標成 `PostOverrides`）, paper（亮版面設 1：HUD 與小卡改成深色字）,
  fade, flash, shake:[x,y], zoom, invert`。預設值在 `engine/post.ts`。
- **亮版面**（紙底）一定要回傳 `paper: 1`。
- **即時留言小卡**會在畫面四角、左右中段、上下正中隨機出現（卡寬 470，右側的格子從 x = 1378 開始）。版面最好在右側（x ≥ 1380）或上下角留一點空間，並回傳 `popupAvoid`。
- 版面裡的字不要進右下角 HUD 區（`HUD_SAFE`：x ≥ 1360、y ≥ 830），離四邊至少 96 px（投影機會裁邊）。
- 轉場：窗格相接就是硬切（大部分在小節線上），這是預設。要自己做轉場設 `handlesTransition = true` 並用 `f.under`／`f.tin`。
- 固定色（不跟主題換）：`fur`（博美橘毛）、`cream`（奶油色毛、白胸口）、`collar`（紅項圈）、`ball`（網球黃綠）、`denim`（牛仔褲）、
  `gingham`（孟庭的綠格紋）、`leash`（藍牽繩）。只給手繪角色與道具用，不發光。
- 手繪的新人與狗狗一律用 `scenes/_couple.ts`（見檔頭說明與 TREATMENT.md 的「角色」），不要自己另外畫一套人。
- 只改自己的檔（`scenes/<名字>.ts`、`scenes/<名字>-*.ts`；一批版面共用的輔助可以放 `scenes/_<批次代號>.ts`，例如 `_doc.ts`）。引擎、`_motifs.ts`、導演、其他版面：需要改就在回報裡寫清楚，由主導者改。

## 工具箱

跟 pdoom 一樣（詳見各檔註解）：

- `gl.ts`：`FSPass`、`Compositor`（`comp.draw(renderer, tex, target, {mode, opacity, tint, scale, offset})`）、`Layer2D`、`makeRT()`、`clearRT()`、`W/H/SCALE`。
- `glsl/common.ts`（`GLSL_COMMON`，FSPass 自動附上）：色票 `C_INK C_INK2 C_GRAPHITE C_ASH C_BONE C_SIGNAL C_EMBER C_BLOOD C_ROSE C_PAPER C_SEPIA`、
  `hash*`、`snoise`、`fbm`、`curl2`、2D/3D SDF、`smin`、`aaFill`、`aaStroke`、`pxLine`、**`hatch(u, darkness)`、`engrave(uv, darkness, freq, angle)`**（版畫線條）、`heat(x)`、`FRAG_PX`（邏輯像素座標，**y 向上**）。
- `lines.ts`：`LineBatch`（GPU 細線，2D 像素座標 y 向下，或 3D）。
- `type.ts`：字族 `F.archivo(寬 62–125, 字重)`、`F.serif(字重, 斜體)`（Cormorant）、`F.mono(字重)`（IBM Plex Mono）、
  **`F.hei(字重)` 思源黑體、`F.ming(字重)` 思源宋體、`F.hand(字重)` 霞鶩文楷**。`font(family, px)` 會帶字重與 CJK 備援，
  拉丁字族後面自動接思源黑體／宋體，所以 `F.archivo` 也能直接畫中文歌詞。`layout()`、`glyphX()`、`measure()`、`fitSize()`、`textPoints()`（光柵取樣，中文可用）。
  `textPath2D` 只支援拉丁字。**新出現的文字要先 `await loadText(text)`**（留言已經載好了；自己加的中文字串在 `init()` 載）。
- `text.ts`：`wrap(ctx, text, maxWidth)`（中文禁則、英文不拆字、平衡斷行）、`fitText(ctx, text, family, w, h, {min,max,lineHeight,maxLines})`、
  `phrases(text, maxLen)`（切成短詞組，一拍一組用）、`readSeconds(text)`。
- `stroke.ts`：單線筆畫字（拉丁字，給「寫出來」的英文用）：`strokeText`、`drawStrokeText`、`writtenLength`。
- `util.ts`：`clamp, lerp, remap, smoothstep, ease.*, prog(x,a,b,ease), keys(), springStep, pulse, mulberry32, hash, noise*, fbm*, frameIdx`。
- `qr.ts`：`drawQR(ctx, url, x, y, size, {reveal})`（淺底深點，暗版面也要墊紙色）。
- `motifs.ts` / `scenes/_motifs.ts`：火花 `sparkHead`、`sparkParticles`、`sparkHead2D`；愛心 `drawHeart`、`heartPoints`；
  **歌詞的聲音** `lyricAt`、`layoutLyric`、`drawLyric`；**留言的聲音** `layoutMessage`、`drawMessage`、`signature`、`msgChars`；
  `COUPLE_EN`、`COUPLE_ZH`、`DATE_DOTS`、`beatAfter`、`barAfter`。

## 參考

pdoom 原本的每個場景都在 `D:\Work\pdoom-video\app\src\scenes\`（`docs/TREATMENT.md` 有每個場景的說明，`app/public/plates/fig*.jpg` 是代表畫面）。
版畫線條、紙張、儀器、鈔票紋等做法可以直接參考、搬過來改。風格聖經在 `docs/wall/TREATMENT.md`。
