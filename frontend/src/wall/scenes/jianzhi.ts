// 照片版面「紅色窗花」（亮）：白天的木窗，玻璃上貼著一張紅色剪紙窗花，照片貼在窗花正中間的開口裡——
//  - 窗花是正紅的紙（固定色 collar，不跟主題換），四面對稱：內圈一排鋸齒紋、中間一圈月牙紋（一正一反）、外圈小圓點、
//    外緣是波浪的花邊，四個角各一朵八瓣的團花。窗外的天光從背後透過來：鏤空的地方透出暖白的光，紅紙本身也被照得透亮、看得到紙的纖維。
//  - 切進來：窗花還是摺著的（只有右下四分之一），第一個拍點上半片翻上來、下一個拍點左半片翻開——剪紙攤開的那一下；
//    照片從頭到尾都在開口裡，完整、不被紙蓋到（紙只壓在照片的白邊外面）。
//  - 之後鏡頭很慢地往照片的焦點推近（焦點往畫面中間移一點），開口裡的照片也往焦點推；窗外的雲走過，天光慢慢變亮變暗，
//    玻璃上有很淡的樹影在晃；每個小節線天光亮一下。
//  - 字手寫在右邊另一扇玻璃上的一張紅紙卡上（墨色，紅紙一樣透光；卡只比字大一點，字多卡就長高）：主字（賓客留言＋署名，
//    或新人的註解）一個字一個字寫出來，歌詞小一號在下面跟唱（正在唱的字是金色）；沒有主字時歌詞自己寫在卡上跟唱；
//    兩個都沒有就只有窗花（在畫面正中間、大一點）。相簿的第一張在字上面多一行小小的相簿名。
// 畫法：一個全螢幕 shader。窗花是四面對稱的距離場（取絕對值折到一個象限算圖案），攤開是兩個翻面：
// 上半片繞水平摺線翻（cos 壓扁＋一點透視）、左半片繞垂直摺線翻；紅紙卡與字在同一個 shader 裡取樣字層。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { beatAfter } from './_motifs';
import { Caption, P6_GLSL, P6_POST, P6_UNIFORMS, fitPhoto, focusAmp, focusAt, focusCam, loadPhoto, p6Crop, pace, photoLod, setP6Photo, type FocusCamOpts } from './_p6';
import { focusCrop, settleK } from './_photo';
import type { PhotoImage } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'craft', paper: true, prefers: ['square', 'portrait'], energy: [0, 1], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${P6_GLSL}
  uniform sampler2D photo; uniform sampler2D tl;
  uniform vec3 cam;
  uniform vec2 mc;          // 窗花中心
  uniform vec2 phHS; uniform float pbw; uniform float band; uniform float lod;
  uniform float fh; uniform float fv;   // 上半片、左半片翻到哪裡（π = 摺著，0 = 攤平）
  uniform float mull;       // 中間直櫺的 x（沒有就是負的）
  uniform vec4 card; uniform float cardAng; uniform float cardA; uniform vec4 tlR; uniform float textK;
  uniform float sun; uniform float t; uniform float k;

  // ---- 窗花的圖案：a = 折到第一象限的座標（距離場：正的是紙）
  float pattern(vec2 a) {
    vec2 Hi = phHS + vec2(pbw - 4.0);
    // 內緣：照片外框的圓角矩形；n = 離內緣多遠
    vec2 qi = a - (Hi - 14.0);
    float dIn = length(max(qi, 0.0)) + min(max(qi.x, qi.y), 0.0) - 14.0;
    float n = dIn / band;
    // 這一點在哪一條邊上（直邊用 y、橫邊用 x 當沿著邊的座標）
    bool side = (a.x - Hi.x) > (a.y - Hi.y);
    float s = side ? a.y : a.x;
    bool corner = a.x > Hi.x - 2.0 && a.y > Hi.y - 2.0;
    // 外緣的波浪花邊
    float P4 = 26.0;
    float scal = 7.0 * abs(sin(s * 3.14159 / P4));
    float outer = band - 4.0 + (corner ? 0.0 : scal);
    vec2 C = Hi + vec2(band * 0.5);
    float rr = length(a - C);
    float sd = min(dIn, outer - dIn);
    // 角上是圓的（團花的外形）
    if (corner) sd = min(dIn, band * 0.62 + 6.0 * abs(sin(atan(a.y - C.y, a.x - C.x) * 6.0)) - rr);
    sd = max(sd, min(dIn, band * 0.3 - rr));
    float hole = 1e3;
    if (corner) {
      // 團花：中心一個圓、八片水滴形的花瓣、外面一圈小點
      hole = min(hole, length(a - C) - band * 0.07);
      float ang = atan(a.y - C.y, a.x - C.x);
      float seg = 6.28318 / 8.0;
      float ai = (floor(ang / seg) + 0.5) * seg;
      vec2 pd = rot2(ai) * (a - C);
      vec2 pq = vec2(pd.x - band * 0.24, pd.y);
      hole = min(hole, max(length(pq * vec2(0.55, 1.0)) - band * 0.065, -pd.x + band * 0.13));
      vec2 dd = rot2(ai + seg * 0.5) * (a - C);
      hole = min(hole, length(dd - vec2(band * 0.44, 0.0)) - band * 0.035);
    } else {
      // 鋸齒紋：靠內緣一排三角形的洞
      float P1 = 22.0;
      float u1 = (fract(s / P1 + 0.5) - 0.5) * P1;
      float w1 = dIn - band * 0.09, h1 = band * 0.16;
      hole = min(hole, max(max(-w1, w1 - h1), abs(u1) - 0.4 * P1 * (1.0 - w1 / h1)));
      // 月牙紋：中間一圈，一正一反
      float P2 = band * 0.62;
      float ci = floor(s / P2 + 0.5);
      float u2 = s - ci * P2;
      float v2 = dIn - band * 0.52;
      float dir = mod(ci, 2.0) < 0.5 ? 1.0 : -1.0;
      float r2 = band * 0.17;
      vec2 cq = vec2(u2, v2);
      float moon = max(length(cq) - r2, -(length(cq - vec2(0.0, dir * r2 * 0.45)) - r2 * 0.86));
      hole = min(hole, moon);
      // 月牙之間的小菱形
      vec2 dq = vec2(u2 - P2 * 0.5 * sign(u2 + 1e-4), v2);
      hole = min(hole, (abs(dq.x) + abs(dq.y)) * 0.7071 - band * 0.05);
      // 外圈的小圓點
      float P3 = 18.0;
      float u3 = (fract(s / P3 + 0.5) - 0.5) * P3;
      hole = min(hole, length(vec2(u3, dIn - band * 0.83)) - 3.4);
    }
    return min(sd, hole);
  }

  void main() {
    vec2 sp = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 wp = cam.xy + (sp - vec2(${W / 2}.0, ${H / 2}.0)) / cam.z;
    // ---- 窗外的天光（玻璃）：暖白、上面亮一點，很淡的樹影在晃
    float leaf = fbm(wp / 260.0 + vec2(t * 0.05, sin(t * 0.7) * 0.04), 3);
    float B = sun * (0.92 + 0.08 * smoothstep(1100.0, 0.0, wp.y)) * (1.0 - 0.04 * smoothstep(0.0, 0.6, leaf));
    vec3 glass = mix(C_BONE * 0.84, mix(C_BONE, C_GINGHAM, 0.3) * 0.74, 0.22 * smoothstep(0.0, 0.7, leaf)) * B;
    vec3 col = glass;

    // ---- 照片：貼在玻璃上（屋裡的光照在正面，比背光暗一點），白邊
    vec2 q = wp - mc;
    vec2 po = phHS + vec2(pbw);
    float pa = aaFill(sdBox(q, po));
    vec3 pc = C_BONE * 0.86;
    vec2 uv = (q + phHS) / (2.0 * phHS);
    pc = mix(pc, p6Photo(photo, uv, lod), aaFill(sdBox(q, phHS)));
    col = mix(col, pc, pa);

    // ---- 窗花：攤開的兩個翻面。右下四分之一固定；上半片繞 y = 0、左半片繞 x = 0 翻
    float paper = -1e3; float flip = 1.0;
    {
      // 固定的那一片（x >= 0, y >= 0），或已經攤開的部分
      vec2 a = q;
      // 左半片：cos(fv) > 0 時在左邊（x < 0），< 0 時蓋在右半邊上
      float cv = cos(fv), ch = cos(fh);
      float sv = cv >= 0.0 ? max(cv, 0.02) : min(cv, -0.02);
      float sh = ch >= 0.0 ? max(ch, 0.02) : min(ch, -0.02);
      // 右半邊（自己）：下面一半一定在；上面一半要等上半片翻上來
      float pr = -1e3;
      if (q.x >= 0.0) {
        if (q.y >= 0.0) pr = pattern(abs(q));
        // 上半片（右半邊的）：y = -v·cos(fh)
        float v = -q.y / sh;
        if (v >= 0.0) {
          float px = 1.0 + 0.12 * sin(fh) * clamp(v / (phHS.y + band), 0.0, 1.0);
          float pf = pattern(abs(vec2(q.x / px, v)));
          if (pf > pr) { pr = pf; if (ch < 0.0) flip = 0.8; }
        }
      }
      paper = pr;
      // 左半片（含它自己的上下兩片；上下已經攤開才翻左右）
      float u = -q.x / sv;
      if (u >= 0.0) {
        float px = 1.0 + 0.12 * sin(fv) * clamp(u / (phHS.x + band), 0.0, 1.0);
        vec2 lq = vec2(u, q.y / px);
        float pl = lq.y >= 0.0 || fh < 0.01 ? pattern(abs(lq)) : -1e3;
        if (pl > paper) { paper = pl; flip = cv < 0.0 ? 0.8 : 0.92 + 0.08 * cv; }
      }
    }
    float ca = smoothstep(-0.7, 0.7, paper);
    // 紅紙：背光透過來（纖維看得到），邊緣（紙的厚度）暗一點
    float fib = fbm(wp / 18.0, 2) * 0.5 + p6Fiber(wp * 1.6) * 0.5;
    vec3 red = mix(C_COLLAR * 0.42, C_COLLAR * 1.02 + vec3(0.06, 0.012, 0.0), clamp(B * (0.82 + 0.3 * fib), 0.0, 1.2));
    red *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 2.0, paper));
    col = mix(col, red * flip, ca);

    // ---- 窗框：深色的木頭，四邊＋中間一根直櫺（窗戶分成兩扇）
    vec3 wood = mix(C_FUR, C_SEPIA, 0.5) * 0.75;
    float wg = snoise(vec2(wp.x / 3.0, wp.y / 160.0)) * 0.5 + 0.5;
    float fr = min(min(wp.x - 58.0, ${W - 58}.0 - wp.x), min(wp.y - 46.0, ${H - 40}.0 - wp.y));
    float mullD = mull > 0.0 ? abs(wp.x - mull) - 20.0 : 1e3;
    float fd = min(fr, mullD);
    float fa = 1.0 - smoothstep(-0.8, 0.8, fd);
    vec3 wc = wood * (0.9 + 0.12 * wg) * (1.0 + 0.18 * smoothstep(-8.0, 0.0, fd) * smoothstep(0.0, -3.0, fd));
    // 窗框在玻璃上的一圈軟影（框比玻璃凸出來）
    col *= 1.0 - 0.18 * exp(-max(fd, 0.0) / 10.0) * (1.0 - fa);
    col = mix(col, wc, fa);

    // ---- 紅紙卡（右邊那扇玻璃）＋字
    if (card.z > 0.0) {
      vec2 cq = rot2(cardAng) * (wp - card.xy);
      float cd = sdBox(cq, card.zw);
      float cc = aaFill(cd);
      vec3 cr = red * (1.0 - 0.25 * (1.0 - smoothstep(0.0, 2.0, -cd)));
      vec4 tx = p6Layer(tl, cq + card.zw - tlR.xy, tlR.zw) * textK;
      cr = cr * (1.0 - tx.a) + tx.rgb;
      col = mix(col, cr, cc * cardA);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...P6_UNIFORMS(),
  photo: { value: null }, tl: { value: null }, cam: { value: new THREE.Vector3(W / 2, H / 2, 1) },
  mc: { value: new THREE.Vector2() }, phHS: { value: new THREE.Vector2() }, pbw: { value: 12 }, band: { value: 140 }, lod: { value: 0 },
  fh: { value: 0 }, fv: { value: 0 }, mull: { value: -1 },
  card: { value: new THREE.Vector4() }, cardAng: { value: 0 }, cardA: { value: 0 }, tlR: { value: new THREE.Vector4(0, 0, 1, 1) }, textK: { value: 0 },
  sun: { value: 1 }, t: { value: 0 }, k: { value: 1 },
});

/** 開口裡的照片往焦點推到幾倍；鏡頭再推近 4%、焦點往畫面中間移兩成。 */
const PUSH = 1.15;
const FOCUS: FocusCamOpts = { zoom: 1.04, pull: 0.2 };

export default class Jianzhi extends Scene {
  bg = shared('jianzhi.bg', BG);
  // 字：紅紙卡上寬 460、最多六行（60 字的留言＋署名＋歌詞也放得下），整塊最高 500（卡最高到 HUD 上面）
  cap = this.track(new Caption(460, 500, {
    family: F.hand(700), align: 'left', lineHeight: 1.38, maxLines: 6,
    ink: rgba('ink', 0.88), active: mixRgba('fur', 'bone', 0.45), unsung: rgba('ink', 0.3), label: rgba('ink', 0.55), labelFamily: F.hand(700),
  }));
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  mx = W / 2; my = H / 2; phw = 100; phh = 100; pbw = 12; band = 140;
  cardX = 0; cardY = 0; cardW = 0; cardH = 0; cardAng = 0;
  t1 = 0; t2 = 0; kp = 1;
  /** 紅紙卡貼上去、拿下來的時間（跟著字：不要先擺一張空白的卡）。 */
  span: [number, number] = [Infinity, Infinity];
  /** 焦點（開口裡的照片推到底時在世界座標的位置）與鏡頭往那裡推的幅度（紅紙卡不能被推出安全區）。 */
  foc: [number, number] = [W / 2, H / 2];
  amp = 1;

  override async init() {
    const { ph, img, tex } = await loadPhoto(this.ctx, (x) => this.track(x));
    this.img = img; this.tex = tex;
    const { start, audio } = this.ctx;
    const cap = this.cap;
    cap.setup(this.ctx, ph);
    const { w, h } = img;
    this.mx = cap.has ? 618 : W / 2;
    this.my = cap.has ? 532 : 540;
    // 窗花的大小：照片＋白邊＋兩邊的花邊要放進左邊那扇（有字）或整扇窗
    const maxW = cap.has ? 960 : 1560, maxH = 900;
    let band = 140;
    let s = fitPhoto(w, h, maxW - 2 * (band + 12), maxH - 2 * (band + 12));
    band = clamp(0.2 * Math.min(w * s, h * s) + 40, 112, 150);
    s = fitPhoto(w, h, maxW - 2 * (band + 12), maxH - 2 * (band + 12));
    this.band = band;
    this.phw = (w * s) / 2; this.phh = (h * s) / 2;
    this.pbw = clamp(0.03 * Math.min(w * s, h * s), 10, 16);
    if (cap.has) {
      // 紅紙卡：只比字大一點，貼在右邊那扇玻璃的中間偏上
      this.cardW = cap.blockW / 2 + 44; this.cardH = cap.blockH / 2 + 40;
      this.cardX = clamp(1490, 1240 + this.cardW, 1790 - this.cardW);
      this.cardY = clamp(470, 130 + this.cardH, 790 - this.cardH);
      this.cardAng = (hash(this.seed, 9) * 2 - 1) * 1.6 * (Math.PI / 180);
    }
    const rect = [this.mx - this.phw, this.my - this.phh, this.mx + this.phw, this.my + this.phh];
    this.foc = focusAt(ph, focusCrop(ph, w, h, w / h, 1, { zoom: PUSH, screenW: 2 * this.phw }), rect);
    // 紙卡稍微斜、進場從右邊滑進來：四邊多留一點
    const m = 14;
    this.amp = cap.has ? focusAmp(this.foc, FOCUS, [[this.cardX - this.cardW - m, this.cardY - this.cardH - m, this.cardX + this.cardW + m, this.cardY + this.cardH + m]]) : 1;
    this.kp = pace(this.ctx);
    // 攤開：第一個拍點翻上半片、下一個拍點翻左半片（窗格短就不等拍點）
    this.t1 = Math.min(beatAfter(audio, start + 0.15), start + 0.6 * this.kp);
    this.t2 = Math.min(beatAfter(audio, this.t1 + 0.35 * this.kp), this.t1 + 0.6 * this.kp);
    cap.writeAt(this.t2 + 0.3 * this.kp, 2.0);
    this.span = cap.span(this.ctx);
    // 歌詞：窗花攤開以後紙卡才貼上去（不要窗花還摺著就先冒出一張卡）
    if (!cap.hasMain) this.span[0] = Math.max(this.span[0], this.t2 + 0.2 * this.kp);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, kp = this.kp;
    const u = this.bg.u;
    // 開口裡的照片往焦點推
    const crop = p6Crop(this.ctx, this.img!, t, { zoom: PUSH, screenW: 2 * this.phw });
    setP6Photo(u, this.ctx.params.photo, crop);
    const fh = Math.PI * (1 - ease.inOutCubic(prog(t, this.t1, this.t1 + 0.42 * kp)));
    const fv = Math.PI * (1 - ease.inOutCubic(prog(t, this.t2, this.t2 + 0.42 * kp)));
    u.fh!.value = fh; u.fv!.value = fv;
    // 鏡頭：一開始快、之後越來越慢地往照片的焦點推近（焦點往畫面中間移一點）
    (u.cam!.value as THREE.Vector3).set(...focusCam(this.foc, settleK(t - s, 6) * this.amp, FOCUS));
    const z = (u.cam!.value as THREE.Vector3).z;
    (u.mc!.value as THREE.Vector2).set(this.mx, this.my);
    (u.phHS!.value as THREE.Vector2).set(this.phw, this.phh);
    u.pbw!.value = this.pbw; u.band!.value = this.band;
    u.photo!.value = this.tex;
    u.lod!.value = photoLod(this.img!.w * (crop[2] - crop[0]), 2 * this.phw * z);
    u.mull!.value = this.cap.has ? 1172 : -1;
    // 天光：雲慢慢走過；每個小節線亮一下
    const bar = audio.timeOfBar(Math.floor(audio.barAt(t)));
    const flash = bar > s ? Math.exp(-Math.max(0, t - bar) / 0.4) : 0;
    u.sun!.value = (0.9 + 0.08 * Math.sin(t * 0.35 + hash(this.seed, 3) * 6) + 0.06 * flash) * (0.85 + 0.15 * ease.outCubic(prog(t, s, s + 0.6)));
    u.t!.value = t;
    const cap = this.cap;
    if (cap.has) {
      cap.draw(t);
      u.tl!.value = cap.L.texture;
      // 紙卡跟著字出現：從右邊一點點滑進來貼上，字收掉時淡出
      const [a, b] = this.span;
      const kin = ease.outCubic(prog(t, a - 0.35, a)), kout = prog(t, b, b + 0.4);
      const ck = kin * (1 - kout);
      (u.card!.value as THREE.Vector4).set(this.cardX + 40 * (1 - kin), this.cardY, ck > 0.001 ? this.cardW : 0, this.cardH);
      u.cardA!.value = ck;
      u.cardAng!.value = this.cardAng + 0.03 * (1 - kin);
      // 字層在卡上的位置（卡的左上角是 (0,0)）
      (u.tlR!.value as THREE.Vector4).set(this.cardW - cap.blockW / 2 - cap.pad, 40 - cap.pad, cap.L.w, cap.L.h);
      // 字跟著紙卡一起淡入（卡的透明度已經乘在字上）
      u.textK!.value = 1;
    } else { u.tl!.value = this.tex; (u.card!.value as THREE.Vector4).set(0, 0, 0, 0); u.textK!.value = 0; }
    u.k!.value = 1 - 0.06 * prog(t, e - 0.3, e);
    this.bg.render(renderer, out);
    return { ...P6_POST, vignette: 0.3 };
  }
}
