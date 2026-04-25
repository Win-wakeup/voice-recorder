import os
import json
import time
import logging
from typing import List, Dict, Optional, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import google.generativeai as genai
import requests

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
    
    for name, en_name in TAIPEI_DICT.items():
        score = 0
        # 關鍵字匹配
        for tag in tags:
            if tag in name:
                score += 2
        
        # 天氣適配性 (模擬)
        if is_rainy:
            if any(k in name for k in ["博物館", "地下街", "商場", "百貨", "寺"]):
                score += 1
        else:
            if any(k in name for k in ["公園", "步道", "山", "街"]):
                score += 1
        
        if score > 0:
            candidates.append({"name": name, "en_name": en_name, "score": score})
    
    # 按分數排序並取前 3
    candidates.sort(key=lambda x: x["score"], reverse=True)
    return candidates[:3]

def get_social_context() -> str:
    """獲取熱門社交情緒摘要"""
    if not SOCIAL_SENTIMENT:
        return "目前無特別熱門話題。"
    
    summaries = [f"- {item['topic']}: {item['summary']}" for item in SOCIAL_SENTIMENT[:3]]
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
        poi_str = ", ".join([p['name'] for p in best_pois]) if best_pois else "無推薦景點"
        
        system_instruction = (
            "你是一名台灣雙語導遊，口氣熱情熱心。\n"
            "你必須根據使用者提問、參考景點、今日社交熱門話題來回答。\n"
            "回覆必須是嚴格的 JSON 格式。\n"
            "JSON Schema 如下：\n"
            "{\n"
            "  \"translation\": {\"zh\": \"中文翻譯\", \"en\": \"英文翻譯\"},\n"
            "  \"voice_script\": \"導遊的口說台詞，要自然且包含推薦原因\",\n"
            "  \"itinerary\": [\n"
            "    {\"name\": \"景點名稱\", \"description\": \"景點簡介\", \"address\": \"地址(若知)\", \"image_url\": \"圖片URL(留空)\"}\n"
            "  ]\n"
            "}\n"
            "規則：\n"
            "1. 如果使用者只是在寒暄，itinerary 可以是空陣列。\n"
            "2. translation 欄位：如果是中文就原封不動，如果是英文就翻中文；en 欄位同理。\n"
            f"3. 參考景點：{poi_str}\n"
            f"4. 今日社群話題：\n{social_context}\n"
        )
        
        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash-lite",
            generation_config={"response_mime_type": "application/json"}
        )
        
        # 組合歷史與當前問題
        prompt_parts = [system_instruction]
        for msg in history[-5:]: # 最近 5 則
            prompt_parts.append(f"User: {msg['user']}\nAI: {msg['ai']}")
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
        
        # 6. TTS (ElevenLabs) - 模擬與實作
        voice_script = result.get("voice_script", "")
        tts_url = None
        
        if ELEVENLABS_API_KEY and voice_script:
            # 此處為 ElevenLabs 整合範例，實務上可根據需求調整 voice_id
            # 為了 demo，我們先回傳一個 mock URL 或實際打 API
            # logger.info("Calling ElevenLabs TTS...")
            pass # 這裡預留實作空間，或在 index.py 統一處理
            
        # 7. 組裝 Response
        return QueryResponse(
            translation=Translation(**result.get("translation", {"zh": "", "en": ""})),
            voice_script=voice_script,
            itinerary=[ItineraryItem(**item) for item in result.get("itinerary", [])],
            tts_audio_url=tts_url
        )
        
    except Exception as e:
        logger.error(f"Error in play_taipei_query: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
