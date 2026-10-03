// 照片版面「旅行手帳」（亮）：從正上方拍的桌面（flat lay），亞麻桌布上攤開一本點陣手帳，鏡頭很慢地轉、推近——
//  - 東西照節拍一樣一樣放上來：照片（斜貼，從上面落下）→ 一條紙膠帶壓住 → 迴紋針夾住角落 → 票根從旁邊滑進來 → 印章「蓋」下去（畫面輕輕一震）。
//  - 字手寫在右頁的點陣上：主字（賓客留言＋署名，或新人的註解），歌詞小一號在下面跟唱；沒有主字時歌詞自己當主字（_photo.ts 的 PhotoText）；
//    兩個都沒有就只有照片（放在兩頁中間、大一點），沒有票根與印章。
//  - 票根上的編號用婚禮的月日（沒定日期用 520）；印章的字是婚禮日期，沒有日期就只蓋一顆愛心。
//  - 照片完整洗成一張相片，很小的舊照片最多放大到原尺寸約 1.5 倍；相片上的畫面慢慢往焦點（新人點的臉）推，鏡頭也往那邊靠一點。
//    相簿的第一張在字的上面多一行小小的相簿名。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, SCALE, type Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { DATE_DOT, DATE_MMDD, drawHeart } from './_motifs';
import { Cam, P3_GLSL, camUniforms, photoGain, p3Noise, loadPic, picSize, picCrop, focusAt, texPerWorld, inkLayer, TextCol, firstBeat, settle, type Pic, CAM_FOCAL } from './_p3';
import { loadWords, settleK } from './_photo';
import type { PhotoRef } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'album', paper: true, energy: [0.15, 1], bars: [2, 8], weight: 1, prefers: ['portrait', 'square', 'small'] };

/** 一頁的寬高、封面多出來的邊。 */
const PGW = 780, PGH = 1040, CVM = 22;
/** 道具圖層（票根、印章、迴紋針）在畫布上的位置：x, y, w, h。 */
const TICKET: [number, number, number, number] = [0, 0, 380, 160];
const STAMP: [number, number, number, number] = [400, 0, 230, 230];
const CLIP: [number, number, number, number] = [650, 0, 56, 160];
const ATLAS = [720, 240];

const BG = () => new FSPass(/* glsl */ `
  ${P3_GLSL}
  uniform sampler2D photo; uniform sampler2D ink; uniform sampler2D props;
  uniform vec4 ph; uniform vec2 phHS; uniform float border; uniform float photoTpw; uniform vec4 crop;
  uniform vec4 tp; uniform vec2 tpHS;     // 紙膠帶
  uniform vec4 tk;                         // 票根：中心 xy、高度、轉角
  uniform vec4 st; uniform float stK;      // 印章：中心 xy、大小倍數、轉角；濃度
  uniform vec4 cl;                         // 迴紋針
  uniform vec4 inkRect; uniform float inkOn;
  const vec3 LD = normalize(vec3(-0.4, 0.5, 1.0));
  const vec2 AT = vec2(${ATLAS[0]}.0, ${ATLAS[1]}.0);

  float light(vec2 p) {
    vec2 q = (p - vec2(-500.0, 420.0)) / vec2(1700.0, 1300.0);
    return 0.7 + 0.32 * exp(-dot(q, q) * 1.4);
  }
  // 道具圖層的一格：q = 道具自己的座標（中心原點、y 往上），r = 在畫布上的範圍
  vec4 prop(vec2 q, vec4 r, float lod) {
    vec2 uv = vec2((q.x + r.z * 0.5 + r.x) / AT.x, 1.0 - (r.y + r.w * 0.5 - q.y) / AT.y);
    if (abs(q.x) > r.z * 0.5 || abs(q.y) > r.w * 0.5) return vec4(0.0);
    return fastLayer(textureLod(props, uv, lod));
  }

  void main() {
    vec2 px = pxPos();
    vec3 ro = camPos, rd = viewDir(px);
    float t0 = hitZ(ro, rd, 0.0);
    vec3 P = ro + rd * t0;
    float depth = t0 * dot(rd, camF), coc = cocAt(depth);
    float wpp = wppAt(t0, rd, vec3(0.0, 0.0, 1.0));
    vec2 p = P.xy;
    vec3 col;
    float cover = sdBox(p, vec2(${PGW + CVM}.0, ${PGH / 2 + CVM}.0));
    float pages = sdBox(p, vec2(${PGW}.0, ${PGH / 2}.0));
    // 亞麻桌布
    vec4 n1 = nz(p, 500.0, wpp, coc);
    float wv = weave(p, 4.8);
    vec3 linen = mix(C_PAPER, C_ASH, 0.42) * (0.9 + 0.08 * (n1.g - 0.5) + 0.05 * (n1.r - 0.5) + 0.03 * wv * smoothstep(1.5, 0.6, wpp));
    // 手帳的影子
    linen *= 1.0 - 0.4 * (1.0 - smoothstep(-20.0, 50.0, sdBox(p + LD.xy / LD.z * 10.0, vec2(${PGW + CVM}.0, ${PGH / 2 + CVM}.0))));
    // 鬆緊帶（封底的，攤開時躺在右邊的桌上）
    float band = 1.0 - smoothstep(7.0, 9.0 + coc, abs(p.x - ${PGW + CVM + 40}.0));
    linen = mix(linen, mix(C_INK2, C_GRAPHITE, 0.4) * (0.85 + 0.3 * (n1.b - 0.5)), band);
    col = linen;
    if (cover < 0.0) {
      // 封面：深咖啡色的皮（固定色 fur 壓暗），一圈縫線
      vec3 lea = mix(C_FUR, C_INK, 0.72) * (0.9 + 0.15 * (n1.a - 0.5));
      float stitch = (1.0 - smoothstep(0.8, 1.6, abs(cover + 9.0))) * step(0.5, fract((p.x + p.y) / 14.0));
      col = mix(lea, mix(C_PAPER, C_FUR, 0.3) * 0.7, stitch * 0.7);
    }
    if (pages < 0.0) {
      vec3 pg = mix(C_PAPER, C_BONE, 0.45) * 0.95 * (0.98 + 0.03 * (n1.r - 0.5));
      // 點陣：每 30 單位一點
      vec2 g = mod(p + 15.0, 30.0) - 15.0;
      float dot1 = 1.0 - smoothstep(1.3, 2.0 + coc * 0.5 + wpp * 0.5, length(g));
      pg = mix(pg, C_SEPIA, dot1 * 0.28 * smoothstep(2.2, 0.8, wpp + coc * 0.2));
      // 書溝：中間暗一點、兩頁微微拱起
      float gx = abs(p.x);
      pg *= 1.0 - 0.32 * exp(-gx / 22.0) - 0.08 * exp(-gx / 160.0);
      pg *= 1.0 - 0.06 * smoothstep(${PGW - 120}.0, ${PGW}.0, gx);
      // 印章（墨印在紙上，斑駁）
      if (stK > 0.0) {
        vec2 sq = rot2(st.w) * (p - st.xy) / st.z;
        vec4 sc = prop(sq, vec4(${STAMP.join('.0, ')}.0), lodFor(${SCALE.toFixed(3)} / st.z, wpp, coc));
        float grit = smoothstep(0.25, 0.6, textureLod(noiseTex, p / 260.0, 0.0).b * 0.6 + textureLod(noiseTex, p / 900.0, 0.0).r * 0.7);
        pg = mix(pg, mix(C_BLOOD, C_SEPIA, 0.25) * 0.85, sc.a * stK * (0.55 + 0.4 * grit));
      }
      // 字
      if (inkOn > 0.5) {
        vec2 iuv = vec2((p.x - inkRect.x) / inkRect.z, (p.y - inkRect.y) / inkRect.w);
        vec4 ic = inkAt(ink, iuv, lodFor(${SCALE.toFixed(3)}, wpp, coc));
        pg = pg * (1.0 - ic.a) + ic.rgb;
      }
      col = pg;
      // 書籤緞帶：從書溝上緣垂下來，在右頁上彎一下
      float rx = 30.0 + 12.0 * sin(p.y * 0.007 + 1.3) + 0.03 * (${PGH / 2}.0 - p.y);
      float rb = abs(p.x - rx);
      float rEnd = -300.0 - 12.0 * (1.0 - rb / 9.0);
      float rib = (1.0 - smoothstep(8.5, 10.0 + coc, rb)) * step(rEnd, p.y);
      vec3 rc = mix(C_BLOOD, C_SEPIA, 0.3) * (0.8 + 0.3 * smoothstep(9.0, 0.0, rb) * (0.6 + 0.4 * sin(p.y * 0.05)));
      col = mix(col, rc, rib);
    }
    // 東西的影子（票根、相片、膠帶、迴紋針）
    float sh = 0.0;
    sh = max(sh, 0.22 * liftShadow(p, tk.xy, vec2(${TICKET[2] / 2}.0, ${TICKET[3] / 2}.0), tk.w, tk.z, LD));
    sh = max(sh, (0.3 - 0.1 * smoothstep(20.0, 300.0, ph.z)) * liftShadow(p, ph.xy, phHS + border, ph.w, ph.z, LD));
    sh = max(sh, 0.12 * liftShadow(p, tp.xy, tpHS, tp.w, tp.z, LD));
    col *= (1.0 - sh) * light(p);
    // 票根
    if (tk.z < 5000.0) {
      float tt; vec2 q = flatAt(ro, rd, tk.xy, tk.z, tk.w, tt);
      if (tt > 0.0) {
        vec4 c = prop(q, vec4(${TICKET.join('.0, ')}.0), lodFor(${SCALE.toFixed(3)}, wpp, coc));
        col = mix(col, c.rgb / max(c.a, 1e-4) * light((ro + rd * tt).xy), c.a);
      }
    }
    // 相片（白邊）
    {
      float tt; vec2 q = flatAt(ro, rd, ph.xy, ph.z, ph.w, tt);
      float wph = wppAt(tt, rd, vec3(0.0, 0.0, 1.0)), cph = cocAt(tt * dot(rd, camF));
      float d = sdBox(q, phHS + border);
      float a = (1.0 - smoothstep(-0.7 - cph * 0.5, 0.7 + cph * 0.5, d)) * step(0.0, tt);
      if (a > 0.0) {
        vec3 pr = mix(C_BONE, C_PAPER, 0.2) * 0.92;
        float di = sdBox(q, phHS);
        if (di < 1.0) {
          vec2 uv = vec2(q.x + phHS.x, phHS.y - q.y) / (2.0 * phHS);
          pr = mix(pr, photoAt(photo, cropUv(uv, crop), lodFor(photoTpw, wph, cph)), 1.0 - smoothstep(-0.6, 0.6, di));
        }
        col = mix(col, pr * light((ro + rd * tt).xy), a);
      }
    }
    // 紙膠帶
    if (tp.z < 5000.0) {
      float tt; vec2 q = flatAt(ro, rd, tp.xy, tp.z, tp.w, tt);
      vec2 c = tape(q, tpHS, 5.0);
      if (tt > 0.0 && c.x > 0.0) {
        // 格子花紋的膠帶
        vec2 gq = mod(q, 16.0) - 8.0;
        float chk = 0.5 + 0.5 * sign(gq.x * gq.y);
        vec3 tc = mix(mix(C_GINGHAM, C_PAPER, 0.35), mix(C_PAPER, C_BONE, 0.6), chk * 0.7);
        col = mix(col, tc * light((ro + rd * tt).xy), c.x * 0.82);
      }
    }
    // 迴紋針
    if (cl.z < 5000.0) {
      float tt; vec2 q = flatAt(ro, rd, cl.xy, cl.z, cl.w, tt);
      if (tt > 0.0) {
        vec4 c = prop(q, vec4(${CLIP.join('.0, ')}.0), lodFor(${SCALE.toFixed(3)}, wpp, coc));
        col = col * (1.0 - c.a) + c.rgb;
      }
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...camUniforms(),
  photo: { value: null }, ink: { value: null }, props: { value: null },
  ph: { value: new THREE.Vector4() }, phHS: { value: new THREE.Vector2(300, 200) }, border: { value: 18 }, photoTpw: { value: 1 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  tp: { value: new THREE.Vector4(0, 0, 9999, 0) }, tpHS: { value: new THREE.Vector2(110, 24) },
  tk: { value: new THREE.Vector4(0, 0, 9999, 0) }, st: { value: new THREE.Vector4(0, 0, 1, 0) }, stK: { value: 0 },
  cl: { value: new THREE.Vector4(0, 0, 9999, 0) },
  inkRect: { value: new THREE.Vector4() }, inkOn: { value: 0 },
});

export default class Journal extends Scene {
  bg = shared('journal.bg', BG);
  photo: PhotoRef = this.ctx.params.photo;
  seed = Number(this.ctx.params.seed ?? 1);
  cam = new Cam();
  pic: Pic | null = null;
  noise: THREE.Texture | null = null;
  ink: Layer2D | null = null;
  props = this.track(inkLayer(ATLAS[0], ATLAS[1]));
  col: TextCol | null = null;
  hasText = false;
  pc: [number, number] = [0, 0];
  hs: [number, number] = [300, 200];
  border = 18;
  ang = 0;
  ir: [number, number, number, number] = [0, 0, 0, 0];
  /** 各樣東西的落點與時間。 */
  tkPos: [number, number, number] = [0, 0, 0];
  stPos: [number, number, number] = [0, 0, 0];
  tPhoto = 0; tTape = 0; tClip = 0; tTicket = 0; tStamp = 0;

  override async init() {
    const { renderer, start, end, audio } = this.ctx;
    const ph = this.photo;
    if (!ph) throw new Error('照片版面要有 params.photo');
    const no = `No.${DATE_MMDD || '520'}`;
    const stampText = DATE_DOT;
    await loadText(`${ph.caption}${ph.album}ADMIT ONE${no}${stampText}♥·`);
    await loadWords(this.ctx);
    this.pic = await loadPic(renderer, ph);
    this.track(this.pic.tex);
    this.noise = p3Noise(renderer);
    const { img } = this.pic;
    const rs = 0.84;
    // 右頁的欄：x 80～720（頁緣 780），上緣在印章下面，下緣不進右下角 HUD 區（世界 y ≥ -340）
    const colW = 640, colH = 590, pad = 24;
    this.ink = this.track(inkLayer(colW + 2 * pad, colH + 2 * pad));
    this.col = new TextCol(this.ink, colW, colH, {
      family: F.hand(400), ink: mixRgba('ink', 'sepia', 0.5, 0.92), active: mixRgba('blood', 'ink', 0.2), unsung: mixRgba('ink', 'sepia', 0.5, 0.28),
      sigInk: mixRgba('ink', 'sepia', 0.5, 0.72), rs, lineHeight: 1.42, maxLines: 5,
      label: { family: F.mono(500), size: 22, color: rgba('sepia', 0.6), tracking: 5, gap: 22 },
    }, ph, this.ctx, pad);
    this.hasText = this.col.has;
    const r = (k: number) => hash(this.seed, k);
    if (this.hasText) {
      // 照片在左頁（斜貼），字在右頁
      const [w, h] = picSize(img, PGW - 150, PGH - 330, rs);
      this.hs = [w / 2, h / 2];
      this.border = clamp(0.04 * Math.min(w, h), 12, 22);
      this.pc = [-PGW / 2 + 6, 70 - (PGH - 330 - h) * 0.2];
      this.ang = (3 + 3 * r(1)) * (Math.PI / 180) * (r(2) < 0.5 ? -1 : 1);
      const textH = this.col.contentH;
      // 欄的上緣不超過印章的下緣（長的字往下長）
      const colLeft = 80, colTop = clamp(120 + textH / 2, 120, PGH / 2 - 270);
      this.ir = [colLeft - pad, colTop - colH - pad, colW + 2 * pad, colH + 2 * pad];
      // 票根：左頁下面、照片的下方偏右；印章：右頁右上角
      this.tkPos = [-PGW / 2 + 170, -PGH / 2 + 150, (-6 + 10 * r(3)) * (Math.PI / 180)];
      this.stPos = [PGW - 190, PGH / 2 - 170, (-20 + 30 * r(4)) * (Math.PI / 180)];
    } else {
      // 只有照片：放在兩頁中間，大一點
      const [w, h] = picSize(img, 1260, PGH - 140, rs);
      this.hs = [w / 2, h / 2];
      this.border = clamp(0.035 * Math.min(w, h), 12, 24);
      this.pc = [0, 10];
      this.ang = (1.5 + 2 * r(1)) * (Math.PI / 180) * (r(2) < 0.5 ? -1 : 1);
    }
    // 節拍：照片 → 膠帶 → 迴紋針 → 票根 → 印章（短窗格擠一點，一定在結束前放完）
    const beat = clamp(audio.beatPeriod(start + 0.1), 0.3, 0.7);
    this.tPhoto = clamp(firstBeat(audio, start, 0.55), start + 0.35, start + 0.7);
    const budget = Math.max(0.6, end - 0.6 - this.tPhoto);
    const stepT = Math.min(beat, budget / 4);
    this.tTape = this.tPhoto + stepT;
    this.tClip = this.tTape + stepT;
    this.tTicket = this.tClip + stepT;
    this.tStamp = this.tTicket + stepT;
    if (this.col.fit) {
      this.col.writeFrom = this.tTape;
      this.col.writeTo = this.col.writeFrom + Math.min(2.0, 0.07 * this.col.chars + 0.3);
    }
    this.drawProps(no, stampText);
  }

  /** 票根、印章、迴紋針畫在一張道具圖層上（畫一次）。 */
  private drawProps(no: string, stampText: string) {
    const L = this.props, c = L.ctx;
    L.clear();
    // 票根：奶油色的紙、右邊一排撕線的齒孔、印刷的字
    {
      const [x, y, w, h] = TICKET;
      c.save();
      c.beginPath();
      c.rect(x + 4, y + 4, w - 8, h - 8);
      // 左右兩邊的半圓缺口
      c.fillStyle = mixRgba('paper', 'signal', 0.18);
      c.fill();
      c.globalCompositeOperation = 'destination-out';
      for (const sx of [x + 4, x + w - 4]) { c.beginPath(); c.arc(sx, y + h / 2, 14, 0, Math.PI * 2); c.fill(); }
      for (let yy = y + 14; yy < y + h - 8; yy += 12) { c.beginPath(); c.arc(x + w - 86, yy, 2.4, 0, Math.PI * 2); c.fill(); }
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = rgba('sepia', 0.45); c.lineWidth = 1.5;
      c.strokeRect(x + 22, y + 18, w - 128, h - 36);
      c.fillStyle = rgba('sepia', 0.78);
      c.font = font(F.mono(600), 22); c.letterSpacing = '6px';
      c.fillText('ADMIT ONE', x + 38, y + 66);
      c.font = font(F.mono(400), 18); c.letterSpacing = '3px';
      c.fillStyle = rgba('sepia', 0.6);
      c.fillText(no, x + 38, y + 104);
      drawHeart(c, x + w - 44, y + h / 2, 26, rgba('rose', 0.85));
      c.letterSpacing = '0px';
      c.restore();
    }
    // 印章：兩圈圓＋日期（沒日期只有愛心），墨色在 shader 裡上
    {
      const [x, y, w, h] = STAMP;
      const cx = x + w / 2, cy = y + h / 2;
      c.save();
      c.strokeStyle = '#fff'; c.fillStyle = '#fff';
      c.lineWidth = 6; c.beginPath(); c.arc(cx, cy, 104, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 2.5; c.beginPath(); c.arc(cx, cy, 88, 0, Math.PI * 2); c.stroke();
      if (stampText) {
        c.font = font(F.mono(600), 26); c.textAlign = 'center'; c.letterSpacing = '2px';
        c.fillText(stampText, cx, cy + 9);
        c.fillRect(cx - 60, cy - 30, 120, 3); c.fillRect(cx - 60, cy + 26, 120, 3);
        drawHeart(c, cx, cy - 54, 22, '#fff');
        drawHeart(c, cx, cy + 58, 22, '#fff');
      } else drawHeart(c, cx, cy + 4, 84, '#fff');
      c.restore();
    }
    // 迴紋針：兩圈長長的鐵絲（灰、有一點亮邊）
    {
      const [x, y, w, h] = CLIP;
      const cx = x + w / 2;
      const loop = (hw: number, top: number, bot: number) => {
        c.beginPath();
        c.moveTo(cx - hw, bot); c.lineTo(cx - hw, top + hw); c.arc(cx, top + hw, hw, Math.PI, 0); c.lineTo(cx + hw, bot - hw * 0.4);
      };
      c.save();
      c.lineCap = 'round';
      c.strokeStyle = mixRgba('ash', 'ink', 0.25); c.lineWidth = 5;
      loop(20, y + 8, y + h - 20); c.stroke();
      loop(12, y + 30, y + h - 8); c.stroke();
      c.strokeStyle = rgba('bone', 0.7); c.lineWidth = 1.4;
      loop(20, y + 8, y + h - 20); c.stroke();
      c.restore();
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    const r = (k: number) => hash(this.seed, k);
    // 相片上的畫面往焦點推；鏡頭也往焦點靠一點（有字時少靠，字才一直在畫面裡）
    const crop = picCrop(this.pic!, settleK(lt, 6), { zoom: 1.12, screenW: this.hs[0] * 2 * 0.84 });
    const [fx, fy] = focusAt(this.pic!, crop, this.pc, this.hs, this.ang);
    const lean = (this.hasText ? 0.14 : 0.4) * settle(lt, 6);
    // 鏡頭：正上方，很慢地轉、推近；印章蓋下去時輕輕一震
    const dir = r(7) < 0.5 ? 1 : -1;
    const bump = this.hasText ? 0.006 * Math.exp(-Math.max(0, t - this.tStamp) * 9) * (t >= this.tStamp ? 1 : 0) : 0;
    const push = (1.08 - 0.08 * ease.outCubic(prog(t, s, s + 1.4))) * (1 - 0.045 * settle(lt, 7)) * (1 - bump);
    const aimX = this.hasText ? 0 : this.pc[0];
    this.cam.orbit([aimX + 10 * dir * settle(lt, 8) + lean * (fx - this.pc[0]), lean * (fy - this.pc[1]), 0], (CAM_FOCAL / 0.84) * push, 89.9, 0, 30, dir * (-5 + 3.5 * settle(lt, 6)));
    this.cam.apply(u);
    u.photoGain!.value = photoGain(this.photo.lum);
    // 照片落下（越來越快）
    const pd = prog(t, s, this.tPhoto, ease.inQuad);
    (u.ph!.value as THREE.Vector4).set(this.pc[0] - 30 * (1 - pd), this.pc[1] + 50 * (1 - pd), lerp(360, 2, pd), this.ang - 0.1 * (1 - pd));
    (u.phHS!.value as THREE.Vector2).set(...this.hs);
    u.border!.value = this.border;
    u.photo!.value = this.pic!.tex;
    (u.crop!.value as THREE.Vector4).set(...crop);
    u.photoTpw!.value = texPerWorld(this.pic!.img, this.hs[0] * 2, crop);
    // 膠帶：壓在照片上緣中間
    const c = Math.cos(this.ang), si = Math.sin(this.ang);
    const topY = this.hs[1] + this.border - 4;
    const tz = t < this.tTape - 0.2 ? 9999 : lerp(80, 3, prog(t, this.tTape - 0.2, this.tTape, ease.inQuad));
    (u.tp!.value as THREE.Vector4).set(this.pc[0] - topY * si, this.pc[1] + topY * c, tz, this.ang + (2 + 4 * r(9)) * (Math.PI / 180));
    (u.tpHS!.value as THREE.Vector2).set(clamp(this.hs[0] * 0.3, 70, 120), 22);
    // 迴紋針：夾在照片右上角
    const cx = this.hs[0] + this.border - 26, cy = this.hs[1] + this.border - 40;
    const clz = t < this.tClip - 0.15 ? 9999 : lerp(60, 4, prog(t, this.tClip - 0.15, this.tClip, ease.inQuad));
    (u.cl!.value as THREE.Vector4).set(this.pc[0] + cx * c - cy * si, this.pc[1] + cx * si + cy * c, this.hasText ? clz : 9999, this.ang);
    // 票根：從右邊滑進來
    if (this.hasText) {
      const k = prog(t, this.tTicket - 0.3, this.tTicket, ease.outCubic);
      (u.tk!.value as THREE.Vector4).set(this.tkPos[0] + 700 * (1 - k), this.tkPos[1] - 40 * (1 - k), t < this.tTicket - 0.3 ? 9999 : 1 + 6 * (1 - k), this.tkPos[2] + 0.3 * (1 - k));
      const sk = prog(t, this.tStamp - 0.04, this.tStamp + 0.06);
      (u.st!.value as THREE.Vector4).set(this.stPos[0], this.stPos[1], 1.06 - 0.06 * sk, this.stPos[2]);
      u.stK!.value = sk * (1 - 0.1 * prog(t, this.tStamp + 0.1, this.tStamp + 1.5));
    } else { (u.tk!.value as THREE.Vector4).set(0, 0, 9999, 0); u.stK!.value = 0; }
    u.props!.value = this.props.texture;
    u.noiseTex!.value = this.noise;
    u.inkOn!.value = this.col!.draw(t) ? 1 : 0;
    u.ink!.value = this.ink!.texture;
    (u.inkRect!.value as THREE.Vector4).set(...this.ir);
    u.focusD!.value = this.cam.depth([0, 0, 0]);
    u.aper!.value = 6;
    u.k!.value = (0.9 + 0.1 * ease.outCubic(prog(t, s, s + 0.4))) * (1 - 0.1 * prog(t, e - 0.3, e));
    this.bg.render(renderer, out);
    return { paper: 1, bloom: 0.1, bloomThreshold: 1.15, halation: 0.04, vignette: 0.36 };
  }
}
