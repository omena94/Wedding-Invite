# 台北美福 2F 大宴會廳

- `grand-mayfull-2f.blend`：可在 Blender 開啟編輯的空廳；獨立場景 `Wedding_GrandMayfull_2F`。
- `ballroom-preview.png`：Blender 室內渲染預覽。
- 網頁資產：`frontend/public/models/grand-mayfull-2f.glb`，約 1.45 MB，32 個網格。
- 重建來源：使用者提供的三個 Google Maps 環景視點，搭配[飯店官方宴會廳](https://www.grandmayfull.com/events/ballroom)的[平面圖](https://www.grandmayfull.com/uploads/events/20170817_124935_427.jpeg)。

採用官方圖中的主廳尺寸 38 × 20 × 7.5 公尺，未包含外側大廳與樓梯。門位、鏡面、吊燈與地毯為環景視覺重建，非測量竣工圖；正式安排桌位前請依飯店提供的最新配置校正。

模型包含奶油色壁板、金屬線框、鏡面門楣、金色雙門、長邊 LED 牆、窗簾、花紋地毯、吊燈及天花板。**不含桌、椅、桌花、臨時舞台走道及可移動餐櫃。**

網格依 `venue_layer` 分層：`Floor`、`Wall_LED`、`Wall_Entry`、`Wall_End_East`、`Wall_End_West`、`Ceiling`、`Chandeliers`。網頁俯視模式會隱藏天花板、吊燈與入口側牆，室內模式還原。

重建程式位於 `scripts/build_ballroom.py`。使用已連接 Blender 的 MCP server 執行：

```powershell
# 在專案根目錄，以已安裝 mcp Python 套件的 Python 執行。
# 先將 BLENDER_MCP_EXECUTABLE 環境變數設為已安裝的 server 執行檔。
python scripts/blender_mcp_client.py --server $env:BLENDER_MCP_EXECUTABLE --tool execute_blender_code --code-file scripts/build_ballroom.py
```

此命令只重建本專案命名場景，保留其他使用者場景，匯出本場景的 GLB 與 `.blend`。產物直接寫入專案相對路徑；不需要把本機使用者路徑寫入程式。
