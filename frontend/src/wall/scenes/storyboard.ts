// 照片版面「分鏡」（亮，四張）：桌上一張印好的分鏡腳本紙（2×2 四格），照片一格一格貼進去，最後鏡頭推進主角那一格——
//  - 紙上印著淡灰的格框、每格上面「SHOT 01」的小標、下面「ACTION」與幾條寫備註的橫線；
//    格子之間有鉛筆畫的接續箭頭、圈起來的格號（照順序在照片貼上時出現）。
//  - 照片在拍點貼進格子（從一點點高的地方落下、影子收緊）；照片完整放在 16:9 的格子裡（不裁），沒填滿的地方是鉛筆的斜線陰影。
//  - 開頭鏡頭在高處看整張紙（紙有一點斜），四格貼完後推進最後一格＝主角，主角佔滿大半個畫面，格子裡的畫面再往新人點的焦點慢慢推；
//    主字（賓客留言＋署名，或新人的註解）用鉛筆手寫在主角下面的備註線上（線跟字的行距對齊），一個字一個字寫出來，
//    下面小一號跟唱這段的歌詞；沒有主字時歌詞寫在那裡跟唱。
//  - 紙旁邊躺著一支削好的鉛筆。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { Layer2D } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, lerp, mulberry32, prog } from '../engine/util';
import { Cam, Caption, GLSL_INK, S, beatTimes, card, cardsPass, contain, hasWords, lay, loadSlots, mipLayer, photoRefs, pushCrop, setCards, setPhoto, setSlots, settleK, type Card, type Slot } from './_p10';

// prefers（導演先挑適合接下來照片的版面）：16:9 的分鏡格：橫的照片填滿格子。其他照片也撐得住。
// thumbAt：後台縮圖拍四格都貼好、鏡頭還在遠景的那一刻（收尾的畫面只剩主角，看不出是好幾張）。
export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'multi', photos: 4, paper: true, energy: [0, 1], bars: [3, 8], weight: 1, prefers: ['landscape'], thumbAt: 0.158 };

const FOV = 30;
/** 主角那一格最後在畫面上的位置（基準鏡頭）：世界座標就照這個排。 */
// （GLSL 裡直接寫成數字，都要是整數、一半也是整數）
// 格子 960×540、偏左：下面的備註區（主字三行＋署名＋一行歌詞，約 310 px）才放得下，字也停在 HUD 區（x ≥ 1360）左邊
const PX = 360, PY = 96, PW = 960, PH = 540;
/** 格與格的間距、每格下面備註區的高（推近之後備註區的字要在紙上，紙的下緣在畫面外）。 */
const GX = 130, NOTES = 340;
/** 整張紙（世界座標，畫面像素 y 向下）：2×2 四格，主角在右下；右邊多留一點空白的紙（推近之後畫面右邊不會只剩桌面）。 */
const SX0 = PX - PW - GX - 110, SY0 = PY - PH - NOTES - 150, SX1 = PX + PW + 300, SY1 = PY + PH + NOTES + 30;
/** 紙上印的字與鉛筆線畫在一張字層上（整張紙，0.75 倍解析度：小字、線，推近時也夠清楚；不跟著輸出倍率放大，4K 時這張就太大了）。 */
const SHEET_SCALE = 0.75;

const PRE = /* glsl */ `
  // （只留一個出口：中途 return 會讓 ANGLE／D3D 出 X4000 警告，編出來的結果可能不一樣）
  vec3 matColor(int i, vec2 q, vec2 hb, float pxw) {
    vec3 c = C_BONE * 0.9;
    if (cPh[i].w > 3.5) {
      // 鉛筆：原木的筆桿（三道稜線的明暗），一端削尖、露出筆芯
      float u = (q.x + hb.x) / (2.0 * hb.x);
      float f = q.y / hb.y;
      vec3 body = C_FUR * (0.72 + 0.18 * step(-0.33, f) - 0.16 * step(0.33, f));
      vec3 wood = mix(C_FUR, C_BONE, 0.55) * (0.85 + 0.1 * f);
      c = mix(body, wood, smoothstep(0.9, 0.905, u));
      c = mix(c, C_GRAPHITE * 0.45, smoothstep(0.975, 0.98, u));
    }
    return c;
  }
  vec3 backColor(int i, vec2 q, vec2 hb) { return C_BONE * 0.85; }
  vec3 shade(int i, vec3 base, vec3 hp, vec3 n, vec3 rd, float isPh, vec2 q, bool refl) {
    float sh = shadowAt(hp, i);
    vec3 c = base * (0.95 - 0.08 * smoothstep(400.0, 2200.0, length(hp.xy - vec2(-300.0, 500.0)))) * mix(1.0, 0.82, 1.0 - sh);
    return c;
  }
`;

const POST = /* glsl */ `
  uniform sampler2D sheetTx; uniform sampler2D txt;
  uniform vec4 sheet;   // 紙的左上角（世界 x、畫面 y）與寬高
  uniform vec4 txtRect; // 註解字層的左上角（世界 x、畫面 y）與寬高
  uniform vec4 reveal;  // 每一格的鉛筆線出現到哪裡（0..1）
  uniform vec4 phR[4];  // 每一格照片的範圍（中心 x、畫面 y、半寬、半高），斜線陰影避開它
  uniform vec3 notes;   // 備註線：第一條離格子下緣多遠、行距、幾條
  ${GLSL_INK}
  vec2 panelC(int k) { return vec2(${PX + PW / 2}.0 - float(1 - k % 2) * ${PW + GX}.0, ${PY + PH / 2}.0 - float(1 - k / 2) * ${PH + NOTES}.0); }
  vec3 background(vec3 ro, vec3 rd, vec2 p) {
    float t = -ro.z / rd.z;
    vec3 hp = ro + rd * t;
    // 畫面座標（y 向下），跟排版用的一樣
    vec2 w = vec2(hp.x + ${1920 / 2}.0, ${1080 / 2}.0 - hp.y);
    float pxw = t / (focal * PX_SCALE);
    float aa = max(pxw, 0.6);
    // 桌面：淺灰的工作檯，很淡的斑點
    vec3 col = mix(C_ASH, C_PAPER, 0.35) * (0.6 + 0.04 * fbm(w / 300.0, 3));
    vec2 sc = sheet.xy + sheet.zw * 0.5;
    float ds = sdBox(w - sc, sheet.zw * 0.5);
    // 紙的影子（右下）
    col *= 1.0 - 0.3 * exp(-max(sdBox(w - sc - vec2(10.0, 14.0), sheet.zw * 0.5), 0.0) / 18.0);
    if (ds < aa) {
      float fib = snoise(w / vec2(3.0, 40.0)) * 0.5 + 0.5;
      vec3 pap = mix(C_BONE, C_PAPER, 0.3) * (0.9 + 0.015 * fib);
      vec3 grey = mix(pap, C_GRAPHITE, 0.55);
      float ink = 0.0, pencil = 0.0;
      for (int k = 0; k < 4; k++) {
        vec2 c = panelC(k);
        vec2 d = w - c;
        // 印好的格框（淡灰細線）
        ink = max(ink, 1.0 - smoothstep(0.9 - aa, 0.9 + aa, abs(sdBox(d, vec2(${PW / 2}.0, ${PH / 2}.0)))));
        // 格子下面的備註線（ACTION 右邊）
        float by = c.y + ${PH / 2}.0;
        float ny = w.y - by - notes.x;
        if (ny > -notes.y * 0.5 && ny < notes.y * (notes.z - 0.5) && d.x > -${PW / 2 - 150}.0 && d.x < ${PW / 2}.0) {
          float m = abs(mod(ny + notes.y * 0.5, notes.y) - notes.y * 0.5);
          ink = max(ink, (1.0 - smoothstep(0.6 - aa, 0.6 + aa, m)) * 0.55);
        }
        // 格子裡沒有照片的地方：鉛筆斜線（貼上時才畫）
        if (abs(d.x) < ${PW / 2}.0 - 6.0 && abs(d.y) < ${PH / 2}.0 - 6.0) {
          vec4 r = phR[k];
          float out_ = step(r.z + 4.0, abs(w.x - r.x)) + step(r.w + 4.0, abs(w.y - r.y));
          float hs = abs(mod(w.x + w.y, 14.0) - 7.0);
          float hatch = (1.0 - smoothstep(0.7, 1.6, hs)) * (0.6 + 0.4 * snoise(w / vec2(40.0, 9.0)));
          float wipe = step((d.x + ${PW / 2}.0) / ${PW}.0, reveal[k]);
          pencil = max(pencil, hatch * min(out_, 1.0) * wipe * 0.35);
        }
      }
      pap = mix(pap, grey, ink * 0.75);
      pap = mix(pap, C_GRAPHITE * 0.7, pencil);
      // 紙上印的字、鉛筆的箭頭與格號（字層，左上角在 sheet.xy）
      vec2 sq = w - sheet.xy;
      vec4 st = inkAt(sheetTx, sq - sheet.zw * 0.5, sheet.zw * 0.5, sheet.zw, log2(pxw * ${SHEET_SCALE}));
      pap = pap * (1.0 - st.a) + st.rgb;
      // 註解（鉛筆手寫）
      vec2 tq = w - txtRect.xy;
      if (tq.x > 0.0 && tq.y > 0.0 && tq.x < txtRect.z && tq.y < txtRect.w) {
        vec4 tx = inkAt(txt, tq - txtRect.zw * 0.5, txtRect.zw * 0.5, txtRect.zw, log2(pxw * 1.5 * PX_SCALE));
        pap = pap * (1.0 - tx.a) + tx.rgb;
      }
      col = mix(col, pap, 1.0 - smoothstep(-aa, aa, ds));
    }
    col *= mix(1.0, 0.8, 1.0 - shadowAt(hp, -1));
    return col;
  }
  vec3 finish(vec3 col, vec2 p, vec3 rd) { return col; }
`;

const PASS = () => cardsPass(PRE, POST, {
  sheetTx: { value: null }, txt: { value: null }, sheet: { value: new THREE.Vector4() }, txtRect: { value: new THREE.Vector4() },
  reveal: { value: new THREE.Vector4() }, phR: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, notes: { value: new THREE.Vector3(60, 60, 4) },
});

/** 第 k 格（0..3，主角是 3）的中心（畫面像素）。 */
const panelC = (k: number) => [PX + PW / 2 - (1 - (k % 2)) * (PW + GX), PY + PH / 2 - (1 - Math.floor(k / 2)) * (PH + NOTES)] as const;

export default class Storyboard extends Scene {
  pass = shared('storyboard.pass', PASS);
  seed = Number(this.ctx.params.seed ?? 1);
  slots: Slot[] = [];
  cap: Caption | null = null;
  sheetL = this.track(mipLayer(new Layer2D(SX1 - SX0, SY1 - SY0, SHEET_SCALE, { fast: true })));
  cam = new Cam(FOV);
  cards: Card[] = Array.from({ length: 5 }, () => card());
  /** 每一格的照片：格子編號、照片半寬高、角度、貼上的時間。主角在第 3 格。 */
  fills: { panel: number; slot: number; pw: number; ph: number; a: number; t: number }[] = [];
  tPush = 0;
  pushDur = 1.1;
  capAt = { x: 0, y: 0 };
  notes = { y0: 60, dy: 60, n: 4 };

  override async init() {
    const { start, end, audio } = this.ctx;
    const refs = photoRefs(this.ctx.params, 4);
    this.slots = await loadSlots(this.ctx, refs, (x) => this.track(x));
    const rnd = mulberry32(this.seed * 23 + 3);
    const main = refs[0]!;
    const dur = end - start;
    // 貼照片：配角三格、主角，一拍一格；短的窗格快一點
    const span = Math.min(3.6, Math.max(1.0, dur * 0.34));
    // 第一格一切進來就貼上（不要一開始是空白的紙），其他三格落在拍點
    const times = [start + 0.15, ...beatTimes(audio, start + 0.4, 3, span)];
    this.pushDur = dur < 5 ? 0.7 : 1.1;
    this.tPush = times[3]! + 0.25;
    for (let k = 0; k < 4; k++) {
      const slot = k === 3 ? 0 : k + 1;
      const [pw, ph] = contain(this.slots[slot]!, PW - 24, PH - 24);
      this.fills.push({ panel: k, slot, pw, ph, a: (rnd() * 2 - 1) * 0.012, t: times[k]! });
    }
    if (hasWords(this.ctx)) {
      // 備註區（主角那一格下面，ACTION 右邊）：主字（留言＋署名或註解）最多三行寫在橫線上，下面小一號跟唱這段的歌詞。
      // 推近之後這一區在畫面的 y 662～975（離下緣 96 px 以上）、x 510～1320（HUD 區左邊）
      const x = PX + 150;
      this.cap = new Caption(this.ctx, main, {
        family: F.hand(400), w: Math.min(PW - 150, 1330 - x), h: 300, min: 40, max: 48, lineHeight: 1.36, maxLines: 3, pad: 16, scale: 1.5,
        color: rgba('graphite', 0.95), active: rgba('signal'), unsung: rgba('graphite', 0.35), sigColor: rgba('graphite', 0.75), write: 0.06,
      }, (x) => this.track(x));
      await this.cap.init();
      mipLayer(this.cap.L);
      this.capAt = { x: x - this.cap.pad, y: PY + PH + 26 - this.cap.pad };
      // 橫線跟主字的行距對齊、只畫主字那幾行（署名、小一號的歌詞寫在下面的空白）；歌詞自己當主字時照 48 px 的行距畫四條
      const fit = this.cap.fit;
      const size = fit ? fit.size : 48;
      this.notes = { y0: 26 + this.cap.top - this.cap.pad + size, dy: fit ? fit.lineHeight : 48 * 1.36, n: fit ? fit.lines.length : 4 };
      this.cap.writeFrom(this.tPush + this.pushDur * 0.7, 2.2);
    } else this.notes = { y0: 70, dy: 64, n: 4 };
    await this.drawSheet(main.album);
  }

  /** 紙上印的小字與鉛筆畫的格號、箭頭（畫一次）。 */
  private async drawSheet(album: string) {
    const L = this.sheetL, c = L.ctx;
    const labels = ['STORYBOARD', 'SHOT 01', 'SHOT 02', 'SHOT 03', 'SHOT 04', 'ACTION', 'SC. 01', 'P. 1 / 1', 'KEY', '1234'];
    await loadText(labels.join('') + album);
    L.clear();
    const ox = SX0, oy = SY0;
    c.fillStyle = rgba('graphite', 0.85);
    c.font = font(F.mono(500), 30);
    c.letterSpacing = '10px';
    c.fillText('STORYBOARD', PX - PW - GX - ox, PY - PH - NOTES - 70 - oy);
    c.letterSpacing = '4px';
    c.font = font(F.mono(400), 20);
    c.fillStyle = rgba('graphite', 0.7);
    c.fillText('P. 1 / 1', PX + PW - 120 - ox, PY - PH - NOTES - 70 - oy);
    if (album) {
      c.font = font(F.hei(500), 24);
      let s = album;
      while (s.length > 1 && c.measureText(s).width > 600) s = s.slice(0, -1);
      c.fillText(s === album ? s : `${s}…`, PX - PW - GX + 330 - ox, PY - PH - NOTES - 72 - oy);
    }
    for (let k = 0; k < 4; k++) {
      const [cx, cy] = panelC(k);
      const x0 = cx - PW / 2 - ox, y0 = cy - PH / 2 - oy;
      c.font = font(F.mono(500), 20);
      c.fillStyle = rgba('graphite', 0.8);
      c.letterSpacing = '4px';
      c.fillText(`SHOT 0${k + 1}`, x0, y0 - 16);
      c.fillText('SC. 01', x0 + PW - 96, y0 - 16);
      c.font = font(F.mono(500), 16);
      c.fillText('ACTION', x0, y0 + PH + 26 + 30);
      c.letterSpacing = '0px';
      // 鉛筆：圈起來的格號（格子左上外面）
      const rnd = mulberry32(k * 97 + 5);
      c.strokeStyle = rgba('graphite', 0.75);
      c.fillStyle = rgba('graphite', 0.8);
      c.lineWidth = 2.4;
      c.lineCap = 'round';
      const nx = x0 - 52, ny = y0 + 34;
      c.beginPath();
      for (let a = 0; a <= Math.PI * 2.15; a += 0.2) {
        const r = 24 + 2.5 * Math.sin(a * 3 + rnd() * 0.5);
        const px = nx + Math.cos(a - 0.6) * r, py = ny + Math.sin(a - 0.6) * r * 0.92;
        if (a === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
      c.font = font(F.hand(700), 30);
      c.textAlign = 'center';
      c.fillText(`${k + 1}`, nx, ny + 11);
      c.textAlign = 'left';
      // 接續箭頭：1 → 2（格子之間的空隙）、2 ↙ 3（換行）、3 → 4
      if (k === 0 || k === 2) {
        const ax = x0 + PW + 22, ay = y0 + PH / 2 + (rnd() * 2 - 1) * 20;
        c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo(ax + GX / 2 - 22, ay - 16, ax + GX - 44, ay + 2); c.stroke();
        c.beginPath(); c.moveTo(ax + GX - 58, ay - 10); c.lineTo(ax + GX - 44, ay + 2); c.lineTo(ax + GX - 60, ay + 12); c.stroke();
      }
      if (k === 1) {
        const ax = x0 + 80, ay = y0 + PH + NOTES - 70;
        c.beginPath(); c.moveTo(ax, ay); c.bezierCurveTo(ax - 200, ay + 40, ax - PW - GX + 400, ay + 10, ax - PW - GX + 220, ay + 64); c.stroke();
        const ex = ax - PW - GX + 220, ey = ay + 64;
        c.beginPath(); c.moveTo(ex + 6, ey - 18); c.lineTo(ex, ey); c.lineTo(ex + 20, ey + 4); c.stroke();
      }
      if (k === 3) {
        // 主角那一格：鉛筆寫「KEY」，底下畫兩條線
        c.font = font(F.hand(700), 30);
        c.fillText('KEY', x0 + PW + 18, y0 + 30);
        c.beginPath(); c.moveTo(x0 + PW + 16, y0 + 40); c.lineTo(x0 + PW + 80, y0 + 38); c.moveTo(x0 + PW + 18, y0 + 47); c.lineTo(x0 + PW + 74, y0 + 46); c.stroke();
      }
    }
    L.upload();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const cam = this.cam;
    const D = cam.D;
    // 鏡頭：一開始在高處斜看整張紙，四格貼完後推進主角那一格（最後剛好是排版的樣子），之後很慢地再推一點點
    const push = ease.inOutCubic(prog(t, this.tPush, this.tPush + this.pushDur));
    const hold = 1 - Math.exp(-Math.max(0, t - this.tPush - this.pushDur) / 6);
    const wide = S((SX0 + SX1) / 2, (SY0 + SY1) / 2 - 20);
    const drift = ease.inOutQuad(clamp((t - s) / 6));
    const tgt = new THREE.Vector3().lerpVectors(wide, new THREE.Vector3(0, 0, 0), push);
    tgt.x += lerp(-40 + 80 * drift, 0, push);
    const dist = D * (lerp(2.55 - 0.12 * drift, 1, push) - 0.025 * hold);
    const pitch = lerp(0.16, 0, push), roll = lerp(-0.045, 0, push);
    cam.rest(FOV);
    cam.pos.set(tgt.x, tgt.y - Math.sin(pitch) * dist, Math.cos(pitch) * dist);
    cam.target.copy(tgt);
    cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    cam.update();

    const list: Card[] = [];
    const u = this.pass.u;
    const phR = u.phR!.value as THREE.Vector4[];
    const reveal = u.reveal!.value as THREE.Vector4;
    this.fills.forEach((fl, i) => {
      const cd = this.cards[i]!;
      const [cx, cy] = panelC(fl.panel);
      const pop = ease.outCubic(prog(t, fl.t - 0.05, fl.t + 0.3));
      lay(cd, S(cx, cy, 0.5 + 60 * (1 - pop)), fl.a + 0.05 * (1 - pop));
      cd.hw = fl.pw; cd.hh = fl.ph;
      // 鏡頭推進主角那一格之後，格子裡的畫面往焦點慢慢推（印好的照片：1.2 倍）
      const sl = this.slots[fl.slot]!;
      setPhoto(cd, sl, fl.slot, fl.pw, fl.ph, fl.slot === 0 ? pushCrop(sl, fl.pw, fl.ph, settleK(t - this.tPush - this.pushDur * 0.5, 5), 1.2) : undefined);
      cd.kind = 0; cd.dim = 1; cd.blur = 0; cd.cast = 1;
      cd.alpha = t >= fl.t - 0.05 ? 1 : 0;
      list.push(cd);
      phR[fl.panel]!.set(cx, cy, fl.pw, fl.ph);
      reveal.setComponent(fl.panel, ease.outCubic(prog(t, fl.t, fl.t + 0.5)));
    });
    // 鉛筆：橫躺在紙的上緣（推近之後在畫面外）
    const pc = this.cards[4]!;
    lay(pc, S(SX1 - 330, SY0 + 64, 6), -0.06);
    pc.hw = 240; pc.hh = 8; pc.radius = 8; pc.slot = -1; pc.pw = 0; pc.ph = 0; pc.kind = 4; pc.dim = 1; pc.blur = 0; pc.cast = 1; pc.alpha = 1;
    list.push(pc);
    setCards(this.pass, list);
    setSlots(this.pass, this.slots);
    cam.apply(this.pass);
    u.sheetTx!.value = this.sheetL.texture;
    (u.sheet!.value as THREE.Vector4).set(SX0, SY0, SX1 - SX0, SY1 - SY0);
    // 字在鏡頭推近主角時才寫上去（遠景時看不清楚，先不要出現）
    if (this.cap?.has && t > this.tPush + this.pushDur * 0.6) {
      this.cap.draw(t);
      u.txt!.value = this.cap.L.texture;
      (u.txtRect!.value as THREE.Vector4).set(this.capAt.x, this.capAt.y, this.cap.L.w, this.cap.L.h);
    } else {
      // shader 是這個版面所有窗格共用的：沒有字的時候把上一個窗格（已經釋放）的字層拿掉
      (u.txtRect!.value as THREE.Vector4).set(0, 0, 0, 0);
      u.txt!.value = null;
    }
    (u.notes!.value as THREE.Vector3).set(this.notes.y0, this.notes.dy, this.notes.n);
    u.lightDir!.value.set(-0.35, 0.45, 0.82).normalize();
    u.shadowK!.value = 0.38; u.penumbra!.value = 0.1;
    u.k!.value = 1 - 0.1 * prog(t, e - 0.3, e);
    this.pass.render(renderer, out);
    return { paper: 1, bloom: 0.12, bloomThreshold: 1.15, halation: 0.04, vignette: 0.3 };
  }
}
