// 狗狗暴衝（暗、dog）：晚上的客廳，元元、QQ、芃芃三隻繞著地毯暴衝（快歌用），宣文和孟庭坐在後面的沙發上看著笑。角色是 Codex 畫的紙偶（_puppet.ts）。
//  - 開場三隻狗在地毯左邊：兩隻博美擺出「邀玩」的姿勢（前趴、屁股翹高），元元站著原地踏，拍點上壓一下。
//    元元帶頭：小節線前一拍先衝出去，**小節線上剛好跑到前面正中間、一口叼起掉在地上的大抱枕**（博美叼不動的東西），
//    叼著抱枕繼續繞圈；QQ 在小節線衝出去追、芃芃再晚一拍，三隻各差四分之一圈，排成一串追來追去。
//  - 一圈四拍：前面那一側往右跑、後面那一側往左跑（遠的小、近的大），跑到兩端像紙偶一樣翻面轉身。
//    **跳躍都在拍點上**：兩隻博美跑到前面正中間（剛才抱枕的地方）撲起來（QQ 在第二拍＝小鼓、芃芃第三拍），後面正中間小跳一下；
//    元元是大狗，不亂跳，只在後面正中間輕輕一躍。
//    跑步兩張圖半拍換一張、一步一彈；跑得快的時候拖著殘影和速度線。
//  - **歌詞躺在地毯上**（一個字一個字擺），狗從前面跑過去時把字一個一個撞得跳起來再落回去（被撞的字轉一下），跟唱照規則。
//  - **焦點是主打留言**：寫在牆上用紙膠帶貼著的一張紙上（落地燈照著它），上面一行小字「客廳公約　第一條：禁止暴衝」；
//    照「留言尺寸與版面比例標準 v2」：字 40～60、紙最大 640 × 380，高度跟著留言長短，放在畫面左上。沒有留言時紙上寫邀請、字淡，歌詞變主角。
//  - 兩個人坐在沙發上（跟沙發畫在同一張圖）：隔一個小節線（元元叼著抱枕經過前面的那一下）換成大笑、指著狗的那張，每拍跟著輕輕壓一下。
//  - 暗版面：紙偶先畫在暫存畫布上打光（上亮下暗，_c3 的 Lit），狗跟字可以前後交錯，字不會被一起染暗。
//  - 三隻狗用同一個場景尺度（_puppet 的 PUPPET_H 換算：元元比博美大一截）。鏡頭跟著 QQ 輕輕搖、小鼓時推一下。
import * as THREE from 'three';
import { Scene, shared, type Frame, type Msg, type PostOverrides, type PlateSpecDecl } from '../engine/scene';
import { FSPass, Layer2D, W, H } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { F, font, loadText } from '../engine/type';
import { rgba, mixRgba } from '../engine/palette';
import { clamp, ease, prog, lerp, hash } from '../engine/util';
import { lyricAt, barAfter, sparkHead, sparkParticles, msgChars } from './_motifs';
import { inkFor, inkLine, drawNote, type Note } from './_couple';
import { loadPuppets, drawPuppet, drawCycle, drawPick, cycle, puppetShadow, puppetIn, puppetBox, puppetPoint, jumpArc, breathe, beatKick, hop, noteV2, tightenNote, type PuppetOpts } from './_puppet';
import { lyricV2 } from './_v2';
import { Lit, layoutChars, drawChars, INVITE } from './_c3';
import type { Lyrics } from '../engine/lyrics';

export const spec: PlateSpecDecl = { group: 'couple', family: 'dog', paper: false, energy: [0.55, 1], bars: [4, 8] };

/** 場景尺度（宣文站直的身高）；狗是主角，放大。 */
const SZ = 400, DOG_S = 1.55;
/** 跑道：繞著地毯的橢圓（中心、半徑）。前面（下面）那一側 y = cy + ry、後面 y = cy - ry。 */
const TR = { cx: 700, cy: 868, rx: 540, ry: 92 };
/** 牆腳（牆與地板的交界）。 */
const WALL_Y = 712;
/** 沙發（和坐在上面的兩個人）：腳底中心、畫面上的寬。 */
const SOFA = { x: 1190, legs: WALL_Y + 22, w: 470 };
const LAMP = { x: 880, top: 262 };
const WIN = { x: 1000, y: 150, w: 400, h: 300 };
/** 牆上的紙：最大的範圍（標準 v2：≤ 860 × 430；上緣貼膠帶的位置固定、高度跟著留言）與寫字的內距。 */
const NOTE = { x: 150, y: 116, w: 640, h: 380 };
const PAD = { x: 38, top: 66, bottom: 28 };
/** 歌詞躺在地毯上：中心 x、基線、最寬。 */
const LYR = { x: 700, y: 900, w: 740 };
/** 掉在地上的抱枕（前面那一側的正中間）。 */
const PILLOW = { x: 700, y: 962 };
/** 一圈幾拍。 */
const LAP = 4;
const LABEL = '客廳公約　第一條：禁止暴衝';
const DOGS = {
  qq: { run: ['qq_zoomies_1', 'qq_zoomies_2'], bow: 'qq_zoomies_bow' },
  pp: { run: ['pp_zoomies_1', 'pp_zoomies_2'], bow: 'pp_zoomies_bow' },
  // 元元沒有邀玩的圖：站著等（原地踏的彈跳由程式做）
  yy: { run: ['yy_run_1', 'yy_run_2'], bow: 'yy_stand' },
} as const;
const SOFA_POSES = ['cp_zoomies_sofa_1', 'cp_zoomies_sofa_2'];

/** 客廳：牆（上面暖、下面暗）、落地燈照出的一團暖光、地板。用 shader 畫，淡漸層在大螢幕上才不會一條一條的。 */
const ROOM = () => new FSPass(/* glsl */ `
  void main() {
    vec2 p = vec2(FRAG_PX.x, ${H}.0 - FRAG_PX.y);
    float wall = 1.0 - smoothstep(${WALL_Y - 1}.0, ${WALL_Y + 1}.0, p.y);
    vec3 wc = mix(C_INK2, C_INK, 0.35 + 0.4 * p.y / ${WALL_Y}.0);
    vec3 fc = mix(C_INK, C_INK2, 0.25 + 0.35 * clamp((p.y - ${WALL_Y}.0) / 368.0, 0.0, 1.0));
    vec3 col = mix(fc, wc, wall);
    // 落地燈：燈罩附近一團暖光，往牆上與地板散開（牆上的紙與沙發都被照到一點）
    vec2 q = (p - vec2(${LAMP.x}.0, ${LAMP.top + 40}.0)) / vec2(620.0, 420.0);
    float glow = exp(-dot(q, q) * 2.2);
    vec2 r = (p - vec2(${LAMP.x}.0, ${WALL_Y + 40}.0)) / vec2(700.0, 120.0);
    float pool = exp(-dot(r, r) * 2.0) * (1.0 - wall);
    col += mix(C_EMBER, C_BONE, 0.55) * (0.05 * glow + 0.022 * pool);
    col += (hash12(p + 0.5) - 0.5) * 0.004;
    fragColor = vec4(col, 1.0);
  }`);

type Who = 'qq' | 'pp' | 'yy';
const WHO: Who[] = ['yy', 'qq', 'pp'];
/** 每隻狗起跑的拍（相對 QQ 衝出去的小節線）：元元早一拍帶頭、芃芃晚一拍；三隻各差四分之一圈。 */
const START: Record<Who, number> = { yy: -1, qq: 0, pp: 1 };
/** 跑道內外圈：元元身體長，跑內圈（不然跑到兩端會出畫面、碰到右下角 HUD）。 */
const LANE: Record<Who, number> = { yy: 0.84, qq: 1, pp: 1 };
interface DogState { x: number; y: number; lift: number; squash: number; spin: number; rot: number; scale: number; speed: number; dir: number; name: string; bow: boolean; alpha: number }

export default class Zoomies extends Scene {
  room = shared('zoomies.room', ROOM);
  bg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  fg = this.track(new Layer2D(W, H, undefined, { fast: true }));
  glow = this.track(new LineBatch(1024, { screen2D: true, blend: 'add' }));
  lit = new Lit(1300, 900);
  msg: Msg | null = this.ctx.params.message ?? null;
  note: Note | null = null;
  sheet = { ...NOTE };
  /** QQ 衝出去的拍（小節線）：元元早一拍、芃芃晚一拍（START）；元元在這一拍叼起抱枕。 */
  go = 0;
  sofaScale = 1;
  /** 沙發（兩人的鞋底）放在哪個 y：讓沙發腳剛好踩在牆腳前面的地板上。 */
  sofaY = 760;
  sofaKeys: [number, string][] = [];
  lyricSize = 52;
  /** 窗外遠處大樓的窗（x, y, w, h）：拍點上有幾扇亮、幾扇暗。 */
  lights: [number, number, number, number][] = [];

  override async init() {
    const { audio: au } = this.ctx;
    await loadText('一位賓客' + INVITE + LABEL);
    this.track(await loadPuppets([...WHO.flatMap((w) => [...DOGS[w].run, DOGS[w].bow]), ...SOFA_POSES]));
    // 第一個小節線衝出去（窗格太短就下一拍）
    let t0 = barAfter(au, this.ctx.start + 0.35);
    if (this.ctx.end - t0 < au.beatPeriod(t0) * 3) t0 = au.nextBeat(this.ctx.start + 0.35);
    this.go = au.beatAt(t0);
    // 沙發連人的圖照畫面上的寬縮放（Codex 畫的比例每張差一點，用寬度對齊最穩；兩張照同一張的寬，換圖時沙發不會變大變小）
    const box = puppetBox(SOFA_POSES[1]!, 0, 0, { h: SZ });
    this.sofaScale = box[2] > 0 ? SOFA.w / box[2] : 1;
    const legs = puppetPoint(SOFA_POSES[1]!, 'legs', SOFA.x, 0, { h: SZ, scale: this.sofaScale });
    this.sofaY = legs ? SOFA.legs - legs.y : SOFA.legs + 40;
    // 元元叼著抱枕經過前面正中間的那一拍（每一圈的小節線），隔一圈兩個人換成大笑指著狗的那張，一拍半後回來
    const keys: [number, string][] = [[-1e9, SOFA_POSES[0]!]];
    for (let k = 0; k < 64; k++) {
      const tb = au.timeOfBeat(this.beatOfLap('yy', k + 0.25));
      if (tb > this.ctx.end) break;
      if (k % 2 === 0) keys.push([tb - 0.04, SOFA_POSES[1]!], [tb + au.beatPeriod(tb) * 1.6, SOFA_POSES[0]!]);
    }
    this.sofaKeys = keys;
    // 牆上的紙：標準 v2 的字級；紙的寬高跟著留言
    const c = this.fg.ctx;
    const w = NOTE.w - PAD.x * 2, hmax = NOTE.h - PAD.top - PAD.bottom;
    this.note = this.msg ? noteV2(c, this.msg.text, this.msg.name, w, hmax) : noteV2(c, INVITE, null, w, hmax * 0.55, { max: 44 });
    const h = Math.min(NOTE.h, Math.max(210, PAD.top + this.note.height + PAD.bottom + 12));
    const sw = Math.min(NOTE.w, Math.max(tightenNote(c, this.note, 380) + PAD.x * 2, 470));
    this.sheet = { x: NOTE.x, y: NOTE.y, w: sw, h };
    this.lyricSize = lyricV2(this.msg ? this.note.fit.size : null);
    for (let i = 0; i < 26; i++) {
      const x = WIN.x + 20 + hash(i, 1) * (WIN.w - 40), y = WIN.y + 110 + hash(i, 2) * (WIN.h - 130);
      this.lights.push([Math.round(x), Math.round(y), 7, 9]);
    }
    this.drawBackground();
  }

  /** 不會動的：窗（夜空、遠處的大樓剪影）、落地燈、地毯、踢腳板、牆上的紙。 */
  private drawBackground() {
    const L = this.bg, c = L.ctx;
    L.clear();
    const ink = inkFor(false);
    // 窗：窗外是更深的夜空、大樓剪影；窗框細細的
    c.fillStyle = mixRgba('ink', 'leash', 0.08);
    c.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    c.save();
    c.beginPath(); c.rect(WIN.x, WIN.y, WIN.w, WIN.h); c.clip();
    c.fillStyle = rgba('ink', 0.9);
    const towers: [number, number, number][] = [[0, 150, 70], [60, 210, 90], [150, 120, 60], [200, 240, 80], [270, 170, 100], [360, 200, 80]];
    for (const [dx, hgt, w] of towers) c.fillRect(WIN.x + dx, WIN.y + WIN.h - hgt, w, hgt);
    c.restore();
    c.strokeStyle = rgba('bone', 0.2);
    c.lineWidth = 3;
    c.strokeRect(WIN.x, WIN.y, WIN.w, WIN.h);
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(WIN.x + WIN.w / 2, WIN.y); c.lineTo(WIN.x + WIN.w / 2, WIN.y + WIN.h); c.stroke();
    // 踢腳板
    c.fillStyle = rgba('ink', 0.5);
    c.fillRect(0, WALL_Y - 14, W, 14);
    c.strokeStyle = rgba('bone', 0.08);
    c.beginPath(); c.moveTo(0, WALL_Y - 14); c.lineTo(W, WALL_Y - 14); c.stroke();
    // 落地燈：細桿、底座、亮著的燈罩（燈罩是米白色、裡面透光）
    inkLine(c, [{ x: LAMP.x, y: LAMP.top + 70 }, { x: LAMP.x, y: WALL_Y + 20 }], { ink, w: 0.7, color: rgba('bone', 0.35), seed: 3 });
    c.fillStyle = rgba('ink2');
    c.beginPath(); c.ellipse(LAMP.x, WALL_Y + 22, 46, 9, 0, 0, Math.PI * 2); c.fill();
    // 燈罩：上窄下寬、下緣是一道弧（看得到一點點裡面），布料透光：上面暗、下緣最亮
    const T = LAMP.top, B = LAMP.top + 88;
    const g = c.createLinearGradient(0, T, 0, B);
    g.addColorStop(0, mixRgba('bone', 'ember', 0.35, 0.55));
    g.addColorStop(1, mixRgba('bone', 'ember', 0.35, 0.92));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(LAMP.x - 50, T); c.lineTo(LAMP.x + 50, T); c.lineTo(LAMP.x + 80, B);
    c.ellipse(LAMP.x, B, 80, 12, 0, 0, Math.PI);
    c.closePath();
    c.fill();
    c.fillStyle = mixRgba('ember', 'bone', 0.4);
    c.beginPath(); c.ellipse(LAMP.x, B, 78, 10, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = rgba('bone', 0.35);
    c.lineWidth = 1.2;
    c.beginPath(); c.ellipse(LAMP.x, T, 50, 7, 0, Math.PI, Math.PI * 2); c.stroke();
    // 地毯：扁扁的橢圓，兩圈淡淡的邊
    c.save();
    c.translate(TR.cx, TR.cy);
    c.scale(1, 66 / 440);
    c.fillStyle = mixRgba('ink2', 'fur', 0.1);
    c.beginPath(); c.arc(0, 0, 440, 0, Math.PI * 2); c.fill();
    c.lineWidth = 6;
    c.strokeStyle = rgba('bone', 0.07);
    c.beginPath(); c.arc(0, 0, 410, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(0, 0, 330, 0, Math.PI * 2); c.stroke();
    c.restore();
    this.drawSheet(c);
    L.upload();
  }

  /** 牆上的紙：米白、往右下的影子、上緣一條紙膠帶、左上角一行小字。 */
  private drawSheet(c: CanvasRenderingContext2D) {
    const S = this.sheet;
    c.fillStyle = rgba('ink', 0.55);
    c.fillRect(S.x + 10, S.y + 14, S.w, S.h);
    const g = c.createLinearGradient(S.x, 0, S.x + S.w, 0);
    // 燈在右邊：紙的右半邊亮一點
    g.addColorStop(0, mixRgba('bone', 'ink', 0.2));
    g.addColorStop(1, mixRgba('bone', 'cream', 0.3));
    c.fillStyle = g;
    c.fillRect(S.x, S.y, S.w, S.h);
    c.fillStyle = mixRgba('shirtblue', 'bone', 0.35, 0.8);
    c.save();
    c.translate(S.x + S.w / 2, S.y + 2);
    c.rotate(-0.03);
    c.fillRect(-70, -14, 140, 28);
    c.restore();
    c.font = font(F.hei(500), 18);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('sepia', 0.55);
    c.fillText(LABEL, S.x + PAD.x, S.y + 46);
    c.letterSpacing = '0px';
  }

  /** 狗在第幾圈的哪裡（圈數，0 = 左端、0.25 = 前面正中間、0.5 = 右端、0.75 = 後面正中間）；還沒衝出去是 null。 */
  private lapAt(who: Who, t: number): number | null {
    const b = this.ctx.audio.beatAt(t) - this.go - START[who];
    return b < 0 ? null : b / LAP;
  }

  /** 這隻狗跑到第 u 圈（圈數）的那一拍。 */
  private beatOfLap(who: Who, u: number) {
    return this.go + START[who] + LAP * u;
  }

  /** 元元叼起抱枕的時間（牠第一次跑到前面正中間＝QQ 衝出去的小節線）。 */
  private get grabT() {
    return this.ctx.audio.timeOfBeat(this.beatOfLap('yy', 0.25));
  }

  /** 跑道上的位置：左端出發、前面往右、後面往左。 */
  private trackPos(u: number, who: Who) {
    const a = u * Math.PI * 2, k = LANE[who];
    return { x: TR.cx - TR.rx * k * Math.cos(a), y: TR.cy + TR.ry * k * Math.sin(a) };
  }

  /** 一隻狗這一格的樣子。 */
  private dogAt(who: Who, t: number): DogState {
    const au = this.ctx.audio, s = this.ctx.start;
    const D = DOGS[who];
    const ent = puppetIn(t, s + (who === 'yy' ? 0.04 : who === 'qq' ? 0.12 : 0.22), 0.42);
    const u = this.lapAt(who, t);
    // 等的時候三隻錯開（QQ 在後面右邊、元元在中間、芃芃在前面左邊），不要疊在一起
    const wait = who === 'qq' ? { x: TR.cx - TR.rx + 300, y: TR.cy - 44 } : who === 'yy' ? { x: TR.cx - TR.rx + 90, y: TR.cy - 4 } : { x: TR.cx - TR.rx - 50, y: TR.cy + 44 };
    const depth = (y: number) => DOG_S * lerp(0.84, 1.12, clamp((y - (TR.cy - TR.ry)) / (TR.ry * 2)));
    if (u === null) {
      // 邀玩：前趴、屁股翹高，拍點上壓一下（快要衝的時候更低）
      const k = beatKick(au, t, 0.22);
      // 元元站著：拍點上往上彈一下（興奮地原地踏）；博美前趴壓低
      const lift = who === 'yy' ? 7 * k : 0;
      return { x: wait.x, y: wait.y, lift, squash: (who === 'yy' ? -0.03 : 0.06) * k + breathe(t, 0.02, 0.9, who === 'qq' ? 0 : 0.5), spin: ent.spin, rot: 0, scale: depth(wait.y), speed: 0, dir: 1, name: D.bow, bow: true, alpha: ent.alpha };
    }
    let p = this.trackPos(u, who);
    // 剛起跑：從等的位置接上跑道
    const tStart = au.timeOfBeat(this.go + START[who]);
    const blend = clamp((t - tStart) / 0.18);
    if (blend < 1) p = { x: lerp(wait.x, p.x, ease.outCubic(blend)), y: lerp(wait.y, p.y, ease.outCubic(blend)) };
    const v = u - Math.floor(u);
    // 兩端像紙偶一樣翻面：右端（0.5）翻成朝左，左端（0 / 1）翻回朝右
    const vv = v < 0.07 ? v + 1 : v;
    const S = (x: number) => ease.inOutCubic(clamp(x));
    const spin = 0.5 * S((vv - 0.43) / 0.14) + 0.5 * S((vv - 0.93) / 0.14);
    const speed = Math.abs(Math.sin(v * Math.PI * 2));
    const dir = v < 0.5 ? 1 : -1;
    // 跳：博美在前面正中間撲起來（大跳）、後面正中間小跳；元元在前面正中間叼抱枕，只在後面正中間輕輕一躍。頂點在拍點（第 k 圈的 0.25、0.75）
    const lap = Math.floor(u);
    let lift = 0, squash = 0, air = false, tilt = 0.04;
    const bp = au.beatPeriod(t);
    const hops: readonly (readonly [number, number])[] = who === 'yy' ? [[0.75, 26]] : [[0.25, 96], [0.75, 38]];
    for (const [ph, hgt] of hops) {
      for (const k of [lap - 1, lap, lap + 1]) {
        const tc = au.timeOfBeat(this.beatOfLap(who, k + ph));
        const half = Math.min(0.24, bp * (ph === 0.25 ? 0.46 : 0.3));
        if (t < tc - half - 0.15 || t > tc + half + 0.3) continue;
        const j = jumpArc(t, tc - half, tc + half, hgt, { crouch: 0.05, stretch: 0.1, land: 0.14 });
        // 空中：起跳抬頭、落地低頭（跳得越高轉越多）
        if (j.air) { lift = -j.y; air = true; tilt = (-0.22 + 0.44 * j.u) * (hgt / 96); }
        squash += j.squash;
      }
    }
    const bob = air ? 0 : hop(au.beatAt(t), 2) * 8 * speed;
    const scale = depth(p.y);
    // 身體往前傾一點；朝左跑（後面那一側）的時候「往前」是反方向
    const rot = tilt * dir;
    const name = air ? D.run[0]! : '';
    return { x: p.x, y: p.y, lift: lift + bob, squash, spin, rot, scale, speed: blend < 1 ? speed * blend : speed, dir, name, bow: false, alpha: 1 };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, lyrics, audio: au } = this.ctx;
    const t = f.t, s = this.ctx.start;
    this.room.render(renderer, out);
    comp.draw(renderer, this.bg.texture, out);
    const L = this.fg; L.clear();
    const c = L.ctx;
    this.glow.clear();
    const rv = prog(t, s, s + 0.6, ease.inOutCubic);

    // 窗外的燈：每兩拍換一批亮著的
    const phase = Math.floor(au.beatAt(t) / 2);
    c.fillStyle = mixRgba('ember', 'bone', 0.3, 0.5);
    this.lights.forEach(([x, y, w, h], i) => { if (hash(i, phase) > 0.45) c.fillRect(x, y, w, h); });

    this.drawNoteText(c, t);

    // ---- 沙發上的兩個人（打光：燈在左邊上方）
    const ent = puppetIn(t, s + 0.04, 0.5);
    if (ent.alpha > 0) {
      const o: PuppetOpts = { h: SZ, scale: this.sofaScale, squash: 0.012 * beatKick(au, t, 0.25) + breathe(t, 0.006, 3.1), spin: ent.spin, alpha: ent.alpha };
      puppetShadow(c, 'cp', SOFA.x, SOFA.legs + 4, { h: SZ * this.sofaScale, wide: 1.6, alpha: 0.6 * ent.alpha, color: '0,0,0' });
      const bx = puppetBox(SOFA_POSES[1]!, SOFA.x, this.sofaY, { ...o, spin: 0 });
      this.lit.draw(c, [bx[0] - 20, bx[1] - 20, bx[2] + 40, bx[3] + 30], rgba('ink', 0.1), rgba('ink', 0.5), (sc) => { drawPick(sc, this.sofaKeys, t, SOFA.x, this.sofaY, o); });
    }

    // ---- 三隻狗：照遠近排（遠的先畫）；歌詞夾在中間（遠的在字後面、近的從字前面跑過去）
    const dogs = WHO.map((w) => ({ who: w, st: this.dogAt(w, t) })).sort((a, b) => a.st.y - b.st.y);
    let lyricDone = false;
    for (const d of dogs) {
      if (!lyricDone && d.st.y >= LYR.y) { this.drawLyric(c, t, lyrics, rv); this.drawPillow(c, t); lyricDone = true; }
      this.drawDog(c, t, d.who, d.st);
    }
    if (!lyricDone) { this.drawLyric(c, t, lyrics, rv); this.drawPillow(c, t); }

    comp.draw(renderer, L.upload(), out);
    if (this.glow.count) this.glow.render(renderer, out);
    // 鏡頭：跟著 QQ 輕輕搖，小鼓推一下
    const q = this.dogAt('qq', t);
    return { bloom: 0.55, vignette: 0.5, grain: 0.05, zoom: 1.012 + 0.01 * f.a.snare, shake: [-(q.x - TR.cx) * 0.012, 0] };
  }

  /** 一隻狗：影子、速度線、殘影、本體（打光）。 */
  private drawDog(c: CanvasRenderingContext2D, t: number, who: Who, st: DogState) {
    const au = this.ctx.audio;
    if (st.alpha <= 0) return;
    const o: PuppetOpts = { h: SZ, scale: st.scale, squash: st.squash, spin: st.spin, rot: st.rot, pivot: 0.5, alpha: 1 };
    puppetShadow(c, who, st.x, st.y, { h: SZ * st.scale, lift: st.lift, alpha: 0.55 * st.alpha, color: '0,0,0' });
    const y = st.y - st.lift;
    const dh = SZ * (who === 'yy' ? 0.36 : 0.27) * st.scale;
    // 速度線：身體後面幾條水平的淡線，跑越快越長
    if (st.speed > 0.35) {
      const len = 150 * st.speed, tail = st.x - st.dir * dh * 0.9;
      c.save();
      c.lineCap = 'round';
      c.lineWidth = 2.4;
      [0.3, 0.52, 0.74].forEach((k, i) => {
        const jit = (hash(i, Math.floor(t * 12)) - 0.5) * 30;
        const g = c.createLinearGradient(tail, 0, tail - st.dir * (len + jit), 0);
        g.addColorStop(0, rgba('bone', 0.3 * st.speed));
        g.addColorStop(1, rgba('bone', 0));
        c.strokeStyle = g;
        c.beginPath(); c.moveTo(tail - st.dir * 10, y - dh * k); c.lineTo(tail - st.dir * (len + jit), y - dh * k); c.stroke();
      });
      c.restore();
    }
    // 殘影：前幾個瞬間的位置（同一張圖，越舊越淡）
    const ghosts: { dx: number; dy: number; a: number }[] = [];
    if (!st.bow && st.speed > 0.3) {
      for (const [k, a] of [[3, 0.08], [2, 0.16], [1, 0.28]] as const) {
        const p = this.dogAt(who, t - 0.028 * k);
        ghosts.push({ dx: p.x - st.x, dy: (p.y - p.lift) - y, a: a * st.speed });
      }
    }
    const nm = st.bow ? DOGS[who].bow : st.name;
    const box = puppetBox(st.bow ? nm : DOGS[who].run[0]!, st.x, y, { ...o, spin: 0, rot: 0 });
    const pad = 30;
    this.lit.draw(c, [box[0] - pad, box[1] - pad, box[2] + pad * 2, box[3] + pad * 2], rgba('ink', 0.02), rgba('ink', 0.42), (sc) => {
      if (nm) drawPuppet(sc, nm, st.x, y, o);
      else drawCycle(sc, au, t, DOGS[who].run, 2, st.x, y, o);
    }, { alpha: st.alpha, ghosts });
    // 元元叼著抱枕：抱枕跟著嘴（圖上量好的 mouth 點），叼起的那一下從地上被甩上來
    if (who === 'yy' && t >= this.grabT) {
      const frame = nm || cycle(DOGS.yy.run, au.beatAt(t), 2);
      const m = puppetPoint(frame, 'mouth', st.x, y, o);
      if (m) {
        const k = ease.outBack(clamp((t - this.grabT) / 0.14));
        const face = Math.cos(st.spin * Math.PI * 2);
        const hx = m.x + 16 * (st.scale / DOG_S) * Math.sign(face || 1), hy = m.y + 30 * (st.scale / DOG_S);
        this.pillow(c, lerp(PILLOW.x, hx, k), lerp(PILLOW.y, hy, k), (st.scale / DOG_S) * 0.9, st.rot + (1 - k) * 0.6, face);
      }
    }
    // 進場：從側面翻正（仙女棒的火花在腳邊）
    if (st.bow && st.alpha < 1) {
      sparkHead(this.glow, st.x, st.y - 4, t, 0.7);
      sparkParticles(this.glow, t, () => ({ x: st.x, y: st.y - 4 }), { rate: 50, life: 0.25, speed: 140, seed: who === 'qq' ? 3 : who === 'pp' ? 4 : 5 });
    }
  }

  /** 掉在地上的抱枕（元元叼起來之前）：元元跑過來的最後一拍抖一下。 */
  private drawPillow(c: CanvasRenderingContext2D, t: number) {
    const g = this.grabT;
    if (t >= g) return;
    const d = t - (g - this.ctx.audio.beatPeriod(t));
    const wob = d > 0 ? Math.sin(d * 30) * 0.06 * Math.min(1, d / 0.5) : 0;
    this.pillow(c, PILLOW.x, PILLOW.y, 1, wob, 1);
  }

  /** 一個蓬蓬的方抱枕（四個角尖尖的、中間鼓起來），上亮下暗；(x, y) 是底邊中間。face：紙偶翻面時寬度跟著縮。 */
  private pillow(c: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, face: number) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.scale(s * Math.max(0.08, Math.abs(face)), s);
    c.fillStyle = rgba('ink', 0.5);
    c.beginPath(); c.ellipse(0, 2, 44, 7, 0, 0, Math.PI * 2); c.fill();
    const g = c.createLinearGradient(0, -40, 0, 4);
    g.addColorStop(0, mixRgba('shirtblue', 'bone', 0.2, 0.8));
    g.addColorStop(1, mixRgba('shirtblue', 'ink', 0.6, 0.9));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(-44, 0);
    c.bezierCurveTo(-50, -14, -44, -30, -40, -38);
    c.bezierCurveTo(-14, -30, 14, -30, 40, -38);
    c.bezierCurveTo(44, -30, 50, -14, 44, 0);
    c.bezierCurveTo(14, 6, -14, 6, -44, 0);
    c.fill();
    c.strokeStyle = rgba('bone', 0.18);
    c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(-38, -18); c.quadraticCurveTo(0, -24, 38, -18); c.stroke();
    c.restore();
  }

  /** 地毯上的歌詞：一個字一個字擺，狗從前面跑過去時把字撞得跳起來（轉一下）再落回去。 */
  private drawLyric(c: CanvasRenderingContext2D, t: number, lyrics: Lyrics, rv: number) {
    const ly = lyricAt(lyrics, t);
    if (!ly) return;
    const au = this.ctx.audio;
    const fam = F.archivo(100, this.msg ? 600 : 700);
    const lay = layoutChars(c, ly.line, fam, this.lyricSize, LYR.w, 40);
    const x0 = LYR.x - lay.width / 2;
    // 每隻狗在前面那一側經過某個 x 的時間：cos(2πu) = (cx - x) / rx，u 在 0..0.5
    const bumps: number[] = [];
    const bumpAt = (i: number, cx: number) => {
      let best = 0, rot = 0;
      for (const who of WHO) {
        const u = this.lapAt(who, t);
        if (u === null) continue;
        const us = Math.acos(clamp((TR.cx - (cx - 40)) / (TR.rx * LANE[who]), -1, 1)) / (Math.PI * 2);
        for (const k of [Math.floor(u) - 1, Math.floor(u)]) {
          if (k + us < 0) continue;
          const tb = au.timeOfBeat(this.beatOfLap(who, k + us));
          // 被撞到的字飛起來再落下（0.34 秒）：狗跑一趟，字一個接一個跳，像一道浪跟在狗後面
          const d = (t - tb) / 0.34;
          if (d < 0 || d >= 1) continue;
          const hgt = 96 + 34 * hash(i, k);
          const y = hgt * 4 * d * (1 - d);
          if (y > best) { best = y; rot = (hash(i, k, 7) - 0.5) * 0.9 * Math.sin(Math.PI * d); }
        }
      }
      bumps[i] = best;
      return best > 0.5 ? { dy: -best, rot, s: 1 + best / 900 } : null;
    };
    c.save();
    c.globalAlpha = ly.k * rv;
    // 字躺在地毯上：底下一點點影子（字被撞起來時影子留在原地、變小）
    drawChars(c, ly.line, lay, fam, x0, LYR.y, t, { unsung: rgba('bone', 0.28), sung: rgba('bone', this.msg ? 0.82 : 0.95), active: rgba('signal') }, bumpAt);
    c.restore();
  }

  /** 牆上紙的留言：第一拍起一個字一個字寫上去（深墨手寫字），寫完署名淡入。 */
  private drawNoteText(c: CanvasRenderingContext2D, t: number) {
    const n = this.note;
    if (!n) return;
    const S = this.sheet;
    const t0 = this.ctx.start + 0.5;
    const total = msgChars(n.fit);
    const per = clamp(1.5 / Math.max(1, total), 0.03, 0.1);
    const done = t0 + total * per;
    const top = S.y + PAD.top, h = S.h - PAD.top - PAD.bottom;
    c.save();
    c.globalAlpha = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.5);
    drawNote(c, n, S.x + PAD.x, top + Math.max(0, (h - n.height) * 0.45), {
      chars: this.msg ? (t - t0) / per : Infinity, color: this.msg ? rgba('sepia', 0.95) : rgba('sepia', 0.62), sigColor: rgba('sepia', 0.74), sigK: prog(t, done + 0.1, done + 0.5),
    });
    c.restore();
  }
}
