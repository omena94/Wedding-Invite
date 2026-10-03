// 開發模式與截圖用的假照片：用程式畫的風景（天空、太陽、山、光斑），不用任何真的照片、不畫人。
// 尺寸、方向故意各種都有：婚紗照（橫 3:2、直 2:3）、手機直拍（9:16）、很小的舊照片（掃描的成長照）、16:9。
// 註解也是長短都有、有空的、有英文的。截圖工具用 --photo N（1 起算）指定主打哪一張。
import { mulberry32 } from '../engine/util';
import { cleanCaption, photoKinds, type PhotoImage, type PhotoRef } from '../photos';

// lum、tone：正式站是後端在上傳時算的（平均亮度、平均色調）。假照片大多不給（測「沒有資料」的預設），只有第 7 張夜景給，測很暗的照片怎麼處理
interface DevPhoto { w: number; h: number; caption: string; album: string; fx: number; fy: number; sky: [string, string]; land: string; sun: string; lum?: number; tone?: string }

export const DEV_PHOTOS: DevPhoto[] = [
  { w: 2048, h: 1365, caption: '2019 年夏天，第一次一起去墾丁', album: '我們', fx: 0.62, fy: 0.42, sky: ['#f6c28b', '#7a8fb8'], land: '#3b4a5c', sun: '#fff1d6' },
  { w: 1365, h: 2048, caption: '拍婚紗那天，風好大', album: '婚紗', fx: 0.5, fy: 0.3, sky: ['#dfe8f0', '#9db4c8'], land: '#5d6b58', sun: '#ffffff' },
  { w: 1152, h: 2048, caption: '', album: '婚紗', fx: 0.5, fy: 0.35, sky: ['#f3d1dc', '#8f7aa8'], land: '#463a52', sun: '#fff4e8' },
  { w: 640, h: 480, caption: '小時候的全家福（阿公拍的）', album: '成長', fx: 0.5, fy: 0.45, sky: ['#e8d3a8', '#b49a72'], land: '#6e5a3e', sun: '#fff7e0' },
  { w: 2048, h: 1152, caption: 'The day we said yes', album: '我們', fx: 0.4, fy: 0.5, sky: ['#ffb38a', '#4e5d8c'], land: '#272f45', sun: '#ffe6c4' },
  { w: 2048, h: 1365, caption: '交往五週年，在同一家早午餐店點了一樣的鬆餅，老闆竟然還記得我們，笑著說下次結婚一定要請他喝喜酒，我們當然答應他了！', album: '我們', fx: 0.5, fy: 0.5, sky: ['#cfe3d8', '#7fa69a'], land: '#3f5a50', sun: '#f6fff9' },
  // 很暗的夜景（手機在晚上拍的）：測暗照片提亮、配亮版面、環境光跟著色調
  { w: 2048, h: 1365, caption: '跨年夜，在山上等第一道曙光', album: '我們', fx: 0.55, fy: 0.4, sky: ['#2a3150', '#090b16'], land: '#05060b', sun: '#c8d2ff', lum: 0.09, tone: '#1c2236' },
];

function draw(p: DevPhoto, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = p.w; c.height = p.h;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(seed);
  const { w, h } = p;
  const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, p.sky[1]); sky.addColorStop(1, p.sky[0]);
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  // 太陽在焦點附近（測試「繞著焦點推」看得出來）
  const sx = p.fx * w, sy = p.fy * h, sr = Math.min(w, h) * 0.09;
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, sr * 5);
  halo.addColorStop(0, p.sun); halo.addColorStop(0.2, `${p.sun}aa`); halo.addColorStop(1, `${p.sun}00`);
  g.fillStyle = halo; g.fillRect(0, 0, w, h);
  g.fillStyle = p.sun; g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
  // 三層山
  for (let k = 0; k < 3; k++) {
    const base = h * (0.62 + k * 0.1);
    g.fillStyle = p.land; g.globalAlpha = 0.45 + k * 0.25;
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 24) g.lineTo(x, base - Math.sin(x / w * (3 + k) * Math.PI + rnd() * 0.6) * h * 0.05 - rnd() * h * 0.02);
    g.lineTo(w, h); g.closePath(); g.fill();
  }
  g.globalAlpha = 1;
  // 光斑
  for (let i = 0; i < 26; i++) {
    const x = rnd() * w, y = rnd() * h * 0.6, r = (0.01 + rnd() * 0.03) * Math.min(w, h);
    g.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.12})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // 照片的顆粒
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  return c;
}

const cache = new Map<string, PhotoImage>();

/** 第 n 張假照片（1 起算，超過就繞回來）。fx, fy：換焦點（太陽跟著畫在焦點上，截圖看得出有沒有往焦點推）。 */
export function devPhoto(n: number, opts: { caption?: string | null; fx?: number; fy?: number } = {}): PhotoRef {
  const i = (((n - 1) % DEV_PHOTOS.length) + DEV_PHOTOS.length) % DEV_PHOTOS.length;
  const p = { ...DEV_PHOTOS[i]!, fx: opts.fx ?? DEV_PHOTOS[i]!.fx, fy: opts.fy ?? DEV_PHOTOS[i]!.fy };
  const key = `${i}|${p.fx}|${p.fy}`;
  return {
    id: -(i + 1), caption: cleanCaption(opts.caption === null ? '' : opts.caption ?? p.caption), album: p.album,
    chapter: i === 0 || DEV_PHOTOS[i - 1]!.album !== p.album, n: i + 1, total: DEV_PHOTOS.length, fx: p.fx, fy: p.fy,
    w: p.w, h: p.h, kinds: photoKinds(p.w, p.h), lum: p.lum ?? null, tone: p.tone ?? '',
    load: async () => {
      let hit = cache.get(key);
      if (!hit) { const image = draw(p, 1000 + i); hit = { image, w: p.w, h: p.h }; cache.set(key, hit); }
      return hit;
    },
  };
}
