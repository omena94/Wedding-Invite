// 著色器預先編譯：新版面第一次畫的時候，three 才去編譯它的著色器，而且要等顯示卡編完才畫得下去，
// 換版面那一格會停 80～180 毫秒（內顯筆電更久），歌詞看起來卡一下。
// 版面在上場前幾秒就建好了（engine.load），趁那時候用 compileAsync 叫顯示卡在背景平行編譯（KHR_parallel_shader_compile），
// 編好才讓它上場，輪到它時就不用停下來等。
import * as THREE from 'three';

const QUAD = new THREE.PlaneGeometry(2, 2);
const CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const MAX_DEPTH = 5;
/** 長陣列（粒子、歌詞行…）只看前面幾個：材質不會藏在第幾千個裡面，整條走完反而拖慢建場景。 */
const MAX_ITEMS = 64;

/**
 * 沿著物件的欄位往下找 three 的物件與材質（版面把 FSPass、Mesh、LineBatch… 存在自己的欄位或 track 的清單裡）。
 * 回傳要編譯的根：Object3D 往上找到最上層（FSPass 的 scene、版面自己的 THREE.Scene），加上沒掛在任何物件上的材質。
 */
function collect(root: unknown, skip: Set<unknown>) {
  const roots = new Set<THREE.Object3D>(), mats = new Set<THREE.Material>();
  const seen = new Set<unknown>(skip);
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || seen.has(v) || depth > MAX_DEPTH) return;
    seen.add(v);
    if (v instanceof THREE.Object3D) { let r = v; while (r.parent) r = r.parent; roots.add(r); return; }
    if (v instanceof THREE.Material) { mats.add(v); return; }
    if (v instanceof THREE.Texture || v instanceof THREE.RenderTarget || v instanceof THREE.BufferGeometry || v instanceof THREE.WebGLRenderer
      || ArrayBuffer.isView(v) || v instanceof ArrayBuffer || (typeof Node !== 'undefined' && v instanceof Node)
      || (typeof CanvasRenderingContext2D !== 'undefined' && v instanceof CanvasRenderingContext2D) || v instanceof Promise) return;
    if (Array.isArray(v)) { for (const x of v.slice(0, MAX_ITEMS)) walk(x, depth + 1); return; }
    if (v instanceof Map || v instanceof Set) { let i = 0; for (const x of v.values()) { if (i++ >= MAX_ITEMS) break; walk(x, depth + 1); } return; }
    for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], depth + 1);
  };
  walk(root, 0);
  // 已經掛在某個物件上的材質會跟著那個物件編譯；剩下的（單獨存著、畫的時候才掛上去的）用一張全畫面方塊代編
  for (const r of roots) r.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (Array.isArray(m)) m.forEach((x) => mats.delete(x)); else if (m) mats.delete(m);
  });
  const out = [...roots];
  if (mats.size) {
    const tmp = new THREE.Scene();
    for (const m of mats) tmp.add(new THREE.Mesh(QUAD, m));
    out.push(tmp);
  }
  return out;
}

/**
 * 把 root 底下找得到的著色器交給顯示卡在背景編譯，編好（或等太久）就回來。
 * target：版面畫進去的 render target（three 會依「畫到螢幕還是畫到 RT」決定色彩空間等編譯參數，要一樣才不會又編一次）。
 * skip：不用往下找的物件（引擎共用的 renderer、合成器等，開機時已經編過）。
 */
export async function warmShaders(renderer: THREE.WebGLRenderer, root: unknown, target: THREE.RenderTarget, skip: unknown[] = [], timeoutMs = 4000) {
  let jobs: Promise<unknown>[] = [];
  const prev = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target as THREE.WebGLRenderTarget);
    jobs = collect(root, new Set(skip)).map((o) => renderer.compileAsync(o, CAM));
  } catch (err) {
    // 預先編譯失敗不影響播放：頂多第一次畫的時候照舊停一下
    console.warn('warmShaders failed', err);
  } finally {
    renderer.setRenderTarget(prev);
  }
  if (!jobs.length) return;
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, timeoutMs))]);
}
