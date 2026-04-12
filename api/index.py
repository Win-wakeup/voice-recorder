import os
import time
import json
import asyncio
import logging
from pathlib import Path
import google.generativeai as genai
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from dotenv import load_dotenv
import requests
import io
import speech_recognition as sr

# ==========================================
# 0. Logging & Environment
# ==========================================
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# 嘗試載入 .env, 若在 Vercel 則已存在環境變數中
load_dotenv()

api_keys_env = os.getenv("GEMINI_API_KEY")

if api_keys_env:
    genai.configure(api_key=api_keys_env.split(",")[0].strip())
else:
    logger.warning("GEMINI API Key not found in environment!")

# ==========================================
# 1. 架構設定 (Model & Constants)
# ==========================================
# 嘗試不同的路徑尋找字典
possible_dict_paths = [
    Path(__file__).parent / "taipei_dict.json",
    Path(__file__).parent.parent / "taipei_dict.json",
    Path.cwd() / "taipei_dict.json",
    Path.cwd().parent / "taipei_dict.json"
]

LOCAL_DICT = {}
for p in possible_dict_paths:
    if p.exists():
        try:
            with open(p, "r", encoding="utf-8") as f:
                LOCAL_DICT = json.load(f)
            logger.info(f"Loaded dictionary from {p}")
            break
        except Exception as e:
            logger.warning(f"Failed to load dict from {p}: {e}")

# 預先處理靜態字典字串 
DICT_CONTEXT = "\n".join([f"{k}: {v}" for k, v in LOCAL_DICT.items()])

system_instruction = (
    "You are a Taiwanese tourist driver translating for foreign passengers.\n"
    "Your tasks:\n"
    "1. Ignore meaningless filler words or stutters from the [Target Text].\n"
    "2. Translate the text accurately into English.\n"
    "3. Polish the English translation to make it sound natural and fluent.\n"
    "CRITICAL RULE: DO NOT add, invent, or assume any extra information. You MUST strictly stick to what is explicitly said.\n"
    "Respond EXCLUSIVELY in valid JSON format with exactly two keys:\n"
    "1. \"raw_translation\": exact direct translation.\n"
    "2. \"final_english\": naturally polished spoken English, free of filler words and strictly adhering to the original facts.\n"
    "Ensure your output is strictly json, NO markdown.\n\n"
    "Examples:\n"
    "[Target Text]: 那個...呃...右邊那個是台北101大樓啦\n"
    '{"raw_translation": "That... uh... that one on the right is Taipei 101 building.", '
    '"final_english": "On your right is the Taipei 101 building."}\n'
    "[Target Text]: 這裡就是野柳女王頭，請記得帶走隨身物品喔\n"
    '{"raw_translation": "This is Yehliu Queen\'s Head, please remember to take your belongings.", '
    '"final_english": "This is the Yehliu Queen\'s Head. Please make sure you have all your belongings with you."}'
)

if api_keys_env:
    translator_model = genai.GenerativeModel(
        model_name="gemini-2.5-flash-lite",
        system_instruction=system_instruction,
        generation_config={
            "response_mime_type": "application/json",
        }
    )
else:
    translator_model = None

# ==========================================
# FastAPI App
# ==========================================
app = FastAPI(
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    title="Taxi Integrated API (STT & Translation)"
)

# --- Memory and Cache for Translation ---
memory_db = {}
client_activity = {}
MEMORY_TTL_SECONDS = 3600 

MAX_CACHE_SIZE = 2000
translation_cache = {} 

class TranslationRequest(BaseModel):
    ride_id: str
    text: str

class EndRideRequest(BaseModel):
    ride_id: str

class AudioRequest(BaseModel):
    audio_path: str

def process_ride_data(data: dict):
    logger.info(f"📦 [Export] Ride {data['ride_id']} finished with {data['total_conversations']} messages.")

def cleanup_idle_sessions():
    """清理超過 TTL 未活動的 ride_id (優化點：防呆 Memory Leak)"""
    now = time.time()
    expired_rides = [
        r_id for r_id, last_active in client_activity.items() 
        if now - last_active > MEMORY_TTL_SECONDS
    ]
    for r_id in expired_rides:
        if r_id in memory_db:
            logger.info(f"🧹 [Cleanup] Auto-removing idle ride: {r_id}")
            del memory_db[r_id]
        if r_id in client_activity:
            del client_activity[r_id]

def cache_add(text: str, raw: str, final: str):
    """將翻譯結果加入快取，若達到上限則執行「保留高頻次，刪除低頻次一半」機制"""
    key = text.strip()
    if len(translation_cache) >= MAX_CACHE_SIZE:
        sorted_items = sorted(translation_cache.items(), key=lambda item: item[1]["hits"], reverse=True)
        half_size = MAX_CACHE_SIZE // 2
        keys_to_delete = [item[0] for item in sorted_items[half_size:]]
        for k in keys_to_delete:
            del translation_cache[k]
        logger.info(f"🧹 [Cache Cleanup] Cleared {len(keys_to_delete)} low-frequency cache items.")
    
    translation_cache[key] = {
        "raw": raw,
        "final": final,
        "hits": 1
    }

# ==========================================
# Endpoints
# ==========================================

@app.post("/api/stt")
async def stt_endpoint(data: AudioRequest):
    download_url = data.audio_path.replace('.webm', '.wav')
    
    try:
        response = requests.get(download_url)
        response.raise_for_status()
    except requests.RequestException as e:
        return {"error": f"Failed to download audio: {str(e)}", "status": "error"}

    recognizer = sr.Recognizer()
    audio_io = io.BytesIO(response.content)

    try:
        with sr.AudioFile(audio_io) as source:
            audio_data = recognizer.record(source)
            
        print("⏳ 正在傳送至 Google 進行辨識...")
        text = recognizer.recognize_google(audio_data, language="zh-TW")
        print(f"✅ 辨識結果：{text}")
        return {"text": text, "status": "success"}
    
    except sr.UnknownValueError:
        return {"error": "❌ 聽不懂您說的話，請再試一次。", "status": "error"}
    except sr.RequestError:
        return {"error": "❌ 無法連線至語音辨識伺服器，請檢查網路。", "status": "error"}
    except ValueError as e:
        return {"error": f"Audio file formatting error: {str(e)}", "status": "error"}
    except Exception as e:
        return {"error": f"Unexpected error: {str(e)}", "status": "error"}

@app.post("/api/translate")
@app.post("/translate")  # 保留原始端點名稱
async def translate_text(request: TranslationRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(cleanup_idle_sessions)

    start_time = time.time()
    ride_id = request.ride_id
    new_text = request.text.strip()
    
    if not new_text:
        raise HTTPException(status_code=400, detail="Empty text")

    if not translator_model:
        logger.warning("Translator model not initialized due to missing API key")
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")

    if ride_id not in memory_db:
        memory_db[ride_id] = []
    
    client_activity[ride_id] = start_time

    if new_text in translation_cache:
        translation_cache[new_text]["hits"] += 1
        raw_english = translation_cache[new_text]["raw"]
        final_english = translation_cache[new_text]["final"]
        logger.info(f"⚡ [Cache Hit] Hits: {translation_cache[new_text]['hits']} for text: {new_text}")
    else:
        raw_english = "(Translation Failed)"
        final_english = "(Polishing Failed)"
        
        try:
            prompt = f"[Vocabulary Hints]:\n{DICT_CONTEXT}\n\n[Target Text]:\n{new_text}"
            logger.info(f"🔄 [Processing] Uncached. Calling API for: {new_text}")
            response = await asyncio.wait_for(
                translator_model.generate_content_async(prompt), timeout=20.0
            )       
            result_text = response.text.strip()
            
            try:
                parsed_result = json.loads(result_text)
                raw_english = parsed_result.get("raw_translation", raw_english)
                final_english = parsed_result.get("final_english", final_english)
                logger.info(f"✅ [API Success] Raw: {raw_english} | Final: {final_english}")
                
                if not raw_english.startswith("(") and not final_english.startswith("("):
                    cache_add(new_text, raw_english, final_english)
                    
            except json.JSONDecodeError:
                logger.error(f"❌ [Error] Failed to parse JSON from AI: {result_text}")
                final_english = "(Parsing error from AI response)"

        except asyncio.TimeoutError:
             logger.error(f"❌ [Error] AI request timed out")
             final_english = "(Service timeout)"
        except Exception as e:
            logger.error(f"❌ [Error in Translation] {repr(e)}")
            final_english = f"(Service error: {repr(e)})"

    if final_english and not final_english.startswith("("):
        memory_db[ride_id].append({
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "zh": new_text, 
            "en_raw": raw_english, 
            "en_polished": final_english
        })

    return {
        "ride_id": ride_id,
        "original_zh": new_text,
        "raw_translation": raw_english,
        "final_english": final_english,
        "process_time": round(time.time() - start_time, 2)
    }

@app.post("/api/end_ride")
@app.post("/end_ride")  # 保留原始端點名稱
async def end_ride(request: EndRideRequest, background_tasks: BackgroundTasks):
    ride_id = request.ride_id
    if ride_id in memory_db:
        ride_history = memory_db[ride_id]
        
        if ride_history:
            export_data = {
                "ride_id": ride_id,
                "export_time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "total_conversations": len(ride_history),
                "dialogues": ride_history
            }
            background_tasks.add_task(process_ride_data, export_data)
        
        del memory_db[ride_id]
        if ride_id in client_activity:
            del client_activity[ride_id]
            
        return {"status": "exported"}
        
    return {"status": "not_found"}

@app.get("/api/hello_world")
@app.get("/hello_world")
async def hello_world():
    return {
        "text": "Hello from FastAPI on Vercel with Integrated Translation API!",
        "status": "success",
        "timestamp": "2026-04-11"
    }

