// 批次 C8（籃球賽：courtside、kisscam、buzzer、halftime、basketball）共用的場景零件。
// 人和狗一律是 Codex 畫的紙偶（_puppet.ts、素材組 hoops）；這裡只有**程式畫的配角與道具**：
//  - 球員、觀眾的剪影（新人要求：球場上的其他人畫成剪影，不畫真實球隊、聯盟的名稱或標誌）；
//  - 籃框（側面）、籃球、爆米花、場館的看台座椅。
// 剪影故意畫得簡單：幾塊有粗細的形狀＋一顆頭，顏色只比背景暗一點點、頂上一道很淡的輪廓光，遠看就是「有人在跑」，
// 不會跟新人（紙偶，唯一有細節的角色）搶焦點。全部只看傳進來的 t／拍點／種子，確定性沒問題。
import { clamp, hash, lerp } from '../engine/util';
import { mixRgba, rgba } from '../engine/palette';
import { font } from '../engine/type';

type Ctx = CanvasRenderingContext2D;
export type Pt = { x: number; y: number };

// ---------------------------------------------------------------- 球員剪影
export type PlayerPose = 'run' | 'dribble' | 'jump' | 'defend' | 'stand' | 'cheer';
export interface PlayerOpts {
  /** 身高（px）。 */
  h: number;
  /** 跑步的相位（弧度；一步 = π）。 */
  ph?: number;
  pose?: PlayerPose;
  /** 朝左。 */
  flip?: boolean;
  fill: string;
  /** 頂上的輪廓光（場館的燈從上面打下來）；不給就不畫。 */
  rim?: string;
  /** 身體往前傾（弧度）。 */
  lean?: number;
}

interface Limb { a: number; b: number }
interface Skel { lean: number; legs: [Limb, Limb]; arms: [Limb, Limb] }

/** 各種姿勢的關節角度（0 = 往下垂、正 = 往前）：前後兩隻腳、兩隻手；跑步用相位算。 */
function skeleton(pose: PlayerPose, ph: number): Skel {
  const s = Math.sin(ph);
  switch (pose) {
    case 'run':
    case 'dribble': {
      const amp = pose === 'run' ? 0.62 : 0.4;
      const leg = (k: number): Limb => ({ a: amp * k * s, b: -0.25 - 1.05 * Math.max(0, -k * s) });
      const arm = (k: number): Limb => ({ a: -0.6 * k * s, b: 1.1 });
      return {
        lean: pose === 'run' ? 0.2 : 0.3,
        legs: [leg(1), leg(-1)],
        // 運球：前面那隻手往前下方拍球，另一隻手護球
        arms: pose === 'dribble' ? [{ a: 0.55, b: -0.1 + 0.25 * Math.max(0, s) }, { a: 0.9, b: 0.9 }] : [arm(1), arm(-1)],
      };
    }
    case 'jump':
      return { lean: -0.05, legs: [{ a: 0.55, b: -1.3 }, { a: 0.15, b: -0.8 }], arms: [{ a: Math.PI - 0.15, b: 0 }, { a: 2.3, b: 0.4 }] };
    case 'defend':
      return { lean: 0.12, legs: [{ a: 0.45, b: -0.75 }, { a: -0.35, b: -0.5 }], arms: [{ a: 1.9, b: 0.3 }, { a: -1.9, b: -0.3 }] };
    case 'cheer':
      return { lean: -0.05, legs: [{ a: 0.12, b: -0.1 }, { a: -0.12, b: -0.1 }], arms: [{ a: 2.7, b: 0.2 }, { a: -2.7, b: -0.2 }] };
    default:
      // 站著：兩腳微開、膝蓋微彎、手離開身體一點（不然剪影會變成一根柱子）
      return { lean: 0.08, legs: [{ a: 0.22, b: -0.3 }, { a: -0.08, b: -0.02 }], arms: [{ a: 0.35, b: 0.55 }, { a: -0.25, b: 0.45 }] };
  }
}

interface PlayerPts { hip: Pt; neck: Pt; head: Pt; legs: Pt[][]; arms: Pt[][]; hand: Pt }

/** 一個球員剪影的關節位置（畫面座標）：(x, y) 是腳底，最低的那隻腳踩在 y 上（跑步時換腳，身體自然一上一下）。 */
export function playerPose(x: number, y: number, o: PlayerOpts): PlayerPts {
  const h = o.h, dir = o.flip ? -1 : 1;
  const sk = skeleton(o.pose ?? 'stand', o.ph ?? 0);
  const lean = sk.lean + (o.lean ?? 0);
  const TH = 0.25 * h, SH = 0.25 * h, UA = 0.17 * h, FA = 0.16 * h, TORSO = 0.3 * h;
  // 從髖關節往下算腳，再把最低的腳放到地上
  const at = (p: Pt, ang: number, len: number): Pt => ({ x: p.x + Math.sin(ang) * len * dir, y: p.y + Math.cos(ang) * len });
  const hip0 = { x: 0, y: 0 };
  const legs = sk.legs.map((l) => { const k = at(hip0, l.a, TH); return [hip0, k, at(k, l.a + l.b, SH)] as Pt[]; });
  const floor = Math.max(...legs.map((l) => l[2]!.y));
  const dy = y - floor;
  const mv = (p: Pt): Pt => ({ x: x + p.x, y: p.y + dy });
  const hip = mv(hip0);
  const neck = { x: hip.x + Math.sin(lean) * TORSO * dir, y: hip.y - Math.cos(lean) * TORSO };
  const head = { x: neck.x + Math.sin(lean) * 0.085 * h * dir, y: neck.y - 0.085 * h };
  const sh = { x: lerp(hip.x, neck.x, 0.92), y: lerp(hip.y, neck.y, 0.92) };
  const arms = sk.arms.map((l) => { const e = at(sh, l.a, UA); return [sh, e, at(e, l.a + l.b, FA)] as Pt[]; });
  return { hip, neck, head, legs: legs.map((l) => l.map(mv)), arms, hand: arms[0]![2]! };
}

/**
 * 一個球員的剪影：(x, y) 是腳底（跳起來時自己把 y 往上移）。回傳前面那隻手與頭的位置（接籃球用）。
 * 身體用幾塊有粗細的形狀拼起來（大腿比小腿粗、肩膀比腰寬、球褲、球鞋、頭是稍長的橢圓），不然遠看像火柴人。
 * 每一塊各自 fill（同一條 path 疊在一起的地方方向相反會被挖空）。
 */
export function drawPlayer(c: Ctx, x: number, y: number, o: PlayerOpts): { hand: Pt; head: Pt } {
  const h = o.h, dir = o.flip ? -1 : 1;
  const { hip, neck, head, legs: legPts, arms } = playerPose(x, y, o);
  // 有粗細的一段（兩端圓頭）
  const limb = (a: Pt, b: Pt, w0: number, w1: number) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    c.beginPath();
    c.moveTo(a.x + (nx * w0) / 2, a.y + (ny * w0) / 2);
    c.lineTo(b.x + (nx * w1) / 2, b.y + (ny * w1) / 2);
    c.lineTo(b.x - (nx * w1) / 2, b.y - (ny * w1) / 2);
    c.lineTo(a.x - (nx * w0) / 2, a.y - (ny * w0) / 2);
    c.closePath();
    c.fill();
    c.beginPath(); c.arc(a.x, a.y, w0 / 2, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(b.x, b.y, w1 / 2, 0, Math.PI * 2); c.fill();
  };
  const leg = (l: Pt[]) => {
    limb(l[0]!, l[1]!, 0.085 * h, 0.062 * h);
    limb(l[1]!, l[2]!, 0.058 * h, 0.042 * h);
    // 球鞋：腳底往前一點的扁橢圓
    c.beginPath(); c.ellipse(l[2]!.x + 0.025 * h * dir, l[2]!.y - 0.012 * h, 0.05 * h, 0.022 * h, 0, 0, Math.PI * 2); c.fill();
  };
  const arm = (l: Pt[]) => {
    limb(l[0]!, l[1]!, 0.05 * h, 0.04 * h);
    limb(l[1]!, l[2]!, 0.038 * h, 0.03 * h);
  };
  const body = (oy: number, col: string) => {
    c.save();
    c.translate(0, oy);
    c.fillStyle = col;
    leg(legPts[1]!);
    arm(arms[1]!);
    // 軀幹：腰窄、肩膀寬（沿著身體的方向）
    const ax = neck.x - hip.x, ay = neck.y - hip.y, L = Math.hypot(ax, ay) || 1, nx = -ay / L, ny = ax / L;
    const top = { x: lerp(hip.x, neck.x, 0.9), y: lerp(hip.y, neck.y, 0.9) };
    c.beginPath();
    c.moveTo(hip.x + nx * 0.07 * h, hip.y + ny * 0.07 * h);
    c.lineTo(top.x + nx * 0.1 * h, top.y + ny * 0.1 * h);
    c.quadraticCurveTo(neck.x, neck.y - 0.02 * h, top.x - nx * 0.1 * h, top.y - ny * 0.1 * h);
    c.lineTo(hip.x - nx * 0.07 * h, hip.y - ny * 0.07 * h);
    c.closePath();
    c.fill();
    // 球褲
    c.beginPath(); c.ellipse(hip.x + 0.01 * h * dir, hip.y + 0.035 * h, 0.09 * h, 0.075 * h, 0, 0, Math.PI * 2); c.fill();
    // 脖子、頭
    limb(neck, head, 0.04 * h, 0.04 * h);
    c.beginPath(); c.ellipse(head.x, head.y, 0.052 * h, 0.062 * h, 0, 0, Math.PI * 2); c.fill();
    leg(legPts[0]!);
    arm(arms[0]!);
    c.restore();
  };
  if (o.rim) body(-Math.max(1.5, h * 0.007), o.rim);
  body(0, o.fill);
  return { hand: arms[0]![2]!, head };
}

// ---------------------------------------------------------------- 觀眾剪影
export interface Fan { x: number; y: number; r: number; s: number }
/** 一片看台的觀眾（排好的座位，後排小一點、高一點）。rows 由前往後。 */
export function makeCrowd(x0: number, x1: number, yFront: number, rows: number, o: { r: number; gap: number; rowH: number; shrink?: number; seed?: number; skip?: (x: number, y: number) => boolean }): Fan[] {
  const out: Fan[] = [];
  for (let row = 0; row < rows; row++) {
    const k = Math.pow(o.shrink ?? 0.93, row);
    const r = o.r * k, gap = o.gap * k;
    const y = yFront - row * o.rowH * (0.5 + 0.5 * k);
    const off = (row % 2) * gap * 0.5;
    for (let x = x0 + off; x < x1; x += gap) {
      const s = hash(row, Math.round(x), o.seed ?? 1);
      if (s < 0.12) continue; // 空位
      const fx = x + (hash(row, Math.round(x), 7) - 0.5) * gap * 0.3;
      if (o.skip?.(fx, y)) continue;
      out.push({ x: fx, y, r: r * (0.85 + 0.3 * hash(row, Math.round(x), 3)), s });
    }
  }
  return out;
}

/**
 * 畫觀眾：頭＋肩膀的剪影。bounce = 這一格每個人跟著拍子上下的量（0..1），cheer = 歡呼的程度（0..1：站起來、手舉高）。
 * 一排一個 path 填色，幾百個人也很快。
 */
export function drawCrowd(c: Ctx, fans: readonly Fan[], o: { fill: string | CanvasGradient; rim?: string; bounce: number; cheer: number; t: number }) {
  const lift = (f: Fan) => f.r * (o.bounce * 0.35 * (0.4 + f.s) + o.cheer * (0.9 + 0.8 * f.s) * (0.6 + 0.4 * Math.sin(o.t * 9 + f.s * 20)));
  const shape = (dy: number, col: string | CanvasGradient) => {
    c.fillStyle = col;
    c.beginPath();
    for (const f of fans) {
      const y = f.y - lift(f) + dy;
      c.moveTo(f.x + f.r, y);
      c.arc(f.x, y, f.r, 0, Math.PI * 2);
      c.moveTo(f.x + f.r * 2.1, y + f.r * 3.2);
      c.ellipse(f.x, y + f.r * 3.2, f.r * 2.1, f.r * 1.9, 0, Math.PI, 0);
    }
    c.fill();
    // 歡呼的人把手舉起來（兩條短短的粗線）
    if (o.cheer > 0.05) {
      c.strokeStyle = col;
      c.lineCap = 'round';
      c.beginPath();
      for (const f of fans) {
        if (f.s < 0.35) continue;
        const y = f.y - lift(f) + dy, up = f.r * 3.2 * o.cheer * (0.7 + 0.5 * f.s), sw = Math.sin(o.t * 7 + f.s * 30) * f.r * 0.8;
        c.moveTo(f.x - f.r * 1.3, y + f.r * 1.6); c.lineTo(f.x - f.r * 1.8 + sw, y + f.r * 1.6 - up);
        c.moveTo(f.x + f.r * 1.3, y + f.r * 1.6); c.lineTo(f.x + f.r * 1.8 + sw, y + f.r * 1.6 - up);
      }
      c.lineWidth = Math.max(2, (fans[0]?.r ?? 6) * 0.7);
      c.stroke();
    }
  };
  if (o.rim) shape(-1.5, o.rim);
  shape(0, o.fill);
}

/**
 * 預先畫好的一整片觀眾：幾百個人每格重畫一次要 4～9 ms（圓形與橢圓的 path 很多），
 * 所以在 init 先畫四張（坐著、跟拍子彈起來、歡呼 A、歡呼 B），每格只貼一張圖：
 * 平常照拍點在「坐著／彈起來」之間換（每個人彈的高度本來就不一樣，看起來是各自在動），歡呼時 A、B 輪流（手揮來揮去）。
 * 解析度最多 1 倍（是很暗的背景，4K 輸出時糊一點也看不出來，省記憶體）。
 */
export class CrowdLayer {
  private states: HTMLCanvasElement[] = [];
  private box = { x: 0, y: 0, w: 1, h: 1 };
  constructor(fans: readonly Fan[], fill: (c: Ctx) => string | CanvasGradient, rim: string | undefined, scale: number) {
    if (!fans.length) return;
    const pad = (f: Fan) => f.r * 2.3;
    const x0 = Math.min(...fans.map((f) => f.x - pad(f))), x1 = Math.max(...fans.map((f) => f.x + pad(f)));
    const y0 = Math.min(...fans.map((f) => f.y - f.r * 6.5)), y1 = Math.max(...fans.map((f) => f.y + f.r * 5.3));
    const k = Math.min(1, scale);
    this.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    for (const [bounce, cheer, t] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 0.33]] as const) {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil((x1 - x0) * k); cv.height = Math.ceil((y1 - y0) * k);
      const c = cv.getContext('2d')!;
      c.scale(k, k);
      c.translate(-x0, -y0);
      drawCrowd(c, fans, { fill: fill(c), rim, bounce, cheer, t });
      this.states.push(cv);
    }
  }
  /** bounce：跟拍子彈的量（0..1），cheer：歡呼（0..1），t：歌曲時間（歡呼時手揮的節奏）。 */
  draw(c: Ctx, o: { bounce: number; cheer: number; t: number; alpha?: number }) {
    if (!this.states.length) return;
    const i = o.cheer > 0.35 ? 2 + (Math.floor(o.t * 7) % 2) : o.bounce > 0.45 ? 1 : 0;
    const B = this.box;
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.drawImage(this.states[i]!, B.x, B.y, B.w, B.h);
    c.restore();
  }
}

/**
 * 觀眾的顏色：後排（上面）幾乎跟看台一樣暗、前排亮一點——整片觀眾是背景的空氣，不是一面花紋牆。
 * 漸層在 init 做一次（同一個畫布每格都能用）。
 */
export function crowdShade(c: Ctx, yTop: number, yBottom: number): CanvasGradient {
  const g = c.createLinearGradient(0, yTop, 0, yBottom);
  g.addColorStop(0, rgba('ink2', 0.1));
  g.addColorStop(0.6, rgba('ink2', 0.45));
  g.addColorStop(1, mixRgba('ink', 'ink2', 0.8));
  return g;
}

// ---------------------------------------------------------------- 籃球
/**
 * 籃球：橘色（博美的橘毛混一點訊號色的暗部）、四條黑線，rot 是轉了幾圈（線跟著轉）。
 * light：光從左上方來（右下暗一點）；dark 版面把整顆壓暗一點，才不會比留言還亮。
 */
export function basketball(c: Ctx, x: number, y: number, r: number, rot = 0, o: { dark?: boolean; alpha?: number } = {}) {
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.translate(x, y);
  const g = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, mixRgba('fur', 'ember', 0.25));
  g.addColorStop(0.7, mixRgba('fur', 'blood', o.dark ? 0.45 : 0.25));
  g.addColorStop(1, mixRgba('fur', 'ink', o.dark ? 0.6 : 0.4));
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  c.rotate(rot * Math.PI * 2);
  c.strokeStyle = rgba('ink', 0.75);
  c.lineWidth = Math.max(1, r * 0.08);
  c.beginPath();
  c.moveTo(-r, 0); c.lineTo(r, 0);
  c.moveTo(0, -r); c.lineTo(0, r);
  c.moveTo(-r * 0.62, -r * 0.78); c.quadraticCurveTo(-r * 0.2, 0, -r * 0.62, r * 0.78);
  c.moveTo(r * 0.62, -r * 0.78); c.quadraticCurveTo(r * 0.2, 0, r * 0.62, r * 0.78);
  c.stroke();
  c.restore();
}

// ---------------------------------------------------------------- 籃框（側面）
export interface Hoop {
  /** 籃框中心（側面看是一條扁扁的橢圓）。 */
  x: number; y: number;
  /** 籃框直徑（px）。 */
  d: number;
  /** 籃板在籃框的哪一邊：+1 右邊（往左投）、-1 左邊。 */
  side: 1 | -1;
  /** 柱子落地的 y。 */
  floor: number;
}

/**
 * 側面的籃框：玻璃籃板（側面看是一條細長的板）、籃框、籃網、支架與柱子。
 * swish：球剛穿過網（0..1，1 = 剛進），網子往下甩再彈回來；light：線的顏色（暗版面用淡的紙白、亮版面用墨色）。
 * 畫兩次：back = 籃框後半圈與籃板（在球後面），front = 前半圈與網（在球前面）。
 */
export function drawHoop(c: Ctx, hp: Hoop, part: 'back' | 'front', o: { line: string; glass: string; pole: string; swish?: number; t?: number; chain?: boolean }) {
  const { x, y, d, side } = hp;
  const r = d / 2, ry = d * 0.14;
  const bx = x + side * (r + d * 0.18);
  c.save();
  c.lineCap = 'round';
  if (part === 'back') {
    // 柱子與支架（在籃板後面）
    const px = bx + side * d * 1.5;
    c.strokeStyle = o.pole;
    c.lineWidth = d * 0.22;
    c.beginPath(); c.moveTo(px, hp.floor); c.lineTo(px, y - d * 0.9); c.stroke();
    c.lineWidth = d * 0.1;
    c.beginPath(); c.moveTo(px, y - d * 0.75); c.lineTo(bx + side * d * 0.06, y - d * 0.55); c.moveTo(px, y - d * 0.15); c.lineTo(bx + side * d * 0.06, y - d * 0.35); c.stroke();
    // 底座
    c.fillStyle = o.pole;
    c.fillRect(px - d * 0.6, hp.floor - d * 0.28, d * 1.2, d * 0.28);
    // 玻璃籃板：側面是一條細板（上下兩端亮一點）
    c.fillStyle = o.glass;
    c.fillRect(bx - d * 0.05, y - d * 2.0, d * 0.1, d * 2.35);
    c.strokeStyle = o.line;
    c.lineWidth = 1.5;
    c.strokeRect(bx - d * 0.05, y - d * 2.0, d * 0.1, d * 2.35);
    // 籃框後半圈
    c.strokeStyle = o.line;
    c.lineWidth = Math.max(2, d * 0.07);
    c.beginPath(); c.ellipse(x, y, r, ry, 0, Math.PI, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(x + side * r, y); c.lineTo(bx, y + d * 0.02); c.stroke();
  } else {
    // 網：上寬下窄的菱形網格；剛進球時往下甩、再彈回
    const sw = o.swish ?? 0;
    const len = d * (0.95 + 0.35 * sw), bot = r * (0.62 - 0.12 * sw);
    const wob = sw * Math.sin((o.t ?? 0) * 40) * d * 0.04;
    c.strokeStyle = o.line;
    c.globalAlpha *= 0.8;
    c.lineWidth = Math.max(1, d * (o.chain ? 0.04 : 0.028));
    // 街頭球場的鐵鍊網：一節一節的虛線
    if (o.chain) c.setLineDash([d * 0.07, d * 0.05]);
    const N = 6;
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const x0 = x - r + 2 * r * u, x1 = x - bot + 2 * bot * u + wob;
      const xa = x - r + 2 * r * Math.min(1, u + 1 / N), xb = x - bot + 2 * bot * Math.max(0, u - 1 / N) + wob;
      c.moveTo(x0, y + ry * 0.4); c.lineTo(x1, y + len);
      if (i < N) { c.moveTo(xa, y + ry * 0.4); c.lineTo(xb, y + len); }
    }
    // 網的下緣
    c.moveTo(x - bot + wob, y + len); c.lineTo(x + bot + wob, y + len);
    c.stroke();
    c.setLineDash([]);
    c.globalAlpha /= 0.8;
    // 籃框前半圈（在球前面）
    c.lineWidth = Math.max(2, d * 0.07);
    c.beginPath(); c.ellipse(x, y, r, ry, 0, 0, Math.PI); c.stroke();
  }
  c.restore();
}

// ---------------------------------------------------------------- 爆米花
/**
 * 從 p 在 t0 噴出來的一把爆米花（n 顆，往上噴、受重力掉下來，掉到 floor 以下就不畫）。
 * 每顆是三個重疊的小圓（奶油色、頂上亮一點），只看 t 與編號。
 */
export function popcorn(c: Ctx, p: Pt, t0: number, t: number, o: { n?: number; floor: number; speed?: number; seed?: number; spread?: number; size?: number }) {
  const dt = t - t0;
  if (dt < 0) return;
  const n = o.n ?? 24, g = 1500, sp = o.speed ?? 620, sz = o.size ?? 6;
  c.save();
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (hash(i, 1, o.seed ?? 3) - 0.5) * (o.spread ?? 1.4);
    const v = sp * (0.55 + 0.6 * hash(i, 2, o.seed ?? 3));
    const x = p.x + Math.cos(a) * v * dt, y = p.y + Math.sin(a) * v * dt + 0.5 * g * dt * dt;
    if (y > o.floor) continue;
    const s = sz * (0.8 + 0.5 * hash(i, 3)), spin = dt * 8 * (hash(i, 4) - 0.5);
    c.fillStyle = mixRgba('cream', 'bone', 0.4);
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const ang = spin + (k / 3) * Math.PI * 2;
      c.moveTo(x + Math.cos(ang) * s * 0.55 + s * 0.6, y + Math.sin(ang) * s * 0.55);
      c.arc(x + Math.cos(ang) * s * 0.55, y + Math.sin(ang) * s * 0.55, s * 0.6, 0, Math.PI * 2);
    }
    c.fill();
    c.fillStyle = mixRgba('fur', 'cream', 0.55, 0.8);
    c.beginPath(); c.arc(x + s * 0.15, y + s * 0.2, s * 0.28, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

// ---------------------------------------------------------------- 場館的座椅
/** 一排折疊椅（正面）：椅背＋椅面的暗色剪影，頂上一道很淡的亮邊。x 是每張椅子的中心。 */
export function seats(c: Ctx, xs: readonly number[], floor: number, s: number, o: { fill: string; edge: string }) {
  c.save();
  for (const x of xs) {
    const w = s * 0.32, backTop = floor - s * 0.6, seatY = floor - s * 0.3;
    c.fillStyle = o.fill;
    // 椅背（上面圓一點）
    c.beginPath();
    c.moveTo(x - w / 2, seatY);
    c.lineTo(x - w / 2, backTop + w * 0.18);
    c.quadraticCurveTo(x - w / 2, backTop, x - w / 2 + w * 0.18, backTop);
    c.lineTo(x + w / 2 - w * 0.18, backTop);
    c.quadraticCurveTo(x + w / 2, backTop, x + w / 2, backTop + w * 0.18);
    c.lineTo(x + w / 2, seatY);
    c.closePath();
    c.fill();
    // 椅面、椅腳
    c.fillRect(x - w * 0.55, seatY, w * 1.1, s * 0.05);
    c.fillRect(x - w * 0.42, seatY, s * 0.025, floor - seatY);
    c.fillRect(x + w * 0.42 - s * 0.025, seatY, s * 0.025, floor - seatY);
    c.strokeStyle = o.edge;
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x - w / 2 + w * 0.18, backTop + 1); c.lineTo(x + w / 2 - w * 0.18, backTop + 1); c.stroke();
  }
  c.restore();
}

// ---------------------------------------------------------------- 場館的大螢幕與 LED 帶（暗版面）
export type Box = { x: number; y: number; w: number; h: number };

/**
 * 吊在場館上方的大螢幕的殼：兩條吊纜、有厚度的外框、下緣看得到一點底面、螢幕面（上亮下暗一點點）。
 * 螢幕裡的東西版面自己畫（J = 螢幕面的範圍）。
 */
export function jumbotronShell(c: Ctx, J: Box, o: { cables?: number; bezel?: number } = {}) {
  const b = o.bezel ?? 14;
  c.save();
  c.strokeStyle = rgba('bone', 0.18);
  c.lineWidth = 2;
  c.setLineDash([6, 5]);
  for (const x of [J.x + 60, J.x + J.w - 60]) { c.beginPath(); c.moveTo(x, o.cables ?? 0); c.lineTo(x, J.y - b + 4); c.stroke(); }
  c.setLineDash([]);
  c.fillStyle = mixRgba('ink', 'ink2', 0.5);
  c.fillRect(J.x - b, J.y - b + 4, J.w + b * 2, J.h + b * 2 - 4);
  c.fillStyle = rgba('ink2');
  c.beginPath(); c.moveTo(J.x - b, J.y + J.h + b); c.lineTo(J.x + J.w + b, J.y + J.h + b); c.lineTo(J.x + J.w + b - 18, J.y + J.h + b + 20); c.lineTo(J.x - b + 18, J.y + J.h + b + 20); c.closePath(); c.fill();
  c.strokeStyle = rgba('bone', 0.12);
  c.lineWidth = 1.5;
  c.strokeRect(J.x - b, J.y - b + 4, J.w + b * 2, J.h + b * 2 - 4);
  const g = c.createLinearGradient(0, J.y, 0, J.y + J.h);
  g.addColorStop(0, mixRgba('ink2', 'bone', 0.05));
  g.addColorStop(1, rgba('ink2'));
  c.fillStyle = g;
  c.fillRect(J.x, J.y, J.w, J.h);
  c.restore();
}

/** 一條 LED 帶（環場廣告帶、字幕板）：暗色的底、上下兩條細亮邊、很淡的燈珠格。 */
export function ledBand(c: Ctx, B: Box, o: { dots?: number; edge?: number } = {}) {
  c.save();
  c.fillStyle = rgba('ink', 0.96);
  c.fillRect(B.x, B.y, B.w, B.h);
  c.fillStyle = rgba('bone', o.dots ?? 0.03);
  for (let y = B.y + 5; y < B.y + B.h - 3; y += 6) for (let x = B.x + 4; x < B.x + B.w; x += 6) c.fillRect(x, y, 2, 2);
  c.fillStyle = rgba('bone', o.edge ?? 0.14);
  c.fillRect(B.x, B.y, B.w, 1.5);
  c.fillRect(B.x, B.y + B.h - 1.5, B.w, 1.5);
  c.restore();
}

/** 螢幕的掃描線花紋（每四條一條暗線）：init 做一次，畫完螢幕內容之後 fillRect 蓋上去。 */
export function scanPattern(c: Ctx, a = 0.16): CanvasPattern | null {
  const pc = document.createElement('canvas');
  pc.width = 4; pc.height = 4;
  const px = pc.getContext('2d')!;
  px.fillStyle = `rgba(0,0,0,${a})`;
  px.fillRect(0, 3, 4, 1);
  return c.createPattern(pc, 'repeat');
}

// ---------------------------------------------------------------- 七段顯示器的數字（記分板、計時器）
const SEG: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};
/**
 * 七段顯示器：字高 h，每個字寬 0.56h；沒亮的段用 off 的顏色畫（LED 關著也看得到）。支援數字、「:」「.」「-」與空白。
 * align：x 是左邊、中間或右邊。回傳總寬。
 */
export function seg7(c: Ctx, str: string, x: number, y: number, h: number, on: string, off: string, align: 'left' | 'center' | 'right' = 'left'): number {
  const w = h * 0.56, th = h * 0.12, gap = h * 0.2;
  const adv = (ch: string) => (ch === ':' || ch === '.' ? h * 0.26 : w + gap);
  const total = Array.from(str).reduce((s, ch) => s + adv(ch), 0) - gap;
  let px = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
  const bar = (x0: number, y0: number, horiz: boolean, len: number) => {
    const t2 = th / 2;
    c.beginPath();
    if (horiz) { c.moveTo(x0, y0); c.lineTo(x0 + t2, y0 - t2); c.lineTo(x0 + len - t2, y0 - t2); c.lineTo(x0 + len, y0); c.lineTo(x0 + len - t2, y0 + t2); c.lineTo(x0 + t2, y0 + t2); }
    else { c.moveTo(x0, y0); c.lineTo(x0 + t2, y0 + t2); c.lineTo(x0 + t2, y0 + len - t2); c.lineTo(x0, y0 + len); c.lineTo(x0 - t2, y0 + len - t2); c.lineTo(x0 - t2, y0 + t2); }
    c.closePath();
    c.fill();
  };
  c.save();
  for (const ch of Array.from(str)) {
    if (ch === ':' || ch === '.') {
      c.fillStyle = on;
      const r = th * 0.55;
      if (ch === ':') { c.beginPath(); c.arc(px + h * 0.08, y - h * 0.68, r, 0, Math.PI * 2); c.arc(px + h * 0.08, y - h * 0.3, r, 0, Math.PI * 2); c.fill(); }
      else { c.beginPath(); c.arc(px + h * 0.08, y - r, r, 0, Math.PI * 2); c.fill(); }
      px += adv(ch);
      continue;
    }
    const lit = SEG[ch] ?? '';
    const sk = h * 0.06; // 往右斜一點點（像真的七段顯示器）
    const segs: [string, number, number, boolean, number][] = [
      ['a', px + sk * 2 + th * 0.3, y - h, true, w - th * 0.6],
      ['g', px + sk + th * 0.3, y - h / 2, true, w - th * 0.6],
      ['d', px + th * 0.3, y, true, w - th * 0.6],
      ['f', px + sk + th * 0.02, y - h + th * 0.3, false, h / 2 - th * 0.6],
      ['b', px + sk + w, y - h + th * 0.3, false, h / 2 - th * 0.6],
      ['e', px + th * 0.02, y - h / 2 + th * 0.3, false, h / 2 - th * 0.6],
      ['c', px + w, y - h / 2 + th * 0.3, false, h / 2 - th * 0.6],
    ];
    for (const [k, sx, sy, horiz, len] of segs) {
      c.fillStyle = lit.includes(k) ? on : off;
      bar(sx, sy, horiz, len);
    }
    px += adv(ch);
  }
  c.restore();
  return total;
}

// ---------------------------------------------------------------- 彩帶
/** 從畫面上方飄下來的彩帶（t0 開始，n 條）：細細的波浪線，一邊掉一邊轉；只看 t 與編號。 */
export function streamers(c: Ctx, t0: number, t: number, o: { n?: number; x0?: number; x1?: number; colors: string[]; floor?: number; seed?: number }) {
  const dt = t - t0;
  if (dt < 0) return;
  const n = o.n ?? 40, x0 = o.x0 ?? 0, x1 = o.x1 ?? 1920;
  c.save();
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const d = dt - hash(i, 1, o.seed ?? 9) * 0.6;
    if (d < 0) continue;
    const x = x0 + (x1 - x0) * hash(i, 2, o.seed ?? 9) + Math.sin(d * 2.2 + i) * 30;
    const y = -30 + d * (170 + 90 * hash(i, 3)) + 0.5 * 60 * d * d;
    if (y > (o.floor ?? 1110)) continue;
    const len = 18 + 16 * hash(i, 4), ang = d * (2 + 3 * hash(i, 5)) + i;
    c.strokeStyle = o.colors[i % o.colors.length]!;
    c.lineWidth = 3;
    c.beginPath();
    for (let k = 0; k <= 6; k++) {
      const u = k / 6 - 0.5;
      const px = x + Math.cos(ang) * u * len + Math.sin(u * 6 + d * 8) * 4, py = y + Math.sin(ang) * u * len;
      if (k) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.stroke();
  }
  c.restore();
}

// ---------------------------------------------------------------- 歌詞會不會折兩排
const rowCache = new Map<string, 1 | 2>();
/**
 * 這行歌詞放在長度 len 的路徑上，_couple 的 lyricOnPath 會不會折成兩排（照它的算法：逐字量寬、先縮字、字級取到 0.5 px 再量一次）。
 * 版面用來決定歌詞的基線：會折兩排時整段往上挪，第二排才不會掉出 LED 板、地面。
 */
export function lyricRows(c: Ctx, text: string, family: string, size: number, minSize: number, len: number): 1 | 2 {
  const key = `${text}|${family}|${size}|${minSize}|${Math.round(len)}`;
  const hit = rowCache.get(key);
  if (hit) return hit;
  const chars = Array.from(text);
  const sumAt = (s: number) => { c.font = font(family, s); return chars.reduce((a, ch) => a + c.measureText(ch).width, 0); };
  const avail = len * 0.94;
  let rows: 1 | 2 = 1;
  const sum = sumAt(size);
  if (sum > avail) {
    const s2 = Math.round(Math.max(minSize, (size * avail) / sum) * 2) / 2;
    if (sumAt(s2) > avail) rows = 2;
  }
  if (rowCache.size > 300) rowCache.clear();
  rowCache.set(key, rows);
  return rows;
}

/** 0..1 之間慢起慢停（跑位、鏡頭）。 */
export const sine01 = (u: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(u));
