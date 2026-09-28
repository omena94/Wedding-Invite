// 水墨暈染（亮）：俯看一張攤在桌上、剛刷過清水的宣紙。字先用清水寫在紙上（濕的地方顏色深一點，淡淡看得到），
// 然後墨一滴一滴落下來——每一滴落在一組字的正中間（落在拍點上），在濕紙上暈開：先是一團霧、邊緣順著紙纖維長出毛邊，
// 墨很快往濕的筆畫裡收，變成濃黑的字，周圍留下一圈淡墨的暈與一條水痕。落下前紙上有墨滴越來越小、越來越濃的影子，
// 落下時濺出幾顆小墨點、濕紙上的反光一圈漾開。
//  - 一個焦點：主打留言（霞鶩文楷粗，最大、最黑）；署名是最後兩滴淡墨。歌詞在下緣用淡墨寫（逐字跟唱，正在唱的是朱墨）。
//  - 沒有留言：歌詞就是一滴一滴落下的字——每個字在唱到的那一刻落墨（剛落下的墨是訊號色的朱墨，唱完乾成黑墨），
//    新的一句寫在另一行，上一句淡下去；純音樂又沒有留言：一拍一滴寫新人的名字＋一行邀請。
//  - 鏡頭：從稍高、稍斜的地方落定，之後慢慢推近，而且跟著最近落下的墨滴輕輕移過去。
// 手法：一個全螢幕 shader（PlaneCam 反查每個像素在紙上的哪裡）。字在 init() 畫成字模（清楚／暈 5 px／暈 18 px＋每個像素最近的兩組），
// 每一組的中心、大小、落下的時間放在 uniform 陣列，shader 只算這個像素附近的四組，墨的濃度用吸收（exp）疊，重疊的暈會更深。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font } from '../engine/type';
import { rgba } from '../engine/palette';
import { clamp, ease, prog, hash } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { lyricAt, lyricSizeFor, COUPLE_ZH } from './_motifs';
import { grid, stagger, layoutRows, drawRows, type Grid, type KaraokeInk } from './_t4';
import { PlaneCam, camUniforms, CAM_GLSL, msgBlock, type MsgBlock } from './_t14';
import { loadAll, sigOf, t21Grain, GRAIN_GLSL, groupLine, glyphMask, T21_INVITE, type TGlyph, type TGroup, type GlyphMask, type Rect } from './_t21';

export const spec: PlateSpecDecl = { group: 'type', family: 'print', paper: true, energy: [0.05, 0.7], bars: [4, 8], weight: 1 };

const MAXG = 40;
const MSG_BOX = { x: 210, y: 150, w: 1500, h: 650 };
/** 留言時歌詞寫在紙的下緣（右邊停在 HUD 左邊）。 */
const LYR = { x: 210, y: 962, w: 1110 };
const FAM = F.hand(700);
const FAM_SIG = F.hand(400);
const FAM_LYR = F.hand(700);
/** 沒有留言時兩句歌詞輪流寫的兩行（中心 y）。 */
const BANDS = [370, 680];

const slotDecl = (S: string) => `uniform sampler2D m${S}; uniform sampler2D x${S}; uniform vec4 r${S}; uniform vec2 s${S}; uniform float a${S}; uniform float w${S}; uniform int n${S}; uniform vec4 g${S}[${MAXG}]; uniform vec4 q${S}[${MAXG}];`;
// 一個字模（slot）：這個像素最近的一組（own：字、暈、落下前的影子都算）、第二、第三近的組與最近那組的前後各一組（只算那一團墨的暈與水痕）
const slotCode = (S: string) => /* glsl */ `
  if (a${S} > 0.0) {
    vec2 uv = (P - r${S}.xy) / r${S}.zw;
    if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
      vec4 sm = texture(m${S}, uv);
      vec4 ix = texelFetch(x${S}, ivec2(uv * s${S}), 0);
      int g0 = int(ix.r * 255.0 + 0.5), g1 = int(ix.g * 255.0 + 0.5), g2 = int(ix.b * 255.0 + 0.5);
      vec4 D = vec4(0.0); vec2 L = vec2(0.0);
      if (g0 < n${S}) {
        groupInk(P, sm, g${S}[g0], q${S}[g0], true, w${S}, nz, D, L);
        if (g0 > 0 && g0 - 1 != g1 && g0 - 1 != g2) groupInk(P, sm, g${S}[g0 - 1], q${S}[g0 - 1], false, 0.0, nz, D, L);
        if (g0 + 1 < n${S} && g0 + 1 != g1 && g0 + 1 != g2) groupInk(P, sm, g${S}[g0 + 1], q${S}[g0 + 1], false, 0.0, nz, D, L);
      }
      if (g1 < n${S}) groupInk(P, sm, g${S}[g1], q${S}[g1], false, 0.0, nz, D, L);
      if (g2 < n${S}) groupInk(P, sm, g${S}[g2], q${S}[g2], false, 0.0, nz, D, L);
      DK += D * a${S}; LI += L * a${S};
    }
  }`;

const BG = () => new FSPass(/* glsl */ `
  ${CAM_GLSL}
  ${GRAIN_GLSL}
  uniform float t;
  ${slotDecl('A')}
  ${slotDecl('B')}
  uniform sampler2D lyr;

  // 一組字的墨：G = (中心 x, y, 半寬, 落下的時間)，Q = (半高, 墨色 0 黑／1 淡墨／2 愛心, 朱墨退掉的時間（< 0 = 不用）, 種子)。
  // D：x = 黑墨、y = 朱墨（正在唱）、z = 愛心的玫瑰色、w = 水（濕紙變深）；L：x = 反光、y = 影子。
  void groupInk(vec2 p, vec4 sm, vec4 G, vec4 Q, bool own, float water, float nz, inout vec4 D, inout vec2 L) {
    float dt = t - G.w;
    // 每一滴不一樣：落點偏一點、大小差一點
    vec3 hv = hash33(vec3(Q.w, 1.3, 2.7));
    vec2 c0 = G.xy + (hv.xy - 0.5) * vec2(G.z * 0.3, Q.x * 0.3);
    vec2 hs = vec2(G.z * 0.85 + 46.0, Q.x * 0.9 + 30.0) * (0.85 + 0.35 * hv.z);
    float d = length((p - c0) / hs);
    float tone = Q.y;
    float kt = tone > 0.5 && tone < 1.5 ? 0.42 : 1.0;
    if (own) D.w = max(D.w, water * (0.55 * sm.g + 0.45 * sm.a));
    if (dt < 0.0) {
      // 墨滴落下前：影子從右下往落點收、越來越小越濃
      if (own && dt > -0.32) {
        float k = 1.0 + dt / 0.32;
        vec2 c = c0 + (1.0 - k) * vec2(90.0, 70.0);
        float r = 9.0 + 46.0 * (1.0 - k);
        L.y = max(L.y, (1.0 - smoothstep(r * 0.25, r, length(p - c))) * 0.2 * k * k);
      }
      return;
    }
    float R = 1.18 * (1.0 - exp(-dt * 3.4));
    float e = d - R + nz;
    float inside = smoothstep(0.1, -0.12, e);
    float core = clamp(1.0 - d / max(R, 0.05), 0.0, 1.0);
    // 那一團墨：中間濃、往外淡；剛落下很濃，幾拍之後淡成一片淡墨；邊緣一條很細的水痕
    float wash = inside * ((0.012 + 0.06 * core) + (0.05 + 0.3 * core * core) * exp(-dt * 1.7));
    float tide = exp(-pow(e / 0.045, 2.0)) * 0.05 * smoothstep(0.1, 0.5, dt);
    float dens = wash + tide;
    // 濺出去的小墨點（不是每一滴都有）
    if (hv.z > 0.35) for (int j = 0; j < 3; j++) {
      vec3 h = hash33(vec3(Q.w, float(j), 7.1));
      float a = h.x * 6.2832;
      vec2 sp = c0 + vec2(cos(a), sin(a)) * hs * (1.05 + 0.3 * h.y);
      float rr = 2.0 + 5.5 * h.z * h.z;
      dens += (1.0 - smoothstep(rr * 0.4, rr, length(p - sp))) * 0.95 * smoothstep(0.0, 0.08, dt);
    }
    if (own) {
      // 墨往濕的筆畫裡收：離中心近的先收；字的邊緣順著紙纖維暈出一點毛邊（字一定會完整出現，不受那一團墨的邊緣影響）
      float inG = smoothstep(0.1, -0.12, d - R * 1.3);
      float cond = smoothstep(0.0, 0.34, dt - d * 0.18);
      float stroke = max(sm.r, smoothstep(0.44, 0.58, sm.g + 0.07 * snoise(p / 12.0 + Q.w)));
      dens += stroke * inG * cond * 1.55 + sm.b * inG * (0.05 + 0.3 * exp(-dt * 1.5));
      // 落下的那一下：濕紙上的反光漾開一圈
      if (dt < 0.4) {
        float rr = 14.0 + 260.0 * dt;
        L.x = max(L.x, exp(-pow((length(p - c0) - rr) / 5.0, 2.0)) * (1.0 - dt / 0.4));
      }
    }
    dens *= kt;
    float act = (own && Q.z > 0.0) ? 1.0 - smoothstep(Q.z, Q.z + 0.35, t) : 0.0;
    if (tone > 1.5) D.z += dens; else { D.x += dens * (1.0 - act); D.y += dens * act; }
  }

  vec3 absorb(vec3 c, vec3 base) { return -log(clamp(c / base, vec3(0.004), vec3(1.0))); }

  void main() {
    vec2 sp = SP();
    vec3 hit = pcHit(sp, 0.0);
    vec2 P = hit.xy;
    vec4 gr = paperGrain(P);
    // 宣紙：比奶茶色的紙更白一點（但不比紙白刺眼），雲紋、長纖維
    vec3 pap = mix(C_PAPER, C_BONE, 0.55) * (0.955 + 0.04 * gr.b + 0.018 * (gr.r - 0.5));
    pap = mix(pap, C_BONE * 1.02, 0.35 * gr.g);
    float nz = 0.1 * snoise(P / 95.0) + 0.045 * snoise(P / 31.0) - 0.07 * gr.g;
    vec4 DK = vec4(0.0); vec2 LI = vec2(0.0);
    ${slotCode('A')}
    ${slotCode('B')}
    vec3 inkC = mix(C_SEPIA, C_INK, 0.55) * 0.95;
    vec3 actC = mix(C_BLOOD, C_SIGNAL, 0.2) * 0.9;
    // 墨吃進紙的纖維：纖維多的地方濃一點
    float fib = 0.9 + 0.2 * gr.r + 0.15 * gr.g;
    vec3 A = absorb(inkC, pap) * DK.x + absorb(actC, pap) * DK.y + absorb(C_ROSE, pap) * DK.z;
    vec3 col = pap * exp(-A * fib);
    // 清水寫的字：濕的地方暗一點、偏暖
    col *= 1.0 - 0.075 * clamp(DK.w, 0.0, 1.0);
    // 下緣的淡墨字（Canvas，紙面座標）：字緣多一圈很淡的暈
    vec2 lu = pageUV(P);
    vec4 Ly = fastLayer(texture(lyr, lu));
    float fe = 0.25 * (texture(lyr, pageUV(P + vec2(3.0, 0.0))).a + texture(lyr, pageUV(P - vec2(3.0, 0.0))).a
      + texture(lyr, pageUV(P + vec2(0.0, 3.0))).a + texture(lyr, pageUV(P - vec2(0.0, 3.0))).a);
    col *= 1.0 - 0.1 * fe;
    col = col * (1.0 - Ly.a) + Ly.rgb * fib;
    // 墨滴的影子、落下時的反光
    col *= 1.0 - LI.y;
    col += C_BONE * 0.14 * LI.x;
    // 一盞燈從左上打過來
    vec2 lp = (sp - vec2(620.0, 260.0)) / 1500.0;
    col *= 0.93 + 0.09 * exp(-dot(lp, lp) * 2.0);
    fragColor = vec4(col, 1.0);
  }`, {
  ...camUniforms(),
  grainTex: { value: null }, t: { value: 0 }, lyr: { value: null },
  ...slotUniforms('A'), ...slotUniforms('B'),
});

function slotUniforms(S: string) {
  return {
    [`m${S}`]: { value: null }, [`x${S}`]: { value: null }, [`r${S}`]: { value: new THREE.Vector4(0, 0, 1, 1) }, [`s${S}`]: { value: new THREE.Vector2(1, 1) },
    [`a${S}`]: { value: 0 }, [`w${S}`]: { value: 0 }, [`n${S}`]: { value: 0 },
    [`g${S}`]: { value: Array.from({ length: MAXG }, () => new THREE.Vector4()) },
    [`q${S}`]: { value: Array.from({ length: MAXG }, () => new THREE.Vector4()) },
  } as Record<string, THREE.IUniform>;
}

/** 一張字模＋每一組的資料（中心、大小、落下的時間、墨色）。 */
interface InkSet { mask: GlyphMask; G: THREE.Vector4[]; Q: THREE.Vector4[]; n: number; rect: Rect }
/** 沒有留言時一句歌詞的字模。 */
interface LineSet extends InkSet { line: Line; idx: number }

export default class Ink extends Scene {
  bg = shared('ink.bg', BG);
  /** 下緣的淡墨字（紙面座標），每格重畫。 */
  lyr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  cam = new PlaneCam();
  msg: Msg | null = this.ctx.params.message ?? null;
  seed = ((this.ctx.params.seed ?? 1) * 131 + (this.msg?.id ?? 0) * 17) >>> 0;
  g!: Grid;
  block: MsgBlock | null = null;
  main: InkSet | null = null;
  lines: LineSet[] = [];
  lyrSize = 52;
  hasLyrics = false;
  avoid: Rect[] = [];
  /** 每一滴落下的時間與位置（鏡頭跟著用）。 */
  drops: { t: number; x: number; y: number }[] = [];

  override async init() {
    const { audio: au, lyrics } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end, m = this.msg;
    const names = COUPLE_ZH.replace(/\s*&\s*/, ' ♥ ');
    await loadAll(this.ctx, names);
    const g = (this.g = grid(au, s, e));
    this.hasLyrics = lyrics.linesIn(s, e).length > 0;
    const c = this.lyr.ctx;
    if (m) {
      const b = (this.block = msgBlock(c, m, FAM, MSG_BOX, { align: 'center', sigFamily: FAM_SIG, sigMin: 40, sigMax: 56, min: 50, max: 150, lineHeight: 1.34, maxLines: 5, sigText: sigOf(m) }));
      const glyphs: TGlyph[] = [], groups: TGroup[] = [];
      const nChars = b.lines.reduce((a, l) => a + Array.from(l.text.replace(/\s/g, '')).length, 0);
      const run = clamp(Math.ceil(nChars / 14), 1, 4);
      for (const ln of b.lines) groupLine(ln.text, ln.x, ln.y, FAM, b.fit.size, run, 0, glyphs, groups);
      const nMsg = groups.length;
      groupLine(b.sig.text, b.sig.x, b.sig.y, FAM_SIG, b.sig.size, 99, 0, glyphs, groups);
      // 一組一滴：從第一拍開始，一拍 1、2、4 滴（最多花窗格的四成、5 秒）；署名在最後一滴之後一拍、一拍半
      const maxDur = clamp((e - g.b0) * 0.4, g.beat * 1.5, 5);
      const ts = stagger(au, g.b0, nMsg, maxDur);
      const tl = ts[ts.length - 1] ?? g.b0;
      for (let i = nMsg; i < groups.length; i++) ts.push(tl + g.beat * (1 + 0.5 * (i - nMsg)));
      this.main = this.inkSet(glyphs, groups, ts.map((x) => [x, -1]), (i) => (i >= nMsg ? 1 : groups[i]!.heart ? 2 : 0));
      // 鏡頭開場時稍微拉遠一點：歌詞多留一點字級，縮小之後也不會小於 48 px
      this.lyrSize = Math.max(52, lyricSizeFor(b.fit.size));
      this.avoid = [b.box, [LYR.x, LYR.y - 64, LYR.w, 84]];
    } else if (this.hasLyrics) {
      // 沒有留言：窗格裡的每一句歌詞各做一張字模（一個字＝一組，唱到那個字的時候落墨）
      const all = lyrics.lines;
      for (const line of lyrics.linesIn(s - 1, e)) {
        const idx = all.indexOf(line);
        const lay = layoutRows(c, line, { family: FAM_LYR, size: 118, minSize: 64, maxW: 1420, maxRows: 2, align: 'center', lineHeight: 1.22 });
        const cy = BANDS[idx % 2]!;
        const y0 = cy - lay.height / 2 + lay.size * 0.82;
        const glyphs: TGlyph[] = [], groups: TGroup[] = [];
        const tw: [number, number][] = [];
        for (const pw of lay.words) {
          const x = W / 2 + pw.x, y = y0 + pw.y;
          glyphs.push({ ch: pw.word.w, x, y, w: pw.w, size: lay.size, family: FAM_LYR, g: groups.length });
          groups.push({ x, y: y - lay.size * 0.95, w: pw.w, h: lay.size * 1.2, from: glyphs.length - 1, to: glyphs.length, heart: pw.word.w === '♥' });
          tw.push([pw.word.start - 0.03, pw.word.end]);
        }
        if (!groups.length) continue;
        const set = this.inkSet(glyphs, groups, tw, (i) => (groups[i]!.heart ? 2 : 0));
        this.lines.push({ ...set, line, idx });
      }
      this.avoid = [[180, 200, 1560, 680]];
    } else {
      // 純音樂又沒有留言：一拍一滴寫新人的名字
      const glyphs: TGroup[] = [];
      const gl: TGlyph[] = [];
      c.font = font(FAM, 170);
      const w = c.measureText(names).width;
      groupLine(names, (W - w) / 2, 560, FAM, 170, 1, 0, gl, glyphs);
      const ts = glyphs.map((_, i) => au.timeOfBeat(au.beatAt(g.b0) + i));
      this.main = this.inkSet(gl, glyphs, ts.map((x) => [x, -1]), (i) => (glyphs[i]!.heart ? 2 : 0));
      this.avoid = [[(W - w) / 2 - 40, 360, w + 80, 260], [LYR.x, 880, 1100, 100]];
    }
  }

  /** 做一張字模＋每組的 uniform 資料；也記下每一滴（鏡頭跟著用）。 */
  private inkSet(glyphs: TGlyph[], groups: TGroup[], times: [number, number][], tone: (i: number) => number): InkSet {
    const mask = glyphMask(glyphs, groups, 2.5, 16, 200, 180, 4);
    this.track(mask);
    const n = Math.min(MAXG, groups.length);
    const G: THREE.Vector4[] = [], Q: THREE.Vector4[] = [];
    for (let i = 0; i < n; i++) {
      const gr = groups[i]!, [t0, t1] = times[i]!;
      G.push(new THREE.Vector4(gr.x + gr.w / 2, gr.y + gr.h / 2, gr.w / 2, t0));
      Q.push(new THREE.Vector4(gr.h / 2, tone(i), t1, hash(this.seed, i) * 97));
      this.drops.push({ t: t0, x: gr.x + gr.w / 2, y: gr.y + gr.h / 2 });
    }
    return { mask, G, Q, n, rect: mask.rect };
  }

  private bind(S: string, set: InkSet | null, a: number, water: number) {
    const u = this.bg.u;
    u[`a${S}`]!.value = set ? a : 0;
    if (!set) return;
    u[`m${S}`]!.value = set.mask.tex; u[`x${S}`]!.value = set.mask.idx;
    (u[`r${S}`]!.value as THREE.Vector4).set(...set.rect);
    (u[`s${S}`]!.value as THREE.Vector2).set(set.mask.w, set.mask.h);
    u[`w${S}`]!.value = water; u[`n${S}`]!.value = set.n;
    const G = u[`g${S}`]!.value as THREE.Vector4[], Q = u[`q${S}`]!.value as THREE.Vector4[];
    for (let i = 0; i < set.n; i++) { G[i]!.copy(set.G[i]!); Q[i]!.copy(set.Q[i]!); }
  }

  /** 鏡頭：從稍高、稍斜的地方在第一拍前後落定，之後慢慢推近，並跟著最近落下的墨滴輕輕移過去。 */
  private pose(t: number) {
    const s = this.ctx.start, e = this.ctx.end;
    const land = ease.outExpo(prog(t, s, s + Math.min(1.1, this.g.beat * 2.2)));
    const push = prog(t, s, e, ease.inOutQuad);
    // 最近的幾滴（落下前後各 0.4 秒淡入，之後 1.5 秒淡出）加權平均；沒有就是畫面中央
    let sx = 960 * 0.6, sy = 540 * 0.6, sw = 0.6;
    for (const d of this.drops) {
      const w = clamp((t - d.t + 0.4) / 0.8) * Math.exp(-Math.max(0, t - d.t) / 1.5);
      sx += d.x * w; sy += d.y * w; sw += w;
    }
    const side = hash(this.seed, 5) < 0.5 ? -1 : 1;
    return {
      tx: 960 + 0.07 * (sx / sw - 960), ty: 540 + 0.06 * (sy / sw - 540) + 10 * (1 - land),
      dist: 1600 * (1.07 - 0.07 * land - 0.045 * push),
      pitch: 0.2 - 0.14 * land, yaw: side * (0.07 - 0.05 * land + 0.02 * push), roll: side * 0.015 * (1 - land), level: 0.75, focal: 1600,
    };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, lyrics, song } = this.ctx;
    const t = f.t;
    this.cam.set(this.pose(t));
    const u = this.bg.u;
    this.cam.apply(u);
    u.t!.value = t;
    u.grainTex!.value = t21Grain(renderer);

    const L = this.lyr; L.clear();
    const c = L.ctx;
    if (this.main) {
      this.bind('A', this.main, 1, 1);
      this.bind('B', null, 0, 0);
    } else {
      // 沒有留言：現在這一句（或下一句，提早 0.35 秒）用 A、上一句用 B（乾了、淡下去）
      const cur = this.lines.findIndex((ls) => t < ls.line.end + 0.05 && t >= ls.line.start - 0.35);
      let a = cur, b = -1;
      if (a < 0) {
        // 兩句之間：最後唱完的那一句還留著
        for (let i = 0; i < this.lines.length; i++) if (this.lines[i]!.line.start - 0.35 <= t) a = i;
      }
      if (a > 0) b = a - 1;
      const la = this.lines[a], lb = this.lines[b];
      const kin = la ? clamp((t - (la.line.start - 0.35)) / 0.35) : 0;
      this.bind('A', la ?? null, 1, kin);
      // 上一句：新的一句開始唱之後淡到四成，同一行要換下一句之前消失
      const kb = la ? 1 - 0.6 * clamp((t - la.line.start) / 0.8) : 1;
      this.bind('B', lb ?? null, kb, 1);
    }

    // ---- 下緣的淡墨字
    const ink: KaraokeInk = { active: rgba('blood'), sung: rgba('sepia', 0.8), unsung: rgba('sepia', 0.22) };
    if (this.msg) {
      const ly = lyricAt(lyrics, t);
      if (ly) {
        const lay = layoutRows(c, ly.line, { family: FAM_LYR, size: this.lyrSize, minSize: 48, maxW: LYR.w, maxRows: 2, align: 'left' });
        c.save(); c.translate(LYR.x, LYR.y - (lay.rows.length - 1) * lay.lineHeight);
        drawRows(c, lay, FAM_LYR, t, ink, ly.k);
        c.restore();
      } else if (!this.hasLyrics) {
        this.small(c, `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 12, F.mono(500), 20, 4);
      }
      if (this.msg.couple) this.small(c, 'FROM THE COUPLE  ·  新人', MSG_BOX.x, 118, F.mono(500), 18, 5, rgba('blood', 0.75));
    } else {
      this.small(c, T21_INVITE, LYR.x, LYR.y - 12, F.hei(500), 26, 4, rgba('sepia', 0.55));
      if (!this.hasLyrics) this.small(c, `♪  ${song.title}${song.artist ? '  ·  ' + song.artist : ''}`, LYR.x, LYR.y - 62, F.mono(500), 18, 4);
    }
    u.lyr!.value = L.upload();
    this.bg.render(renderer, out);
    return {
      paper: 1, bloom: 0.2, vignette: 0.42, grain: 0.04,
      popupAvoid: this.avoid.map((r) => this.cam.screenRect(r, 10)),
    };
  }

  private small(c: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, size: number, tracking: number, color = rgba('sepia', 0.6)) {
    c.font = font(family, size); c.letterSpacing = `${tracking}px`; c.fillStyle = color;
    c.fillText(text, x, y);
    c.letterSpacing = '0px';
  }
}

