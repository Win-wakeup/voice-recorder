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
    quick_replies: List[str] = Field(default_factory=list)
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
    "你是一名專業台灣導遊。採用『漸進式探詢』與『Swipe 卡片挑選』機制。\n"
    "嚴格遵守以下規則：\n"
    "1. 意圖歸納與寬鬆提問：若缺乏【明確地點】或【明確主體】，必須親切地追問(`requires_clarification=true`)。但如果使用者已提供足夠資訊(如: 某區+拉麵)，請立刻停止發問直接給名單！並從對話抓出他這趟旅程預計要去『幾個』地點，寫在 `expected_target_count` 中 (例如只說吃拉麵，就是 1)。\n"
    "2. ⚠️【強制網路爬蟲驗證】：你已成功連接 Google Search！你必須，也絕對必須利用 Google Search 查出真實、活生生在該區域的店面名稱與資訊！不准憑空捏造(如拉麵Davidson)！\n"
    "3. 隱藏假地址：所有給出的 candidates 裡的 `address` 欄位，請一律填入「📍 點擊下方按鈕以 Google 地圖導航為準」，禁止出現任何路名或號碼！\n"
    "你的回覆必須是嚴格 JSON。\n"
    "JSON Schema 如下：\n"
    "{\n"
    "  \"requires_clarification\": true 或 false,\n"
    "  \"expected_target_count\": 1,\n"
    "  \"translation\": {\"zh\": \"解讀\", \"en\": \"translation\"},\n"
    "  \"voice_script\": \"聊天用語\",\n"
    "  \"quick_replies\": [\"按鈕\"],\n"
    "  \"swipe_candidates\": [\n"
    "    {\"time\": \"時間\", \"name\": \"真實上網查到的店名\", \"price\": \"價格\", \"distance\": \"距離\", \"description\": \"真心推薦\", \"address\": \"📍 點擊下方按鈕以 Google 地圖導航為準\", \"image_url\": \"\"}\n"
    "  ]\n"
    "}\n"
    "- 社群話題：\n{social_context}\n"
)

GUIDE_MODEL = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    tools="google_search",
    
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
        
        # Strip potential markdown block
        clean_json = ai_raw_response.strip()
        if clean_json.startswith("```json"):
            clean_json = clean_json[7:]
        elif clean_json.startswith("```"):
            clean_json = clean_json[3:]
        if clean_json.endswith("```"):
            clean_json = clean_json[:-3]
        clean_json = clean_json.strip()
        
        try:
            result = json.loads(clean_json)
            # Force strip all addresses programmatically in chat phase
            if "swipe_candidates" in result and result["swipe_candidates"]:
                for cand in result["swipe_candidates"]:
                    cand["address"] = "📍 點擊下方按鈕以 Google 地圖導航為準"

            
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
            voice_script=result.get("voice_script", ""),
            quick_replies=result.get("quick_replies", []),
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
    session_id: str = "default_session"
    expected_target_count: int = 0
    context: ContextData = Field(default_factory=ContextData)

# We will reuse QueryResponse but this time swipe_candidates will hold the chronological itinerary
# to save time redefining schemas. We will just tell the LLM to output the timeline inside "swipe_candidates".

@router.post("/schedule_itinerary", response_model=QueryResponse)
async def schedule_itinerary(request: ScheduleRequest):
    try:
        venue_str = "\n".join([f"- {v.name}: {v.description}" for v in request.liked_venues])
        
        # Load chat history
        history_text = ""
        if request.session_id in session_db:
            history_parts = []
            for msg in session_db[request.session_id][-10:]:
                history_parts.append(f"User: {msg['user']}\nAI: {msg['ai']}")
            history_text = "\n".join(history_parts)
            
        system_prompt = (
            "你是一名專業的台灣在地行程規劃師。使用者已經在『交友軟體式的滑卡介面』中選出了幾家有興趣的景點/餐廳，請你根據對話需求安排『時間軸』。\n\n"
            f"【歷史對話紀錄】：\n{history_text}\n\n"
            f"【使用者選中的候選名單】：\n{venue_str}\n\n"
            "嚴格遵守以下規則：\n"
            "1. 【意圖判定】：請分析對話紀錄，判斷使用者是想要『只吃一餐/去一個地方』還是『玩一整天/多個地點』。並在 JSON 的 `is_single_event` 欄位誠實回報 (true/false)。\n"
            "   - 如果使用者只說了「我想吃拉麵」、「6.吃」，那代表他只想吃一餐，必須設為 true。\n"
            "   - 如果 `is_single_event` 為 true，你的 `swipe_candidates` 陣列【絕對只能有 1 個地點】！請從使用者的名單中挑出最棒的 1 家放進來，不要排兩家！\n"
            "2. 【地址抹除防護】：為了防止你產生錯亂的幻覺地址，**請不要在 address 欄位寫出任何縣市道路門牌！** 請統一固定填寫「📍 請點擊下方導航查看確切位置」。\n"
            "3. 回覆必須是合法的 JSON。\n"
            "JSON Schema 如下：\n"
            "{\n"
            "  \"requires_clarification\": false,\n"
            "  \"is_single_event\": true 或 false,\n"
            "  \"translation\": {\"zh\": \"這是最後的精華行程表！\", \"en\": \"Here is your itinerary!\"}\n,"
            "  \"voice_script\": \"行程排好囉！為您精選出了最棒的安排。\",\n"
            "  \"swipe_candidates\": [\n"
            "    {\"time\": \"排定時間\", \"name\": \"店名\", \"price\": \"價格\", \"distance\": \"交通\", \"description\": \"推薦理由\", \"address\": \"📍 請點擊下方導航查看確切位置\", \"image_url\": \"\"}\n"
            "  ]\n"
            "}\n"
        )
        
        response = GUIDE_MODEL.generate_content(system_prompt)
        ai_raw_response = response.text
        
        # Strip potential markdown block
        clean_json = ai_raw_response.strip()
        if clean_json.startswith("```json"):
            clean_json = clean_json[7:]
        elif clean_json.startswith("```"):
            clean_json = clean_json[3:]
        if clean_json.endswith("```"):
            clean_json = clean_json[:-3]
        clean_json = clean_json.strip()
        
        result = json.loads(clean_json)
        
        # --- HARD PROGRAMMATIC OVERRIDES (Do not trust the LLM!) ---
        # Override the length if the LLM flags it as a single event but disobeys length
        # Mathematical absolute constraint
        target_c = request.expected_target_count
        if target_c > 0 and len(result.get("swipe_candidates", [])) > target_c:
            result["swipe_candidates"] = result["swipe_candidates"][:target_c]
            
        # Strip all addresses programmatically in case the LLM disobeys the address rule
        for cand in result.get("swipe_candidates", []):
            cand["address"] = "📍 請以 Google Maps 導航為準"

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
