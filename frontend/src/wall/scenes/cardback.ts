// 照片版面「明信片」（亮）：照片洗成一張明信片（窄白邊），落在淺色的石頭桌面上；拍點上明信片立體地翻過來，
// 背面是寫好的明信片——
//  - 右上角一張郵票（齒孔邊，圖案是同一張照片的焦點附近），郵戳蓋在郵票上（婚禮日期，沒定日期就只有一顆愛心）、一道波浪的銷印線。
//  - 左半邊（直的明信片是上半部）是手寫的字：主字（賓客留言＋署名，或新人的註解），歌詞小一號在下面跟唱；
//    沒有主字時歌詞自己當主字（_photo.ts 的 PhotoText）。右邊幾條地址線，收件人寫新人的名字。
//  - 兩個都沒有時不翻面：只看正面的照片，鏡頭很慢地推近。
//  - 正面先停一下讓大家看照片（窗格長的話停久一點），翻面在拍點上；很長的窗格最後幾秒再翻回正面；很小的舊照片最多放大到原尺寸約 1.5 倍。
//    正面的畫面慢慢往焦點（新人點的臉）推，看正面的時候鏡頭也往那邊靠一點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE, type Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { COUPLE_ZH, DATE_DOT, drawHeart, fitPx } from './_motifs';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, beatNear, settle, type Pic, type V3, CAM_FOCAL } from './_p3';
import { loadWords, photoWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'album', paper: true, energy: [0, 1], bars: [3, 8], weight: 1, prefers: ['landscape', 'square'], thumbAt: 0.241 };

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D photo; uniform sampler2D ink; uniform sampler2D back;
  uniform vec3 cc;          // 卡片中心（世界）
  uniform vec3 cx; uniform vec3 cy;   // 卡片的兩個軸（翻面時會轉）
  uniform vec2 chs;         // 卡片半寬高
  uniform vec2 phHS;        // 正面照片的半寬高（卡片中心為原點）
  uniform float photoTpw;
  uniform vec4 stamp;       // 背面郵票：中心 xy（背面座標）、半寬高
  uniform vec4 crop;        // 郵票裡的照片：照片 uv 的範圍
  uniform vec4 fcrop;       // 正面的照片往焦點推：照片 uv 的範圍
  uniform vec4 inkRect;     // 字（背面座標：左下、寬高）
  uniform float inkOn;
  const vec3 LD = normalize(vec3(-0.35, 0.5, 1.0));

  float light(vec2 p) {
    vec2 q = (p - vec2(-300.0, 300.0)) / vec2(1600.0, 1200.0);
    return 0.66 + 0.34 * exp(-dot(q, q) * 1.3);
  }
  // 郵票的齒孔邊：方塊的 SDF 減掉沿邊排列的小圓
  float perf(vec2 q, vec2 hs) {
    float d = sdBox(q, hs);
    vec2 a = abs(q);
    float along = (hs.x - a.x) < (hs.y - a.y) ? q.y : q.x;
    float r = length(vec2(mod(along + 7.0, 14.0) - 7.0, min(hs.x - a.x, hs.y - a.y)));
    return max(d, 4.0 - r);
  }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    // ---- 桌面：淺色的石頭，很淡的紋路
    float tt = hitZ(ro, rd, 0.0);
    vec3 P = ro + rd * tt;
    float coc0 = cocAt(tt * dot(rd, camF));
    float wpp0 = wppAt(tt, rd, vec3(0.0, 0.0, 1.0));
    // 大理石：拉長、斜斜的紋路，很淡
    vec2 mq = rot2(0.5) * P.xy * vec2(0.45, 1.0);
    vec4 n1 = nz(mq, 1600.0, wpp0, coc0);
    vec4 n2 = nz(P.xy * 0.5 + 33.0, 1400.0, wpp0, coc0);
    float vein = 1.0 - smoothstep(0.0, 0.018 + coc0 * 0.002, abs(n1.a - 0.5 + 0.35 * (n2.r - 0.5)));
    float vein2 = 1.0 - smoothstep(0.0, 0.05 + coc0 * 0.003, abs(n1.r - 0.5));
    vec3 col = mix(C_PAPER, C_ASH, 0.5) * 0.84 * (0.95 + 0.07 * (n2.a - 0.5) + 0.03 * (n1.b - 0.5));
    col = mix(col, col * 0.8, vein * 0.35 + vein2 * 0.1);
    // 卡片的影子：卡片四個角投到桌上（翻起來時影子變大、變軟）
    {
      vec3 cn = cross(cx, cy);
      float h = max(cc.z, 0.0);
      vec2 sp = P.xy - (cc.xy - LD.xy / LD.z * h);
      vec2 sq = vec2(dot(sp, normalize(cx.xy + 1e-5)), dot(sp, normalize(cy.xy)));
      vec2 shs = chs * vec2(max(length(cx.xy), 0.05), 1.0);
      float soft = 4.0 + 0.2 * h;
      float occ = 1.0 - smoothstep(-soft, soft, sdBox(sq, shs - soft * 0.3));
      col *= 1.0 - (0.42 - 0.2 * smoothstep(0.0, 260.0, h)) * occ;
    }
    col *= light(P.xy);
    // ---- 卡片
    vec3 hc = rectHit(ro, rd, cc, cx, cy, chs);
    if (hc.x > 0.0) {
      vec3 n = cross(cx, cy);
      bool front = dot(n, rd) < 0.0;
      vec3 Q = ro + rd * hc.x;
      float depth = hc.x * dot(rd, camF), coc = cocAt(depth);
      float wpp = wppAt(hc.x, rd, n);
      vec2 q = hc.yz;
      vec4 nn = nz(q + (front ? 0.0 : 91.0), 700.0, wpp, coc);
      vec3 card = mix(C_BONE, C_PAPER, 0.3) * 0.93 * (0.98 + 0.03 * (nn.r - 0.5) + 0.02 * (nn.g - 0.5));
      if (front) {
        float di = sdBox(q, phHS);
        if (di < 1.0) {
          vec2 uv = vec2(q.x + phHS.x, phHS.y - q.y) / (2.0 * phHS);
          card = mix(card, photoAt(photo, cropUv(uv, fcrop), lodFor(photoTpw, wpp, coc)), 1.0 - smoothstep(-0.6, 0.6, di));
        }
      } else {
        // 背面：左右鏡射（翻過來以後，從上面看的左邊是卡片原本的右邊）
        vec2 b = vec2(-q.x, q.y);
        // 郵票：齒孔白邊＋照片的一小塊
        vec2 sq = b - stamp.xy;
        float ds = perf(sq, stamp.zw);
        if (ds < 1.0) {
          vec3 sc = mix(C_BONE, C_PAPER, 0.15) * 0.95;
          float din = sdBox(sq, stamp.zw - 12.0);
          if (din < 1.0) {
            vec2 suv = (vec2(sq.x, -sq.y) + stamp.zw - 12.0) / (2.0 * (stamp.zw - 12.0));
            vec2 uv = mix(crop.xy, crop.zw, suv);
            sc = mix(sc, photoAt(photo, uv, lodFor(photoTpw / (fcrop.z - fcrop.x) * (crop.z - crop.x) * 2.0 * phHS.x / (2.0 * (stamp.z - 12.0)), wpp, coc)), 1.0 - smoothstep(-0.6, 0.6, din));
          }
          card = mix(card * 0.9, sc, 1.0 - smoothstep(-0.6, 0.6, ds));
        }
        // 印好的線、郵戳（靜態圖層，蓋在郵票上）
        vec2 buv = (b + chs) / (2.0 * chs);
        vec4 bc = inkAt(back, buv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
        card = card * (1.0 - bc.a) + bc.rgb;
        if (inkOn > 0.5) {
          vec2 iuv = vec2((b.x - inkRect.x) / inkRect.z, (b.y - inkRect.y) / inkRect.w);
          vec4 ic = inkAt(ink, iuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
          card = card * (1.0 - ic.a) + ic.rgb;
        }
      }
      // 卡片的邊：很細的一圈暗
      card *= 1.0 - 0.15 * (1.0 - smoothstep(0.0, 2.0 + coc, chs.x - abs(q.x))) - 0.15 * (1.0 - smoothstep(0.0, 2.0 + coc, chs.y - abs(q.y)));
      float dif = clamp(dot(front ? n : -n, LD) / LD.z, 0.0, 1.25);
      vec3 lc = card * light(Q.xy) * (0.75 + 0.25 * dif);
      float a = 1.0 - smoothstep(-0.7 - coc * 0.5, 0.7 + coc * 0.5, max(abs(q.x) - chs.x, abs(q.y) - chs.y));
      col = mix(col, lc, a);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  photo: { value: null }, ink: { value: null }, back: { value: null },
  cc: { value: new THREE.Vector3() }, cx: { value: new THREE.Vector3(1, 0, 0) }, cy: { value: new THREE.Vector3(0, 1, 0) },
  chs: { value: new THREE.Vector2(500, 330) }, phHS: { value: new THREE.Vector2(470, 300) }, photoTpw: { value: 1 },
  stamp: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, fcrop: { value: new THREE.Vector4(0, 0, 1, 1) },
  inkRect: { value: new THREE.Vector4() }, inkOn: { value: 0 },
});

export default class Cardback extends Scene {
  bg = shared('cardback.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  pic: Pic | null = null;
  noise: THREE.Texture | null = null;
  ink: Layer2D | null = null;
  back: Layer2D | null = null;
  col: TextCol | null = null;
  chs: [number, number] = [500, 330];
  phs: [number, number] = [470, 300];
  stamp: [number, number, number, number] = [0, 0, 80, 100];
  crop: [number, number, number, number] = [0, 0, 1, 1];
  ir: [number, number, number, number] = [0, 0, 0, 0];
  ang = 0;
  tFlip = Infinity;
  /** 長窗格：最後再翻回正面（照片才是主角）。 */
  tFlip2 = Infinity;
  /** 背面要讀的地方（翻過來以後鏡頭稍微往那邊靠）。 */
  readAt: [number, number] = [0, 0];

  override async init() {
    const { renderer, start, end, audio } = this.ctx;
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    const toLine = `To  ${COUPLE_ZH}`;
    const mark = DATE_DOT;
    await loadText(`${ph.caption}${ph.album}POST CARD${toLine}${mark}♥`);
    await loadWords(this.ctx);
    this.pic = await loadPic(renderer, ph);
    this.track(this.pic.tex);
    this.noise = p3Noise(renderer);
    const { img } = this.pic;
    const rs = 0.95;
    // 卡片＝照片＋窄白邊，比例跟照片一樣（太長的手機直拍收一點：多出來的是白邊）
    const tall = img.h > img.w * 1.05;
    const [w, h] = picSize(img, tall ? 640 : 1180, tall ? 900 : 760, rs);
    const bw = clamp(0.035 * Math.min(w, h), 14, 26);
    this.phs = [w / 2, h / 2];
    let cw = w + 2 * bw, ch = h + 2 * bw;
    // 背面寫得下字（60 字的留言＋署名＋歌詞）：直的卡片至少 700 寬，橫的至少 960 寬、600 高（多出來的是白邊）
    const w0 = photoWords(this.ctx);
    if (w0.kind !== 'none' || w0.lyrics) { if (tall) cw = Math.max(cw, 700); else { cw = Math.max(cw, 960); ch = Math.max(ch, 600); } }
    this.chs = [cw / 2, ch / 2];
    this.ang = (hash(this.seed, 1) - 0.5) * 7 * (Math.PI / 180);
    // 背面：郵票在右上角
    const sw = tall ? 64 : 74, sh = tall ? 80 : 92;
    this.stamp = [cw / 2 - 40 - sw, ch / 2 - 40 - sh, sw, sh];
    // 郵票裡的照片：照片焦點附近、跟郵票一樣的比例
    {
      const ar = sw / sh;
      const hPx = 0.45 * Math.min(img.h, img.w / ar), wPx = hPx * ar;
      const cu = wPx / img.w, cv = hPx / img.h;
      const u0 = clamp(ph.fx - cu / 2, 0, 1 - cu), v0 = clamp(ph.fy - cv / 2, 0, 1 - cv);
      this.crop = [u0, v0, u0 + cu, v0 + cv];
    }
    // 字的欄：橫的卡片在左半邊、直的卡片在上半部（郵票左邊）
    const pad = 22;
    const colW = tall ? cw - 2 * 50 - 2 * sw - 30 : cw / 2 - 70, colH = tall ? ch * 0.6 : ch - 2 * 60 - 40;
    this.ink = this.track(inkLayer(colW + 2 * pad, colH + 2 * pad));
    const pen = mixRgba('ink', 'blood', 0.15, 0.92);
    this.col = new TextCol(this.ink, colW, colH, {
      family: F.hand(400), ink: pen, active: mixRgba('blood', 'ink', 0.2), unsung: mixRgba('ink', 'blood', 0.15, 0.28),
      sigInk: mixRgba('ink', 'blood', 0.15, 0.72), rs, lineHeight: 1.4, maxLines: 7,
      label: { family: F.hand(700), size: 24, color: mixRgba('ink', 'blood', 0.15, 0.6), tracking: 3, gap: 18 },
    }, ph, this.ctx, pad);
    // 字在留言區裡上下置中（整塊的高度已經照最長的那句歌詞預留，換句子時不會跳）
    const blockH = this.col.contentH;
    const colLeft = -cw / 2 + 50, colTop = (tall ? ch / 2 - 76 : ch / 2 - 70) - Math.max(0, (colH - blockH) / 2 - 10);
    this.ir = [colLeft - pad, colTop - colH - pad, colW + 2 * pad, colH + 2 * pad];
    this.readAt = tall ? [0, ch * 0.18] : [-cw * 0.2, 0];
    // 翻面：正面先停一下（窗格的三成、至少 0.7 秒），在拍點上翻；留至少 2 秒讀背面。
    // 背面是賓客留言時正面停短一點：導演照留言的字數給窗格的長度，時間要留給讀留言
    if (this.col.has) {
      const dur = end - start, msg = this.col.mode === 'message';
      const want = start + clamp(dur * (msg ? 0.16 : 0.3), 0.7, msg ? 1.8 : 3.2);
      this.tFlip = beatNear(audio, want, start + 0.6, Math.max(start + 0.6, end - 2.2));
      if (end - this.tFlip > 8) this.tFlip2 = beatNear(audio, end - 2.6, end - 3.0, end - 1.6);
    }
    this.back = this.track(inkLayer(cw, ch));
    this.drawBack(cw, ch, tall, toLine, mark);
  }

  /** 背面的印刷與郵戳（畫一次）：POST CARD、中間的分隔線、地址線、收件人、郵戳與銷印線。 */
  private drawBack(cw: number, ch: number, tall: boolean, toLine: string, mark: string) {
    const L = this.back!, c = L.ctx;
    L.clear();
    // 背面座標（卡片中心原點、y 往上）→ 圖層
    const X = (x: number) => x + cw / 2, Y = (y: number) => ch / 2 - y;
    const ink = rgba('sepia', 0.5);
    c.fillStyle = ink; c.strokeStyle = ink;
    c.font = font(F.serif(600), 26); c.letterSpacing = '10px';
    c.fillText('POST CARD', X(-cw / 2 + 50), Y(ch / 2 - 46));
    c.letterSpacing = '0px';
    const [sx, sy, sw, sh] = this.stamp;
    if (!tall) {
      // 中間的分隔線、右邊三條地址線
      c.fillRect(X(-2), Y(ch / 2 - 90), 1.5, ch - 180);
      const x0 = 30, x1 = cw / 2 - 50;
      for (let i = 0; i < 3; i++) c.fillRect(X(x0), Y(-ch * 0.06 - i * 72), x1 - x0, 1.5);
      const fs = fitPx(toLine, F.hand(400), 34, x1 - x0 - 10);
      c.font = font(F.hand(400), fs); c.fillStyle = mixRgba('ink', 'blood', 0.15, 0.85);
      c.fillText(toLine, X(x0 + 6), Y(-ch * 0.06 + 14));
    } else {
      // 地址線在下面三成（上面六成給字）
      const x0 = -cw / 2 + 50, x1 = cw / 2 - 50;
      for (let i = 0; i < 3; i++) c.fillRect(X(x0), Y(-ch * 0.25 - i * 64), x1 - x0, 1.5);
      const fs = fitPx(toLine, F.hand(400), 34, x1 - x0 - 10);
      c.font = font(F.hand(400), fs); c.fillStyle = mixRgba('ink', 'blood', 0.15, 0.85);
      c.fillText(toLine, X(x0 + 6), Y(-ch * 0.25 + 14));
    }
    // 郵戳：圓圈一半壓在郵票上，旁邊三道波浪銷印線
    const pmx = sx - sw * 0.55, pmy = sy - sh * 0.35, r = 62;
    c.save();
    c.strokeStyle = mixRgba('blood', 'sepia', 0.35, 0.62); c.fillStyle = mixRgba('blood', 'sepia', 0.35, 0.62);
    c.lineWidth = 3;
    c.beginPath(); c.arc(X(pmx), Y(pmy), r, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 1.6;
    c.beginPath(); c.arc(X(pmx), Y(pmy), r - 9, 0, Math.PI * 2); c.stroke();
    if (mark) {
      c.font = font(F.mono(600), 17); c.textAlign = 'center'; c.letterSpacing = '1px';
      c.fillText(mark, X(pmx), Y(pmy) + 6);
      drawHeart(c, X(pmx), Y(pmy) - 26, 14, mixRgba('blood', 'sepia', 0.35, 0.62));
    } else drawHeart(c, X(pmx), Y(pmy), 38, mixRgba('blood', 'sepia', 0.35, 0.62));
    c.lineWidth = 2.4;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      for (let k = 0; k <= 40; k++) {
        const x = pmx + r + 8 + k * 4.5, y = pmy + i * 16 + 5 * Math.sin(k * 0.55);
        if (k === 0) c.moveTo(X(x), Y(y)); else c.lineTo(X(x), Y(y));
      }
      c.stroke();
    }
    c.restore();
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    // 正面的畫面往焦點推（很小的舊照片少推）
    const fcrop = picCrop(this.pic!, settleK(lt, 6), { zoom: 1.12, screenW: this.phs[0] * 2 * 0.95 });
    // 進場：卡片從上面落下、轉回來
    const drop = prog(t, s, s + 0.55, ease.inQuad);
    // 翻面：繞卡片的直軸轉 180 度，中間抬起來
    const fp1 = prog(t, this.tFlip, this.tFlip + 0.85, ease.inOutCubic);
    const fp2 = prog(t, this.tFlip2, this.tFlip2 + 0.85, ease.inOutCubic);
    const fp = fp2 > 0 ? fp2 : fp1;
    const th = Math.PI * (fp1 + fp2);
    const lift = 230 * Math.sin(Math.PI * fp) + lerp(260, 0, drop) + 1;
    const yaw = this.ang + 0.12 * (1 - drop) + 0.05 * Math.sin(Math.PI * fp);
    const cy0 = Math.cos(yaw), sy0 = Math.sin(yaw);
    // 卡片的 x 軸繞 y 軸翻、再整張轉 yaw
    const ex = new THREE.Vector3(Math.cos(th), 0, -Math.sin(th));
    const ax = new THREE.Vector3(ex.x * cy0, ex.x * sy0, ex.z);
    const ay = new THREE.Vector3(-sy0, cy0, 0);
    (u.cc!.value as THREE.Vector3).set(0, 0, lift);
    (u.cx!.value as THREE.Vector3).copy(ax);
    (u.cy!.value as THREE.Vector3).copy(ay);
    (u.chs!.value as THREE.Vector2).set(...this.chs);
    (u.phHS!.value as THREE.Vector2).set(...this.phs);
    u.photo!.value = this.pic!.tex;
    (u.fcrop!.value as THREE.Vector4).set(...fcrop);
    u.photoTpw!.value = texPerWorld(this.pic!.img, this.phs[0] * 2, fcrop);
    (u.stamp!.value as THREE.Vector4).set(...this.stamp);
    (u.crop!.value as THREE.Vector4).set(...this.crop);
    u.back!.value = this.back!.texture;
    u.inkOn!.value = this.col!.draw(t) ? 1 : 0;
    u.ink!.value = this.ink!.texture;
    (u.inkRect!.value as THREE.Vector4).set(...this.ir);
    // 鏡頭：斜上方，很慢地推近；翻過來以後往背面要讀的地方靠一點
    const dir = hash(this.seed, 5) < 0.5 ? 1 : -1;
    const back = prog(t, this.tFlip + 0.2, this.tFlip + 1.4, ease.inOutCubic) * (1 - prog(t, this.tFlip2, this.tFlip2 + 1.0, ease.inOutCubic));
    const rx = this.readAt[0] * Math.cos(yaw) * back, ry = this.readAt[1] * back;
    // 看正面的時候往照片上的焦點靠一點（翻到背面讀字時回來；沒有字、不翻面時靠多一點）
    const [fx, fy] = focusAt(this.pic!, fcrop, [0, 0], this.phs, yaw);
    const lean = 0.24 * (settle(lt, 6) * (1 - prog(t, this.tFlip - 0.3, this.tFlip + 0.6)) + settle(t - this.tFlip2, 3));
    const target: V3 = [rx * 0.5 + lean * fx, ry * 0.5 + 10 + lean * fy, 0];
    const dist = (CAM_FOCAL / 0.95) * (1.06 - 0.06 * ease.outCubic(prog(t, s, s + 1))) * (1 - 0.05 * settle(lt, 7)) * (1 + 0.05 * Math.sin(Math.PI * fp));
    this.cam.orbit(target, dist, 68 + 3 * settle(lt, 8), 5 * dir, 30, -1.5 * dir);
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    u.noiseTex!.value = this.noise;
    u.focusD!.value = this.cam.depth([target[0], target[1], lift * 0.6]);
    u.aper!.value = 14;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.34 };
  }
}
