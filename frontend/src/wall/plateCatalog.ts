// 自動產生（node scripts/wall-catalog.mjs），不要手改：大螢幕版面清單，後台「大螢幕版面」頁用。
export interface PlateInfo { name: string; title: string; family: string; light: boolean; couple: boolean; bilingual: boolean; idea: string }
export const PLATE_CATALOG: PlateInfo[] = [
 {
  "name": "title",
  "title": "歌名卡／邀請卡",
  "family": "title",
  "light": false,
  "couple": false,
  "idea": "每首歌開頭的歌名卡；每隔幾分鐘出現一次放大 QR 的邀請卡",
  "bilingual": false
 },
 {
  "name": "karaoke",
  "title": "跟唱",
  "family": "type",
  "light": false,
  "couple": false,
  "idea": "最單純的版面：留言與逐字跟唱的歌詞",
  "bilingual": true
 },
 {
  "name": "sparkler",
  "title": "仙女棒寫字",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "仙女棒的火花在暗色信紙上一個字一個字寫出留言",
  "bilingual": true
 },
 {
  "name": "slam",
  "title": "大字重擊",
  "family": "type",
  "light": false,
  "couple": false,
  "idea": "副歌用：歌詞或留言一拍一組大字打上來",
  "bilingual": true
 },
 {
  "name": "certificate",
  "title": "結婚書約",
  "family": "doc",
  "light": false,
  "couple": false,
  "idea": "桌上的祝福登記表，留言是祝福內容，最後蓋章",
  "bilingual": false
 },
 {
  "name": "heartbeat",
  "title": "心電圖",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "暗房裡的監護儀，心跳跟著大鼓；留言是前面的醫囑紙條",
  "bilingual": true
 },
 {
  "name": "stars",
  "title": "星空",
  "family": "nature",
  "light": false,
  "couple": false,
  "idea": "電影感夜空：留言是天上的大字，每個字跟著一顆星亮起",
  "bilingual": true
 },
 {
  "name": "banknote",
  "title": "愛情準備銀行",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "桌上一張鈔票，雕刻紋與交扣的戒指，留言印在鈔票上",
  "bilingual": true
 },
 {
  "name": "mosaic",
  "title": "祝福牆",
  "family": "type",
  "light": false,
  "couple": false,
  "idea": "很多則留言排成牆，主打那則放大、其他退成背景",
  "bilingual": true
 },
 {
  "name": "fireworks",
  "title": "煙火",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "火花升空炸開，夜空裡的留言被煙火照亮",
  "bilingual": true
 },
 {
  "name": "vinyl",
  "title": "黑膠唱片",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "唱片在轉，歌詞沿溝紋；留言是桌上的紙卡",
  "bilingual": true
 },
 {
  "name": "badminton",
  "title": "羽球對打",
  "family": "sport",
  "light": false,
  "couple": true,
  "idea": "側面看兩人隔網對打，羽球在拍點上來回（擊球落在鼓點），球飛過的拋物線留下訊號色細線，歌詞沿著弧線逐字亮；主打留言寫在場邊記分板。",
  "bilingual": true
 },
 {
  "name": "fetch",
  "title": "丟網球",
  "family": "dog",
  "light": true,
  "couple": true,
  "idea": "紅磚公園步道，宣文把網球丟出去，芃芃與 QQ 在拍點上起跳、追、叼回來；留言寫在公園的木牌上，歌詞沿著球的軌跡。",
  "bilingual": true
 },
 {
  "name": "waltz",
  "title": "華爾滋",
  "family": "dance",
  "light": false,
  "couple": true,
  "idea": "婚禮服，兩人在聚光燈下跳三拍子（慢歌也適用），每小節一個大轉身，裙擺與頭紗的線條跟著甩；歌詞在地板上成圓弧。",
  "bilingual": true
 },
 {
  "name": "cooking",
  "title": "一起做菜",
  "family": "home",
  "light": true,
  "couple": true,
  "idea": "廚房側面，孟庭甩鍋（在大鼓上翻），宣文遞盤子，QQ 在腳邊等掉下來的；留言寫在冰箱上的便條，歌詞像食譜步驟。",
  "bilingual": true
 },
 {
  "name": "tennis",
  "title": "網球",
  "family": "sport",
  "light": true,
  "couple": true,
  "idea": "俯視或斜俯視的球場，兩人對打，出界球被芃芃撿走；球是 `ball` 色，擊球在鼓點。留言在計分牌。",
  "bilingual": true
 },
 {
  "name": "pingpong",
  "title": "桌球",
  "family": "sport",
  "light": false,
  "couple": true,
  "idea": "桌球桌側面特寫，乒乓在每一拍彈一下（快歌很快、慢歌很慢），歌詞一拍一個詞組跟著球跳。",
  "bilingual": true
 },
 {
  "name": "frisbee",
  "title": "飛盤",
  "family": "sport",
  "light": true,
  "couple": true,
  "idea": "草地，飛盤飛過畫面、芃芃飛身接住（慢動作一拍），飛盤底面寫著留言。",
  "bilingual": true
 },
 {
  "name": "skating",
  "title": "溜冰",
  "family": "sport",
  "light": false,
  "couple": true,
  "idea": "冰面俯視或側面，兩人牽手溜冰，冰刀在冰上畫出的線就是歌詞的筆畫（或字沿著軌跡）。",
  "bilingual": true
 },
 {
  "name": "tandem",
  "title": "雙人腳踏車",
  "family": "sport",
  "light": true,
  "couple": true,
  "idea": "側面，雙人腳踏車騎過街景（景往後捲），踏板一拍一圈，後面的籃子坐著兩隻狗；留言是車後拖的布條。",
  "bilingual": true
 },
 {
  "name": "archery",
  "title": "射箭",
  "family": "sport",
  "light": false,
  "couple": true,
  "idea": "孟庭拉弓（預備一小節）、放箭在小節線，箭飛過畫面正中靶心變成一顆愛心，靶上的環寫著留言。",
  "bilingual": true
 },
 {
  "name": "firstdance",
  "title": "第一支舞",
  "family": "dance",
  "light": false,
  "couple": true,
  "idea": "婚禮服，空蕩的舞池、一盞聚光燈、慢慢轉；賓客的留言像周圍桌上的小燭光一則一則亮起。慢歌專用。",
  "bilingual": true
 },
 {
  "name": "swing",
  "title": "搖擺舞",
  "family": "dance",
  "light": false,
  "couple": true,
  "idea": "快歌用：40 年代搖擺舞，甩出去、拉回來、拋起來，全在拍點；地板的舞步腳印排成字。",
  "bilingual": true
 },
 {
  "name": "dogwalk",
  "title": "遛狗",
  "family": "dog",
  "light": true,
  "couple": true,
  "idea": "紅磚步道、藍色牽繩，兩人各牽一隻狗散步（橫向捲動），狗狗在每棵樹停一下；留言寫在路邊的告示牌。",
  "bilingual": true
 },
 {
  "name": "dogbath",
  "title": "洗澡",
  "family": "dog",
  "light": true,
  "couple": true,
  "idea": "浴缸裡的芃芃與 QQ，泡泡在拍點冒出來，每個泡泡裡一個字（留言），狗狗甩水在小鼓。",
  "bilingual": true
 },
 {
  "name": "dognap",
  "title": "午睡",
  "family": "dog",
  "light": true,
  "couple": true,
  "idea": "慢歌：沙發上兩人和兩隻狗睡成一團，呼吸起伏跟著節拍，夢泡泡裡是留言。",
  "bilingual": true
 },
 {
  "name": "zoomies",
  "title": "狗狗暴衝",
  "family": "dog",
  "light": false,
  "couple": true,
  "idea": "快歌：兩隻狗在客廳繞圈暴衝，速度線、殘影，歌詞被牠們撞得跳起來；人在沙發上看。",
  "bilingual": false
 },
 {
  "name": "dogportrait",
  "title": "狗狗肖像",
  "family": "dog",
  "light": true,
  "couple": true,
  "idea": "美術館的畫框裡是芃芃（或 QQ）的正式肖像（版畫線條），畫框下的銘牌寫著留言與「No.042 館藏」。",
  "bilingual": true
 },
 {
  "name": "ringbearer",
  "title": "狗狗戒童",
  "family": "dog",
  "light": false,
  "couple": true,
  "idea": "婚禮服的兩人在走道盡頭等，QQ 叼著戒枕走紅毯，一拍一步；兩側座位的賓客舉著留言。",
  "bilingual": true
 },
 {
  "name": "picnic",
  "title": "野餐",
  "family": "date",
  "light": true,
  "couple": true,
  "idea": "格紋野餐墊、籃子、三明治，狗狗偷吃；風吹起的餐巾紙上寫著留言。",
  "bilingual": true
 },
 {
  "name": "kite",
  "title": "放風箏",
  "family": "date",
  "light": true,
  "couple": true,
  "idea": "兩人放一只風箏，風箏尾巴的飄帶就是歌詞（逐字亮），線在拍點抖動；留言寫在風箏上。",
  "bilingual": true
 },
 {
  "name": "umbrella",
  "title": "共撐一把傘",
  "family": "date",
  "light": false,
  "couple": true,
  "idea": "雨線（斜的細線，在 hi-hat 上閃），兩人擠在一把傘下走，傘下是乾的、寫著留言；水坑倒影是歌詞。",
  "bilingual": true
 },
 {
  "name": "stargaze",
  "title": "看星星",
  "family": "date",
  "light": false,
  "couple": true,
  "idea": "兩人躺在草地上指著天空，指到的星星連成留言的字（呼應 `stars`，但這裡是人的視角）。慢歌。",
  "bilingual": true
 },
 {
  "name": "beach",
  "title": "海邊散步",
  "family": "date",
  "light": true,
  "couple": true,
  "idea": "海浪一拍一拍打上沙灘，兩人牽手走、狗狗追浪；浪退後沙上留下留言的字，下一道浪沖掉換歌詞。",
  "bilingual": true
 },
 {
  "name": "scooter",
  "title": "騎機車",
  "family": "date",
  "light": false,
  "couple": true,
  "idea": "台灣街景（騎樓、招牌、紅綠燈），宣文騎機車載孟庭、踏板站著狗；招牌字是歌詞，路口的看板是留言。",
  "bilingual": true
 },
 {
  "name": "nightmarket",
  "title": "夜市",
  "family": "date",
  "light": false,
  "couple": true,
  "idea": "攤位燈泡、招牌，兩人撈金魚／射氣球，射中的氣球破掉露出留言；攤位招牌寫歌詞。",
  "bilingual": true
 },
 {
  "name": "lantern",
  "title": "放天燈",
  "family": "date",
  "light": false,
  "couple": true,
  "idea": "平溪天燈：兩人在天燈上寫字（留言），點火、放手在小節線，天燈升空，遠處已經有一片寫著其他留言的天燈。",
  "bilingual": true
 },
 {
  "name": "ferriswheel",
  "title": "摩天輪",
  "family": "date",
  "light": false,
  "couple": true,
  "idea": "巨大的摩天輪慢轉（細線結構、燈泡在拍點閃），兩人在其中一個車廂裡，其他車廂裝著留言與歌詞。",
  "bilingual": true
 },
 {
  "name": "coffee",
  "title": "咖啡拉花",
  "family": "home",
  "light": true,
  "couple": true,
  "idea": "俯視兩杯咖啡，拉花在拍點畫出愛心與葉子，旁邊的咖啡店黑板菜單寫著歌詞與留言。",
  "bilingual": true
 },
 {
  "name": "movie",
  "title": "電影院",
  "family": "home",
  "light": false,
  "couple": true,
  "idea": "從後排看兩人的背影和狗狗的頭，大銀幕上放的是歌詞（跟唱），爆米花在小鼓跳；片頭字卡是留言。",
  "bilingual": true
 },
 {
  "name": "laundry",
  "title": "曬衣服",
  "family": "home",
  "light": true,
  "couple": true,
  "idea": "陽台晾衣繩，兩人一件一件夾上去，衣服與床單上寫著留言與歌詞（一拍一件），風吹起來。",
  "bilingual": true
 },
 {
  "name": "paperplane",
  "title": "紙飛機",
  "family": "home",
  "light": false,
  "couple": true,
  "idea": "摺紙飛機（摺的步驟在拍點上），射出去飛過畫面，機翼上寫著留言；飛過的軌跡是歌詞。",
  "bilingual": false
 },
 {
  "name": "duet",
  "title": "KTV 對唱",
  "family": "music",
  "light": false,
  "couple": true,
  "idea": "包廂：兩人各拿一支麥克風，螢幕上跑歌詞（跟唱，換人唱用不同顏色），桌上的點歌單是留言。",
  "bilingual": true
 },
 {
  "name": "guitar",
  "title": "彈吉他",
  "family": "music",
  "light": true,
  "couple": true,
  "idea": "宣文彈吉他、孟庭唱，狗狗跟著搖頭；刷弦在拍點，音符飄出去組成歌詞，譜架上是留言。",
  "bilingual": true
 },
 {
  "name": "proposal",
  "title": "求婚",
  "family": "wedding",
  "light": false,
  "couple": true,
  "idea": "日常服：宣文單膝跪下（預備）、在小節線打開戒指盒（訊號色的光），背後的城市夜景窗戶亮成留言的字。",
  "bilingual": true
 },
 {
  "name": "cake",
  "title": "切蛋糕",
  "family": "wedding",
  "light": true,
  "couple": true,
  "idea": "三層蛋糕，兩人握同一把刀切下去（小節線），每一層蛋糕的側面寫著留言／歌詞。",
  "bilingual": false
 },
 {
  "name": "toast",
  "title": "乾杯",
  "family": "wedding",
  "light": false,
  "couple": true,
  "idea": "兩只香檳杯在拍點碰杯，氣泡往上冒，冒到頂端組成留言的字。",
  "bilingual": true
 },
 {
  "name": "bouquet",
  "title": "丟捧花",
  "family": "wedding",
  "light": true,
  "couple": true,
  "idea": "孟庭背對賓客往後丟捧花（預備一小節），捧花飛過畫面，接住的人舉起留言。",
  "bilingual": true
 },
 {
  "name": "comic",
  "title": "四格漫畫",
  "family": "cartoon",
  "light": true,
  "couple": true,
  "idea": "四格漫畫：兩人的小劇情，對話框裡是留言與歌詞，一格一格在小節線出現；網點與框線。",
  "bilingual": true
 },
 {
  "name": "photobooth",
  "title": "拍貼機",
  "family": "cartoon",
  "light": true,
  "couple": true,
  "idea": "四格拍貼條，每小節拍一格（倒數、閃光），四個不同姿勢的線稿，下面手寫留言。",
  "bilingual": true
 },
 {
  "name": "debug",
  "title": "深夜寫程式",
  "family": "work",
  "light": false,
  "couple": true,
  "idea": "宣文在雙螢幕前敲鍵盤（一拍一下），螢幕上的建置從紅燈在小節線變綠燈；孟庭下班穿著護理服回來，從後面抱住他。留言是螢幕上一則程式碼審查的留言。",
  "bilingual": true
 },
 {
  "name": "nightshift",
  "title": "夜班護理站",
  "family": "work",
  "light": false,
  "couple": true,
  "idea": "孟庭在護理站寫紀錄、推工作車，牆上時鐘和呼叫燈照拍子閃；宣文穿連帽衫提著宵夜（便當、珍奶）來探班。留言寫在交班白板上。",
  "bilingual": true
 },
 {
  "name": "stethoscope",
  "title": "聽心跳",
  "family": "work",
  "light": true,
  "couple": true,
  "idea": "孟庭用聽診器聽宣文的胸口，旁邊的心電圖跟著歌的 BPM 跳，聽著聽著心跳越來越快、跳出愛心。留言寫在病歷夾上。",
  "bilingual": true
 },
 {
  "name": "whiteboard",
  "title": "白板架構圖",
  "family": "work",
  "light": true,
  "couple": true,
  "idea": "宣文在白板畫系統架構圖，方塊和箭頭照拍子一個一個畫上，最後整張圖連成一顆愛心；孟庭拿紅筆在旁邊打勾。留言寫在白板上的便利貼。",
  "bilingual": true
 },
 {
  "name": "bandaid",
  "title": "OK 繃",
  "family": "work",
  "light": true,
  "couple": true,
  "idea": "宣文被紙割到手指，孟庭熟練地消毒、貼上 OK 繃、再在上面畫一顆愛心；芃芃和 QQ 在旁邊歪頭看。留言印在 OK 繃盒上。",
  "bilingual": true
 },
 {
  "name": "servers",
  "title": "機房",
  "family": "work",
  "light": false,
  "couple": true,
  "idea": "伺服器機櫃的燈號照拍子閃成波浪；宣文插網路線，孟庭拿著「上線檢查表」一項一項打勾。留言寫在檢查表最後一欄。",
  "bilingual": true
 },
 {
  "name": "courtside",
  "title": "場邊看球",
  "family": "hoops",
  "light": false,
  "couple": true,
  "idea": "兩人穿球衣坐在看台吃爆米花，場上球員剪影跑位；進球時兩人跳起來歡呼，爆米花飛起來。留言在場館的大螢幕上。",
  "bilingual": true
 },
 {
  "name": "kisscam",
  "title": "親親鏡頭",
  "family": "hoops",
  "light": false,
  "couple": true,
  "idea": "場館大螢幕出現「KISS CAM」愛心框，框到兩人：孟庭害羞捂臉、宣文比愛心，全場觀眾剪影歡呼。留言在大螢幕下方的跑馬燈。",
  "bilingual": true
 },
 {
  "name": "buzzer",
  "title": "絕殺",
  "family": "hoops",
  "light": false,
  "couple": true,
  "idea": "最後三秒，球在空中慢動作飛，兩人抓著彼此的手緊張；小節線上球進、紅燈亮，兩人跳起來擁抱。留言在計分板上。",
  "bilingual": true
 },
 {
  "name": "halftime",
  "title": "中場投籃挑戰",
  "family": "hoops",
  "light": false,
  "couple": true,
  "idea": "中場休息，宣文上場參加投籃挑戰，一拍投一球，最後一球空心進；孟庭在場邊揮加油棒。留言寫在大支票（獎品看板）上。",
  "bilingual": true
 },
 {
  "name": "basketball",
  "title": "街頭鬥牛",
  "family": "hoops",
  "light": true,
  "couple": true,
  "idea": "公園籃球場，兩人一對一：宣文運球（每拍一下）、孟庭蓋火鍋；芃芃和 QQ 在場邊當裁判。留言塗鴉在球場後面的牆上。",
  "bilingual": true
 },
 {
  "name": "concert",
  "title": "搖滾區",
  "family": "live",
  "light": false,
  "couple": true,
  "idea": "舞台燈照拍子掃過觀眾，兩人在前排舉手跟唱，舞台大螢幕是歌詞（逐字跟唱）。留言寫在兩人舉的應援手幅上。",
  "bilingual": true
 },
 {
  "name": "lightsticks",
  "title": "手燈海",
  "family": "live",
  "light": false,
  "couple": true,
  "idea": "看台一整片手燈照拍子變色，排成波浪；兩人在中間一起揮手燈。留言寫在孟庭舉的應援板上。",
  "bilingual": true
 },
 {
  "name": "phonelights",
  "title": "手機燈海",
  "family": "live",
  "light": false,
  "couple": true,
  "idea": "慢歌時全場亮起手機燈，左右搖擺像星海，兩人靠在一起。留言在宣文的手機螢幕上。",
  "bilingual": true
 },
 {
  "name": "encore",
  "title": "散場",
  "family": "live",
  "light": false,
  "couple": true,
  "idea": "散場後的場館外面，人潮和路燈；兩人的發光手環一閃一閃，牽手走向捷運站。留言寫在兩人手上的票根。",
  "bilingual": true
 },
 {
  "name": "merch",
  "title": "排隊買周邊",
  "family": "live",
  "light": true,
  "couple": true,
  "idea": "長長的排隊隊伍一格一格往前，終於輪到兩人，買到一樣的應援毛巾，一起展開，毛巾上寫著留言。",
  "bilingual": true
 },
 {
  "name": "boarding",
  "title": "登機證",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "「FLIGHT AO0313 → 永遠」登機證，乘客姓名 = 留言署名，登機門、座位、條碼；留言印在登機證上，歌詞像廣播字幕。票根在小節線撕下。",
  "bilingual": true
 },
 {
  "name": "passport",
  "title": "護照蓋章頁",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "護照內頁滿是各國入境章，拍點上「碰」地蓋新章，章裡是留言；（不是任何國家真的護照樣式）。",
  "bilingual": true
 },
 {
  "name": "invoice",
  "title": "統一發票",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "台灣統一發票：品名是留言、金額「∞」，對獎號碼在小節線開出；歌詞是發票上的明細。",
  "bilingual": false
 },
 {
  "name": "telegram",
  "title": "電報",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "老電報紙條從機器吐出，逐字打出留言（STOP 分句），蓋上收件戳；歌詞是電報表頭。",
  "bilingual": true
 },
 {
  "name": "newspaper",
  "title": "號外",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "報紙號外：頭條是留言、副標是歌詞，報紙旋轉飛進畫面停在小節線（老電影的手法）。",
  "bilingual": true
 },
 {
  "name": "envelope",
  "title": "信封與郵票",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "信封在拍點打開，信紙抽出來是留言，郵票與郵戳（日期是婚禮日期），封蠟是愛心。",
  "bilingual": true
 },
 {
  "name": "postcard",
  "title": "明信片",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "明信片背面：左邊手寫留言、右邊地址欄與郵票，翻面在小節線，正面是線條版畫風景＋歌詞。",
  "bilingual": false
 },
 {
  "name": "ticket",
  "title": "演唱會票根",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "票券：演出名稱 = 歌名、座位 = 留言編號，票根虛線在拍點撕開；歌詞印在票面上。",
  "bilingual": false
 },
 {
  "name": "menu",
  "title": "喜宴菜單",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "辦桌／喜宴菜單卡：一道一道菜名在拍點出現（冷盤、佛跳牆…），其中一道「主廚推薦」是留言。",
  "bilingual": true
 },
 {
  "name": "librarycard",
  "title": "借書卡",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "圖書館借書卡的格子：借閱人一格一格蓋日期章，最後一格是留言與署名；歌詞是書名。",
  "bilingual": false
 },
 {
  "name": "recipe",
  "title": "愛情食譜卡",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "手寫食譜卡：材料清單（一拍一項）、步驟，留言是「秘方」；有醬汁的污漬。",
  "bilingual": false
 },
 {
  "name": "patent",
  "title": "專利說明書",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "老專利圖：「一種使兩人永遠在一起的裝置」，編號與線稿機構圖（齒輪、兩個愛心），圖說是歌詞與留言。",
  "bilingual": true
 },
 {
  "name": "blueprint",
  "title": "藍圖",
  "family": "doc",
  "light": false,
  "couple": false,
  "idea": "施工藍圖（主題色的藍圖紙）：「我們的家」平面圖在拍點一條線一條線畫出，房間名稱是歌詞、標註是留言。",
  "bilingual": true
 },
 {
  "name": "crossword",
  "title": "填字遊戲",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "報紙填字格，字一格一格在拍點填入（歌詞與留言交錯），提示欄是冷面笑話。",
  "bilingual": false
 },
 {
  "name": "sheetmusic",
  "title": "樂譜",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "五線譜：音符在拍點出現（用真的節拍位置），歌詞寫在譜下逐字跟唱；留言是作曲者的旁註。",
  "bilingual": true
 },
 {
  "name": "almanac",
  "title": "農民曆",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "撕頁日曆／農民曆：大大的日期、「宜：嫁娶、祝福」，撕下一頁在小節線，留言是當日運勢。",
  "bilingual": false
 },
 {
  "name": "reportcard",
  "title": "成績單",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "愛情學校成績單：科目（體貼、做家事、遛狗）與分數在拍點蓋上，導師評語是留言。",
  "bilingual": true
 },
 {
  "name": "warranty",
  "title": "保固卡",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "產品保固卡：「保固期限：永久」、序號、打孔，留言是「消費者意見」；保證章在小節線蓋下。",
  "bilingual": true
 },
 {
  "name": "invitation",
  "title": "喜帖",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "燙金（訊號色）喜帖打開，內頁的字一行一行浮現：新人名字、日期、留言是「賓客回函」。",
  "bilingual": true
 },
 {
  "name": "guestbook",
  "title": "簽名簿",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "攤開的簽名簿，一支筆（火花）在拍點寫下名字與留言，前面幾頁已經寫滿別人的留言（真的留言）。",
  "bilingual": true
 },
 {
  "name": "manual",
  "title": "組裝說明書",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "無字說明書風格：步驟 1 2 3 的線稿圖（零件組成一顆愛心），步驟說明是歌詞，「注意事項」是留言。",
  "bilingual": true
 },
 {
  "name": "nutrition",
  "title": "營養標示",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "營養標示表：甜度 200%、心動 ∞，每一列在拍點填上，成分是留言。",
  "bilingual": false
 },
 {
  "name": "redenvelope",
  "title": "紅包",
  "family": "doc",
  "light": false,
  "couple": false,
  "idea": "紅包袋（訊號色、燙金字）在小節線打開，抽出來的紙是留言；歌詞是紅包袋上的吉祥話位置。",
  "bilingual": true
 },
 {
  "name": "scratchcard",
  "title": "刮刮樂",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "刮刮卡的銀漆在拍點被刮掉（硬幣刮痕），刮出來是留言與「恭喜中獎：一輩子」。",
  "bilingual": false
 },
 {
  "name": "notebook",
  "title": "筆記本",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "橫線筆記本，原子筆字跡逐字寫出歌詞（跟唱），留言用另一種筆跡、貼上的便條。",
  "bilingual": true
 },
 {
  "name": "stickynotes",
  "title": "便利貼牆",
  "family": "doc",
  "light": true,
  "couple": false,
  "idea": "一面牆的便利貼，一拍一張貼上去（真的留言），主打那張最大、歌詞寫在最上面的一排。",
  "bilingual": true
 },
 {
  "name": "chat",
  "title": "聊天室",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "聊天視窗（不像任何特定 App）：留言以對話泡泡冒出（打字中…的三點），歌詞是另一方回覆的泡泡。",
  "bilingual": true
 },
 {
  "name": "desktop",
  "title": "電腦桌面",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "復古電腦桌面：對話框「確定要永遠在一起嗎？ [是] [是]」，視窗在拍點彈出，留言是通知視窗。",
  "bilingual": true
 },
 {
  "name": "search",
  "title": "搜尋框",
  "family": "screen",
  "light": true,
  "couple": false,
  "idea": "一個簡潔的搜尋框：打字（歌詞），下拉的自動完成建議是留言。不要像任何特定搜尋引擎。",
  "bilingual": true
 },
 {
  "name": "phone",
  "title": "手機通知",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "手機鎖定畫面：大時鐘（歌曲時間）、通知一則一則滑下來（留言），歌詞是音樂播放器的小卡。",
  "bilingual": false
 },
 {
  "name": "spreadsheet",
  "title": "試算表",
  "family": "screen",
  "light": true,
  "couple": false,
  "idea": "試算表格線，儲存格在拍點填入（公式 =SUM(愛)），圖表長出來，留言在一個被框起來的儲存格。",
  "bilingual": true
 },
 {
  "name": "code",
  "title": "程式碼",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "程式編輯器：`while (true) { love(); }`，逐字打出，歌詞是註解、留言是字串；執行時終端機印出來。",
  "bilingual": true
 },
 {
  "name": "loading",
  "title": "安裝進度條",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "「正在安裝：婚姻 v1.0」進度條在拍點跳，99% 卡住再衝到 100%；安裝日誌是歌詞，完成畫面是留言。",
  "bilingual": true
 },
 {
  "name": "news",
  "title": "新聞快報",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "電視新聞畫面：主播台（簡單線條）、下方的跑馬燈是歌詞、快報標題是留言，「LIVE」在拍點閃。",
  "bilingual": true
 },
 {
  "name": "weather",
  "title": "氣象報告",
  "family": "screen",
  "light": true,
  "couple": false,
  "idea": "氣象圖：台灣地圖輪廓、降愛機率 100%、心形的高氣壓，數字在拍點翻；留言是「今日天氣小語」。",
  "bilingual": true
 },
 {
  "name": "credits",
  "title": "片尾名單",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "電影片尾名單往上捲：職稱「祝福」後面是留言的署名與內容，捲動速度跟著節拍微微頓一下。",
  "bilingual": true
 },
 {
  "name": "flipclock",
  "title": "翻頁鐘",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "大翻頁鐘，每一拍翻一片（歌詞的字），翻頁的機械感與陰影；留言在下方的小翻頁列。",
  "bilingual": true
 },
 {
  "name": "departures",
  "title": "航班看板",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "機場航班看板（翻牌字）：目的地都是祝福，班次是留言編號，字牌在拍點嘩啦啦翻。",
  "bilingual": true
 },
 {
  "name": "odometer",
  "title": "里程表",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "滾輪數字表：數字與字一起滾動停在拍點，顯示留言數、BPM、歌詞。",
  "bilingual": true
 },
 {
  "name": "radio",
  "title": "收音機",
  "family": "machine",
  "light": true,
  "couple": false,
  "idea": "老收音機的調頻刻度，指針在拍點移動對到一個頻道，頻道名是留言，喇叭網後面跳歌詞。",
  "bilingual": true
 },
 {
  "name": "cassette",
  "title": "錄音帶",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "錄音帶特寫，捲軸在轉（速度跟 BPM），標籤手寫著留言；歌詞在錄音機的小螢幕。",
  "bilingual": true
 },
 {
  "name": "equalizer",
  "title": "等化器",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "大型等化器的光柱（真的頻譜），光柱上排列的字就是歌詞；留言像顯示屏上的跑馬。",
  "bilingual": true
 },
 {
  "name": "lissajous",
  "title": "李薩如圖形",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "示波器 XY 模式：兩個頻率（兩個人）畫出的李薩如曲線慢慢變成愛心，讀數是留言，歌詞在螢幕下方。",
  "bilingual": true
 },
 {
  "name": "seismograph",
  "title": "地震儀",
  "family": "machine",
  "light": true,
  "couple": false,
  "idea": "捲動的紙與筆針，在大鼓時大震，「心動震度 7 級」；筆針畫出的曲線上標註歌詞與留言。",
  "bilingual": true
 },
 {
  "name": "radar",
  "title": "雷達",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "雷達掃描線轉一圈一小節，掃到的光點是留言（顯示在旁邊的目標清單），歌詞是座標讀數。",
  "bilingual": true
 },
 {
  "name": "terminal",
  "title": "終端機",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "綠螢幕（主題訊號色）終端機，`> cat wishes.txt` 逐字印出留言，歌詞是系統日誌。",
  "bilingual": true
 },
 {
  "name": "arcade",
  "title": "街機高分榜",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "街機的 HIGH SCORE 名單：名字是留言署名、分數在拍點跳，主打留言大字；點陣字（精緻，不俗）。",
  "bilingual": true
 },
 {
  "name": "pinball",
  "title": "彈珠台",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "彈珠台俯視，鋼珠在拍點撞擊彈柱（亮起），撞到的燈板亮出留言，分數板是歌詞。",
  "bilingual": false
 },
 {
  "name": "jukebox",
  "title": "點唱機",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "點唱機的選曲卡片（這首歌的歌名在其中），機械手臂在拍點夾起唱片，選曲卡的空白是留言。",
  "bilingual": true
 },
 {
  "name": "clawmachine",
  "title": "夾娃娃機",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "夾娃娃機：爪子在拍點移動、下降，夾起一顆寫著留言的球（或愛心），出口掉出來。",
  "bilingual": true
 },
 {
  "name": "marquee",
  "title": "LED 跑馬燈",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "店家的 LED 點陣跑馬燈（台灣招牌那種），歌詞在點陣上逐字跑、留言用第二條。",
  "bilingual": false
 },
 {
  "name": "neon",
  "title": "霓虹招牌",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "磚牆上的霓虹招牌，一個字一個字亮起（歌詞），偶爾閃爍，留言是小一號的霓虹字。",
  "bilingual": true
 },
 {
  "name": "dashboard",
  "title": "汽車儀表板",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "儀表板：轉速表跟著能量、速度表是 BPM，中控螢幕跑歌詞，導航的目的地是留言。",
  "bilingual": true
 },
 {
  "name": "metronome",
  "title": "節拍器",
  "family": "machine",
  "light": true,
  "couple": false,
  "idea": "大節拍器，擺錘精準打在每一拍，擺錘上的砝碼寫著 BPM，歌詞在擺動弧線上，留言在底座。",
  "bilingual": true
 },
 {
  "name": "mixer",
  "title": "混音台",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "混音台的推桿與旋鈕跟著頻段動（low/mid/high/vocal），每一軌的標籤是字，留言寫在膠帶標籤上。",
  "bilingual": true
 },
 {
  "name": "pianoroll",
  "title": "自動鋼琴紙卷",
  "family": "machine",
  "light": true,
  "couple": false,
  "idea": "自動鋼琴的打孔紙卷往下捲，孔洞在拍點經過讀取頭時發亮，紙卷邊緣印著歌詞，留言是紙卷的標題。",
  "bilingual": true
 },
 {
  "name": "musicbox",
  "title": "音樂盒",
  "family": "machine",
  "light": true,
  "couple": false,
  "idea": "音樂盒的滾筒與簧片（俯視），凸點在拍點撥響簧片，滾筒上的凸點排列成留言的字。",
  "bilingual": true
 },
 {
  "name": "typewriter",
  "title": "打字機",
  "family": "machine",
  "light": true,
  "couple": false,
  "idea": "打字機特寫：字鎚在拍點打上紙，逐字打出留言，換行時「叮」＋紙往上捲；歌詞是紙上的第一行。",
  "bilingual": true
 },
 {
  "name": "morse",
  "title": "摩斯電報",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "電報鍵在拍點按下，紙帶上打出點與劃，下面翻譯成留言；歌詞是電報局的收訊紀錄。",
  "bilingual": true
 },
 {
  "name": "crt",
  "title": "老電視",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "映像管電視（弧形畫面、掃描線），轉台在小節線（雜訊一下），每台播的是歌詞或留言。",
  "bilingual": true
 },
 {
  "name": "scoreboard",
  "title": "記分板",
  "family": "machine",
  "light": false,
  "couple": false,
  "idea": "球場大記分板：HOME 宣文 vs AWAY 孟庭，比分永遠平手，跑馬燈是歌詞，「本場最佳」是留言。",
  "bilingual": false
 },
 {
  "name": "elements",
  "title": "元素週期表",
  "family": "science",
  "light": true,
  "couple": false,
  "idea": "週期表格子在拍點亮起，拼出留言的字（像 Lo-Ve 的元素符號），每格下面有原子序（留言編號）。",
  "bilingual": true
 },
 {
  "name": "dna",
  "title": "雙螺旋",
  "family": "science",
  "light": false,
  "couple": false,
  "idea": "兩條螺旋（兩個人）旋轉，鹼基對的橫桿是字，歌詞沿著一條、留言沿著另一條。",
  "bilingual": true
 },
 {
  "name": "orbit",
  "title": "雙星軌道",
  "family": "science",
  "light": false,
  "couple": false,
  "idea": "兩顆星互繞（版畫軌道線），一小節一圈，軌道上的標註是歌詞，留言是觀測紀錄。",
  "bilingual": true
 },
 {
  "name": "pendulum",
  "title": "雙擺",
  "family": "science",
  "light": true,
  "couple": false,
  "idea": "雙擺／傅科擺的軌跡（確定性模擬）畫出花樣，軌跡上的點是字，留言是實驗紀錄。",
  "bilingual": true
 },
 {
  "name": "interference",
  "title": "波的干涉",
  "family": "science",
  "light": false,
  "couple": false,
  "idea": "兩個波源（兩個人）在拍點發出同心圓，干涉條紋亮的地方浮出留言的字。",
  "bilingual": true
 },
 {
  "name": "magnet",
  "title": "磁力線",
  "family": "science",
  "light": true,
  "couple": false,
  "idea": "兩塊磁鐵（正負 = 兩個人）的磁力線（鐵粉的細線）在拍點重新排列，鐵粉聚成留言。",
  "bilingual": true
 },
 {
  "name": "prism",
  "title": "光譜",
  "family": "science",
  "light": false,
  "couple": false,
  "idea": "一道白光進三稜鏡分成光譜（主題色系），光譜的每條色帶上是一個字，留言是出射的光。",
  "bilingual": true
 },
 {
  "name": "microscope",
  "title": "顯微鏡",
  "family": "science",
  "light": true,
  "couple": false,
  "idea": "顯微鏡視野（圓形、刻度），細胞在拍點分裂成愛心，標本標籤是留言。",
  "bilingual": true
 },
 {
  "name": "venn",
  "title": "文氏圖",
  "family": "science",
  "light": true,
  "couple": false,
  "idea": "兩個圓（宣文、孟庭）慢慢靠近重疊，交集裡是留言，兩邊各自的特點是歌詞（可以是冷面笑話）。",
  "bilingual": true
 },
 {
  "name": "piechart",
  "title": "資訊圖表",
  "family": "science",
  "light": true,
  "couple": false,
  "idea": "圓餅圖與長條圖在拍點長出來：「今晚的祝福組成」，數字用真的留言數，主打留言是圖說。",
  "bilingual": true
 },
 {
  "name": "hourglass",
  "title": "沙漏",
  "family": "science",
  "light": false,
  "couple": false,
  "idea": "沙漏在小節線翻轉，沙粒流下來堆成字（留言），慢歌適合。",
  "bilingual": true
 },
 {
  "name": "kaleidoscope",
  "title": "萬花筒",
  "family": "craft",
  "light": false,
  "couple": false,
  "idea": "萬花筒對稱圖案跟著節拍轉動變化（shader），中央透明處出現留言，歌詞在外框。",
  "bilingual": true
 },
 {
  "name": "spirograph",
  "title": "萬花尺",
  "family": "craft",
  "light": true,
  "couple": false,
  "idea": "萬花尺齒輪在紙上轉，筆畫出繁複的花樣（一小節一圈），花樣中央寫留言。",
  "bilingual": true
 },
 {
  "name": "origami",
  "title": "摺紙鶴",
  "family": "craft",
  "light": true,
  "couple": false,
  "idea": "一張方紙在拍點一摺一摺摺成紙鶴（2D 摺線動畫），攤開的紙上寫著留言。",
  "bilingual": true
 },
 {
  "name": "xi",
  "title": "剪紙囍",
  "family": "craft",
  "light": false,
  "couple": false,
  "idea": "紅紙（訊號色）上剪刀剪出「囍」與花紋，剪下的紙片落下，窗花裡露出留言。",
  "bilingual": true
 },
 {
  "name": "brush",
  "title": "書法",
  "family": "craft",
  "light": true,
  "couple": false,
  "idea": "宣紙上毛筆逐字寫出留言（筆畫有飛白、落筆在拍點），落款是署名，蓋上紅色印章。",
  "bilingual": true
 },
 {
  "name": "seal",
  "title": "篆刻印章",
  "family": "craft",
  "light": true,
  "couple": false,
  "idea": "一方印章的印面特寫、刻刀在拍點刻出（邊款是歌詞），最後蓋在紙上，旁邊是留言。",
  "bilingual": true
 },
 {
  "name": "stitch",
  "title": "十字繡",
  "family": "craft",
  "light": true,
  "couple": false,
  "idea": "麻布格子上一針一針繡出留言（十字針在拍點），繡框、線頭。",
  "bilingual": false
 },
 {
  "name": "loom",
  "title": "織布機",
  "family": "craft",
  "light": false,
  "couple": false,
  "idea": "織布機的經緯線，梭子在拍點穿過，織出的布紋逐列出現留言的字。",
  "bilingual": true
 },
 {
  "name": "stainedglass",
  "title": "彩繪玻璃",
  "family": "craft",
  "light": false,
  "couple": false,
  "idea": "教堂彩繪玻璃窗（鉛條線），光從後面透過來一片片亮起，中央的玻璃片寫著留言。",
  "bilingual": false
 },
 {
  "name": "letterpress",
  "title": "活版印刷",
  "family": "craft",
  "light": true,
  "couple": false,
  "idea": "鉛字排版在字盤（反字），壓印在小節線，紙上印出留言（壓痕、油墨不均）。",
  "bilingual": true
 },
 {
  "name": "sand",
  "title": "沙畫",
  "family": "craft",
  "light": false,
  "couple": false,
  "idea": "燈箱上的沙畫：手撥沙在拍點畫出線條與字，一抹就變下一幅，留言與歌詞交替。",
  "bilingual": true
 },
 {
  "name": "chalkboard",
  "title": "黑板",
  "family": "craft",
  "light": false,
  "couple": false,
  "idea": "教室黑板，粉筆逐字寫出歌詞（粉筆質感），留言寫在角落「值日生」的位置，板擦在小節線擦掉。",
  "bilingual": true
 },
 {
  "name": "darkroom",
  "title": "暗房顯影",
  "family": "craft",
  "light": false,
  "couple": false,
  "idea": "紅色安全燈下，相紙泡在顯影液裡，影像慢慢浮現——浮現的是手繪線稿與留言（不是照片）。",
  "bilingual": false
 },
 {
  "name": "filmstrip",
  "title": "底片",
  "family": "craft",
  "light": false,
  "couple": false,
  "idea": "一條底片橫向捲過（齒孔、格號），每一格是一個字或一句歌詞，主打格子停下來放大是留言。",
  "bilingual": false
 },
 {
  "name": "tree",
  "title": "愛情樹",
  "family": "nature",
  "light": true,
  "couple": false,
  "idea": "一棵樹從地面長出來（分枝在拍點），葉子是留言（許願樹），歌詞刻在樹幹上。",
  "bilingual": true
 },
 {
  "name": "flowers",
  "title": "花開",
  "family": "nature",
  "light": true,
  "couple": false,
  "idea": "一排花在拍點綻放（版畫線條），每朵花心一個字，留言在花盆的標籤上。",
  "bilingual": true
 },
 {
  "name": "dandelion",
  "title": "蒲公英",
  "family": "nature",
  "light": false,
  "couple": false,
  "idea": "一朵蒲公英被吹散（小節線），種子帶著字飄過畫面，組成留言。",
  "bilingual": false
 },
 {
  "name": "vines",
  "title": "藤蔓",
  "family": "nature",
  "light": true,
  "couple": false,
  "idea": "藤蔓沿著看不見的字形長出來，長成留言的字，葉子在拍點展開。",
  "bilingual": false
 },
 {
  "name": "fogwindow",
  "title": "起霧的窗",
  "family": "nature",
  "light": false,
  "couple": false,
  "idea": "雨夜起霧的玻璃窗，手指在霧上寫出留言，水珠在拍點滑落，窗外的城市燈光模糊。",
  "bilingual": true
 },
 {
  "name": "snowglobe",
  "title": "雪花球",
  "family": "nature",
  "light": false,
  "couple": false,
  "idea": "雪花球在小節線被搖一下，雪花落下來，球裡的小場景（兩人的線稿）與底座的銘牌（留言）。",
  "bilingual": true
 },
 {
  "name": "aquarium",
  "title": "水族箱",
  "family": "nature",
  "light": false,
  "couple": false,
  "idea": "水族箱，魚群游動排成字（歌詞），氣泡在拍點冒，主打留言是水族箱的解說牌。",
  "bilingual": true
 },
 {
  "name": "skyline",
  "title": "天際線",
  "family": "city",
  "light": false,
  "couple": false,
  "idea": "城市天際線，大樓的窗戶在拍點一格格亮燈，拼出留言的字（窗戶當像素）。",
  "bilingual": true
 },
 {
  "name": "roadsign",
  "title": "高速公路路牌",
  "family": "city",
  "light": false,
  "couple": false,
  "idea": "綠色路牌從遠方迎面而來（在拍點掠過）：「幸福 2 km」「永遠 出口」，留言是一面大路牌。",
  "bilingual": true
 },
 {
  "name": "metro",
  "title": "捷運路線圖",
  "family": "city",
  "light": true,
  "couple": false,
  "idea": "捷運路線圖：兩條線（兩人）在一站交會，列車點在拍點前進一站，站名是歌詞，轉乘站是留言。",
  "bilingual": true
 },
 {
  "name": "domino",
  "title": "骨牌",
  "family": "game",
  "light": true,
  "couple": false,
  "idea": "一長串骨牌在拍點一張張倒下，倒下的骨牌背面是字，最後排成留言。",
  "bilingual": false
 },
 {
  "name": "maze",
  "title": "迷宮",
  "family": "game",
  "light": true,
  "couple": false,
  "idea": "迷宮裡兩個點（兩人）在拍點各走一步，最後在中央相遇，路徑上標著歌詞，中央是留言。",
  "bilingual": true
 },
 {
  "name": "puzzle",
  "title": "拼圖",
  "family": "game",
  "light": false,
  "couple": false,
  "idea": "拼圖片在拍點一片片飛進來拼好，拼好的圖案是留言（與手繪花紋）。",
  "bilingual": true
 },
 {
  "name": "chess",
  "title": "西洋棋",
  "family": "game",
  "light": false,
  "couple": false,
  "idea": "棋盤俯視，國王與皇后兩顆棋子一拍一步走到一起，被吃掉的棋子旁邊寫著留言；棋譜是歌詞。",
  "bilingual": false
 },
 {
  "name": "mahjong",
  "title": "麻將",
  "family": "game",
  "light": true,
  "couple": false,
  "idea": "麻將桌：牌在拍點翻開，牌面是字（留言），最後「胡了」大字；歌詞在計分的籌碼上。",
  "bilingual": true
 },
 {
  "name": "cards",
  "title": "撲克牌",
  "family": "game",
  "light": false,
  "couple": false,
  "idea": "紅心 K 與紅心 Q 從牌堆翻出來，洗牌、發牌在拍點，牌面上寫留言。",
  "bilingual": true
 },
 {
  "name": "fortune",
  "title": "求籤",
  "family": "game",
  "light": true,
  "couple": false,
  "idea": "籤筒搖一搖（拍點），掉出一支籤，籤詩紙展開：「上上籤」、籤詩是留言、解曰是歌詞。",
  "bilingual": true
 },
 {
  "name": "firecracker",
  "title": "鞭炮",
  "family": "game",
  "light": false,
  "couple": false,
  "idea": "一長串鞭炮從上往下在拍點一顆顆炸開（紅紙屑、火光），炸完露出掛在後面的留言。",
  "bilingual": true
 },
 {
  "name": "countdown",
  "title": "倒數",
  "family": "game",
  "light": false,
  "couple": false,
  "idea": "巨大的倒數數字（到下一個段落），每拍一個，歸零時爆出留言；歌詞在數字之間。",
  "bilingual": true
 },
 {
  "name": "compass",
  "title": "羅盤",
  "family": "science",
  "light": true,
  "couple": false,
  "idea": "航海羅盤（版畫刻度），指針在拍點擺動、最後穩穩指向「幸福」方位，方位字是歌詞，羅盤蓋內側刻著留言。",
  "bilingual": true
 },
 {
  "name": "thermometer",
  "title": "溫度計",
  "family": "science",
  "light": true,
  "couple": false,
  "idea": "老式水銀溫度計，紅柱（訊號色）跟著能量升降，刻度旁的標註是歌詞，爆表時頂端彈出留言。",
  "bilingual": true
 },
 {
  "name": "campfire",
  "title": "營火",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "一堆營火（沒有人），火舌跟著能量、火星在小鼓往上噴，飄到半空組成留言的字；木頭的年輪刻著歌詞。",
  "bilingual": true
 },
 {
  "name": "candles",
  "title": "燭光",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "一排蠟燭在拍點一根根點亮（仙女棒點火），燭光照亮的桌布上是留言，燭焰在 hi-hat 搖。慢歌。",
  "bilingual": true
 },
 {
  "name": "chandelier",
  "title": "水晶吊燈",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "由下往上看的水晶吊燈，水晶在拍點互撞閃光（折射的小光斑），每串水晶墜著一個字。",
  "bilingual": true
 },
 {
  "name": "lighthouse",
  "title": "燈塔",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "夜海燈塔，光束一小節掃一圈，掃過霧時霧裡浮出留言；遠方的船燈是歌詞。",
  "bilingual": true
 },
 {
  "name": "moon",
  "title": "月相",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "一排月相（新月到滿月）每小節前進一相，滿月時月面浮出留言；歌詞沿著月亮的軌道弧線。",
  "bilingual": true
 },
 {
  "name": "sunrise",
  "title": "日出",
  "family": "light",
  "light": true,
  "couple": false,
  "idea": "地平線、太陽緩緩升起，光芒一條條在拍點射出，每條光芒上是一段歌詞，天空的雲寫著留言。",
  "bilingual": true
 },
 {
  "name": "ocean",
  "title": "海浪版畫",
  "family": "water",
  "light": true,
  "couple": false,
  "idea": "木刻版畫風的層層海浪（原創，不抄名畫），浪頭在大鼓捲起，浪花的泡沫排成留言，海平線寫歌詞。",
  "bilingual": true
 },
 {
  "name": "puddle",
  "title": "水窪漣漪",
  "family": "water",
  "light": false,
  "couple": false,
  "idea": "俯視的水窪，雨滴在拍點落下激起同心漣漪，漣漪擴散處浮出字；倒影裡是城市燈光與留言。",
  "bilingual": false
 },
 {
  "name": "sailboat",
  "title": "帆船",
  "family": "water",
  "light": true,
  "couple": false,
  "idea": "一艘帆船在海上（線條、捲動的浪），帆被風吹鼓在小節線，帆面上是留言，旗子是歌詞。",
  "bilingual": true
 },
 {
  "name": "bridge",
  "title": "鵲橋",
  "family": "water",
  "light": false,
  "couple": false,
  "idea": "銀河兩岸的兩顆星（牛郎織女的意象），喜鵲在拍點一隻隻飛來搭成橋，橋上寫著留言。",
  "bilingual": true
 },
 {
  "name": "bubbles",
  "title": "肥皂泡",
  "family": "water",
  "light": true,
  "couple": false,
  "idea": "肥皂泡泡從左下吹出（小鼓一串），每個泡泡的薄膜彩虹反光裡有一個字，破掉時字落下排成留言。",
  "bilingual": true
 },
 {
  "name": "ink",
  "title": "水墨暈染",
  "family": "print",
  "light": true,
  "couple": false,
  "idea": "墨滴落進水（宣紙）在拍點暈開，暈開的墨形成字（留言），淡墨寫歌詞。",
  "bilingual": false
 },
 {
  "name": "watercolor",
  "title": "水彩",
  "family": "print",
  "light": true,
  "couple": false,
  "idea": "水彩筆刷在紙上刷過（顏料暈染、邊緣積色），刷過的地方顯出留言；歌詞是鉛筆字。",
  "bilingual": false
 },
 {
  "name": "poster",
  "title": "網版海報",
  "family": "print",
  "light": true,
  "couple": false,
  "idea": "演唱會網版印刷海報：兩三色套印、網點、套色偏移在拍點跳一下，大標是歌詞、小字是留言。",
  "bilingual": false
 },
 {
  "name": "magazine",
  "title": "雜誌封面",
  "family": "print",
  "light": true,
  "couple": false,
  "idea": "雜誌封面排版：刊名、大標題（留言）、側欄標題（歌詞）、條碼、期號；在小節線換一期。",
  "bilingual": false
 },
 {
  "name": "bookshelf",
  "title": "書架",
  "family": "print",
  "light": false,
  "couple": false,
  "idea": "一整排書的書背，書在拍點被抽出來一點，書背上印的是留言與歌詞，主打那本被抽出來翻開。",
  "bilingual": false
 },
 {
  "name": "polaroid",
  "title": "拍立得",
  "family": "print",
  "light": true,
  "couple": false,
  "idea": "拍立得相片從相機吐出、慢慢顯影——顯影出的是手繪線條小插畫（不是照片），白邊上手寫留言。",
  "bilingual": true
 },
 {
  "name": "rings",
  "title": "對戒",
  "family": "keepsake",
  "light": false,
  "couple": false,
  "idea": "兩只戒指的版畫特寫慢慢轉、在小節線扣在一起，戒圈內側刻著留言（沿著圓弧），反光掃過。",
  "bilingual": true
 },
 {
  "name": "vows",
  "title": "誓詞",
  "family": "keepsake",
  "light": true,
  "couple": false,
  "idea": "典雅的誓詞排版（Cormorant／思源宋體），歌詞像誓詞逐句浮現，賓客留言是「見證人」欄。",
  "bilingual": true
 },
 {
  "name": "gift",
  "title": "禮物盒",
  "family": "keepsake",
  "light": true,
  "couple": false,
  "idea": "禮物盒的緞帶在拍點一圈圈解開、盒蓋在小節線掀開，裡面的卡片是留言。",
  "bilingual": true
 },
 {
  "name": "ribbon",
  "title": "緞帶",
  "family": "keepsake",
  "light": false,
  "couple": false,
  "idea": "一條長緞帶在畫面中飄、翻面（正反面色差），緞帶上印著歌詞，打成蝴蝶結時結上的吊牌是留言。",
  "bilingual": false
 },
 {
  "name": "matches",
  "title": "火柴",
  "family": "keepsake",
  "light": false,
  "couple": false,
  "idea": "火柴盒、一根火柴在小節線擦亮（火光會發光），火光照亮的黑暗裡看得到留言，燒完換下一根。",
  "bilingual": true
 },
 {
  "name": "winelabel",
  "title": "酒標",
  "family": "keepsake",
  "light": true,
  "couple": false,
  "idea": "葡萄酒酒標：酒莊名、年份（婚禮年份）、產區，品飲筆記是留言，歌詞是酒標下緣的小字。",
  "bilingual": true
 },
 {
  "name": "piano",
  "title": "鋼琴鍵盤",
  "family": "instrument",
  "light": false,
  "couple": false,
  "idea": "俯視鋼琴鍵盤（沒有人），琴鍵在拍點按下亮起（用真的節拍與音高近似），譜架上是歌詞與留言。",
  "bilingual": false
 },
 {
  "name": "drumkit",
  "title": "鼓組",
  "family": "instrument",
  "light": false,
  "couple": false,
  "idea": "正面的鼓組，大鼓／小鼓／銅鈸真的在鼓點被敲（皮面震動、銅鈸晃），大鼓皮上印著留言。",
  "bilingual": false
 },
 {
  "name": "mirrorball",
  "title": "鏡球",
  "family": "instrument",
  "light": false,
  "couple": false,
  "idea": "鏡球（細線多面體）在轉，反射的光點掃過牆面，光點停下時拼出留言。副歌、快歌。",
  "bilingual": false
 },
 {
  "name": "carousel",
  "title": "旋轉木馬",
  "family": "instrument",
  "light": false,
  "couple": false,
  "idea": "旋轉木馬（沒有人）跟著拍點上下、轉動，頂棚邊緣的燈泡字是歌詞，木馬的名牌是留言。",
  "bilingual": false
 },
 {
  "name": "balloon",
  "title": "熱氣球",
  "family": "instrument",
  "light": true,
  "couple": false,
  "idea": "一群熱氣球緩緩升空（捲動），主打那顆的球皮條紋上寫著留言，其他的寫歌詞。",
  "bilingual": false
 },
 {
  "name": "confetti",
  "title": "花瓣雨",
  "family": "instrument",
  "light": false,
  "couple": false,
  "idea": "花瓣（點綴色）在拍點從上方灑下，落地時排成留言的字，下一陣風吹散換歌詞。",
  "bilingual": false
 },
 {
  "name": "tea",
  "title": "奉茶",
  "family": "local",
  "light": true,
  "couple": false,
  "idea": "茶杯與茶壺（線條），倒茶在小節線，茶葉在杯中旋轉沉底排成字；杯墊上是留言。",
  "bilingual": false
 },
 {
  "name": "bubbletea",
  "title": "珍珠奶茶",
  "family": "local",
  "light": true,
  "couple": false,
  "idea": "一杯珍奶的特寫，珍珠在拍點沉浮，吸管吸上來的珍珠一顆顆變成留言的字，杯套印著歌詞。",
  "bilingual": false
 },
 {
  "name": "baking",
  "title": "烤蛋糕",
  "family": "local",
  "light": true,
  "couple": false,
  "idea": "烤箱窗裡的蛋糕慢慢膨起，計時器在拍點跳，出爐後擠花袋在蛋糕上寫出留言。",
  "bilingual": false
 },
 {
  "name": "festival",
  "title": "廟會燈籠",
  "family": "local",
  "light": false,
  "couple": false,
  "idea": "一串串紅燈籠（訊號色）在拍點依序亮起，燈籠上是一個個字（留言），下面的攤位招牌是歌詞。",
  "bilingual": false
 },
 {
  "name": "trivision",
  "title": "三面翻看板",
  "family": "local",
  "light": false,
  "couple": false,
  "idea": "路邊的三面翻廣告看板，三角柱在拍點一起翻轉，翻出歌詞、再翻出留言。",
  "bilingual": false
 },
 {
  "name": "vending",
  "title": "販賣機",
  "family": "local",
  "light": false,
  "couple": false,
  "idea": "販賣機的一格格商品，按鈕在拍點亮起，掉出來的飲料罐上是留言，價格標籤是歌詞。",
  "bilingual": false
 },
 {
  "name": "train",
  "title": "火車窗景",
  "family": "journey",
  "light": false,
  "couple": false,
  "idea": "車窗框住的夜景往後流（電線桿在拍點經過），窗上的霧氣寫著留言，窗外遠方的招牌是歌詞。",
  "bilingual": true
 },
 {
  "name": "topo",
  "title": "等高線地圖",
  "family": "journey",
  "light": true,
  "couple": false,
  "idea": "等高線地形圖，一條路線在拍點往山頂延伸，沿途的地名是歌詞，山頂的旗子是留言。",
  "bilingual": true
 },
 {
  "name": "bowling",
  "title": "保齡球道",
  "family": "journey",
  "light": false,
  "couple": false,
  "idea": "球道透視，球滾向球瓶（沒有人），全倒在小節線，倒下的球瓶露出留言；計分螢幕寫歌詞。",
  "bilingual": true
 },
 {
  "name": "lavalamp",
  "title": "熔岩燈",
  "family": "journey",
  "light": false,
  "couple": false,
  "idea": "熔岩燈裡的蠟塊（metaball shader）跟著低音浮沉，融合時浮出字，底座貼著留言。",
  "bilingual": true
 },
 {
  "name": "stamp",
  "title": "郵票",
  "family": "journey",
  "light": true,
  "couple": false,
  "idea": "一大張郵票（齒孔、面值、版畫圖案），郵戳在拍點蓋下，郵票上的文字是留言，邊紙是歌詞。",
  "bilingual": true
 },
 {
  "name": "clocktower",
  "title": "鐘樓",
  "family": "journey",
  "light": false,
  "couple": false,
  "idea": "古老的鐘面特寫，指針在拍點跳一格，整點（小節線）鐘聲的圓環擴散，鐘面數字換成歌詞的字，鐘下的銘板是留言。",
  "bilingual": false
 },
 {
  "name": "subtitles",
  "title": "老電影雙語字幕",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "老電影院的銀幕在放黑白愛情片（剪影、底片刮痕、放映機光束），銀幕下緣是雙語字幕：中文大、原文小，照歌聲逐字亮；留言是片頭的標題卡，每小節畫面換一個鏡頭。",
  "bilingual": true
 },
 {
  "name": "kvariety",
  "title": "綜藝花字",
  "family": "screen",
  "light": true,
  "couple": false,
  "idea": "綜藝節目畫面：彩色大花字（中文）配小字原文，在拍點「砰」地彈出、晃動、加效果線與音效字；留言是節目角落的觀眾來信字卡。",
  "bilingual": true
 },
 {
  "name": "webtoon",
  "title": "條漫",
  "family": "screen",
  "light": true,
  "couple": false,
  "idea": "直向捲動的條漫，一格一格往上捲（一拍一格），對話框裡中文大、原文小；留言是最新一話的作者的話。",
  "bilingual": true
 },
 {
  "name": "teleprompter",
  "title": "提詞機",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "攝影機前的提詞機玻璃，反射出兩行字幕往上捲（中文、原文），唱到的那行亮；留言是講台上的講稿。",
  "bilingual": true
 },
 {
  "name": "dubbing",
  "title": "配音室",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "錄音室的配音螢幕：畫面上跑雙語字幕與提示條（倒數條在拍點滑到字），下面兩條聲音波形（原文一條、中文一條）；留言貼在麥克風旁的劇本上。",
  "bilingual": true
 },
 {
  "name": "projector",
  "title": "幻燈機",
  "family": "screen",
  "light": false,
  "couple": false,
  "idea": "老式轉盤幻燈機在牆上投影，每小節「喀」一聲換一張幻燈片（畫面是抽象的風景插畫），片上印雙語字幕；留言寫在幻燈片盒的標籤上。",
  "bilingual": true
 },
 {
  "name": "dictionary",
  "title": "雙語字典",
  "family": "print",
  "light": true,
  "couple": false,
  "idea": "翻開的厚字典，詞條排版（詞頭、音標、釋義）：歌詞就是例句，原文例句＋中文翻譯；紅筆在唱到的字下畫線；留言是頁邊的手寫註記。",
  "bilingual": true
 },
 {
  "name": "flashcards",
  "title": "單字卡",
  "family": "print",
  "light": true,
  "couple": false,
  "idea": "一疊用鐵環串起來的單字卡：正面原文、在拍點翻面露出中文（兩面輪流），翻過的卡片疊在一旁；留言寫在最上面一張大卡。",
  "bilingual": true
 },
 {
  "name": "phrasebook",
  "title": "旅遊會話手冊",
  "family": "print",
  "light": true,
  "couple": false,
  "idea": "攤開的旅遊會話小冊子（插圖、分類色塊、便利貼），每句歌詞是一條「原文／中文」會話，用螢光筆在拍點劃過；留言是夾在書裡的車票背面。",
  "bilingual": true
 },
 {
  "name": "lyricbook",
  "title": "專輯歌詞本",
  "family": "print",
  "light": false,
  "couple": false,
  "idea": "CD 內頁的歌詞本攤在桌上，左頁原文、右頁中文，唱到的那行被燈照亮；留言寫在「Thanks to」那一頁。",
  "bilingual": true
 },
 {
  "name": "twoletters",
  "title": "情書與譯本",
  "family": "print",
  "light": true,
  "couple": false,
  "idea": "兩封信並排：左邊原文信、右邊中文譯本，鋼筆同時在兩張紙上寫（一拍一字），譯本上有鉛筆的修改痕跡；留言是信封上的附言。",
  "bilingual": true
 },
 {
  "name": "couplets",
  "title": "雙語對聯",
  "family": "print",
  "light": false,
  "couple": false,
  "idea": "紅紙對聯（燙金字）掛在門兩邊，上聯中文、下聯原文，橫批是留言；燈籠在拍點晃，墨一字一字寫上去。",
  "bilingual": true
 },
 {
  "name": "streetsign",
  "title": "雙語路牌",
  "family": "city",
  "light": true,
  "couple": false,
  "idea": "街角的雙語路牌與指標柱（中文大、原文小），每小節一塊新的路牌翻下來；遠處車流與行道樹視差；留言是公車站的燈箱廣告。",
  "bilingual": true
 },
 {
  "name": "neonalley",
  "title": "巷弄直式霓虹",
  "family": "city",
  "light": false,
  "couple": false,
  "idea": "夜晚小巷一整排直式霓虹招牌（中文招牌、旁邊原文小招牌），唱到的字點亮、閃一下；濕地面倒影；留言是最亮的那塊招牌。",
  "bilingual": true
 },
 {
  "name": "busstop",
  "title": "公車到站顯示",
  "family": "city",
  "light": false,
  "couple": false,
  "idea": "公車站的 LED 到站看板：中文一行、原文一行輪流跑馬（兩行同時在），公車在小節線進站、車燈掃過；留言貼在站牌的時刻表上。",
  "bilingual": true
 },
 {
  "name": "trainlcd",
  "title": "車廂顯示器",
  "family": "city",
  "light": true,
  "couple": false,
  "idea": "列車車門上方的寬螢幕：左邊路線圖（站點照拍子一站站亮）、右邊雙語「下一站」大字是歌詞；窗外景色往後捲；留言在車廂廣告框。",
  "bilingual": true
 },
 {
  "name": "menuwall",
  "title": "小館木牌菜單",
  "family": "city",
  "light": true,
  "couple": false,
  "idea": "小餐館牆上一整排木牌菜單（中文大、原文小），唱到一句就「喀」地掛上一塊新木牌；湯鍋冒煙；留言寫在點菜單上。",
  "bilingual": true
 },
 {
  "name": "billboard",
  "title": "大樓 LED 牆",
  "family": "city",
  "light": false,
  "couple": false,
  "idea": "夜晚十字路口大樓的 LED 廣告牆（曲面、像素格），雙語歌詞是牆上的大字，路人剪影抬頭看；留言是旁邊較小的直式看板。",
  "bilingual": true
 },
 {
  "name": "interpreter",
  "title": "同步口譯廂",
  "family": "lingo",
  "light": false,
  "couple": false,
  "idea": "口譯廂的玻璃窗與耳機、麥克風燈（唱時亮紅），桌上螢幕上面原文、下面中文同步出現，兩條音量表跳動；留言寫在廂外的會議名牌。",
  "bilingual": true
 },
 {
  "name": "translator",
  "title": "翻譯機",
  "family": "lingo",
  "light": true,
  "couple": false,
  "idea": "手持翻譯機特寫：上半原文、下半中文，說話時聲波跳動、拍點時轉換箭頭轉一圈；留言存在翻譯機的「收藏句子」清單。",
  "bilingual": true
 },
 {
  "name": "keyboard",
  "title": "雙語鍵盤",
  "family": "lingo",
  "light": false,
  "couple": false,
  "idea": "背光機械鍵盤（鍵帽印兩種字母），唱一個字就按下一顆鍵、背光一閃，上方螢幕同時打出中文與原文；留言在螢幕邊的便利貼。",
  "bilingual": true
 },
 {
  "name": "rosetta",
  "title": "雙文石碑",
  "family": "lingo",
  "light": false,
  "couple": false,
  "idea": "博物館裡的石碑，刻著兩種文字（上中文下原文），聚光燈一行一行掃過、刻痕亮起；留言是展櫃的說明牌。",
  "bilingual": true
 },
 {
  "name": "hangulblocks",
  "title": "字母積木",
  "family": "lingo",
  "light": true,
  "couple": false,
  "idea": "木頭字母積木一塊一塊在拍點疊上去，拼出原文，旁邊一排中文積木；積木倒下再重疊；留言寫在積木盒蓋上。",
  "bilingual": true
 },
 {
  "name": "wordtiles",
  "title": "拼字盤",
  "family": "lingo",
  "light": true,
  "couple": false,
  "idea": "拼字遊戲盤（格子、分數格），字母方塊在拍點滑進格子拼出原文，下一排拼中文；計分板是留言。不仿任何品牌的樣式。",
  "bilingual": true
 },
 {
  "name": "stringlights",
  "title": "燈泡字",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "兩串燈泡拼成的字：上串中文、下串原文，照拍子一顆顆點亮、唱到的字閃一下；留言是掛在燈串中間的木牌。",
  "bilingual": true
 },
 {
  "name": "povfan",
  "title": "旋轉 LED 扇",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "旋轉的 LED 扇葉（視覺暫留）在空中畫出兩行字，扇葉的殘影與光點跟著拍子；留言是扇座下的貼紙。",
  "bilingual": true
 },
 {
  "name": "skywriting",
  "title": "飛機拉煙寫字",
  "family": "light",
  "light": true,
  "couple": false,
  "idea": "藍天裡兩架小飛機拉白煙寫字：大飛機寫中文、小飛機在下面寫原文，煙慢慢被風吹散；留言是地面上的布條。",
  "bilingual": true
 },
 {
  "name": "fireflies",
  "title": "螢火蟲排字",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "夏夜草地的螢火蟲飛成字（中文大、原文小），在拍點一起閃，唱過的字散開飛走；留言寫在涼亭的木牌。",
  "bilingual": true
 },
 {
  "name": "riverlanterns",
  "title": "河燈",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "夜晚河面上一盞盞紙河燈順流漂過，每盞燈上寫一個字（中文一排、原文一排），倒影搖晃；留言寫在最大的那盞燈上。",
  "bilingual": true
 },
 {
  "name": "lasershow",
  "title": "雷射秀",
  "family": "light",
  "light": false,
  "couple": false,
  "idea": "煙霧裡的雷射光束在牆上畫出兩行字（像雷射投影），光束在拍點掃動、換顏色；留言是舞台邊的 LED 條。",
  "bilingual": true
 },
 {
  "name": "seoultrip",
  "title": "老街散步",
  "family": "trip",
  "light": true,
  "couple": true,
  "idea": "兩人在石牆老屋的小巷散步拍照（孟庭拿相機、宣文比 YA），兩旁是雙語路牌與店招（歌詞）；拍照閃光在小節線；留言寫在明信片上。",
  "bilingual": true
 },
 {
  "name": "hanriver",
  "title": "河濱夜野餐",
  "family": "trip",
  "light": false,
  "couple": true,
  "idea": "河濱公園夜晚，兩人坐在野餐墊吃炸雞、看對岸的橋燈（燈在拍點換色），三隻狗在旁邊搶炸雞；歌詞是橋上的燈字；留言是外送單。",
  "bilingual": true
 },
 {
  "name": "subwayride",
  "title": "搭地鐵",
  "family": "trip",
  "light": true,
  "couple": true,
  "idea": "地鐵車廂裡兩人拉著吊環搖晃（照拍子），孟庭靠在宣文肩上；車廂螢幕是雙語到站資訊（歌詞）；留言是車廂廣告框。",
  "bilingual": true
 },
 {
  "name": "lovelocks",
  "title": "愛情鎖",
  "family": "trip",
  "light": false,
  "couple": true,
  "idea": "山頂觀景台的欄杆掛滿愛情鎖，兩人一起把寫著兩人名字的鎖扣上（小節線「喀」），遠處城市夜景；鎖上的吊牌是歌詞；留言是新掛上的那把鎖。不畫真實地標。",
  "bilingual": true
 },
 {
  "name": "kpopdance",
  "title": "練舞室",
  "family": "kculture",
  "light": true,
  "couple": true,
  "idea": "鏡牆練舞室，兩人跟著節奏跳（每拍一個動作，照鏡子有鏡像），鏡子上貼著雙語歌詞紙；三隻狗在角落跟著點頭；留言是鏡子上的便利貼。",
  "bilingual": true
 },
 {
  "name": "hanbok",
  "title": "穿韓服",
  "family": "kculture",
  "light": true,
  "couple": true,
  "idea": "兩人穿韓服在古宮殿的迴廊前拍照（不畫真實地標），孟庭轉圈讓裙擺飛起、宣文替她撐傘；屋簷下的木匾是雙語歌詞；留言寫在紙扇上。",
  "bilingual": true
 },
 {
  "name": "langcards",
  "title": "互考單字",
  "family": "date",
  "light": true,
  "couple": true,
  "idea": "咖啡廳裡兩人用單字卡互考：孟庭舉卡（原文），宣文搶答（中文），答對擊掌、答錯被彈額頭；卡片上的字是歌詞；留言寫在桌上的筆記本。",
  "bilingual": true
 },
 {
  "name": "dogswim",
  "title": "狗狗游泳",
  "family": "dog",
  "light": true,
  "couple": true,
  "idea": "狗狗游泳池，三隻狗在水裡划水（元元游最快、芃芃套著游泳圈），兩人在池邊丟玩具、拿毛巾等；泳池邊的雙語告示牌是歌詞；留言寫在救生圈上。",
  "bilingual": true
 }
];
