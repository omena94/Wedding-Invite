// 照片版面「報紙圖片頁」（亮，P8 印刷品）：照片印在一張攤在桌上的報紙上，鏡頭貼近紙面——
//  - 報紙斜斜地躺著（上緣比較遠），整張比畫面大，看到的是版面的一角：一張大照片、照片下（直的照片在旁邊）的圖說、
//    四周一欄一欄的內文（看不清的灰線，像焦外的鉛字）、上緣一條版頭（版名、版次、日期，小字）。
//  - 照片是新聞紙印出來的樣子：紙色吃掉最亮的白、黑壓不到底、顏色淡一點，上面很細的網點（近看才看得到），照片一定認得出來。
//    照片完整印出，印出來的畫面慢慢往新人點的焦點推（1.15 倍）；很小的舊照片最多放大到原尺寸約 1.5 倍。
//  - 圖說就是這一格的字（_photo.ts 的 PhotoText，思源宋體 40～48 px）：主字（賓客留言＋署名，或新人的註解），歌詞小一號接在下面跟唱；
//    沒有主字時歌詞自己當圖說。字多時照片縮小、把位置讓給圖說。照片的右下一行小字是相簿名（像攝影署名）。
//    兩個都沒有就沒有圖說，照片移到中間、四周是內文。
//  - 鏡頭：一開始對焦在旁邊的內文、從右邊滑過來，焦點拉到照片上（像紀錄片的插入鏡頭），之後很慢地推近；
//    斜躺的紙有景深：離焦點遠的上緣、下緣慢慢糊掉。窗光一大片很淡地從左上照進來，慢慢移。
//  - 右下角（HUD）是內文欄結束後的留白。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { rgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { DATE_DOTS } from './_motifs';
import { PressPlate, P8_GLSL, PHOTO_POST, F, font, planeQuad, planePoint, homographyPx, clip, textFits, PAPER_INK, type Plane, type PressTextStyle } from './_p8';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'press', paper: true, energy: [0, 0.85], bars: [2, 8], weight: 1, prefers: ['landscape', 'small'] };

/** 報紙的大小（設計 px）：比畫面大，看到的是一角。設計座標跟畫面差一個位移（OFF），排版直接用畫面上的位置想。 */
const PAGE = { w: 2400, h: 1700 };
const OFF = { x: (PAGE.w - W) / 2, y: (PAGE.h - H) / 2 };

const BG = () => new FSPass(/* glsl */ `${P8_GLSL}
  uniform sampler2D photo; uniform sampler2D cap; uniform sampler2D head;
  uniform mat3 mPage; uniform vec2 page; uniform vec4 pr; uniform vec4 crop; uniform float photoPx;
  uniform vec4 capRect; uniform vec4 headRect; uniform vec4 zones[6]; uniform vec4 hlRect;
  uniform float focusY; uniform float focusH; uniform float dof; uniform float rack; uniform float k; uniform float t;
  // 內文：看不清的鉛字（灰線）。q 是報紙座標，r 是欄的範圍，blur 是焦外程度（0..）
  float bodyText(vec2 q, vec4 r, float s, float blur) {
    if (q.x < r.x || q.y < r.y || q.x > r.x + r.z || q.y > r.y + r.w) return 0.0;
    vec2 l = q - r.xy;
    float colW = 286.0, gut = 30.0;
    float ci = floor(l.x / (colW + gut));
    float cx = l.x - ci * (colW + gut);
    if (cx > colW) return 0.0;
    float lead = 19.0;
    float row = floor(l.y / lead);
    float ry = l.y - row * lead;
    float h = hash12(vec2(row, ci + r.x));
    // 段落的最後一行比較短、段落之間空一行
    float para = hash12(vec2(floor(row / 7.0), ci + r.y));
    float lineEnd = mod(row, 7.0) == 6.0 ? 0.0 : mod(row, 7.0) == 5.0 ? colW * (0.3 + 0.5 * h) : colW;
    float aa = max(s, 0.6) + blur * 6.0;
    float inRow = smoothstep(4.0 - aa, 4.0 + aa, ry) * (1.0 - smoothstep(12.0 - aa, 12.0 + aa, ry));
    // 字與字之間的空白（中文排版的標點與詞距）
    float wi = floor(cx / 46.0);
    float wx = cx - wi * 46.0;
    float wl = 46.0 * (0.62 + 0.36 * hash12(vec2(wi, row + ci * 31.0)));
    float word = (1.0 - smoothstep(wl - aa, wl + aa, wx)) * (1.0 - smoothstep(lineEnd - aa, lineEnd + aa, cx));
    float tex = 0.75 + 0.25 * step(0.5, fract(cx / 9.0 + h));
    return inRow * word * mix(tex, 0.85, clamp(blur, 0.0, 1.0)) * (0.55 + 0.1 * para);
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 q = homo(mPage, p);
    float s = homoScale(mPage, p);
    // 景深：離焦點那幾排（照片＋圖說，半高 focusH 以內都清楚）越遠越糊（斜躺的紙，上緣比較遠）
    float blur = dof * smoothstep(120.0, 620.0, max(abs(p.y - focusY) - focusH, 0.0)) + rack;
    // 桌面（報紙外，只在推近前、斜看時的上緣附近露出一點）
    vec3 col = mix(C_SEPIA, C_PAPER, 0.55) * 0.8;
    float a = edgeA(q, page, s * (1.0 + blur * 4.0));
    // 新聞紙：比一般的紙灰、黃一點，纖維看得到
    float n = paperFiber(q);
    vec3 paperC = mix(C_PAPER, C_BONE, 0.2) * mix(vec3(1.0), vec3(0.94, 0.93, 0.88), 0.6) * (0.93 + 0.025 * n * (1.0 - min(blur, 1.0)));
    vec3 pc = paperC;
    // 內文欄
    float ink = 0.0;
    for (int i = 0; i < 6; i++) ink = max(ink, bodyText(q, zones[i], s, blur));
    // 焦外的大標題（兩條粗灰線）
    if (q.x > hlRect.x && q.y > hlRect.y && q.x < hlRect.x + hlRect.z && q.y < hlRect.y + hlRect.w) {
      vec2 l = q - hlRect.xy;
      float aa = s + blur * 8.0;
      float rowY = mod(l.y, 58.0);
      float bar = smoothstep(8.0 - aa, 8.0 + aa, rowY) * (1.0 - smoothstep(34.0 - aa, 34.0 + aa, rowY));
      float len = l.y < 58.0 ? hlRect.z : hlRect.z * 0.62;
      bar *= 1.0 - smoothstep(len - aa, len + aa, l.x);
      float gaps = 1.0 - 0.8 * (1.0 - smoothstep(0.0, aa + 1.0, abs(mod(l.x, 52.0) - 50.0)));
      ink = max(ink, bar * gaps * 0.55);
    }
    pc = mix(pc, C_SEPIA * 0.6, ink * 0.6);
    // 照片：新聞紙印的（紙色吃掉最亮的白、黑壓不到底、顏色淡一點、細網點）
    vec2 pq = (q - pr.xy) / pr.zw;
    float pa = 1.0 - smoothstep(-0.5, 0.5, max(max(-pq.x, pq.x - 1.0) * pr.z, max(-pq.y, pq.y - 1.0) * pr.w) / max(s, 1e-3));
    if (pa > 0.0) {
      float lod = log2(max(s * photoPx / pr.z, 1e-4) / PX_SCALE) + blur * 2.2;
      vec3 ph = photoLin(photo, cropUv(crop, pq), lod) / 0.82;
      float L = luma(ph);
      vec3 pn = mix(vec3(L), ph, 0.78);
      vec3 cont = paperC * (0.13 + 0.87 * pn);
      float cov = dotScreen(q, 5.6, 0.785, 1.0 - L, s / PX_SCALE);
      vec3 hue = ph / max(L, 0.03);
      vec3 dotC = mix(paperC, paperC * clamp(hue * 0.16, 0.0, 1.0), cov);
      vec3 printed = mix(cont, dotC, 0.26 * (1.0 - clamp(blur, 0.0, 1.0)));
      pc = mix(pc, printed * 0.95, pa);
    }
    // 版頭、圖說（畫在報紙座標裡的字）
    vec2 br = vec2(blur * 2.5 * s);
    vec4 hc = layerBlur(head, (q - headRect.xy) / headRect.zw, br / headRect.zw);
    pc = pc * (1.0 - hc.a) + hc.rgb;
    vec4 cc = layerBlur(cap, (q - capRect.xy) / capRect.zw, br / capRect.zw);
    pc = pc * (1.0 - cc.a) + cc.rgb;
    // 窗光：左上一大片很淡的亮，慢慢移；右下暗一點
    float lit = dot(p - vec2(-200.0 + t * 4.0, -300.0), normalize(vec2(0.75, 0.66)));
    pc *= 0.86 + 0.16 * smoothstep(1900.0, 400.0, lit);
    col = mix(col, pc, a);
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, phGain: { value: 1 }, cap: { value: null }, head: { value: null },
  mPage: { value: new THREE.Matrix3() }, page: { value: new THREE.Vector2(PAGE.w, PAGE.h) }, pr: { value: new THREE.Vector4() },
  crop: { value: new THREE.Vector4(0, 0, 1, 1) }, photoPx: { value: 1 },
  capRect: { value: new THREE.Vector4() }, headRect: { value: new THREE.Vector4() },
  zones: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4()) }, hlRect: { value: new THREE.Vector4() },
  focusY: { value: H / 2 }, focusH: { value: 0 }, dof: { value: 1 }, rack: { value: 0 }, k: { value: 1 }, t: { value: 0 },
});

type R = [number, number, number, number];
/** 圖說層裡，圖說第一行的上緣（上面是相簿名那一行）。 */
const CAP_TOP = 44;

export default class Presspage extends PressPlate {
  bg = shared('presspage.bg', BG);
  cap!: Layer2D;
  head!: Layer2D;
  /** 照片在畫面上的位置（設計時的畫面 px；報紙座標要再加 OFF）。 */
  ph: R = [0, 0, 0, 0];
  /** 圖說區（畫面 px）：照片下面或右邊。 */
  capR: R = [0, 0, 0, 0];
  side = false;
  zones: R[] = [];
  hl: R = [0, 0, 0, 0];
  dir = 1;

  override async init() {
    await this.loadPhoto(`生活版攝影${DATE_DOTS}A`);
    const a = this.aspect;
    const tx = this.hasText;
    // 橫的：照片寬最多 900（高最多 600），圖說在下面；直的：高最多 740，圖說在右邊一欄
    this.side = a < 1.05;
    // 斜躺的報紙下半部離鏡頭近、看起來比較大（約 1.2 倍）：照片下面的圖說排小一號，畫面上才是 40～50 px
    const near = this.side ? 1 : 0.86;
    const st = (w: number, h: number, maxLines = 4): PressTextStyle => ({
      family: F.ming(400), w, h, min: Math.round(40 * near), max: Math.round(48 * near), lineHeight: 1.4, maxLines,
      sigSize: Math.round(28 * near), lyricSubSize: Math.round(38 * near), lyricSize: Math.round(48 * near), ...PAPER_INK(),
    });
    /** 排圖說：先照四行排，60 字的留言放不下就多折幾行。 */
    const layText = (w: number, h: number, more: number) => { if (!textFits(this.makeText(st(w, h)), h)) this.makeText(st(w, h, more)); };
    const sc = (w: number) => Math.min(1, (this.img.w * 1.5) / w);
    let pw: number, phh: number, capW: number;
    if (!this.side) {
      pw = Math.min(900, 600 * a); pw *= sc(pw); phh = pw / a;
      capW = clamp(pw, 700, 900);
      if (tx) {
        // 照片在上（頂在 y = 140）、圖說在下，整塊到 y ≈ 880（再下面離鏡頭太近、放大太多）：先排字，照片用剩下的高度；
        // 照片縮小了，圖說的欄寬跟著再排一次
        for (let i = 0; i < 2; i++) {
          layText(capW, 400, 6);
          phh = Math.min(pw / a, 880 - 140 - CAP_TOP - 8 - this.text.height - this.text.size * 0.4);
          capW = clamp(phh * a, 700, 900);
        }
        pw = phh * a;
      }
    } else {
      phh = 740; pw = phh * a;
      const k = sc(pw); pw *= k; phh *= k;
      capW = 470;
      if (tx) layText(capW, phh - 80 - CAP_TOP, 8);
    }
    // 沒有字也建一個（空的）：圖說層照樣要畫相簿名
    if (!tx) this.makeText(st(capW, 400));
    let x0: number, y0: number;
    if (!this.side) {
      x0 = tx ? 190 : (1720 - pw) / 2;
      y0 = tx ? 140 : (H - phh) / 2 - 40;
    } else {
      x0 = tx ? 200 : (1720 - pw) / 2;
      y0 = (H - phh) / 2 - 30;
    }
    this.ph = [x0, y0, pw, phh];
    // 圖說層從照片下緣（直的：照片右邊）開始：最上面一行是相簿名（像攝影署名，小字），下面是圖說
    const textH = tx ? this.text.height + this.text.size * 0.4 : 0;
    this.capR = this.side ? [x0 + pw + 44, y0 + 20, capW, textH] : [x0, y0 + phh + 8, capW, textH];
    this.cap = this.track(new Layer2D(Math.max(capW, pw) + 20, Math.max(40, textH) + CAP_TOP + 20, SCALE, { fast: true }));
    // 直的：圖說貼著照片的下緣（報紙的側欄圖說），上面是內文接著排
    let sideZone: R = [0, 0, 0, 0];
    if (this.side && tx) {
      this.capR[1] = y0 + phh - (CAP_TOP + textH + 8);
      const zh = this.capR[1] - y0 - 30;
      if (zh > 80) sideZone = [this.capR[0], y0, capW, zh];
    }
    // 內文欄（畫面 px）：照片、圖說之外的地方；右下角（HUD）留白。圖說比照片寬時，右邊的欄從圖說右邊開始
    const right = tx && this.side ? this.capR[0] + capW + 50 : x0 + Math.max(pw, tx ? capW : 0) + 50;
    const zones: R[] = [];
    zones.push([right, 230, 1960 - right, 560]); // 右邊的欄（到 y = 790 結束）
    zones.push([-200, -200, 2300, 270]); // 上面（遠的，在焦外）
    zones.push([-200, 70, x0 - 50 + 200, 1000]); // 左邊
    if (!tx || this.side) zones.push([x0, y0 + phh + 50, Math.min(pw, 1360 - x0 - 40), 420]); // 照片下面
    else zones.push([0, 0, 0, 0]);
    zones.push([-200, 1010, 1560, 600]); // 最下面（近的，在焦外）
    zones.push(sideZone); // 直的：圖說上面
    this.zones = zones.map(([x, y, w, h]) => [x + OFF.x, y + OFF.y, Math.max(0, w), Math.max(0, h)] as R);
    this.hl = [right + OFF.x, 150 + OFF.y, Math.min(620, 1960 - right), 100];
    // 版頭：上面一條（看到的是一部分）
    this.head = this.track(new Layer2D(1500, 60, SCALE, { fast: true }));
    this.drawHead();
    this.dir = hash(this.seed, 5) < 0.5 ? -1 : 1;
  }

  /** 版頭：雙線、版名、版次、日期（小字）。 */
  private drawHead() {
    const L = this.head, c = L.ctx;
    L.clear();
    c.fillStyle = rgba('sepia', 0.7);
    c.fillRect(0, 44, L.w, 2.5);
    c.fillRect(0, 50, L.w, 1);
    c.font = font(F.hei(700), 22);
    c.letterSpacing = '8px';
    c.fillStyle = rgba('sepia', 0.85);
    c.fillText('生活', 0, 32);
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.7);
    c.fillText(`A${this.photo.n}`, 92, 31);
    if (DATE_DOTS) { c.textAlign = 'right'; c.fillText(DATE_DOTS, L.w - 10, 31); c.textAlign = 'left'; }
    c.letterSpacing = '0px';
    L.upload();
  }

  /** 照片右下一行相簿名（像攝影署名，小字）：橫的靠照片右緣，直的在圖說欄最上面。 */
  private drawCredit(c: CanvasRenderingContext2D) {
    if (!this.photo.album) return;
    c.save();
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('sepia', 0.6);
    const s = clip(c, `攝影／${this.photo.album}`, this.side ? this.capR[2] : this.ph[2]);
    if (this.side) c.fillText(s, 0, 20);
    else { c.textAlign = 'right'; c.fillText(s, this.ph[2], 20); }
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    // 滑進來：一開始在旁邊的內文（焦點也在那裡），1.3 秒滑到照片、焦點拉過來
    const inK = ease.outCubic(prog(t, s, s + 1.3));
    const z0 = 1 - Math.exp(-lt / 7);
    const page: Plane = { x: W / 2, y: H / 2, w: PAGE.w, h: PAGE.h, rx: (18 - 3 * z0) * (Math.PI / 180), rz: this.dir * (1.6 - 0.6 * z0) * (Math.PI / 180) };
    const [px, py, pw, phh] = this.ph;
    // 照片＋圖說這一整塊（橫的圖說在照片下面）：鏡頭對著它的中間，景深的清楚範圍也是它
    const gy0 = py, gy1 = this.side || !this.hasText ? py + phh : this.capR[1] + CAP_TOP + this.capR[3];
    const [fcx, fcy] = planePoint(page, (px + pw / 2 + OFF.x) / PAGE.w, ((gy0 + gy1) / 2 + OFF.y) / PAGE.h);
    const cam = {
      f: 1500, zoom: 1.0 + 0.05 * z0 + 0.1 * (1 - inK), cx: fcx, cy: fcy,
      dx: 300 * (1 - inK), dy: 40 * (1 - inK),
    };
    const q = planeQuad(page, cam);
    const u = this.bg.u;
    homographyPx(q, PAGE.w, PAGE.h, u.mPage!.value as THREE.Matrix3);
    (u.pr!.value as THREE.Vector4).set(px + OFF.x, py + OFF.y, pw, phh);
    // 印出來的照片往焦點推（印在紙上，1.15 倍）
    const crop = this.pushCrop(lt, pw / phh, 1.15, pw);
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoPx!.value = (crop[2] - crop[0]) * this.img.w;
    u.photo!.value = this.tex;
    u.phGain!.value = this.gain;
    this.paintText(this.cap, t, 0, CAP_TOP, (c) => this.drawCredit(c));
    u.cap!.value = this.cap.texture;
    const [cx, cy] = this.capR;
    (u.capRect!.value as THREE.Vector4).set(cx + OFF.x, cy + OFF.y, this.cap.w, this.cap.h);
    u.head!.value = this.head.texture;
    (u.headRect!.value as THREE.Vector4).set(180 + OFF.x, 46 + OFF.y, this.head.w, this.head.h);
    const zs = u.zones!.value as THREE.Vector4[];
    this.zones.forEach((z, i) => zs[i]!.set(...z));
    (u.hlRect!.value as THREE.Vector4).set(...this.hl);
    // 焦點：照片＋圖說那幾排（滑進來時從內文拉過來）
    const [, ffy0] = planePoint(page, 0.5, (gy0 + OFF.y) / PAGE.h, cam), [, ffy1] = planePoint(page, 0.5, (gy1 + OFF.y) / PAGE.h, cam);
    u.focusY!.value = (ffy0 + ffy1) / 2;
    u.focusH!.value = Math.max(0, (ffy1 - ffy0) / 2 - 160);
    u.dof!.value = 1.8;
    u.rack!.value = 1.6 * (1 - ease.outCubic(prog(t, s + 0.15, s + 1.2)));
    u.t!.value = t - s;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.6))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return PHOTO_POST(true, { vignette: 0.32 });
  }
}
