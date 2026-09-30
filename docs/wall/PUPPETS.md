# 紙偶角色工作手冊（給做人物版面的人）

大螢幕的人物版面（`group: 'couple'`，C1～C9 共 55 個）裡的新人與狗狗，一律是**紙偶動畫**：
本機的 Codex 畫每個動作的關鍵姿勢（寫實手繪插畫、透明背景 PNG），程式把它們當成一張張紙偶，在場景裡移動、彈跳、傾斜、照節拍換姿勢，
加上影子、落地壓扁回彈。新人看過程式畫的角色說「太醜太不像」，看了 Codex 的插畫說「像很多」，所以不要再用 `_couple.ts` 的 `drawPerson／drawDog`。

先讀：`docs/wall/TREATMENT.md`「角色」（長相、服裝）、`docs/wall/ENGINE.md`「紙偶角色」（API）。
範例版面：`badminton`（暗：姿勢時間軸、跳殺）、`fetch`（亮：兩人分站兩側輪流丟、狗在中間來回；跑步換影格、球在圖與程式之間接力、交球對準手）、`cooking`（亮：甩鍋、狗跳起來咬）、`waltz`（暗：雙人紙偶翻面轉身）。

流程：**看有沒有現成的姿勢 → 請 Codex 畫 → 檢查 → 跑管線 → 寫版面 → QA**。好幾個人可以同時做，只要每個人用自己的「組」。

---

## 1. 規則（一定要遵守）

1. **照片永遠不能進影片。** 角色只能是畫的。新人的生活照只給 Codex 看臉用，不能放進 `public/`、專案、畫面，也不能做成照片濾鏡、描圖。
2. **孟庭一律兩眼張開**：不眨眼、不閉眼、不 wink（新人 2026-09-29 的要求）。
3. **宣文不要鬍子、鬍渣。**
4. **三隻狗都不畫項圈、胸背帶、領巾**（芃芃、QQ、元元）。**有狗的版面三隻狗要一起出現**（新人 2026-09-30）。
5. **不畫真實的品牌、醫院、公司、球隊、歌手、團名的名稱或標誌**；衣服、球拍、球衣、鞋子、識別證、手燈上都不要有字或商標。
6. **背景一定要真的透明。** 不合格的圖請 Codex 重畫，**不要用程式修圖**（去白底、補手、改眼睛都不行：白衣服、白狗、白紗會被吃掉）。
7. **側面的姿勢一律朝右**（程式會自己翻）。**例外：衣服上有字**（例如籃球衣的 A&O／420／87），翻過去字會變成反的。需要朝左時，請 Codex 另外畫一張朝左、字是正的版本，檔名加 `_left`（例如 `mt_hoops_guard_left`）。
8. **只改自己的檔**：自己那一組的 `wall-out/codex-chars/poses/<組名>/`、`frontend/public/wall-sprites/<組名>/`、`frontend/src/wall/sprites/<組名>.json`，
   和自己的版面 `scenes/<名字>.ts`。不要動 `base`、`waltz` 或別人的組，不要改 `_puppet.ts`、`wall-sprites.mjs`（需要就在回報裡寫，由主導者改）。

---

## 2. 先看有沒有現成的姿勢

打開 `wall-out/sprites-base.png`、`wall-out/sprites-waltz.png`（每一組跑管線時產生的總覽圖）或 `frontend/src/wall/sprites/*.json`。
現在有（2026-09-29）：

- `base`（日常服一：白 T＋牛仔褲；孟庭腰上綁淺藍襯衫）：
  - 宣文 `xw_`：idle_front、walk_1/2、run_1/2、bad_ready/swing/smash、throw_1/2、plate、kneel、cheer
  - 孟庭 `mt_`：idle_front、walk_1/2、run_1/2、bad_ready/swing/smash、wok_1/2、cheer
  - 兩人 `cp_`：walk_1/2、hug
  - 芃芃 `pp_`：stand、walk、run_1/2、jump、sit、beg、sleep、ball
  - QQ `qq_`：stand、walk、run_1/2、jump、sit、beg、sleep、ball
- `yuanyuan`（第三隻狗元元，白色柴犬，2026-09-30）`yy_`：stand、walk、run_1/2、jump（跳起來張嘴接球）、ball（叼網球）、sit（正面坐）、beg（側坐討食）、
  sleep、shake（甩水）、tilt（正面坐歪頭）、howl（仰頭叫）。身高 0.42（芃芃 0.26、QQ 0.29）：三隻傳同一個場景尺度，比例就照 `dogs3-lineup.png`。
- `waltz`（婚禮服）：`cp_waltz_1`（閉式舞姿）、`_2`（旋轉、裙擺甩開）、`_3`（孟庭在宣文手下轉圈）、`_4`（下腰）
- `fetch`（日常服一，借 base 的比例）：宣文 `xw_fetch_`：clap（拍手叫狗）、take（蹲下伸手接球）、pet（蹲著摸狗、手上拿球）；
  孟庭 `mt_fetch_`：clap、take、pet、throw_1（往後拉）、throw_2（丟出去，手上沒球）

能用現成的就用；不夠再請 Codex 畫。

---

## 3. 分組與檔名

- **一組 = 一套衣服或一批姿勢**，一組一個資料夾 `wall-out/codex-chars/poses/<組名>/`（wall-out 不進 git，但留在這台電腦上，之後要重跑找得到）。
  組名用小寫英文、數字、連字號，例如：`work`（C7 工程師 × 護理師）、`hoops`（C8 籃球）、`live`（C9 演唱會）、`c1-sports`（日常服一的新動作）。
  同一組同時只能有一個人在跑管線，所以**每個人用自己的組**；同一套衣服、不同的人做，就分成兩組（`c1-sports`、`c3-dogs`）。
- **圖名**：`<角色>_<組或動作>_<動作>[_編號].png`，全部小寫、底線。角色前綴：宣文 `xw_`、孟庭 `mt_`、兩人一起 `cp_`、芃芃 `pp_`、QQ `qq_`。
  - 新衣服的組在前綴後面加組名：`xw_work_idle_front`、`mt_hoops_dribble_1`、`cp_live_jump`。
  - 同一套衣服的新動作用動作當中間的字：`xw_tennis_ready`、`pp_frisbee_leap`。
  - **圖名跨組不能重複**（管線會擋下來）。
  - 循環的影格用 `_1`、`_2`（`xw_walk_1`、`xw_walk_2`）：總覽圖會把同名不同號的疊在一起，檢查換圖時身體會不會跳。
  - 騰空的姿勢（跳起來、灌籃、飛撲）名字裡放 `jump`、`smash`、`leap`、`air`、`dunk`、`fly` 其中一個（或在 sprites.json 的 `airborne` 列出來）：
    這種圖的腳底用基準姿勢的腳底線，程式再加拋物線；其他姿勢一律把最低的腳放在地上。
- **每一組的每一種角色都要有一張基準姿勢**（量身高、決定縮放比例）：人 `<前綴>idle_front`（正面站直、雙手自然垂下），
  狗 `<前綴>stand`（側面站著），兩人一起用一張兩人都站直的。換了衣服也照樣縮到一樣高，換衣服之後在畫面上一樣大。
  日常服一的新動作可以不畫基準姿勢，借 `base` 的（見第 5 節的 `refFrom`），但要把 base 的基準姿勢附給 Codex、請它畫一樣大。

---

## 4. 請 Codex 畫姿勢

### 4.1 準備

在自己的 scratchpad 開一個資料夾（例如 `<scratchpad>/codex-<組名>/`），把下面的範本存成 `PROMPT.md`、改寫「這次要畫的姿勢」與服裝。
**一次請畫 10～20 張**（太多會畫到後面走樣、太少很慢）。畫好、檢查過的 PNG 再複製到 `wall-out/codex-chars/poses/<組名>/`。

### 4.2 要附的設定圖（`wall-out/codex-chars/`）

| 畫什麼 | 附哪些圖 |
|---|---|
| 一定要附（人） | **`faces-v2.png`**（2026-09-29 新人核准的「更像本人」的臉，左宣文、右孟庭；**人的長相以這張為準**） |
| 一定要附（狗） | `faces.png`（四個角色的大頭，左起宣文、孟庭、芃芃、QQ；人的臉是舊版，只看狗） |
| 日常服一 | `couple-daily.png` |
| 婚禮服 | `couple-wedding.png` |
| 有狗 | `dogs-side.png`、`dogs-front.png` |
| 新衣服 | 已定案：`outfit-work.png`（宣文工程師、孟庭護理師）、`outfit-hoops.png`（看籃球賽，A&O 球衣，勇士隊配色寶藍＋金黃，宣文 420、孟庭 87）、`outfit-concert.png`（演唱會）、`outfit2-sheet.png`（日常服二：白 T＋羽球袋／米白荷葉裙洋裝）。其他服裝先問主導者，不要自己編 |
| 要跟 base 一樣大、一樣的畫風 | `poses/base/xw_idle_front.png`、`mt_idle_front.png`、`pp_stand.png`、`qq_stand.png`（基準姿勢）＋一兩張動作圖（`xw_bad_ready.png`、`pp_jump.png`） |

附太多張 Codex 會抓不到重點，一次 5～8 張為限。

### 4.3 PROMPT 範本（複製後改〈〉裡的內容）

```md
你是插畫師，要替婚禮會場大螢幕的 MV 畫「紙偶動畫」用的角色姿勢圖。程式會把這些圖當成一張張紙偶，在場景裡移動、彈跳、傾斜，並依照節拍切換姿勢。

附上的圖是**已經定案的角色設定**（新人看過，說很像）：
- faces-v2.png：新郎「宣文」（左）和新娘「孟庭」（右）的大頭，**人的臉以這張為準**。
- 〈faces.png：四個角色的大頭，這裡只看狗「芃芃」（左三）、「QQ」（左四）。（有狗才附）〉
- 〈couple-daily.png：兩人的日常服一全身。／outfit-work.png：兩人的上班服（宣文工程師、孟庭護理師）。……照實際附的圖寫〉
- 〈dogs-side.png：芃芃（左）和 QQ（右）的側面與背面。dogs-front.png：正面坐姿。（有狗才寫）〉
- 〈xw_idle_front.png、mt_idle_front.png：已經做好的姿勢圖（透明背景），**畫風、比例、透明背景都照這兩張**，
  單人的圖要跟它們一樣大（同樣的畫布、同樣的身高、腳底在同一個高度）。這兩張在某些看圖工具裡透明的地方會顯示成黑色，那是看圖工具的問題，你的圖要真的透明。〉

## 一定要做到
1. **長相、服裝、畫風完全照附圖**：同樣的寫實手繪插畫、細墨線、柔和上色。每張都要一眼認得出是同一個人、同一隻狗。
   - 宣文：臉是長一點的橢圓，**不要鬍子、不要鬍渣**；黑色短髮，頂上蓬、髮尾往前往上翹。
   - 孟庭：紅棕色長髮（焦糖色挑染）、空氣瀏海、圓臉。**兩眼都要張開，不眨眼、不閉眼。**
   - 〈服裝：照附圖寫清楚，例如「兩人都穿日常服一：白色羅紋短 T（黑領、袖口黑邊、肩膀到袖子兩條細黑線、左胸黑色小蝴蝶結）、牛仔褲、白鞋；孟庭腰上綁淺藍色襯衫。」〉
   - 芃芃是杏橘色泰迪臉博美，頭圓、尾巴平鋪在下背跟背毛連成一片；**不畫項圈**。
   - QQ 是白身、橘褐臉的博美，下背有棕色鞍形斑，白色大羽毛尾高高拱在背上；**不畫項圈、不畫胸背帶**。
   - 任何東西都**不要畫品牌、商標、文字**，也不要畫真實的醫院、公司、球隊、歌手、團名的名稱或標誌。
2. **背景必須是真正的透明**（PNG alpha），不能是白底或米白底，也不要畫地板或影子，只要角色本身（加上手上拿的道具）。
   衣服和狗都是白色的，不透明的底之後沒辦法去背。如果工具有 transparent background 的選項，一定要用；畫完確認四個角落是透明的。
3. **比例固定**，同一個角色在每張圖裡要一樣大，程式才能直接換圖：
   - 人：畫布 1024×1536（直式）。〈跟 xw_idle_front.png／mt_idle_front.png 一樣大：宣文站直時頭頂約在 y=30、腳底約在 y=1500；孟庭比宣文矮一點。〉
     蹲、彎腰、跳的姿勢也用同一個比例，不要放大縮小（蹲低的人就是比較矮）。
   - 狗：畫布 1024×1024。站著時腳底在 y≈960，身長（鼻子到屁股）約 700 px。
   - 兩個人一起的圖：畫布 1536×1536，兩人身高的比例跟設定圖一樣。
4. **側面的姿勢一律面向右邊**（程式需要時會自己左右翻轉）。
5. 動作要清楚、有張力，像動畫的關鍵影格。**四肢和道具不要被畫布切掉**，四邊都要留一點透明的空白。
6. 〈會由程式畫、會飛出去的東西（球、飛盤、羽球）不要畫在手上或嘴裡，例如「手上已經沒有球」「嘴巴張開、嘴裡沒有東西」。〉

## 交件
- 每個姿勢存一個 PNG，檔名照清單，放在目前這個資料夾。
- 全部畫完後，把所有圖並排做一張 `_contact.png`（縮圖、下面標檔名，底色用深灰或棋盤格才看得出透明，這張可以不透明），
  打開檢查：長相一致、比例一致、背景透明、沒有被切掉、孟庭兩眼張開。不合格的重畫（每張最多重畫兩次）。
- 最後回報：完成了哪些檔、哪幾張還不理想。**不要修改這個資料夾以外的任何檔案。**

## 這次要畫的姿勢（〈N〉張）

〈照這個格式一張一行：檔名、角度、動作、手上拿什麼、「那一下」的位置。每一組的每一種角色，第一張先畫基準姿勢：〉
- xw_〈組〉_idle_front.png：正面站直，雙手自然垂下，淺淺微笑。（基準姿勢：量身高用，一定要畫）
- mt_〈組〉_idle_front.png：正面站直，雙手自然垂下，淺淺微笑，兩眼張開。（基準姿勢）
- xw_〈組〉_〈動作〉.png：側面朝右，……
```

寫姿勢的訣竅：

- 一個動作拆成 2～4 張關鍵影格：**預備 → 那一下（擊球、出手、咬到）→ 跟隨**。程式會讓「那一下」落在拍點，換圖時交叉淡化。
- 會用 `puppetPoint` 接程式道具的地方要說清楚位置，例如「拍面正好在身體前方、腰到胸的高度」「嘴巴張大往右上方咬」。
- **蹲、跪、坐的姿勢 Codex 常畫太大**（人縮成一團之後又放大到填滿畫布，臉變成站著的 1.5 倍）。提示詞裡直接寫數字：
  「頭、臉的大小跟 idle_front 一模一樣；單膝跪地、上身前傾時高度約站直的 65～70%，頭頂約在 y≈520」，交件後用 `--check` 並排比臉的大小。
- 走路、跑步畫兩張（左腳在前／右腳在前），**頭的方向兩張要一樣**（`xw_walk_1` 臉轉向鏡頭、`walk_2` 是側臉，連著播時頭會一步一轉）。
- 站著不動的角色（端盤子、拍手、揮手）一張就夠，程式會加呼吸、點頭、跟拍子搖。

### 4.4 指令

```sh
cd <scratchpad>/codex-<組名>
C=/d/Work/Wedding-Invite/wall-out/codex-chars
codex exec --skip-git-repo-check -C . -s workspace-write -c 'approval_policy="never"' -o last.md \
  -i $C/faces-v2.png $C/couple-daily.png $C/poses/base/xw_idle_front.png $C/poses/base/mt_idle_front.png - < PROMPT.md > run.log 2>&1
```

- 一次畫 10～20 張要跑很久（一張一兩分鐘，還會自己重畫不合格的）：放背景跑，看 `run.log` 的進度、`last.md` 的回報。
- Codex 只能寫 `-C` 那個資料夾（`workspace-write`）；設定圖用 `-i` 附，不用複製進去。

---

## 5. 檢查與轉檔（`frontend/scripts/wall-sprites.mjs`）

### 5.1 放進自己那一組

```
wall-out/codex-chars/poses/<組名>/
  xw_work_idle_front.png  xw_work_type_1.png  ...   （Codex 畫的 PNG；底線開頭的檔會跳過，例如 _contact.png）
  sprites.json                                       （這一組的設定，見 5.3）
```

### 5.2 先看檢查圖

```sh
cd frontend
node scripts/wall-sprites.mjs <組名> --check
```

產生 `wall-out/sprites-<組名>-check-1.jpg`…（不轉檔、不需要 sprites.json）。**每一張都要打開看**：

- 左邊疊在深色底上、右邊疊在洋紅底上：**背景真的透明**（洋紅底上沒有白框、白邊、米白底；白衣服、白狗、白紗沒有被挖空）。
- **長相跟 faces-v2.png（人）、faces.png（狗）一樣**：宣文沒有鬍子、孟庭兩眼張開、芃芃泰迪臉、QQ 沒有項圈。
- **四肢與道具沒有被畫布切掉**，側面朝右，沒有品牌、文字。
- 同一種角色每張一樣大（頭的大小差不多）；循環的兩張頭的方向一樣。
- 左邊的格線每 100 px 一條、紅線每 200 px（標原圖的座標），量道具點用。

不合格的：請 Codex 重畫那幾張（同一個資料夾、同樣的檔名），**不要用程式修**。

### 5.3 sprites.json

```json
{
  "說明": "上班服（宣文工程師、孟庭護理師）。",
  "series": [
    { "prefix": "xw_work_", "kind": "person", "ref": "xw_work_idle_front", "target": 600 },
    { "prefix": "mt_work_", "kind": "person", "ref": "mt_work_idle_front", "target": 600 },
    { "prefix": "qq_work_", "kind": "dog", "ref": "qq_work_stand", "target": 280 }
  ],
  "points": {
    "xw_work_type_1": { "laptop": [610, 820, 120] },
    "mt_work_listen": { "stethoscope": [700, 640, 40] }
  },
  "anchor": {},
  "airborne": [],
  "grounded": []
}
```

- `series`：這一組有哪幾種角色，照**檔名前綴**分（最長的前綴優先）。
  - `kind`：`person`（單人）、`couple`（兩人一起）、`dog`。
  - `ref`：基準姿勢的圖名（一定要在這一組裡）。
  - `target`：基準姿勢縮好之後的高度（px）：人 600、芃芃 260、QQ 280，**跟 base 一樣**，換衣服之後才一樣大。
  - `height`（可以不寫）：這種角色的身高是宣文的幾倍；不寫就照檔名前兩個字（xw 1、mt 0.95、cp 1、pp 0.26、qq 0.29）。
  - 日常服一的新動作沒畫基準姿勢時：`{ "prefix": "xw_", "kind": "person", "refFrom": "base:xw_", "target": 600 }` 借 base 的校正值
    （Codex 要照 base 的基準姿勢畫一樣大才準；跑完看總覽圖的藍線，站直的人頭頂要剛好碰到）。
- `points`：道具點，**原圖的 px**：`[x, y, 半徑]`（半徑可省略）。在檢查圖的格線上量。版面用 `puppetPoint(圖名, 點名, …)` 拿畫面座標
  （球的軌跡端點、擊球點、嘴的位置），有半徑的點也可以用 `hide` 把圖上畫好的道具蓋掉（例如 `xw_throw_2` 手邊的球）。
  常用的點名：`racket`（拍面中心）、`ball`、`mouth`（狗叼東西的位置）、`hand`、`wok`、`plate`。
- `anchor`：錨點 x 自動取身體中心（不透明像素的中位數）；總覽圖的疊圖裡身體亂跳時，手動給原圖的 x：`{ "xw_work_type_1": 480 }`。
- `airborne`／`grounded`：騰空與否的名字規則對不上時，在這裡列圖名強制指定。
- `mirror`：Codex 把側面畫成**朝左**的圖名清單，例如 `"mirror": ["mt_work_type_2"]`。清單上會記 `mirror: true`，播放時自動翻成朝右，
  總覽圖也畫成朝右，版面照樣當「側面朝右」用、不用改。道具點照原圖量（會跟著翻）。
  這只是左右鏡像：胸口的字、單邊的東西（手錶、包包、左胸的蝴蝶結）會跑到另一邊，看得出來的話還是請 Codex 重畫。
- JSON 不能有註解；要寫說明用 `"說明"` 欄位。

### 5.4 轉檔

```sh
cd frontend
node scripts/wall-sprites.mjs <組名>
```

- 裁掉透明邊、縮圖、轉 webp，**只寫這一組自己的檔**：
  - 圖：`frontend/public/wall-sprites/<組名>/<圖名>.webp`（這次沒產生的舊檔會刪掉）
  - 清單：`frontend/src/wall/sprites/<組名>.json`（整份重寫；`src/wall/spriteManifest.ts` 把每一組合起來，版面不用改）
  - 總覽圖：`wall-out/sprites-<組名>.png`
- 背景不透明、檔名前綴不在 series 裡、跟別組撞名、找不到基準姿勢的圖會被擋下來列出（以前轉過的會先沿用舊的）。
- 同一組同時只能一個人跑（資料夾裡的 `.lock`；跑到一半當掉留下的鎖 15 分鐘後自動失效，或自己刪掉）。**不同組可以同時跑**，互不影響。
- `--dry` 只印出會做什麼、不寫檔。
- **打開總覽圖看**：紅十字 = 腳底錨點（要在兩腳中間的地面）、藍線 = 參考身高（站直的人頭頂碰到）、綠圈 = 道具點（要在球拍面、嘴上）；
  下半部是同一個動作的疊圖，換圖時身體和腳不該亂跳。
- 大小：一張人約 30～60 KB、狗約 20～30 KB。圖只有在版面 `init()` 的 `loadPuppets()` 才下載，全部加起來再多也不會一次載入。
- 刪掉一整組：刪 `wall-out/codex-chars/poses/<組名>/`、`frontend/public/wall-sprites/<組名>/`、`frontend/src/wall/sprites/<組名>.json`（先確定沒有版面在用）。

---

## 6. 寫版面

照 ENGINE.md「寫一個版面」，角色的部分照下面的做法（四個範例版面都有完整的註解，直接照抄改）。

### 6.1 骨架（簡化的示意；其他 import 與 Scene 的寫法照 ENGINE.md，完整的看 `badminton.ts`）

```ts
import { loadPuppets, drawPuppet, drawPick, drawCycle, puppetPoint, puppetShadow, puppetIn, puppetLight,
  jumpArc, landSquash, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { drawNote, lyricOnPath, arcAt, arcPts } from './_couple';   // 道具、留言、歌詞沿曲線照樣用 _couple 的
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { group: 'couple', family: 'hoops', paper: true, energy: [0.4, 1], bars: [4, 8] };

const GROUND = 880;   // 地面 y
const SZ = 400;       // 場景尺度 = 宣文的身高（px）；同一場景的角色都傳同一個值
const POSES = ['xw_hoops_ready', 'xw_hoops_dribble_1', 'xw_hoops_dribble_2', 'mt_hoops_block'];

export default class Hoops extends Scene {
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  keys: [number, string][] = [];
  async init() {
    this.track(await loadPuppets(POSES));                 // 只載這個版面用到的圖；窗格結束自動還
    // 「那一下」的時間點排在拍點上（au.timeOfBeat／barAfter），做成姿勢時間軸
    this.keys = [[-1e9, 'xw_hoops_ready'], [hitT, 'xw_hoops_shoot'], [hitT + bp, 'xw_hoops_ready']];
    // 軌跡的端點從圖上的道具點算（跟 render 用同一組 opts）
    this.release = puppetPoint('xw_hoops_shoot', 'ball', X, GROUND, { h: SZ })!;
  }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const c = this.fg.ctx; this.fg.clear();
    const en = puppetIn(f.t, this.ctx.start + 0.05);     // 進場：從側面翻正
    puppetShadow(c, 'xw', X, GROUND, { h: SZ, lift });   // 先畫影子
    drawPick(c, this.keys, f.t, X, GROUND - lift, { h: SZ, spin: en.spin, alpha: en.alpha, squash: breathe(f.t, 0.01) });
    // …場景、道具、歌詞、留言
  }
}
```

### 6.2 做法（範例版面裡都有）

- **尺度**：`h`（`SZ`）= 宣文站直的身高。孟庭、狗的比例自動換算；狗是主角時可以 `scale: 1.2`（`fetch`、`cooking`），不然遠處認不出來。
- **換姿勢**：照時間軸用 `drawPick`（`badminton` 的擊球、`fetch` 的丟球、`waltz` 的轉身）；照節拍循環用 `drawCycle`（跑步一拍兩張、走路一拍一張）。
  時間軸的每一格可以各自翻面：`[t, '圖名', { flip: true }]`（例如跑過去之後轉身回頭看的那一張），跟 `drawPick` 的 `flip` 疊加；
  同一張圖只換朝向也會交叉淡化。（Codex 畫反的圖不要在這裡補，用 sprites.json 的 `mirror`。）
- **拍點**：`beatAfter(au, t, k)` 在 t 剛好是拍點時算「這一拍」；要下一拍用 `k = 1`，不要寫 `t + 0.01`（會多算一拍）。
  換圖時自動交叉淡化 2 格。**「那一下」的時間點就是換圖的時間點，而且要在拍點上**（`au.timeOfBeat`、`barAfter`）。
- **預備與跟隨**：換圖前用 `rot`（配 `pivot`）往後帶、換圖後往前送再慢慢收回（`badminton` 的揮拍、`fetch` 的丟球）；
  拍點上 `squash` 壓一下（`beatKick`）。
- **跳**：`jumpArc(t, 起跳, 落地, 高度)`，頂點在正中間：讓頂點落在拍點（`badminton` 跳殺、`fetch` QQ 接球）。起跳前蹲、落地壓扁回彈都算好了。
- **程式畫的道具接圖上的道具**：球的起點與終點用 `puppetPoint`；圖上已經畫了球、而球正由程式在飛時，用 `hide: ['ball']`
  或 `hide: ['xw_throw_2:ball']` 蓋掉（`fetch`：出手後蓋掉 throw_2 的球、飛行中蓋掉 QQ 嘴前的球，咬到的那一刻打開）。
- **影子**：每個紙偶腳底都要有 `puppetShadow`（離地時傳 `lift`）。亮版面用暖棕（`color: '70,45,25'`），暗版面用黑、alpha 高一點。
- **暗版面的打光**：紙偶畫完、同一層還沒畫別的東西時 `puppetLight(c, 範圍, 上, 下)`：上亮下暗，白衣服、白紗才不會比留言還亮（`badminton`、`waltz`）。
- **進場**：`puppetIn`（從側面翻正）＋腳邊的仙女棒火花；或走進畫面、跳進來、從暗處被燈照亮。
- **翻面**：`spin`（圈數）做紙偶轉身：0.25 圈變成一條線、0.5 圈翻過來（`waltz` 兩人互換位置）。
- **留言**（標準 v2，TREATMENT.md）：寫在場景的物件上（記分板、木牌、便條、畫架上的卡），`noteV2` 排字（40～60 px）、
  `tightenNote` 讓牌子的寬跟著字縮、高度跟著 `note.height`，`drawNote` 畫；最大 860 × 430、放畫面一側。歌詞 `lyricV2(留言字級)`。
- **確定性**：只看 `f.t`、節拍、種子；只畫自己 `loadPuppets` 過的圖。
- **不要**把紙偶疊在留言上、不要讓狗跑過去擋住字（`fetch` 把木牌架高）；角色不要進右下角 HUD 區的字。

### 6.3 QA（交件前一定要做）

```sh
cd frontend
export WALL_DEV_AUDIO_DIR=<放測試 mp3 的資料夾>
npx tsc --noEmit -p src/wall | grep scenes/<名字>
node scripts/wall-render.mjs qa --scene <名字>          # 錯誤 0、確定性通過、效能 < 12 ms，連跑兩次
```

- 打開 `wall-out/qa/<名字>.jpg`，再用 `stills` 截**全尺寸**看至少五種：長留言（`--message 3`）、短留言（`--message 2`）、四行多愛心（`--message 19`）、
  沒留言（`--params '{"message":null}'`）、純音樂（`--no-lyrics`）。
- 看：每個紙偶都有影子、腳踩在地上、動作落在拍點、換圖不跳、道具接得上（球從手上出去、進到嘴裡）、孟庭兩眼張開、留言讀得到。
- 版面改過樣子要重拍後台縮圖：`node scripts/wall-render.mjs thumbs --names <名字>`。

---

## 7. 常見問題

- **「找不到基準姿勢，比例對不上」**：這一組缺 `ref` 那張圖。請 Codex 補畫基準姿勢，或（日常服一）改用 `refFrom: "base:xw_"`。
- **「跟別組撞名」**：換一個名字（前綴後面加組名）；圖名改了，版面裡也要跟著改。
- **「這一組正在被別人處理」**：同一組有人在跑。等他跑完；確定沒人在跑就刪掉資料夾裡的 `.lock`。
- **換圖時人往旁邊跳一下**：看總覽圖的疊圖；兩張的身體中心差很多，就在 `anchor` 手動給錨點 x。
- **跑步時腳上下抖**：正常的走路／跑步圖會把最低的腳放在地上；騰空的圖名字要有 `jump`／`leap`…，或列在 `airborne`。
- **人比別組大或小**：新衣服那一組的基準姿勢要是「正面站直、雙手垂下」，`target` 跟 base 一樣；Codex 畫的基準姿勢彎腰、踮腳的話請它重畫。
- **狗太小看不清楚**：版面裡 `scale: 1.2`（不要改 `PUPPET_H`，那是全片共用的）。
