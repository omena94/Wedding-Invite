"""把新人自製的喜帖 PDF 轉成首頁開場用的圖片。

用法（專案根目錄）：
    backend/.venv/Scripts/python.exe scripts/render_invitation.py

會讀 docs/alanomena Wedding Invitation Card.pdf，把每一頁轉成 frontend/public/invitation-{頁碼}.webp
（寬 1400px，手機與桌機都夠清楚，每張約 100KB）。轉完後 `npm run build` 再部署即可。
喜帖頁數若不是兩頁，要一併修改 frontend/src/home/Invitation.jsx 的 PAGES。

需要開發用套件：pymupdf、pillow（不在正式部署依賴內）。
"""
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "docs" / "alanomena Wedding Invitation Card.pdf"
OUT = ROOT / "frontend" / "public"
WIDTH = 1400

try:
    import pymupdf
    from PIL import Image
except ImportError:
    print("請先安裝：backend/.venv/Scripts/python.exe -m pip install pymupdf pillow")
    sys.exit(1)

if not PDF.exists():
    print(f"找不到 {PDF}")
    sys.exit(1)

doc = pymupdf.open(PDF)
for index, page in enumerate(doc, 1):
    zoom = WIDTH / page.rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    image = Image.open(io.BytesIO(pix.tobytes("png")))
    target = OUT / f"invitation-{index}.webp"
    image.save(target, "WEBP", quality=84, method=6)
    print(f"{target.name}: {image.size[0]}x{image.size[1]} px, {target.stat().st_size // 1024} KB")
print(f"共 {len(doc)} 頁；記得確認 Invitation.jsx 的 PAGES 與頁數一致。")
