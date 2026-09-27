"""照片縮圖：用 Pillow 把上傳的圖片縮成長邊 480px 的 JPEG。沒裝 Pillow 或不是圖片就略過。"""
import logging
from pathlib import Path

log = logging.getLogger("thumbs")

THUMB_MAX = 480
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


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
