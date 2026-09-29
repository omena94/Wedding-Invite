// 在背景執行緒分析（幾秒鐘的 FFT 不能卡住畫面：大螢幕在播的時候也可能要分析下一首）。
import { analyze } from './analyze';

// DOM 的型別裡 self 是 Window，postMessage 要兩個參數；在 worker 裡其實是 DedicatedWorkerGlobalScope
const scope = self as unknown as { onmessage: ((e: MessageEvent<{ pcm: Float32Array; sr: number }>) => void) | null; postMessage(m: unknown): void };

scope.onmessage = (e) => {
  try {
    const out = analyze(e.data.pcm, e.data.sr, (p, label) => scope.postMessage({ type: 'progress', p, label }));
    scope.postMessage({ type: 'done', out });
  } catch (err) {
    scope.postMessage({ type: 'error', error: String((err as Error)?.message ?? err) });
  }
};
