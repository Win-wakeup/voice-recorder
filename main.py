import os
import logging
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pathlib import Path

# 設定日誌，方便追蹤問題
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# 載入 .env 檔案中的環境變數 (例如您的 API 金鑰)
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# 從您的 api/routers 資料夾中，匯入已經寫好的 play_taipei 路由
from api.routers import play_taipei

# 建立 FastAPI 應用程式
app = FastAPI(title="Play Taipei Guide API")

# --- 這是讓語音 URL 能夠運作的關鍵設定 ---
# 告訴 FastAPI，如果有人訪問 /static/... 的網址，就去名為 "static" 的資料夾裡找檔案
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# 將 play_taipei.py 裡面定義的 API (例如 /query) 加到您的應用程式中
app.include_router(play_taipei.router)

@app.get("/")
def read_root():
    return {"message": "歡迎使用 Play Taipei 導遊 API。請在 /query 端點進行互動。"}