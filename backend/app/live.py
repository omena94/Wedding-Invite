"""大螢幕與手機遙控的即時推播（SSE）：不用每秒問伺服器，有變化才推過去。

頻道內容是一個小 JSON，t 是種類：
- feed：上螢幕的留言、歌單、版面、講話模式音量、留言開關變了 → 大螢幕去抓一次 /wall/feed
- cmd：手機按的遙控指令，只推給接收遙控的那台（to）
- remote：遙控鎖定變了 → 大螢幕馬上回報一次，拿到新的 leader／locked
- state：大螢幕回報了播放狀態 → 手機遙控頁直接顯示（跟 GET /wall/remote/state 一樣的內容）
推播只是「提早通知」，資料還是以原本的 API 為準：前端連上時先補抓一次、斷線就退回原本的輪詢，漏推一則不會壞。

正式站有兩個 uvicorn worker，大螢幕跟手機常常連到不同的 worker，所以一律經過 Redis pub/sub；
每個 worker 只開一條 Redis 訂閱，再分給自己身上的連線（Hub）。沒有 Redis 時：本機預覽（LIVE_LOCAL，單一程序）直接在記憶體裡轉，
正式站回 503，前端照舊輪詢。
"""
import asyncio
import json
import logging
import signal
import threading
import time
from collections.abc import AsyncIterator, Callable

import redis
import redis.asyncio as aioredis

from .config import settings

log = logging.getLogger("live")

CHANNEL = "wedding:live"
PING_SECONDS = 20        # 沒東西推也每 20 秒送一行心跳：nginx（60 秒）、Cloudflare（100 秒）才不會把連線當閒置切掉
MAX_SECONDS = 20 * 60    # 一條連線最多開這麼久就請前端重連：順便重新驗一次登入（改了密碼會生效）
QUEUE_MAX = 200          # 一條連線最多積這麼多則還沒送出去；積滿表示那支手機網路卡住，請它重連後自己補抓
SSE_HEADERS = {
    # no-transform：Cloudflare 不要壓縮或改寫；X-Accel-Buffering：nginx 不要先收進緩衝再一次送
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}

BYE = {"t": "bye"}  # 請前端馬上重連（伺服器要關機、連線卡住、開太久）

Accept = Callable[[dict], bool]


# ---------------- 發佈（一般 API 呼叫，跑在 threadpool） ----------------
_client: redis.Redis | None = None
_retry_at = 0.0


def _redis() -> redis.Redis | None:
    """同步的 Redis 連線；連不上就 30 秒內不再試（大螢幕常常回報，不要每次都卡一秒連線逾時）。"""
    global _client, _retry_at
    if _client is not None:
        return _client
    if time.monotonic() < _retry_at:
        return None
    try:
        c = redis.Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
        c.ping()
        _client = c
        return c
    except Exception as e:
        log.warning("推播用的 Redis 連不上，先改回輪詢：%s", e)
        _retry_at = time.monotonic() + 30
        return None


def enabled() -> bool:
    """推播現在送得出去嗎：送不出去就不用花查詢去算要推的內容。"""
    return hub.mode == "memory" or _redis() is not None


def publish(event: dict) -> None:
    """推一則給所有連線。失敗就算了（前端還有輪詢），不要讓原本的操作因為推播失敗而出錯。"""
    global _client, _retry_at
    if hub.mode == "memory":
        hub.deliver(event)
        return
    c = _redis()
    if c is None:
        return
    try:
        c.publish(CHANNEL, json.dumps(event, ensure_ascii=False, separators=(",", ":")))
    except Exception as e:
        log.warning("推播失敗：%s", e)
        _client, _retry_at = None, time.monotonic() + 5


# ---------------- 訂閱（每個 worker 一個 Hub） ----------------
class Hub:
    """這個 worker 身上所有推播連線。mode：None＝還沒開、redis、memory（本機預覽沒有 Redis 時，只有單一程序才正確）。"""

    def __init__(self) -> None:
        self.mode: str | None = None
        # 佇列 → (它所在的 event loop, 要不要這則)；測試時每個請求可能在不同的 loop，所以每條記自己的
        self.subs: dict[asyncio.Queue, tuple[asyncio.AbstractEventLoop, Accept]] = {}
        self._task: asyncio.Task | None = None
        self._up: asyncio.Event | None = None
        # 好幾條連線同時連上時只能開一條訂閱：不然後開的會蓋掉前一條的參考（前一條被回收），兩條都活著的話同一則會送兩次
        self._starting = asyncio.Lock()

    async def ensure(self) -> bool:
        """推播能不能用；要用 Redis 的話確定這個 worker 的訂閱已經開好。"""
        if self.mode == "memory":
            return True
        async with self._starting:
            if self._task is None or self._task.done():
                if await asyncio.to_thread(_redis) is None:
                    if settings.live_local:
                        self.mode = "memory"
                        return True
                    return False
                self.mode = "redis"
                self._up = asyncio.Event()
                self._task = asyncio.create_task(self._listen())
            up = self._up
        try:
            await asyncio.wait_for(up.wait(), 2)
        except TimeoutError:
            return False
        return True

    async def _listen(self) -> None:
        """一直訂閱頻道再分給本機的連線；Redis 斷了就請大家重連（重連時拿到 503 → 前端輪詢），自己每隔一陣子再接。"""
        wait = 1.0
        while True:
            conn = aioredis.Redis.from_url(settings.redis_url, socket_connect_timeout=2, health_check_interval=30)
            ps = conn.pubsub(ignore_subscribe_messages=True)
            try:
                await ps.subscribe(CHANNEL)
                self._up.set()
                wait = 1.0
                async for msg in ps.listen():
                    if msg.get("type") != "message":
                        continue
                    try:
                        event = json.loads(msg["data"])
                    except ValueError:
                        continue
                    self.deliver(event)
                raise ConnectionError("訂閱結束")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("推播的 Redis 訂閱斷了，%d 秒後重接：%s", wait, e)
                self._up.clear()
                self.close_all()
                await asyncio.sleep(wait)
                wait = min(wait * 2, 30)
            finally:
                try:
                    await ps.aclose()
                    await conn.aclose()
                except Exception:
                    pass

    def subscribe(self, accept: Accept) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(QUEUE_MAX)
        self.subs[q] = (asyncio.get_running_loop(), accept)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subs.pop(q, None)

    def deliver(self, event: dict) -> None:
        """每條連線自己決定要不要（大螢幕不收 state、手機不收 cmd）。
        本機預覽時發佈的一方在 threadpool：只用 call_soon_threadsafe 碰佇列，哪個執行緒呼叫都可以。"""
        for q, (loop, accept) in list(self.subs.items()):
            if accept(event):
                loop.call_soon_threadsafe(_offer, q, event)

    def close_all(self) -> None:
        """請本機所有連線斷線重連（關機、Redis 斷線時）。"""
        for q, (loop, _) in list(self.subs.items()):
            try:
                loop.call_soon_threadsafe(_offer, q, BYE)
            except RuntimeError:  # 那個 loop 已經關了
                pass


def _offer(q: asyncio.Queue, event: dict) -> None:
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        # 這條連線讀太慢（手機網路卡住）：清掉積著的，請它重連；重連後前端會自己補抓最新的
        while not q.empty():
            q.get_nowait()
        q.put_nowait(BYE)


hub = Hub()


def _line(event: dict) -> bytes:
    return f"data: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n".encode()


async def stream(accept: Accept) -> AsyncIterator[bytes]:
    """一條 SSE 連線：先訂閱、再送 ready（前端收到 ready 才補抓目前的資料，中間不會漏），之後有就推、沒有就定時送心跳。"""
    q = hub.subscribe(accept)
    loop = asyncio.get_running_loop()
    try:
        yield _line({"t": "ready"})
        end = loop.time() + MAX_SECONDS
        wrote = loop.time()
        while True:
            now = loop.time()
            if now >= end:
                yield _line(BYE)
                return
            try:
                event = await asyncio.wait_for(q.get(), timeout=max(0.05, min(end, wrote + PING_SECONDS) - now))
            except TimeoutError:
                if loop.time() - wrote >= PING_SECONDS:
                    yield b": ping\n\n"
                    wrote = loop.time()
                continue
            yield _line(event)
            wrote = loop.time()
            if event.get("t") == "bye":
                return
    finally:
        hub.unsubscribe(q)


def wall_accept(client: str) -> Accept:
    """大螢幕要的：留言／歌單變了、鎖定變了、給自己的指令。"""
    def accept(e: dict) -> bool:
        t = e.get("t")
        return t in ("feed", "remote") or (t == "cmd" and bool(client) and e.get("to") == client)
    return accept


def remote_accept(e: dict) -> bool:
    """手機遙控頁要的：大螢幕的播放狀態。"""
    return e.get("t") == "state"


def install_shutdown_hook() -> None:
    """部署時 systemctl stop 會等所有連線結束，推播連線卻不會自己結束（要等 systemd 90 秒後硬砍，整站停這麼久）；
    所以收到關機訊號時先請這個 worker 的推播連線斷線（前端會自己重連），再交給 uvicorn 原本的處理。
    要在 uvicorn 裝好訊號處理之後、主執行緒裡呼叫（app 的 startup）；不是在 uvicorn 底下跑（測試）就不裝。"""
    if threading.current_thread() is not threading.main_thread():
        return
    for sig in (signal.SIGTERM, signal.SIGINT):
        prev = signal.getsignal(sig)
        if not callable(prev):
            continue

        def handler(signum, frame, prev=prev):
            hub.close_all()
            prev(signum, frame)

        signal.signal(sig, handler)
