// 起霧的窗（暗）：雨夜，室內往外看一扇起霧的玻璃窗，窗外是整片模糊的城市燈光。
//  - 畫面的焦點＝主打留言：有人用手指在霧上把它寫出來（第一個拍點起一個字一個字擦開）。擦開的地方看得到窗外，
//    燈光在那裡是清楚的光斑（鏡頭對焦在玻璃上）；霧上其他地方只剩一片暖暖的糊光。剛擦開的那一小段帶一點訊號色
//    （像窗外的招牌光正好照進來），很快冷掉。字的邊緣有一圈被手指推開的水氣。署名也用手指寫在最後一行下面。
//  - 歌詞（比留言小一級）在窗的右半邊，照跟唱規則逐字亮。
//  - 2026-09-29 留言標準 v2：手指寫的字 40～60 px，寫在窗的左下一塊（≤ 860 × 430）；窗的上半部霧比較薄，
//    看得到窗外的城市燈光與斜斜的雨絲（場景是主視覺）；每兩小節一道車燈從霧上掃過去，水珠更常滑。
//  - 沒有主打留言：歌詞本身用手指寫在霧上（焦點是歌詞），一句寫在上面、下一句寫在下面輪流；
//    還沒唱的字是「霧重新起來時浮出來的舊指痕」（三成淡），唱到的那一刻才擦開；上一句會慢慢被霧蓋回去。
//    下面一行小字邀請。純音樂又沒有留言：霧上寫新人的名字。
//  - 水珠：每一拍有一顆水珠在玻璃上「頓一下、滑一段」（拍點上突然滑、然後停住），滑過的地方留下一道擦乾淨的細痕。
//    每個小節線，窗外有一台車開過去（一對車燈的光在霧裡滑過畫面下方）。
//  - 鏡頭：切進來時對焦在窗外（燈是小點、玻璃是糊的），第一拍前拉焦到玻璃上（燈光變成大光斑）；
//    整個窗格慢慢推近；最後半拍焦點又退回窗外。
// 手法：窗外的燈、霧、水珠、窗框全在一個 shader；留言與歌詞的「指痕」在 init() 各畫一次成字模（模糊過的遮罩），
// shader 取樣遮罩、依每一排「寫到哪」決定擦開多少；窗下緣的歌詞與小字是一張 Canvas2D。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, layout, loadText } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, drawLyric, beatAfter, heartPoints, COUPLE_ZH, type LyricStyle } from './_motifs';
import { msgMaxFor, lyricV2, sigV2, fitClauses, V2 } from './_v2';
import { T16_INVITE, T16_TEXT, sigOf, winBeats, winBars, rowsOf, glyphCount, charClock, rowFront, type Row } from './_t16';

export const spec: PlateSpecDecl = { group: 'type', family: 'nature', paper: false, energy: [0, 0.75], bars: [4, 8] };

/**
 * 留言寫在左下這一塊（留言標準 v2：字 40～60 px、這一塊 ≤ 860 × 430、放在畫面一側或下方三分之一）；下面留署名。
 * 窗的上半部霧比較薄，看得到窗外糊糊的城市燈光——場景是主視覺。
 */
const MSG = { x: 150, y: 540, w: 820, h: 390 };
/** 手寫稍微往右下斜（整塊繞 PIV 轉 ANG），shader 用同一組數字轉回去判斷「寫到哪」。 */
const ANG = 0.02;
const PIV = { x: MSG.x + MSG.w / 2, y: MSG.y + MSG.h / 2 };
/** 有留言時，歌詞在窗的右半邊（跟左下的留言錯開）。 */
const LYR = { x: 1040, y: 600, w: 760 };
/** 沒有留言：歌詞寫在霧上（左下），上下兩個位置輪流。 */
const POS = [{ x: 150, y: 560, w: 1150, h: 150 }, { x: 150, y: 726, w: 1150, h: 150 }];
/** 遮罩的解析度：字變小了（40～60 px），要全解析度，指痕的邊才不會糊成一團。 */
const MS = 1;
const FAM_MSG = F.hand(400);
const FAM_LYR = F.archivo(100, 700);
const PER = 0.085; // 手指寫一個字幾秒
const NDROP = 12;
/** 沒有留言時，下一句歌詞的舊指痕提早幾秒浮出來。 */
const LEAD = 1.5;
/** 遮罩的「通道」（不是畫面上的顏色）：白 = 字、紅 = 愛心，shader 用 g 與 r - g 分開。 */
const MASK_TEXT = 'rgb(255,255,255)', MASK_HEART = 'rgb(255,0,0)';

const BG = () => new FSPass(/* glsl */ `
  uniform float t, focus, drift, kin;
  uniform sampler2D msk; uniform sampler2D atl;
  uniform vec4 mrow[8]; uniform vec2 mfr[8]; uniform float nrow;
  uniform vec2 piv; uniform float ang;
  uniform vec4 lposA; uniform vec4 lposB;
  uniform vec4 lcur; uniform vec4 lprev; uniform vec3 lfr; uniform float nslot;
  uniform vec4 drops[${NDROP}]; uniform float ndrop;
  uniform vec4 car;
  uniform vec2 sweep; // 車燈掃過霧的光：x 位置、亮度
  uniform vec4 sign; // 窗外對街的招牌光（中心 x, y、半寬、半高）：剛好在手寫字的後面，擦開的字透出暖光
  uniform float signK;

  // 窗外的燈：大多是暖的（訊號色一家子），一些白燈、少數灰的，很少一盞玫瑰色
  vec3 lcol(float h) {
    return h < 0.36 ? C_SIGNAL : h < 0.58 ? C_EMBER : h < 0.84 ? C_BONE * 0.75 : h < 0.96 ? C_ASH * 0.55 : C_ROSE * 0.8;
  }
  // 一層城市的燈（對焦在玻璃上看到的光斑：清楚的圓盤；焦點在遠方時是一顆小亮點）。只有擦開的地方看得到
  vec3 lights(vec2 p, float S, float seed, float dens, float gain) {
    vec3 sh = vec3(0.0);
    vec2 id0 = floor(p / S);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 id = id0 + vec2(float(i), float(j));
      float yy = (id.y + 0.5) * S;
      // 越往下燈越多（街道、樓的窗），最上面稀稀落落
      float d0 = dens * (0.12 + 0.88 * smoothstep(260.0, 760.0, yy));
      float h = hash12(id + seed);
      // 沒有燈的格子：亮度乘 0（不用 continue：ANGLE 在迴圈裡的 continue 偶爾會算錯）
      float on = step(h, d0);
      vec2 c = (id + 0.22 + 0.56 * hash22(id * 1.7 + seed)) * S;
      float h2 = hash12(id + seed + 7.1);
      float R = S * (0.1 + 0.17 * h2);
      float rr = mix(2.2, R, focus);
      float b = (0.12 + 0.4 * hash12(id + seed + 3.3)) * gain * on;
      b *= 0.88 + 0.12 * sin(t * (0.5 + h2) + h * 40.0);
      vec3 lc = lcol(hash12(id + seed + 9.9)) * b;
      float dd = length(p - c);
      float disc = 1.0 - smoothstep(rr - 1.3, rr + 1.3, dd);
      float rim = smoothstep(rr - 6.0, rr - 0.5, dd) * disc;
      sh += lc * disc * (0.78 + 0.4 * rim) * mix(2.6, 1.0, focus);
    }
    return sh;
  }
  // 隔著霧看到的城市：一團一團很大、很糊的色光（跟光斑同一片城市，但只剩顏色與明暗）
  vec3 blobs(vec2 p) {
    vec3 so = vec3(0.0);
    const float S = 330.0;
    vec2 id0 = floor(p / S);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 id = id0 + vec2(float(i), float(j));
      vec2 c = (id + 0.25 + 0.5 * hash22(id * 3.1 + 5.0)) * S;
      float yy = c.y;
      float b = (0.25 + 0.75 * hash12(id + 2.2)) * (0.3 + 0.7 * smoothstep(100.0, 800.0, yy));
      vec3 col = lcol(hash12(id + 4.4) * 0.9);
      float d = length(p - c), sg = 105.0;
      so += col * b * exp(-d * d / (2.0 * sg * sg));
    }
    return so;
  }
  vec2 maskAt(vec2 p) {
    vec4 m = texture(msk, vec2(p.x / ${W}.0, 1.0 - p.y / ${H}.0));
    // 白色 = 字、紅色 = 愛心（預乘的 sRGB：白 (a,a,a)、紅 (a,0,0)）
    return vec2(m.g, max(0.0, m.r - m.g));
  }
  float atlasAt(vec2 p, vec4 pos, float slot) {
    vec2 l = p - pos.xy;
    if (slot < 0.0 || l.x < 0.0 || l.y < 0.0 || l.x > pos.z || l.y > pos.w) return 0.0;
    return texture(atl, vec2(l.x / pos.z, 1.0 - (slot * pos.w + l.y) / (nslot * pos.w))).a;
  }
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y); // y 向下，跟 Canvas2D 一樣
    // ---- 窗外
    // 夜空與遠方的城市：不是全黑（擦開的字裡看得到一點遠方的暗光），越往下越亮
    vec3 sky = mix(C_GRAPHITE * 0.035, C_GRAPHITE * 0.07 + C_SIGNAL * 0.012, smoothstep(0.0, 1080.0, p.y)) * (0.8 + 0.3 * fbm(p / 500.0 + 3.0, 2));
    vec3 sh = lights(p + vec2(drift, 0.0), 150.0, 1.3, 0.5, 1.0) + lights(p + vec2(drift * 0.45 + 37.0, 11.0), 92.0, 7.7, 0.42, 0.55);
    vec3 so = blobs(p + vec2(drift * 0.3, 0.0));
    {
      vec2 sd0 = (p - sign.xy) / (sign.zw * 1.6);
      so += (C_SIGNAL * 0.16 + C_EMBER * 0.05) * exp(-dot(sd0, sd0)) * signK;
    }
    // 開過去的車：一對車燈（car.x = 前燈的 x、car.y = 亮度、car.z = 白燈 1／尾燈 0）
    if (car.y > 0.0) {
      vec3 cc = mix(C_BLOOD * 1.4 + C_SIGNAL * 0.3, C_BONE, car.z) * car.y;
      for (int k = 0; k < 2; k++) {
        vec2 c = vec2(car.x + float(k) * 150.0, 948.0);
        float d = length(p - c), r = mix(3.0, 34.0, focus);
        sh += cc * (1.0 - smoothstep(r - 1.3, r + 1.3, d)) * mix(2.4, 1.0, focus);
        so += cc * exp(-d * d / (2.0 * 90.0 * 90.0)) * 0.9;
      }
    }
    // 窗外的雨：斜斜的細雨絲，被城市的糊光照亮（只在霧薄的上半部與擦開的地方看得到）
    vec2 rq = vec2(p.x + p.y * 0.2, p.y + t * 1500.0);
    float rc = floor(rq.x / 7.0), rs = rq.y / 230.0 + hash11(rc * 0.37);
    float streak = step(0.93, hash11(rc * 1.7 + floor(rs) * 0.13)) * smoothstep(0.0, 0.08, fract(rs)) * (1.0 - smoothstep(0.22, 0.3, fract(rs)))
      * (1.0 - smoothstep(0.3, 1.0, abs(fract(rq.x / 7.0) - 0.5) * 7.0));
    // 對街的招牌：一大片暖暖的糊光，剛好在手寫字的後面（字是擦開的地方，所以字是亮的、霧是灰的，比暗字好讀）
    vec2 sd = (p - sign.xy) / sign.zw;
    float sg = exp(-dot(sd, sd) * 1.2) * signK * (0.92 + 0.08 * sin(t * 1.3));
    vec3 signC = (C_SIGNAL * 0.62 + C_EMBER * 0.3) * sg;
    vec3 view = sky + sh + signC + (so * 0.9 + C_BONE * 0.018) * streak;

    // ---- 霧：隔著霧只看得到糊光，下緣（街道那邊）暖一點
    // 霧本身被室內與城市照亮：整片均勻的乳灰（字才讀得清楚），上面比較冷、下面比較暖
    float n = fbm(p / 320.0 + vec2(t * 0.012, 0.0), 3);
    vec3 glow = (so * 0.095 + (C_ASH * 0.042 + C_SIGNAL * 0.006) + C_SIGNAL * 0.016 * smoothstep(300.0, 1050.0, p.y)) * (0.85 + 0.25 * n);
    // 霧：下半部（手寫字那一帶）很厚、不透光，字才清楚；上半部薄，看得到窗外糊糊的燈光與雨絲（場景）
    float dens = kin * mix(0.5, 1.0, smoothstep(140.0, 560.0, p.y + 60.0 * n));

    // 霧裡細細的水氣顆粒
    float spk = step(0.992, hash12(floor(p / 2.5))) * 0.5 + 0.5 * step(0.975, hash12(floor(p / 5.0) + 3.1)) * 0.3;
    vec3 fogCol = glow + C_BONE * 0.012 * spk;
    // 每兩小節一道車燈從霧上斜斜地掃過去（霧把光散開）
    fogCol += (C_BONE * 0.035 + C_SIGNAL * 0.03) * sweep.y * exp(-pow((p.x - sweep.x + (p.y - 540.0) * 0.45) / 170.0, 2.0));

    // ---- 手指擦開的字：轉回「字的座標」判斷這一排寫到哪
    vec2 q = rot2(ang) * (p - piv) + piv;
    vec2 m = maskAt(p);
    float rev = 0.0, heat = 0.0;
    for (int i = 0; i < 8; i++) {
      vec4 rw = mrow[i];
      vec2 fh = mfr[i];
      if (float(i) < nrow && q.y >= rw.y && q.y < rw.w && q.x > rw.x - 60.0 && q.x < rw.z + 60.0) {
        rev = 1.0 - smoothstep(fh.x - 16.0, fh.x + 16.0, q.x);
        heat = fh.y * exp(-max(0.0, fh.x - q.x) / 240.0) * rev;
      }
    }
    // 模糊過的遮罩尾巴很長：切掉最淡的那一截（不然字的周圍一圈都會透出後面的光斑），邊緣留一點軟
    float cm = smoothstep(0.2, 0.7, m.x + m.y) * rev;
    float heart = smoothstep(0.2, 0.7, m.y) * rev;

    // ---- 沒有留言：歌詞寫在霧上（上一句慢慢被霧蓋回去，這一句先浮出舊指痕再擦開）
    float cl = 0.0, lheat = 0.0;
    if (lcur.x >= 0.0) {
      vec4 pc = lcur.y < 0.5 ? lposA : lposB;
      float a = smoothstep(0.2, 0.7, atlasAt(p, pc, lcur.x));
      float ly = p.y - pc.y;
      float fr = ly < lfr.z ? lfr.x : lfr.y;
      float rv = 1.0 - smoothstep(fr - 16.0, fr + 16.0, p.x);
      cl = a * max(rv, 0.3 * lcur.z);
      lheat = lcur.w * exp(-max(0.0, fr - p.x) / 240.0) * rv * a;
    }
    if (lprev.x >= 0.0) {
      vec4 pp = lprev.y < 0.5 ? lposA : lposB;
      float b = smoothstep(0.2, 0.7, atlasAt(p, pp, lprev.x));
      // 霧慢慢蓋回去（字小了，一塊一塊蓋回去會把字切成碎片、像亂碼，改成整句一起淡掉）
      cl = max(cl, b * smoothstep(0.0, 1.0, lprev.z));
    }

    // ---- 水珠滑過的細痕與水珠本身
    float tr = 0.0, bead = 0.0; vec2 bd = vec2(0.0);
    for (int i = 0; i < ${NDROP}; i++) {
      vec4 d = drops[i];
      if (float(i) >= ndrop) d = vec4(-999.0, -999.0, -998.0, 1.0);
      float wob = sin(p.y * 0.027 + d.x) * 2.0 + sin(p.y * 0.009 + d.x * 2.0) * 3.0;
      float dx = abs(p.x - d.x - wob);
      // 痕越往下（越新）越寬，寬度沿路有一點不均（水不是一條管子）
      float w = d.w * (0.35 + 0.45 * smoothstep(d.y, d.z, p.y)) * (0.8 + 0.25 * sin(p.y * 0.08 + d.x * 3.0));
      // 痕的上端淡淡的（水珠是從那裡慢慢聚起來的），越往下越乾淨
      // 痕只留在水珠後面一小段：再上面霧又慢慢起來了（整片窗才不會被一條條黑線切開）
      if (p.y > d.y && p.y < d.z) tr = max(tr, (1.0 - smoothstep(w * 0.6, w, dx)) * (0.35 + 0.5 * smoothstep(d.y, d.y + 120.0, p.y)) * smoothstep(d.z - 260.0, d.z - 60.0, p.y));
      float wz = sin(d.z * 0.027 + d.x) * 2.0 + sin(d.z * 0.009 + d.x * 2.0) * 3.0;
      vec2 hd = (p - vec2(d.x + wz, d.z)) / d.w;
      float hl = length(hd * vec2(1.0, 0.82));
      float bk = 1.0 - smoothstep(0.9, 1.05, hl);
      if (bk > bead) { bead = bk; bd = hd; }
    }
    float clear = max(max(cm, cl), tr * 0.95);
    vec3 col = mix(view, fogCol, dens * (1.0 - clear));
    // 剛擦開的那一段：窗外的招牌光正好照進來（訊號色），很快冷掉
    col += C_SIGNAL * 0.2 * (heat * cm + lheat);
    // 手指推開的水氣：字的邊緣一圈亮一點（很細）
    float cc2 = max(cm, cl);
    float e = smoothstep(0.15, 0.5, cc2) * (1.0 - smoothstep(0.5, 0.85, cc2));
    col += (glow * 0.6 + C_BONE * 0.01) * e * kin;
    // 霧上零星的小水珠（擦開的地方沒有）：一點暗邊、一點高光
    vec2 gc = floor(p / 23.0), gf = p - (gc + 0.5) * 23.0 - (hash22(gc + 9.0) - 0.5) * 11.0;
    float gr = 1.2 + 2.6 * hash12(gc + 4.0);
    float gd = length(gf);
    if (hash12(gc + 1.7) < 0.22 && gd < gr + 1.0) {
      float gk = (1.0 - smoothstep(gr - 0.8, gr + 0.6, gd)) * (1.0 - clear) * kin;
      vec3 gcol = glow * (0.6 + 1.1 * smoothstep(-gr, gr, gf.y)) + C_BONE * 0.05 * exp(-dot(gf + gr * 0.35, gf + gr * 0.35) / (gr * 0.3 + 0.2));
      col = mix(col, gcol, gk);
    }
    // 手指畫的愛心：擦開的地方透出點綴色
    col = mix(col, col * 0.4 + C_ROSE * 0.3, clamp(heart * 1.2, 0.0, 1.0) * 0.85);
    // 水珠：像一顆小透鏡（上面暗邊、下面亮邊、一點高光）
    if (bead > 0.0) {
      vec3 bc = glow * 1.6 + C_BONE * 0.02;
      bc *= 0.55 + 0.9 * smoothstep(-0.6, 0.9, bd.y);
      bc += C_BONE * 0.35 * exp(-dot(bd - vec2(-0.3, -0.35), bd - vec2(-0.3, -0.35)) * 40.0);
      col = mix(col, bc, bead * kin);
    }

    // ---- 窗框（四邊的深色木框，內緣一條細高光；下面的窗台接到一點街上的暖光）
    float fl = p.x - 46.0, fr2 = 1874.0 - p.x, ft = p.y - 30.0, fb = 1010.0 - p.y;
    float fd = min(min(fl, fr2), min(ft, fb));
    if (fd < 0.0) {
      float wood = 0.75 + 0.25 * snoise(vec2(p.x * 0.004, p.y * 0.08)) ;
      vec3 fc = C_INK2 * 0.7 * wood;
      if (fb < 0.0) fc += C_SIGNAL * 0.02 * exp(fb / 30.0) + C_ASH * 0.02 * exp(fb / 6.0);
      fc += C_BONE * 0.05 * exp(fd / 1.5);
      col = fc;
    } else {
      col *= 1.0 - 0.35 * exp(-fd / 26.0); // 框邊的玻璃暗一點
    }
    fragColor = vec4(col, 1.0);
  }`, {
  t: { value: 0 }, focus: { value: 1 }, drift: { value: 0 }, kin: { value: 1 },
  msk: { value: null }, atl: { value: null },
  mrow: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, mfr: { value: Array.from({ length: 8 }, () => new THREE.Vector2()) }, nrow: { value: 0 },
  piv: { value: new THREE.Vector2(PIV.x, PIV.y) }, ang: { value: ANG },
  lposA: { value: new THREE.Vector4(POS[0]!.x, POS[0]!.y, POS[0]!.w, POS[0]!.h) }, lposB: { value: new THREE.Vector4(POS[1]!.x, POS[1]!.y, POS[1]!.w, POS[1]!.h) },
  lcur: { value: new THREE.Vector4(-1, 0, 0, 0) }, lprev: { value: new THREE.Vector4(-1, 0, 0, 0) }, lfr: { value: new THREE.Vector3() }, nslot: { value: 1 },
  drops: { value: Array.from({ length: NDROP }, () => new THREE.Vector4()) }, ndrop: { value: 0 },
  car: { value: new THREE.Vector4() }, sweep: { value: new THREE.Vector2(-9999, 0) },
  sign: { value: new THREE.Vector4(560, 735, 520, 230) }, signK: { value: 0 },
});

/** 一顆水珠：出現的時間與位置，之後每一拍滑一段（或不動）。 */
interface Drop { t0: number; x: number; y0: number; r: number; steps: { t: number; d: number }[]; old: boolean; ymax: number }
/** 沒有留言時，寫在霧上的一句歌詞（每句排一次，指痕畫進圖集的第 slot 格）。 */
interface FogLine { line: Line; slot: number; pos: number; fit: FitResult; glyphs: { x: number; w: number; row: number; off: number; len: number }[]; rowW: number[] }

export default class FogWindow extends Scene {
  bg = shared('fogwindow.bg', BG);
  /** 留言的指痕（白＝字、紅＝愛心），init 畫一次。 */
  mask = this.track(new Layer2D(W, H, MS, { fast: true }));
  /** 窗下緣的歌詞與小字，每格重畫。 */
  text = this.track(new Layer2D(W, H, undefined, { fast: true }));
  atlas: Layer2D | null = null;
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 7919) >>> 0;
  rows: Row[] = [];
  rowStep: number[] = [];
  fit: FitResult | null = null;
  clock: (i: number) => number = () => 0;
  step = PER;
  /** 每一排的「字的座標」範圍（y0, y1）。 */
  bands: [number, number][] = [];
  /** 每一排寫完的時間（熱度從那時開始冷卻）。 */
  rowEnd: number[] = [];
  tWrite = 0;
  hasLyrics = false;
  fogLyrics = false;
  fogLines: FogLine[] = [];
  drops: Drop[] = [];
  bars: number[] = [];
  lyrStyle: LyricStyle = { family: FAM_LYR, size: 56, minSize: 48, maxWidth: LYR.w };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const lines = lyrics.linesIn(s - 1.5, e + 0.5);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.fogLyrics = !m && this.hasLyrics;
    const sig = m ? sigOf(m) : '';
    await loadText(`${T16_TEXT}${m?.text ?? ''}${sig}${lines.map((l) => l.text).join('')}${song.title}${song.artist}${COUPLE_ZH}`);
    const beat = au.beatPeriod(s);
    this.tWrite = beatAfter(au, s + Math.min(0.2, beat * 0.4));
    this.bars = winBars(au, s, e);

    // ---- 霧上寫的字：留言，或（沒有留言也沒有歌詞時）新人的名字
    const fogText = m ? m.text : this.hasLyrics ? '' : `${COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ')}`;
    if (fogText) {
      const c = this.mask.ctx;
      // 字級上限依字數（v2），照標點斷行；扣掉署名那一排的高度（署名永遠在最後一行下面）
      const sigRow = m ? 56 : 0;
      const o = { min: V2.msgMin, max: msgMaxFor(fogText), lineHeight: 1.3, maxLines: 6 };
      const fit = fitClauses(c, fogText, FAM_MSG, MSG.w, MSG.h - sigRow, o) ?? fitText(c, fogText, FAM_MSG, MSG.w, MSG.h - sigRow, o);
      this.fit = fit;
      const sigSize = m ? sigV2(fit.size) : 0;
      const blockH = fit.size * 1.05 + (fit.lines.length - 1) * fit.lineHeight + (m ? sigRow : 0);
      const top = MSG.y + Math.max(0, (MSG.h - blockH) / 2 - 10);
      // 手寫的每一排不會完全對齊：左端各自偏一點
      this.rows = rowsOf(fit, FAM_MSG, MSG.x + 12, top).map((r, i) => ({ ...r, x: r.x + (hash(this.seed, i, 3) - 0.5) * 20 + i * 6 }));
      if (m) {
        const sl = layout(sig, FAM_MSG, sigSize);
        const last = this.rows[this.rows.length - 1]!;
        const right = Math.max(...this.rows.map((r) => r.x + r.width));
        const sx = Math.min(MSG.x + MSG.w - sl.width, Math.max(last.x + 40, right - sl.width + 30));
        const n0 = glyphCount(this.rows);
        this.rows.push({ text: sig, x: sx, y: last.y + fit.size * 0.34 + sigSize * 1.3, width: sl.width, glyphs: sl.glyphs.map((g, k) => ({ ch: g.ch, x: g.x, w: g.w, i: n0 + k })) });
      }
      // 每排的範圍（字的座標 y0～y1）：手寫字的上緣到基線下面一點；相鄰兩排剛好接起來、不重疊
      this.bands = this.rows.map((r, i) => {
        const size = i < fit.lines.length ? fit.size : sigSize;
        return [r.y - size * 1.02, r.y + size * 0.3];
      });
      // 時間：第一拍開始寫，字多就寫快一點（最多兩小節或窗格的四成）；署名停半拍再寫
      const n = glyphCount(this.rows) - (m ? this.rows[this.rows.length - 1]!.glyphs.length : 0);
      const bar = au.timeOfBar(au.barAt(this.tWrite) + 1) - this.tWrite;
      const maxDur = Math.max(0.8, Math.min(2 * bar, 0.4 * (e - this.tWrite)));
      this.step = n <= 1 ? PER * 2 : Math.min(PER, maxDur / n);
      const base = charClock(n, this.tWrite, PER, maxDur);
      const sigAt = this.tWrite + n * this.step + beat * 0.5;
      this.clock = (i: number) => (i < n ? base(i) : sigAt + (i - n) * Math.min(0.07, this.step));
      this.rowEnd = this.rows.map((r) => { const g = r.glyphs[r.glyphs.length - 1]!; return this.clock(g.i) + this.step; });
      // 畫指痕：手指比字的筆畫粗，邊緣糊糊的（模糊只在這裡做一次）
      c.clearRect(0, 0, W, H);
      c.save();
      c.translate(PIV.x, PIV.y); c.rotate(ANG); c.translate(-PIV.x, -PIV.y);
      c.filter = 'blur(1px)';
      c.lineJoin = 'round'; c.lineCap = 'round';
      this.rows.forEach((r, i) => {
        const size = i < fit.lines.length ? fit.size : sigSize;
        c.font = font(FAM_MSG, size);
        c.textBaseline = 'alphabetic';
        for (const g of r.glyphs) {
          const x = r.x + g.x;
          if (g.ch === '♥') { this.fingerHeart(c, x + g.w / 2, r.y - size * 0.36, Math.min(g.w, size) * 0.8, size); continue; }
          c.fillStyle = c.strokeStyle = MASK_TEXT;
          c.lineWidth = size * 0.03;
          c.strokeText(g.ch, x, r.y);
          c.fillText(g.ch, x, r.y);
        }
      });
      c.restore();
      c.filter = 'none';
      this.mask.upload();
    }

    // ---- 沒有留言：每句歌詞各排一次，指痕畫進圖集
    if (this.fogLyrics) {
      const P = POS[0]!;
      const nslot = lines.length;
      const atlas = this.track(new Layer2D(P.w, P.h * nslot, MS, { fast: true }));
      this.atlas = atlas;
      const c = atlas.ctx;
      c.clearRect(0, 0, P.w, P.h * nslot);
      lines.forEach((line, k) => {
        // 沒有留言時歌詞是焦點，但一樣照 v2（≤ 52 px）
        const fit = fitText(c, line.text, FAM_MSG, P.w - 40, P.h - 20, { min: V2.lyrMin, max: lyricV2(null), lineHeight: 1.22, maxLines: 2 });
        const glyphs: FogLine['glyphs'] = [];
        const rowW: number[] = [];
        let cursor = 0;
        fit.lines.forEach((ln, row) => {
          const at = line.text.indexOf(ln, cursor), b0 = at >= 0 ? at : cursor;
          cursor = b0 + ln.length;
          let o = b0;
          const lay = layout(ln, FAM_MSG, fit.size);
          rowW.push(lay.width);
          for (const g of lay.glyphs) { glyphs.push({ x: g.x, w: g.w, row, off: o, len: g.ch.length }); o += g.ch.length; }
        });
        const fl: FogLine = { line, slot: k, pos: line.i % 2, fit, glyphs, rowW };
        this.fogLines.push(fl);
        const y0 = k * P.h + (P.h - fit.height) / 2 + fit.size * 0.9;
        c.save();
        c.filter = 'blur(1px)';
        c.lineJoin = 'round';
        c.font = font(FAM_MSG, fit.size);
        c.fillStyle = c.strokeStyle = MASK_TEXT;
        c.lineWidth = fit.size * 0.03;
        fit.lines.forEach((ln, row) => { c.strokeText(ln, 16, y0 + row * fit.lineHeight); c.fillText(ln, 16, y0 + row * fit.lineHeight); });
        c.restore();
      });
      c.filter = 'none';
      atlas.upload();
      this.bg.u.nslot!.value = nslot;
    }

    // ---- 水珠：窗格開始時已經有幾道舊的痕；之後每一拍（七成的拍）一顆新的，之後每拍頓一下、滑一段。
    // 字的範圍裡的水珠只從字的下面開始滑（滑過字的痕會把字連在一起，讀起來很亂）
    const tb0 = this.textBox();
    const place = (r: number, r2: number, ry: number) => {
      // 大多在右半邊與上半部（字在左下），少數在左邊的窗框旁
      const x = r2 < 0.75 ? 1000 + r * 820 : 70 + r * 900;
      const inText = x > tb0.x0 - 20 && x < tb0.x1 + 20;
      // 字的上方的水珠滑到字的上緣就停住（積在那裡），不會滑過字
      const y0 = inText ? Math.min(50 + ry * 300, tb0.y0 - 200) : 50 + ry * 560;
      return { x, y0: Math.min(y0, 960), ymax: inText ? tb0.y0 - 12 : 1040 };
    };
    const rnd = (k: number, j: number) => hash(this.seed, k, j);
    const drops: Drop[] = [];
    for (let k = 0; k < 3; k++) {
      const pl = place(rnd(k, 2), rnd(k, 9) * 0.6, rnd(k, 1) * 0.7);
      drops.push({ t0: s - 10, x: pl.x, y0: pl.y0, r: 6 + rnd(k, 3) * 3, steps: [{ t: s - 9, d: 120 + rnd(k, 4) * 300 }], old: true, ymax: pl.ymax });
    }
    winBeats(au, this.tWrite, e).forEach((tb, k) => {
      if (rnd(k, 11) > 0.5) return;
      const pl = place(rnd(k, 12), rnd(k, 19), rnd(k, 13));
      const d: Drop = { t0: tb - 0.05, x: pl.x, y0: pl.y0, r: 5.5 + rnd(k, 14) * 4, steps: [], old: false, ymax: pl.ymax };
      // 之後每一拍：六成的機率滑一段（越滑越快），不然頓在那裡
      let acc = 0;
      for (let j = 1; j < 24; j++) {
        const tj = au.timeOfBeat(au.beatAt(tb) + j);
        if (tj > e) break;
        if (rnd(k * 31 + j, 15) < 0.6) { const dd = (40 + rnd(k * 31 + j, 16) * 130) * (1 + acc * 0.25); d.steps.push({ t: tj, d: dd }); acc++; }
      }
      // 出現的那一拍先滑一小段
      d.steps.unshift({ t: tb, d: 30 + rnd(k, 17) * 60 });
      drops.push(d);
    });
    this.drops = drops;

    if (m) this.lyrStyle = { family: FAM_LYR, size: lyricV2(this.fit?.size ?? null), minSize: V2.lyrMin, maxWidth: LYR.w };
  }

  /** 霧上寫字的範圍（畫面座標，大約）：水珠不從這裡面開始滑。 */
  private textBox() {
    if (this.rows.length) {
      const x0 = Math.min(...this.rows.map((r) => r.x)), x1 = Math.max(...this.rows.map((r) => r.x + r.width));
      return { x0, x1, y0: this.bands[0]![0] - 20, y1: this.bands[this.bands.length - 1]![1] + 20 };
    }
    if (this.fogLyrics) return { x0: POS[0]!.x, x1: POS[0]!.x + POS[0]!.w, y0: POS[0]!.y, y1: POS[1]!.y + POS[1]!.h };
    return { x0: -1, x1: -1, y0: 2000, y1: 0 };
  }

  /** 手指畫的愛心：沿著愛心的外框描一圈（紅色，shader 認得出來、透出點綴色）。 */
  private fingerHeart(c: CanvasRenderingContext2D, x: number, y: number, size: number, fs: number) {
    const pts = heartPoints(48), s2 = size / 2;
    c.save();
    c.strokeStyle = MASK_HEART;
    c.lineWidth = fs * 0.13;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(x + p.x * s2, y + p.y * s2) : c.moveTo(x + p.x * s2, y + p.y * s2)));
    c.closePath();
    c.stroke();
    c.restore();
  }

  /** 水珠在 t 的位置（頭的 y）。 */
  private dropY(d: Drop, t: number) {
    let y = d.y0;
    for (const st of d.steps) {
      if (t <= st.t) break;
      y += st.d * ease.outCubic(clamp((t - st.t) / 0.26));
    }
    return Math.min(y, d.ymax);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    const u = this.bg.u;
    // 拉焦：切進來時對焦在窗外，第一拍前拉到玻璃上；最後半拍退回窗外
    const beat = au.beatPeriod(s);
    const fin = ease.outCubic(prog(t, s, Math.max(s + 0.3, this.tWrite + 0.1)));
    const fout = ease.inCubic(prog(t, e - Math.min(0.5, beat), e));
    u.t!.value = t;
    u.focus!.value = 0.15 + 0.85 * fin - 0.6 * fout;
    u.drift!.value = -(t - s) * 5;
    u.kin!.value = prog(t, s, s + 0.15);
    // 招牌光罩住整塊手寫字（沒有字就關掉）
    const tb = this.textBox();
    if (tb.x0 >= 0) {
      (u.sign!.value as THREE.Vector4).set((tb.x0 + tb.x1) / 2, (tb.y0 + tb.y1) / 2, Math.max(260, (tb.x1 - tb.x0) * 0.62), Math.max(150, (tb.y1 - tb.y0) * 0.7));
      u.signK!.value = 1;
    } else u.signK!.value = 0;

    // ---- 留言的每一排寫到哪
    const mrow = u.mrow!.value as THREE.Vector4[], mfr = u.mfr!.value as THREE.Vector2[];
    u.nrow!.value = Math.min(8, this.rows.length);
    // 共用的 pass：兩張貼圖每格都要設成自己的（上一個窗格的貼圖可能已經釋放了）
    u.msk!.value = this.mask.texture;
    u.atl!.value = this.atlas?.texture ?? this.mask.texture;
    this.rows.slice(0, 8).forEach((r, i) => {
      const [y0, y1] = this.bands[i]!;
      mrow[i]!.set(r.x - 30, y0, r.x + r.width + 30, y1);
      const front = r.x + rowFront(r, t, this.clock, this.step);
      const writing = t >= this.clock(r.glyphs[0]!.i) && t < this.rowEnd[i]!;
      const heat = writing ? 1 : t >= this.rowEnd[i]! ? Math.exp(-(t - this.rowEnd[i]!) / 0.5) : 0;
      mfr[i]!.set(front, heat);
    });

    // ---- 沒有留言：霧上的歌詞
    const lc = u.lcur!.value as THREE.Vector4, lp = u.lprev!.value as THREE.Vector4, lf = u.lfr!.value as THREE.Vector3;
    lc.set(-1, 0, 0, 0); lp.set(-1, 0, 0, 0);
    if (this.fogLyrics && this.atlas) {
      // 這一句：正在唱的，或 1.5 秒內要唱的（舊指痕先慢慢浮出來）；上一句：慢慢被霧蓋回去（句子之間的空檔蓋得比較慢）
      const next = lyrics.nextLine(t);
      const curLine = lyrics.lineAt(t) ?? (next && next.start - t <= LEAD ? next : null);
      const cur = curLine ? this.fogLines.find((x) => x.line === curLine) : undefined;
      if (cur) {
        const P = POS[cur.pos]!;
        const y0 = (P.h - cur.fit.height) / 2 + cur.fit.size * 0.9;
        const split = y0 + cur.fit.lineHeight * 0.5 - cur.fit.size * 0.3;
        const now = Lyrics.lineCharProgress(cur.line, t);
        const fr = [0, 1].map((row) => {
          let x = -40;
          for (const g of cur.glyphs) {
            if (g.row !== row) continue;
            if (now >= g.off + g.len) { x = g.x + g.w; continue; }
            if (now > g.off) x = g.x + (g.w * (now - g.off)) / g.len;
            break;
          }
          // 整排寫完：前緣推到很遠（全擦開、熱度只留在正在寫的那一排）
          const done = cur.glyphs.filter((g) => g.row === row).every((g) => now >= g.off + g.len);
          return P.x + 16 + (done ? 4000 : x);
        });
        const kIn = prog(t, cur.line.start - LEAD, cur.line.start - 0.1);
        const singing = t >= cur.line.start && t < cur.line.end;
        lc.set(cur.slot, cur.pos, kIn, singing ? 1 : 0);
        lf.set(fr[0]!, fr[1]!, split);
      }
      const lastLine = cur ? lyrics.lines[cur.line.i - 1] : lyrics.lastLine(t);
      const prev = lastLine ? this.fogLines.find((x) => x.line === lastLine) : undefined;
      if (prev) {
        const sw = cur ? Math.max(prev.line.end, cur.line.start - LEAD) : prev.line.end + 0.4;
        const k = 1 - clamp((t - sw) / (cur ? 2.6 : 5));
        if (k > 0) lp.set(prev.slot, prev.pos, k, 0);
      }
    }

    // ---- 水珠（最近的 NDROP 顆）
    const dv = u.drops!.value as THREE.Vector4[];
    const live = this.drops.filter((d) => t >= d.t0);
    const pick = live.slice(Math.max(0, live.length - NDROP));
    pick.forEach((d, i) => {
      const grow = d.old ? 1 : ease.outBack(clamp((t - d.t0) / 0.18));
      const yh = this.dropY(d, t);
      dv[i]!.set(d.x, d.y0, yh, d.r * grow);
    });
    u.ndrop!.value = pick.length;

    // ---- 每個小節線一台車開過去（白色車頭燈、紅色車尾燈輪流）
    const cv = u.car!.value as THREE.Vector4;
    cv.set(0, 0, 0, 0);
    for (let i = 0; i < this.bars.length; i++) {
      const b0 = this.bars[i]!, b1 = this.bars[i + 1] ?? e;
      if (t < b0 || t >= b1) continue;
      const k = (t - b0) / Math.max(0.3, b1 - b0);
      const dir = (i + (this.seed & 1)) % 2 === 0 ? 1 : -1;
      const x = dir > 0 ? -320 + 2400 * ease.inOutCubic(k) : 2080 - 2400 * ease.inOutCubic(k);
      cv.set(x, Math.sin(Math.PI * k) * 0.9, dir > 0 ? 1 : 0, 0);
    }
    // ---- 每兩小節（第二、四…個小節線）一道轉彎車的車燈從霧上掃過去：小節線上亮起、一小節內掃完
    const sw = u.sweep!.value as THREE.Vector2;
    sw.set(-9999, 0);
    for (let i = 1; i < this.bars.length; i += 2) {
      const b0 = this.bars[i]!, b1 = this.bars[i + 1] ?? e;
      if (t < b0 || t >= b1) continue;
      const k = (t - b0) / Math.max(0.3, b1 - b0);
      const dir = ((i - 1) / 2 + (this.seed >> 1)) % 2 === 0 ? 1 : -1;
      const x = dir > 0 ? -300 + 2600 * ease.inOutCubic(k) : 2200 - 2600 * ease.inOutCubic(k);
      sw.set(x, Math.sin(Math.PI * k) ** 0.7);
    }
    this.bg.render(renderer, out);

    // ---- 窗下緣：歌詞（有留言時）、小字
    const L = this.text; L.clear();
    const c = L.ctx;
    const kin = prog(t, s, s + 0.3) * (1 - fout * 0.6);
    c.globalAlpha = kin;
    let drew = false;
    if (this.msg && this.hasLyrics) {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        c.save(); c.translate(LYR.x, LYR.y);
        drawLyric(c, ly.line, t, this.lyrStyle, layoutLyric(c, ly.line, this.lyrStyle), ly.k);
        c.restore();
        drew = true;
      }
    } else if (this.msg && !this.hasLyrics) {
      c.font = font(F.mono(500), 18); c.letterSpacing = '4px'; c.fillStyle = rgba('ash', 0.6);
      c.fillText(`♪  ${this.ctx.song.title}${this.ctx.song.artist ? '  ·  ' + this.ctx.song.artist : ''}`, LYR.x, LYR.y);
      c.letterSpacing = '0px';
      drew = true;
    } else if (!this.msg) {
      // 邀請：一行小字（寫完第一句之後才出現）
      const ik = prog(t, this.tWrite + beat, this.tWrite + beat + 0.6);
      if (ik > 0) {
        c.font = font(F.hei(500), 22); c.letterSpacing = '3px'; c.fillStyle = rgba('bone', 0.55 * ik);
        c.fillText(T16_INVITE, POS[0]!.x + 12, POS[1]!.y + POS[1]!.h + 40);
        c.letterSpacing = '0px';
        drew = true;
      }
    }
    if (drew) comp.draw(renderer, L.upload(), out);
    return { bloom: 0.6, vignette: 0.55, halation: 0.22, zoom: 1 + 0.035 * ease.inOutQuad(f.p) };
  }
}
