// 照片版面「畫廊」（暗底）：照片裱框掛在畫廊的牆上——
//  - 深色的牆，一盞聚光燈從上面打下來照著畫框（光圈的邊緣很軟，空氣裡有很淡的光柱）；黑色細框、白色卡紙、照片。
//  - 很小的舊照片最多放大到原尺寸約 1.5 倍；鏡頭整個窗格很慢地往畫框推近。
//  - 焦點：框裡的畫面往新人點的臉（fx, fy）慢慢推近（focusCrop，約 1.2 倍），臉越來越大、越來越靠近框的中間，
//    一開始是整張照片、推到最後也不會把臉裁掉；沒有說明時鏡頭也往臉那邊偏一點推。
//  - 字（_photo.ts 的 PhotoText）像畫廊的牆上說明：思源宋體、靠左、寫在畫框旁邊的牆上（沒有卡片、沒有框），上面一條短線；
//    主字是賓客留言＋署名或新人的註解，歌詞小一號寫在下面跟唱；沒有主字時歌詞自己寫在同一個位置。
//    相簿的第一張在說明上面多一行小小的相簿名。兩個都沒有就只有畫框（移到正中間）。
//  - 切進來時聚光燈「啪」一聲亮起來（很快的亮度爬升），最後零點三秒稍微收暗。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { HUD_SAFE } from '../engine/hud';
import { focusCrop, loadWords, photoTexture, PhotoText, settleK } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'classic', prefers: ['portrait', 'square'], energy: [0, 1], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D photo;
  uniform vec2 center; uniform vec2 halfSize; uniform float mat; uniform float frameW;
  uniform float lod; uniform float k; uniform float zoom; uniform vec2 zc; uniform float t;
  // 框裡看照片的哪一塊（往焦點推）
  uniform vec4 crop;
  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    // 鏡頭推近：繞著畫框中心放大
    vec2 p = zc + (p0 - zc) / zoom;
    // 牆：深色的灰泥，很淡的斑駁
    float n = fbm(p / 220.0, 4);
    vec3 wall = mix(C_INK, C_INK2, 0.7) * (0.85 + 0.25 * n);
    // 聚光燈：畫框上方打下來，光圈是直的橢圓，邊緣很軟；中心偏上一點
    vec2 lq = (p - center - vec2(0.0, -halfSize.y * 0.15)) / (halfSize + vec2(mat + frameW + 150.0, mat + frameW + 190.0));
    float pool = exp(-pow(dot(lq, lq), 1.6) * 1.1);
    // 很淡的光柱（空氣裡的灰塵）
    float beamX = abs(p.x - center.x) / (halfSize.x + 140.0 + (center.y - p.y) * 0.25);
    float beam = (1.0 - smoothstep(0.6, 1.0, beamX)) * smoothstep(center.y + 40.0, -200.0, p.y) * (0.6 + 0.4 * fbm(p / 160.0 + vec2(0.0, t * 0.05), 3));
    vec3 light = mix(C_BONE, C_EMBER, 0.18);
    // 光打到的牆是暖灰（看得出光圈），光圈外接近全黑
    vec3 col = wall * 0.6 + mix(C_GRAPHITE, light, 0.08) * 0.3 * pool * (0.9 + 0.2 * n) + light * 0.03 * beam;
    // 畫框的影子（往下一點，很軟）
    vec2 outer = halfSize + vec2(mat + frameW);
    float ds = sdBox(p - center - vec2(0.0, 22.0), outer);
    col *= 1.0 - 0.6 * (ds < 0.0 ? 1.0 : exp(-ds / 26.0));
    vec2 q = p - center;
    float d = sdBox(q, outer);
    float a = 1.0 - smoothstep(-0.8, 0.8, d);
    if (a > 0.0) {
      float lit = 0.25 + 1.0 * pool;
      // 黑色細框：外緣一道很細的亮邊（光打到的斜面）
      vec3 fr = C_INK2 * 1.4 * lit + light * 0.05 * lit * smoothstep(-3.0, -1.0, d);
      float dm = sdBox(q, halfSize + vec2(mat));
      if (dm < 0.0) {
        // 卡紙：白但不發光；跟照片之間一道很細的斜切影
        vec3 m = C_BONE * 0.74 * lit;
        float di = sdBox(q, halfSize);
        m *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 5.0, di));
        if (di < 0.0) {
          vec2 uv = clamp((q + halfSize) / (2.0 * halfSize), 0.0, 1.0);
          vec3 ph = toLinear(textureLod(photo, mix(crop.xy, crop.zw, uv), lod).rgb) * 0.8 * (0.55 + 0.45 * lit);
          m = mix(m, ph, 1.0 - smoothstep(-0.7, 0.7, di));
        }
        fr = mix(fr, m, 1.0 - smoothstep(-0.7, 0.7, dm));
      }
      col = mix(col, fr, a);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, center: { value: new THREE.Vector2() }, halfSize: { value: new THREE.Vector2() }, mat: { value: 60 }, frameW: { value: 16 },
  lod: { value: 0 }, k: { value: 1 }, zoom: { value: 1 }, zc: { value: new THREE.Vector2() }, t: { value: 0 },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) },
});

/** 說明的寬、整塊（主字＋署名＋歌詞）的高上限、跟畫框的空隙。60 字的留言在 40 px 折五行放得下。 */
const COL_W = 520, COL_H = 470, GAP = 110;
/** 框裡的畫面往焦點推到幾倍（ENGINE.md：相框 1.12～1.2）。 */
const FRAME_ZOOM = 1.2;
/** 鏡頭推近最多幾倍（整面牆，字跟著一起推）。 */
const CAM_ZOOM = 1.056;

export default class Gallery extends Scene {
  bg = shared('gallery.bg', BG);
  layer = this.track(new Layer2D(W, H, undefined, { fast: true }));
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  /** 牆上說明的字：主字（留言或註解）＋歌詞。 */
  text!: PhotoText;
  cx = W / 2; cy = H / 2; hw = 0; hh = 0; mat = 60; frameW = 16;
  /** 說明的左上角（短線那裡）、實際用到的寬、字的頂（短線與相簿名下面）。 */
  colX = 0; colY = 0; colW = 0; textY = 0;

  override async init() {
    const ph = this.photo;
    // 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就讓引擎跳過這個窗格，不要畫一半
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(ph.album);
    await loadWords(this.ctx);
    this.img = await ph.load();
    this.tex = this.track(photoTexture(this.img));
    this.ctx.renderer.initTexture(this.tex);
    // 字直接寫在暗牆上（光圈外），對比夠，不用暗影
    this.text = new PhotoText(this.ctx, this.layer.ctx, {
      family: F.ming(400), w: COL_W, h: COL_H, min: 40, max: 50, lineHeight: 1.5, maxLines: 5,
      ink: rgba('bone', 0.94), unsung: rgba('bone', 0.32), sigSize: 28, sigInk: rgba('ash', 0.9),
      lyricSize: 46, lyricSubSize: 38,
    });
    const has = this.text.has;
    const { w, h } = this.img;
    // 畫框（含卡紙）放得下的範圍；沒有說明時在正中間（右下角的 HUD 不要壓到畫框）
    const boxW = has ? 960 : 1100, boxH = has ? 760 : 700;
    const pad = 2 * (16 + 64);
    const s = Math.min((boxW - pad) / w, (boxH - pad) / h, 1.5);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.mat = clamp(0.1 * Math.min(w * s, h * s), 36, 72);
    this.frameW = 16;
    const tw = 2 * (this.hw + this.mat + this.frameW);
    // 說明實際的寬（短留言不用留一整欄的空，整組才置中）：字、相簿名取寬的
    let chapW = 0;
    if (ph.chapter && ph.album) {
      const c = this.layer.ctx;
      c.font = font(F.hei(500), 20);
      c.letterSpacing = '6px';
      chapW = Math.min(COL_W, c.measureText(ph.album).width);
      c.letterSpacing = '0px';
    }
    this.colW = has ? Math.max(this.text.width, chapW, 40) : 0;
    const groupW = has ? tw + GAP + this.colW : tw;
    const x0 = Math.max(120, (W - groupW) / 2 - (has ? 0 : 40));
    this.cx = x0 + tw / 2;
    this.cy = H / 2 - 10;
    this.colX = x0 + tw + GAP;
    const headH = 30 + (ph.chapter && ph.album ? 40 : 0);
    const blockH = headH + this.text.height + Math.round(this.text.size * 0.3);
    // 說明的下緣不要進 HUD 區：鏡頭推近時字會往外長一點，先多留一點
    const bottom = this.colX + this.colW > HUD_SAFE.x ? HUD_SAFE.y - 40 : H - 140;
    this.colY = clamp(this.cy - blockH / 2, 130, bottom - blockH);
    this.textY = this.colY + headH;
  }

  /** 清掉說明、重畫不會變的短線與相簿名（PhotoText 內容變了才會叫）。 */
  private paintBase() {
    const L = this.layer, c = L.ctx, ph = this.photo;
    L.clear();
    const x = this.colX;
    let y = this.colY;
    // 說明上面一條短線（訊號色，很細）
    c.fillStyle = rgba('signal', 0.75);
    c.fillRect(x, y, 40, 2);
    y += 30;
    if (ph.chapter && ph.album) {
      c.font = font(F.hei(500), 20);
      c.letterSpacing = '6px';
      c.fillStyle = rgba('ash', 0.85);
      let s = ph.album;
      while (s.length > 1 && c.measureText(s).width > COL_W) s = s.slice(0, -1);
      c.fillText(s === ph.album ? s : `${s}…`, x, y + 18);
      c.letterSpacing = '0px';
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const { w, h } = this.img!;
    // 鏡頭：一開始快、之後越來越慢地推近（最多約 5%），窗格長短都好看
    const zoom = 1 + (CAM_ZOOM - 1.006) * settleK(lt, 7) + 0.012 * (hash(this.seed, 2) - 0.5);
    // 有說明：繞著畫框與說明那一組的中間推（說明不會被推出畫面）；只有畫框：往臉那邊偏一點推
    const has = this.text.has;
    const zx = has ? (this.cx + this.colX + this.colW / 2) / 2 : lerp(this.cx, this.cx + (this.photo.fx - 0.5) * 2 * this.hw, 0.5);
    const zy = has ? this.cy : lerp(this.cy, this.cy + (this.photo.fy - 0.5) * 2 * this.hh, 0.5);
    // 框裡的畫面往臉推：一開始是整張照片，越推臉越大、越靠近框的中間（很小的照片少推，不推糊）
    const crop = focusCrop(this.photo, w, h, w / h, settleK(lt, 6), { zoom: FRAME_ZOOM, screenW: 2 * this.hw * CAM_ZOOM });
    const u = this.bg.u;
    u.photo!.value = this.tex;
    (u.center!.value as THREE.Vector2).set(this.cx, this.cy);
    (u.halfSize!.value as THREE.Vector2).set(this.hw, this.hh);
    (u.crop!.value as THREE.Vector4).set(crop[0], crop[1], crop[2], crop[3]);
    u.mat!.value = this.mat;
    u.frameW!.value = this.frameW;
    u.lod!.value = Math.max(0, Math.log2(((crop[2] - crop[0]) * w) / (2 * this.hw * zoom * SCALE)));
    u.zoom!.value = zoom;
    (u.zc!.value as THREE.Vector2).set(zx, zy);
    u.t!.value = t;
    // 聚光燈亮起來（很快，像開關）；最後零點三秒稍微收暗
    u.k!.value = (0.25 + 0.75 * ease.outCubic(prog(t, s, s + 0.35))) * (1 - 0.15 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (has) {
      const L = this.layer;
      if (this.text.draw(L.ctx, t, this.colX, this.textY, { clear: () => this.paintBase() })) L.upload();
      const op = prog(t, s + 0.35, s + 0.9, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      // 字跟著牆一起被推近
      const k = 1 - 1 / zoom;
      comp.draw(renderer, L.texture, out, { opacity: op, scale: [1 / zoom, 1 / zoom], offset: [((zx - W / 2) * k) / W, (-(zy - H / 2) * k) / H] });
    }
    return { bloom: 0.2, bloomThreshold: 1.05, halation: 0.12, vignette: 0.5 };
  }
}
