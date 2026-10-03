"""照片縮圖：用 Pillow 把上傳的圖片縮成長邊 480px 的 JPEG。沒裝 Pillow 或不是圖片就略過。"""
import logging
from pathlib import Path

log = logging.getLogger("thumbs")

THUMB_MAX = 480
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}


def _register_heif() -> None:
    """有裝 pillow-heif 就讓 Pillow 認得 HEIC/HEIF（iPhone 原檔），縮圖才做得出來（2026-09-28）。"""
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass


_register_heif()


def is_image(filename: str) -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXT


def make_thumb(src: Path, dst: Path, max_px: int = THUMB_MAX) -> bool:
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover
        log.warning("Pillow 未安裝，略過縮圖")
        return False
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)  # 手機直拍的照片要照 EXIF 方向轉正
            im.thumbnail((max_px, max_px))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(dst, "JPEG", quality=82, optimize=True)
        return True
    except Exception as e:  # 壞檔、HEIC 等讀不了的格式
        log.warning("縮圖失敗 %s：%s", src.name, e)
        return False


def make_thumb_bytes(data: bytes, max_px: int = THUMB_MAX) -> bytes | None:
    """跟 make_thumb 一樣，但吃 bytes、回 JPEG bytes（照片存 S3 時用）。讀不了的格式回 None。"""
    import io
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover
        return None
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((max_px, max_px))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            out = io.BytesIO()
            im.save(out, "JPEG", quality=82, optimize=True)
            return out.getvalue()
    except Exception as e:
        log.warning("縮圖失敗：%s", e)
        return None


def image_info(src: Path) -> dict | None:
    """照片在大螢幕要用的資訊：長寬（照 EXIF 轉正後）、平均亮度（0..1，看起來的亮度）、平均色調（#rrggbb）。

    大螢幕靠這些在還沒下載照片之前就挑版面：直的照片配直的相框、很小的舊照片不放滿版、暗的照片配亮的版面。
    只讀縮小的版本算顏色（JPEG 用 draft 直接解小圖），一張幾毫秒。讀不了的格式回 None。
    """
    try:
        from PIL import Image, ImageOps, ImageStat
    except ImportError:  # pragma: no cover
        return None
    try:
        with Image.open(src) as im:
            w, h = im.size
            # EXIF 方向 5～8 是轉了 90 度：手機直拍的照片檔案裡常常是橫的
            if im.getexif().get(0x0112, 1) in (5, 6, 7, 8):
                w, h = h, w
            im.draft("RGB", (256, 256))
            small = ImageOps.exif_transpose(im)
            small.thumbnail((128, 128))
            if small.mode != "RGB":
                small = small.convert("RGB")
            r, g, b = (v / 255 for v in ImageStat.Stat(small).mean[:3])
        return {"w": int(w), "h": int(h), "lum": round(0.2126 * r + 0.7152 * g + 0.0722 * b, 4),
                "tone": "#{:02x}{:02x}{:02x}".format(round(r * 255), round(g * 255), round(b * 255))}
    except Exception as e:  # 壞檔、讀不了的格式
        log.warning("讀照片資訊失敗 %s：%s", src.name, e)
        return None


def wall_image_name(stored_name: str) -> str:
    """婚紗照在會場大螢幕用的尺寸（長邊 2048）的檔名：第一次播時才做，存在原檔旁邊，刪照片時要一起刪。"""
    return f"wall_{stored_name.rsplit('.', 1)[0]}.jpg"


def make_thumb(src: Path, dst: Path, max_px: int = THUMB_MAX) -> bool:
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover
        log.warning("Pillow 未安裝，略過縮圖")
        return False
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)  # 手機直拍的照片要照 EXIF 方向轉正
            im.thumbnail((max_px, max_px))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            im.save(dst, "JPEG", quality=82, optimize=True)
        return True
    except Exception as e:  # 壞檔、HEIC 等讀不了的格式
        log.warning("縮圖失敗 %s：%s", src.name, e)
        return False


def make_thumb_bytes(data: bytes, max_px: int = THUMB_MAX) -> bytes | None:
    """跟 make_thumb 一樣，但吃 bytes、回 JPEG bytes（照片存 S3 時用）。讀不了的格式回 None。"""
    import io
    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover
        return None
    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((max_px, max_px))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            out = io.BytesIO()
            im.save(out, "JPEG", quality=82, optimize=True)
            return out.getvalue()
    except Exception as e:
        log.warning("縮圖失敗：%s", e)
        return None
