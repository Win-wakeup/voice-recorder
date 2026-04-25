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
    time: Optional[str] = ""
    price: Optional[str] = ""
    distance: Optional[str] = ""
    address: str = ""
    description: str
    image_url: str = ""

class Translation(BaseModel):
    zh: str
    en: str

class QueryResponse(BaseModel):
    status: str = "success"
    requires_clarification: bool = False
    translation: Translation
    voice_script: str
    swipe_candidates: List[ItineraryItem]

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
    "你是一名台灣在地雙語導遊，必須根據使用者的位置與真正需求給出最佳推薦。\n"
    "嚴格遵守以下規則：\n"
    "1. 如果候選清單中「完全沒有」符合使用者需求(例如想找拉麵、特定異國料理、稀有景點)的選項，請**跳脫候選名單**！請直接動用你內建的 Google Maps 地理知識庫，推薦附近真實存在、且評價很高的店家！千萬不可拿名單內無關的東西硬湊！\n"
    "2. 【要求安排『行程/一日遊』】：請務必填寫具體的『時間(time)』(如早上10:00、中午用餐)，並安插『美食/餐廳』，不能只丟出幾個景點，必須是連續且充實的一天。\n"
    "3. 【主動討論行程】：如果使用者的需求非常模糊(例如：沒說預算、沒說想去幾個景點、想吃幾餐)，請務必將 `requires_clarification` 設為 true，並在 voice_script 中**主動提問**引導(例如: '<聲音腳本> 請問預算大約多少？預計要排幾個點呢？')，這時 swipe_candidates 請給空列表 []。\n"
    "4. 你的回覆必須是嚴格的 JSON 格式。\n"
    "JSON Schema 如下：\n"
    "{\n"
    "  \"requires_clarification\": true或false,\n"
    "  \"translation\": {\"zh\": \"精確解讀中文(若需致歉在此)\", \"en\": \"英文翻譯\"}\n,"
    "  \"voice_script\": \"熱情但不廢話的回覆。若 requires_clarification=true，請在此發問。若收集完畢，說這是我幫你整理的候選名單！\",\n"
    "  \"swipe_candidates\": [\n"
    "    {\"time\": \"推薦停留多久(如: 1.5小時)\", \"name\": \"景點/餐廳\", \"price\": \"估計價格帶(如: 150-300元)\", \"distance\": \"距離\", \"description\": \"為何推薦\", \"address\": \"地址\", \"image_url\": \"圖片網址\"}\n" 
    "  ]\n"
    "}\n"
    "規則：\n"
    "1. 如果使用者只是在寒暄，itinerary 可以是空陣列。\n"
    "2. translation 欄位：自動偵測使用者輸入的語言。如果輸入是中文，zh 欄位保留原文，並將其翻譯成英文填入 en 欄位；如果輸入是英文，en 欄位保留原文，並將其翻譯成中文填入 zh 欄位。\n"
    "3. voice_script 欄位：此欄位的語言必須與 translation 欄位中被翻譯出來的目標語言一致。例如，若使用者輸入中文，此欄位應為英文；若使用者輸入英文，此欄位應為中文。內容應為自然、口語化的導遊介紹詞，而不僅是生硬的翻譯。\n"
    "4. 參考景點：{poi_str}\n"
    "5. 今日社群話題：\n{social_context}\n"
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
        
        # --- 優化點 2: 使用明確字串替換指令 ---
        system_instruction = SYSTEM_INSTRUCTION_TEMPLATE.replace(
            "{poi_str}", poi_str
        ).replace(
            "{social_context}", social_context
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
            
            # --- 動態反哺寫入機制 ---
            from api.index import LOCAL_DICT as TAIPEI_DICT
            import os
            
            new_pois_added = False
            if "swipe_candidates" in result and isinstance(result["swipe_candidates"], list):
                if isinstance(TAIPEI_DICT, dict):
                    dict_names = list(TAIPEI_DICT.keys())
                else:
                    dict_names = [p.get("name", "") for p in TAIPEI_DICT]
                
                for item in result["swipe_candidates"]:
                    p_name = item.get("name")
                    if p_name and p_name not in dict_names:
                        new_entry = {"name": p_name, "translation": item.get("en", p_name), "tags": ["🤖 AI推薦"]}
                        if isinstance(TAIPEI_DICT, dict):
                            TAIPEI_DICT[p_name] = item.get("en", p_name)
                        else:
                            TAIPEI_DICT.append(new_entry)
                        new_pois_added = True
            
            if new_pois_added:
                try:
                    dict_path = os.path.join(os.path.dirname(__file__), "..", "taipei_dict.json")
                    with open(dict_path, "w", encoding="utf-8") as f:
                        json.dump(TAIPEI_DICT, f, ensure_ascii=False, indent=2)
                except OSError:
                    pass
        except json.JSONDecodeError:
            logger.error(f"Failed to parse Gemini response: {ai_raw_response}")
            raise HTTPException(status_code=500, detail="Gemini output is not valid JSON")
        
        # 5. 更新對話記憶
        session_db[request.session_id].append({
            "user": request.user_text,
            "ai": result.get("voice_script", "")
        })
        
        # 7. 組裝 Response
        return QueryResponse(
            requires_clarification=result.get("requires_clarification", False),
            translation=Translation(**result.get("translation", {"zh": "", "en": ""})),
            voice_script=voice_script,
            swipe_candidates=[ItineraryItem(**item) for item in result.get("swipe_candidates", [])],
        )
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"Error in play_taipei_query: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# 4. Schedule Final Itinerary Endpoint
# ==========================================

class ScheduleRequest(BaseModel):
    liked_venues: List[ItineraryItem]
    context: ContextData = Field(default_factory=ContextData)

# We will reuse QueryResponse but this time swipe_candidates will hold the chronological itinerary
# to save time redefining schemas. We will just tell the LLM to output the timeline inside "swipe_candidates".

@router.post("/schedule_itinerary", response_model=QueryResponse)
async def schedule_itinerary(request: ScheduleRequest):
    try:
        venue_str = "\n".join([f"- {v.name}: {v.description}" for v in request.liked_venues])
        
        system_prompt = (
            "你是一名專業行程規劃師。使用者已經選出了他們想去的景點/餐廳列表，請幫他們安排出合理的『一日遊行程表』。\n"
            "請為每個地點安排具體的拜訪時間(time)，並在備註中加入交通建議。\n"
            f"使用者選定的景點如下：\n{venue_str}\n\n"
            "你的回覆必須是嚴格的 JSON 格式。\n"
            "JSON Schema 如下：\n"
            "{\n"
            "  \"requires_clarification\": false,\n"
            "  \"translation\": {\"zh\": \"這是為您精心規劃的行程表！\", \"en\": \"Here is your itinerary!\"},\n"
            "  \"voice_script\": \"行程已經為您排好囉！請看下方的時間表。\",\n"
            "  \"swipe_candidates\": [\n"
            "    {\"time\": \"開始時間 (如: 09:00)\", \"name\": \"景點/餐廳名稱\", \"price\": \"價格\", \"distance\": \"交通/步行預估\", \"description\": \"你對此安排的簡短導覽\", \"address\": \"地址\", \"image_url\": \"\"}\n"
            "  ]\n"
            "}\n"
            "注意：請確保所有使用者選定的景點都被納入 schedule 中(放進 swipe_candidates 陣列裡)！"
        )
        
        response = GUIDE_MODEL.generate_content(system_prompt)
        ai_raw_response = response.text
        
        result = json.loads(ai_raw_response)
        
        return QueryResponse(
            requires_clarification=False,
            translation=Translation(**result.get("translation", {"zh": "這是您的最終行程表", "en": "Final Itinerary"})),
            voice_script=result.get("voice_script", "行程排好囉！"),
            swipe_candidates=[ItineraryItem(**item) for item in result.get("swipe_candidates", [])],
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
