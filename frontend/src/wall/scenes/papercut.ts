// 照片版面「紙雕」（亮）：一個紙雕燈箱——四層剪出山、雲、丘陵的紙一層疊一層圍著照片，照片在最裡層，像從山谷裡看出去的一扇窗。
//  - 每一層紙的顏色從前面的紙白一路往後變深（主題訊號色的暗部），剪口有一點亮邊，每一層在後面那層投下軟影（光從左上來，
//    離得越遠影子越大越糊），照片上也落著前面幾層的影子，看起來是凹進去的。
//  - 切進來：像鏡頭從紙雕裡面往後退——照片先在，越前面的紙一開始放得越大，一層一層收回到位（最前面的最後）。
//  - 之後鏡頭很慢地往一邊移、往前推：前面的層移得多、照片幾乎不動（視差）；雲很慢地飄；每個小節線燈光輕輕亮一下。
//  - 山與雲只長在照片外面（最多碰到照片的邊幾個像素），照片完整、焦點不會被擋。很小的照片最多放大 1.5 倍。
//  - 焦點：窗裡的照片慢慢往焦點推（像從山谷裡往那裡看過去），紙層的視差推近也繞著焦點。
//  - 字寫在最前面那層紙的下緣（像燈箱底座的題字，手寫字、深咖啡墨）：主字（賓客留言＋署名，或新人的註解）一個字一個字寫出來，
//    歌詞小一號在下面跟唱；沒有主字時歌詞自己寫在同一個位置跟唱；兩個都沒有就只有紙雕與照片（照片往下長、更大）。
//    直的、方的照片左右空很多：字改寫在右邊最前面那層紙上（照片往左、照片完整用整個高度），長留言也不會把照片擠小。
//    相簿的第一張在字上面多一行小小的相簿名。
// 畫法：一個全螢幕 shader。每一層紙是一個距離場（開口的圓角框，加上山（圓頂三角形）、雲（幾顆圓），各自在 init() 用種子亂數排好、
// 確定不會蓋到照片）；從最前面往後疊（抗鋸齒用距離場，不用螢幕導數），影子是前面那層的距離場往右下偏移、放軟。字層貼在最前面那層上。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { HUD_SAFE } from '../engine/hud';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, mulberry32, prog } from '../engine/util';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, focusAt, loadPhoto, p6Crop, pace, photoLod, setP6Photo } from './_p6';
import type { PhotoImage } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, prefers: ['landscape'], energy: [0, 1], bars: [2, 8], weight: 1 };

/** 紙的層數（0 = 照片外面那一圈很窄的卡紙，4 = 最前面）。 */
const NL = 5;
/** 山、雲最多幾個（uniform 陣列的大小）。 */
const NM = 36, NC = 27;

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D tl;
  uniform vec4 rect;                 // 照片 L, T, R, B（層的座標）
  uniform vec4 marg[${NL}];          // 每層開口的 左右、上、下 邊距、圓角
  uniform vec2 lay[${NL}];           // 每層的放大（進場）、亮度
  uniform vec2 rm[${NL}]; uniform vec2 rc[${NL}];   // 每層的山、雲在陣列裡的範圍
  uniform vec4 mtn[${NM}];           // 山：x, 頂的 y, 斜率, 層
  uniform vec4 cld[${NC}];           // 雲：x, y, 半徑, 層
  uniform vec2 pan; uniform float push; uniform vec2 zc; uniform float drift;
  uniform float lod; uniform vec2 tlPos; uniform vec2 tlSize; uniform float textK; uniform float k; uniform float glow;
  // 第 i 層的深度（照片 0，最前面 5）：視差、推近、影子都照這個
  float depth(int i) { return float(i + 1); }
  vec2 toLayer(int i, vec2 sp) {
    float d = depth(i);
    float z = (1.0 + push * d) * lay[i].x;
    return zc + (sp - zc - pan * d) / z;
  }
  // 第 i 層紙的距離場（正的是紙，單位是層的 px）
  float paper(int i, vec2 p) {
    vec4 m = marg[i];
    vec2 lo = rect.xy - vec2(m.x, m.y), hi = rect.zw + vec2(m.x, m.z);
    vec2 c = 0.5 * (lo + hi), hs = 0.5 * (hi - lo);
    float r = min(m.w, min(hs.x, hs.y));
    vec2 q = abs(p - c) - (hs - r);
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    int j0 = int(rm[i].x), j1 = int(rm[i].y);
    for (int j = 0; j < ${NM}; j++) {
      if (j < j0) continue;
      if (j >= j1) break;
      vec4 a = mtn[j];
      float dx = sqrt((p.x - a.x) * (p.x - a.x) + 900.0) - 30.0;
      sd = max(sd, (p.y - (a.y + dx * a.z)) / sqrt(1.0 + a.z * a.z));
    }
    j0 = int(rc[i].x); j1 = int(rc[i].y);
    for (int j = 0; j < ${NC}; j++) {
      if (j < j0) continue;
      if (j >= j1) break;
      vec4 a = cld[j];
      float cx = a.x + drift * (float(i) - 1.5) * (fract(a.x * 0.0137) > 0.5 ? 1.0 : -1.0);
      sd = max(sd, a.z - length(p - vec2(cx, a.y)));
    }
    return sd;
  }
  vec3 tone(int i) {
    float f = float(${NL - 1} - i) / ${NL - 1}.0;          // 0 = 最前面，1 = 最裡面
    vec3 front = C_PAPER * 0.97, back = mix(C_PAPER, C_BLOOD, 0.42) * 0.78;
    return mix(front, back, pow(f, 0.85));
  }
  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 L = vec2(5.0, 8.0);          // 每一層深度差的影子偏移（光從左上）
    vec3 col = vec3(0.0);
    float tr = 1.0;
    for (int i = ${NL - 1}; i >= 0; i--) {
      vec2 p = toLayer(i, sp);
      float sd = paper(i, p);
      float a = smoothstep(-0.8, 0.8, sd);
      if (a <= 0.0) continue;
      vec3 c = p6Paper(p * 1.3 + float(i) * 97.0, tone(i)) * lay[i].y;
      // 剪口的亮邊
      c *= 1.0 + 0.07 * (1.0 - smoothstep(0.0, 2.6, sd));
      // 前面兩層投下的影子
      float sh = 0.0;
      for (int j = i + 1; j <= i + 2 && j < ${NL}; j++) {
        float dz = float(j - i);
        float sj = paper(j, toLayer(j, sp) - L * dz);
        sh = max(sh, smoothstep(-4.0 * dz, 4.0 * dz, sj) * (0.42 - 0.12 * dz));
      }
      c *= 1.0 - sh;
      // 前面的層被燈打得比較亮（燈箱的頂光）
      c *= 1.0 + glow * 0.05 * float(i) / ${NL - 1}.0;
      if (i == ${NL - 1}) {
        vec4 tx = p6Layer(tl, p - tlPos, tlSize) * textK;
        c = c * (1.0 - tx.a) + tx.rgb;
      }
      col += tr * a * c;
      tr *= 1.0 - a;
      if (tr < 0.002) break;
    }
    if (tr > 0.002) {
      // 最裡面：背板（最深的紙）與照片
      vec2 p = zc + (sp - zc) / 1.0;
      vec3 b = p6Paper(p, mix(C_PAPER, C_BLOOD, 0.5) * 0.62);
      vec2 uv = (p - rect.xy) / (rect.zw - rect.xy);
      float inPh = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      vec3 ph = p6Photo(photo, uv, lod);
      b = mix(b, ph, inPh);
      // 前面三層落在照片上的影子：照片是凹進去的
      float sh = 0.0;
      for (int j = 0; j < 3; j++) {
        float dz = float(j + 1);
        float sj = paper(j, toLayer(j, sp) - L * dz);
        sh = max(sh, smoothstep(-4.0 * dz, 4.0 * dz, sj) * (0.4 - 0.1 * dz));
      }
      b *= 1.0 - sh;
      col += tr * b;
    }
    // 燈箱：上面亮、下緣與四角稍微暗
    vec2 vq = (sp - vec2(960.0, 454.0)) / vec2(1344.0, 810.0);
    col *= 1.0 - 0.14 * smoothstep(0.5, 1.3, length(vq));
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, tl: { value: null }, rect: { value: new THREE.Vector4(0, 0, 1, 1) },
  marg: { value: Array.from({ length: NL }, () => new THREE.Vector4()) },
  lay: { value: Array.from({ length: NL }, () => new THREE.Vector2(1, 1)) },
  rm: { value: Array.from({ length: NL }, () => new THREE.Vector2()) }, rc: { value: Array.from({ length: NL }, () => new THREE.Vector2()) },
  mtn: { value: Array.from({ length: NM }, () => new THREE.Vector4(0, 0, 1, -1)) },
  cld: { value: Array.from({ length: NC }, () => new THREE.Vector4(0, 0, 0, -1)) },
  pan: { value: new THREE.Vector2() }, push: { value: 0 }, zc: { value: new THREE.Vector2(W / 2, H / 2) }, drift: { value: 0 },
  lod: { value: 0 }, tlPos: { value: new THREE.Vector2() }, tlSize: { value: new THREE.Vector2(1, 1) }, textK: { value: 0 }, k: { value: 1 }, glow: { value: 0 },
});

export default class PaperCut extends Scene {
  bg = shared('papercut.bg', BG);
  cap!: Caption;
  /** 字寫在右邊（直的、方的照片），不是照片下面的底座。 */
  side = false;
  textX = 0;
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  rect: [number, number, number, number] = [0, 0, 1, 1];
  marg: [number, number, number, number][] = [];
  mtn: [number, number, number, number][] = [];
  cld: [number, number, number, number][] = [];
  /** 每一層的山、雲在陣列裡的範圍（shader 只算自己那一層的）。 */
  rm: [number, number][] = [];
  rc: [number, number][] = [];
  textTop = 0;
  cx = W / 2;
  kp = 1;
  dir = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { w, h } = img;
    // 字：橫的照片寫在照片下面的底座（寬 940、最多三行，60 字的留言也放得下，整塊最高 300）；
    // 直的、方的寫在右邊的紙上（寬 540、最多六行）
    const side = w / h < 1.1;
    const cap = (this.cap = this.track(new Caption(side ? 540 : 940, side ? 620 : 300, {
      family: F.hand(400), align: side ? 'left' : 'center', lineHeight: 1.32, maxLines: side ? 6 : 3, ink: rgba('sepia', 0.9),
    })));
    cap.setup(this.ctx, ph);
    this.side = side && cap.has;
    // 每層開口的邊距（左右、上、下、圓角）：0 是照片外面的卡紙（蓋住照片邊緣兩個像素）；越前面開口越大，
    // 兩層之間露出來的那一圈就是那一層的山、樹、雲
    // 字在右邊時開口窄一點：最前面那層在照片右邊 360 px 就是紙（寫字的地方）
    this.marg = [[-2, -2, -2, 4]];
    for (let i = 1; i < NL; i++) this.marg.push([40 + (this.side ? 80 : 110) * i, 20 + 42 * i, 22 * i, 40 + 34 * i]);
    const mb = this.marg[NL - 1]![2];
    // 照片的範圍：有字時下面留給最前面那層的題字
    const textH = cap.has ? cap.blockH : 0;
    // 字的最後一行停在 958：鏡頭推近、最前面那層移動時也不會超出下緣 96 px
    this.textTop = 958 - textH;
    const below = cap.has && !this.side;
    const B = below ? this.textTop - mb - 34 : 868;
    const T = below ? 104 : 100;
    const s = fitPhoto(w, h, this.side ? 700 : 1200, B - T);
    const pw = w * s, phh = h * s;
    if (this.side) {
      // 照片的右緣停在 874：最前面那層的開口到 1234，字從 1284 寫到 1824；字在 HUD 的上面（最後一行 ≤ 800）
      this.cx = Math.min(W / 2, 874 - pw / 2);
      this.textX = this.cx + pw / 2 + this.marg[NL - 1]![0] + 50;
      this.textTop = clamp((T + B) / 2 - textH / 2, 130, 800 - textH);
    } else {
      // 有字時往左一點：置中的字最後一行在 HUD 的高度，右緣要在 HUD 左邊
      this.cx = cap.has ? Math.min(890, HUD_SAFE.x - 24 - cap.blockW / 2) : W / 2;
      this.textX = this.cx;
    }
    const y0 = below ? B - phh : (T + B) / 2 - phh / 2;
    this.rect = [this.cx - pw / 2, y0, this.cx + pw / 2, y0 + phh];
    const [Lx, Ty, Rx, By] = this.rect;
    const rnd = mulberry32(Math.floor(hash(this.seed, 31) * 1e9));
    for (let i = 1; i < NL; i++) {
      const [mx, , mbI] = this.marg[i]!;
      const tol = 4 + 5 * i;
      const m0 = this.mtn.length;
      for (const side of [-1, 1]) {
        const edge = side < 0 ? Lx : Rx;
        // 這一側看得到的寬度：照片邊到這一層開口的邊（或畫面邊）
        const room = Math.min(mx, side < 0 ? edge : W - edge);
        // 山：長在照片旁邊，山坡一定碰不到照片的下角（山頂的高度壓在「水平距離 × 斜率」以內）
        for (let k = 0; k < 2; k++) {
          const dx = 30 + rnd() * Math.max(10, room - 50);
          const slope = 0.5 + rnd() * 0.8;
          const hm = Math.min((120 + rnd() * 300) * (0.55 + 0.15 * i), dx * slope - tol);
          if (hm > 30) this.mtn.push([edge + side * dx, By - hm, slope, i]);
        }
        // 樹（很陡的三角形）：前面三層才有，站在這一層的下緣
        if (i >= 2 && room > 120) {
          const dx = room * (0.5 + rnd() * 0.4);
          const slope = 2.6 + rnd() * 1.4;
          const base = By + mbI;
          const hm = Math.min(110 + rnd() * 170, base - By + dx * slope - tol);
          if (hm > 40) this.mtn.push([edge + side * dx, base - hm, slope, i]);
        }
      }
      // 照片下面低低的丘陵：山頂在這層的下緣附近，不會長到照片上
      for (let k = 0; k < 3; k++) {
        const x = lerp(Lx, Rx, (k + 0.5 + (rnd() - 0.5) * 0.6) / 3);
        this.mtn.push([x, Math.max(By + mbI - 8 - rnd() * 24, By + 6), 0.16 + rnd() * 0.2, i]);
      }
      this.rm[i] = [m0, this.mtn.length];
      // 雲：從這一層開口的上緣垂下來（一朵三顆圓）；在照片正上方的那幾朵，最下緣不碰到照片的上緣
      const c0 = this.cld.length;
      if (i >= 2) {
        const top = Ty - this.marg[i]![1];
        for (let k = 0; k < 3; k++) {
          const x = lerp(Lx - mx * 0.45, Rx + mx * 0.45, (k + 0.5 + (rnd() - 0.5) * 0.7) / 3);
          const r0 = 30 + rnd() * 34 + 6 * i;
          const parts: [number, number, number][] = [[0, 0, 1], [-1.05, 0.32, 0.68], [1.0, 0.26, 0.74]];
          const y = top + r0 * 0.2 + rnd() * 16;
          for (const [ox, oy, rs] of parts) {
            const cx = x + ox * r0, r = r0 * rs;
            const over = cx + r > Lx - 10 && cx - r < Rx + 10;
            this.cld.push([cx, over ? Math.min(y + oy * r0, Ty - 8 - 4 * i - r) : y + oy * r0, r, i]);
          }
        }
      }
      this.rc[i] = [c0, this.cld.length];
    }
    this.kp = pace(this.ctx);
    this.dir = hash(this.seed, 5) < 0.5 ? -1 : 1;
    cap.writeAt(this.ctx.start + 0.9 * this.kp, 2.0);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, kp = this.kp, lt = t - s;
    const u = this.bg.u;
    const ph = this.ctx.params.photo;
    // 窗裡的照片往焦點推（像相框裡的畫面，推到 1.18 倍）
    const pw = this.rect[2] - this.rect[0];
    const crop = p6Crop(this.ctx, this.img!, t, { zoom: 1.18, screenW: pw });
    setP6Photo(u, ph, crop);
    (u.rect!.value as THREE.Vector4).set(...this.rect);
    const marg = u.marg!.value as THREE.Vector4[];
    const lay = u.lay!.value as THREE.Vector2[];
    for (let i = 0; i < NL; i++) {
      marg[i]!.set(...this.marg[i]!);
      // 進場：鏡頭從紙雕裡面往後退——越前面的層一開始放得越大，一層一層收回來（前面的晚一點）
      const t0 = s + 0.04 * i * kp;
      const k = ease.outCubic(prog(t, t0, t0 + 0.9 * kp));
      lay[i]!.set(1 + (1 - k) * 0.3 * i, 1);
      (u.rm!.value as THREE.Vector2[])[i]!.set(...(this.rm[i] ?? [0, 0]));
      (u.rc!.value as THREE.Vector2[])[i]!.set(...(this.rc[i] ?? [0, 0]));
    }
    const mtn = u.mtn!.value as THREE.Vector4[];
    for (let j = 0; j < NM; j++) mtn[j]!.set(...(this.mtn[j] ?? [0, 0, 1, -1]));
    const cld = u.cld!.value as THREE.Vector4[];
    for (let j = 0; j < NC; j++) cld[j]!.set(...(this.cld[j] ?? [0, 0, 0, -1]));
    // 鏡頭：一開始快、之後越來越慢地往一邊移、往前推（前面的層動得多）
    const ez = 1 - Math.exp(-lt / 7);
    (u.pan!.value as THREE.Vector2).set(this.dir * 4.5 * ez - this.dir * 1.5, -2.2 * ez);
    u.push!.value = 0.0055 * ez;
    // 紙層繞著焦點推近（焦點那一帶的紙動得少，視線一直對著它）
    (u.zc!.value as THREE.Vector2).set(...focusAt(ph, crop, this.rect));
    u.drift!.value = 5 * lt;
    // 每個小節線，燈輕輕亮一下
    const bar = audio.timeOfBar(Math.floor(audio.barAt(t)));
    u.glow!.value = 1 + 0.6 * Math.exp(-Math.max(0, t - bar) / 0.35) * (bar > s ? 1 : 0);
    u.photo!.value = this.tex;
    u.lod!.value = photoLod(this.img!.w * (crop[2] - crop[0]), pw);
    const cap = this.cap;
    if (cap.has) {
      cap.draw(t);
      u.tl!.value = cap.L.texture;
      (u.tlPos!.value as THREE.Vector2).set(this.side ? this.textX - cap.pad : this.textX - cap.L.w / 2, this.textTop - cap.pad);
      (u.tlSize!.value as THREE.Vector2).set(cap.L.w, cap.L.h);
      u.textK!.value = cap.hasMain ? 1 : prog(t, s + 0.6 * kp, s + 1.0 * kp);
    } else { u.tl!.value = this.tex; u.textK!.value = 0; }
    u.k!.value = (0.86 + 0.14 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.06 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { ...P6_POST, vignette: 0.32 };
  }
}
