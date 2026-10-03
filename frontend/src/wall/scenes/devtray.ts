// 照片版面「暗房顯影」（暗）：紅色安全燈下，一張相紙泡在顯影盤的藥水裡，新人的照片慢慢浮現——
//  - 鏡頭斜斜地看著水槽上的顯影盤（真的透視：盤子遠的那邊小、近的大），開燈時從比較高、比較遠的地方落定，之後很慢地推近。
//  - 顯影：最暗的地方先出來、中間調接著、亮部最後（真的顯影就是這樣），先是單色、顏色最後才飽和；
//    顯好之後房間的白燈慢慢亮起來（安全燈的紅退成暖色），照片的顏色才看得清楚，窗格長的時候大半時間是好看的照片。
//  - 液面：每個小節線盤子被搖一下（一道浪推過去），每兩拍上方滴下一滴（一圈漣漪）；浪讓相紙的影像折射晃動，
//    浪峰反射安全燈的光（一條會扭的亮帶，不發光）。右上角是失焦的安全燈。
//  - 字手寫在盤邊的紙膠帶標籤上（一頭黏在盤緣、一頭貼在檯面上，跟著透視與燈光），一個字一個字寫出來：
//    主字（賓客留言＋署名，或新人的註解）寫在第一條膠帶上；同時有歌詞時，歌詞寫在下面另一條短一點的膠帶上跟唱
//    （暗房裡一條一條貼的標籤，一條膠帶寫不下一整段）；沒有主字時歌詞就寫在第一條上。
//    兩個都沒有就沒有標籤，盤子移到正中間。相簿的第一張在標籤上多一行小小的相簿名。
//  - 照片完整放在相紙上（直的、手機直拍、很小的舊照片都不裁），很小的照片最多放大到原尺寸約 1.5 倍。
//    顯影之後相紙上的畫面往焦點小推，鏡頭也往相紙上的焦點推（有標籤時推到標籤快出框就停）。
import * as THREE from 'three';
import { Scene, shared, type Frame, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, H } from '../engine/gl';
import { HUD_SAFE } from '../engine/hud';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { beatAfter, barAfter } from './_motifs';
import { focusCrop, loadWords, settleK } from './_photo';
import { CAM_GLSL, P1_GLSL, P1Cap, gainOf, inSafe, p1Uniforms, PlaneCam, camUniforms, containScale, fitLabel, loadPhotos, mipFor, photoRefs, safePush, seedOf, type P1Photo } from './_p1';

export const spec: PlateSpecDecl = { photo: true, family: 'photo', series: 'film', prefers: ['landscape', 'square', 'small'], energy: [0, 0.8], bars: [2, 8], weight: 1 };

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${P1_GLSL}
  uniform sampler2D photo; uniform float lod; uniform vec4 crop;
  uniform vec2 paperC; uniform vec2 paperHalf; uniform vec2 photoHalf; uniform float paperAng;
  uniform vec2 trayHalf; uniform float rim;
  uniform float dev; uniform float tint; uniform float redness; uniform float k; uniform float t;
  uniform vec4 rock; uniform vec4 drop0; uniform vec4 drop1;
  uniform sampler2D txt; uniform vec2 labelC; uniform vec2 labelHalf; uniform float labelAng; uniform float labelOn; uniform vec2 txtSize;
  uniform sampler2D lyr; uniform vec2 lyrC; uniform vec2 lyrHalf; uniform float lyrAng; uniform float lyrOn; uniform vec2 lyrSize;
  uniform vec3 lampPos; uniform vec2 lampScr; uniform float focusZ; uniform vec2 tongC; uniform float tongAng;

  // 液面高度（世界單位）：小節線的浪、兩滴水的漣漪、很淡的常態起伏
  float waveH(vec2 q) {
    float h = 0.0;
    // rock = (起點 x, 經過秒數, 振幅, 方向)
    float fx = rock.x + rock.w * rock.y * 520.0;
    float u = (q.x - fx) * rock.w;
    h += rock.z * exp(-rock.y / 1.1) * sin(u / 46.0) * exp(-u * u / 52000.0);
    for (int i = 0; i < 2; i++) {
      vec4 dp = i == 0 ? drop0 : drop1;
      float r = length(q - dp.xy), fr = dp.z * 330.0;
      float x = r - fr;
      h += dp.w * exp(-dp.z / 1.3) * sin(x / 13.0) * exp(-x * x / 2600.0) / (1.0 + fr / 260.0);
    }
    h += 0.5 * snoise(vec3(q / 260.0, t * 0.12));
    return h;
  }

  // 紙膠帶標籤（中心 c、半寬高 hh、角度 ang）：紙比較亮、兩端有一點透明、撕開的鋸齒；tx 是寫在上面的字（左上角對齊膠帶）
  vec3 tape(vec3 col, vec2 q, vec2 c, vec2 hh, float ang, float on, sampler2D tx, vec2 tsz, float aa, float sd) {
    vec2 lq = rot2(ang) * (q - c);
    if (abs(lq.x) > hh.x + 80.0 || abs(lq.y) > hh.y + 80.0) return col;
    float jag = 3.0 * snoise(vec2(lq.y / 6.0, sign(lq.x) * 5.0 + sd));
    vec2 lh = hh + vec2(jag, 0.0);
    float dl = sdBox(lq, lh);
    // 膠帶的影子
    float dls = sdBox(lq - vec2(-6.0, 9.0), lh);
    col *= 1.0 - 0.35 * on * exp(-max(dls, 0.0) / 10.0);
    float la = (1.0 - smoothstep(-aa, aa, dl)) * on;
    if (la > 0.0) {
      float fib = snoise(vec2(lq.x / 3.0, lq.y / 40.0 + sd)) * 0.5 + 0.5;
      vec3 tp = C_PAPER * (0.8 + 0.06 * fib);
      // 膠帶的兩端比較透（看得到底下）
      float edge = smoothstep(lh.x - 26.0, lh.x, abs(lq.x));
      tp = mix(tp, col * 1.4, 0.35 * edge);
      vec4 ink = layerAt(tx, (lq + hh) / tsz);
      tp = tp * (1.0 - ink.a) + ink.rgb;
      col = mix(col, tp, la);
    }
    return col;
  }

  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    vec3 hit = camHit(p, 0.0);
    vec2 q = hit.xy;
    float pxw = hit.z / camFocal;           // 這裡一個畫面 px 是幾個世界單位
    float blur = abs(hit.z - focusZ) / focusZ; // 景深：離對焦面越遠越糊
    float aa = pxw * (1.0 + 26.0 * blur);
    // 光：安全燈（紅）與房間的燈（暖白），從右上方打過來的一圈
    vec3 red = C_COLLAR / max(C_COLLAR.r, 0.01);
    vec3 light = mix(vec3(1.0, 0.9, 0.78), red * 0.72, redness);
    float pool = 0.35 + 0.75 * exp(-dot((q - lampPos.xy) / vec2(1900.0, 1500.0), (q - lampPos.xy) / vec2(1900.0, 1500.0)) * 1.4);

    // 檯面：濕的深色石材，很淡的紋路與水漬
    float n = fbm(q / 420.0, 3);
    vec3 col = mix(C_INK, C_INK2, 0.6 + 0.4 * n) * 0.9;
    col += C_GRAPHITE * 0.05 * smoothstep(0.25, 0.7, fbm(q / 130.0 + 7.0, 2));
    // 盤子：塑膠盤緣（外圈）、盤底（裡面）
    float dOut = sdRound(q, trayHalf + rim, rim * 0.9);
    float dIn = sdRound(q, trayHalf, rim * 0.5);
    // 盤子在檯面上的影子（往左下，很軟）
    float dSh = sdRound(q - vec2(-26.0, 34.0), trayHalf + rim, rim);
    col *= 1.0 - 0.5 * exp(-max(dSh, 0.0) / 46.0);
    vec3 surf = col;
    float inTray = 1.0 - smoothstep(-aa, aa, dOut);
    if (inTray > 0.0) {
      // 盤緣：上面有一道亮（燈打到的倒角），靠內側一道深的
      float bev = clamp(-dOut / rim, 0.0, 1.0);
      vec3 rimC = C_GRAPHITE * 0.3 + C_ASH * 0.12 * smoothstep(0.15, 0.45, bev) * (1.0 - smoothstep(0.55, 0.9, bev));
      rimC *= 0.85 + 0.3 * smoothstep(-trayHalf.y, trayHalf.y, -q.y);
      vec3 inner = rimC;
      float inside = 1.0 - smoothstep(-aa, aa, dIn);
      if (inside > 0.0) {
        // 液面的法線（有限差分）
        float e = 3.0;
        float h0 = waveH(q), hx = waveH(q + vec2(e, 0.0)), hy = waveH(q + vec2(0.0, e));
        vec2 g = vec2(hx - h0, hy - h0) / e;
        vec3 nrm = normalize(vec3(-g * 1.0, 1.0));
        // 折射：底下的相紙跟著浪晃
        vec2 rq = q - g * 26.0;
        // 盤底：深色塑膠，有一條一條的凸紋
        float rib = smoothstep(0.82, 1.0, abs(sin(rq.x / 22.0)));
        vec3 floorC = C_INK2 * (0.75 + 0.25 * rib);
        // 相紙（稍微斜放）
        vec2 lq = rot2(paperAng) * (rq - paperC);
        float dp = sdBox(lq, paperHalf);
        float pa = 1.0 - smoothstep(-aa, aa, dp);
        // 相紙在盤底的影子
        floorC *= 1.0 - 0.45 * exp(-max(sdBox(lq - vec2(-10.0, 12.0), paperHalf), 0.0) / 18.0);
        vec3 under = floorC;
        if (pa > 0.0) {
          vec3 paper = C_BONE * 0.86;
          float di = sdBox(lq, photoHalf);
          if (di < aa) {
            // 相紙上的畫面往焦點小推：影像區對應到照片的 crop 那一塊
            vec2 uv = crop.xy + (lq + photoHalf) / (2.0 * photoHalf) * (crop.zw - crop.xy);
            vec3 ph = photoLin(photo, uv, lod + log2(max(pxw * (crop.z - crop.x), 1e-4)) + 4.0 * blur);
            // 顯影：每個像素的「密度」（暗的地方密度高），密度高的先出來；顏色最後才飽和
            float dens = 1.0 - pow(clamp(luma(ph), 0.0, 1.0), 0.45);
            float app = clamp((dev * 1.45 - (1.0 - dens) * 0.95) / 0.5, 0.0, 1.0);
            vec3 mono = vec3(luma(ph));
            vec3 shown = mix(mono, ph, tint);
            vec3 pr = mix(paper, shown * 0.84, app * smoothstep(0.0, 0.08, dev));
            paper = mix(paper, pr, 1.0 - smoothstep(-aa, aa, di));
          }
          under = mix(under, paper, pa);
        }
        // 藥水：一點點暖黃、吃掉一點光
        vec3 liquid = under * vec3(0.9, 0.86, 0.74);
        // 液面反射安全燈：浪峰扭動的一塊亮（不發光：壓在 0.6 以下），外面一圈很淡的光澤
        vec3 V = normalize(vec3(q, 0.0) - camPos);
        vec3 R = reflect(V, nrm);
        vec3 Ld = normalize(lampPos - vec3(q, 0.0));
        float rl = max(dot(R, Ld), 0.0);
        float spec = pow(rl, 1400.0) * 0.5 + pow(rl, 90.0) * 0.07;
        // 浪的明暗（看得出液面在動）
        float ripple = dot(g, normalize(vec2(0.6, -1.0))) * 0.9;
        liquid *= 1.0 + clamp(ripple, -0.3, 0.3);
        liquid += (spec + max(ripple, 0.0) * 0.025) * red * vec3(1.0, 0.8, 0.7) / max(light, vec3(0.08));
        // 液面靠盤緣的一圈暗（盤壁的影子）
        liquid *= 0.7 + 0.3 * smoothstep(0.0, 70.0, -dIn);
        inner = mix(inner, liquid, inside);
      }
      surf = mix(col, inner, inTray);
    }
    col = surf;

    // 竹夾子：斜斜地靠在盤子右上角的盤緣上（兩根細長的竹片）
    for (int i = 0; i < 2; i++) {
      // 兩片竹片在尾端併在一起、前端張開一點
      vec2 tq = rot2(tongAng) * (q - tongC);
      tq.y -= (float(i) * 2.0 - 1.0) * (6.0 + 14.0 * smoothstep(200.0, -200.0, tq.x));
      float dt = sdRound(tq, vec2(210.0, 9.0), 8.0);
      float ds2 = sdRound(tq - vec2(-16.0, 20.0), vec2(210.0, 9.0), 8.0);
      col *= 1.0 - 0.3 * exp(-max(ds2, 0.0) / 9.0);
      float ta = 1.0 - smoothstep(-aa, aa, dt);
      vec3 bam = C_FUR * (0.4 + 0.14 * smoothstep(-9.0, 9.0, -tq.y)) * (0.9 + 0.1 * snoise(vec2(tq.x / 40.0, float(i))));
      // 前端套著深色橡膠
      bam = mix(bam, C_INK2 * 1.4, smoothstep(-160.0, -168.0, tq.x));
      col = mix(col, bam, ta);
    }
    // 紙膠帶標籤：一頭黏在盤緣、一頭在檯面上；有主字又有歌詞時，歌詞那條貼在下面
    if (lyrOn > 0.0) col = tape(col, q, lyrC, lyrHalf, lyrAng, lyrOn, lyr, lyrSize, aa, 3.0);
    if (labelOn > 0.0) col = tape(col, q, labelC, labelHalf, labelAng, labelOn, txt, txtSize, aa, 0.0);

    // 燈光
    col *= light * pool;
    // 右上角失焦的安全燈（前景，壓在 0.7 以下）
    vec2 lo = (p - lampScr) / 150.0;
    col += red * 0.32 * (1.0 - redness * 0.3) * exp(-dot(lo, lo) * 1.6);
    col += red * 0.05 * exp(-dot(lo, lo) * 0.12);
    fragColor = vec4(col * k, 1.0);
  }`, {
  ...p1Uniforms(),
  photo: { value: null }, lod: { value: 0 }, crop: { value: new THREE.Vector4(0, 0, 1, 1) },
  paperC: { value: new THREE.Vector2() }, paperHalf: { value: new THREE.Vector2() }, photoHalf: { value: new THREE.Vector2() }, paperAng: { value: 0 },
  trayHalf: { value: new THREE.Vector2() }, rim: { value: 34 },
  dev: { value: 0 }, tint: { value: 0 }, redness: { value: 1 }, k: { value: 1 }, t: { value: 0 },
  rock: { value: new THREE.Vector4() }, drop0: { value: new THREE.Vector4() }, drop1: { value: new THREE.Vector4() },
  txt: { value: null }, labelC: { value: new THREE.Vector2() }, labelHalf: { value: new THREE.Vector2() }, labelAng: { value: 0 }, labelOn: { value: 0 }, txtSize: { value: new THREE.Vector2(1, 1) },
  lyr: { value: null }, lyrC: { value: new THREE.Vector2() }, lyrHalf: { value: new THREE.Vector2() }, lyrAng: { value: 0 }, lyrOn: { value: 0 }, lyrSize: { value: new THREE.Vector2(1, 1) },
  lampPos: { value: new THREE.Vector3() }, lampScr: { value: new THREE.Vector2() }, focusZ: { value: 1700 },
  tongC: { value: new THREE.Vector2() }, tongAng: { value: 0 },
  ...camUniforms(),
});

/** 標籤上的字（世界單位 = 對焦處的畫面 px）：寬、主字＋署名的高度上限；歌詞那條膠帶上下的邊。 */
const CAP_W = 500, CAP_H = 300, PAD = 30, PAD2 = 22, ALBUM_H = 44;

export default class Devtray extends Scene {
  bg = shared('devtray.bg', BG);
  txt = this.track(new Layer2D(CAP_W + 2 * PAD, CAP_H + 2 * PAD + ALBUM_H, undefined, { fast: true }));
  /** 第二條膠帶（有主字又有歌詞時，歌詞寫在這條上）：高度夠放兩行字幕。 */
  lyr = this.track(new Layer2D(CAP_W + 2 * PAD, 150, undefined, { fast: true }));
  cam = new PlaneCam();
  seed = seedOf(this.ctx);
  ph!: P1Photo;
  cap!: P1Cap;
  /** 主字跟歌詞分兩條膠帶。 */
  apart = false;
  album = '';
  hw = 0; hh = 0; border = 30;
  tray = new THREE.Vector2();
  rim = 34;
  /** 鏡頭看的點（盤子偏左，讓出標籤的位置）。 */
  aimX = 0; aimY = 0;
  labelC = new THREE.Vector2(); labelHalf = new THREE.Vector2(); labelAng = 0;
  lyrC = new THREE.Vector2(); lyrHalf = new THREE.Vector2(); lyrAng = 0;
  paperAng = 0;
  tDev = 0; devDur = 3; tLight = 0; tW0 = 0; tW1 = 0;

  override async init() {
    const { start, end } = this.ctx;
    const [ref] = photoRefs(this.ctx, 1);
    await loadText(`${ref!.caption}${ref!.album}…`);
    await loadWords(this.ctx);
    [this.ph] = await loadPhotos(this.ctx, [ref!], (x) => this.track(x));
    const c = this.txt.ctx;
    this.cap = new P1Cap(this.ctx, c, {
      family: F.hand(400), min: 40, max: 48, w: CAP_W, h: CAP_H, lineHeight: 1.3, maxLines: 5, lyricsApart: true,
      ink: rgba('sepia', 0.95), unsung: rgba('sepia', 0.3), active: mixRgba('signal', 'sepia', 0.45), sigSize: 28, sigInk: rgba('sepia', 0.75),
    });
    this.apart = this.cap.hasMain && this.cap.sung;
    if (ref!.chapter && ref!.album) this.album = fitLabel(c, ref!.album, F.hand(700), 24, CAP_W, 4);
    const { w, h } = this.ph;
    // 照片在相紙上的大小：有標籤時盤子靠左、小一點；很小的照片最多放大 1.5 倍
    const has = this.cap.has;
    const s = containScale(w, h, has ? 820 : 1080, has ? 600 : 660);
    this.hw = (w * s) / 2; this.hh = (h * s) / 2;
    this.border = clamp(0.05 * Math.min(this.hw, this.hh) * 2, 18, 38);
    this.tray.set(this.hw + this.border + 64, this.hh + this.border + 64);
    this.paperAng = (hash(this.seed, 3) - 0.5) * 0.05;
    // 鏡頭的目標：有標籤時盤子往左移（標籤在盤子右邊）
    const lw = CAP_W / 2 + PAD;
    const groupW = 2 * (this.tray.x + this.rim) + (has ? 2 * lw - 40 : 0);
    this.aimX = has ? groupW / 2 - (this.tray.x + this.rim) - 20 : 0;
    this.aimY = 10;
    // 標籤：左端黏在盤子的右緣上，往右貼到檯面；高度照字。歌詞那條貼在下面、短一點、角度不一樣
    const lh = (this.cap.height + 2 * PAD + (this.album ? ALBUM_H : 0)) / 2;
    const lh2 = this.apart ? (this.cap.lyricH + 2 * PAD2) / 2 : 0;
    this.labelHalf.set(lw, lh);
    this.lyrHalf.set(lw, lh2);
    this.labelAng = (hash(this.seed, 4) - 0.5) * 0.07 + 0.03;
    this.lyrAng = -this.labelAng * 0.6 - 0.012;
    // 兩條一起當一欄，中間在盤子的高度上
    const colH = 2 * lh + (this.apart ? 24 + 2 * lh2 : 0);
    let top = this.aimY - colH / 2 + (this.apart ? 0 : clamp(this.tray.y * 0.25, -60, 140));
    const lx = this.tray.x + this.rim + lw - 52;
    // 鏡頭落定、還沒推的時候，整欄要在字的安全範圍裡（右邊的標籤不能壓到 HUD）：不夠就往上挪
    for (let i = 0; i < 3; i++) {
      this.labelC.set(lx, top + lh);
      this.lyrC.set(lx + 24, top + 2 * lh + 24 + lh2);
      if (!has) break;
      this.placeCam(1, 0, 0, hash(this.seed, 2) < 0.5 ? -1 : 1);
      const r = this.colRect();
      const over = Math.max(0, r[1] + r[3] - (HUD_SAFE.y - 14)), under = Math.max(0, 110 - r[1]);
      if (!over && !under) break;
      top += (under - over) * 0.95;
    }
    // 時間：第一拍開始顯影，至少一秒半、最多五秒半；顯完開房間的燈；主字在顯影開始後寫
    const len = end - start;
    this.tDev = Math.min(beatAfter(this.ctx.audio, start + 0.05), start + 0.4);
    this.devDur = clamp(len * 0.42, 1.3, 5.5);
    this.tLight = Math.min(barAfter(this.ctx.audio, this.tDev + this.devDur * 0.85), end - 1.2);
    this.tW0 = start + Math.min(0.9, len * 0.15);
    this.tW1 = this.tW0 + this.cap.writeDur(0.07, 2.4);
  }

  /** 相紙上的焦點在檯面上的位置（相紙轉了 paperAng、往一邊很慢地漂）。 */
  private focusWorld(lt: number, dir: number): [number, number] {
    const lx = (this.ph.ref.fx - 0.5) * 2 * this.hw, ly = (this.ph.ref.fy - 0.5) * 2 * this.hh;
    const c = Math.cos(this.paperAng), s = Math.sin(this.paperAng);
    return [dir * 8 * ease.inOutQuad(clamp(lt / 9)) + c * lx - s * ly, s * lx + c * ly];
  }

  /** 標籤（一條或兩條）在畫面上的外框。 */
  private colRect(): [number, number, number, number] {
    const box = (cc: THREE.Vector2, hh: THREE.Vector2, a: number) => {
      const ex = Math.abs(Math.cos(a)) * hh.x + Math.abs(Math.sin(a)) * hh.y, ey = Math.abs(Math.sin(a)) * hh.x + Math.abs(Math.cos(a)) * hh.y;
      return this.cam.rect(cc.x - ex, cc.y - ey, 2 * ex, 2 * ey);
    };
    const a = box(this.labelC, this.labelHalf, this.labelAng);
    if (!this.apart) return a;
    const b = box(this.lyrC, this.lyrHalf, this.lyrAng);
    const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
    return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
  }

  /**
   * 鏡頭：land 是開燈時從高一點、遠一點的地方落定（0..1），k 是往焦點推到哪裡（0..1）。
   * 推的時候目標從盤子移向相紙上的焦點、放大；有標籤時目標移得少一點（標籤要留在畫面裡）。
   */
  private placeCam(land: number, k: number, lt = 0, dir = 1) {
    const has = this.cap.has;
    const [fx, fy] = this.focusWorld(lt, dir);
    const a = (has ? 0.4 : 0.8) * k;
    const dist = lerp(2150, 1780, land) - 120 * k;
    const tilt = (lerp(31, 21, land) - 2 * k) * (Math.PI / 180);
    const yaw = dir * (2.2 + 1.2 * k) * (Math.PI / 180);
    const roll = -dir * 0.8 * (Math.PI / 180);
    this.cam.look(lerp(this.aimX + dir * 10 * k, fx, a), lerp(this.aimY - 12 * k, fy, a), dist, tilt, yaw, roll).zoomBy(1 + (has ? 0.3 : 0.36) * k);
  }

  private drawLabels(t: number) {
    const L = this.txt, c = L.ctx;
    // 第一條：主字（逐字寫，署名寫完才出現），沒有主字時是歌詞
    if (this.cap.draw(c, t, PAD, PAD + (this.album ? ALBUM_H : 0), {
      chars: this.cap.charsAt(t, this.tW0, this.tW1),
      clear: () => {
        L.clear();
        if (this.album) {
          c.font = font(F.hand(700), 24);
          c.letterSpacing = '4px';
          c.fillStyle = rgba('sepia', 0.6);
          c.fillText(this.album, PAD, PAD + 22);
          c.letterSpacing = '0px';
        }
      },
    })) L.upload();
    // 第二條：歌詞
    if (this.apart) {
      const M = this.lyr;
      if (this.cap.drawLyrics(M.ctx, t, PAD, PAD2, { clear: () => M.clear() })) M.upload();
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end, lt = t - s;
    const u = this.bg.u;
    u.photoGain!.value = gainOf(this.ph.ref);
    // 鏡頭：開燈時從高一點、遠一點的地方落定（第一拍內），之後一開始快、越來越慢地往相紙上的焦點推
    const land = ease.outCubic(prog(t, s, s + 0.9));
    const fk = settleK(lt, 7);
    const dir = hash(this.seed, 2) < 0.5 ? -1 : 1;
    const has = this.cap.has;
    const k = safePush(fk, (kk) => { this.placeCam(land, kk, lt, dir); return !has || inSafe(this.colRect()); });
    this.cam.apply(u);
    u.focusZ!.value = this.cam.project(0, 0, 0).z;

    // 相紙：稍微斜放，小節線上被浪推一下再漂回來
    const bar = audio.barAt(t);
    const tBar = audio.timeOfBar(Math.floor(bar));
    const since = Math.max(0, t - Math.max(tBar, s));
    const nud = Math.exp(-since / 0.7) * Math.sin(since * 7.5) * (t > s + 0.2 ? 1 : 0);
    const ang = this.paperAng + 0.006 * nud;
    (u.paperC!.value as THREE.Vector2).set(dir * 8 * ease.inOutQuad(clamp(lt / 9)) + 5 * nud, -4 * nud);
    (u.paperHalf!.value as THREE.Vector2).set(this.hw + this.border, this.hh + this.border);
    (u.photoHalf!.value as THREE.Vector2).set(this.hw, this.hh);
    u.paperAng!.value = ang;
    (u.trayHalf!.value as THREE.Vector2).copy(this.tray);
    u.rim!.value = this.rim;
    u.photo!.value = this.ph.tex;
    // 相紙上的畫面往焦點小推（很小的照片少推）
    (u.crop!.value as THREE.Vector4).set(...focusCrop(this.ph.ref, this.ph.w, this.ph.h, this.ph.aspect, fk, { zoom: 1.12, screenW: 2 * this.hw }));
    // mip：照片的像素 ÷ 對焦處的畫面 px（shader 再照深度、裁切加）
    u.lod!.value = mipFor(this.ph.w, 2 * this.hw * (1 + 0.36 * k));
    // 浪：上一個小節線（窗格開始前的不算）
    const rockSince = t - Math.max(tBar, s - 10);
    const rockDir = Math.floor(bar) % 2 === 0 ? 1 : -1;
    (u.rock!.value as THREE.Vector4).set(-rockDir * (this.tray.x + 200), rockSince, tBar >= s - 0.01 ? 2.6 : 0.8, rockDir);
    // 水滴：每兩拍一滴，位置用拍號當種子
    const bi = Math.floor(audio.beatAt(t) / 2);
    for (let i = 0; i < 2; i++) {
      const n = bi - i;
      const tn = audio.timeOfBeat(n * 2);
      const dt = t - tn;
      const on = tn >= s - 0.01 && dt >= 0 ? 2.2 : 0;
      (u[i === 0 ? 'drop0' : 'drop1']!.value as THREE.Vector4).set((hash(n, 11) - 0.5) * this.tray.x * 1.5, (hash(n, 12) - 0.5) * this.tray.y * 1.4, Math.max(0, dt), on);
    }
    // 顯影、顏色、開燈
    const dev = prog(t, this.tDev, this.tDev + this.devDur, ease.outCubic);
    u.dev!.value = dev;
    u.tint!.value = prog(t, this.tDev + this.devDur * 0.45, this.tDev + this.devDur * 1.1, ease.inOutQuad);
    u.redness!.value = lerp(0.9, 0.32, prog(t, this.tLight, this.tLight + 1.4, ease.inOutCubic));
    u.t!.value = t;
    // 安全燈：放在「液面右上那一塊的鏡射方向」上，反光才一定落在藥水上（浪一來就扭動）
    const ax = this.tray.x * 0.5, ay = -this.tray.y * 0.62;
    const cp = this.cam.pos;
    const vx = ax - cp.x, vy = ay - cp.y, vz = -cp.z, vl = Math.hypot(vx, vy, vz);
    (u.lampPos!.value as THREE.Vector3).set(ax + (vx / vl) * 2600, ay + (vy / vl) * 2600, (-vz / vl) * 2600);
    (u.tongC!.value as THREE.Vector2).set(this.tray.x - 70, -this.tray.y + 40);
    u.tongAng!.value = 0.55 + 0.04 * dir;
    (u.lampScr!.value as THREE.Vector2).set(1790, 70);
    // 開燈：很快亮起；最後零點三秒稍微收暗
    u.k!.value = (0.15 + 0.85 * ease.outCubic(prog(t, s, s + 0.35))) * (1 - 0.15 * prog(t, e - 0.3, e));
    // 標籤（歌詞那條晚一點點貼上去）
    u.labelOn!.value = has ? prog(t, s + 0.15, s + 0.5, ease.outCubic) : 0;
    u.lyrOn!.value = this.apart ? prog(t, s + 0.3, s + 0.65, ease.outCubic) : 0;
    if (has) this.drawLabels(t);
    u.txt!.value = this.txt.texture;
    (u.labelC!.value as THREE.Vector2).copy(this.labelC);
    (u.labelHalf!.value as THREE.Vector2).copy(this.labelHalf);
    u.labelAng!.value = this.labelAng;
    (u.txtSize!.value as THREE.Vector2).set(this.txt.w, this.txt.h);
    u.lyr!.value = this.lyr.texture;
    (u.lyrC!.value as THREE.Vector2).copy(this.lyrC);
    (u.lyrHalf!.value as THREE.Vector2).copy(this.lyrHalf);
    u.lyrAng!.value = this.lyrAng;
    (u.lyrSize!.value as THREE.Vector2).set(this.lyr.w, this.lyr.h);
    this.bg.render(renderer, out);
    return { bloom: 0.15, bloomThreshold: 1.1, halation: 0.1, vignette: 0.5 };
  }
}
