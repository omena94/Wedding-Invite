// 照片版面「露天電影院」（暗）：夜晚空地上的露天大銀幕——
//  - 星空（慢慢閃）、地平線上遠處小鎮的燈、一排樹的剪影；大銀幕立在空地右邊，鏡頭從左前方斜斜地看（有透視），下面是撐著銀幕的柱子。
//  - 放映室在身後：一道光柱斜斜地從左下穿過夜裡的濕氣打到銀幕上，光裡有小蟲飛；銀幕的光照到地面與前景車頂的邊。
//  - 照片在銀幕上：橫的夠大的裁滿，直的、小的完整放在中間（兩邊是沒照到光的銀幕）。銀幕上的畫面往焦點慢慢推近，臉停在字幕上面。
//  - 主字（賓客留言＋署名，或新人的註解）寫在左下角的露天電影院招牌上：背光的白板、黑色的字一個一個排上去（像換字招牌），
//    署名在字排完才掛上去；四周一圈燈泡在拍點跑馬，招牌上面一條小小的「NOW SHOWING」（相簿的第一張改成相簿名）。
//  - 歌詞是銀幕上的字幕（放映出來的光，跟著銀幕的透視），一直在銀幕下方同一個位置跟唱；招牌立在銀幕左下角前面，
//    所以有招牌時字幕放在銀幕下方偏右（招牌擋不到），臉也推到銀幕偏右上。
//    沒有主字就沒有招牌、銀幕移到中間（字幕置中）；兩個都沒有就只有銀幕。
//  - 不畫人：前景只有停著的車（車頂剪影）與一根喇叭柱。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { settleK, PhotoText } from './_photo';
import { PhotoPlate, P4_GLSL, aboveText, fitInScreen, photoLod, planeQuad, quadToUV, quadBounds, clip, drawLayer, v4, m3, type Cam } from './_p4';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'screen', energy: [0, 0.8], bars: [4, 8], weight: 1, prefers: ['landscape'] };

/** 銀幕上的字幕層：銀幕下面這一段（銀幕 uv 的 y 從 TXT_V0 到 1），寬度跟銀幕在畫面上差不多；最後一行的基線在 TXT_BASE。 */
const TXT_V0 = 0.55, TXT_W = 940, TXT_H = Math.round((TXT_W / 2) * (1 - TXT_V0)), TXT_BASE = 0.93;

const BG = () => new FSPass(/* glsl */ `
  ${P4_GLSL}
  uniform sampler2D photo; uniform sampler2D txt; uniform float txtK; uniform float shadeV;
  uniform mat3 scr; uniform vec4 prect; uniform vec4 crop; uniform float lod; uniform float sw;
  uniform vec4 sb; uniform vec2 src; uniform vec2 beamA; uniform float beamFar;
  uniform float proj; uniform float horizon; uniform float postV;
  uniform vec4 board; uniform float boardK; uniform float bulbs; uniform float chase;
  uniform vec2 shift; uniform float t; uniform float k;
  float carSd(vec2 p, vec2 c, float w, float h) {
    // 車的背影：車身（寬的圓角盒）＋車頂（窄一點、上面圓）
    float body = sdBox(p - c - vec2(0.0, h * 0.18), vec2(w * 0.5 - h * 0.18, h * 0.22)) - h * 0.18;
    float cab = sdBox(p - c - vec2(0.0, -h * 0.28), vec2(w * 0.3 - h * 0.2, h * 0.2)) - h * 0.2;
    return min(body, cab);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 avg = P4avg(photo);
    vec3 lightC = mix(avg, C_BONE * 0.8, 0.3);
    // 天空：上面深、地平線附近有小鎮的暖光
    float hy = horizon;
    float sky = clamp((hy - p.y) / hy, 0.0, 1.0);
    vec3 col = mix(mix(C_INK2, C_EMBER, 0.04) * 0.6, C_INK * 0.4, smoothstep(0.0, 0.7, sky));
    col += mix(C_EMBER, C_SIGNAL, 0.4) * 0.035 * exp(-(hy - p.y) / 90.0) * step(p.y, hy);
    // 星星：一格一顆，慢慢閃；地平線附近少
    vec2 sp = p + shift * 0.15;
    vec2 cell = floor(sp / 28.0);
    vec2 hh = hash22(cell);
    vec2 sc = (cell + 0.15 + 0.7 * hh) * 28.0;
    float tw = 0.6 + 0.4 * sin(t * (1.0 + 2.0 * hh.x) + hh.y * 6.28);
    float star = exp(-dot(sp - sc, sp - sc) / (0.5 + 1.2 * hh.y)) * step(0.62, hash12(cell + 3.3)) * tw;
    col += C_BONE * star * 0.55 * smoothstep(0.08, 0.5, sky);
    // 遠處的樹林與小鎮的燈（失焦的暖點）
    float ridge = hy - 18.0 - 26.0 * (0.5 + 0.5 * fbm(vec2((p.x + shift.x * 0.3) / 260.0, 1.7), 3));
    if (p.y > ridge) {
      col = C_INK * 0.45;
      vec2 lc = floor(vec2((p.x + shift.x * 0.3) / 34.0, 0.0));
      float lx = (lc.x + 0.5) * 34.0 - shift.x * 0.3 + (hash12(lc) - 0.5) * 20.0;
      float ly = hy - 6.0 - hash12(lc + 9.0) * 14.0;
      float on = step(0.55, hash12(lc + 1.7));
      col += mix(C_EMBER, C_SIGNAL, 0.3) * on * 0.5 * exp(-dot(p - vec2(lx, ly), p - vec2(lx, ly)) / 5.0);
    }
    // 地面：空地，銀幕的光照到前面一片
    if (p.y > hy) {
      float g = (p.y - hy) / (${H}.0 - hy);
      col = C_INK * (0.22 + 0.06 * fbm(vec2(p.x / (30.0 + 300.0 * g), p.y / (4.0 + 30.0 * g)), 2));
      float lit = exp(-abs(p.x - (sb.x + sb.z) * 0.5) / 520.0) * exp(-g * 2.5);
      col += lightC * proj * 0.05 * lit;
    }
    // 銀幕：外框、柱子、放映的光
    vec2 suv = P4quad(scr, p);
    float fr = 0.018;
    bool inFrame = suv.x > -fr && suv.x < 1.0 + fr && suv.y > -fr * 2.0 && suv.y < 1.0 + fr * 2.0;
    bool post = suv.y > 1.0 && suv.y < postV && (abs(suv.x - 0.1) < 0.012 || abs(suv.x - 0.5) < 0.012 || abs(suv.x - 0.9) < 0.012);
    if (post) col = C_INK * 0.5 + lightC * proj * 0.02;
    if (inFrame) {
      bool onScreen = suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0;
      if (onScreen) {
        vec4 ph = P4screenPhoto(photo, suv, prect, crop, lod);
        vec2 hq = (suv - 0.5) * 2.0;
        float hot = 1.0 - 0.2 * dot(hq, hq);
        // 沒照到光的銀幕：月光下淡淡的灰白，有拼接的縫
        vec3 bare = C_BONE * (0.006 + 0.006 * (1.0 - suv.y)) * (0.9 + 0.1 * step(0.02, fract(suv.x * 8.0)));
        // 直的、小的照片：兩邊放同一張照片放大、模糊、壓暗（露天銀幕不留兩大片空白）
        vec3 fill = vec3(0.0);
        if (ph.a < 1.0) {
          vec2 fq = vec2(0.5 + (suv.x - 0.5) * 0.45, 0.5 + (suv.y - 0.5) * 0.7);
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 2.39996, r = 0.016 * sqrt(float(i) + 0.5);
            fill += P4photo(photo, fq + vec2(cos(a), sin(a)) * r, 4.0);
          }
          fill *= 0.1 / 8.0;
        }
        col = mix(bare + fill * proj, ph.rgb * hot, ph.a * proj) + bare * (1.0 - proj);
        col *= 0.985 + 0.015 * step(0.03, fract(suv.x * 8.0));
        // 歌詞字幕：銀幕上的光（字後面很淡地壓暗）
        col *= 1.0 - txtK * 0.5 * smoothstep(shadeV - 0.08, shadeV + 0.12, suv.y);
        vec2 tq = vec2(suv.x, (suv.y - ${TXT_V0}) / ${(1 - TXT_V0).toFixed(3)});
        if (txtK > 0.0 && tq.y >= 0.0 && tq.y <= 1.0) {
          vec4 tx = P4layer(txt, tq) * txtK * proj;
          col = col * (1.0 - tx.a) + tx.rgb * 0.92;
        }
      } else col = C_INK * 0.4 + lightC * proj * 0.015;
    }
    // 光柱：放映室在身後左下，穿過夜裡的濕氣打到銀幕
    vec2 d = p - src;
    float ang = atan(d.y, d.x);
    float wq = (beamA.y - beamA.x) * 0.06;
    float inB = smoothstep(beamA.x - wq, beamA.x + wq, ang) * (1.0 - smoothstep(beamA.y - wq, beamA.y + wq, ang));
    float along = length(d) / beamFar;
    inB *= 1.0 - smoothstep(0.96, 1.0, along);
    if (inB > 0.0) {
      float rays = 0.55 + 0.45 * snoise(vec2(ang * 60.0, t * 0.05));
      float mist = 0.55 + 0.45 * fbm(p / 170.0 + vec2(t * 0.02, -t * 0.01), 3);
      // 地平線以下的地面上光柱淡一點（光在空中，地面是暗的）
      float air = 1.0 - 0.6 * smoothstep(hy - 20.0, hy + 120.0, p.y);
      col += lightC * inB * rays * mist * (0.15 + 0.85 * along) * proj * 0.08 * air;
      // 光裡的小蟲（亂飛，一格一隻）
      vec2 c2 = floor(p / 60.0);
      vec2 h2 = hash22(c2 + 5.0);
      vec2 bp = (c2 + 0.5) * 60.0 + vec2(sin(t * (2.0 + 3.0 * h2.x) + h2.y * 9.0), cos(t * (1.7 + 2.0 * h2.y) + h2.x * 7.0)) * 22.0;
      float bug = exp(-dot(p - bp, p - bp) / 2.4) * step(0.7, hash12(c2 + 2.2));
      col += mix(lightC, C_BONE, 0.5) * bug * inB * proj * 0.5 * along;
    }
    // 招牌：背光的白板＋上面一條暗色的標題帶＋腳＋一圈燈泡
    if (boardK > 0.0) {
      vec2 bc = board.xy + board.zw * 0.5, bh = board.zw * 0.5;
      // 腳
      float legs = step(bc.y + bh.y, p.y) * (step(abs(p.x - (board.x + 40.0)), 7.0) + step(abs(p.x - (board.x + board.z - 40.0)), 7.0));
      col = mix(col, C_INK * 0.5, clamp(legs, 0.0, 1.0) * boardK);
      float db = sdBox(p - bc, bh + 26.0);
      float outer = 1.0 - smoothstep(-0.8, 0.8, db);
      vec3 bcol = C_INK2 * 0.7;
      float dIn = sdBox(p - bc, bh);
      if (dIn < 0.0) {
        // 背光板：中間亮、邊緣暗一點（日光燈管在後面），不發光
        vec2 bq = (p - bc) / bh;
        bcol = C_BONE * (0.6 + 0.1 * (1.0 - bq.y * bq.y)) * (0.92 + 0.08 * cos(bq.x * 3.0)) * bulbs;
        bcol *= 1.0 - 0.12 * smoothstep(-6.0, 0.0, dIn);
      }
      // 燈泡：沿著框一圈，拍點跑馬（訊號色，會發光）
      float ring = abs(db + 13.0);
      if (ring < 12.0) {
        vec2 q = p - bc; vec2 e = bh + 13.0;
        float spc = 30.0;
        vec2 bt = vec2(clamp(round(q.x / spc) * spc, -e.x, e.x), sign(q.y) * e.y);
        vec2 bs = vec2(sign(q.x) * e.x, clamp(round(q.y / spc) * spc, -e.y, e.y));
        float dt = dot(q - bt, q - bt), ds = dot(q - bs, q - bs);
        vec2 bpos = dt < ds ? bt : bs;
        float idx = dt < ds ? round(q.x / spc) + (q.y > 0.0 ? 50.0 : 0.0) : round(q.y / spc) + (q.x > 0.0 ? 100.0 : 150.0);
        float on = mod(idx + chase, 3.0) < 2.0 ? 1.0 : 0.25;
        float bl = exp(-dot(q - bpos, q - bpos) / 14.0);
        bcol += C_SIGNAL * bl * on * bulbs * 2.2 + C_EMBER * bl * 0.1;
      }
      col = mix(col, bcol, outer * boardK);
      // 招牌的光照到地上
      col += C_BONE * 0.025 * bulbs * boardK * exp(-length(max(abs(p - bc) - bh, 0.0)) / 120.0) * step(bc.y + bh.y, p.y);
    }
    // 前景：從車裡看出去（不畫人）。擋風玻璃上很淡的斜反光，A 柱、車頂、儀表板是近的剪影（失焦），邊緣被銀幕的光勾一點
    col *= 0.94;
    float glare = smoothstep(260.0, 0.0, abs(p.x * 0.55 + p.y - 1240.0 - shift.x * 0.4));
    col += mix(C_BONE, lightC, 0.5) * 0.012 * glare * (0.5 + 0.5 * fbm(p / 90.0, 2));
    vec2 ps = p + shift * 1.2;
    float xl = 30.0 + 230.0 * (1.0 - ps.y / ${H}.0), xr = ${W}.0 - 30.0 - 230.0 * (1.0 - ps.y / ${H}.0);
    float roof = 34.0 + 0.00004 * (ps.x - ${W / 2}.0) * (ps.x - ${W / 2}.0);
    float dash = 985.0 - 44.0 * exp(-pow((ps.x - 640.0) / 420.0, 2.0)) + 0.00002 * (ps.x - 900.0) * (ps.x - 900.0);
    float dIn = max(max(xl - ps.x, ps.x - xr), max(roof - ps.y, ps.y - dash));
    float dCar = dIn;
    float carA = smoothstep(-6.0, 6.0, dCar);
    if (carA > 0.0) {
      float rim = exp(-abs(ps.y - dash) / 5.0) * step(dash - 8.0, ps.y) * smoothstep(xl, xl + 300.0, ps.x);
      vec3 inside = C_INK * 0.18 + lightC * proj * 0.045 * rim;
      col = mix(col, inside, carA);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, txt: { value: null }, txtK: { value: 0 }, shadeV: { value: 0.8 }, scr: { value: new THREE.Matrix3() }, prect: { value: new THREE.Vector4(0, 0, 1, 1) }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  lod: { value: 0 }, sw: { value: 1000 }, sb: { value: new THREE.Vector4() }, src: { value: new THREE.Vector2() }, beamA: { value: new THREE.Vector2() },
  beamFar: { value: 1 }, proj: { value: 0 }, horizon: { value: 700 }, postV: { value: 1.2 },
  board: { value: new THREE.Vector4() }, boardK: { value: 0 }, bulbs: { value: 0 }, chase: { value: 0 },
  shift: { value: new THREE.Vector2() }, t: { value: 0 }, k: { value: 1 },
});

/** 銀幕（世界座標）：2:1，立在空地上；鏡頭在左前方。 */
const D = 3600, F_ = 1500, HW = 1150, HH = 575, SCR_Y = 690, GROUND = -160, PITCH = 0.08;
/** 招牌的文字層（最大）：主字最多 4 行＋署名。寬度留給銀幕右邊的字幕（招牌右緣不超過 x ≈ 1000）。 */
const BL = { w: 748, h: 380 };
const PAD = 34, HEAD = 46;

export default class DriveIn extends PhotoPlate {
  bg = shared('drivein.bg', BG);
  board = this.track(new Layer2D(BL.w, BL.h, undefined, { fast: true }));
  sub = this.track(new Layer2D(TXT_W, TXT_H, undefined, { fast: true }));
  /** 招牌（畫面 px）：左上、寬高。 */
  bx = 250; by = 0; bw = 0; bh = 0;
  label = '';
  /** 字一個一個排上去的時間。 */
  tL0 = 0; tL1 = 0;
  /** 銀幕上的字幕（歌詞）：自己一份排版，顏色是放映的光（招牌上的主字是黑字）。 */
  lyr!: PhotoText;
  /** 字幕的中線在字幕層的哪裡（有招牌時偏右）。 */
  lyrX = TXT_W / 2;
  /** 字幕的頂（字幕層座標）、在銀幕的哪裡（uv 的 y）；臉最後停在銀幕的哪裡。 */
  lyrTop = 0;
  lyrV = 1;
  at: [number, number] = [0.5, 0.5];

  override async init() {
    const ph = this.photo;
    this.label = ph.chapter && ph.album ? ph.album : 'NOW SHOWING';
    await this.loadPhotos(1, this.label);
    const { start, end } = this.ctx;
    // 主字排在招牌上（黑字、背光的白板），歌詞是銀幕上的字幕（lyricsApart）：招牌放不下那麼多字，字幕也該在銀幕上
    const text = this.words(this.board.ctx, {
      family: F.hei(700), w: BL.w - 2 * PAD, h: BL.h - HEAD - 2 * PAD, min: 40, max: 50, lineHeight: 1.3, maxLines: 4, align: 'center',
      ink: rgba('ink', 0.92), sigInk: rgba('ink', 0.72), sigSize: 28, shadow: null, lyricsApart: true,
    });
    // 字幕：有招牌時在銀幕下方偏右、窄一點（招牌擋住銀幕的左下角）；沒有招牌時置中
    this.lyrX = text.hasMain ? TXT_W * 0.66 : TXT_W / 2;
    this.lyr = new PhotoText(this.ctx, this.sub.ctx, {
      family: F.hei(500), w: TXT_W * (text.hasMain ? 0.56 : 0.85), h: 120, align: 'center', tracking: 1, lyricsApart: true,
      ink: rgba('bone', 0.97), unsung: rgba('bone', 0.42), lyricSize: 48, lyricSubSize: 40, shadow: { color: rgba('ink', 0.8), blur: 10 },
    });
    if (text.hasMain) {
      this.bw = Math.max(text.width, 380) + 2 * PAD;
      this.bh = HEAD + text.mainH + 2 * PAD - text.size * 0.1;
      this.tL0 = start + 0.7;
      this.tL1 = this.tL0 + Math.min(1.6, 0.05 * text.chars + 0.3, (end - start) * 0.35);
    }
    this.by = 830 - this.bh;
    // 歌詞字幕的位置固定（照這個窗格最長的那句留高度）：最後一行的基線在銀幕的 TXT_BASE
    const base = ((TXT_BASE - TXT_V0) / (1 - TXT_V0)) * TXT_H;
    this.lyrTop = base - this.lyr.lyricH + this.lyr.lyricSize * 0.1;
    this.lyrV = TXT_V0 + (this.lyrTop / TXT_H) * (1 - TXT_V0);
    const at = aboveText(this.lyrV, text.sung);
    this.at = text.hasMain ? [0.62, Math.min(at[1], 0.42)] : at;
  }

  /** 招牌上的字：標題帶的小字（位置固定）＋主字一個一個排上去（排完就不再畫），署名在字排完才掛上去。 */
  private drawBoard(t: number) {
    const L = this.board, c = L.ctx, text = this.text;
    const shown = Math.floor(clamp((t - this.tL0) / Math.max(0.01, this.tL1 - this.tL0)) * text.chars + 1e-6);
    const clear = () => {
      L.clear();
      c.font = font(F.mono(500), 18);
      c.letterSpacing = '6px';
      c.fillStyle = rgba('signal', 0.9);
      c.textBaseline = 'middle';
      c.fillText(clip(c, this.label, this.bw - 2 * PAD), PAD, HEAD / 2 + 4);
      c.letterSpacing = '0px';
      c.textBaseline = 'alphabetic';
    };
    if (text.drawMain(c, this.bw / 2, HEAD + PAD, { chars: shown, clear })) L.upload();
  }

  /** 銀幕上的歌詞字幕（變的時候才重畫）。 */
  private drawSub(t: number) {
    const L = this.sub;
    if (this.lyr.drawLyrics(L.ctx, t, this.lyrX, this.lyrTop, { clear: () => L.clear() })) L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const z0 = 1 - Math.exp(-lt / 7);
    // 鏡頭：很慢地推近、往一邊飄一點（前景的車、招牌比銀幕移得多）
    const drift = dir * 60 * ease.inOutQuad(clamp(lt / 12));
    // 有招牌（主字）時銀幕往右讓位；只有字幕或什麼都沒有時銀幕在中間
    const sx = this.text.hasMain ? 560 : 330;
    const cam: Cam = { x: drift, y: 0, z: D - 180 * z0, yaw: 0, pitch: PITCH, f: F_ };
    const q = planeQuad(cam, [sx, SCR_Y, 0], HW, HH, 0.28);
    const b = quadBounds(q);
    const u = this.bg.u;
    m3(u.scr!, quadToUV(q));
    v4(u.sb!, [b.x0, b.y0, b.x1, b.y1]);
    u.sw!.value = b.w;
    // 銀幕上的畫面往焦點推（1.28 倍），臉停在字幕上面
    const fit = fitInScreen(this.img, this.photo, 2, b.w, { k: settleK(lt), zoom: 1.28, at: this.at });
    v4(u.prect!, fit.rect);
    v4(u.crop!, fit.crop);
    u.lod!.value = photoLod(this.img.w * (fit.crop[2] - fit.crop[0]), b.w * (fit.rect[2] - fit.rect[0]));
    u.photo!.value = this.tex;
    // 地平線、柱子到地面（銀幕 uv）
    u.horizon!.value = H / 2 + F_ * Math.tan(PITCH) + 6;
    u.postV!.value = 1 + (SCR_Y - HH - GROUND) / (2 * HH);
    // 光柱：從左下（身後的放映室）到銀幕四個角的角度範圍
    const src: [number, number] = [-260 - drift * 0.5, 1240];
    const angs = q.map(([x, y]) => Math.atan2(y - src[1], x - src[0]));
    (u.src!.value as THREE.Vector2).set(...src);
    (u.beamA!.value as THREE.Vector2).set(Math.min(...angs), Math.max(...angs));
    u.beamFar!.value = Math.hypot(b.cx - src[0], b.cy - src[1]) * 0.98;
    // 進場：放映機打亮（閃兩下）；退場最後零點三秒稍微收暗
    const strike = prog(t, s + 0.05, s + 0.5, ease.outCubic);
    const blink = lt < 0.5 ? 0.7 + 0.3 * Math.sin(lt * 60) : 1;
    u.proj!.value = strike * blink * (1 - 0.15 * prog(t, e - 0.3, e));
    (u.shift!.value as THREE.Vector2).set(-drift, 0);
    // 歌詞字幕：放映機打亮之後才看得到（shader 再乘上放映的亮度）
    let txtK = 0;
    if (this.text.sung) {
      this.drawSub(t);
      txtK = prog(t, s + 0.4, s + 0.8) * (1 - prog(t, e - 0.3, e));
    }
    u.txt!.value = this.sub.texture;
    u.txtK!.value = txtK;
    u.shadeV!.value = this.lyrV;
    // 招牌：燈泡在進場時一圈一圈亮起來，之後每拍跑一格
    const boardK = this.text.hasMain ? 1 : 0;
    u.boardK!.value = boardK;
    if (this.text.hasMain) {
      const bx = this.bx - drift * 0.6, by = this.by;
      v4(u.board!, [bx, by, this.bw, this.bh]);
      const on = prog(t, s + 0.25, s + 0.6);
      u.bulbs!.value = on < 1 ? (Math.sin(lt * 50) > -0.2 ? on : on * 0.4) : 1;
      u.chase!.value = Math.floor(f.beat);
    }
    u.t!.value = t;
    u.k!.value = 1;
    this.bg.render(renderer, out);
    if (this.text.hasMain) {
      this.drawBoard(t);
      const op = prog(t, s + 0.3, s + 0.6) * (1 - prog(t, e - 0.3, e));
      drawLayer(comp, renderer, this.board, out, this.bx - drift * 0.6, this.by, { opacity: op });
    }
    return { bloom: 0.35, bloomThreshold: 1.05, halation: 0.15, vignette: 0.45 };
  }
}
