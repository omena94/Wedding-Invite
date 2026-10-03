// 照片版面「雨窗」（暗）：下雨的夜裡，隔著一片起霧、掛滿雨滴的玻璃看照片。
//  - 橫的、夠大的照片滿版（往焦點慢慢推近，焦點不會被裁掉）；直的、方的、很小的舊照片完整放在中間（框裡的畫面一樣往焦點推），
//    底下是同一張照片放大、模糊、壓暗（很小的照片最多放大 1.5 倍）。照片取樣壓在 0.84 以下，不發光。
//  - 玻璃上有一層霧（隔著霧看是糊的、灰灰的）和很多小雨滴（每一顆像小透鏡，裡面是倒過來的清楚小景）；
//    幾顆大雨滴走走停停地滑下來，滑過的地方留下一條擦乾淨的細痕。
//  - 切進來後的第一個瞬間，有人用手在焦點那一帶擦出一道清楚的；之後每個小節線再擦一道（上下輪流），
//    照片越來越清楚；擦過的地方很慢地又起霧、又長出小雨滴。
//  - 字放在左下（思源黑體、靠左，像獨立電影的字幕），後面很淡地壓暗：主字（賓客留言＋署名，或新人的註解）在上，
//    歌詞小一號在最下面跟唱；沒有主字時歌詞自己當字幕；都沒有就只有照片。相簿的第一張在字幕上面多一行小小的相簿名。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { F } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { focusCrop, focusIn, settleK } from './_photo';
import { PhotoScene, TextBlock, DARK_TEXT, containSize, coverable, pastBeats, P5_GLSL } from './_p5';

export const spec: PlateSpecDecl = { photo: true, prefers: ['landscape'], family: 'photo', series: 'light', energy: [0, 0.75], bars: [3, 8], weight: 1 };

const NW = 6;

const BG = () => new FSPass(/* glsl */ `
  ${P5_GLSL}
  uniform sampler2D photo;
  uniform vec4 rect; uniform vec4 crop; uniform float lod;
  uniform vec4 bgCrop; uniform float bgLod; uniform float contain;
  uniform float t; uniform float k; uniform float shade; uniform vec4 shadeR;
  // 擦過的痕：中心 y、斜率、經過幾秒（< 0 沒用到）、方向
  uniform vec4 wipe[${NW}];
  // 窗外（照片）：extra 越大越糊
  vec3 view(vec2 p, float extra) {
    vec3 col = C_INK;
    if (contain > 0.5) {
      vec2 q = clamp(p / vec2(${W}.0, ${H}.0), 0.0, 1.0);
      col = mix(C_INK, p5Photo(photo, bgCrop.xy + q * (bgCrop.zw - bgCrop.xy), bgLod + extra * 0.3) * 0.36, 0.85);
    }
    vec2 c = rect.xy + rect.zw * 0.5;
    float d = sdBox(p - c, rect.zw * 0.5);
    float inside = 1.0 - smoothstep(-0.75 - extra * 3.0, 0.75 + extra * 3.0, d);
    if (inside > 0.0) {
      vec2 uv = crop.xy + (p - rect.xy) / rect.zw * (crop.zw - crop.xy);
      col = mix(col, p5Photo(photo, uv, lod + extra), inside);
    }
    return col;
  }
  // 擦乾淨的程度（0..1）
  float wiped(vec2 p) {
    float c = 0.0;
    for (int i = 0; i < ${NW}; i++) {
      vec4 w = wipe[i];
      if (w.z < 0.0) continue;
      float sweep = smoothstep(0.0, 0.42, w.z);
      // w.w 的正負是擦的方向、大小是擦痕的粗細
      float xa = w.w > 0.0 ? 70.0 : ${W - 70}.0;
      float xb = xa + sign(w.w) * sweep * ${W - 140}.0;
      float th = abs(w.w);
      float x0 = min(xa, xb), x1 = max(xa, xb);
      float yc = w.x + w.y * (p.x - ${W / 2}.0);
      float dy = p.y - yc;
      float jag = 18.0 * snoise(vec2(p.x / 150.0, w.x)) + 6.0 * snoise(vec2(p.x / 45.0, w.x + 3.0));
      float band = 1.0 - smoothstep(170.0 * th, 250.0 * th, abs(dy) + jag);
      // 手擦過留下的細細水痕（順著擦的方向）
      band *= 1.0 - 0.22 * smoothstep(0.35, 0.9, snoise(vec2(p.x / 380.0 + w.x, dy / 7.0)));
      float ends = smoothstep(x0 - 60.0, x0 + 40.0, p.x) * (1.0 - smoothstep(x1 - 40.0, x1 + 60.0, p.x));
      // 擦過之後慢慢又起霧
      float refog = exp(-max(w.z - 4.0, 0.0) / 12.0);
      c = max(c, band * ends * refog);
    }
    return c;
  }
  void main() {
    vec2 p = p5Px();
    float clr = wiped(p);
    // ---- 會滑的大雨滴：每一欄一顆，走走停停，滑過留下乾淨的細痕
    float col_w = 86.0;
    float ci = floor(p.x / col_w);
    vec2 hh = hash22(vec2(ci, 3.7));
    float speed = 70.0 + 90.0 * hh.x;
    float tt = t + 0.35 * sin(t * 1.9 + hh.y * 6.28) + 0.2 * sin(t * 3.7 + hh.x * 6.28);
    float yDrop = mod(hh.y * 1400.0 + tt * speed, 1400.0) - 160.0;
    float xDrop = (ci + 0.3 + 0.4 * hh.x) * col_w + 6.0 * sin(yDrop / 60.0 + hh.y * 9.0);
    vec2 dd = (p - vec2(xDrop, yDrop)) / vec2(1.0, 1.35);
    float rBig = 7.0 + 5.0 * hh.y;
    float bigD = length(dd) - rBig;
    // 痕：雨滴上面一條細細擦乾淨的，越往上越淡（又起霧）
    float trailX = abs(p.x - xDrop + 4.0 * sin((p.y) / 50.0 + hh.x * 9.0));
    float trail = (1.0 - smoothstep(rBig * 0.4, rBig * 0.75, trailX)) * step(p.y, yDrop) * exp(-(yDrop - p.y) / 380.0);
    clr = max(clr, trail * 0.9);
    // ---- 隔著玻璃看：清楚的地方看得清楚，起霧的地方糊、灰、亮一點（霧會散光）
    vec3 sharp = view(p, 0.0);
    vec3 fogV = vec3(0.0);
    if (clr < 0.98) {
      vec3 b = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        float a = float(i) * 2.39996, rr = 9.0 * sqrt(float(i) + 0.5);
        b += view(p + vec2(cos(a), sin(a)) * rr, 3.2);
      }
      b /= 6.0;
      fogV = mix(b, vec3(luma(b)), 0.3) * 0.62 + mix(C_ASH, C_GRAPHITE, 0.5) * 0.045;
    }
    vec3 col = mix(fogV, sharp, clr);
    // 字幕後面（左下）很淡地壓暗
    col = p5Shade(col, p, shadeR, shade * 0.6);
    // ---- 小雨滴：一格一顆（有的格子沒有），每一顆像小透鏡，裡面是倒過來的清楚小景
    float cs = 26.0;
    vec2 q = p / cs;
    vec2 id = floor(q), f = fract(q);
    vec2 h = hash22(id + 11.0);
    // 擦過的地方小雨滴少（擦掉了），慢慢又長回來
    float grow = 1.0 - clr * 0.6;
    if (h.x < 0.55 * grow) {
      vec2 c = 0.3 + 0.4 * hash22(id + 4.1);
      float r = (2.0 + 5.5 * h.y * h.y) * (0.6 + 0.4 * grow);
      vec2 dq = (f - c) * cs;
      float dd2 = length(dq * vec2(1.0, 0.92)) - r;
      float a = 1.0 - smoothstep(-0.7, 0.7, dd2);
      if (a > 0.0) {
        vec3 inv = view(p - dq * 5.0 / max(r, 1.0) * 6.0, 0.6) * 0.9;
        // 下緣暗、左上一點高光
        float rim = smoothstep(-r * 0.6, 0.0, dd2);
        inv *= 1.0 - 0.45 * rim * smoothstep(-0.2, 0.8, dq.y / max(r, 1.0));
        inv += C_BONE * 0.18 * exp(-dot(dq - vec2(-0.35, -0.4) * r, dq - vec2(-0.35, -0.4) * r) / (r * r * 0.05 + 0.4));
        col = mix(col, inv, a * 0.95);
      }
    }
    // ---- 大雨滴本身
    float ab = 1.0 - smoothstep(-0.8, 0.8, bigD);
    if (ab > 0.0) {
      vec2 dq = p - vec2(xDrop, yDrop);
      vec3 inv = view(p - dq * 7.0, 0.4) * 0.92;
      inv *= 1.0 - 0.45 * smoothstep(-rBig * 0.5, 0.0, bigD) * smoothstep(-0.2, 0.8, dq.y / rBig);
      inv += C_BONE * 0.22 * exp(-dot(dq - vec2(-0.3, -0.45) * rBig, dq - vec2(-0.3, -0.45) * rBig) / (rBig * rBig * 0.04 + 0.5));
      col = mix(col, inv, ab);
    }
    // 玻璃上房間燈的淡淡反光（右上角）
    vec2 rq = (p - vec2(${W}.0 * 0.82, -60.0)) / vec2(700.0, 420.0);
    col += mix(C_ASH, C_EMBER, 0.25) * 0.025 * exp(-dot(rq, rq));
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, rect: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, lod: { value: 0 },
  bgCrop: { value: new THREE.Vector4(0, 0, 1, 1) }, bgLod: { value: 4 }, contain: { value: 0 },
  t: { value: 0 }, k: { value: 1 }, shade: { value: 0 }, shadeR: { value: new THREE.Vector4() },
  wipe: { value: Array.from({ length: NW }, () => new THREE.Vector4(0, 0, -1, 1)) },
});

/** 字幕：左下，最後一行的基線在 HUD 區上面；寬 ≤ 畫面 45%，高度放得下相簿名＋主字＋署名＋歌詞（短的字貼底，不會整塊浮在半空）。 */
const SUB = { x: 150, y: 382, w: 860, h: 430 };

export default class Rainwindow extends PhotoScene {
  bg = shared('rainwindow.bg', BG);
  text: TextBlock | null = null;
  contain = false;
  override async init() {
    await this.loadPhoto();
    const { w, h } = this.img;
    this.contain = !coverable(w, h);
    if (this.hasText) {
      this.text = this.track(new TextBlock(this.ctx, { ...SUB }, DARK_TEXT(F.hei(500), {
        max: 48, maxLines: 4, lineHeight: 1.42, tracking: 2, shadow: { color: rgba('ink', 0.9), blur: 20 },
        label: { family: F.hei(500), size: 22, color: rgba('bone', 0.78), tracking: 6, rule: rgba('signal', 0.8) },
      }), 'bottom'));
    }
  }

  /** 擦痕：進場一道（焦點那一帶）＋每個小節線一道（上下輪流）。 */
  private wipes(t: number) {
    const s = this.ctx.start;
    const out: [number, number, number, number][] = [];
    const first = s + 0.25;
    // 第一道擦在焦點（比較粗），之後在它下面、上面輪流；每三道回到焦點再擦一次（焦點一直是清楚的）
    const offs = [0, 290, -280, 0, 540, -520, 0, 250, -250];
    const mk = (tw: number, n: number) => {
      // 擦在「擦的那一刻」焦點在玻璃上的高度（之後鏡頭繼續推，擦痕留在玻璃上不跟著動）
      const y = clamp(this.view(tw - s).fy + offs[n % offs.length]!, 120, H - 120);
      const slope = (hash(n, this.seed, 3) - 0.5) * 0.14;
      const dir = n % 2 === 0 ? (hash(this.seed, 4) < 0.5 ? 1 : -1) : (hash(this.seed, 4) < 0.5 ? -1 : 1);
      out.push([y, slope, t - tw, dir * (n % 3 === 0 ? 1.25 : 1)]);
    };
    const bars = pastBeats(this.ctx.audio, t, NW - 1, true).filter((tb) => tb > first + 0.6).reverse();
    if (t >= first) mk(first, 0);
    bars.forEach((tb, i) => mk(tb, i + 1));
    return out.slice(-NW);
  }

  /**
   * 窗外的照片在 lt 秒時的樣子：框（畫面座標 x, y, w, h）、框裡看照片的哪一塊（往焦點推）、焦點在畫面上的高度（擦痕擦在這裡）。
   *  - 滿版：往焦點推到 1.22 倍（一開始快、越來越慢），焦點越來越靠近畫面中間、永遠在畫面裡。
   *  - 完整放：框本身幾乎不動，框裡的畫面往焦點推；很小的照片少推。
   */
  private view(lt: number) {
    const { w, h } = this.img;
    const z0 = settleK(lt);
    if (!this.contain) {
      const crop = focusCrop(this.photo, w, h, W / H, z0, { zoom: 1.22 });
      return { rect: [0, 0, W, H] as const, crop, fy: focusIn(this.photo, crop)[1] * H };
    }
    const sz = containSize(w, h, 1640, 900);
    const sc = 1 + 0.015 * z0;
    const rw = sz.w * sc, rh = sz.h * sc;
    const x = (W - rw) / 2, y = (H - rh) / 2 - 16;
    const crop = this.crop(z0, rw, 1.2);
    return { rect: [x, y, rw, rh] as const, crop, fy: y + focusIn(this.photo, crop)[1] * rh };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const { w, h } = this.img;
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.pgain!.value = this.gain;
    const v = this.view(lt);
    (u.rect!.value as THREE.Vector4).set(...v.rect);
    (u.crop!.value as THREE.Vector4).set(...v.crop);
    u.lod!.value = this.cropLod(v.crop, v.rect[2]);
    if (this.contain) {
      const bs = Math.max(W / w, H / h) * 1.2;
      const bw = W / (w * bs), bh = H / (h * bs);
      (u.bgCrop!.value as THREE.Vector4).set(0.5 - bw / 2, 0.5 - bh / 2, 0.5 + bw / 2, 0.5 + bh / 2);
      u.bgLod!.value = Math.max(0, Math.log2((bw * w) / 48));
    }
    u.contain!.value = this.contain ? 1 : 0;
    const ws = this.wipes(t);
    const arr = u.wipe!.value as THREE.Vector4[];
    for (let i = 0; i < NW; i++) { const v = ws[i]; if (v) arr[i]!.set(...v); else arr[i]!.set(0, 0, -1, 1); }
    u.t!.value = t;
    u.shade!.value = this.hasText ? prog(t, s, s + 0.6) : 0;
    if (this.text) (u.shadeR!.value as THREE.Vector4).set(...this.text.area());
    u.k!.value = (0.75 + 0.25 * ease.outCubic(prog(t, s, s + 0.5))) * (1 - 0.12 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.text && this.text.draw(t, prog(t, s + 0.7, s + 0.7 + Math.min(1.6, (e - s) * 0.3)))) {
      const op = prog(t, s + 0.4, s + 0.9, ease.outCubic) * (1 - prog(t, e - 0.35, e));
      this.text.blit(comp, renderer, out, op);
    }
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.12, vignette: 0.5 };
  }
}
