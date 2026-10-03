// 照片版面「手機相簿」（暗）：晚上的木桌上躺著一支手機（沒有品牌），螢幕亮著——
//  - 鏡頭從斜上方往下看（有一點透視），手機有厚度與金屬邊、在桌上投一片軟影；螢幕的光照到四周的桌面（光的顏色是照片的平均色），
//    桌子遠處失焦，再遠是暖色的光斑。
//  - 切進來：螢幕亮起，相簿的格子從下面滑上來、慢慢停住；接著其中一格（就是這張照片，裁成方的、繞著焦點）放大成全螢幕。
//    格子裡的其他張是同一組照片的不同局部（看起來像同一天拍的一串照片）。
//  - 照片完整放在螢幕裡（手機看照片不裁切）：橫的照片手機橫放、直的直放，小的舊照片也一樣放得下。
//    打開之後像有人用兩根手指慢慢放大：螢幕裡的畫面往焦點推，臉越來越大、越來越靠近螢幕中間。
//  - 字寫在手機旁邊（思源黑體，靠左，上面一行小小的相簿名）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞寫在同一個位置。兩個都沒有就只有手機（移到正中間）。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { settleK } from './_photo';
import { PhotoPlate, P4_GLSL, focusCropAt, photoLod, project, quadToUV, quadBounds, clip, drawLayer, v4, m3, type Cam, type Quad } from './_p4';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'screen', energy: [0, 0.8], bars: [2, 8], weight: 1, prefers: ['portrait'] };

/** 手機（世界單位）：寬、長、厚、螢幕四周的黑邊、圓角。 */
const PH = { w: 600, l: 1260, th: 30, bez: 22, r: 80 };
/** 桌面範圍（世界 x、z）。 */
const TB = { x0: -3200, x1: 3200, z0: -1500, z1: 1600 };

const BG = () => new FSPass(/* glsl */ `
  ${P4_GLSL}
  uniform sampler2D photo;
  uniform mat3 table; uniform mat3 ptop; uniform mat3 pbot;
  uniform vec2 psize; uniform float land; uniform vec2 phc; uniform float pyaw;
  uniform vec4 view; uniform vec4 crop; uniform float lod; uniform float viewK; uniform float lit;
  uniform float scroll; uniform float cols; uniform float target; uniform float uiK;
  uniform vec2 lampP; uniform float t; uniform float k;
  float rbox(vec2 q, vec2 b, float r) { return sdBox(q, b - r) - r; }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 avg = P4avg(photo);
    vec3 glowC = mix(avg, C_BONE * 0.7, 0.25) * lit;
    // 桌面：深色木頭，遠處失焦（紋理變淡），桌緣外是暗的房間與暖色光斑
    vec2 tu = P4quad(table, p);
    vec3 col = C_INK * 0.6;
    // 遠處的光斑（桌子後面）
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      vec2 bp = vec2(160.0 + fi * 270.0 + 60.0 * sin(fi * 2.1), 70.0 + 50.0 * sin(fi * 1.7 + 0.5));
      float r = 46.0 + 20.0 * sin(fi * 3.3);
      float d = length(p - bp);
      col += mix(C_EMBER, C_SIGNAL, 0.4 + 0.3 * sin(fi)) * 0.06 * (1.0 - smoothstep(r - 3.0, r + 3.0, d)) * (0.7 + 0.3 * smoothstep(r, r * 0.4, d));
    }
    vec2 wxz = vec2(mix(${TB.x0}.0, ${TB.x1}.0, tu.x), mix(${TB.z0}.0, ${TB.z1}.0, tu.y));
    if (tu.x >= 0.0 && tu.x <= 1.0 && tu.y >= 0.0 && tu.y <= 1.0) {
      float far = 1.0 - tu.y;
      float g = mix(fbm(vec2(wxz.x / 1400.0, wxz.y / 60.0), 3), fbm(vec2(wxz.x / 1400.0, wxz.y / 200.0), 1), far);
      vec3 woodC = mix(C_INK2, C_FUR, 0.07) * (0.5 + 0.12 * g);
      // 檯燈從左上方照過來
      woodC += C_FUR * 0.035 * exp(-length(p - lampP) / 800.0);
      // 手機螢幕照到的桌面
      vec2 rel = rot2(-pyaw) * (wxz - phc);
      float dPh = rbox(rel, psize * 0.5, ${PH.r}.0);
      woodC += glowC * 0.12 * exp(-max(dPh, 0.0) / 240.0);
      // 手機的軟影（燈在左上，影子往右下）
      float dS = rbox(rel - vec2(40.0, 60.0), psize * 0.5, ${PH.r}.0);
      woodC *= 1.0 - 0.55 * (1.0 - smoothstep(-30.0, 60.0, dS));
      col = woodC;
      // 桌緣（遠處）：一條暗邊，外面就是房間
      col = mix(col, C_INK * 0.3, smoothstep(0.035, 0.0, tu.y));
    }
    // 手機：底面（金屬邊，露出厚度）、正面（黑玻璃、螢幕）
    vec2 bq = P4quad(pbot, p);
    vec2 bl = (bq - 0.5) * psize;
    float db = rbox(bl, psize * 0.5, ${PH.r}.0);
    if (db < 1.0) {
      vec3 metal = mix(C_GRAPHITE, C_ASH, 0.3) * 0.3 + C_FUR * 0.05 * exp(-length(p - lampP) / 900.0);
      metal += glowC * 0.04;
      col = mix(col, metal, 1.0 - smoothstep(-1.0, 1.0, db));
    }
    vec2 fq = P4quad(ptop, p);
    vec2 fl = (fq - 0.5) * psize;
    float df = rbox(fl, psize * 0.5, ${PH.r}.0);
    if (df < 1.0) {
      vec3 c = C_INK * 0.35;
      // 金屬邊框的亮線
      c += mix(C_ASH, C_BONE, 0.3) * 0.1 * exp(-abs(df + 2.0) / 1.6);
      // 螢幕（手機直放：寬 = psize.x；橫放：寬 = psize.y，在 shader 裡轉成螢幕自己的座標）
      vec2 inner = psize * 0.5 - ${PH.bez}.0;
      float ds = rbox(fl, inner, ${PH.r - PH.bez}.0);
      if (ds < 0.0) {
        // 螢幕座標：左上原點、0..1（橫放時轉 90°）
        vec2 s01 = (fl + inner) / (2.0 * inner);
        vec2 su = land > 0.5 ? vec2(s01.y, 1.0 - s01.x) : s01;
        vec2 sz = land > 0.5 ? vec2(2.0 * inner.y, 2.0 * inner.x) : 2.0 * inner;
        vec2 spx = su * sz;
        vec3 sc = vec3(0.0);
        // 相簿格子：往上滑、慢慢停住；格子是同一張照片的不同局部
        float gap = 5.0;
        float tile = (sz.x - gap * (cols + 1.0)) / cols;
        float pitch = tile + gap;
        vec2 gp = vec2(spx.x - gap, spx.y - 150.0 + scroll);
        vec2 cell = floor(gp / pitch);
        vec2 inT = gp - cell * pitch;
        if (gp.y > 0.0 && cell.x >= 0.0 && cell.x < cols && inT.x < tile && inT.y < tile) {
          float id = cell.y * cols + cell.x;
          vec2 h2 = hash22(vec2(id, 3.7));
          float z = 0.25 + 0.3 * h2.x;
          vec2 o = h2 * (1.0 - z);
          vec2 uv = o + inT / tile * z;
          vec3 tc = P4photo(photo, uv, 4.0) * (0.75 + 0.3 * hash12(vec2(id, 1.3)));
          if (abs(id - target) < 0.5) tc = vec3(0.0);
          sc = tc;
        }
        // 上面一條小小的標題列（相簿）
        sc += C_BONE * 0.5 * uiK * step(60.0, spx.y) * step(spx.y, 66.0) * step(gap * 3.0, spx.x) * step(spx.x, 160.0) * (1.0 - viewK);
        // 打開：被點的那一格放大成全螢幕（黑底）
        sc *= 1.0 - viewK;
        vec2 vq = (su - view.xy) / (view.zw - view.xy);
        if (vq.x >= 0.0 && vq.x <= 1.0 && vq.y >= 0.0 && vq.y <= 1.0) {
          vec2 uv = crop.xy + vq * (crop.zw - crop.xy);
          sc = P4photo(photo, uv, lod);
        }
        // 玻璃：一道很淡的斜反光
        float refl = smoothstep(0.25, 0.0, abs(s01.x * 0.8 + s01.y - 0.55)) * 0.03;
        c = sc * lit + C_INK * 0.2 * (1.0 - lit) + C_BONE * refl;
        c = mix(c, C_INK * 0.3, smoothstep(-2.0, 0.0, ds));
      }
      // 鏡頭的小孔
      vec2 camP = vec2(0.0, -inner.y + 28.0);
      c = mix(c, C_INK * 0.1, 1.0 - smoothstep(9.0, 11.0, length(fl - camP)));
      col = mix(col, c, 1.0 - smoothstep(-1.0, 1.0, df));
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, table: { value: new THREE.Matrix3() }, ptop: { value: new THREE.Matrix3() }, pbot: { value: new THREE.Matrix3() },
  psize: { value: new THREE.Vector2(PH.w, PH.l) }, land: { value: 0 }, phc: { value: new THREE.Vector2() }, pyaw: { value: 0 },
  view: { value: new THREE.Vector4() }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, lod: { value: 0 }, viewK: { value: 0 }, lit: { value: 0 },
  scroll: { value: 0 }, cols: { value: 3 }, target: { value: 4 }, uiK: { value: 1 },
  lampP: { value: new THREE.Vector2(200, 100) }, t: { value: 0 }, k: { value: 1 },
});

/**
 * 字的欄位（畫面 px）：相簿名一行＋主字最多 4 行＋署名＋歌詞（整塊最高約 380 px）。
 * 欄會伸到 x ≥ 1360，最後一行的基線不低於 BOTTOM（右下角 HUD 從 y = 830 開始）。
 */
const COL = { w: 640, h: 560 };
const BOTTOM = 805;
/** 相簿名那一行佔的高度。 */
const LABEL_H = 50;

export default class PhoneAlbum extends PhotoPlate {
  bg = shared('phonealbum.bg', BG);
  layer = this.track(new Layer2D(COL.w, COL.h, undefined, { fast: true }));
  land = false;
  /** 手機在桌上的位置（世界 x、z）與轉的角度。 */
  px = 0; pz = 0; yaw = 0;
  colX = 0; colY = 0;
  tOpen = 0; tCap = 0;
  hasLabel = false;

  override async init() {
    const ph = this.photo;
    await this.loadPhotos(1);
    const { start, end } = this.ctx;
    this.land = this.img.w / this.img.h >= 1.15;
    this.yaw = (hash(this.seed, 6) < 0.5 ? -1 : 1) * 0.12;
    // 有字：手機在左邊、字在右邊；沒字：手機在正中間
    this.px = this.hasText ? (this.land ? -620 : -460) : 0;
    this.pz = this.land ? -120 : 0;
    this.colX = this.land ? 1210 : 1060;
    this.hasLabel = !!ph.album;
    const text = this.words(this.layer.ctx, {
      family: F.hei(500), w: this.land ? 600 : COL.w - 20, h: 380, min: 40, max: 50, lineHeight: 1.45, maxLines: 4, align: 'left',
      ink: rgba('bone', 0.95), unsung: rgba('bone', 0.36), sigInk: rgba('bone', 0.78), sigSize: 28, shadow: { color: rgba('ink', 0.7), blur: 12 },
    });
    // 整塊（相簿名＋字）大約在畫面中間偏上，最後一行的基線不低於 BOTTOM
    const blockH = (text.has ? text.height : 0) + (this.hasLabel ? LABEL_H : 0);
    this.colY = clamp(H / 2 - blockH / 2 - 50, 120, BOTTOM - 20 - blockH);
    const dur = end - start;
    this.tOpen = start + clamp(dur * 0.18, 0.7, 1.6);
    this.tCap = this.tOpen + 0.35;
  }

  /** 字：相簿名（小標籤，位置固定）＋主字＋歌詞（內容變了才重畫）。 */
  private drawText(t: number) {
    const ph = this.photo;
    const L = this.layer, c = L.ctx;
    const clear = () => {
      L.clear();
      if (!this.hasLabel) return;
      c.font = font(F.mono(500), 20);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('ash', 0.85);
      c.fillText(clip(c, ph.album, this.land ? 600 : COL.w - 20), 0, 38);
      c.letterSpacing = '0px';
    };
    if (this.text.draw(c, t, 0, 20 + (this.hasLabel ? LABEL_H : 0), { clear })) L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const z0 = 1 - Math.exp(-lt / 7);
    const dir = hash(this.seed, 3) < 0.5 ? -1 : 1;
    // 鏡頭：從斜上方往下看；切進來時高一點、慢慢降下來推近，同時繞著手機轉一點點
    const intro = ease.outCubic(prog(t, s, s + 1.2));
    const camH = 1850 - 160 * intro - 120 * z0, camZ = 950 - 40 * z0;
    const cx = (this.hasText ? (this.land ? -200 : -130) : 0) + dir * 40 * ease.inOutQuad(clamp(lt / 12));
    const cam: Cam = { x: cx, y: camH, z: camZ, yaw: 0, pitch: -Math.atan2(camH, camZ) + 0.02, f: 1500 };
    const P = (x: number, y: number, z: number) => project(cam, [x, y, z]);
    const tableQ: Quad = [P(TB.x0, 0, TB.z0), P(TB.x1, 0, TB.z0), P(TB.x1, 0, TB.z1), P(TB.x0, 0, TB.z1)];
    // 手機：直放是寬 w、長 l；橫放轉 90°
    const yaw = this.yaw + dir * 0.03 * z0 + (this.land ? Math.PI / 2 : 0);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const corner = (lx: number, lz: number, y: number) => P(this.px + lx * cy + lz * sy, y, this.pz - lx * sy + lz * cy);
    const hw = PH.w / 2, hl = PH.l / 2;
    // 左上、右上、右下、左下（手機自己的座標：z 往遠處是螢幕的上面）
    const quadAt = (y: number): Quad => [corner(-hw, -hl, y), corner(hw, -hl, y), corner(hw, hl, y), corner(-hw, hl, y)];
    const top = quadAt(PH.th), bot = quadAt(0);
    const u = this.bg.u;
    m3(u.table!, quadToUV(tableQ));
    m3(u.ptop!, quadToUV(top));
    m3(u.pbot!, quadToUV(bot));
    u.land!.value = this.land ? 1 : 0;
    (u.phc!.value as THREE.Vector2).set(this.px, this.pz);
    u.pyaw!.value = yaw;
    // 螢幕內容
    const inner = { w: (this.land ? PH.l : PH.w) - 2 * PH.bez, h: (this.land ? PH.w : PH.l) - 2 * PH.bez };
    const cols = this.land ? 6 : 3;
    const gap = 5, tile = (inner.w - gap * (cols + 1)) / cols, pitch = tile + gap;
    // 被點的那一格：第三排、中間；格子從下面滑上來
    const tRow = 2, tCol = this.land ? 2 : 1;
    const scroll = -760 * (1 - ease.outCubic(prog(t, s, this.tOpen - 0.1)));
    const tx = gap + tCol * pitch, ty = 150 + tRow * pitch - scroll;
    const thumb = [tx / inner.w, ty / inner.h, (tx + tile) / inner.w, (ty + tile) / inner.h];
    // 全螢幕：照片完整放在螢幕裡（黑底）
    const { w, h } = this.img;
    const sc = Math.min(inner.w / w, inner.h / h);
    const fw = (w * sc) / inner.w, fh = (h * sc) / inner.h;
    const full = [(1 - fw) / 2, (1 - fh) / 2, (1 + fw) / 2, (1 + fh) / 2];
    // 方的縮圖：繞著焦點裁成正方形
    const a = w / h;
    const sq = a > 1 ? [clamp(this.photo.fx - 0.5 / a, 0, 1 - 1 / a), 0] : [0, clamp(this.photo.fy - 0.5 * a, 0, 1 - a)];
    const sqCrop = a > 1 ? [sq[0]!, 0, sq[0]! + 1 / a, 1] : [0, sq[1]!, 1, sq[1]! + a];
    const op = ease.inOutCubic(prog(t, this.tOpen, this.tOpen + 0.45));
    const view = thumb.map((v, i) => lerp(v, full[i]!, op));
    // 打開之後兩根手指慢慢放大：往焦點推到 1.3 倍（很小的照片少推，不推糊）
    const scrPx = quadBounds(top).w * (this.land ? 0.92 : 0.86);
    const push = focusCropAt(this.photo, w, h, w / h, { k: settleK(t - this.tOpen - 0.45, 5), zoom: 1.3 }, scrPx * fw);
    const crop = sqCrop.map((v, i) => lerp(v, push[i]!, op));
    v4(u.view!, view);
    v4(u.crop!, crop);
    u.viewK!.value = op;
    u.scroll!.value = scroll;
    u.cols!.value = cols;
    u.target!.value = tRow * cols + tCol;
    u.uiK!.value = 1 - prog(t, this.tOpen + 0.6, this.tOpen + 1.4) * 0.6;
    u.lod!.value = photoLod(w * (crop[2]! - crop[0]!), scrPx * (view[2]! - view[0]!));
    u.photo!.value = this.tex;
    u.lit!.value = prog(t, s, s + 0.25, ease.outCubic) * (1 - 0.12 * prog(t, e - 0.3, e));
    const lp = P(-2400, 0, -1800);
    (u.lampP!.value as THREE.Vector2).set(lp[0], lp[1]);
    u.t!.value = t;
    u.k!.value = 1;
    this.bg.render(renderer, out);
    if (this.hasText) {
      this.drawText(t);
      const k = prog(t, this.tCap, this.tCap + 0.5, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      drawLayer(comp, renderer, this.layer, out, this.colX + 20 * (1 - k) - (cx - (this.land ? -200 : -130)) * 0.3, this.colY, { opacity: k });
    }
    return { bloom: 0.25, bloomThreshold: 1.05, halation: 0.12, vignette: 0.5 };
  }
}
