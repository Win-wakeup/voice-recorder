import os
import json
import time
import logging
from typing import List, Dict, Optional, Any
from fastapi import APIRouter, HTTPException, Request as FastAPIRequest
from pydantic import BaseModel, Field
import google.generativeai as genai
import requests
import uuid

router = APIRouter()
logger = logging.getLogger(__name__)

# ==========================================
# 1. Models
# ==========================================

class ContextData(BaseModel):
    lat: float = 25.0422
    lng: float = 121.5355
    current_time: str = "12:00"
    weather: str = "Sunny"

class QueryRequest(BaseModel):
    user_text: str
    tags: List[str] = []
    session_id: str = "default_session"
    context: ContextData = Field(default_factory=ContextData)

class ItineraryItem(BaseModel):
    name: str
    address: str = ""
    description: str
    image_url: str = ""

class Translation(BaseModel):
    zh: str
    en: str

class QueryResponse(BaseModel):
    status: str = "success"
    translation: Translation
    voice_script: str
    tts_audio_url: Optional[str] = None
    itinerary: List[ItineraryItem]

# ==========================================
# 2. Configuration & Memory
# ==========================================

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY.split(",")[0].strip())

# Session memory: session_id -> list of history messages
session_db: Dict[str, List[Dict[str, str]]] = {}

# Load data files
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DICT_PATH = os.path.join(BASE_DIR, "taipei_dict.json")
SENTIMENT_PATH = os.path.join(BASE_DIR, "social_sentiment_mock.json")

def load_json(path):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

TAIPEI_DICT = load_json(DICT_PATH)
SOCIAL_SENTIMENT = load_json(SENTIMENT_PATH)

# ==========================================
# 3. Helpers
# ==========================================

def filter_pois(tags: List[str], weather: str, current_time: str) -> List[Dict[str, str]]:
    """
    篩選最適合的景點 (隊友 B 的邏輯模擬)
    目前採用簡單的關鍵字匹配與隨機選取
    """
    candidates = []
    # 簡單模擬：如果下雨，偏向室內（博物館、百貨、地下街）
    is_rainy = weather.lower() == "rainy"
    
    if isinstance(TAIPEI_DICT, dict):
        iterator = [{"name": k, "translation": v, "tags": []} for k, v in TAIPEI_DICT.items()]
    else:
        iterator = TAIPEI_DICT

    for item in iterator:
        name = item.get("name", "")
        en_name = item.get("translation", "")
        item_tags = item.get("tags", [])
        score = 0
        
        # 關鍵字匹配
        for tag in tags:
            if tag in name or tag in item_tags:
                score += 2
        
        # 天氣適配性 (模擬)
        if is_rainy:
            if any(k in name for k in ["博物館", "地下街", "商場", "百貨", "寺", "室內"]):
                score += 1
        else:
            if any(k in name for k in ["公園", "步道", "山", "街", "自然戶外"]):
                score += 1
                
        # 若未提供任何 tag 則給予基本分以便展示
        if not tags:
            score += 1
        
        if score > 0:
            candidates.append({"name": name, "en_name": en_name, "score": score})
    
    # 按分數排序並取前 3
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:3]

def get_social_context() -> str:
    """獲取熱門社交情緒摘要"""
    if not SOCIAL_SENTIMENT: # Now works if it is list or dict
        return "目前無特別熱門話題。"
        
    trending = SOCIAL_SENTIMENT
    if isinstance(SOCIAL_SENTIMENT, dict):
        trending = SOCIAL_SENTIMENT.get("trending_topics", [])
    
    summaries = [f"- {item.get('topic', '')}: {item.get('summary', '')}" for item in trending[:3]]
    return "\n".join(summaries)

# ==========================================
# 4. Core Logic (Gemini & TTS)
# ==========================================

@router.post("/query", response_model=QueryResponse)
async def play_taipei_query(request: QueryRequest):
    try:
        # 1. 篩選景點與獲取輿情
        best_pois = filter_pois(request.tags, request.context.weather, request.context.current_time)
        social_context = get_social_context()
        
        # 2. 準備對話記憶
        if request.session_id not in session_db:
            session_db[request.session_id] = []
        
        history = session_db[request.session_id]
        
        # 3. 建立 Prompt
        poi_str = ", ".join([p["name"] for p in best_pois]) if best_pois else "無推薦景點"
        
        system_instruction = (
            "你是一名台灣在地雙語導遊，必須根據使用者的位置與真正需求給出最佳推薦。\n"
            "嚴格遵守以下規則：\n"
            f"1. 使用者目前 GPS 座標為：緯度 {request.context.lat}, 經度 {request.context.lng}。\n"
            "   請利用你的地理知識，過濾掉與這個座標「距離太遠」的景點。\n"
            "2. 請仔細聆聽並體會使用者的提問意圖。\n"
            "   【極度重要】如果候選清單中「完全沒有」符合使用者需求(例如想找拉麵、特定異國料理、稀有景點)的選項，請**跳脫候選名單**！請直接動用你內建的 Google Maps 地理知識庫，推薦該座標附近真實存在、且評價很高的店家或景點給他！千萬不可拿名單內無關的東西硬湊！\n"
            "3. 【要求安排『行程/一日遊』】：請務必填寫具體的『時間(time)』(如早上10:00、中午用餐)，並安插『美食/餐廳』，不能只丟出幾個景點，必須是連續且充實的一天。如果只是單純問景點，time可以寫\"推薦\"。\n"
            "4. 你的回覆必須是嚴格的 JSON 格式。\n"
            "JSON Schema 如下：\n"
            "{\n"
            "  \"translation\": {\"zh\": \"精確解讀中文(若需致歉在此)\", \"en\": \"英文翻譯\"}\n,"
            "  \"voice_script\": \"熱情但不廢話的回覆，若無合適景點請溫柔致歉並給個替代方案\",\n"
            "  \"itinerary\": [\n"
            "    {\"time\": \"時間或狀態(如09:00或推薦)\", \"name\": \"景點名稱或餐廳\", \"description\": \"為何推薦\", \"address\": \"地址\", \"image_url\": \"\"}\n"
            "  ]\n"
            "}\n"
            "5. translation 欄位：請自動偵測使用者輸入的語言。如果輸入是中文，zh 欄位保留原文，並將其翻譯成英文填入 en 欄位；如果輸入是英文，en 欄位保留原文，並將其翻譯成中文填入 zh 欄位。\n"
            f"6. 請從以下【候選景點資料庫】中挑選最適合且最近的 1~3 個：\n{poi_str}\n"
            f"7. 參考今日話題(非強制)：\n{social_context}\n"
        )
        
        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash-lite",
            generation_config={"response_mime_type": "application/json"}
        )
        
        # 組合歷史與當前問題
        prompt_parts = [system_instruction]
        for msg in history[-5:]: # 最近 5 則
            prompt_parts.append(f"User: {msg[user]}\nAI: {msg[ai]}")
        prompt_parts.append(f"User: {request.user_text}")
        
        full_prompt = "\n".join(prompt_parts)
        
        # 4. 呼叫 Gemini
        response = model.generate_content(full_prompt)
        ai_raw_response = response.text
        
        try:
            result = json.loads(ai_raw_response)
        except json.JSONDecodeError:
            logger.error(f"Failed to parse Gemini response: {ai_raw_response}")
            raise HTTPException(status_code=500, detail="Gemini output is not valid JSON")
        
        # 5. 更新對話記憶
        session_db[request.session_id].append({
            "user": request.user_text,
            "ai": result.get("voice_script", "")
        })
        
        # 7. 組裝 Response (Frontend handles TTS via dedicated endpoints)
        return QueryResponse(
            translation=Translation(**result.get("translation", {"zh": "", "en": ""})),
            voice_script=result.get("voice_script", ""),
            itinerary=[ItineraryItem(**item) for item in result.get("itinerary", [])],
            tts_audio_url=None
        )
        
    except Exception as e:
        logger.error(f"Error in play_taipei_query: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
