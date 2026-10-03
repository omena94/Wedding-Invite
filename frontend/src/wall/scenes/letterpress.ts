// 活版印刷（亮）：一台小印刷機的版台，一個連續的鏡頭。
// 依「留言尺寸與版面比例標準 v2」構圖（舊版是「版台特寫 → 硬切到滿版的紙」，紙太大、字太大）：
//  - 場景是主視覺：左邊是鎖在鐵框裡的一版鉛字（反字、金屬、字面凸起，旁邊塞著木頭填料），側光把字面照出立體；
//    墨輥在拍點上從上往下滾過，滾過的字面沾上黑亮的墨；左上角一片圓形的墨盤慢慢轉、每一拍轉一格。
//    壓印之後每一小節墨輥再滾一次（替下一張上墨），畫面一直有事件。
//  - 右邊的木頭送紙台上放著一張小卡片：第一個夠遠的小節線「喀」一聲壓印（壓板的影子先蓋下來、畫面閃一下、震一下），
//    卡片上就印出留言（思源宋體，40～60 px，照 _v2）：字陷進紙裡、墨色有一點不均、字緣墨比較濃；署名用第二色（紅墨）、
//    愛心是玫瑰色墨。卡片只比字大一點（最寬 860）。壓印的同時鏡頭往右移到卡片、版台的鉛字失焦（焦點轉移）。
//  - 歌詞壓在前面一條長紙條上（40～52 px，比留言小）：還沒唱是沒上墨的空壓痕、唱到的字是紅墨、唱完是深咖啡墨。
//  - 沒有留言：卡片上印新人的名字（60 px）與一行小小的邀請，歌詞在紙條上當焦點（52 px）。
// 手法：一個全螢幕 shader（PlaneCam：版台與送紙台是一張平面）。字在 init() 先畫成一張「高度」貼圖（清楚／模糊 3 px／模糊 9 px 三層＋
// 鉛字的方塊），版上的反字用它算凸字的法線與影子、失焦時改用模糊的那幾層；卡片用它算壓痕的明暗；墨色另外一張彩色貼圖；
// 歌詞是紙面座標的 Canvas 圖層（白色 = 只壓不上墨），每格重畫。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText, layout } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash, pulse, lerp } from '../engine/util';
import { lyricAt, COUPLE_ZH, NAME_A, NAME_B, DATE_DOTS, joinBits, fitPx, heartPoints, lyricSubOf, subSizeFor, subGap } from './_motifs';
import { grid, layoutRows, drawRows, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, msgBlockV2, INVITE, type MsgBlock, type Rect } from './_t14';
import { lyricV2 } from './_v2';

export const spec: PlateSpecDecl = { bilingual: true, group: 'type', family: 'craft', paper: true, energy: [0.2, 0.9], bars: [4, 8], weight: 1 };

/** 版（鐵框）的左上角與卡片的中心 x（布面座標，左右大小依留言決定）。 */
const FORME = { x: 170, y: 230 };
/** 版與卡片之間的距離。 */
const GAP = 150;
const PAD = { x: 50, y: 44 };
const FAM_MSG = F.ming(900);
const FAM_SIG = F.ming(700);
const FAM_LYR = F.archivo(100, 700);
/** 版權頁那一行：還沒定日期就只有「活版印刷 · 名字」。 */
const COLOPHON = joinBits(' · ', '活版印刷', COUPLE_ZH, DATE_DOTS);

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  uniform sampler2D mk; uniform sampler2D ck; uniform sampler2D lyr; uniform float hasMk;
  uniform vec4 mR;      // 字模在「排版座標」的範圍
  uniform vec4 forme;   // 版（鐵框裡面）的範圍 x0, y0, x1, y1
  uniform vec4 card;    // 卡片的範圍 x0, y0, x1, y1
  uniform vec2 cardO;   // 排版座標原點在卡片上的位置
  uniform vec2 formeO;  // 排版座標原點在版上的位置（版是反的：往左長）
  uniform float printed; uniform float shut; uniform float defocus;
  uniform float rollY; uniform float rollOn; uniform float inkY; uniform float t; uniform float discA;
  uniform vec4 strip; uniform vec3 disc;

  vec4 M(vec2 q) { vec2 mu = (q - mR.xy) / mR.zw; return (mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) ? vec4(0.0) : texture(mk, mu); }
  vec4 CK(vec2 q) { vec2 mu = (q - mR.xy) / mR.zw; return (mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0) ? vec4(0.0) : texture(ck, mu); }
  // 紙：棉紙的纖維與一點點起伏
  vec3 paperAt(vec2 P) {
    float fib = 0.5 * snoise(P / vec2(38.0, 9.0)) + 0.35 * snoise(P / vec2(7.0, 21.0)) + 0.25 * snoise(P / 2.6);
    return mix(C_PAPER, C_BONE, 0.35) * (0.975 + 0.012 * fib + 0.015 * snoise(P / 340.0));
  }
  float boxSD(vec2 p, vec4 r) { vec2 c = (r.xy + r.zw) * 0.5, h = (r.zw - r.xy) * 0.5; vec2 q = abs(p - c) - h; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
  // 紙上的歌詞（壓痕＋墨）：白的是空壓（只有凹痕），深的是墨
  vec3 lyricOn(vec3 col, vec2 P) {
    vec4 L = fastLayer(texture(lyr, pageUV(P)));
    float ax = texture(lyr, pageUV(P + vec2(1.4, 0.0))).a - texture(lyr, pageUV(P - vec2(1.4, 0.0))).a;
    float ay = texture(lyr, pageUV(P + vec2(0.0, 1.4))).a - texture(lyr, pageUV(P - vec2(0.0, 1.4))).a;
    col *= 1.0 + 0.22 * ax + 0.12 * ay;
    vec3 lc = L.rgb / max(L.a, 1e-3);
    float blind = step(0.55, luma(lc));
    col = mix(col, lc * 0.92, L.a * (1.0 - blind) * (0.9 + 0.1 * snoise(P / 3.0)));
    col *= 1.0 - 0.05 * L.a * blind;
    return col;
  }

  void main() {
    vec2 sp = SP();
    vec2 P = pcHit(sp, 0.0).xy;
    vec2 e = vec2(1.6, 0.0);
    float px = max(max(fwidth(P.x), fwidth(P.y)), 0.3);
    // ---- 送紙台：淺色的木頭（木紋很淡），燈從左上來
    float wg = fbm(vec2(P.x / 900.0, P.y / 80.0), 3);
    vec3 col = mix(C_PAPER, C_SEPIA, 0.24 + 0.05 * wg + 0.012 * sin((P.y + 90.0 * wg) / 6.0));

    // ---- 墨盤：一片金屬圓盤，上面一層黑亮的墨，墨的紋路跟著盤子轉
    vec2 dp = P - disc.xy; float dr = length(dp);
    // 墨盤在台上的影子
    col *= 1.0 - 0.4 * (1.0 - smoothstep(disc.z + 4.0, disc.z + 34.0, length(dp - vec2(-10.0, -14.0))));
    if (dr < disc.z + 14.0) {
      float an = atan(dp.y, dp.x) - discA;
      float film = 0.5 + 0.5 * snoise(vec2(cos(an) * dr / 60.0, sin(an) * dr / 60.0) + 3.0);
      vec3 inkC = mix(C_SEPIA, C_ASH, 0.25) * (0.35 + 0.2 * film);
      // 高光：一道斜斜的反光（不轉），墨紋經過時一亮一暗
      float hl = exp(-pow((dp.x * 0.6 + dp.y * 0.8 + 40.0) / 30.0, 2.0)) * (0.5 + 0.5 * film);
      inkC += C_BONE * 0.22 * hl;
      // 外圈一圈金屬邊，邊緣抗鋸齒
      float rim = smoothstep(disc.z - 1.0, disc.z + 1.0, dr);
      vec3 metal = mix(C_ASH, C_BONE, 0.3) * (0.75 + 0.2 * sin(an * 3.0));
      col = mix(mix(inkC, metal, rim), col, smoothstep(disc.z + 12.5, disc.z + 14.0, dr));
    }

    // ---- 版：鐵框、木頭填料、反字的鉛字
    float dF = boxSD(P, forme);
    // 鐵框在台上的影子
    col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 26.0, boxSD(P - vec2(-10.0, -14.0), forme + vec4(-20.0, -20.0, 20.0, 20.0))));
    if (dF < 20.0) {
      if (dF > 0.0) {
        // 鐵框：深灰、四邊有一點亮邊
        float n = dF / 20.0;
        col = mix(C_INK2, C_GRAPHITE, 0.5) * (0.7 + 0.5 * (1.0 - abs(n * 2.0 - 1.0))) * (0.9 + 0.1 * snoise(P / 20.0));
      } else {
        // 排版座標（版是反的）
        vec2 Q = vec2(formeO.x - P.x, P.y - formeO.y);
        vec4 m = hasMk > 0.5 ? M(Q) : vec4(0.0);
        float wgr = 0.5 + 0.5 * sin(P.y / 5.0 + 3.0 * snoise(P / vec2(400.0, 40.0)));
        col = mix(mix(C_PAPER, C_BLOOD, 0.12), C_SEPIA, 0.36 + 0.08 * wgr) * (0.9 + 0.08 * snoise(P / 150.0));
        // A：鉛字的字身（0.5 = 字身外框、1 = 縮進去的頂面），兩者之間是字與字之間的細縫
        float sorts = smoothstep(0.7, 0.9, m.a);
        float crev = step(0.3, m.a) * (1.0 - sorts);
        float sh = M(Q + vec2(7.0, -9.0)).b;
        vec3 metal = mix(C_ASH, C_BONE, 0.3) * (0.7 + 0.06 * snoise(P / 14.0)) * (1.0 - 0.45 * sh);
        col = mix(col, metal, sorts);
        col = mix(col, C_INK2 * 0.8, crev * 0.85 * (1.0 - 0.6 * defocus));
        // 字面：失焦時用模糊的那幾層（焦點移到卡片上）
        float faceV = mix(m.r, mix(m.g, m.b, 0.6), defocus);
        float face = smoothstep(0.35, 0.65, faceV);
        float gx = M(Q - e.xy).g - M(Q + e.xy).g, gy = M(Q + e.yx).g - M(Q - e.yx).g;
        float rim = (sat(-(gx * 0.7 + gy * 0.7) * 3.0) - sat((gx * 0.7 + gy * 0.7) * 3.0) * 0.6) * (1.0 - defocus);
        vec3 faceC = mix(C_ASH, C_BONE, 0.55) * (1.0 + 0.5 * rim);
        float inked = step(P.y, inkY);
        vec3 inkC = C_SEPIA * 0.32 * (1.0 + 0.9 * rim) + C_BONE * 0.18 * pow(sat(rim), 2.0);
        col = mix(col, mix(faceC, inkC, inked), face);
      }
      // 墨輥：一根黑色的橡膠滾筒橫過去（上緣一條亮光），比版寬一點
      float rd = (P.y - rollY) / 40.0;
      if (rollOn > 0.5 && abs(rd) < 1.0 && P.x > forme.x - 40.0 && P.x < forme.z + 40.0) {
        float cyl = sqrt(max(0.0, 1.0 - rd * rd));
        vec3 rc = C_INK2 * (0.5 + 0.9 * cyl) + C_BONE * 0.35 * pow(sat(1.0 - abs(rd + 0.45) * 4.0), 3.0);
        col = mix(col, rc, smoothstep(1.0, 0.94, abs(rd)));
      }
    }

    // ---- 卡片（放在送紙台上）：影子、紙、壓痕與墨
    float dC = boxSD(P, card);
    col *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 22.0, boxSD(P - vec2(-8.0, -12.0), card)));
    if (dC < 0.0) {
      vec3 pc = paperAt(P);
      // 紙緣一圈很淡的暗線（紙的厚度）
      pc *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 2.5, -dC));
      if (hasMk > 0.5 && printed > 0.5) {
        vec2 Q = P - cardO;
        vec4 m = M(Q);
        vec4 ck = CK(Q);
        float gx = M(Q + e.xy).g - M(Q - e.xy).g, gy = M(Q + e.yx).g - M(Q - e.yx).g;
        float bx = M(Q + e.xy * 3.0).b - M(Q - e.xy * 3.0).b, by = M(Q + e.yx * 3.0).b - M(Q - e.yx * 3.0).b;
        pc *= 1.0 + 0.3 * gx + 0.16 * gy + 0.12 * bx + 0.06 * by;
        pc *= 1.0 - 0.035 * m.b;
        float rimInk = sat((m.r - m.g) * 2.2);
        float cover = m.r * (0.93 + 0.05 * snoise(P / 4.0) + 0.03 * snoise(P / 1.3)) + 0.12 * rimInk;
        vec3 ic = ck.rgb / max(ck.a, 1e-3);
        pc = mix(pc, ic * (0.9 + 0.1 * snoise(P / 60.0)), sat(cover) * step(0.02, ck.a));
      }
      col = lyricOn(pc, P);
      // 壓板蓋下來的影子（壓印前一瞬間）
      col *= 1.0 - 0.6 * shut;
    }

    // ---- 歌詞紙條：前面一條長紙條
    float dS = boxSD(P, strip);
    col *= 1.0 - 0.28 * (1.0 - smoothstep(0.0, 18.0, boxSD(P - vec2(-6.0, -10.0), strip)));
    if (dS < 0.0) col = lyricOn(paperAt(P * 1.3) * (1.0 - 0.05 * (1.0 - smoothstep(0.0, 2.0, -dS))), P);

    // 一盞燈從左上打過來
    col *= 0.9 + 0.13 * exp(-dot((sp - vec2(600.0, 300.0)) / 1300.0, (sp - vec2(600.0, 300.0)) / 1300.0) * 2.0);
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  mk: { value: null }, ck: { value: null }, lyr: { value: null }, hasMk: { value: 0 },
  mR: { value: new THREE.Vector4(0, 0, 1, 1) }, forme: { value: new THREE.Vector4() }, card: { value: new THREE.Vector4() },
  cardO: { value: new THREE.Vector2() }, formeO: { value: new THREE.Vector2() },
  printed: { value: 0 }, shut: { value: 0 }, defocus: { value: 0 },
  rollY: { value: -999 }, rollOn: { value: 0 }, inkY: { value: -999 }, t: { value: 0 }, discA: { value: 0 },
  strip: { value: new THREE.Vector4() }, disc: { value: new THREE.Vector3() },
});

interface Glyph { ch: string; x: number; y: number; w: number; size: number; family: string; color: string }

export default class Letterpress extends Scene {
  bg = shared('letterpress.bg2', BG);
  /** 歌詞與卡片上的小字（紙面座標）。 */
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 37 + (this.msg?.id ?? 0) * 11) >>> 0;
  block: MsgBlock | null = null;
  mk: THREE.DataTexture | null = null;
  ck: THREE.CanvasTexture | null = null;
  /** 字模在排版座標的範圍；排好的字塊的寬高。 */
  rect: Rect = [0, 0, 1, 1];
  bw = 700; bh = 200;
  forme: Rect = [FORME.x, FORME.y, 800, 400];
  card: Rect = [FORME.x + 880 + GAP, FORME.y, 800, 400];
  /** 歌詞紙條（x0, y0, x1, y1）、墨盤（x, y, r）、壓印後的取景（中心、距離倍數）。 */
  strip: [number, number, number, number] = [250, 700, 1230, 800];
  disc: [number, number, number] = [110, 80, 150];
  post = { cx: 960, cy: 500, dist: 1 };
  /** 壓印的時間（第一個夠遠的小節線）與墨輥滾過的時間。 */
  tImp = 0;
  rolls: number[] = [];
  rollDur = 0.3;
  lyrSize = 52;
  k = 1;
  hasLyrics = false;
  /** 原文副行（韓文歌）：這個窗格有沒有原文、紙條要多高（紙面 px）、壓印後鏡頭在紙條上的縮放（換算副行字級用）。 */
  subOn = false;
  subX = 0;
  kSub = 1;
  avoid: Rect[] = [];

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const c = this.lyr.ctx;
    const gr = grid(au, s, e);
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    this.subOn = lyrics.linesIn(s - 1, e + 1).some((l) => !!lyricSubOf(l));
    const names = `${NAME_A} ♥ ${NAME_B}`;
    await loadText(`${m?.text ?? ''}${m ? (m.couple ? '—— 新人' : m.name) : ''}${names}${INVITE}${COLOPHON}FROM THE COUPLE${song.title}${song.artist}——一位賓客`);

    // ---- 壓印的時間：第一個離開頭至少一拍半的小節線；太晚（超過窗格四成）就改用一拍半之後的拍點
    let tImp = gr.bars.find((b) => b - s >= gr.beat * 1.45) ?? Infinity;
    if (tImp > s + 0.42 * (e - s)) tImp = au.timeOfBeat(Math.ceil(au.beatAt(s + gr.beat * 1.45) - 1e-3));
    this.tImp = tImp;
    // 墨輥：壓印前每一拍滾一次（第一拍至少要有一次）；壓印之後每一小節滾一次（替下一張上墨）
    this.rolls = gr.beats.filter((b) => b > s + 0.1 && b < tImp - 0.05);
    if (!this.rolls.length) this.rolls = [s + 0.12];
    this.rolls.push(...gr.bars.filter((b) => b > tImp + gr.beat * 1.5 && b < e - 0.3));
    this.rollDur = clamp(gr.beat * 0.55, 0.16, 0.34);

    // ---- 排版與擺位：版、卡片、紙條照留言的大小擺，鏡頭再照擺好的範圍取景（短留言時鏡頭近一點，道具不會縮在中間）。
    // 字級是螢幕上的標準（_v2），要除以鏡頭在卡片上的縮放 k；k 又跟著取景變，所以來回算三次（很快就收斂）。
    let glyphs: Glyph[] = [];
    let k = 1;
    for (let it = 0; it < 3; it++) {
      glyphs = this.typeset(c, m, names, k);
      // 有原文時紙條加高一條副行的距離（螢幕上的標準換回紙面）
      this.subX = this.subOn ? subGap(lyricV2(null)) / k : 0;
      this.place();
      this.cam.set(this.pose(e - 0.6));
      k = this.cam.toScreen(this.card[0] + this.card[2] / 2, this.card[1] + this.card[3] / 2).scale;
    }
    // 最後一次的排版用的是上一輪的 k：跟最後的 k 差一點點，照實際的 k 記下來（小字與歌詞用）
    this.k = k;
    this.avoid = [this.cam.screenRect(this.card, 10)];
    // 歌詞紙條在兩個鏡頭裡的縮放不一樣（版台特寫比較近）：用比較大的那個換算，兩個鏡頭裡歌詞都不超過標準
    const sc = [(this.strip[0] + this.strip[2]) / 2, (this.strip[1] + this.strip[3]) / 2] as const;
    const kPost = this.cam.set(this.pose(e - 0.6)).toScreen(sc[0], sc[1]).scale;
    const kPre = this.cam.set(this.pose(Math.max(s, this.tImp - 0.3))).toScreen(sc[0], sc[1]).scale;
    // 原文照壓印後（鏡頭拉遠、字最小）的縮放算字級：整個窗格大部分時間都是這個鏡位，原文在那時也要有 32 px
    this.kSub = kPost;
    this.lyrSize = (lyricV2(m && this.block ? this.block.fit.size * k : null)) / Math.max(kPost, kPre);
    this.buildMasks(glyphs);
  }

  /** 排版（排版座標：原點在字塊左上角），卡片與版用同一份。k = 鏡頭在卡片上的縮放。 */
  private typeset(c: CanvasRenderingContext2D, m: Msg | null, names: string, k: number): Glyph[] {
    const glyphs: Glyph[] = [];
    const push = (text: string, x: number, y: number, family: string, size: number, color: string) => {
      for (const g of layout(text, family, size).glyphs) glyphs.push({ ch: g.ch, x: x + g.x, y, w: g.w, size, family, color });
    };
    if (m) {
      const b = (this.block = msgBlockV2(c, m, FAM_MSG, { x: 0, y: 0, w: 860 / k - PAD.x * 2, h: 430 / k - PAD.y * 2 }, { align: 'left', valign: 'top', sigFamily: FAM_SIG, scale: k, lineHeight: 1.32 }));
      for (const ln of b.lines) push(ln.text, ln.x, ln.y, FAM_MSG, b.fit.size, rgba('sepia'));
      push(b.sig.text, b.sig.x, b.sig.y, FAM_SIG, b.sig.size, rgba('blood'));
      this.bw = Math.max(...b.lines.map((l) => l.x + l.w), b.sig.x + b.sig.w);
      this.bh = b.box[3];
    } else {
      // 沒有留言：卡片上印新人的名字（只有幾個字，可以到 72 px）與一行邀請（也排進版裡、一起印），歌詞在紙條上當焦點
      // 名字很長（「歐陽承恩 ♥ 司馬以晴」）就縮字：版與卡片的寬度都跟著名字，太寬鏡頭會拉得很遠、整個場景變小
      const size = fitPx(names, FAM_MSG, 72 / k, 600 / k), inv = 26 / k;
      push(names, 0, size * 0.9, FAM_MSG, size, rgba('sepia'));
      push(INVITE, 0, size * 0.9 + inv * 2.6, FAM_SIG, inv, rgba('blood'));
      c.font = font(FAM_MSG, size);
      const wn = c.measureText(names).width;
      c.font = font(FAM_SIG, inv);
      this.bw = Math.max(wn, c.measureText(INVITE).width);
      this.bh = size * 0.9 + inv * 2.9;
    }
    return glyphs;
  }

  /**
   * 擺位（紙面座標）：左邊是版（同樣大小的反字），右邊隔一段是卡片（只比字大一點），下面一條歌詞紙條，版的左上方是墨盤。
   * 取景的範圍＝這些東西的外框；右下角留給 HUD。
   */
  private place() {
    const fw = this.bw + 80, fh = this.bh + 80;
    this.forme = [FORME.x, FORME.y, fw, fh];
    const cw = Math.max(this.bw + PAD.x * 2, 400), ch = this.bh + PAD.y * 2;
    this.card = [FORME.x + fw + GAP, FORME.y, cw, ch];
    const bottom = Math.max(FORME.y + fh, FORME.y + ch);
    const x0 = FORME.x + 60;
    this.strip = [x0, bottom + 90, Math.max(x0 + 760, this.card[0] + cw * 0.35), bottom + 190 + this.subX];
    this.disc = [FORME.x - 60, FORME.y - 150, 150];
    const X0 = FORME.x - 30, X1 = this.card[0] + cw + 30, Y0 = FORME.y - 70, Y1 = this.strip[3] + 30;
    // 畫面寬 1560、高 720 左右放得下（留邊給 HUD）；太近也不好（紙纖維會變粗），最近到 0.72 倍
    this.post = { cx: (X0 + X1) / 2 + 40, cy: (Y0 + Y1) / 2 + 20, dist: Math.max((X1 - X0) / 1560, (Y1 - Y0) / 700, 0.72) };
  }

  /**
   * 字的高度貼圖（只做一次）：R = 清楚的字、G = 模糊 3 px、B = 模糊 9 px、A = 鉛字的方塊（一個字一格，格與格之間留縫）；
   * 墨色貼圖：留言深墨、署名紅墨、愛心玫瑰。模糊在這裡用 canvas 的 filter 做一次，之後只取樣。
   */
  private buildMasks(glyphs: Glyph[]) {
    if (!glyphs.length) return;
    const x0 = Math.min(...glyphs.map((g) => g.x)) - 40, x1 = Math.max(...glyphs.map((g) => g.x + g.w)) + 40;
    const y0 = Math.min(...glyphs.map((g) => g.y - g.size * 1.05)) - 30, y1 = Math.max(...glyphs.map((g) => g.y + g.size * 0.35)) + 30;
    const rect: Rect = [Math.floor(x0), Math.floor(y0), Math.ceil(x1 - x0), Math.ceil(y1 - y0)];
    this.rect = rect;
    const w = rect[2], h = rect[3];
    const mk = () => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true })!;
      cx.translate(-rect[0], -rect[1]);
      cx.textBaseline = 'alphabetic';
      return { cv, cx };
    };
    const heart = heartPoints(48);
    const drawGlyph = (cx: CanvasRenderingContext2D, g: Glyph, color: string) => {
      cx.fillStyle = color;
      if (g.ch === '♥') {
        const s = Math.min(g.w, g.size * 0.8) * 0.46, hx = g.x + g.w / 2, hy = g.y - g.size * 0.36;
        cx.beginPath();
        heart.forEach((p, i) => (i ? cx.lineTo(hx + p.x * s, hy + p.y * s) : cx.moveTo(hx + p.x * s, hy + p.y * s)));
        cx.closePath(); cx.fill();
        return;
      }
      cx.font = font(g.family, g.size);
      cx.fillText(g.ch, g.x, g.y);
    };
    const sharp = mk();
    for (const g of glyphs) drawGlyph(sharp.cx, g, '#fff');
    const blur = (px: number) => {
      const b = mk();
      b.cx.setTransform(1, 0, 0, 1, 0, 0);
      b.cx.filter = `blur(${px}px)`;
      b.cx.drawImage(sharp.cv, 0, 0);
      return b.cx.getImageData(0, 0, w, h).data;
    };
    const R = sharp.cx.getImageData(0, 0, w, h).data, G = blur(3), B = blur(9);
    // 鉛字的方塊：外框半透明（A = 0.5），縮進去的頂面 A = 1，兩者之間就是字與字之間的縫
    const so = mk();
    so.cx.fillStyle = '#fff'; so.cx.globalAlpha = 0.5;
    for (const g of glyphs) if (g.ch.trim()) so.cx.fillRect(g.x - 1, g.y - g.size * 0.98 - 1, g.w + 2, g.size * 1.28 + 2);
    so.cx.globalCompositeOperation = 'destination-out';
    for (const g of glyphs) if (g.ch.trim()) so.cx.fillRect(g.x + 1.5, g.y - g.size * 0.98 + 1.5, g.w - 3, g.size * 1.28 - 3);
    so.cx.globalCompositeOperation = 'source-over';
    so.cx.globalAlpha = 1;
    for (const g of glyphs) if (g.ch.trim()) so.cx.fillRect(g.x + 1.5, g.y - g.size * 0.98 + 1.5, g.w - 3, g.size * 1.28 - 3);
    const A = so.cx.getImageData(0, 0, w, h).data;
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h * 4; i += 4) { out[i] = R[i + 3]!; out[i + 1] = G[i + 3]!; out[i + 2] = B[i + 3]!; out[i + 3] = A[i + 3]!; }
    const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
    this.mk = this.track(tex);
    const col = mk();
    for (const g of glyphs) drawGlyph(col.cx, g, g.ch === '♥' ? rgba('rose') : g.color);
    const ct = new THREE.CanvasTexture(col.cv);
    ct.colorSpace = THREE.SRGBColorSpace; ct.premultiplyAlpha = false; ct.flipY = false;
    ct.minFilter = THREE.LinearFilter; ct.generateMipmaps = false; ct.needsUpdate = true;
    this.ck = this.track(ct);
  }

  /**
   * 鏡頭：壓印前是版台的斜角特寫（低、近、慢慢推，右邊看得到等著印的空白卡片）；壓印的那一下往右移到整個取景（outExpo），
   * 版還在畫面左邊、失焦；最後半拍往後拉。距離都照擺位算出來的取景（短留言的道具小，鏡頭就近一點）。
   */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const side = hash(this.seed, 3) < 0.5 ? -1 : 1;
    const F0 = 1600;
    const fr = this.forme, P = this.post, d = P.dist;
    const fcx = fr[0] + fr[2] / 2;
    const pre = prog(t, s, this.tImp);
    const go = prog(t, this.tImp, this.tImp + 0.7, ease.outExpo);
    const p = prog(t, this.tImp, e);
    const exit = prog(t, e - 0.4, e, ease.inCubic);
    return {
      tx: lerp(fcx + 0.3 * (this.card[0] - fcx) + 30 * d * side * pre, P.cx + 16 * side * (p - 0.5), go),
      // 特寫時紙條的右下角很近、很大：取景偏下一點，紙條才不會跑進右下角 HUD
      ty: lerp((fr[1] + this.strip[3]) / 2 + 70 * d, P.cy, go),
      dist: F0 * d * lerp(0.86 - 0.05 * ease.inOutQuad(pre), 1 - 0.035 * ease.inOutQuad(p) + 0.05 * exit, go),
      pitch: lerp(0.3, 0.16, go),
      yaw: lerp(0.12 * side, -0.05, go),
      roll: 0.01 * side * (1 - go),
      level: 0.8,
      focal: F0,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, song, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    u.t!.value = t;
    u.mk!.value = this.mk; u.ck!.value = this.ck;
    u.hasMk!.value = this.mk ? 1 : 0;
    (u.mR!.value as THREE.Vector4).set(...this.rect);
    const fr = this.forme, cd = this.card;
    (u.forme!.value as THREE.Vector4).set(fr[0], fr[1], fr[0] + fr[2], fr[1] + fr[3]);
    (u.card!.value as THREE.Vector4).set(cd[0], cd[1], cd[0] + cd[2], cd[1] + cd[3]);
    // 排版座標 → 卡片、版（版是反的：字塊的左緣在版的右邊）
    (u.cardO!.value as THREE.Vector2).set(cd[0] + (cd[2] - this.bw) / 2, cd[1] + PAD.y);
    (u.formeO!.value as THREE.Vector2).set(fr[0] + fr[2] - 40, fr[1] + 40);
    u.printed!.value = t >= this.tImp ? 1 : 0;
    u.shut!.value = prog(t, this.tImp - 0.12, this.tImp, ease.inQuad) * (t < this.tImp ? 1 : 0);
    u.defocus!.value = prog(t, this.tImp + 0.1, this.tImp + 0.9, ease.inOutCubic) * 0.85;
    (u.strip!.value as THREE.Vector4).set(...this.strip);
    (u.disc!.value as THREE.Vector3).set(...this.disc);
    // 墨輥：每一次從版的上緣滾到下緣（rollDur 秒，落在拍點上結束）；滾過的地方有墨
    let rollY = -999, rollOn = 0, inkY = -999;
    const y0 = fr[1] - 50, span = fr[3] + 100;
    for (const rt of this.rolls) {
      const k = (t - (rt - this.rollDur)) / this.rollDur;
      if (k >= 0 && k < 1.15) { rollY = y0 + span * ease.inOutCubic(clamp(k)); rollOn = k < 1.1 ? 1 : 0; }
      if (k >= 0) inkY = Math.max(inkY, y0 + span * ease.inOutCubic(clamp(k)));
    }
    u.rollY!.value = rollY; u.rollOn!.value = rollOn; u.inkY!.value = inkY;
    // 墨盤：慢慢轉，每一拍多轉一格（緩出，停在拍點上）
    const bt = au.beatAt(t), bi = Math.floor(bt);
    u.discA!.value = t * 0.12 + (bi + ease.outCubic(clamp((bt - bi) / 0.35))) * (Math.PI / 12);

    // ---- 歌詞（紙條上）與卡片上的小字
    const L = this.lyr; L.clear();
    const c = L.ctx;
    const ink: KaraokeInk = { active: rgba('blood'), sung: rgba('sepia'), unsung: rgba('bone') };
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const st = { family: FAM_LYR, size: this.lyrSize, minSize: 40 / this.k, maxW: this.strip[2] - this.strip[0] - 100, maxRows: 1, align: 'left' as const };
      const lay = layoutRows(c, ly.line, st);
      // 原文副行：同一條紙條、中文正下方，小一號；唱到、唱完都是咖啡墨再淡兩成（不用紅墨），還沒唱的一樣只壓不上墨
      const sub = lyricSubOf(ly.line);
      const kS = this.kSub;
      const sl = sub ? layoutRows(c, sub, { ...st, size: subSizeFor(lay.size * kS) / kS, minSize: 26 / kS }) : null;
      const gap = sl ? subGap(lay.size * kS, sl.size * kS) / kS : 0;
      // 這個窗格有原文但這一句沒有（兩行一樣的句子）：中文放在加高的紙條中間
      const up = sl ? gap : this.subX / 2;
      c.save(); c.translate(this.strip[0] + 50, this.strip[3] - 32 - up); drawRows(c, lay, FAM_LYR, t, ink, ly.k);
      if (sl) { c.translate(0, gap); drawRows(c, sl, FAM_LYR, t, { active: rgba('sepia', 0.8), sung: rgba('sepia', 0.8), unsung: ink.unsung }, ly.k); }
      c.restore();
    } else if (!this.hasLyrics) {
      c.font = font(F.mono(500), 18 / this.k); c.letterSpacing = '4px'; c.fillStyle = rgba('sepia', 0.7);
      c.fillText(`♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`.toUpperCase(), this.strip[0] + 50, this.strip[3] - 40);
      c.letterSpacing = '0px';
    }
    if (t >= this.tImp) {
      // 卡片左上角：版權頁一行很小的字（第二色）；沒有留言時名字下面一行邀請
      // 名字長、卡片窄（短留言）時縮字，不印到卡片外的木頭上；這張圖層只有 W 寬（紙面座標），
      // 長留言時卡片右半邊在圖層外面，所以也不能超過圖層的右緣（不然後半截會被切掉）
      const colo = this.msg?.couple ? `FROM THE COUPLE · ${COLOPHON}` : COLOPHON;
      const cs = fitPx(colo, F.hei(500), 16 / this.k, Math.min(cd[2] - PAD.x * 2, W - 24 - (cd[0] + PAD.x)), 4);
      c.font = font(F.hei(500), cs); c.letterSpacing = `${(4 * cs * this.k) / 16}px`; c.fillStyle = rgba('blood', 0.8);
      c.fillText(colo, cd[0] + PAD.x, cd[1] + PAD.y * 0.62);
      c.letterSpacing = '0px';
    }
    u.lyr!.value = L.upload();
    this.bg.render(renderer, out);
    // 壓印：閃一下、震一下
    const hit = pulse(t, this.tImp, 0.09);
    const sh = hit * 7;
    return {
      paper: 1, bloom: 0.3, vignette: 0.45, grain: 0.05,
      flash: 0.22 * hit, shake: [sh * (hash(this.seed, 9) - 0.5), sh * 0.8], zoom: 1 + 0.02 * hit,
      popupAvoid: t >= s ? this.avoid : [],
    };
  }
}
