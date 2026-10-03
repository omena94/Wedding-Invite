// 照片版面「相片」（亮版面）：照片是一張實體相片，放在紙上——
//  - 相片有白邊、軟軟的影子、微微斜放；切進來時像剛放下來（從上面落下、影子收緊）。
//  - 照片完整呈現（實體相片不會被裁），橫的直的、很小的舊照片都一樣；很小的照片最多放大到原尺寸約 1.4 倍（鏡頭還會再推一點）。
//  - 焦點：鏡頭整個窗格往相片上的臉（fx, fy）慢慢推近，臉越來越大、越來越靠近相片原本的中間；相片上的畫面本身也再小推一點。
//    說明欄寫在同一張紙上、跟著鏡頭一起動，所以推多少在 init() 算好：字一直在畫面裡（離邊 ≥ 96、不進 HUD 區）、臉離邊夠遠。
//  - 字（_photo.ts 的 PhotoText）用霞鶩文楷手寫在相片旁邊的紙上，像相簿上的手寫說明：主字（賓客留言＋署名，或新人的註解）
//    一個字一個字寫出來，署名在寫完才出現；歌詞小一號手寫在下面跟唱。沒有主字時歌詞自己寫在同一個位置；
//    兩個都沒有就只有相片（相片移到正中間）。
//  - 相簿的第一張（photo.chapter）：手寫說明上面小小一行相簿名，像相簿的分頁。
//  - 變化款：0 = 相簿頁（四個角有相角貼）、1 = 散放在紙上的相片（斜一點、沒有相角）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H, SCALE } from '../engine/gl';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { HUD_SAFE } from '../engine/hud';
import { focusCrop, focusIn, loadWords, photoTexture, PhotoText, settleK } from './_photo';
import type { PhotoRef, PhotoImage } from '../photos';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'classic', prefers: ['portrait', 'square', 'small'], paper: true, energy: [0, 1], bars: [2, 8], weight: 1, variants: 2 };

const BG = () => new FSPass(/* glsl */ `
  uniform sampler2D photo;
  uniform vec2 center; uniform vec2 halfSize; uniform float border; uniform float ang;
  uniform float lod; uniform float lift; uniform float corners; uniform float k;
  // 鏡頭：畫面上的點 p0 對應到紙上的 cam.zw + (p0 - cam.xy) / camZ；crop：相片上看得到哪一塊（往焦點推）
  uniform vec4 cam; uniform float camZ; uniform vec4 crop;
  void main() {
    vec2 p0 = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec2 p = cam.zw + (p0 - cam.xy) / camZ;
    // 紙：很淡的纖維與斑駁（跟著鏡頭動），四邊稍微暗一點（鏡頭的暗角，不跟著動）
    float n = fbm(p / 300.0, 3);
    float fib = snoise(vec2(p.x / 2.5, p.y / 70.0)) * 0.5 + snoise(vec2(p.x / 60.0, p.y / 3.0)) * 0.5;
    vec3 col = C_PAPER * (0.95 + 0.035 * n + 0.012 * fib);
    vec2 vq = (p0 - vec2(${W / 2}.0, ${H / 2}.0)) / vec2(${(W * 0.62).toFixed(1)}, ${(H * 0.66).toFixed(1)});
    col *= 1.0 - 0.12 * smoothstep(0.6, 1.3, length(vq));
    vec2 outer = halfSize + vec2(border);
    // 影子：往右下，放下來的瞬間比較遠、比較淡
    vec2 so = vec2(10.0, 16.0) * lift;
    float ds = sdBox(rot2(ang) * (p - center - so), outer);
    float blur = 18.0 + 22.0 * lift;
    float sh = ds < 0.0 ? 1.0 : exp(-ds / blur);
    col *= 1.0 - (0.34 / lift) * sh;
    // 相片
    vec2 q = rot2(ang) * (p - center);
    float d = sdBox(q, outer);
    float a = 1.0 - smoothstep(-0.8, 0.8, d);
    if (a > 0.0) {
      // 白邊：相紙的白，不發光（比 bone 再暗一點），邊緣一圈很細的灰
      vec3 pr = C_BONE * (0.93 + 0.02 * n);
      pr *= 1.0 - 0.06 * smoothstep(-2.5, 0.0, d);
      float di = sdBox(q, halfSize);
      float ai = 1.0 - smoothstep(-0.7, 0.7, di);
      if (ai > 0.0) {
        vec2 uv = clamp((q + halfSize) / (2.0 * halfSize), 0.0, 1.0);
        vec3 ph = toLinear(textureLod(photo, mix(crop.xy, crop.zw, uv), lod).rgb) * 0.82;
        // 相紙的光澤：很淡的一道斜光（在相紙上，不跟著畫面推）
        ph += C_BONE * 0.025 * smoothstep(0.3, 0.0, abs(uv.x - uv.y * 0.6 - 0.25));
        pr = mix(pr, ph, ai);
      }
      col = mix(col, pr, a);
    }
    // 相角貼（相簿頁）：四個角各一個深色的小三角，蓋住相片的角
    if (corners > 0.5) {
      vec2 u = outer + 9.0 - abs(q);
      float cs = 64.0;
      float ac = smoothstep(0.0, 1.0, u.x) * smoothstep(0.0, 1.0, u.y) * (1.0 - smoothstep(cs - 1.0, cs + 1.0, u.x + u.y));
      // 相角貼本身有一點立體：靠斜邊亮一點
      vec3 cc = mix(C_SEPIA * 0.55, C_SEPIA * 0.95, smoothstep(cs - 18.0, cs, u.x + u.y));
      col = mix(col, cc, ac * 0.88);
    }
    fragColor = vec4(col * k, 1.0);
  }`, {
  photo: { value: null }, center: { value: new THREE.Vector2() }, halfSize: { value: new THREE.Vector2() }, border: { value: 24 },
  ang: { value: 0 }, lod: { value: 0 }, lift: { value: 1 }, corners: { value: 0 }, k: { value: 1 },
  cam: { value: new THREE.Vector4() }, camZ: { value: 1 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
});

/** 手寫說明那一欄的寬、整塊（主字＋署名＋歌詞）的高上限。60 字的留言在 40 px 折五行放得下。 */
const COL_W = 560, COL_H = 470;
/** 相片與說明之間的空隙。 */
const GAP = 96;
/** 說明欄上面的相簿名（章節開頭才有）佔的高。 */
const CHAP_H = 56;
/** 文字層（說明欄）：比欄寬高多留一點邊。 */
const PAD = 30;
const TL = { w: COL_W + 2 * PAD + 20, h: CHAP_H + COL_H + 2 * PAD + 40 };
/**
 * 鏡頭往焦點推近的倍數上限（有字、沒字）。實際推多少在 init() 算：字一直要在畫面裡。
 * 相片上的畫面本身再往焦點小推（ENGINE.md：實體相片 ≤ 1.12）。
 */
const CAM_MAX = 1.15, CAM_BARE = 1.2, INNER = 1.08;
/** 鏡頭的目標從相片中間往焦點移多少（1 = 臉推到相片原本的中間；小一點相片不會整張甩出畫面）。 */
const TRACK = 0.7;
/** 臉（焦點）在畫面上離四邊至少多遠：推近時臉不會被推到邊上。 */
const FACE_M = 200;
/** 字離畫面四邊至少多遠（投影機會裁邊）。 */
const EDGE = 100;
/**
 * HUD 的字（QR 左邊那欄）從哪裡開始：相片是背景，可以在 HUD_SAFE 底下，但相片的右下角不要蓋到這塊——
 * 亮版面的 HUD 是深色字，壓在照片的暗處（山、禮服）上會看不清楚。
 */
const HUD_TXT = { x: HUD_SAFE.x + 100, y: HUD_SAFE.y + 30 };

export default class Print extends Scene {
  bg = shared('print.bg', BG);
  /** 說明欄的字：寫在紙上、跟著鏡頭放大，所以底圖多畫一點解析度（推到最近時字還是利的）。 */
  layer = this.track(new Layer2D(TL.w, TL.h, SCALE * CAM_MAX, { fast: true }));
  photo: PhotoRef = this.ctx.params.photo;
  variant = Number(this.ctx.params.variant ?? 0) % 2;
  seed = Number(this.ctx.params.seed ?? 1);
  tex: THREE.Texture | null = null;
  img: PhotoImage | null = null;
  /** 說明欄的字：主字（留言或註解）＋歌詞。 */
  text!: PhotoText;
  /** 相片（含白邊）的中心、相片本身的半寬高、白邊（紙上的座標；鏡頭還沒動時就是畫面座標）。 */
  cx = W / 2; cy = H / 2; hw = 0; hh = 0; border = 24;
  /** 照片放大幾倍貼在相片上（很小的舊照片限制鏡頭推的倍數用）。 */
  scale = 1;
  /** 說明欄的左上角（紙上）、實際用到的寬、字的頂（相簿名下面）。 */
  colX = 0; colY = 0; colW = 0; textY = 0;
  /** 說明欄在相片左邊（焦點在相片左半邊時）。 */
  left = false;
  ang = 0;
  /** 主字一個字一個字寫出來的起訖時間。 */
  tW0 = 0; tW1 = 0;
  /**
   * 鏡頭推到最後（k = 1）的樣子：畫面 = (cx, cy) + (紙 − T)·Z。k = 0 時 T = 相片中心、Z = 1（不動）；
   * T 從相片中間移向焦點、Z 慢慢推近（ENGINE.md「焦點」：實體相片用鏡頭往相片上焦點那一點推）。
   */
  camZ = 1; camTx = 0; camTy = 0;

  override async init() {
    const { start } = this.ctx;
    const ph = this.photo;
    // 照片版面只排在照片窗格（導演一定給 params.photo）；沒有就讓引擎跳過這個窗格，不要畫一半
    if (!ph) throw new Error('照片版面要有 params.photo');
    await loadText(ph.album);
    await loadWords(this.ctx);
    this.img = await ph.load();
    this.tex = this.track(photoTexture(this.img));
    this.ctx.renderer.initTexture(this.tex);
    // 手寫在紙上：不用暗影；正在唱的字是訊號色混一點墨色（亮紙上訊號色太跳）
    this.text = new PhotoText(this.ctx, this.layer.ctx, {
      family: F.hand(400), w: COL_W, h: COL_H, min: 40, max: 50, lineHeight: 1.45, maxLines: 5,
      ink: rgba('sepia', 0.92), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.45),
      sigSize: 28, sigInk: rgba('sepia', 0.7), lyricSize: 48, lyricSubSize: 38,
    });
    const has = this.text.has;
    const { w, h } = this.img;
    // 說明欄放在焦點那一邊：鏡頭往臉推時字離推近的中心近、不會被推出畫面，臉才推得到相片中間（焦點在中間時放右邊）
    this.left = has && ph.fx < 0.42;
    // 相片的大小：放在說明欄旁邊或正中間；很小的照片最多放大 1.4 倍（鏡頭還會再推一點，加起來約 1.5 倍）
    // 沒有說明欄：相片在正中間偏左上一點，右下角的 HUD（QR code）不要壓在相片上；相片在右邊時也矮一點，底不碰 HUD
    const boxW = has ? 1000 : 1160, boxH = this.left ? 760 : has ? 820 : 730;
    const s = (this.scale = Math.min((boxW - 72) / w, (boxH - 72) / h, 1.4));
    const pw = w * s, phh = h * s;
    this.border = clamp(0.045 * Math.min(pw, phh), 14, 34);
    this.hw = pw / 2; this.hh = phh / 2;
    const tw = pw + 2 * this.border;
    // 說明欄實際的寬（短留言不用留一整欄的空）：字、相簿名取寬的
    let chapW = 0;
    if (ph.chapter && ph.album) {
      const c = this.layer.ctx;
      c.font = font(F.hand(700), 22);
      c.letterSpacing = '4px';
      chapW = Math.min(COL_W - 10, c.measureText(ph.album).width);
      c.letterSpacing = '0px';
    }
    this.colW = has ? Math.max(this.text.width, chapW) : 0;
    // 相片＋說明欄當成一組，整組水平置中
    const groupW = has ? tw + GAP + this.colW : tw;
    const x0 = Math.max(110, (W - groupW) / 2 - (has ? 0 : 40));
    this.cx = this.left ? x0 + this.colW + GAP + tw / 2 : x0 + tw / 2;
    this.cy = H / 2 - (has ? 6 : 24);
    this.colX = this.left ? x0 : x0 + tw + GAP;
    // 斜放的角度：相簿頁正一點、散放的斜一點
    const r = hash(this.seed, 7) * 2 - 1;
    this.ang = (this.variant === 0 ? 1.2 : 3.2) * r * (Math.PI / 180);
    // 相片的右下角蓋到 HUD 的字：整張往上挪（上緣留 40 px）
    const pr = this.photoRect();
    if (pr[2] > HUD_TXT.x && pr[3] > HUD_TXT.y) this.cy -= clamp(pr[3] - HUD_TXT.y, 0, Math.max(0, pr[1] - 40));
    if (this.text.hasMain) {
      // 一個字一個字寫出來：放下相片後開始，最多兩秒寫完（署名在寫完才出現）
      this.tW0 = start + 0.55;
      this.tW1 = this.tW0 + Math.min(2.0, 0.06 * this.text.chars + 0.3);
    }
    // 說明欄的上緣：整塊（相簿名＋字）跟相片的中心對齊；說明欄跨進 HUD 那一欄時，底要在 HUD 上面
    const chapH = ph.chapter && ph.album ? CHAP_H : 0;
    const blockH = chapH + this.text.height + Math.round(this.text.size * 0.3);
    const bottom = this.colX + this.colW > HUD_SAFE.x ? HUD_SAFE.y - 30 : H - EDGE - 30;
    this.colY = clamp(this.cy - blockH / 2 - 10, 130, bottom - blockH);
    this.textY = this.colY + chapH;
    this.solveCamera();
  }

  /** 相片上的畫面在 k 時看哪一塊（往焦點小推；很小的照片少推，不推糊）。 */
  private cropAt(k: number) {
    const { w, h } = this.img!;
    return focusCrop(this.photo, w, h, w / h, k, { zoom: INNER, screenW: 2 * this.hw * this.camZ });
  }

  /** 焦點在紙上的位置（k 時）：相片中心＋焦點在相片上的位置（畫面往焦點推、相片斜放都算進去）。 */
  private focusAt(k: number): [number, number] {
    const [u, v] = focusIn(this.photo, this.cropAt(k));
    const qx = (u - 0.5) * 2 * this.hw, qy = (v - 0.5) * 2 * this.hh;
    // shader 的 q = rot2(ang)·(p − center)，反過來 p = center + rot2(ang)ᵀ·q
    const c = Math.cos(this.ang), sn = Math.sin(this.ang);
    return [this.cx + c * qx - sn * qy, this.cy + sn * qx + c * qy];
  }

  /** 相片（含白邊、斜放）佔的範圍（紙上）[x0, y0, x1, y1]。 */
  private photoRect(): [number, number, number, number] {
    const bx = this.hw + this.border, by = this.hh + this.border;
    const c = Math.abs(Math.cos(this.ang)), sn = Math.abs(Math.sin(this.ang));
    const ex = c * bx + sn * by, ey = sn * bx + c * by;
    return [this.cx - ex, this.cy - ey, this.cx + ex, this.cy + ey];
  }

  /** 說明欄的字實際佔的範圍（紙上）[x0, y0, x1, y1]：相簿名＋字，最後一行的字腳也算。 */
  private textRect(): [number, number, number, number] {
    return [this.colX, this.colY, this.colX + this.colW, this.textY + this.text.height + this.text.size * 0.3];
  }

  /** 鏡頭在 k 時：Z、T。 */
  private camAt(k: number): [number, number, number] {
    return [lerp(1, this.camZ, k), lerp(this.cx, this.camTx, k), lerp(this.cy, this.camTy, k)];
  }

  /**
   * 鏡頭推到最後要多近、對準哪裡：從上限往下找第一個「整段推的過程中字都在畫面裡、臉離邊夠遠、相片不蓋 HUD 的字」的倍數。
   * T 往焦點移（臉往相片原本的中間靠）；字卡到邊時 T 往字那邊讓——臉不一定到正中間，但一定越來越大。
   */
  private solveCamera() {
    const ax = this.cx, ay = this.cy;
    const rect = this.text.has ? this.textRect() : null;
    const pr = this.photoRect();
    // 很小的舊照片：相片的放大倍數 × 鏡頭不超過約 1.55 倍
    const top = Math.min(rect ? CAM_MAX : CAM_BARE, Math.max(1.04, 1.55 / this.scale));
    for (let z = top; z > 1.001; z -= 0.005) {
      this.camZ = z;
      const [fx, fy] = this.focusAt(1);
      let tx = lerp(ax, fx, TRACK), ty = lerp(ay, fy, TRACK);
      let ylo = -Infinity, yhi = Infinity;
      if (rect) {
        // 字的左右：EDGE ≤ ax + (x − T)·z ≤ W − EDGE
        const xlo = rect[2] - (W - EDGE - ax) / z, xhi = rect[0] - (EDGE - ax) / z;
        if (xlo > xhi) continue;
        tx = clamp(tx, xlo, xhi);
        // 字的上下：右緣跨進 HUD 那一欄時，底要在 HUD 上面
        const bot = ax + (rect[2] - tx) * z > HUD_SAFE.x - 4 ? HUD_SAFE.y - 14 : H - EDGE;
        ylo = rect[3] - (bot - ay) / z; yhi = rect[1] - (EDGE - ay) / z;
      }
      // 相片推大之後右下角不要蓋到 HUD 的字
      if (ax + (pr[2] - tx) * z > HUD_TXT.x) ylo = Math.max(ylo, pr[3] - (HUD_TXT.y - ay) / z);
      if (ylo > yhi) continue;
      ty = clamp(ty, ylo, yhi);
      this.camTx = tx; this.camTy = ty;
      if (this.cameraOk(rect, pr)) return;
    }
    this.camZ = 1; this.camTx = ax; this.camTy = ay;
  }

  /** 整段推的過程（取幾個點）字都在安全範圍、臉離邊夠遠、相片不比一開始更蓋到 HUD 的字。 */
  private cameraOk(rect: [number, number, number, number] | null, pr: readonly number[]) {
    for (const k of [0.25, 0.5, 0.75, 1]) {
      const [z, tx, ty] = this.camAt(k);
      const sx = (x: number) => this.cx + (x - tx) * z, sy = (y: number) => this.cy + (y - ty) * z;
      const [fx, fy] = this.focusAt(k);
      if (sx(fx) < FACE_M || sx(fx) > W - FACE_M || sy(fy) < FACE_M * 0.75 || sy(fy) > H - FACE_M * 0.75) return false;
      if (sx(pr[2]!) > HUD_TXT.x && sy(pr[3]!) > Math.max(HUD_TXT.y, pr[3]!) + 1) return false;
      if (!rect) continue;
      const x0 = sx(rect[0]), y0 = sy(rect[1]), x1 = sx(rect[2]), y1 = sy(rect[3]);
      if (x0 < EDGE - 1 || y0 < EDGE - 1 || x1 > W - EDGE + 1 || y1 > H - EDGE + 1) return false;
      if (x1 > HUD_SAFE.x && y1 > HUD_SAFE.y - 10) return false;
    }
    return true;
  }

  /** 清掉說明欄、重畫不會變的相簿名（PhotoText 內容變了才會叫）。 */
  private paintBase() {
    const L = this.layer, c = L.ctx, ph = this.photo;
    L.clear();
    if (!(ph.chapter && ph.album)) return;
    const y = PAD;
    c.font = font(F.hand(700), 22);
    c.fillStyle = rgba('sepia', 0.62);
    c.letterSpacing = '4px';
    let s = ph.album;
    while (s.length > 1 && c.measureText(s).width > COL_W - 10) s = s.slice(0, -1);
    c.fillText(s === ph.album ? s : `${s}…`, PAD, y + 22);
    const lw = Math.min(COL_W * 0.5, c.measureText(s).width + 8);
    c.letterSpacing = '0px';
    c.strokeStyle = rgba('sepia', 0.4); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(PAD, y + 36); c.quadraticCurveTo(PAD + lw * 0.5, y + 39, PAD + lw, y + 35); c.stroke();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const lt = t - s;
    // 放下來：從上面一點點落下、角度轉回來、影子收緊；之後角度很慢地偏一點點
    const drop = ease.outCubic(prog(t, s, s + 0.75));
    const dir = hash(this.seed, 9) < 0.5 ? -1 : 1;
    const drift = ease.inOutQuad(clamp(lt / 10));
    const exitK = prog(t, e - 0.3, e, ease.inCubic);
    // 鏡頭往臉推：一開始快、之後越來越慢（3～16 秒的窗格都看得出來）
    const k = settleK(lt, 5);
    const [z, tx, ty] = this.camAt(k);
    const crop = this.cropAt(k);
    const u = this.bg.u;
    u.photo!.value = this.tex;
    (u.cam!.value as THREE.Vector4).set(this.cx, this.cy, tx, ty);
    u.camZ!.value = z;
    (u.crop!.value as THREE.Vector4).set(crop[0], crop[1], crop[2], crop[3]);
    (u.center!.value as THREE.Vector2).set(this.cx, this.cy - 34 * (1 - drop) - 10 * exitK);
    (u.halfSize!.value as THREE.Vector2).set(this.hw, this.hh);
    u.border!.value = this.border;
    u.ang!.value = this.ang + dir * (2.5 * (1 - drop) + 0.35 * drift) * (Math.PI / 180);
    u.lift!.value = lerp(2.2, 1, drop) + 0.4 * exitK;
    u.lod!.value = Math.max(0, Math.log2(((crop[2] - crop[0]) * this.img!.w) / (2 * this.hw * z * SCALE)));
    u.corners!.value = this.variant === 0 ? 1 : 0;
    u.k!.value = 1;
    this.bg.render(renderer, out);
    if (this.text.has) {
      const L = this.layer;
      const chars = this.text.hasMain ? Math.floor(clamp((t - this.tW0) / Math.max(0.01, this.tW1 - this.tW0)) * this.text.chars + (t >= this.tW1 ? 1e3 : 0)) : Infinity;
      if (this.text.draw(L.ctx, t, PAD, this.textY - this.colY + PAD, { chars, clear: () => this.paintBase() })) L.upload();
      // 字寫在紙上：跟著鏡頭一起移動、放大
      const sx = this.cx + (this.colX - PAD - tx) * z, sy = this.cy + (this.colY - PAD - ty) * z;
      const ax = W / (z * L.w), ay = H / (z * L.h);
      const op = prog(t, s + 0.2, s + 0.6) * (1 - prog(t, e - 0.3, e));
      comp.draw(renderer, L.texture, out, { opacity: op, scale: [ax, ay], offset: [0.5 * ax - 0.5 - sx / (z * L.w), 0.5 - 0.5 * ay + sy / (z * L.h)] });
    }
    return { paper: 1, bloom: 0.15, bloomThreshold: 1.1, halation: 0.05, vignette: 0.25 };
  }
}
