// 照片版面「紀念冊」（亮）：一本攤開的紀念冊，亮面印刷的內頁上印著照片（細細的黑框線、頁碼、頁首的相簿名），
// 旁邊的空白處像同學拿彩色筆斜斜地寫下的留言——
//  - 鏡頭從右邊低低地橫移進來、停在照片與留言之間，很慢地推近；遠的頁緣與桌墊在焦外，亮面的紙上有一道窗光的反光。
//  - 「同學的留言」：主字（賓客留言＋署名，或新人的註解）一個字一個字寫出來，寫完補一條底線、一個指向照片的小箭頭與一顆星星；
//    歌詞小一號寫在下面跟唱。沒有主字時歌詞自己當主字斜斜地寫在同一個位置（沒有底線與箭頭）；兩個都沒有就只有照片（在頁面中間）。
//  - 照片印在頁上，很小的舊照片最多放大到原尺寸約 1.5 倍；印好的畫面慢慢往焦點（新人點的臉）推，鏡頭也往那邊靠一點。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE, type Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, settle, type Pic, type V3, CAM_FOCAL } from './_p3';
import { loadWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'album', paper: true, energy: [0, 0.85], bars: [2, 8], weight: 1, prefers: ['landscape', 'square'] };

/** 頁面頂面高度、書溝的 x、右頁的寬、頁的高。 */
const T = 10, GX = -880, PW = 1720, PH = 1240;

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D photo; uniform sampler2D note; uniform sampler2D page;
  uniform vec4 ph; uniform float photoTpw; uniform vec4 crop;
  uniform vec4 nRect; uniform float nAng; uniform float noteOn;
  uniform vec4 pRect;
  uniform vec2 gloss;
  const vec3 LD = normalize(vec3(-0.55, 0.35, 1.0));

  float sheen(vec3 r) {
    if (r.z <= 0.0) return 0.0;
    vec2 w = r.xy / r.z - gloss;
    vec2 q = rot2(-0.6) * (w - vec2(-0.55, 0.9)) / vec2(0.18, 0.75);
    return exp(-dot(q, q) * 1.6);
  }
  float pool(vec2 p) {
    vec2 q = (p - vec2(-100.0, 80.0)) / vec2(1500.0, 1100.0);
    return exp(-dot(q, q) * 1.3);
  }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    vec3 bA = vec3(${GX - PW}.0, ${-PH / 2}.0, 0.0), bB = vec3(${GX + PW}.0, ${PH / 2}.0, ${T}.0);
    vec2 hb = boxHit(ro, rd, bA, bB);
    vec3 col;
    if (hb.x < hb.y && hb.x > 0.0) {
      vec3 P = ro + rd * hb.x;
      vec3 n = boxNormal(P, bA, bB);
      float depth = hb.x * dot(rd, camF), coc = cocAt(depth);
      float wpp = wppAt(hb.x, rd, n);
      vec4 nn = nz(P.xy, 900.0, wpp, coc);
      vec3 alb = mix(C_BONE, C_PAPER, 0.35) * 0.93 * (0.985 + 0.02 * (nn.r - 0.5));
      if (n.z < 0.5) {
        // 頁緣：一層一層的紙
        col = alb * 0.78 * (0.94 + 0.06 * sin(P.z * 6.0));
      } else {
        float gx = P.x - ${GX}.0;
        float ao = 1.0 - 0.5 * exp(-abs(gx) / 34.0) - 0.16 * exp(-abs(gx) / 220.0);
        // 印刷：頁首、頁碼、細線（靜態的一張圖層）
        vec2 puv = vec2((P.x - pRect.x) / pRect.z, (P.y - pRect.y) / pRect.w);
        vec4 pc = inkAt(page, puv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
        alb = alb * (1.0 - pc.a) + pc.rgb;
        // 照片：細黑框線
        vec2 q = P.xy - ph.xy;
        float d = sdBox(q, ph.zw);
        alb = mix(alb, C_SEPIA * 0.6, (1.0 - smoothstep(0.7, 1.7 + coc, abs(d - 1.2))) * 0.8);
        float a = 1.0 - smoothstep(-0.6 - coc * 0.5, 0.6 + coc * 0.5, d);
        if (a > 0.0) {
          vec2 uv = vec2(q.x + ph.z, ph.w - q.y) / (2.0 * ph.zw);
          alb = mix(alb, photoAt(photo, cropUv(uv, crop), lodFor(photoTpw, wpp, coc)), a);
        }
        // 同學的留言（斜的一張字層）
        if (noteOn > 0.5) {
          vec2 nq = rot2(nAng) * (P.xy - nRect.xy);
          vec2 nuv = nq / (2.0 * nRect.zw) + 0.5;
          vec4 ic = inkAt(note, nuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
          alb = alb * (1.0 - ic.a) + ic.rgb;
        }
        float lt = 0.6 + 0.36 * pool(P.xy);
        col = alb * ao * lt;
        // 亮面紙的反光：一道窗光（不蓋過照片）
        col += mix(C_BONE, C_PAPER, 0.4) * 0.07 * sheen(reflect(rd, n)) * ao;
      }
    } else {
      // 桌墊：灰綠色的絨布（固定色 gingham），很細的毛
      float tt = hitZ(ro, rd, 0.0);
      vec3 P = ro + rd * tt;
      float depth = tt * dot(rd, camF), coc = cocAt(depth);
      float wpp = wppAt(tt, rd, vec3(0.0, 0.0, 1.0));
      vec4 nn = nz(P.xy, 600.0, wpp, coc);
      vec3 alb = mix(C_GINGHAM, C_INK2, 0.55) * (0.9 + 0.12 * (nn.b - 0.5) + 0.1 * (nn.r - 0.5));
      // 紀念冊的影子
      float sd = sdBox(P.xy - vec2(${GX}.0, 0.0) + LD.xy / LD.z * 8.0, vec2(${PW}.0, ${PH / 2}.0));
      alb *= 1.0 - 0.5 * (1.0 - smoothstep(-10.0, 40.0, sd));
      col = alb * (0.55 + 0.35 * pool(P.xy));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  photo: { value: null }, note: { value: null }, page: { value: null },
  ph: { value: new THREE.Vector4() }, photoTpw: { value: 1 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  nRect: { value: new THREE.Vector4() }, nAng: { value: 0 }, noteOn: { value: 0 },
  pRect: { value: new THREE.Vector4() }, gloss: { value: new THREE.Vector2() },
});

/** 印刷那張圖層蓋住的範圍（世界座標：左下角、寬高）。 */
const PR: [number, number, number, number] = [GX + 20, -PH / 2 + 20, PW - 40, PH - 40];

export default class Yearbook extends Scene {
  bg = shared('yearbook.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  pic: Pic | null = null;
  noise: THREE.Texture | null = null;
  note: Layer2D | null = null;
  page = this.track(inkLayer(PR[2], PR[3]));
  col: TextCol | null = null;
  pc: [number, number] = [0, 0];
  hs: [number, number] = [300, 200];
  /** 留言圖層的中心、半寬高、轉角。 */
  nr: [number, number, number, number] = [0, 0, 0, 0];
  nAng = 0;
  dir = 1;
  /** 讀的時候鏡頭看哪裡。 */
  aim: [number, number] = [0, 0];

  override async init() {
    const { renderer, start } = this.ctx;
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    const pageNo = `— ${String(ph.n).padStart(2, '0')} —`;
    await loadText(`${ph.caption}${ph.album}${pageNo}`);
    await loadWords(this.ctx);
    this.pic = await loadPic(renderer, ph);
    this.track(this.pic.tex);
    this.noise = p3Noise(renderer);
    this.dir = hash(this.seed, 2) < 0.5 ? 1 : -1;
    const { img } = this.pic;
    // 讀的時候一個世界單位約 0.95 個畫面 px：字級照這個換算
    const rs = 0.95;
    const colW = 580, colH = 540, pad = 26, padL = 170;
    this.note = this.track(inkLayer(colW + pad + padL, colH + 2 * pad));
    const pen = mixRgba('blood', 'ink', 0.18, 0.95);
    this.col = new TextCol(this.note, colW, colH, {
      family: F.hand(700), ink: pen, active: mixRgba('signal', 'blood', 0.5), unsung: mixRgba('blood', 'ink', 0.18, 0.3),
      sigInk: mixRgba('blood', 'ink', 0.18, 0.78), sigFamily: F.hand(400),
      // 留言在畫面前面一點、鏡頭還會推近：字級抓小一號，畫面上才是 40～50 px
      rs, size: [38, 48], lineHeight: 1.36, maxLines: 5,
      // 主字（署名）跟歌詞之間留底線與星星的位置
      gap: 52,
    }, ph, this.ctx, pad, padL);
    const hasText = this.col.has;
    const [w, h] = picSize(img, hasText ? 820 : 1080, hasText ? 640 : 660, rs);
    this.hs = [w / 2, h / 2];
    // 照片在左、留言在右（世界 y 往上）；沒有字時照片在中間
    const gap = 120;
    const groupW = hasText ? w + gap + colW : w;
    const x0 = -groupW / 2 + 20;
    this.pc = [x0 + w / 2, 20];
    this.nAng = -(4 + 3 * hash(this.seed, 3)) * (Math.PI / 180);
    const lw = colW + pad + padL, lh = colH + 2 * pad;
    const textH = this.col.contentH;
    // 留言圖層的中心：字從左上角開始寫，整塊跟照片中心對齊
    const nx = x0 + w + gap + colW / 2 - (padL - pad) / 2;
    const ny = this.pc[1] - (lh / 2 - pad - textH / 2) + 10;
    this.nr = [nx, ny, lw / 2, lh / 2];
    this.aim = hasText ? [x0 + groupW / 2, 20] : [this.pc[0], 20];
    // 註解在鏡頭停下來之前就開始寫
    if (this.col.fit) {
      this.col.writeFrom = start + 0.45;
      this.col.writeTo = this.col.writeFrom + Math.min(2.2, 0.075 * this.col.chars + 0.35);
      this.addPen(pad, padL, gap, pen);
    }
    this.drawPage(pageNo, hasText);
  }

  /** 寫完之後補的筆畫：底線、指向照片的小箭頭、一顆星星（畫在留言圖層上，跟著留言一起斜；底線在主字或署名的下面）。 */
  private addPen(pad: number, padL: number, gap: number, pen: string) {
    const col = this.col!, fit = col.fit!;
    const t0 = col.writeTo + 0.1;
    const lastW = (() => { const c = this.note!.ctx; c.font = font(F.hand(700), fit.size); return c.measureText(fit.lines[fit.lines.length - 1]!).width; })();
    const yLast = pad + col.text.mainH - 4;
    const y0 = pad + fit.size * 0.5;
    col.deco = {
      sig: (t) => `${Math.round(clamp((t - t0) / 0.9) * 60)}`,
      draw: (c, t) => {
        const k = clamp((t - t0) / 0.9);
        if (k <= 0) return;
        c.save();
        c.strokeStyle = pen; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 3.4;
        // 底線：微微上揚的一筆
        const u = clamp(k / 0.4);
        if (u > 0) {
          c.beginPath();
          c.moveTo(padL - 4, yLast + 16);
          c.quadraticCurveTo(padL + lastW * 0.5, yLast + 22, padL - 4 + (lastW + 16) * u, yLast + 12 - 6 * u);
          c.stroke();
        }
        // 小箭頭：從第一行左邊彎向照片
        const v = clamp((k - 0.35) / 0.4);
        if (v > 0) {
          const ax = padL - 22, ay = y0, bx = padL - gap + 22, by = y0 + 60;
          const n = Math.max(2, Math.round(24 * v));
          c.beginPath();
          for (let i = 0; i <= n; i++) {
            const s = (i / 24);
            const x = lerp(ax, bx, s), y = lerp(ay, by, s) - 46 * Math.sin(Math.PI * s);
            if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
          }
          c.stroke();
          if (v >= 1) {
            const a = Math.atan2(by - (lerp(ay, by, 0.92) - 46 * Math.sin(Math.PI * 0.92)), bx - lerp(ax, bx, 0.92));
            c.beginPath();
            c.moveTo(bx + 16 * Math.cos(a + 2.5), by + 16 * Math.sin(a + 2.5));
            c.lineTo(bx, by);
            c.lineTo(bx + 16 * Math.cos(a - 2.5), by + 16 * Math.sin(a - 2.5));
            c.stroke();
          }
        }
        // 星星：底線尾巴後面
        const w2 = clamp((k - 0.75) / 0.25);
        if (w2 > 0) {
          const sx = padL + lastW + 40, sy = yLast + 8, r = 14 * ease.outBack(w2);
          c.beginPath();
          for (let i = 0; i <= 10; i++) {
            const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r;
            if (i === 0) c.moveTo(sx + rr * Math.cos(a), sy + rr * Math.sin(a)); else c.lineTo(sx + rr * Math.cos(a), sy + rr * Math.sin(a));
          }
          c.stroke();
        }
        c.restore();
      },
    };
  }

  /** 頁面的印刷（不會變，畫一次）：頁首細線＋相簿名、頁碼。 */
  private drawPage(pageNo: string, hasText: boolean) {
    const L = this.page, c = L.ctx;
    L.clear();
    // 世界 → 圖層：左下角 PR
    const X = (x: number) => x - PR[0], Y = (y: number) => PR[1] + PR[3] - y;
    const ink = rgba('sepia', 0.55);
    c.fillStyle = ink;
    c.fillRect(X(GX + 150), Y(PH / 2 - 120), PW - 300, 1.5);
    c.font = font(F.mono(400), 20);
    c.letterSpacing = '6px';
    c.textAlign = 'center';
    c.fillText(pageNo, X(GX + PW / 2), Y(-PH / 2 + 90));
    const ph = this.photo;
    if (hasText && ph.chapter && ph.album) {
      c.textAlign = 'left';
      c.font = font(F.ming(700), 24);
      c.fillStyle = rgba('sepia', 0.7);
      let s = ph.album;
      while (s.length > 1 && c.measureText(s).width > 700) s = s.slice(0, -1);
      c.fillText(s === ph.album ? s : `${s}…`, X(GX + 150), Y(PH / 2 - 100));
    }
    c.letterSpacing = '0px';
    c.textAlign = 'left';
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    // 印好的照片往焦點推；鏡頭也往焦點靠一點（有字時少靠，字才一直在畫面裡）
    const crop = picCrop(this.pic!, settleK(lt, 6), { zoom: 1.18, screenW: this.hs[0] * 2 * 0.95 });
    const [fx, fy] = focusAt(this.pic!, crop, this.pc, this.hs);
    const lean = (this.col!.has ? 0.15 : 0.4) * settle(lt, 6);
    // 鏡頭：從右邊低低地橫移進來，停在照片與留言之間，之後很慢地推近、繼續漂一點點
    const m = ease.outCubic(prog(t, s, s + 1.6));
    const d = this.dir;
    const target: V3 = [this.aim[0] + lerp(260 * d, 0, m) - 30 * d * settle(lt, 9) + lean * (fx - this.pc[0]), this.aim[1] + lerp(-40, 0, m) + lean * (fy - this.pc[1]), T];
    const dist = (CAM_FOCAL / 0.95) * lerp(1.1, 1, m) * (1 - 0.045 * settle(lt, 7));
    this.cam.orbit(target, dist, lerp(44, 52, m), lerp(16 * d, 7 * d, m) - 2 * d * settle(lt, 9), 30, lerp(-2.2, -0.8, m) * d);
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    u.photo!.value = this.pic!.tex;
    (u.ph!.value as THREE.Vector4).set(this.pc[0], this.pc[1], this.hs[0], this.hs[1]);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoTpw!.value = texPerWorld(this.pic!.img, this.hs[0] * 2, crop);
    u.noteOn!.value = this.col!.draw(t) ? 1 : 0;
    u.note!.value = this.note!.texture;
    (u.nRect!.value as THREE.Vector4).set(...this.nr);
    u.nAng!.value = this.nAng;
    u.page!.value = this.page.texture;
    (u.pRect!.value as THREE.Vector4).set(...PR);
    (u.gloss!.value as THREE.Vector2).set(0.25 * (1 - m) * d, 0);
    u.noiseTex!.value = this.noise;
    u.focusD!.value = this.cam.depth([this.aim[0], this.aim[1], T]);
    u.aper!.value = 34;
    u.k!.value = (0.88 + 0.12 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.36 };
  }
}
