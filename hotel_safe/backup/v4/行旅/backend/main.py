from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from scraper import get_top_value_hotels

app = FastAPI(title="Safe Stay - Hotels API")

# 設定 CORS 讓前端可以直接跨域請求 API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/hotels")
def get_hotels(
    lat: float = Query(..., description="使用者的經度(緯度其實)"),
    lng: float = Query(..., description="使用者的緯度(經度其實)"),
    min_radius: float = Query(0.0, description="最小搜尋半徑(公里)"),
    max_radius: float = Query(5.0, description="最大搜尋半徑(公里)")
):
    """
    接收經緯度，爬取並計算出所選距離範圍內的性價比最高 10 間飯店
    """
    hotels = get_top_value_hotels(lat, lng, min_radius, max_radius, top_n=10)
    return {"status": "success", "data": hotels}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.0", port=8000)
