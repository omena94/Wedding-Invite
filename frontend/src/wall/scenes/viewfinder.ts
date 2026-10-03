// 照片版面「觀景窗」（暗）：從單眼相機的觀景窗看出去——
//  - 黑色的機身裡一個圓角的觀景窗（橫的照片是 3:2；直的照片相機直拿、觀景窗是直的、資訊列跑到旁邊），
//    對焦屏有很細的霧面顆粒、四角暗、一兩顆灰塵。窗裡是新人的照片（繞著焦點裁成觀景窗的比例）。
//  - 對焦：一開始糊、中央的裂像圈上下兩半錯開；自動對焦「找」一下（過頭再回來），拍點上離焦點最近的對焦點亮起（訊號色閃兩下）。
//    對焦前手持的畫面有一點點晃。
//  - 拍點按下快門：反光鏡升起、整個黑一下，然後畫面「定格」——取景框的線、對焦點淡掉，照片從觀景窗的裁切展開成完整的照片（不裁），
//    細細的白框閃一下；資訊列的張數加一。之後畫面往焦點推（照片在框裡：focusCrop），焦點永遠在框裡。
//  - 字在觀景窗右邊的暗處（思源宋體），位置固定：主字（賓客留言＋署名，或新人的註解）快門之後淡入，
//    歌詞小一號在下面、從頭就跟唱；沒有主字時歌詞自己寫在那裡。兩個都沒有，觀景窗在正中間。
//  - 下面（直拿時是右邊）一排小小的資訊（快門、光圈、ISO、測光刻度、張數）用訊號色，像觀景窗裡的 LCD。
//  - 很小的舊照片：觀景窗跟著縮（最多放大到原尺寸約 1.5 倍），不會糊成一片。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { focusCrop, loadWords, settleK } from './_photo';
import { P1_GLSL, P1Cap, gainOf, p1Uniforms, blitAt, containScale, cropAround, loadPhotos, mipFor, photoRefs, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'film', energy: [0.2, 1], bars: [2, 8], weight: 1 };

const AF: [number, number][] = [[0, 0], [-0.17, 0], [0.17, 0], [-0.34, 0], [0.34, 0], [0, -0.24], [0, 0.24], [-0.17, -0.15], [0.17, 0.15]];

const BG = () => new FSPass(/* glsl */ `
  ${P1_GLSL}
  uniform sampler2D photo; uniform float lod;
  uniform vec4 win; uniform float rad;          // 觀景窗（畫面 px：中心 xy、半寬高 zw）、圓角
  uniform vec4 crop; uniform vec2 jit;          // 照片的取樣範圍；手持晃動
  uniform float defocus; uniform float overlay; uniform float black; uniform float flash; uniform float vert;
  uniform vec2 af[9]; uniform float afOn; uniform int afIdx; uniform float k; uniform float frameLine; uniform float brk;

  vec3 sceneAt(vec2 w01, float l) {
    vec2 uv = crop.xy + w01 * (crop.zw - crop.xy);
    return photoLin(photo, uv, l) * 0.82;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 機身：全黑，眼罩的一圈很淡的反光
    vec2 eq = (p - win.xy) / (win.zw + vec2(220.0));
    vec3 col = C_INK * 0.6 + C_GRAPHITE * 0.025 * exp(-pow(length(eq) - 1.0, 2.0) * 30.0);
    vec2 lp = p - win.xy;
    float d = sdRound(lp, win.zw, rad);
    // 觀景窗的邊緣很軟（眼睛不是貼死在觀景窗上）
    float inW = 1.0 - smoothstep(-6.0, 3.0, d);
    if (inW > 0.0) {
      vec2 w01 = (lp + win.zw) / (2.0 * win.zw) + jit;
      float l = lod + defocus * 4.5;
      vec3 sc = sceneAt(w01, l);
      if (defocus > 0.03) {
        float r = defocus * 0.012;
        sc = sc * 0.36 + 0.16 * (sceneAt(w01 + vec2(r, 0.0), l) + sceneAt(w01 - vec2(r, 0.0), l) + sceneAt(w01 + vec2(0.0, r * 1.5), l) + sceneAt(w01 - vec2(0.0, r * 1.5), l));
      }
      // 中央的裂像圈：上下兩半照離焦的程度錯開；外圈的微稜鏡在離焦時閃爍
      float cr = min(win.z, win.w) * 0.13;
      float rr = length(lp);
      if (overlay > 0.0) {
        if (rr < cr) {
          float sx = (lp.y < 0.0 ? 1.0 : -1.0) * defocus * 0.045;
          vec3 split = sceneAt(w01 + vec2(sx, 0.0), lod + defocus * 1.5);
          sc = mix(sc, split, overlay);
          sc *= 1.0 - 0.5 * overlay * (1.0 - smoothstep(0.0, 1.2, abs(lp.y)));
        } else if (rr < cr * 1.6) {
          float prism = 0.5 + 0.5 * sin(lp.x * 0.9) * sin(lp.y * 0.9);
          sc = mix(sc, sc * (0.7 + 0.6 * prism), defocus * overlay);
        }
        // 刻在對焦屏上的線：裂像圈、外圈、對焦點（黑的；被選到的亮訊號色）
        float ring = min(abs(rr - cr), abs(rr - cr * 1.6));
        sc *= 1.0 - 0.55 * overlay * (1.0 - smoothstep(0.6, 1.6, ring));
        for (int i = 0; i < 9; i++) {
          vec2 ap = af[i] * win.zw * 2.0;
          vec2 bq = abs(lp - ap) - vec2(13.0, 9.0);
          float bd = abs(max(bq.x, bq.y));
          float frame = 1.0 - smoothstep(0.7, 1.7, bd);
          bool act = i == afIdx;
          sc = mix(sc, vec3(0.0), frame * overlay * 0.6);
          if (act) sc += C_SIGNAL * 1.4 * afOn * overlay * (frame + 0.25 * (1.0 - smoothstep(0.0, 2.0, max(bq.x, bq.y))));
        }
      }
      // 對焦屏：很細的霧面顆粒、四角暗
      sc *= 0.96 + 0.04 * hash12(floor(p));
      sc *= 1.0 - 0.35 * smoothstep(0.55, 1.15, length(lp / win.zw) * 0.85);
      // 灰塵
      sc *= 1.0 - 0.5 * overlay * (1.0 - smoothstep(0.0, 2.2, length(lp - win.zw * vec2(0.41, -0.27)) - 1.5));
      sc *= 1.0 - 0.4 * overlay * (1.0 - smoothstep(0.0, 1.6, length(lp - win.zw * vec2(-0.55, 0.38)) - 1.0));
      // 定格之後留著四個角的取景框線（淡淡的），看得出還是在觀景窗裡
      vec2 ca = abs(lp) - (win.zw - 22.0);
      float arm = min(max(abs(ca.y), max(ca.x, -64.0 - ca.x)), max(abs(ca.x), max(ca.y, -64.0 - ca.y)));
      sc = mix(sc, C_BONE * 0.78, brk * (1.0 - smoothstep(0.8, 1.8, arm)));
      // 定格的白框
      float fl = abs(d + 10.0);
      sc = mix(sc, C_BONE * 0.8, frameLine * (1.0 - smoothstep(0.8, 1.8, fl)));
      sc = mix(sc, C_BONE * 0.84, flash);
      col = mix(col, sc, inW);
    }
    col *= 1.0 - black;
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...p1Uniforms(),
  photo: { value: null }, lod: { value: 0 },
  win: { value: new THREE.Vector4() }, rad: { value: 24 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, jit: { value: new THREE.Vector2() },
  defocus: { value: 1 }, overlay: { value: 1 }, black: { value: 0 }, flash: { value: 0 }, vert: { value: 0 },
  af: { value: AF.map(([x, y]) => new THREE.Vector2(x, y)) }, afOn: { value: 0 }, afIdx: { value: 0 }, k: { value: 1 }, frameLine: { value: 0 }, brk: { value: 0 },
});

/** 字（畫面 px）：寬、整塊（主字＋署名＋歌詞）的高度上限；圖層四邊多留 PAD（字的軟影）。 */
const CAP_W = 560, CAP_H = 460, PAD = 20;

export default class Viewfinder extends Scene {
  bg = shared('viewfinder.bg', BG);
  txt = this.track(new Layer2D(CAP_W + 2 * PAD, CAP_H + 2 * PAD, undefined, { fast: true }));
  info = this.track(new Layer2D(980, 44, undefined, { fast: true }));
  seed = seedOf(this.ctx);
  ph!: P1Photo;
  cap!: P1Cap;
  vert = false;
  /** 觀景窗（取景時）與定格後的照片範圍：中心、半寬高。 */
  vf = new THREE.Vector4(); full = new THREE.Vector4();
  crop: [number, number, number, number] = [0, 0, 1, 1];
  afIdx = 0;
  tFocus = 0; tShot = 0;
  /** 字整塊的左上角（畫面 px，位置固定）。 */
  capX = 0; capY = 0;
  infoSig = '';
  readings: string[] = [];

  override async init() {
    const { start, end, audio } = this.ctx;
    const [ref] = photoRefs(this.ctx, 1);
    const sh = ['1/125', '1/250', '1/60'][Math.floor(hash(this.seed, 3) * 3)]!, ap = ['F2.8', 'F2', 'F4'][Math.floor(hash(this.seed, 4) * 3)]!;
    this.readings = [sh, ap, 'ISO 400'];
    await loadText(`${ref!.caption}${ref!.album}${this.readings.join('')}-2·1·0·1·+2▲●0123456789…`);
    await loadWords(this.ctx);
    [this.ph] = await loadPhotos(this.ctx, [ref!], (x) => this.track(x));
    this.cap = new P1Cap(this.ctx, this.txt.ctx, {
      family: F.ming(500), min: 40, max: 50, w: CAP_W, h: CAP_H, lineHeight: 1.36, maxLines: 5,
      ink: rgba('bone', 0.94), unsung: rgba('bone', 0.3), sigInk: rgba('bone', 0.72), sigSize: 28,
      shadow: { color: rgba('ink', 0.8), blur: 10 },
    });
    const { w, h, aspect } = this.ph;
    this.vert = h > w * 1.02;
    const has = this.cap.has;
    // 觀景窗：3:2（直拿 2:3）；很小的照片窗跟著縮（照片最多放大 1.5 倍）
    const va = this.vert ? 2 / 3 : 3 / 2;
    // 高度留給下面的資訊列（資訊列的底要離畫面下緣 96 px 以上）；有字時窄一點，右邊那一欄才放得下長留言
    const maxW = has ? (this.vert ? 560 : 1000) : (this.vert ? 620 : 1260), maxH = 760;
    let vw = Math.min(maxW, maxH * va), vh = vw / va;
    this.crop = cropAround(this.ph, va);
    const usedW = (this.crop[2] - this.crop[0]) * w;
    if (vw > usedW * 1.5) { vw = usedW * 1.5; vh = vw / va; }
    const cx = has ? 110 + vw / 2 + (this.vert ? 120 : 0) : W / 2, cy = H / 2 - 50;
    this.vf.set(cx, cy, vw / 2, vh / 2);
    // 定格：完整的照片放進觀景窗的範圍（不裁）
    const s = containScale(w, h, vw, vh);
    this.full.set(cx, cy, (w * s) / 2, (h * s) / 2);
    void aspect;
    // 字：觀景窗右邊，垂直置中（右邊在 HUD 那一欄，字的底要在 HUD 上面）
    this.capX = Math.min(cx + vw / 2 + 110, W - 96 - CAP_W);
    this.capY = clamp(cy - this.cap.height / 2, 140, 800 - this.cap.height);
    // 離焦點最近的對焦點
    const fx = (this.ph.ref.fx - this.crop[0]) / (this.crop[2] - this.crop[0]) - 0.5, fy = (this.ph.ref.fy - this.crop[1]) / (this.crop[3] - this.crop[1]) - 0.5;
    let best = 0, bd = Infinity;
    AF.forEach(([x, y], i) => { const dd = Math.hypot(x - fx, (y - fy) * 0.8); if (dd < bd) { bd = dd; best = i; } });
    this.afIdx = best;
    // 時間：拍點上對到焦、再一兩拍按快門（窗格短就照比例）
    const len = end - start;
    this.tFocus = len < 4.5 ? start + len * 0.25 : beatAfter(audio, start + Math.min(1.1, len * 0.15));
    this.tShot = len < 4.5 ? start + len * 0.45 : beatAfter(audio, this.tFocus + 0.3, len > 9 ? 2 : 1);
  }

  private drawInfo(n: number, meter: number) {
    const sig = `${n}|${meter.toFixed(2)}`;
    if (sig === this.infoSig) return;
    this.infoSig = sig;
    const L = this.info, c = L.ctx;
    L.clear();
    c.font = font(F.mono(500), 22);
    c.fillStyle = rgba('signal', 0.92);
    c.textBaseline = 'middle';
    let x = 10;
    for (const r of this.readings) { c.fillText(r, x, 22); x += c.measureText(r).width + 40; }
    // 測光刻度：-2 … 0 … +2，指針在 meter
    c.font = font(F.mono(400), 16);
    const sx = x + 10, sw = 300;
    ['-2', '1', '0', '1', '+2'].forEach((s2, i) => { const tx = sx + (i / 4) * sw; c.fillText(s2, tx - c.measureText(s2).width / 2, 12); c.fillRect(tx - 1, 24, 2, 8); });
    c.fillRect(sx, 30, sw, 2);
    const mx = sx + sw / 2 + meter * (sw / 4);
    c.beginPath(); c.moveTo(mx, 34); c.lineTo(mx - 7, 44); c.lineTo(mx + 7, 44); c.fill();
    c.font = font(F.mono(500), 22);
    c.fillText(String(n).padStart(2, '0'), sx + sw + 50, 22);
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.ph.ref);
    const shot = t >= this.tShot + 0.11;
    const open = ease.inOutCubic(prog(t, this.tShot + 0.11, this.tShot + 0.75));
    const push = 1 + 0.035 * (1 - Math.exp(-Math.max(0, t - this.tShot) / 7));
    // 觀景窗 → 定格的完整照片
    const r = [0, 1, 2, 3].map((i) => lerp(this.vf.getComponent(i), this.full.getComponent(i), open));
    (u.win!.value as THREE.Vector4).set(r[0]!, r[1]!, r[2]! * push, r[3]! * push);
    u.rad!.value = lerp(26, 3, open);
    // 取景時：繞著焦點裁成觀景窗的比例；定格之後展開成完整的照片，再往焦點推（很小的照片少推）
    const cr = this.crop;
    const pc = focusCrop(this.ph.ref, this.ph.w, this.ph.h, this.ph.aspect, settleK(t - this.tShot - 0.75, 6), { zoom: 1.25, screenW: 2 * this.full.z });
    (u.crop!.value as THREE.Vector4).set(lerp(cr[0], pc[0], open), lerp(cr[1], pc[1], open), lerp(cr[2], pc[2], open), lerp(cr[3], pc[3], open));
    // 手持晃動（按快門前）
    const hand = 1 - prog(t, this.tShot - 0.3, this.tShot);
    (u.jit!.value as THREE.Vector2).set((Math.sin(t * 1.3) * 0.004 + Math.sin(t * 2.9 + 1) * 0.002) * hand, (Math.sin(t * 1.7 + 2) * 0.003) * hand);
    // 對焦：糊 → 過頭 → 對到；對到時對焦點閃兩下
    const fp = prog(t, s + 0.15, this.tFocus);
    const hunt = fp < 0.75 ? 1 - ease.inOutCubic(fp / 0.75) * 1.25 : -0.25 + 0.25 * ease.outCubic((fp - 0.75) / 0.25);
    u.defocus!.value = Math.abs(hunt) * (shot ? 0 : 1);
    const since = t - this.tFocus;
    u.afOn!.value = since < 0 || shot ? 0 : since < 0.08 ? 1 : since < 0.16 ? 0 : since < 0.24 ? 1 : 0.85;
    u.afIdx!.value = this.afIdx;
    u.overlay!.value = 1 - open;
    u.brk!.value = 0.75 * prog(t, this.tShot + 0.6, this.tShot + 1.2);
    u.black!.value = t >= this.tShot && t < this.tShot + 0.11 ? 1 : ease.inCubic(prog(t, e - 0.25, e)) * 0.9;
    u.flash!.value = shot ? 0.25 * (1 - prog(t, this.tShot + 0.11, this.tShot + 0.4)) : 0;
    u.frameLine!.value = shot ? prog(t, this.tShot + 0.3, this.tShot + 0.5) * (1 - prog(t, this.tShot + 0.9, this.tShot + 1.6)) : 0;
    u.photo!.value = this.ph.tex;
    u.lod!.value = mipFor((cr[2] - cr[0]) * this.ph.w * (1 - open) + (pc[2] - pc[0]) * this.ph.w * open, 2 * r[2]! * push);
    u.vert!.value = this.vert ? 1 : 0;
    // 眼睛貼上觀景窗：從黑亮起來
    u.k!.value = ease.outCubic(prog(t, s, s + 0.35));
    this.bg.render(renderer, out);
    // 資訊列：觀景窗下面（直拿時在右邊、轉九十度太難讀，照樣橫的放在下面）
    const n = this.ph.ref.n + (shot ? 1 : 0);
    const meter = shot ? 0 : clamp(Math.sin(t * 2.3) * 0.6 * (1 - prog(t, this.tFocus - 0.3, this.tFocus)), -1, 1);
    this.drawInfo(n, Math.round(meter * 4) / 4);
    const ix = this.vf.x - this.info.w / 2 + 40, iy = this.vf.y + this.vf.w + 22;
    blitAt(comp, renderer, this.info, out, clamp(ix, 100, 1340 - this.info.w), Math.min(iy, H - 96 - this.info.h), (1 - open * 0.45) * u.k!.value * (1 - u.black!.value));
    if (this.cap.has) {
      // 主字快門之後淡入；歌詞從頭就在（位置固定）
      const L = this.txt;
      const mainK = prog(t, this.tShot + 0.6, this.tShot + 1.2, ease.outCubic), lyrK = prog(t, s + 0.4, s + 0.9);
      if (this.cap.draw(L.ctx, t, PAD, PAD, { alpha: this.cap.hasMain ? mainK : lyrK, lyricAlpha: lyrK, clear: () => L.clear() })) L.upload();
      blitAt(comp, renderer, L, out, this.capX - PAD, this.capY - PAD, 1 - prog(t, e - 0.25, e));
    }
    return { bloom: 0.25, bloomThreshold: 1.05, halation: 0.12, vignette: 0.45 };
  }
}
