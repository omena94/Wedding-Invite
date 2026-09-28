// 終端機（機器 B，暗）：暗房間裡一台老式綠螢幕終端機（磷光是主題的訊號色），鏡頭斜斜地拍著它的弧形玻璃。
//  - 鏡頭：終端機在空間裡、稍微側一點，進場從更斜的地方在第一拍前後落定，之後慢慢推近；對焦在留言上，遠的那側有一點景深。
//  - 玻璃上只有三件事：
//    1. 一行小小的指令：第一拍開始有人打「cat wishes/042.txt」（一個字一個字、打完在下一拍按 Enter）。
//    2. 焦點：檔案內容就是主打留言，印成很大的字（思源宋體），一段一段印出來（剛印出的字燙的、冷成磷光白），署名，新的提示字元與游標。
//       沒有留言：「cat: wishes/: 目前還沒有留言」＋邀請，焦點換成下緣的歌詞。
//    3. 下緣：歌詞（「tail -f tonight.log」的最新一行），比留言小一級：唱到的字反白（訊號色的方塊）、唱完是磷光白、還沒唱三成亮。
//       純音樂：這一行是歌名。
//  - 游標每一拍閃一次；大鼓讓整片螢幕亮一下。窗格一開始是映像管開機：一條亮線上下撐開成畫面。
// 手法：字畫在一張 Canvas 層，經過映像管 shader（桶狀變形、掃描線、磷光光暈、更新帶）畫進離屏圖，
// 再用 _t8 的舞台當成房間裡的一台螢幕來拍（透視、景深、塑膠外框、玻璃反光）。
import type * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { F, font, loadText, measure } from '../engine/type';
import { LIN, rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog } from '../engine/util';
import { fitText, type FitResult } from '../engine/text';
import { Lyrics, type Line } from '../engine/lyrics';
import { lyricAt, layoutLyric, type LyricLayout, type LyricStyle, signature, beatAfter } from './_motifs';
import { DEC_GLSL, INVITE, T8_TEXT, Stage, camMove } from './_t8';

export const spec: PlateSpecDecl = { group: 'type', family: 'machine', paper: false, energy: [0.2, 0.95], bars: [4, 8], weight: 1 };

// ---------------------------------------------------------------- 版面（玻璃上的座標，px）
const X0 = 190; // 字的左緣
const XR = 1700; // 留言的右緣
const PROMPT = '$ ';
const P_SIZE = 26; // 指令列的字級（配角）
const CMD_Y = 196; // 指令列的基線
const MSG_TOP = 250, MSG_BOT = 720; // 留言的範圍
const LY_Y = 930; // 歌詞的基線（最後一列）
const LY_W = 1130; // 歌詞最寬（右邊不進右下角 QR 那一區）
const TEXT = `${T8_TEXT}目前還沒有留言—·♪█`;
/** 磷光的「白」：紙白帶一點訊號色（整片螢幕是單色的磷光，但字要夠白才讀得清楚）。 */
const PH = (a = 1) => mixRgba('bone', 'signal', 0.28, a);

/** 映像管：桶狀變形、掃描線、磷光光暈、更新帶、開機的亮線。整張內容就是玻璃（外框由舞台畫）。 */
const CRT = () => new FSPass(/* glsl */ `
  uniform sampler2D tex; uniform float on; uniform float kick; uniform float roll;
  ${DEC_GLSL}
  // textureLod：光暈在迴圈裡取樣，不用導數（D3D 會警告）
  vec4 samp(vec2 uv) { return decLayer(textureLod(tex, uv, 0.0)); }
  void main() {
    vec2 cc = vUv - 0.5;
    vec2 ca = cc * vec2(1.7778, 1.0);
    float r2 = dot(ca, ca);
    vec2 d = cc * (1.0 + 0.04 * r2 + 0.015 * r2 * r2);
    float sq = max(on, 0.004);
    vec2 suv = vec2(d.x, d.y / sq) + 0.5;
    // 螢幕底：很深的黑帶一點磷光的顏色，中間稍亮
    vec3 col = C_INK * 0.45 + C_SIGNAL * (0.008 + 0.016 * (1.0 - smoothstep(0.0, 0.7, length(ca))));
    if (abs(cc.y) < 0.5 * sq && suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {
      vec4 c = samp(suv);
      vec3 halo = vec3(0.0);
      vec2 px = vec2(1.0 / ${W}.0, 1.0 / ${H}.0);
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        halo += samp(suv + vec2(cos(a), sin(a)) * px * 5.0).rgb;
      }
      col = col * (1.0 - c.a) + c.rgb + halo * 0.035;
    }
    col += C_EMBER * 3.0 * (1.0 - smoothstep(0.0, 0.004 + 0.012 * on, abs(cc.y))) * (1.0 - on) * step(0.001, on) * step(on, 0.97);
    col *= 0.88 + 0.12 * sin(FRAG_PX.y * 2.0944);
    col *= 1.0 + 0.05 * exp(-pow((suv.y - roll) / 0.05, 2.0)) + 0.05 * kick;
    // 弧面的邊緣暗下去
    col *= 1.0 - 0.45 * smoothstep(0.32, 0.62, max(abs(ca.x) / 1.7778 * 1.05, abs(ca.y)));
    fragColor = vec4(col, 1.0);
  }`, { tex: { value: null }, on: { value: 1 }, kick: { value: 0 }, roll: { value: 0 } });

export default class Terminal extends Scene {
  crt = shared('terminal.crt', CRT);
  stage = new Stage();
  scr = this.track(new Layer2D(W, H, undefined, { fast: true }));
  msg: Msg | null = this.ctx.params.message ?? null;
  beat = 0.5;
  cmd = '';
  cmdT: number[] = [];
  tEnter = 0;
  fit: FitResult | null = null;
  outFam = F.ming(700);
  charT: number[] = [];
  typedEnd = 0;
  /** 有留言時歌詞小一級；沒有留言時歌詞是焦點（大）。 */
  st: LyricStyle = { family: F.mono(600), size: 60, minSize: 50, maxWidth: LY_W, lineHeight: 1.12 };

  override async init() {
    const { audio: au, lyrics, song } = this.ctx;
    const s = this.ctx.start, e = this.ctx.end;
    const m = this.msg;
    const beat = this.beat = au.beatPeriod(s + 0.1);
    this.cmd = m ? `cat wishes/${String(m.n).padStart(3, '0')}.txt` : 'cat wishes/';
    if (!m) this.st = { family: F.mono(600), size: 92, minSize: 60, maxWidth: XR - X0, lineHeight: 1.12 };
    await loadText(TEXT + (song.title ?? '') + (m ? m.text + m.name : '') + lyrics.linesIn(s - 2, e + 1).map((l) => l.text).join(''));
    // 打指令：第一拍開始，一個字一個 32 分音符（最慢 0.045 秒），打完在下一拍按 Enter
    const tA = beatAfter(au, s + 0.1);
    const dc = Math.min(beat / 8, 0.045);
    this.cmdT = Array.from(this.cmd, (_, i) => tA + i * dc);
    this.tEnter = beatAfter(au, tA + this.cmd.length * dc + 0.05);
    // 檔案內容：Enter 之後一段一段印出來（十六分音符一組，最多 2.6 秒）
    const c = this.scr.ctx;
    const text = m ? m.text : INVITE;
    this.outFam = m ? F.ming(700) : F.hei(500);
    this.fit = fitText(c, text, this.outFam, XR - X0, MSG_BOT - MSG_TOP - (m ? 90 : 0), m ? { min: 50, max: 124, lineHeight: 1.26, maxLines: 5 } : { min: 30, max: 30, lineHeight: 1.3, maxLines: 2 });
    const n = this.fit.lines.reduce((a, l) => a + Array.from(l).length, 0);
    const dur = clamp(0.045 * n + 0.2, 0.5, 2.6), step = beat / 4;
    const per = Math.ceil(n / Math.max(1, Math.round(dur / step)));
    const t0 = this.tEnter + 0.05;
    this.charT = Array.from({ length: n }, (_, i) => t0 + Math.floor(i / per) * step);
    this.typedEnd = this.charT[n - 1] ?? t0;
  }

  // ---------------------------------------------------------------- 畫字（玻璃座標）
  private draw(t: number) {
    const L = this.scr, c = L.ctx;
    L.clear();
    const au = this.ctx.audio;
    const blink = ((au.beatAt(t) % 1) + 1) % 1 < 0.5;
    c.textBaseline = 'alphabetic';
    const m = this.msg, fit = this.fit!;
    // ---- 1. 指令（配角：小、低對比）
    const typed = this.cmdT.filter((x) => x <= t).length;
    let x = this.prompt(c, X0, CMD_Y);
    c.font = font(F.mono(500), P_SIZE);
    c.fillStyle = PH(0.6);
    const cmdShown = this.cmd.slice(0, typed);
    c.fillText(cmdShown, x, CMD_Y);
    x += c.measureText(cmdShown).width;
    if (t < this.tEnter) this.cursor(c, x, CMD_Y, P_SIZE, blink || typed < this.cmd.length);
    else if (m) {
      // ---- 2. 焦點：留言
      c.font = font(this.outFam, fit.size);
      const top = MSG_TOP + (MSG_BOT - MSG_TOP - 90 - fit.height) / 2 + fit.size * 0.92;
      let idx = 0;
      fit.lines.forEach((ln, li) => {
        let xx = X0;
        const y = top + li * fit.lineHeight;
        for (const ch of Array.from(ln)) {
          const ta = this.charT[idx++] ?? 0;
          const cw = c.measureText(ch).width;
          if (t >= ta) {
            const heat = Math.exp(-(t - ta) / 0.2);
            const to = ch === '♥' ? 'rose' : 'bone';
            c.fillStyle = heat > 0.02 ? mixRgba(to, 'signal', heat, 1) : to === 'rose' ? rgba('rose') : PH(1);
            c.fillText(ch, xx, y);
          }
          xx += cw;
        }
      });
      const done = t >= this.typedEnd + this.beat / 2;
      const ly = top + (fit.lines.length - 1) * fit.lineHeight;
      if (done) {
        label(c, signature(m.name) + (m.couple ? '　（新人）' : ''), X0, ly + 66, F.ming(400), 38, PH(0.7));
        const px = this.prompt(c, X0, ly + 132);
        this.cursor(c, px, ly + 132, P_SIZE, blink);
      }
    } else {
      // 沒有留言：一行錯誤訊息＋邀請（小），焦點交給下面的歌詞
      label(c, 'cat: wishes/: 目前還沒有留言', X0, CMD_Y + 50, F.mono(500), P_SIZE, PH(0.55));
      label(c, INVITE, X0, CMD_Y + 96, F.hei(500), 26, PH(0.55));
      const px = this.prompt(c, X0, CMD_Y + 146);
      this.cursor(c, px, CMD_Y + 146, P_SIZE, blink);
    }
    // ---- 3. 歌詞
    this.drawLyric(c, t);
    L.upload();
  }

  private prompt(c: CanvasRenderingContext2D, x: number, y: number, size = P_SIZE) {
    label(c, PROMPT, x, y, F.mono(600), size, rgba('signal', 0.8));
    return x + measure(PROMPT, F.mono(600), size);
  }
  private cursor(c: CanvasRenderingContext2D, x: number, y: number, size: number, on: boolean) {
    if (!on) return;
    c.fillStyle = rgba('signal', 0.9);
    c.fillRect(x + 2, y - size * 0.82, size * 0.56, size * 0.98);
  }

  /** 歌詞：tail -f 的最新一行。正在唱的字反白，唱完磷光白，還沒唱三成亮。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number) {
    const { lyrics, song } = this.ctx;
    const m = this.msg;
    const baseY = m ? LY_Y : 860;
    label(c, '$ tail -f tonight.log', X0, baseY - (m ? 96 : 160), F.mono(500), 22, PH(0.4));
    const ly = lyricAt(lyrics, t);
    if (ly) {
      const lay = layoutLyric(c, ly.line, this.st);
      const y0 = baseY - lay.rows[lay.rows.length - 1]!.y;
      c.save();
      c.globalAlpha = ly.k;
      this.lyric(c, ly.line, t, lay, X0, y0);
      c.restore();
    } else if (!lyrics.has) {
      label(c, `♪ ${song.title || '今晚的歌'}`, X0, baseY, F.mono(600), m ? 54 : 84, PH(0.85));
    }
  }
  private lyric(c: CanvasRenderingContext2D, line: Line, t: number, lay: LyricLayout, x: number, y: number) {
    c.save();
    c.translate(x, y);
    c.font = font(this.st.family, lay.size);
    // 有留言時歌詞整體暗一點（比留言低一級）
    const dim = this.msg ? 0.78 : 1;
    for (const pw of lay.words) {
      const p = Lyrics.wordProgress(pw.word, t);
      if (p > 0 && p < 1) {
        c.fillStyle = rgba('signal', 0.95);
        c.fillRect(pw.x - 4, pw.y - lay.size * 0.84, pw.w + 8, lay.size * 1.04);
        c.fillStyle = rgba('ink');
      } else c.fillStyle = p >= 1 ? PH(0.95 * dim) : PH(0.28);
      c.fillText(pw.word.w, pw.x, pw.y);
    }
    c.restore();
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start, e = this.ctx.end;
    this.draw(t);
    const u = this.crt.u;
    u.tex!.value = this.scr.upload();
    u.on!.value = ease.outExpo(prog(t, s, s + 0.4));
    u.kick!.value = f.a.kick;
    u.roll!.value = 1 - (((au.barAt(t) % 1) + 1) % 1);
    this.crt.render(renderer, this.stage.rt);
    // 鏡頭：終端機在房間裡、字開頭那側（左）比較近；對焦在留言（沒有留言就是歌詞）
    const mv = camMove(au, s, e, t, { inYaw: 0.12, inZoom: 0.07, push: 0.04, sway: 0.01 });
    const focus: [number, number] = this.msg ? [X0 + 500, (MSG_TOP + MSG_BOT) / 2] : [X0 + 500, 800];
    this.stage.draw(renderer, out, {
      yaw: 0.09 + mv.yaw, pitch: 0.03, roll: -0.004, zoom: 0.86 + mv.zoom, x: 20, y: -12,
      dof: 1.2, focus, bezel: 80, radius: 90, glass: 1.2,
      room: [LIN.ink[0] * 0.55, LIN.ink[1] * 0.55, LIN.ink[2] * 0.55], glow: 0.03,
    });
    return { bloom: 0.8, halation: 0.35, vignette: 0.5, ca: 1.4 };
  }
}

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, family: string, size: number, color: string, align: CanvasTextAlign = 'left') {
  c.font = font(family, size);
  c.fillStyle = color;
  c.textAlign = align;
  c.fillText(text, x, y);
  c.textAlign = 'left';
}
