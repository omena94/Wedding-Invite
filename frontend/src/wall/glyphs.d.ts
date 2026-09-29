// vite.config.js 的 wallGlyphs()：打包時從 scenes/*.ts 掃出來的中文字（版面寫死的標題、標籤），開機時先載字型用。
declare module 'virtual:wall-glyphs' {
  /** 共用輔助檔（_xxx.ts）裡的字。 */
  export const SHARED: string;
  /** 每個版面（連同它的 -xxx.ts 輔助檔）用到的字。 */
  export const SCENES: Record<string, string>;
}
