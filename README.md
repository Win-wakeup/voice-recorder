# 🚕 Play Taipei - 聲控 AI 在地嚮導 (Hackathon Backend)

這是一個專為黑客松設計的強大**全語音驅動 AI 嚮導系統**。跳脫傳統點擊介面，本專案將最先進的 LLM 推理邏輯、Google Maps 即時打點與交友軟體式的「左滑右滑」直覺操作完美融合，提供前所未有的無痛旅遊規劃體驗。

## 🌟 殺手級核心特色 (Core Features)

1. **純語音驅動解析 (Voice-First Routing)**：
   - 捨棄死板的過濾按鈕。使用者只需對麥克風說出如：「我們兩個人約會，錢不是問題，想吃午餐和溜冰」，後端 AI 就會像真人導遊一樣，自動推斷出四大核心要素（地點、種類、預算、人數），若有遺漏還會主動反問。
   
2. **情感感知與客群配對 (Vibe Match & Budget Actuary)**：
   - **預算精算師邏輯**：AI 具備真實的財務心智！給予總預算時，它會自動扣除昂貴的玩樂支出（例如溜冰 600 元），確保剩下的錢能找到符合平價標準的餐廳。
   - **社交氛圍偵測 (Vibe Match)**：懂得察言觀色。當偵測到「約會」情境時，AI 會嚴格濾除吵雜的親子樂園，優先排入具浪漫氛圍的餐廳與互動設施。

3. **Google Maps 即時環境打點 (Real-time Grounding)**：
   - 拒絕死板的靜態資料庫！系統會即時剝除使用者的「口語贅字」，以最純粹的關鍵字串接 Google Maps API，搜刮當下真實存在且正在營業的店家，確保清單 100% 符合現實。

4. **1v1 終極二選一擂台賽 (Elimination Tournament)**：
   - 採用 Tinder-like 的「左滑淘汰、右滑收藏」畫廊。
   - 若使用者「貪心」收藏了太多地點，系統會無縫啟動**「二選一分類排行榜」**！讓使用者在同性質（冰場 vs 冰場、餐廳 vs 餐廳）間做出殘酷二選一對決，直到誕生唯一勝出者，最終自動組合攏成完美的一日行程時間軸！

5. **安心旅宿防護網與 GPS 準心**：
   - 每次對話皆即時索取 GPS（附帶本地無縫快取以防瀏覽器卡死），提供最精準的在地推薦。
   - 完美對接政府合法旅宿資料，並透過 C/P 值比對引擎，確保推薦的住宿安全又划算。

## 🚀 快速開始 (Quick Start)

### 1. 啟動背景爬蟲與快取
若你需要單獨手動刷新最新的資料，只要執行這隻 Python 腳本：
```bash
python social_scraper.py
```
> 執行後，最新生成的景點資訊將被輸出至 `api/social_sentiment_mock.json`。

### 2. 啟動 API 伺服器
採用 FastAPI 架構，且內建開機自動爬取與背景迴圈機制：
```bash
# 若尚未安裝相依套件請先： pip install -r requirements.txt
uvicorn api.index:app --reload
```

## 📡 核心 API 路由說明 (API Endpoints)

### `POST /api/play_taipei/query`
應用程式的核心大腦。前端只需將使用者講的話直接丟進此 Endpoint。

**Request Body**:
```json
{
  "user_text": "兩個人約會，大概一個人一千元，我想吃午餐加上溜冰",
  "session_id": "user_id_123",
  "context": {
    "lat": 25.0330,
    "lng": 121.5654,
    "current_time": "15:30",
    "weather": "Sunny"
  }
}
```

**Response (AI 結構化動態分析)**:
```json
{
  "requires_clarification": false,  // 若設為 true 代表地點不明，AI 語音會立即反問
  "expected_target_count": 2,       // AI 預判使用者需要挑選的地點數量
  "voice_script": "太棒了！我幫您規劃了超讚的約會行程...",
  "quick_replies": ["忠泰樂生活", "信義區"],
  "swipe_candidates": [ 
      // 包含豐富類別（餐廳、逛街、溜冰）
      {
          "category": "溜冰",
          "name": "極光冰場 Aurora Ice Rink",
          "price": "約TWD 400/人", ...
      }
  ],
  "is_itinerary": true
}
```

---
*Built for the Hackathon. Pushing the boundaries of UX.*
