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
    name: Optional[str] = ""
    time: Optional[str] = ""
    price: Optional[str] = ""
    distance: Optional[str] = ""
    address: Optional[str] = ""
    description: Optional[str] = ""
    image_url: Optional[str] = ""

class Translation(BaseModel):
    zh: str
    en: str

class QueryResponse(BaseModel):
    status: str = "success"
    requires_clarification: bool = False
    is_itinerary: bool = False
    translation: Translation
    voice_script: str
    quick_replies: List[str] = Field(default_factory=list)
    swipe_candidates: List[ItineraryItem]

# ==========================================
# 2. Configuration & Memory
# ==========================================

from dotenv import load_dotenv
load_dotenv()
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
    "1. 嚴格漸進式探詢：你【必須】收集到四大要素：『地點(例如：台北哪一區)』、『種類(吃或玩)』、『預算或價位』、『幾個人去』。即使使用者提出各種天馬行空的行程，但只要他們沒說在哪裡(地點)，你【絕對必須】設 requires_clarification=true，並且『立刻親切追問』：「聽起來太棒了！那請問你們有想去台北哪一區嗎？」，直到四大要素全部都收集完了，才能給名單！\n"
    "2. ⚠️【強制真實店家驗證】：你已經開啟雙活網路爬蟲！請你『絕對只能』從下方 [來自 Google Maps 的真實資料] 或 [來自網路爬蟲的真實資料] 中挑選出明確的店家並推薦！『絕對不可以憑空捏造任何店名』！資料裡沒寫的名字就不准掰！\n"
    "2B. 【行程表模式 vs 挑卡模式切換關鍵】：只要使用者在一句話中『同時要求兩種以上的不同活動』（例如找午餐+溜冰），請立刻切換為【行程表模式】（`is_itinerary` 設為 true）。『超級重要警告』：即使是行程表，你也『絕對不可以』每個活動只給一個選項！請為『每一個活動』都提供【至少 2 到 3 個不同的優質選擇】！例如：給 3 間完全不同的餐廳、2 個不同的商場，加上溜冰場，總計生出至少 6~8 張卡片！我們要讓使用者可以享受「左滑右滑挑選」的樂趣！\n"
    "3. ⚠️【業務範圍】：涵蓋大台北生活圈。只要 GPS 或文字提示在『北北基桃』範圍內，絕對不可拒絕服務，必須立刻利用搜尋功能進行推薦！只有在完全無關（如屏東或國外）時才可以委婉拒絕。\n"
    "4. 💰【預算精算師邏輯】：在「行程表模式」下，如果使用者提供的是「總預算」，你必須自動扣除主要活動的估算花費再安排剩下的項目。例如：預算 1000 元，溜冰估計花 600 元，那午餐就只能推薦人均 200~300 元的平價選項，並扣掉100元交通費。請務必在回應中展現你為他們「精打細算、考慮周全」的貼心感，並告訴他們你的預算分配法！\n"
    "4B. 💖【客群與氛圍配對 (Vibe Match)】：在挑選景點和餐廳時，務必具有高度的社交常識！如果使用者說「約會」，請絕對不要塞入「親子樂園」或過於雜亂的排隊平價小吃，而是要尋找適合情侶互動的景點（例如做蛋糕、看夜景、溜冰）與有浪漫氛圍的餐廳！請在卡片描述中巧妙點出「為什麼這個地方適合約會/親子/朋友聚會」！\n"
    "5. ⚡️【挑卡選項數量最高原則】：不論是單一挑卡模式還是多種活動的行程表模式，你都必須『火力全開』大方給出 **至少 6 到 8 個** 選項！嚴格警告：『絕對不准只給 3 張卡片敷衍了事』！爬蟲資料不夠時就找 Google Maps，絕對要把它塞滿！『絕對禁止重複出現同一間店』！！！\n"
    "你的回覆必須是嚴格 JSON。\n"
    "JSON Schema 如下：\n"
    "{\n"
    "  \"requires_clarification\": true 或 false,\n"
    "  \"expected_target_count\": 1,\n"
    "  \"translation\": {\"zh\": \"解讀\", \"en\": \"translation\"},\n"
    "  \"voice_script\": \"聊天用語\",\n"
    "  \"quick_replies\": [\"按鈕\"],\n"
    "  \"swipe_candidates\": [\n"
    "    {\"category\": \"活動類別(例如: 午餐, 逛街, 溜冰)\", \"time\": \"時間\", \"name\": \"真實上網查到的店名(含分店)\", \"price\": \"價格\", \"distance\": \"🚗10分 🚌捷運某站走路5分\", \"description\": \"真心推薦\", \"address\": \"真實地址\", \"image_url\": \"\"}\n"
    "  ]\n"
    "}\n"
    "- 社群話題：\n{social_context}\n"
    "- 網路即時搜尋資料與商家資訊：\n{web_search}\n"
)

GUIDE_MODEL = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    
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

import urllib.request
import urllib.parse
import re

def scrape_duckduckgo(query: str) -> str:
    import urllib.request, urllib.parse, re
    try:
        if len(query) < 2 or query in ["你好", "掰掰", "hello", "hi"]: return ""
        import datetime
        search_query = f"{query[:20]} {datetime.datetime.now().year} 最新 仍在營業 推薦 新北 台北" 
        data = urllib.parse.urlencode({'q': search_query}).encode('utf-8')
        req = urllib.request.Request('https://lite.duckduckgo.com/lite/', data=data, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0)'})
        html = urllib.request.urlopen(req, timeout=1.5).read().decode('utf-8')
        snippets = []
        for match in re.finditer(r"class='result-snippet'[^>]*>(.*?)</td>", html, flags=re.S):
            text = re.sub(r'<[^>]+>', '', match.group(1)).strip()
            if text: snippets.append(text)
        return "\n".join(snippets[:5]) if snippets else ""
    except Exception:
        return ""

def get_grounding_context(query: str, lat: float=None, lng: float=None) -> str:
    import concurrent.futures
    ddg_text = ""
    places_text = ""
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        future_ddg = executor.submit(scrape_duckduckgo, query)
        future_places = None
        if lat and lng:
            future_places = executor.submit(search_google_places, query, lat, lng)
            
        try:
            ddg_text = future_ddg.result()
            if future_places:
                places_text = future_places.result()
        except:
            pass

    combined = ""
    if places_text:
        combined += places_text + "\n"
    if ddg_text:
        combined += ddg_text
        
    return combined

def search_google_places(query: str, lat: float=None, lng: float=None) -> str:
    """Uses Google Places API for 100% accurate location grounding"""
    import urllib.request
    import urllib.parse
    import json
    
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        return ""
        
    try:
        if len(query) < 2 or query in ["你好", "掰掰", "hello", "hi"]:
            return ""
            
        url = "https://places.googleapis.com/v1/places:searchText"
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.priceLevel,places.rating,places.userRatingCount"
        }
        
        # 強制加入地點提示
        payload = {
            "textQuery": f"{query[:50]}",
            "languageCode": "zh-TW",
            "maxResultCount": 10
        }
        
        if lat and lng:
            payload["locationBias"] = {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": 5000.0 # 5km
                }
            }
            
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers)
        
        with urllib.request.urlopen(req, timeout=2.0) as response:
            result = json.loads(response.read().decode("utf-8"))
            
        places = result.get("places", [])
        if not places:
            return "沒有找到符合的實體店家。"
            
        text_snippets = ["【來自 Google Maps 的真實資料】"]
        for p in places:
            name = p.get("displayName", {}).get("text", "Unknown")
            addr = p.get("formattedAddress", "查無地址")
            rating = p.get("rating", "無評分")
            reviews = p.get("userRatingCount", 0)
            text_snippets.append(f"店名: {name} | 地址: {addr} | 評分: {rating} ({reviews}則評論)")
            
        return "\n".join(text_snippets)
    except Exception as e:
        return ""

            
        # Enforce Geofence & Recency & Viability
        import datetime
        current_year = datetime.datetime.now().year
        search_query = f"{query[:20]} {current_year} 最新 仍在營業 推薦 台北 新北 基隆" 
        data = urllib.parse.urlencode({'q': search_query}).encode('utf-8')
        req = urllib.request.Request('https://lite.duckduckgo.com/lite/', data=data, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        html = urllib.request.urlopen(req, timeout=1.5).read().decode('utf-8')
        
        # Regex to find all <td class='result-snippet'>...</td>
        snippets = []
        for match in re.finditer(r"class='result-snippet'[^>]*>(.*?)</td>", html, flags=re.S):
            text = re.sub(r'<[^>]+>', '', match.group(1)).strip()
            if text:
                snippets.append(text)
                
        if snippets:
            return "\n".join(snippets[:5])
    except Exception as e:
        pass
    return ""

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
def play_taipei_query(request: QueryRequest, http_request: FastAPIRequest):
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
        
        # 把對話記憶結合起來搜尋，避免只搜到「我在三峽」而丟失「拉麵」上下文
        search_ctx = request.user_text
        if history:
            # 必須把過去三輪的全部對話結合起來，才不會把「拉麵」這個關鍵意圖洗掉
            recent_msgs = [m['user'] for m in history[-3:]]
            search_ctx = " ".join(recent_msgs) + " " + request.user_text
            
        import re
        stopwords = r"(幫我|找個|有沒有|推薦|這附近|我想去|我要|吧|嗎|呢|了|的|兩個人|幾個人|約會|錢不是問題|隨便|都可以|大概|附近|我想|要吃|去哪|哪裡|介紹)"
        search_ctx_clean = re.sub(stopwords, " ", search_ctx)
        search_ctx_clean = re.sub(r'[^\w\s]', ' ', search_ctx_clean)
        search_ctx_clean = " ".join(search_ctx_clean.split())
        
        web_search = get_grounding_context(search_ctx_clean if search_ctx_clean else search_ctx, request.context.lat, request.context.lng)
        print("\n\n=========== GOOGLE MAPS FETCH ===========\n" + f"【原始】{search_ctx}\n【清洗後】{search_ctx_clean}\n" + str(web_search) + "\n=======================================\n\n")
        system_instruction = SYSTEM_INSTRUCTION_TEMPLATE.replace(
            "{poi_str}", poi_str
        ).replace(
            "{social_context}", social_context
        ).replace(
            "{web_search}", web_search
        )

        
        # 組合歷史與當前問題
        prompt_parts = [system_instruction]
        for msg in history[-5:]: # 最近 5 則
            prompt_parts.append(f"User: {msg['user']}\nAI: {msg['ai']}")
        
        gps_context = f"\n[系統悄悄話: 使用者的目前真實 GPS 座標為 {request.context.lat}, {request.context.lng}。如果對話提到『附近』、『這邊』，請以此座標為圓心進行搜尋。計算交通時間也請以此為起點！]"
        prompt_parts.append(gps_context)
        prompt_parts.append(f"User: {request.user_text}")
        
        full_prompt = "\n".join(prompt_parts)
        
        # 4. 呼叫 Gemini
        if not GUIDE_MODEL:
            raise HTTPException(status_code=500, detail="Gemini API key not configured.")
            
        # --- 優化點 3: 使用共用的模型實例 ---
        response = GUIDE_MODEL.generate_content(full_prompt)
        ai_raw_response = response.text
        print("\n=== RAW AI ===\n", ai_raw_response, "\n=============\n")
        
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
        except json.JSONDecodeError:
            import re
            match = re.search(r'\{.*\}', ai_raw_response, re.DOTALL)
            if match:
                try:
                    result = json.loads(match.group(0))
                except json.JSONDecodeError:
                    raise HTTPException(status_code=500, detail="AI 回傳格式嚴重不正確無法修復")
            else:
                logger.error(f"Failed to parse Gemini response: {ai_raw_response}")
                raise HTTPException(status_code=500, detail="Gemini output is not valid JSON")

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
