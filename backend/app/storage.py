"""當天照片的檔案存放（2026-09-27）：設定了 S3 就存 S3（用多少付多少），沒設定就存主機的 uploads/guest/。

.env 要有：S3_BUCKET、S3_REGION（預設 ap-northeast-1）、AWS_ACCESS_KEY_ID、AWS_SECRET_ACCESS_KEY。
金鑰只給這個 bucket 的讀寫權限；bucket 維持私有，照片一律經由後端（要登入）才拿得到。
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

from .config import settings

CHUNK = 1024 * 1024


class LocalStore:
    kind = "local"

    def __init__(self, base: Path):
        self.base = base

    def _path(self, key: str) -> Path:
        p = (self.base / key).resolve()
        if not p.is_relative_to(self.base.resolve()):
            raise ValueError("bad key")
        return p

    def put(self, key: str, data: bytes, content_type: str = "") -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def stream(self, key: str) -> Iterator[bytes]:
        with open(self._path(key), "rb") as f:
            while chunk := f.read(CHUNK):
                yield chunk

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class S3Store:
    kind = "s3"

    def __init__(self, bucket: str, region: str, access_key: str, secret_key: str, prefix: str = ""):
        import boto3  # 只有真的用 S3 才需要

        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.client = boto3.client("s3", region_name=region, aws_access_key_id=access_key or None, aws_secret_access_key=secret_key or None)

    def _key(self, key: str) -> str:
        return f"{self.prefix}/{key}" if self.prefix else key

    def put(self, key: str, data: bytes, content_type: str = "") -> None:
        extra = {"ContentType": content_type} if content_type else {}
        self.client.put_object(Bucket=self.bucket, Key=self._key(key), Body=data, **extra)

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self._key(key))
            return True
        except Exception:
            return False

    def stream(self, key: str) -> Iterator[bytes]:
        body = self.client.get_object(Bucket=self.bucket, Key=self._key(key))["Body"]
        for chunk in body.iter_chunks(CHUNK):
            if chunk:
                yield chunk

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(key))


_store = None


def guest_store():
    """依設定回傳存放後端（只建一次）。"""
    global _store
    if _store is None:
        if settings.s3_bucket:
            _store = S3Store(settings.s3_bucket, settings.s3_region, settings.aws_access_key_id, settings.aws_secret_access_key, settings.s3_prefix)
        else:
            _store = LocalStore(settings.upload_path / "guest")
    return _store


def reset_store() -> None:
    """測試用：換設定後重建。"""
    global _store
    _store = None
