// 號外（亮版面）：老電影的「報紙轉著飛進畫面」。一份《愛的日報》號外從畫面中央的一個小點轉兩圈半、放大，
// 在拍點上「啪」地停住（一點回彈、畫面震一下）；最後一拍再轉著飛走。
//  - 頭條是主打留言（黑體特粗，放得下就越大越好），上面一行紅色的「號外」標籤、下面署名「本報記者 ○○ 現場報導」。
//  - 副標是歌詞：「現場連線」欄照跟唱規則逐字亮（正在唱的是訊號色）。
//  - 右欄是一張網點印刷的「新聞照片」——不是照片，是 shader 畫的兩只交扣的戒指，印成網點；它是會動的報紙（像魔法報紙），
//    戒指每一拍轉一格，網點大小跟著低音呼吸。
//  - 其他都是冷面的內文（「據現場目擊者指出，兩人多次被發現一起吃早餐、遛狗、打羽球，且狀況穩定」）、天氣欄「降愛機率 100%」。
// 畫法：不會變的版面（報頭、頭條、內文、圖說）開場畫在一張畫布上、只上傳一次（有 mipmap，轉得很小的時候才不會閃）；
// 會變的只有副標那一條（小的 fast 圖層）。報紙的位置、旋轉、轉動時的動態模糊（沿著旋轉方向取好幾次樣）、網點、
// 背面透過來的字、桌上的影子，全部在一個 shader 裡算。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { mixRgba, rgba } from '../engine/palette';
import { clamp, ease, hash, prog, pulse, frameIdx } from '../engine/util';
import { wrap } from '../engine/text';
import { lyricAt, drawLyric, layoutLyric, beatAfter, fillWithHearts, COUPLE_ZH, DATE_DOTS } from './_motifs';
import { sigInk, paperLyric, makeCanvas, freeCanvas, xfRect, ensureBake, themeKey, fitMsg, yieldFrame, type Rect } from './_t1';

export const spec: PlateSpecDecl = { group: 'type', family: 'doc', paper: true, energy: [0.45, 1], bars: [4, 8], weight: 1 };

type Ctx2 = CanvasRenderingContext2D;

/** 報紙（摺線以上的半版，紙面座標）。 */
const PG = { w: 1500, h: 1040 };
/** 放好的時候：中心在螢幕上的位置、角度。 */
const REST = { x: 842, y: 552, rot: -0.026 };
/** 頭條、副標（歌詞）、網點照片（紙面座標）。 */
const HEAD = { x: 40, y: 170, w: 1140, h: 400 };
const BAND = { y: 590, h: 150 };
const SUB = { x: 40, label: 616, base: 676, maxW: 1130 };
const PHOTO = { x: 1214, y: 176, w: 252, h: 400 };

const COPY = '【本報訊】宣文與孟庭今日正式結為連理。據現場目擊者指出，兩人過去數年間多次被發現一起吃早餐、遛狗、打羽球，且狀況穩定。對此，雙方家長表示「早就知道了」。記者在喜宴會場訪問多位賓客，受訪者一致表示菜很好吃、新娘很美、新郎笑得合不攏嘴。氣象單位預測，今晚降愛機率百分之百，請民眾隨身攜帶面紙。另據了解，兩隻博美犬芃芃與 QQ 亦已到場祝賀，精神良好。本報將持續追蹤報導。';
const TEXT = '號外愛的日報中華民國年月日星期第號每份元本報記者現場報導現場連線正在播放今日天氣晴時多雲偶陣愛降愛機率快訊兩枚戒指今日正式扣在一起示意圖攝影本報資料室新人發表談話獨家大螢幕開放留言掃描右下角把祝福寫上大螢幕間奏中本曲為純音樂請自行哼唱一位賓客全體賓客' + COPY;

const NEWS_FRAG = /* glsl */ `
uniform sampler2D pageTex; uniform sampler2D bandTex; uniform sampler2D bake;
uniform vec4 xf;      // 報紙中心（螢幕像素，y 向下）、角度、縮放
uniform vec2 blur;    // 這一格轉了多少（弧度）、縮放了多少（log）：沿著它取樣做動態模糊
uniform float ringA; uniform float ringB; uniform float dotK; uniform float shadowK; uniform vec3 lamp;
const vec2 PG = vec2(${PG.w}.0, ${PG.h}.0);
const vec4 BANDR = vec4(0.0, ${BAND.y}.0, ${PG.w}.0, ${BAND.h}.0);
const vec4 PH = vec4(${PHOTO.x}.0, ${PHOTO.y}.0, ${PHOTO.w}.0, ${PHOTO.h}.0);
mat2 R(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec2 toPage(vec2 sp, float dr, float ds) { return PG * 0.5 + R(-(xf.z + dr)) * (sp - xf.xy) / (xf.w * exp(ds)); }

// 一只戒指（繞垂直軸轉 phi，投影成橢圓）：回傳 (覆蓋率, 暗度)。距離用梯度校正，戒圈轉到側面時管子的粗細也不變。
vec2 ring(vec2 q, vec2 c, float phi, float Rr, float tube) {
  vec2 d = q - c;
  float cx = max(abs(cos(phi)), 0.14);
  vec2 e = vec2(d.x / cx, d.y);
  float le = max(length(e), 1e-3);
  float gl = length(vec2(e.x / (cx * le), e.y / le));
  float dist = (le - Rr) / max(gl, 1e-3);
  float cov = 1.0 - smoothstep(tube - 1.2, tube + 1.2, abs(dist));
  float ang = atan(e.y, e.x);
  float across = abs(dist) / tube;
  // 金屬：沿著戒圈亮暗交替、一道高光、管子兩側的邊比較暗
  float base = 0.62 + 0.3 * cos(ang * 2.0 + phi);
  float hi = pow(max(0.0, cos(ang - 2.2 + phi * 0.5)), 14.0);
  float rim = smoothstep(0.5, 1.0, across) * 0.55;
  float bright = sat(base + 0.6 * hi - rim);
  return vec2(cov, 1.0 - bright);
}
// 網點照片的暗度（0 = 白、1 = 全黑）：攝影棚的灰背景（上暗下亮、中間一圈柔光）、地上的影子、兩只交扣的戒指
float photoDark(vec2 p) {
  vec2 q = p - (PH.xy + PH.zw * vec2(0.5, 0.45));
  float bg = 0.64 - 0.28 * sat((p.y - PH.y) / PH.w) - 0.22 * exp(-dot(q, q) / (2.0 * 120.0 * 120.0));
  float sh = exp(-pow(length((q - vec2(0.0, 128.0)) / vec2(118.0, 13.0)), 2.0));
  bg = sat(bg + 0.4 * sh);
  vec2 a = ring(q, vec2(-34.0, -6.0), ringA, 68.0, 13.0);
  vec2 b = ring(q, vec2(34.0, 8.0), ringB, 68.0, 13.0);
  float dark = bg;
  // 交扣：上半部 A 蓋 B、下半部 B 蓋 A
  if (q.y < 0.0) { dark = mix(dark, b.y, b.x); dark = mix(dark, a.y, a.x); }
  else { dark = mix(dark, a.y, a.x); dark = mix(dark, b.y, b.x); }
  return sat(dark);
}
// 網點：45 度的格子，點的面積 = 暗度
float halftone(vec2 p, float dark) {
  vec2 r = R(0.785) * p / 6.5;
  vec2 f = fract(r) - 0.5;
  float rad = sqrt(dark * dotK) * 0.62;
  return 1.0 - smoothstep(rad - 0.08, rad + 0.08, length(f));
}
// 注意：這裡都用 textureLod（明確給 mip 層級）。pageAt 在迴圈與分支裡被呼叫（動態模糊的取樣數、紙外面直接 return），
// 那裡的螢幕導數（texture() 自動算 mip 層級用的）是未定義的：ANGLE → D3D11 上偶爾會挑到不同的 mip，
// 同一個時間點畫兩次結果差 1（確定性檢查不過）。報紙只有旋轉＋等比縮放，每個像素的取樣範圍一樣大，層級在 main 算一次就好。
vec4 pageAt(vec2 pp, float lod) {
  if (pp.x < 0.0 || pp.y < 0.0 || pp.x > PG.x || pp.y > PG.y) return vec4(0.0);
  vec2 uv = vec2(pp.x / PG.x, 1.0 - pp.y / PG.y);
  vec3 col = textureLod(pageTex, uv, lod).rgb;
  // 背面透過來的字（鏡像、很淡，取模糊一點的 mip）
  vec3 back = textureLod(pageTex, vec2(1.0 - uv.x, uv.y), lod + 2.5).rgb;
  col *= 1.0 - 0.03 * sat(1.0 - luma(back) / max(luma(C_PAPER), 0.05));
  if (pp.y > BANDR.y && pp.y < BANDR.y + BANDR.a) {
    vec4 b = textureLod(bandTex, vec2(pp.x / PG.x, 1.0 - (pp.y - BANDR.y) / BANDR.a), 0.0);
    // fast 的 Layer2D：解預乘、轉線性、再預乘
    b.rgb = b.a > 0.0 ? toLinear(b.rgb / b.a) * b.a : vec3(0.0);
    col = col * (1.0 - b.a) + b.rgb;
  }
  if (pp.x > PH.x && pp.y > PH.y && pp.x < PH.x + PH.z && pp.y < PH.y + PH.w) {
    float ink = halftone(pp, photoDark(pp));
    col = mix(col, mix(C_SEPIA, C_INK, 0.5), ink * 0.6);
  }
  // 摺線：下緣一條暗線
  col *= 1.0 - 0.25 * smoothstep(PG.y - 10.0, PG.y, pp.y);
  return vec4(col, 1.0);
}
void main() {
  vec2 sp = vec2(vUv.x * ${W}.0, (1.0 - vUv.y) * ${H}.0);
  vec4 bk = texture(bake, vUv);
  vec3 desk = mix(C_PAPER, C_SEPIA, 0.22) * (0.93 + 0.14 * bk.g);
  // 桌上的影子：報紙的矩形往右下偏、邊緣很軟
  vec2 sq = toPage(sp - vec2(14.0, 22.0) * xf.w, 0.0, 0.0);
  vec2 dd = max(max(-sq, sq - PG), 0.0);
  float shadow = exp(-dot(dd, dd) / (2.0 * pow(22.0 / max(xf.w, 0.05), 2.0))) * shadowK;
  desk *= 1.0 - 0.3 * shadow;
  // 貼圖的 mip 層級：一個實體像素蓋住幾個貼圖像素（貼圖是紙面的 1.25 倍）
  float lod = max(0.0, log2(max(1.25 / (max(xf.w, 1e-3) * PX_SCALE), 1e-3)));
  vec4 acc = vec4(0.0);
  int n = (abs(blur.x) + abs(blur.y) > 0.002) ? 12 : 1;
  for (int i = 0; i < 12; i++) {
    if (i >= n) break;
    float k = n == 1 ? 0.0 : (float(i) + hash12(sp + float(i))) / float(n) - 0.5;
    acc += pageAt(toPage(sp, blur.x * k, blur.y * k), lod);
  }
  acc /= float(n);
  vec3 col = desk * (1.0 - acc.a) + acc.rgb;
  col *= 0.8 + 0.4 * bk.r;
  // 燈：一盞燈照在頭條上，四周暗下去（跟其他紙本版面同一種光）
  vec2 lp = (sp - lamp.xy) / lamp.z;
  col *= 0.74 + 0.3 * exp(-dot(lp, lp));
  fragColor = vec4(col, 1.0);
}`;

const PASS = () => new FSPass(NEWS_FRAG, {
  pageTex: { value: null }, bandTex: { value: null }, bake: { value: null },
  xf: { value: new THREE.Vector4() }, blur: { value: new THREE.Vector2() },
  ringA: { value: 0 }, ringB: { value: 0 }, dotK: { value: 1 }, shadowK: { value: 1 }, lamp: { value: new THREE.Vector3(760, 420, 1100) },
});

export default class Newspaper extends Scene {
  band = this.track(new Layer2D(PG.w, BAND.h, 1.25, { fast: true }));
  pass = shared('newspaper.pass', PASS);
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = Number(this.ctx.params.seed ?? 1);
  page: ReturnType<typeof makeCanvas> | null = null;
  tex: THREE.CanvasTexture | null = null;
  artKey = '';
  B = 0.5;
  s0 = 0;
  land = 0;
  out0 = Infinity;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, start: s, end: e } = this.ctx;
    const m = this.msg;
    await loadText(TEXT + (m ? m.text + m.name : '') + COUPLE_ZH + lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join(''));
    const B = (this.B = au.beatPeriod(s + 0.1));
    // 轉進來：約一秒（快歌兩拍、慢歌一拍），落在拍點上
    const D = clamp(B * 2, 0.75, 1.15);
    this.land = beatAfter(au, s + Math.min(D, 0.9));
    this.s0 = Math.max(s, this.land - D);
    // 轉出去：最後一拍（窗格夠長才轉）
    const outD = Math.min(0.36, 0.75 * B);
    if (e - this.land > 3 * B) this.out0 = e - outD;
    await yieldFrame();
    this.drawPage(false);
    await yieldFrame();
    this.ctx.renderer.initTexture(this.tex!);
    const X = REST.x - (PG.w / 2) * Math.cos(REST.rot) + (PG.h / 2) * Math.sin(REST.rot);
    const Y = REST.y - (PG.w / 2) * Math.sin(REST.rot) - (PG.h / 2) * Math.cos(REST.rot);
    this.avoid = [xfRect([HEAD.x, HEAD.y - 40, HEAD.w, HEAD.h + 40], X, Y, REST.rot), xfRect([SUB.x, BAND.y + 10, SUB.maxW, BAND.h - 10], X, Y, REST.rot)];
  }

  override dispose() { this.tex?.dispose(); freeCanvas(this.page); this.page = null; super.dispose(); }

  /** 不會變的版面。主題換了就重畫、重新上傳。 */
  /** upload = true：馬上上傳（換主題重畫時）；init 裡另外讓一下再上傳。 */
  private drawPage(upload = true) {
    this.artKey = themeKey();
    freeCanvas(this.page);
    const pg = (this.page = makeCanvas(PG.w, PG.h, 1.25));
    const c = pg.c;
    const m = this.msg;
    const INK = mixRgba('sepia', 'ink', 0.45);
    const ink = (a: number) => mixRgba('sepia', 'ink', 0.45, a);
    // 新聞紙（比紙色灰一點）
    c.fillStyle = mixRgba('paper', 'ash', 0.14);
    c.fillRect(0, 0, PG.w, PG.h);
    // MV 化：報頭、號外都縮小（配角），天氣欄拿掉；頭條（留言）是整版最大的字
    // 號外：小小的訊號色標籤
    c.fillStyle = sigInk(0.95);
    c.fillRect(40, 44, 128, 52);
    c.fillStyle = mixRgba('paper', 'ash', 0.14);
    c.font = font(F.hei(900), 34); c.letterSpacing = '6px'; c.fillText('號外', 56, 83);
    c.letterSpacing = '0px';
    // 報頭
    c.textAlign = 'center';
    c.fillStyle = ink(0.8);
    c.font = font(F.ming(900), 62); c.letterSpacing = '22px'; c.fillText('愛的日報', PG.w / 2 + 11, 90);
    c.letterSpacing = '0px';
    // 日期列（上粗下細的雙線）
    const [yy = '2027', mm = '03', dd = '13'] = DATE_DOTS.split(' · ');
    const wk = '日一二三四五六'[new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd))).getUTCDay()]!;
    const roc = String(Number(yy) - 1911).split('').map((d) => '〇一二三四五六七八九'[Number(d)]).join('');
    c.fillStyle = ink(0.7); c.fillRect(40, 112, PG.w - 80, 3); c.fillRect(40, 146, PG.w - 80, 1.2);
    c.fillStyle = ink(0.55);
    c.font = font(F.hei(500), 16); c.letterSpacing = '3px';
    c.textAlign = 'left'; c.fillText(`中華民國${roc}年${Number(mm)}月${Number(dd)}日　星期${wk}`, 46, 136);
    c.textAlign = 'right'; c.fillText('每份 ∞ 元', PG.w - 46, 136);
    c.textAlign = 'left'; c.letterSpacing = '0px';

    // 頭條：留言（放得下就越大越好）
    const head = m ? m.text : '大螢幕開放留言！';
    const kicker = m?.couple ? '新人發表談話' : m ? '獨家' : '快訊';
    c.fillStyle = sigInk(1);
    c.font = font(F.hei(900), 22); c.letterSpacing = '6px'; c.fillText(`【${kicker}】`, HEAD.x - 6, HEAD.y + 22);
    c.letterSpacing = '0px';
    const fit = fitMsg(c, head, F.hei(900), HEAD.w, HEAD.h - 40, { min: 60, max: 220, lineHeight: 1.14, maxLines: 4, oneLine: 110 });
    c.fillStyle = INK;
    c.font = font(F.hei(900), fit.size);
    const top = HEAD.y + 40 + (HEAD.h - 40 - fit.height) / 2 + fit.size * 0.88;
    c.fillStyle = INK;
    fit.lines.forEach((ln, i) => fillWithHearts(c, ln, HEAD.x, top + i * fit.lineHeight));
    // 副標欄的框線（字在 band 圖層）
    c.fillStyle = ink(0.8); c.fillRect(HEAD.x, BAND.y, HEAD.w, 2);
    // 署名
    const who = m ? (m.couple ? COUPLE_ZH : m.name || '一位賓客') : '大螢幕';
    c.fillStyle = ink(0.75);
    c.font = font(F.hei(700), 24); c.letterSpacing = '3px';
    const by = m ? `本報記者　${who}　現場報導` : '請掃描右下角 QR code，把祝福寫上大螢幕';
    c.fillText(by, HEAD.x, 786);
    c.letterSpacing = '0px';
    c.fillStyle = ink(0.7); c.fillRect(HEAD.x, 800, HEAD.w, 1.2);
    // 內文：四欄冷面的新聞稿——景深外的背景紋理：畫得淡、再模糊一點（鏡頭推近頭條時，它們是失焦的）
    c.save();
    c.filter = 'blur(1.6px)';
    c.font = font(F.ming(400), 17);
    const colW = (HEAD.w - 3 * 24) / 4;
    const lines = wrap(c, COPY + COPY, colW);
    let li = 0;
    for (let k = 0; k < 4; k++) {
      const x = HEAD.x + k * (colW + 24);
      for (let y = 832; y < PG.h - 16; y += 27) { const l = lines[li++ % lines.length]!; c.fillStyle = ink(0.5); c.fillText(l, x, y); }
      if (k < 3) { c.fillStyle = ink(0.2); c.fillRect(x + colW + 11, 814, 1, PG.h - 830); }
    }
    c.restore();
    // 右欄：網點照片的框、圖說
    c.strokeStyle = ink(0.5); c.lineWidth = 1.2; c.strokeRect(PHOTO.x - 1, PHOTO.y - 1, PHOTO.w + 2, PHOTO.h + 2);
    c.fillStyle = ink(0.55);
    c.font = font(F.hei(500), 15); c.letterSpacing = '1px';
    const cap = wrap(c, '▲ 兩枚戒指今日正式扣在一起（示意圖）', PHOTO.w);
    cap.forEach((l, i) => c.fillText(l, PHOTO.x, PHOTO.y + PHOTO.h + 26 + i * 22));
    c.letterSpacing = '0px';
    c.fillStyle = ink(0.25); c.fillRect(PHOTO.x - 18, 176, 1, PG.h - 196);

    this.tex?.dispose();
    const tx = (this.tex = new THREE.CanvasTexture(pg.cv));
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.generateMipmaps = true;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.needsUpdate = true;
    // 先上傳（慢的上傳方式，但整個窗格只上傳這一次；放在 init 做，播放時才不會卡一格）
    if (upload) this.ctx.renderer.initTexture(tx);
  }

  /** 報紙在 t 的位置：轉著放大進來（最後一點回彈），停住，最後一拍轉著縮小飛走。 */
  private pose(t: number) {
    let rot = REST.rot, sc = 1;
    if (t < this.land) {
      const u = prog(t, this.s0, this.land);
      rot = REST.rot - 5 * Math.PI * (1 - ease.outCubic(u));
      sc = Math.max(0.02, ease.outBack(u, 1.3));
    }
    if (t > this.out0) {
      const u = prog(t, this.out0, this.ctx.end, ease.inCubic);
      rot += 3 * Math.PI * u;
      sc *= 1 - 0.97 * u;
    }
    // 停住之後：鏡頭很慢地推近頭條，大鼓時紙輕輕往前一下
    const hold = prog(t, this.land, this.out0 < Infinity ? this.out0 : this.ctx.end);
    const kick = this.ctx.audio.hit('kick', t, 0.1);
    sc *= 1 + 0.035 * ease.inOutCubic(hold) + 0.006 * kick;
    const x = REST.x - 60 * ease.inOutCubic(hold) * 0.35, y = REST.y + 30 * ease.inOutCubic(hold) * 0.35;
    return { x, y, rot, sc };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t;
    if (this.artKey !== themeKey()) this.drawPage();
    const p = this.pose(t), q = this.pose(t - 1 / 60);
    // 副標：歌詞（紙面座標，只畫副標那一條）
    const L = this.band;
    L.clear();
    this.drawSub(L.ctx, t);
    const u = this.pass.u;
    u.pageTex!.value = this.tex;
    u.bandTex!.value = L.upload();
    u.bake!.value = ensureBake(renderer);
    (u.xf!.value as THREE.Vector4).set(p.x, p.y, p.rot, p.sc);
    // 動態模糊：這一格轉了多少、放大了多少（快門約一格半）
    (u.blur!.value as THREE.Vector2).set((p.rot - q.rot) * 1.5, Math.log(Math.max(1e-3, p.sc) / Math.max(1e-3, q.sc)) * 1.5);
    const beat = this.ctx.audio.beatAt(t);
    const bi = Math.floor(beat), bf = beat - bi;
    const step = bi + ease.outExpo(clamp(bf / 0.3));
    u.ringA!.value = step * (Math.PI / 5);
    u.ringB!.value = -step * (Math.PI / 5) + 1.2;
    u.dotK!.value = 1 + 0.35 * this.ctx.audio.env('low', t);
    u.shadowK!.value = clamp(p.sc * 1.2);
    this.pass.render(renderer, out);
    const amp = 12 * pulse(t, this.land, 0.07);
    const ph = frameIdx(t);
    return {
      paper: 1, popupAvoid: this.avoid, bloom: 0.2, bloomThreshold: 1.6, halation: 0.05, vignette: 0.3, grain: 0.06, ca: 0.6,
      shake: [amp * (hash(ph, 3) - 0.5) * 2, amp * (hash(ph, 4) - 0.5) * 2],
      // 停住的那一下：畫面往前衝一點
      zoom: 1 + 0.03 * pulse(t, this.land, 0.1),
    };
  }

  /** 副標欄：「現場連線」標籤＋一行跟唱的歌詞（紙面座標減掉 BAND.y）。 */
  private drawSub(c: Ctx2, t: number) {
    const { lyrics } = this.ctx;
    const y0 = BAND.y;
    const INKC = (a: number) => mixRgba('sepia', 'ink', 0.45, a);
    c.save();
    c.translate(0, -y0);
    c.fillStyle = sigInk(1);
    c.fillRect(SUB.x, SUB.label - 15, 10, 18);
    c.fillStyle = INKC(0.75);
    c.font = font(F.hei(700), 18); c.letterSpacing = '5px'; c.fillText('現場連線', SUB.x + 20, SUB.label + 1);
    c.font = font(F.mono(600), 13); c.letterSpacing = '4px'; c.fillText('LIVE · 正在播放', SUB.x + 136, SUB.label);
    c.letterSpacing = '0px';
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = paperLyric(F.archivo(100, 800), 58, SUB.maxW, { sung: INKC(0.95), unsung: INKC(0.26), lineHeight: 1.12 });
      const lay = layoutLyric(c, ly.line, st);
      const inK = ease.outExpo(prog(t, ly.line.start - 0.35, ly.line.start + 0.15));
      c.save();
      c.translate(SUB.x, SUB.base + (1 - inK) * 14);
      drawLyric(c, ly.line, t, st, lay, ly.k);
      c.restore();
    } else {
      const next = lyrics.nextLine(t), last = lyrics.lastLine(t);
      let k = 0.6;
      if (last) k *= clamp((t - last.end - 1.2) / 0.4);
      if (next) k *= clamp((next.start - 0.35 - t) / 0.25);
      if (k > 0.01) {
        c.globalAlpha = k;
        c.fillStyle = INKC(0.6);
        c.font = font(F.hei(700), 44); c.letterSpacing = '4px';
        c.fillText(lyrics.has ? '♪（間奏中，記者正在趕稿）' : '♪ 本曲為純音樂，請自行哼唱', SUB.x, SUB.base);
        c.letterSpacing = '0px';
      }
    }
    c.restore();
  }
}
