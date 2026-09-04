// 上傳前在瀏覽器把照片縮到長邊 maxPx、轉成 JPEG。手機直接拍的 4000px 原圖會變成 1/5 大小，
// 上傳快、伺服器空間也省。非圖片或瀏覽器解不開的格式（HEIC）就原檔上傳。
const MAX_PX = 2000;
const QUALITY = 0.86;

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* 退回 <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}

export async function resizeImage(file, maxPx = MAX_PX) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  let bmp;
  try {
    bmp = await decode(file);
  } catch {
    return file;
  }
  const w = bmp.width || bmp.naturalWidth;
  const h = bmp.height || bmp.naturalHeight;
  const scale = Math.min(1, maxPx / Math.max(w, h));
  // 已經夠小又不大（< 1.5MB）就不重新壓縮，保留原檔
  if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  canvas.getContext("2d").drawImage(bmp, 0, 0, cw, ch);
  if (bmp.close) bmp.close();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", QUALITY));
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
}
