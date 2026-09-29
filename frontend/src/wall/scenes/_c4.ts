// 批次 C4（約會：stargaze、beach、scooter、nightmarket、lantern、ferriswheel）共用的小工具。
import { rgba } from '../engine/palette';
import { SCALE } from '../engine/gl';

const rgbOf = (c: string) => (c.startsWith('rgb') ? c : rgba(c)).match(/[\d.]+/g)!.map(Number);

/**
 * 兩個顏色之間混色：a、b 可以是色票名，也可以是已經混好的 rgba() 字串（palette 的 mixRgba 只收色票名，
 * 巢狀混色——例如「沒點火的燈紙」混到「點火後的燈紙」——要用這個）。
 */
export function mixC(a: string, b: string, k: number, alpha = 1): string {
  const p = rgbOf(a), q = rgbOf(b);
  return `rgba(${[0, 1, 2].map((i) => Math.round(p[i]! + (q[i]! - p[i]!) * k)).join(',')},${alpha})`;
}

/** 已經混好的顏色換透明度。 */
export function withA(c: string, alpha: number): string {
  const p = rgbOf(c);
  return `rgba(${p[0]},${p[1]},${p[2]},${alpha})`;
}

/**
 * 紙偶的打光台：先把紙偶畫在一張小畫布上、只染紙偶（source-atop），再貼回版面的層。
 * 版面的層上已經畫了背景（街景、路面）時，直接在那一層做 source-atop 會連背景一起染，染出一個方框；在這裡畫就不會。
 * 用法：const c2 = stage.begin(x0, y0); 畫紙偶…; stage.light((c) => { 漸層 fillRect… }); stage.end(層的 ctx);
 */
export class LitStage {
  readonly cv: HTMLCanvasElement;
  readonly c: CanvasRenderingContext2D;
  private x0 = 0;
  private y0 = 0;
  constructor(readonly w: number, readonly h: number, private k = SCALE) {
    this.cv = document.createElement('canvas');
    this.cv.width = Math.ceil(w * k);
    this.cv.height = Math.ceil(h * k);
    this.c = this.cv.getContext('2d')!;
  }
  /** 開始畫：(x0, y0) = 這張小畫布在畫面上的左上角；回傳的 ctx 用畫面座標畫。 */
  begin(x0: number, y0: number): CanvasRenderingContext2D {
    const c = this.c;
    this.x0 = x0; this.y0 = y0;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    c.setTransform(this.k, 0, 0, this.k, -x0 * this.k, -y0 * this.k);
    return c;
  }
  /** 只染已經畫上去的紙偶。 */
  light(fn: (c: CanvasRenderingContext2D) => void) {
    const c = this.c;
    c.save();
    c.globalCompositeOperation = 'source-atop';
    fn(c);
    c.restore();
  }
  /** 貼回版面的層（畫面座標）。 */
  end(target: CanvasRenderingContext2D) {
    target.drawImage(this.cv, this.x0, this.y0, this.w, this.h);
  }
}
