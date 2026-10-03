// 照片版面「寬銀幕開場」（暗）：像電影的第一個鏡頭——
//  - 一開始是滿版的照片，第一個拍點上下的黑邊「收進來」變成寬銀幕（2.39:1；直的照片收到 2.2:1），畫面跟著輕輕一頓。
//  - 鏡頭往焦點推：照片從中間慢慢移向焦點、同時推近（像電影開場的橫搖＋推軌），臉越來越大；有字時臉停在右上的空處，不被片頭字幕蓋住，
//    也不會躲進黑邊裡。
//  - 橫的夠大的照片裁滿寬銀幕；直的、手機直拍、小的舊照片完整放（有字時放在右邊、讓出左邊寫字），框裡的畫面一樣往焦點推，
//    其他地方是同一張照片放大模糊壓暗。
//  - 相簿的第一張：上黑邊下面淡入相簿名當片名（小字、很寬的字距、兩邊兩條細線），三秒後淡出。
//  - 字像片頭字幕：靠左寫在畫面左下（一條訊號色的短線在上面），思源宋體、字距寬一點——主字（賓客留言＋署名，或新人的註解）在上，
//    歌詞小一號在下面跟唱；沒有主字時歌詞就是片頭字幕。兩個都沒有就只有照片（完整放的照片回到正中間）。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { isLatin, beatAfter } from './_motifs';
import { settleK } from './_photo';
import { PhotoPlate, canCover, contain, focusCropAt, photoLod, clip, drawLayer, v4 } from './_p4';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'screen', energy: [0, 1], bars: [2, 8], weight: 1.1, prefers: ['landscape'] };

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D photo;
  uniform vec4 rect; uniform vec4 crop; uniform float lod; uniform float cover;
  uniform vec4 bgCrop; uniform float bar; uniform float shade; uniform vec4 shadeR; uniform float topShade; uniform float k;
  vec3 photoAt(vec2 uv, float l) { return toLinear(textureLod(photo, clamp(uv, 0.0, 1.0), l).rgb) * 0.82; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 col = C_INK;
    if (cover < 0.5) {
      // 底：同一張照片放大、模糊、壓得很暗（寬銀幕的黑裡透一點顏色）
      vec2 q = p / vec2(${W}.0, ${H}.0);
      vec2 uv = bgCrop.xy + q * (bgCrop.zw - bgCrop.xy);
      vec3 b = vec3(0.0);
      for (int i = 0; i < 10; i++) {
        float a = float(i) * 2.39996, r = 0.016 * sqrt(float(i) + 0.5);
        b += photoAt(uv + vec2(cos(a), sin(a)) * r * vec2(1.0, 1.7), 4.5);
      }
      col = mix(C_INK, b / 10.0 * 0.12, 0.92);
      vec2 c = rect.xy + rect.zw * 0.5;
      float d = sdBox(p - c - vec2(0.0, 16.0), rect.zw * 0.5);
      col *= 1.0 - 0.5 * exp(-max(d, 0.0) / 40.0);
    }
    vec2 c = rect.xy + rect.zw * 0.5;
    float d = sdBox(p - c, rect.zw * 0.5);
    float inside = 1.0 - smoothstep(-0.75, 0.75, d);
    if (inside > 0.0) {
      vec2 uv = crop.xy + (p - rect.xy) / rect.zw * (crop.zw - crop.xy);
      col = mix(col, photoAt(uv, lod), inside);
    }
    // 字的後面：左下（片頭字幕）、上面（片名）很淡地壓暗
    vec2 sq = (p - shadeR.xy) / shadeR.zw;
    col *= 1.0 - shade * 0.5 * exp(-dot(sq, sq) * 1.4);
    vec2 tq = (p - vec2(${W / 2}.0, bar + 70.0)) / vec2(620.0, 90.0);
    col *= 1.0 - topShade * 0.4 * exp(-dot(tq, tq));
    // 寬銀幕的黑邊（純黑，邊緣一點點抗鋸齒）
    float bars = 1.0 - smoothstep(bar - 0.75, bar + 0.75, p.y) + smoothstep(${H}.0 - bar - 0.75, ${H}.0 - bar + 0.75, p.y);
    col *= 1.0 - clamp(bars, 0.0, 1.0);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, rect: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, lod: { value: 0 },
  cover: { value: 1 }, bgCrop: { value: new THREE.Vector4(0, 0, 1, 1) }, bar: { value: 0 }, shade: { value: 0 }, shadeR: { value: new THREE.Vector4(560, 790, 760, 260) }, topShade: { value: 0 }, k: { value: 1 },
});

/**
 * 片頭字幕的位置（左下）：字層的左上角、寬；最後一行的基線在 BASE（畫面 y = 880，下黑邊上面；x 不到 1360，碰不到右下角 HUD）。
 * 主字最多 4 行＋署名＋歌詞，整塊最高約 380 px。
 */
const CAP = { x: 150, y: 440, w: 1040, h: 500 };
const COL_X = 30, BASE = 880 - CAP.y;

export default class Widescreen extends PhotoPlate {
  bg = shared('widescreen.bg', BG);
  cap = this.track(new Layer2D(CAP.w, CAP.h, undefined, { fast: true }));
  title = this.track(new Layer2D(1000, 90, undefined, { fast: true }));
  cover = true;
  /** 完整放的照片：中心、大小（畫面 px）。 */
  pcx = W / 2; pcy = H / 2; pw = 0; ph = 0;
  /** 黑邊最後的高度、收進來的時間。 */
  barH = 0; tBar = 0;
  tCap = 0; tTitle0 = 0; tTitle1 = 0;
  hasTitle = false;
  capW = 1000;
  /** 字整塊的頂（字層座標）；臉最後停在畫面（或完整放的照片框）的哪裡。 */
  textTop = 0;
  at: [number, number] = [0.5, 0.5];

  override async init() {
    const ph = this.photo;
    await this.loadPhotos(1);
    const { start, end, audio } = this.ctx;
    const { w, h } = this.img;
    this.cover = canCover(this.img, 2.39, W);
    this.barH = this.cover ? (H - W / 2.39) / 2 : (H - W / 2.2) / 2;
    // 黑邊在第一個拍點收進來（太晚就在 0.4 秒）
    const b1 = beatAfter(audio, start + 0.15);
    this.tBar = b1 - start < 0.9 ? b1 : start + 0.4;
    if (!this.cover) {
      // 完整放：高度在黑邊裡面，很小的照片最多放大 1.5 倍；有字而且照片不寬時往右放，讓出左邊寫字
      const inner = H - 2 * this.barH - 40;
      // 有字時照片放右邊、最寬 780，讓出左邊寫字（60 字的留言 4 行放得下）；照片的右下角可以在 HUD 底下（照片是背景）
      const c = contain(w, h, this.hasText ? 780 : W - 300, inner);
      this.pw = c.w; this.ph = c.h;
      this.pcx = this.hasText ? Math.min(W - 170 - c.w / 2, 1340) : W / 2;
      this.pcy = H / 2;
      if (this.hasText) this.capW = clamp(this.pcx - c.w / 2 - CAP.x - COL_X - 50, 600, 1000);
    }
    this.hasTitle = ph.chapter && !!ph.album;
    const dur = end - start;
    this.tTitle0 = this.tBar + 0.35;
    this.tTitle1 = this.tTitle0 + clamp(dur * 0.4, 1.2, 3.2);
    this.tCap = this.hasTitle ? Math.min(this.tTitle0 + 0.9, start + dur * 0.35) : this.tBar + 0.35;
    // 字距寬一點（片頭字幕）；量字時沒算字距，排的寬度先扣掉一點
    const text = this.words(this.cap.ctx, {
      family: F.ming(700), w: this.capW - 70, h: 380, min: 40, max: 50, lineHeight: 1.45, maxLines: 4, align: 'left', tracking: 4,
      ink: rgba('bone', 0.96), unsung: rgba('bone', 0.38), sigInk: rgba('bone', 0.8), sigSize: 28, shadow: { color: rgba('ink', 0.6), blur: 12 },
    });
    this.textTop = BASE - text.height + text.size * 0.1;
    // 有字：臉推到右上的空處（字在左下）；寬銀幕的黑邊蓋掉上下約 13%，0.4 還在畫面裡
    this.at = text.has ? [this.cover ? 0.62 : 0.55, 0.4] : [0.5, 0.5];
    if (this.hasTitle) this.drawTitle();
  }

  private drawTitle() {
    const L = this.title, c = L.ctx;
    L.clear();
    const fam = isLatin(this.photo.album) ? F.serif(600) : F.ming(700);
    c.font = font(fam, 28);
    c.letterSpacing = '14px';
    c.fillStyle = rgba('bone', 0.92);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const s = clip(c, this.photo.album, 720);
    // 字距會讓字串往右多一格：往左挪半格
    c.fillText(s, L.w / 2 + 7, L.h / 2);
    const tw = c.measureText(s).width;
    c.letterSpacing = '0px';
    c.fillStyle = rgba('bone', 0.5);
    c.fillRect(L.w / 2 - tw / 2 - 90, L.h / 2, 56, 1.5);
    c.fillRect(L.w / 2 + tw / 2 + 34, L.h / 2, 56, 1.5);
    L.upload();
  }

  /** 片頭字幕：上面一條訊號色的短線（記號，位置固定），下面是主字＋歌詞（內容變了才重畫）。 */
  private drawCap(t: number) {
    const L = this.cap, c = L.ctx;
    const clear = () => {
      L.clear();
      c.fillStyle = rgba('signal', 0.85);
      c.fillRect(COL_X, Math.max(4, this.textTop - 34), 48, 2);
    };
    if (this.text.draw(c, t, COL_X, this.textTop, { clear })) L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const { w, h } = this.img;
    const dir = hash(this.seed, 4) < 0.5 ? -1 : 1;
    const span = Math.max(4, e - s);
    const pan = ease.inOutQuad(clamp(lt / span));
    const z0 = 1 - Math.exp(-lt / 7);
    // 黑邊收進來：外拋的緩動，最後一點點過頭再回來；收進來那一下畫面輕輕往前一頓
    const bk = prog(t, this.tBar, this.tBar + 0.55, ease.outExpo);
    const bar = this.barH * bk;
    const kick = 0.012 * Math.exp(-Math.max(0, t - this.tBar) / 0.25) * (t >= this.tBar ? 1 : 0);
    const u = this.bg.u;
    u.photo!.value = this.tex;
    u.cover!.value = this.cover ? 1 : 0;
    const k = settleK(lt);
    if (this.cover) {
      // 滿版：往焦點推到 1.28 倍（中心從照片中間移向焦點，像橫搖＋推軌）；黑邊收進來那一下多推一點點
      const cr = focusCropAt(this.photo, w, h, W / H, { k, zoom: 1.28 + kick * 4, at: this.at }, W);
      v4(u.rect!, [0, 0, W, H]);
      v4(u.crop!, cr);
      u.lod!.value = photoLod((cr[2] - cr[0]) * w, W);
    } else {
      // 完整放：框幾乎不動（很慢地漂一點），框裡的畫面往焦點推；很小的照片少推，不推糊
      const sc = 1 + 0.015 * z0 + kick;
      const rw = this.pw * sc, rh = this.ph * sc;
      const x = this.pcx - rw / 2 + dir * 18 * (pan - 0.5), y = this.pcy - rh / 2;
      const cr = focusCropAt(this.photo, w, h, w / h, { k, zoom: 1.22, at: this.at }, rw);
      v4(u.rect!, [x, y, rw, rh]);
      v4(u.crop!, cr);
      u.lod!.value = photoLod((cr[2] - cr[0]) * w, rw);
      const bsc = Math.max(W / w, H / h) * 1.2;
      const fw = W / (w * bsc), fh = H / (h * bsc);
      const cx = clamp(0.5 - dir * 0.03 * pan, fw / 2, 1 - fw / 2);
      v4(u.bgCrop!, [cx - fw / 2, 0.5 - fh / 2, cx + fw / 2, 0.5 + fh / 2]);
    }
    u.bar!.value = bar;
    const exit = 1 - prog(t, e - 0.3, e);
    const capK = this.hasText ? prog(t, this.tCap, this.tCap + 0.7, ease.outCubic) * exit : 0;
    const titleK = this.hasTitle ? prog(t, this.tTitle0, this.tTitle0 + 0.6) * (1 - prog(t, this.tTitle1 - 0.5, this.tTitle1)) : 0;
    u.shade!.value = capK;
    const th = this.text.height + 60;
    v4(u.shadeR!, [CAP.x + COL_X + this.capW * 0.4, CAP.y + this.textTop + th / 2 - 20, this.capW * 0.75, th * 0.7 + 60]);
    u.topShade!.value = titleK;
    u.k!.value = (0.85 + 0.15 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (capK > 0) {
      this.drawCap(t);
      // 字從左邊滑進來一點點
      drawLayer(comp, renderer, this.cap, out, CAP.x - 24 * (1 - capK), CAP.y, { opacity: capK });
    }
    if (titleK > 0) drawLayer(comp, renderer, this.title, out, (W - this.title.w) / 2, this.barH + 26 - 8 * (1 - titleK), { opacity: titleK });
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.12, vignette: 0.4, ca: 0.6 };
  }
}
