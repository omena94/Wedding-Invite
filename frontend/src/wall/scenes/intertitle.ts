// 照片版面「默片」（暗）：放映中的黑白默片——
//  - 4:3 的片框（圓角、邊緣軟，四周是暗的放映室）；照片轉成黑白（往主題的紙白、墨色靠一點，像銀鹽照片），
//    有底片顆粒、每格的明暗閃爍、片框上下左右的晃動、幾條忽隱忽現的刮痕與灰塵點、很重的暗角。
//  - 切進來：圓形光圈從中間打開（默片的 iris in）；最後零點三秒光圈收一點。
//  - 主字（賓客留言＋署名，或新人的註解）是默片的字卡：黑底、雙線的裝飾框、四角小菱形、置中的思源宋體白字（字卡也在底片上：一樣有顆粒與閃爍）。
//    照片 → 字卡 → 照片，在拍點硬切；字卡停的時間照字數算（讀得完）。相簿的第一張在字卡上多一行小小的相簿名。
//  - 歌詞像早期有聲片的字幕，一直寫在片框下面同一個位置跟唱：照片、字卡切來切去時歌詞都在（字卡上的字往上讓出位置）。
//    沒有主字就沒有字卡，只有照片＋字幕；兩個都沒有就只有照片。
//  - 照片：橫的夠大的裁滿 4:3，直的、小的完整放，四周是片框的黑。畫面往焦點慢慢推近，臉最後停在字幕上面。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { readSeconds } from '../engine/text';
import { beatAfter } from './_motifs';
import { settleK } from './_photo';
import { PhotoPlate, P4_GLSL, aboveText, fitInScreen, photoLod, clip, v4 } from './_p4';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'screen', energy: [0, 0.75], bars: [4, 8], weight: 1, prefers: ['landscape', 'square', 'small'] };

/** 片框（畫面 px）。 */
const FR = { w: 1360, h: 1020 };
const FX = (W - FR.w) / 2, FY = (H - FR.h) / 2;
/**
 * 字幕層（歌詞）：片框下面這一段（片框座標）。最後一行的基線在 LYR_BASE（片框座標，畫面 y = 800）：
 * 置中的歌詞會伸到 x ≥ 1360，基線要在右下角 HUD（y ≥ 830）上面。
 */
const SUB = { y0: 520, h: 300 };
const LYR_BASE = 800 - FY;
/** 字卡的雙線框裡面可以寫字的範圍（片框座標）。 */
const CARD = { top: 150, bottom: FR.h - 150 };

const BG = () => new FSPass(/* glsl */ `
  ${P4_GLSL}
  uniform sampler2D photo; uniform sampler2D card; uniform sampler2D sub;
  uniform vec4 prect; uniform vec4 crop; uniform float lod;
  uniform float isCard; uniform float subK; uniform float subTop; uniform float iris; uniform float frame; uniform vec2 weave; uniform float k;
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 fp = p - vec2(${FX}.0, ${FY}.0) - weave;
    vec2 q = fp / vec2(${FR.w}.0, ${FR.h}.0);
    float fl = 1.0 + (hash11(frame * 0.731) - 0.5) * 0.09;
    // 放映室：很暗，片框外有一點點溢出的光
    float dFr = sdBox(fp - vec2(${FR.w / 2}.0, ${FR.h / 2}.0), vec2(${FR.w / 2 - 40}.0, ${FR.h / 2 - 40}.0)) - 40.0;
    vec3 col = C_INK * 0.35 + C_BONE * 0.012 * exp(-max(dFr, 0.0) / 60.0) * fl;
    float inFr = 1.0 - smoothstep(-4.0, 4.0, dFr);
    if (inFr > 0.0) {
      float v;
      vec3 add = vec3(0.0);
      // 歌詞字幕（早期有聲片：寫在片框下面，照片、字卡上都在）
      vec2 sq = vec2(q.x, (fp.y - ${SUB.y0}.0) / ${SUB.h}.0);
      vec4 sub0 = subK > 0.0 && sq.y >= 0.0 && sq.y <= 1.0 ? P4layer(sub, sq) * subK : vec4(0.0);
      if (isCard > 0.5) {
        // 字卡：黑底、雙線框、四角小菱形；字從字卡層來
        v = 0.012;
        vec2 c = fp - vec2(${FR.w / 2}.0, ${FR.h / 2}.0);
        float o1 = abs(sdBox(c, vec2(${FR.w / 2 - 90}.0, ${FR.h / 2 - 80}.0)));
        float o2 = abs(sdBox(c, vec2(${FR.w / 2 - 104}.0, ${FR.h / 2 - 94}.0)));
        v += 0.62 * (1.0 - smoothstep(1.0, 2.2, o1)) + 0.45 * (1.0 - smoothstep(0.4, 1.4, o2));
        vec2 cc = abs(c) - vec2(${FR.w / 2 - 90}.0, ${FR.h / 2 - 80}.0);
        float dia = abs(abs(cc.x) + abs(cc.y) - 16.0);
        v += 0.6 * (1.0 - smoothstep(0.6, 1.8, dia));
        vec4 tx = P4layer(card, q);
        v = v * (1.0 - tx.a) + luma(tx.rgb) * 1.05;
        v *= 1.0 - sub0.a;
        add = sub0.rgb * 0.95;
      } else {
        vec4 ph = P4screenPhoto(photo, q, prect, crop, lod);
        // 黑白：亮度拉一點對比（S 曲線）
        float y = luma(ph.rgb) / 0.82;
        y = smoothstep(0.02, 0.95, y);
        v = mix(0.03, y * 0.95, ph.a);
        // 字後面很淡地壓暗（從字幕頂上一點開始），字本身照原色（跟唱的訊號色留著）
        v *= 1.0 - 0.4 * subK * smoothstep(subTop - 50.0, subTop + 40.0, fp.y);
        v *= 1.0 - sub0.a;
        add = sub0.rgb * 0.95;
      }
      // 底片：顆粒、閃爍、暗角、刮痕、灰塵
      float g = hash12(floor(p / 1.6) + frame * 17.3) - 0.5;
      v += g * 0.07;
      vec2 vq = q - 0.5;
      v *= 1.0 - 0.75 * pow(dot(vq * vec2(1.0, 1.25), vq * vec2(1.0, 1.25)) * 2.2, 1.6);
      for (int i = 0; i < 2; i++) {
        float seg = floor(frame / (5.0 + float(i) * 3.0));
        float sx = hash11(seg * 1.37 + float(i) * 9.1);
        float on = step(0.45, hash11(seg * 2.11 + float(i)));
        float d = abs(q.x - sx) * ${FR.w}.0;
        v += on * (0.12 - 0.2 * float(i)) * (1.0 - smoothstep(0.5, 1.5, d)) * (0.6 + 0.4 * sin(q.y * 30.0 + seg));
      }
      vec2 cell = floor(fp / 90.0);
      vec2 hh = hash22(cell + frame * 3.1);
      float dust = step(0.975, hash12(cell + frame * 7.7)) * (1.0 - smoothstep(1.5, 3.5, length(fp - (cell + hh) * 90.0)));
      v = mix(v, hash12(cell + frame) > 0.5 ? 0.0 : 0.8, dust);
      v *= fl;
      // 銀鹽的色調：從墨色到紙白（跟著主題，帶一點暖）
      vec3 tone = mix(C_INK * 0.5, C_BONE * 0.86, clamp(v, 0.0, 1.2));
      // 光圈（iris）
      float r = length(fp - vec2(${FR.w / 2}.0, ${FR.h / 2}.0));
      float ir = 1.0 - smoothstep(iris - 24.0, iris, r);
      col = mix(col, (tone + add * fl) * ir, inFr);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, card: { value: null }, sub: { value: null },
  prect: { value: new THREE.Vector4(0, 0, 1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, lod: { value: 0 },
  isCard: { value: 0 }, subK: { value: 0 }, subTop: { value: 700 }, iris: { value: 2000 }, frame: { value: 0 }, weave: { value: new THREE.Vector2() }, k: { value: 1 },
});

export default class Intertitle extends PhotoPlate {
  bg = shared('intertitle.bg', BG);
  card = this.track(new Layer2D(FR.w, FR.h, undefined, { fast: true }));
  sub = this.track(new Layer2D(FR.w, SUB.h, undefined, { fast: true }));
  /** 字卡出現、收起的時間。 */
  tA = Infinity; tB = Infinity;
  /** 歌詞字幕的頂（字幕層座標）；臉最後停在片框的哪裡。 */
  lyrTop = 0;
  at: [number, number] = [0.5, 0.5];

  override async init() {
    await this.loadPhotos(1, '◆');
    const { start, end, audio } = this.ctx;
    // 主字寫在字卡上，歌詞自己一條字幕（lyricsApart）：字卡跟照片切來切去，歌詞一直在同一個位置
    const text = this.words(this.card.ctx, {
      family: F.ming(700), w: FR.w - 360, h: 300, min: 40, max: 52, lineHeight: 1.6, maxLines: 4, align: 'center', tracking: 3,
      ink: rgba('bone', 1), unsung: rgba('bone', 0.35), sigInk: rgba('bone', 0.85), sigSize: 28,
      lyricSize: 48, lyricSubSize: 40, shadow: { color: rgba('ink', 0.7), blur: 10 }, lyricsApart: true,
    });
    this.lyrTop = LYR_BASE - SUB.y0 - text.lyricH + text.lyricSize * 0.1;
    this.at = aboveText((SUB.y0 + this.lyrTop) / FR.h, text.sung);
    if (text.hasMain) {
      this.drawCard();
      // 字卡停的時間：照字數（讀得完），至少窗格的四成五（主字是這一格的焦點，短句也不要一閃就過），前後至少留一點照片；
      // 照片先出現一下，字卡在拍點切進來
      const dur = end - start;
      const R = clamp(Math.max(readSeconds(text.words.text) + 0.6, dur * 0.45), 2.2, Math.max(2.2, dur - 2.6));
      const a0 = start + clamp((dur - R) * 0.35, 1.2, 3);
      this.tA = Math.min(beatAfter(audio, a0), end - 1.2);
      const b0 = this.tA + R;
      this.tB = end - b0 < 1.2 ? Infinity : beatAfter(audio, b0);
    }
  }

  /** 字卡（不會變，畫一次）：相簿名（章節開頭）、主字＋署名、上下兩條裝飾；有歌詞時整塊往上讓出字幕的位置。 */
  private drawCard() {
    const ph = this.photo, text = this.text;
    const L = this.card, c = L.ctx;
    L.clear();
    const cx = FR.w / 2;
    const label = ph.chapter && ph.album;
    const blockH = text.mainH + (label ? 70 : 0);
    // 可以寫字的範圍：雙線框裡面；有歌詞時到字幕上面為止
    const bottom = text.sung ? Math.min(CARD.bottom, SUB.y0 + this.lyrTop - 50) : CARD.bottom;
    const y0 = (CARD.top + bottom) / 2 - (blockH + 100) / 2 + 54;
    let y = Math.max(CARD.top + 54, y0);
    c.textAlign = 'center';
    c.fillStyle = rgba('bone', 1);
    if (label) {
      c.font = font(F.ming(700), 24);
      c.letterSpacing = '10px';
      c.fillText(clip(c, ph.album, FR.w - 420), cx + 5, y + 22);
      c.letterSpacing = '0px';
      y += 70;
    }
    // PhotoText 自己算置中的位置，畫筆要是靠左
    c.textAlign = 'left';
    text.drawMain(c, cx, y);
    // 上下兩條短線＋中間一顆小菱形（字卡的裝飾）
    c.fillStyle = rgba('bone', 1);
    c.textAlign = 'center';
    const top = y - (label ? 70 : 0);
    for (const yy of [top - 54, top + blockH + 46]) {
      c.fillRect(cx - 120, yy, 96, 1.5);
      c.fillRect(cx + 24, yy, 96, 1.5);
      c.font = font(F.ming(700), 18);
      c.fillText('◆', cx, yy + 7);
    }
    c.textAlign = 'left';
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    // 默片一秒 18 格：閃爍、晃動、刮痕都照這個換
    const fr = Math.floor(t * 18);
    u.frame!.value = fr % 1000;
    (u.weave!.value as THREE.Vector2).set(((fr * 7919) % 13) / 13 * 3 - 1.5, ((fr * 104729) % 17) / 17 * 4 - 2);
    const isCard = t >= this.tA && t < this.tB;
    u.isCard!.value = isCard ? 1 : 0;
    u.card!.value = this.card.texture;
    // 畫面往焦點推（1.25 倍），臉最後停在歌詞字幕上面
    const fit = fitInScreen(this.img, this.photo, FR.w / FR.h, FR.w, { k: settleK(t - s), zoom: 1.25, at: this.at });
    v4(u.prect!, fit.rect);
    v4(u.crop!, fit.crop);
    u.lod!.value = photoLod(this.img.w * (fit.crop[2] - fit.crop[0]), FR.w * (fit.rect[2] - fit.rect[0]));
    u.photo!.value = this.tex;
    // 歌詞字幕：照片、字卡上都在（切字卡時不跟著消失）
    let subK = 0;
    if (this.text.sung) {
      const L = this.sub;
      if (this.text.drawLyrics(L.ctx, t, FR.w / 2, this.lyrTop, { clear: () => L.clear() })) L.upload();
      subK = 1 - prog(t, e - 0.3, e);
    }
    u.sub!.value = this.sub.texture;
    u.subK!.value = subK;
    u.subTop!.value = SUB.y0 + this.lyrTop;
    // 光圈：切進來從中間打開，最後零點三秒收一點
    const open = ease.inOutCubic(prog(t, s, s + 0.7));
    u.iris!.value = 40 + 1000 * open - 260 * prog(t, e - 0.3, e, ease.inCubic);
    u.k!.value = 1;
    this.bg.render(renderer, out);
    return { bloom: 0.15, bloomThreshold: 1.05, halation: 0.08, vignette: 0.5, grain: 0.07 };
  }
}
