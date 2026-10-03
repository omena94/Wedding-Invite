// 照片池：新人在後台選了「大螢幕放照片」時，要上螢幕的照片與註解。
// 導演排到照片窗格時跟這裡拿下一張（照後台的順序：相簿 → 相簿內的排序，繞圈播），版面在 init() 裡解碼、做成貼圖。
// 會場網路不穩：開機後在背景把整批照片（大螢幕用的尺寸，長邊約 2048）下載好放在記憶體，還沒下載好的先跳過，
// 網路斷了照樣有照片可以播。解碼後的圖很大（一張 10 MB 上下），只留最近幾張，其他要用時再解。
import { loadText } from './engine/type';
import type { PhotoKind } from './engine/scene';

/** 解碼好的照片（方向已經照 EXIF 轉正）。 */
export interface PhotoImage { image: ImageBitmap | HTMLCanvasElement; w: number; h: number }

/** 照片窗格的照片（ctx.params.photo）。 */
export interface PhotoRef {
  id: number;
  /** 註解（新人在婚紗照頁寫的「說明」，已清理；可能是空字串，或後台關掉了註解）。 */
  caption: string;
  /** 相簿名（可能是空字串）：照順序播時，一本相簿就是一章。 */
  album: string;
  /** 這本相簿的第一張：版面可以把相簿名印大一點，當成章節開頭。 */
  chapter: boolean;
  /** 第幾張（1 起算）與總共幾張。 */
  n: number;
  total: number;
  /** 焦點（0..1，左上角是原點）：裁切、慢推慢搖都繞著它，才不會把臉裁掉。新人在婚紗照頁點的；沒設定時是 (0.5, 0.4)。 */
  fx: number;
  fy: number;
  /** 原圖的長寬（EXIF 轉正後；0 = 不知道）。實際貼圖的大小以 load() 拿到的為準（大螢幕用的版本長邊最多 2048）。 */
  w: number;
  h: number;
  /** 這是哪種照片（橫、直、方、很小）：導演挑版面用，版面也可以拿來決定擺法。 */
  kinds: PhotoKind[];
  /** 平均亮度（0..1，看起來的亮度；null = 不知道）與平均色調（#rrggbb；空字串 = 不知道）：版面可以讓光、背景跟著照片調。 */
  lum: number | null;
  tone: string;
  /**
   * 解碼好的圖：版面在 init() 裡 await，自己做成貼圖（`this.track(texture)`，窗格結束時釋放）。
   * 圖本身由照片池管，版面不要 close() 它。
   */
  load(): Promise<PhotoImage>;
}

export interface PhotoRow { id: number; caption: string; album: string; fx?: number | null; fy?: number | null; w?: number; h?: number; lum?: number | null; tone?: string }

/** 很小的舊照片：長邊不到這個數字（掃描的成長照、早期的手機照）。滿版會糊，版面要放小一點。 */
export const SMALL_PHOTO = 1200;

/** 照長寬比與解析度分種類（不知道長寬就是空的）。 */
export function photoKinds(w = 0, h = 0): PhotoKind[] {
  if (!w || !h) return [];
  const r = w / h;
  const out: PhotoKind[] = [r > 1.15 ? 'landscape' : r < 0.87 ? 'portrait' : 'square'];
  if (Math.max(w, h) < SMALL_PHOTO) out.push('small');
  return out;
}

/** 導演挑版面時先看接下來的照片：還沒拿出來，只看種類與亮度。 */
export interface PhotoPeek { kinds: PhotoKind[]; lum: number | null }

/** 註解在大螢幕上要一眼讀完：空白收斂，太長的截斷（後台會先提醒新人）。 */
export const CAPTION_MAX = 60;
export function cleanCaption(s: string): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > CAPTION_MAX ? `${t.slice(0, CAPTION_MAX - 1)}…` : t;
}

const DECODED_KEEP = 4;

export class PhotoPool {
  private rows: PhotoRow[] = [];
  private blobs = new Map<number, Blob>();
  private decoded = new Map<number, Promise<PhotoImage>>();
  private cursor = 0;
  private loading = false;
  /** 註解要不要上螢幕（後台的開關）。 */
  captions = true;

  constructor(private fetchBlob: (id: number) => Promise<Blob>) {}

  get count() { return this.rows.length; }
  /** 已經下載好、可以上螢幕的張數。 */
  get ready() { let n = 0; for (const r of this.rows) if (this.blobs.has(r.id)) n++; return n; }

  /** 跟伺服器的清單同步（順序照後台）：不見的拿掉，新的在背景下載。 */
  async sync(rows: PhotoRow[]) {
    const ids = new Set(rows.map((r) => r.id));
    for (const id of [...this.blobs.keys()]) if (!ids.has(id)) this.blobs.delete(id);
    for (const id of [...this.decoded.keys()]) if (!ids.has(id)) this.decoded.delete(id);
    // 註解、相簿名的中文字型先載好，版面第一格才不會用備援字型
    await loadText(rows.map((r) => cleanCaption(r.caption) + r.album).join(''));
    const cur = this.rows[this.cursor % Math.max(1, this.rows.length)]?.id;
    this.rows = rows.slice();
    // 清單變了：從原本播到的那張接著播，不要從頭再來
    const i = cur === undefined ? -1 : this.rows.findIndex((r) => r.id === cur);
    this.cursor = i >= 0 ? i : 0;
    void this.download();
  }

  /** 一張一張下載（不要一次開幾十個連線，會場網路會塞住，留言反而進不來）。 */
  private async download() {
    if (this.loading) return;
    this.loading = true;
    try {
      for (let k = 0; k < this.rows.length; k++) {
        const r = this.rows[k]!;
        if (this.blobs.has(r.id)) continue;
        try { this.blobs.set(r.id, await this.fetchBlob(r.id)); }
        catch { /* 這張下次同步再試；其他張照樣下載 */ }
      }
    } finally { this.loading = false; }
  }

  private decode(id: number): Promise<PhotoImage> {
    const hit = this.decoded.get(id);
    if (hit) { this.decoded.delete(id); this.decoded.set(id, hit); return hit; }
    const blob = this.blobs.get(id);
    const p = blob
      ? createImageBitmap(blob).then((image) => ({ image, w: image.width, h: image.height }))
      : Promise.reject(new Error(`photo ${id} not downloaded`));
    this.decoded.set(id, p);
    p.catch(() => this.decoded.delete(id));
    while (this.decoded.size > DECODED_KEEP) this.decoded.delete(this.decoded.keys().next().value!);
    return p;
  }

  /** 接下來 n 張（跟 next() 一樣的順序，但不拿出來）：導演依照片種類挑版面。 */
  peek(n: number): PhotoPeek[] {
    const out: PhotoPeek[] = [];
    const len = this.rows.length;
    for (let k = 0; k < len && out.length < n; k++) {
      const r = this.rows[(this.cursor + k) % len]!;
      if (this.blobs.has(r.id)) out.push({ kinds: photoKinds(r.w, r.h), lum: r.lum ?? null });
    }
    return out;
  }

  /** 下一張（照順序繞圈，跳過還沒下載好的）；一張都還沒好就是 null。 */
  next(): PhotoRef | null {
    const n = this.rows.length;
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n;
      const r = this.rows[i]!;
      if (!this.blobs.has(r.id)) continue;
      this.cursor = i + 1;
      return {
        id: r.id, caption: this.captions ? cleanCaption(r.caption) : '', album: r.album || '',
        chapter: i === 0 || (this.rows[i - 1]!.album || '') !== (r.album || ''), n: i + 1, total: n,
        fx: r.fx ?? 0.5, fy: r.fy ?? 0.4, w: r.w ?? 0, h: r.h ?? 0, kinds: photoKinds(r.w, r.h), lum: r.lum ?? null, tone: r.tone ?? '',
        load: () => this.decode(r.id),
      };
    }
    return null;
  }
}
