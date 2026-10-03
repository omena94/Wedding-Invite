// 照片版面「郵票」（亮）：照片做成一張大郵票（齒孔邊、白邊、細框、角落印著面額與新人縮寫），裝在集郵冊頁上的透明護郵袋裡——
//  - 切進來時郵票被放進護郵袋（從上面一點點落下、影子收緊），鏡頭很慢地推近，像微距鏡頭：郵票清楚、遠處的方格頁糊掉。
//  - 一個拍點「蓋郵戳」：印章落下前影子先罩過來，落下時畫面震一下，郵戳的墨印在郵票的一角（避開照片的焦點那一角）並延伸到頁面上
//    （圓戳＋波浪線；圓戳上是新人的名字與婚禮日期，沒定日期就不印日期、中間改成一顆小愛心）。之後每個小節護郵袋的反光掃過一次。
//  - 照片完整呈現（郵票就是照片的比例），很小的舊照片最多放大到原尺寸 1.5 倍；郵票上的畫面慢慢往新人點的臉推（focusCrop），
//    郵戳蓋在離焦點遠的那一角。
//  - 字像集郵冊的目錄說明，排在郵票右邊（思源宋體、墨色）：主字（賓客留言＋署名，或新人的註解）在上，歌詞小一號在下面跟唱；
//    沒有主字時歌詞放在同一個位置；兩個都沒有就只有郵票（移到中間）。相簿的第一張在上面多一行相簿名。
// 畫法：冊頁、郵票（齒孔用距離場挖洞）、護郵袋、郵戳的墨都在一個全螢幕 shader；郵票上的小字與郵戳先畫在兩張 Canvas2D 層（init 畫一次），
// shader 照郵票的角度取樣；註解是第三張層，跟著鏡頭縮放。
import * as THREE from 'three';
import { shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { beatAfter, barAfter, COUPLE_EN, DATE, DATE_DOT, INITIALS, drawHeart, fitPx } from './_motifs';
import { JourneyPlate, P7_GLSL, blit } from './_p7';

export const spec: PlateSpecDecl = { photo: true, paper: true, family: 'photo', series: 'journey', prefers: ['portrait', 'square', 'small'], energy: [0, 1], bars: [2, 8], weight: 1 };

/** 郵戳層：圓戳在右邊，波浪線往左延伸。 */
const PM = { w: 640, h: 300, cx: 490, cy: 150, r: 118 };

const BG = () => new FSPass(/* glsl */ `
  ${P7_GLSL}
  uniform sampler2D stampTex; uniform sampler2D pmTex;
  uniform vec2 zc; uniform float zoom; uniform float k; uniform float seedOff;
  uniform vec2 sc; uniform vec2 ss; uniform vec2 hs; uniform float ang; uniform float lift; uniform vec2 pitch;
  uniform vec2 pmC; uniform float pmAng; uniform float pmA; uniform vec2 pmSize; uniform vec2 pmPre;
  uniform float sheen;

  // 齒孔：郵票外框的距離場，四邊沿著邊挖一排圓洞
  float stampD(vec2 q, vec2 S) {
    float d = sdBox(q, S);
    float r = 9.0;
    vec2 a = abs(q);
    float hx = length(vec2(q.x - clamp(floor(q.x / pitch.x + 0.5) * pitch.x, -S.x, S.x), a.y - S.y)) - r;
    float hy = length(vec2(a.x - S.x, q.y - clamp(floor(q.y / pitch.y + 0.5) * pitch.y, -S.y, S.y))) - r;
    return max(d, -min(hx, hy));
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 w = zc + (p - zc) / zoom;
    float foc = length((w - sc) / (ss + vec2(260.0)));
    float blur = smoothstep(0.7, 1.6, foc);
    // ---- 集郵冊頁：奶油色的紙、很淡的方格（遠的糊掉）、左上來的窗光
    float n = fbm(w / 380.0 + seedOff, 3);
    vec3 col = mix(C_PAPER, C_BONE, 0.3) * (0.94 + 0.03 * n);
    vec2 g = abs(fract(w / 24.0 + 0.5) - 0.5) * 24.0;
    float gw = 0.5 + 6.0 * blur;
    col = mix(col, mix(C_SEPIA, C_SIGNAL, 0.2), 0.07 * (1.0 - blur * 0.7) * (1.0 - smoothstep(gw - 0.5, gw + 0.6, min(g.x, g.y))));
    col *= 0.93 + 0.1 * smoothstep(1700.0, 0.0, dot(w, vec2(0.7, 0.55)));

    // ---- 護郵袋（透明，比郵票大一圈）：邊上一道亮線、袋口一條細縫，很淡的斜反光
    vec2 q = rot2(ang) * (w - sc);
    float dm = sdBox(q, ss + vec2(22.0)) - 4.0;
    col *= 1.0 - 0.18 * shadowAt(sdBox(rot2(ang) * (w - sc - vec2(6.0, 10.0)), ss + vec2(22.0)), 10.0);
    if (dm < 0.0) {
      col *= 0.96;
      col += C_BONE * 0.06 * (1.0 - smoothstep(0.0, 2.0, abs(dm + 1.5)));
      col += C_BONE * 0.05 * (1.0 - smoothstep(0.5, 1.5, abs(q.y + ss.y + 6.0))) * step(abs(q.x), ss.x + 20.0);
    }
    // ---- 郵票：落下時影子遠、淡
    vec2 so = vec2(4.0, 7.0) * (1.0 + 3.0 * lift);
    float dS0 = stampD(rot2(ang) * (w - sc - so), ss);
    col *= 1.0 - (0.3 / (1.0 + lift)) * shadowAt(dS0, 5.0 + 18.0 * lift);
    float dS = stampD(q, ss);
    float aS = 1.0 - smoothstep(-0.8, 0.8, dS);
    if (aS > 0.0) {
      vec3 paper = C_BONE * 0.9 * (0.97 + 0.03 * snoise(q / 5.0));
      // 細框（印刷的雙線）
      float fr = sdBox(q, hs + vec2(9.0));
      paper = mix(paper, mix(C_BLOOD, C_SEPIA, 0.4), 0.8 * (1.0 - smoothstep(0.6, 1.6, abs(fr))));
      float di = sdBox(q, hs);
      float ai = 1.0 - smoothstep(-0.7, 0.7, di);
      if (ai > 0.0) paper = mix(paper, photoAt((q + hs) / (2.0 * hs)), ai);
      // 郵票上的小字（縮寫、面額）
      vec4 tx = layerAt(stampTex, (q + ss) / (2.0 * ss));
      paper = paper * (1.0 - tx.a) + tx.rgb;
      col = mix(col, paper, aS);
    }
    // ---- 護郵袋的反光（每個小節掃過一次）
    if (dm < 0.0) {
      float band = (q.x + q.y * 0.8) / (ss.x * 2.0) - sheen;
      col += C_BONE * 0.07 * exp(-band * band * 40.0);
    }
    // ---- 郵戳：落下前印章的影子罩過來；蓋下去之後是墨（斑駁、有些地方沒沾到）
    vec2 pq = rot2(pmAng) * (w - pmC);
    float pre = pmPre.x;
    if (pre > 0.0) col *= 1.0 - pre * 0.32 * exp(-max(length(pq - vec2(0.0, 0.0) + vec2(14.0, -20.0) * (1.0 + 2.0 * (1.0 - pre))) - 140.0, 0.0) / (30.0 + 40.0 * (1.0 - pre)));
    if (pmA > 0.0) {
      vec2 luv = (pq + vec2(${PM.cx}.0, ${PM.cy}.0)) / pmSize;
      vec4 ink = layerAt(pmTex, luv);
      float grain = smoothstep(-0.55, 0.25, snoise(pq / 7.0 + seedOff) + 0.5 * snoise(pq / 2.2));
      float a = ink.a * grain * pmA;
      col = mix(col, col * mix(C_SEPIA, C_INK2, 0.4) * 1.6, a * 0.85);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, pgain: { value: 1 }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) }, stampTex: { value: null }, pmTex: { value: null },
  zc: { value: new THREE.Vector2() }, zoom: { value: 1 }, k: { value: 1 }, seedOff: { value: 0 },
  sc: { value: new THREE.Vector2() }, ss: { value: new THREE.Vector2() }, hs: { value: new THREE.Vector2() }, ang: { value: 0 }, lift: { value: 0 }, pitch: { value: new THREE.Vector2(26, 26) },
  pmC: { value: new THREE.Vector2() }, pmAng: { value: 0 }, pmA: { value: 0 }, pmSize: { value: new THREE.Vector2(PM.w, PM.h) }, pmPre: { value: new THREE.Vector2() },
  sheen: { value: -2 },
});

/** 目錄說明的字塊：寬、高上限（相簿名＋主字＋署名＋歌詞）。60 字的留言在 40 px 排得進四行。 */
const COL_W = 600, COL_H = 450, GAP = 100, MARGIN = 34;

export default class StampBook extends JourneyPlate {
  bg = shared('stampbook.bg', BG);
  text = this.track(new Layer2D(COL_W + 40, COL_H + 60, undefined, { fast: true }));
  pm = this.track(new Layer2D(PM.w, PM.h, undefined, { fast: true }));
  stampL: Layer2D | null = null;
  scx = 0; scy = 0; ssx = 0; ssy = 0; hw = 0; hh = 0; ang = 0;
  pmX = 0; pmY = 0; pmAng = 0;
  colX = 0; colY = 0;
  tPM = 0;
  value = '';

  override async init() {
    const value = DATE ? `${DATE.m}${DATE.dd}` : '520';
    this.value = value;
    await this.loadPhoto(`${value}${INITIALS}${DATE_DOT}${COUPLE_EN.toUpperCase()}`);
    const { start, end, audio } = this.ctx;
    this.makeText(this.text.ctx, {
      w: COL_W, h: COL_H, family: F.ming(700), lineHeight: 1.45,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.4), sigInk: rgba('sepia', 0.72), sigFamily: F.ming(500),
      label: { family: F.hei(500), size: 21, color: rgba('sepia', 0.56), tracking: 6, gap: 26 },
    });
    const { w, h } = this.img!;
    const s = this.fitScale(this.hasText ? 700 : 920, this.hasText ? 560 : 620);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.ssx = this.hw + MARGIN; this.ssy = this.hh + MARGIN + 10;
    const tw = 2 * (this.ssx + 22);
    const groupW = this.hasText ? tw + GAP + COL_W : tw;
    const x0 = Math.max(150, (W - groupW) / 2 + (this.hasText ? 40 : -20));
    this.scx = x0 + tw / 2;
    this.scy = H / 2 - 20;
    this.colX = x0 + tw + GAP;
    const bh = this.blockH();
    this.colY = clamp(this.scy - bh / 2, 140, 785 - bh);
    this.ang = (hash(this.seed, 3) * 2 - 1) * 1.6 * (Math.PI / 180);
    // 郵戳蓋在左上或左下角：避開照片的焦點
    const top = this.photo.fy > 0.5;
    const c = Math.cos(this.ang), sn = Math.sin(this.ang);
    const lx = -this.ssx + 70, ly = top ? -this.ssy + 60 : this.ssy - 60;
    this.pmX = this.scx + c * lx - sn * ly; this.pmY = this.scy + sn * lx + c * ly;
    this.pmAng = (hash(this.seed, 5) * 2 - 1) * 10 * (Math.PI / 180) + (top ? -0.08 : 0.08);
    // 蓋郵戳：照片放好之後的第一個小節線（窗格短就早一點）
    const tb = barAfter(audio, start + 0.9);
    this.tPM = tb < end - 0.8 ? tb : Math.min(beatAfter(audio, start + 0.7), end - 0.5);
    this.drawStamp();
    this.drawPostmark();
  }

  /** 郵票上的小字：左上新人縮寫、右下面額。 */
  private drawStamp() {
    const L = this.track(new Layer2D(Math.ceil(2 * this.ssx), Math.ceil(2 * this.ssy), undefined, { fast: true }));
    this.stampL = L;
    const c = L.ctx;
    L.clear();
    const m = MARGIN, ink = mixRgba('blood', 'sepia', 0.4, 0.95);
    c.fillStyle = ink;
    c.textBaseline = 'alphabetic';
    c.font = font(F.serif(600), 22);
    c.letterSpacing = '4px';
    c.fillText(INITIALS.replace('&', ' & '), m + 4, m - 8);
    c.letterSpacing = '0px';
    const vs = fitPx(this.value, F.archivo(90, 900), 30, 160);
    c.font = font(F.archivo(90, 900), vs);
    c.textAlign = 'right';
    c.fillText(this.value, L.w - m - 4, L.h - 12);
    c.textAlign = 'left';
    L.upload();
  }

  /** 郵戳：雙圈、上緣一圈新人的名字、中間兩條橫線夾著日期（沒日期是一顆小愛心），左邊五條波浪線。 */
  private drawPostmark() {
    const L = this.pm, c = L.ctx;
    L.clear();
    const col = rgba('ink', 1);
    c.strokeStyle = col; c.fillStyle = col;
    const { cx, cy, r } = PM;
    c.lineWidth = 6; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, r - 24, 0, Math.PI * 2); c.stroke();
    // 上緣的字：沿著圓弧一個字一個字轉著寫
    const name = COUPLE_EN.toUpperCase();
    const fam = F.archivo(100, 700);
    let size = 24;
    const arc = (r - 12) * Math.PI * 0.85;
    c.font = font(fam, size);
    const wAt = () => { c.font = font(fam, size); return c.measureText(name).width + name.length * 3; };
    while (size > 14 && wAt() > arc) size -= 1;
    c.font = font(fam, size);
    const total = wAt();
    let a = -Math.PI / 2 - total / (r - 12) / 2;
    for (const ch of Array.from(name)) {
      const cw = c.measureText(ch).width + 3;
      const aa = a + cw / (r - 12) / 2;
      c.save();
      c.translate(cx + Math.cos(aa) * (r - 12), cy + Math.sin(aa) * (r - 12));
      c.rotate(aa + Math.PI / 2);
      c.textAlign = 'center';
      c.fillText(ch, 0, size * 0.36);
      c.restore();
      a += cw / (r - 12);
    }
    // 中間：兩條橫線夾著日期
    c.lineWidth = 3;
    for (const dy of [-30, 30]) { c.beginPath(); c.moveTo(cx - (r - 30), cy + dy); c.lineTo(cx + (r - 30), cy + dy); c.stroke(); }
    if (DATE_DOT) {
      const ds = fitPx(DATE_DOT, F.mono(600), 30, 2 * (r - 40));
      c.font = font(F.mono(600), ds);
      c.textAlign = 'center';
      c.fillText(DATE_DOT, cx, cy + ds * 0.36);
      c.textAlign = 'left';
    } else drawHeart(c, cx, cy + 2, 34, col);
    // 波浪線（往左）
    c.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      const y0 = cy - 64 + i * 32;
      c.beginPath();
      for (let x = 20; x <= cx - r - 14; x += 4) {
        const y = y0 + 9 * Math.sin((x / 64) * Math.PI * 2);
        if (x === 20) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    const u = this.bg.u;
    const drop = ease.outCubic(prog(t, s + 0.05, s + 0.65));
    // 蓋郵戳的那一下：鏡頭往前一頓
    const hit = t >= this.tPM ? Math.exp(-(t - this.tPM) / 0.12) : 0;
    const zoom = (1 + 0.045 * (1 - Math.exp(-lt / 7))) * (1 + 0.012 * hit);
    const zx = this.hasText ? (this.scx + this.colX + COL_W / 2) / 2 : this.scx, zy = this.scy;
    u.stampTex!.value = this.stampL!.texture;
    u.pmTex!.value = this.pm.texture;
    (u.zc!.value as THREE.Vector2).set(zx, zy);
    u.zoom!.value = zoom;
    u.seedOff!.value = hash(this.seed, 9) * 30;
    const sc = 1 + 0.06 * (1 - drop);
    (u.sc!.value as THREE.Vector2).set(this.scx, this.scy - 30 * (1 - drop));
    (u.ss!.value as THREE.Vector2).set(this.ssx * sc, this.ssy * sc);
    (u.hs!.value as THREE.Vector2).set(this.hw * sc, this.hh * sc);
    u.ang!.value = this.ang + 3 * (1 - drop) * (Math.PI / 180);
    u.lift!.value = 1 - drop;
    // 齒孔間距：剛好整除邊長（四個角都是洞）
    const px = (2 * this.ssx * sc) / Math.round((2 * this.ssx * sc) / 26), py = (2 * this.ssy * sc) / Math.round((2 * this.ssy * sc) / 26);
    (u.pitch!.value as THREE.Vector2).set(px, py);
    // 郵票放進護郵袋之後，郵票上的畫面往焦點推（郵票就是一張印刷品：推到 1.16 倍，還看得出整張）
    this.setPhoto(u, 2 * this.hw * sc * zoom, this.focusK(t, s + 0.5), 1.16);
    (u.pmC!.value as THREE.Vector2).set(this.pmX, this.pmY);
    u.pmAng!.value = this.pmAng;
    // 印章落下前 0.35 秒影子罩過來；蓋下去墨一下子就在
    (u.pmPre!.value as THREE.Vector2).set(t < this.tPM ? ease.inCubic(prog(t, this.tPM - 0.35, this.tPM)) : 0, 0);
    u.pmA!.value = t >= this.tPM ? 0.92 + 0.08 * hit : 0;
    // 護郵袋的反光：每個小節掃過一次
    const bar = audio.timeOfBar(Math.floor(audio.barAt(t) + 1e-6));
    u.sheen!.value = bar > s + 0.5 ? -1.2 + 2.6 * prog(t, bar, bar + 1.1, ease.inOutQuad) : -2;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.08 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    if (this.hasText) {
      this.paintBlock(this.text, t, 20, 20);
      const op = prog(t, s + 0.45, s + 1.0, ease.outCubic) * (1 - prog(t, e - 0.3, e));
      const lx = this.colX - 20, ly = this.colY - 20;
      if (op > 0) blit(comp, renderer, this.text, out, zx + (lx - zx) * zoom, zy + (ly - zy) * zoom, { opacity: op, s: zoom });
    }
    const sh = 5 * hit;
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.1, halation: 0.05, vignette: 0.3, shake: [sh * (hash(this.seed, 13) - 0.5), sh * 0.8] };
  }
}
