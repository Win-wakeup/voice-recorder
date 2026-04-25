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
TTS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "zrHiDhphv9ZnVXBqCLjz") # 從環境變數讀取，預設為 Mimi

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

# --- 優化點 1: 預先建立模型與指令模板 ---
SYSTEM_INSTRUCTION_TEMPLATE = (
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
    "2. translation 欄位：請自動偵測使用者輸入的語言。如果輸入是中文，zh 欄位保留原文，並將其翻譯成英文填入 en 欄位；如果輸入是英文，en 欄位保留原文，並將其翻譯成中文填入 zh 欄位。\n"
    "3. 參考景點：{poi_str}\n"
    "4. 今日社群話題：\n{social_context}\n"
)

GUIDE_MODEL = genai.GenerativeModel(
    model_name="gemini-2.5-flash-lite",
    generation_config={"response_mime_type": "application/json"}
) if GEMINI_API_KEY else None

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
async def play_taipei_query(request: QueryRequest, http_request: FastAPIRequest):
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
        
        # --- 優化點 2: 使用模板格式化指令 ---
        system_instruction = SYSTEM_INSTRUCTION_TEMPLATE.format(
            poi_str=poi_str, social_context=social_context
        )
        
        # 組合歷史與當前問題
        prompt_parts = [system_instruction]
        for msg in history[-5:]: # 最近 5 則
            prompt_parts.append(f"User: {msg['user']}\nAI: {msg['ai']}")
        prompt_parts.append(f"User: {request.user_text}")
        
        full_prompt = "\n".join(prompt_parts)
        
        # 4. 呼叫 Gemini
        if not GUIDE_MODEL:
            raise HTTPException(status_code=500, detail="Gemini API key not configured.")
            
        # --- 優化點 3: 使用共用的模型實例 ---
        response = GUIDE_MODEL.generate_content(full_prompt)
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
            # 為了產生高品質的中文語音，建議使用 multilingual v2 模型
            # 建立儲存音檔的目錄，路徑會是 <專案根目錄>/static/tts
            STATIC_DIR = os.path.join(os.path.dirname(BASE_DIR), "static")
            TTS_OUTPUT_DIR = os.path.join(STATIC_DIR, "tts")
            os.makedirs(TTS_OUTPUT_DIR, exist_ok=True)

            # 參考: https://elevenlabs.io/docs/speech-synthesis/models
            TTS_MODEL_ID = "eleven_multilingual_v2"
            
            tts_api_url = f"https://api.elevenlabs.io/v1/text-to-speech/{TTS_VOICE_ID}"
            
            headers = {
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
                "xi-api-key": ELEVENLABS_API_KEY
            }
            
            data = {
                "text": voice_script,
                "model_id": TTS_MODEL_ID,
                "voice_settings": {
                    "stability": 0.5, # 穩定性，數值越高聲音越單調穩定
                    "similarity_boost": 0.5, # 【解決方案】降低相似度，讓模型專注於生成自然的中文語調，而非模仿原聲
                    "style": 0.1, # 風格誇張度，設低一點讓語氣更平實
                    "use_speaker_boost": True # 推薦開啟，能增強聲音的清晰度
                }
            }
            
            try:
                response = requests.post(tts_api_url, json=data, headers=headers)
                response.raise_for_status()
                
                # 1. 產生一個獨一無二的檔案名稱
                filename = f"{uuid.uuid4()}.mp3"
                filepath = os.path.join(TTS_OUTPUT_DIR, filename)

                # 2. 將 ElevenLabs 回傳的音訊內容寫入檔案
                with open(filepath, "wb") as f:
                    f.write(response.content)
                
                # 3. 產生一個前端可以存取的 URL
                #    這需要主應用程式設定好靜態檔案路徑 (請見步驟 3)
                tts_url = str(http_request.url_for('static', path=f'tts/{filename}'))

                logger.info(f"TTS audio generated for session {request.session_id} at {tts_url}")

            except requests.exceptions.RequestException as re:
                logger.error(f"ElevenLabs API request failed: {re}")
            except Exception as e:
                logger.error(f"Failed to save or create URL for TTS audio: {e}")

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
