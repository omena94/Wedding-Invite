// 紙偶動畫的角色姿勢圖清單：把 src/wall/sprites/<組名>.json 全部合起來（對外的 SPRITES 跟以前一樣，版面不用改）。
// 每一組的清單由 `node scripts/wall-sprites.mjs <組名>` 產生、一組一個檔、不要手改：好幾個人同時做不同組的紙偶，
// 各自只會寫自己那一組的檔，不會互相蓋掉。圖在 public/wall-sprites/<組名>/<圖名>.webp，版面用 scenes/_puppet.ts 播放。
// 清單只有尺寸與錨點（很小），會跟著程式一起載入；圖本身要等版面在 init() 裡 loadPuppets() 才下載。
//
// 每張圖：kind：person（單人）、couple（兩人一起）、dog；w × h：圖的大小（px）；ax, ay：腳底錨點（圖上的 px，ay 可以超出圖外——騰空的姿勢）；
// ref：參考身高（圖上的 px；人是站直的身高、狗是站著到耳尖）；height：身高是宣文的幾倍（沒寫就照檔名前兩個字，見 _puppet.ts 的 PUPPET_H）；
// pts：道具點 [x, y, 半徑?]（圖上的 px，照原圖的方向）；mirror：這張圖畫成朝左，播放時自動翻成朝右（sprites.json 的 "mirror"）；
// group：在哪一組（圖的網址 /wall-sprites/<group>/<圖名>.webp）。
export type SpriteKind = 'person' | 'couple' | 'dog';
export interface SpriteInfo { kind: SpriteKind; w: number; h: number; ax: number; ay: number; ref: number; height?: number; pts?: Record<string, number[]>; mirror?: boolean; group: string }

interface GroupList { group: string; series: Record<string, unknown>; sprites: Record<string, Omit<SpriteInfo, 'group'>> }

const lists = import.meta.glob<GroupList>('./sprites/*.json', { eager: true, import: 'default' });

export const SPRITES: Record<string, SpriteInfo> = {};
for (const path of Object.keys(lists).sort()) {
  const l = lists[path]!;
  for (const [name, s] of Object.entries(l.sprites)) {
    // 管線寫檔前會檢查圖名跨組不重複；手動搬檔弄錯時在這裡提醒（後面的組蓋掉前面的）
    if (SPRITES[name]) console.warn(`紙偶的圖名重複：${name}（${SPRITES[name]!.group} 與 ${l.group}），用 ${l.group} 的`);
    SPRITES[name] = { ...s, group: l.group };
  }
}
