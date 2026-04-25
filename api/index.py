import os
import time
import json
import asyncio
import logging
from pathlib import Path
import google.generativeai as genai
from typing import Dict, List, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import traceback
import subprocess
from pydantic import BaseModel
from dotenv import load_dotenv
import requests
import io
import re
import speech_recognition as sr
from .routers import play_taipei

# ==========================================
# 0. Logging & Environment
# ==========================================
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# 嘗試載入 .env, 若在 Vercel 則已存在環境變數中
load_dotenv()

# Read ELEVENLABS at module time (not used at module load)
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
CLOUDINARY_CLOUD_NAME = os.getenv("CLOUDINARY_CLOUD_NAME")
CLOUDINARY_API_KEY = os.getenv("CLOUDINARY_API_KEY")
CLOUDINARY_API_SECRET = os.getenv("CLOUDINARY_API_SECRET")

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

LOCAL_DICT = []
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
DICT_CONTEXT = "\n".join([f"{item['name']}: {item['translation']}" for item in LOCAL_DICT if isinstance(item, dict) and 'name' in item and 'translation' in item])

system_instruction = (
    "You are a professional Taiwanese bilingual translator (Traditional Chinese and English).\n"
    "Your tasks:\n"
    "1. Detect the source language of the [Target Text] (either Chinese or English).\n"
    "2. If the input is Chinese, translate it into natural, fluent English.\n"
    "3. If the input is English, translate it into natural, fluent Traditional Chinese (Taiwan usage).\n"
    "4. Ignore meaningless filler words or stutters (e.g., 'uh', 'um', '那個').\n"
    "5. Polish the translation to make it sound natural for spoken conversation.\n"
    "CRITICAL RULE: DO NOT add, invent, or assume any extra information. Strictly stick to the original meaning.\n"
    "Respond EXCLUSIVELY in valid JSON format with exactly three keys:\n"
    "1. \"detected_lang\": the detected source language code (\"zh\" or \"en\").\n"
    "2. \"raw_translation\": a direct translation of the content.\n"
    "3. \"translated_text\": the naturally polished translation.\n"
    "Ensure your output is strictly JSON, NO markdown.\n\n"
    "Examples:\n"
    "[Target Text]: 那個...呃...右邊那個是台北101大樓啦\n"
    '{"detected_lang": "zh", "raw_translation": "That... uh... that one on the right is Taipei 101 building.", '
    '"translated_text": "On your right is the Taipei 101 building."}\n'
    "[Target Text]: Look! The Queen's Head is right over there.\n"
    '{"detected_lang": "en", "raw_translation": "看！女王頭就在那邊。", '
    '"translated_text": "快看！女王頭就在那裡。"}'
)

# Lazy-load: model initialized on first request so Vercel env vars are available
_translator_model = None

def get_translator_model():
    global _translator_model
    if _translator_model is not None:
        return _translator_model
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not found at request time!")
        return None
    genai.configure(api_key=api_key.split(",")[0].strip())
    try:
        _translator_model = genai.GenerativeModel(
            model_name="gemini-2.5-flash-lite",
            system_instruction=system_instruction,
            generation_config={"response_mime_type": "application/json"},
        )
        logger.info("Gemini model lazy-initialized successfully.")
    except Exception as e:
        logger.error(f"Failed to initialize Gemini model: {e}")
    return _translator_model

from fastapi.middleware.cors import CORSMiddleware

# ==========================================
# FastAPI App
# ==========================================
app = FastAPI(
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    title="Taxi Integrated API (STT & Translation)"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Module 2 Routers
app.include_router(play_taipei.router, prefix="/api/play_taipei", tags=["Play Taipei"])

# --- Memory and Cache for Translation ---
memory_db: Dict[str, List[Dict[str, Any]]] = {}
client_activity: Dict[str, float] = {}
MEMORY_TTL_SECONDS = 3600 

MAX_CACHE_SIZE = 2000
translation_cache: Dict[str, Dict[str, Any]] = {} 

class TranslationRequest(BaseModel):
    ride_id: str
    text: str

class EndRideRequest(BaseModel):
    ride_id: str

class AudioRequest(BaseModel):
    audio_path: str

class ContextRequest(BaseModel):
    time: str
    weather: str

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
        keys_to_delete = [sorted_items[i][0] for i in range(half_size, len(sorted_items))]
        for k in keys_to_delete:
            del translation_cache[k]
        logger.info(f"🧹 [Cache Cleanup] Cleared { len(keys_to_delete) } low-frequency cache items.")
    
    translation_cache[key] = {
        "raw": raw,
        "final": final,
        "hits": 1
    }

# ==========================================
# Endpoints
# ==========================================

@app.post("/api/stt")
async def stt_endpoint(audio: UploadFile = File(...)):
    groq_key = os.getenv("GROQ_API_KEY", "")

    if not groq_key:
        return {"error": "GROQ_API_KEY not configured", "status": "error"}

    try:
        content = await audio.read()
        filename = audio.filename or "audio.webm"
        mime = audio.content_type or "audio/webm"

        logger.info(f"⏳ Sending to Groq Whisper ({mime})...")
        groq_resp = requests.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {groq_key}"},
            files={"file": (filename, content, mime)},
            data={"model": "whisper-large-v3-turbo", "language": "zh", "response_format": "text"},
            timeout=60
        )

        if groq_resp.status_code != 200:
            return {"error": f"Groq STT error: {groq_resp.text}", "status": "error"}

        text = groq_resp.text.strip()
        logger.info(f"✅ Groq 辨識結果：{text}")
        return {"text": text, "status": "success"}

    except Exception as e:
        logger.error(f"STT Exception: {e}")
        return {"error": f"Unexpected error: {str(e)}", "status": "error"}


@app.post("/api/translate")
async def translate_text(request: TranslationRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(cleanup_idle_sessions)

    start_time = time.time()
    ride_id = request.ride_id
    new_text = request.text.strip()
    
    if not new_text:
        raise HTTPException(status_code=400, detail="Empty text")

    translator_model = get_translator_model()
    if not translator_model:
        logger.warning("Translator model not initialized due to missing API key")
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")

    if ride_id not in memory_db:
        memory_db[ride_id] = []
    
    client_activity[ride_id] = start_time

    if new_text in translation_cache:
        translation_cache[new_text]["hits"] += 1
        raw_translation = translation_cache[new_text]["raw"]
        translated_text = translation_cache[new_text]["final"]
        detected_lang = translation_cache[new_text].get("lang", "auto")
        logger.info(f"⚡ [Cache Hit] Hits: {translation_cache[new_text]['hits']} for text: {new_text}")
    else:
        raw_translation: str = "(Translation Failed)"
        translated_text: str = "(Polishing Failed)"
        detected_lang: str = "unknown"
        
        try:
            prompt = f"[Vocabulary Hints]:\n{DICT_CONTEXT}\n\n[Target Text]:\n{new_text}"
            logger.info(f"🔄 [Processing] Uncached. Calling API for: {new_text}")
            response = await asyncio.wait_for(
                translator_model.generate_content_async(prompt), timeout=20.0
            )       
            result_text = response.text.strip()
            
            # Robust JSON extraction
            json_match = re.search(r'\{.*\}', result_text, re.DOTALL)
            if json_match:
                result_text = json_match.group(0)
            
            try:
                parsed_result = json.loads(result_text)
                raw_translation = parsed_result.get("raw_translation", raw_translation)
                translated_text = parsed_result.get("translated_text", translated_text)
                detected_lang = parsed_result.get("detected_lang", "unknown")
                logger.info(f"✅ [API Success] Detected: {detected_lang} | Translated: {translated_text}")
                
                if not raw_translation.startswith("(") and not translated_text.startswith("("):
                    # Cache standard structure
                    translation_cache[new_text] = {
                        "raw": raw_translation,
                        "final": translated_text,
                        "lang": detected_lang,
                        "hits": 1
                    }
                    if len(translation_cache) >= MAX_CACHE_SIZE:
                        # Simple cleanup if needed (already handled by cache_add, but here we inline for simplicity or reuse cache_add)
                        pass 
                    
            except json.JSONDecodeError:
                logger.error(f"❌ [Error] Failed to parse JSON from AI: {result_text}")
                translated_text = "(Parsing error from AI response)"

        except asyncio.TimeoutError:
            logger.error(f"❌ [Error] AI request timed out")
            translated_text = "(Service timeout)"
        except Exception as e:
            logger.error(f"❌ [Error in Translation] {repr(e)}")
            translated_text = f"(Service error: {repr(e)})"

    if translated_text and not translated_text.startswith("("):
        memory_db[ride_id].append({
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source_text": new_text,
            "detected_lang": detected_lang,
            "translation_raw": raw_translation, 
            "translation_polished": translated_text
        })

    return {
        "ride_id": ride_id,
        "original_text": new_text,
        "detected_lang": detected_lang,
        "raw_translation": raw_translation,
        "translated_text": translated_text,
        # Maintain backward compatibility for keys if needed
        "final_english": translated_text, 
        "process_time": round(float(time.time() - start_time), 2)
    }

@app.post("/api/end_ride")
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

@app.post("/api/enroll_voice")
async def enroll_voice(file: UploadFile = File(...)):
    """One-time voice enrollment: upload a long audio sample, get back a voice_id."""
    try:
        filepath = f"/tmp/{file.filename}"
        with open(filepath, "wb") as f:
            f.write(await file.read())

        el_key = ELEVENLABS_API_KEY.encode('ascii', 'ignore').decode('ascii').strip() if ELEVENLABS_API_KEY else ""
        headers = {"xi-api-key": el_key}

        with open(filepath, "rb") as audio_f:
            files_upload = {"files": ("voice_sample.webm", audio_f, "audio/webm")}
            data = {"name": f"user_voice_{int(time.time())}"}
            resp = requests.post("https://api.elevenlabs.io/v1/voices/add", headers=headers, files=files_upload, data=data, timeout=60)

        if resp.status_code != 200:
            return JSONResponse(status_code=500, content={"error": f"ElevenLabs enroll error: {resp.text}"})

        voice_id = resp.json()["voice_id"]
        logger.info(f"✅ Voice enrolled: {voice_id}")
        return {"voice_id": voice_id, "status": "success"}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/add_voice_sample")
async def add_voice_sample(voice_id: str = Form(...), file: UploadFile = File(...)):
    """Incrementally add a new audio sample to an existing voice model to improve resemblance."""
    try:
        filepath = f"/tmp/{file.filename}"
        with open(filepath, "wb") as f:
            f.write(await file.read())

        el_key = ELEVENLABS_API_KEY.encode('ascii', 'ignore').decode('ascii').strip() if ELEVENLABS_API_KEY else ""
        headers = {"xi-api-key": el_key}

        with open(filepath, "rb") as audio_f:
            files_upload = {"files": ("new_sample.webm", audio_f, "audio/webm")}
            resp = requests.post(
                f"https://api.elevenlabs.io/v1/voices/{voice_id}/edit",
                headers=headers,
                files=files_upload,
                data={"name": f"user_voice_{voice_id[:8]}"},
                timeout=60
            )

        if resp.status_code != 200:
            logger.warning(f"Voice sample add warning: {resp.text}")
            return JSONResponse(status_code=200, content={"status": "skipped", "detail": resp.text})

        logger.info(f"✅ Voice sample added to {voice_id}")
        return {"status": "success", "voice_id": voice_id}

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/tts")
async def text_to_speech(voice_id: str = Form(...), text: str = Form(...)):
    """Use pre-enrolled voice_id to synthesize speech. No new voice creation."""
    try:
        el_key = ELEVENLABS_API_KEY.encode('ascii', 'ignore').decode('ascii').strip() if ELEVENLABS_API_KEY else ""
        headers = {"xi-api-key": el_key}

        tts_url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        tts_data = {"text": text, "model_id": "eleven_monolingual_v1"}

        resp = requests.post(tts_url, json=tts_data, headers=headers, timeout=30)
        if resp.status_code != 200:
            return JSONResponse(status_code=500, content={"error": f"ElevenLabs TTS error: {resp.text}"})

        output_path = "/tmp/tts_output.mp3"
        with open(output_path, "wb") as f:
            f.write(resp.content)

        return FileResponse(output_path, media_type="audio/mpeg", filename="output.mp3")

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})


# 全域快取：ride_id -> voice_id，避免重複創建聲音導致額度耗盡
session_voice_ids: Dict[str, str] = {}

@app.post("/api/clone")
async def clone_voice(text: str = Form(...), file: UploadFile = File(...), ride_id: str = Form(None)):
    """
    優化後的語音克隆邏輯：
    1. 優先從 session_voice_ids 找尋是否已為此 session 建立過聲音。
    2. 若未建立，嘗試建立 (requests.post /v1/voices/add)。
    3. 若發生「每月額度已達上限 (65次)」，則自動降級使用預設高品質聲音，確保功能不中斷。
    """
    try:
        el_key = ELEVENLABS_API_KEY.encode('ascii', 'ignore').decode('ascii').strip() if ELEVENLABS_API_KEY else ""
        headers = {"xi-api-key": el_key}
        
        # 預設聲音 (Mimi)，作為額度耗盡時的備援
        DEFAULT_VOICE_ID = "zrHiDhphv9ZnVXBqCLjz" 
        voice_id = None

        # [優化 1] 檢查快取
        if ride_id and ride_id in session_voice_ids:
            voice_id = session_voice_ids[ride_id]
            logger.info(f"♻️ [Voice Cache Hit] Reusing voice {voice_id} for session {ride_id}")

        # [步驟 2] 如果沒有快取，則進行克隆
        if not voice_id:
            filepath = f"/tmp/{file.filename}"
            with open(filepath, "wb") as f:
                f.write(await file.read())

            with open(filepath, "rb") as audio_f:
                files_upload = {"files": ("audio.webm", audio_f, "audio/webm")}
                data = {"name": f"clone_{ride_id}" if ride_id else "temp_clone"}
                
                logger.info(f"🎤 [Voice Clone] Attempting to create new voice for {ride_id}...")
                response1 = requests.post("https://api.elevenlabs.io/v1/voices/add", headers=headers, files=files_upload, data=data)

            # [優化 2] 處理額度限制
            if response1.status_code != 200:
                resp_text = response1.text
                if "voice_add_edit_limit_reached" in resp_text:
                    logger.warning("⚠️ [Quota Reached] ElevenLabs monthly limit reached. Falling back to default voice.")
                    voice_id = DEFAULT_VOICE_ID
                elif "voice_limit_reached" in resp_text:
                    # 這是指「同時存在的聲音數量」限制，刪除舊的再試一次
                    get_resp = requests.get("https://api.elevenlabs.io/v1/voices", headers=headers)
                    if get_resp.status_code == 200:
                        for v in get_resp.json().get("voices", []):
                            if v.get("category") == "cloned":
                                requests.delete(f"https://api.elevenlabs.io/v1/voices/{v['voice_id']}", headers=headers)
                    
                    # 重新嘗試
                    with open(filepath, "rb") as audio_f:
                        files_upload = {"files": ("audio.webm", audio_f, "audio/webm")}
                        response1 = requests.post("https://api.elevenlabs.io/v1/voices/add", headers=headers, files=files_upload, data=data)
                    
                    if response1.status_code == 200:
                        voice_id = response1.json()["voice_id"]
                    else:
                        voice_id = DEFAULT_VOICE_ID # 二次失敗也用預設
                else:
                    # 其他錯誤也先用預設，避免前端崩潰
                    logger.error(f"❌ [Voice Add Error] {resp_text}")
                    voice_id = DEFAULT_VOICE_ID
            else:
                voice_id = response1.json()["voice_id"]

            # 存入快取 (如果我們打算在 session 期間保留它)
            if ride_id and voice_id != DEFAULT_VOICE_ID:
                session_voice_ids[ride_id] = voice_id

        # [步驟 3] 執行 TTS
        tts_url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        # 建議使用 multilingual v2 模型以獲得更好的跨語言效果
        tts_data = {
            "text": text, 
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        }
        
        logger.info(f"🔊 [TTS] Generating audio with voice {voice_id}...")
        response2 = requests.post(tts_url, json=tts_data, headers=headers)
        
        if response2.status_code != 200:
            logger.error(f"❌ [TTS Error] {response2.text}")
            return JSONResponse(status_code=500, content={"message": f"ElevenLabs TTS Error: {response2.text}"})

        output_path = "/tmp/clone_output.mp3"
        with open(output_path, "wb") as f:
            f.write(response2.content)

        return FileResponse(output_path)

    except Exception as e:
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"message": str(e)})

@app.get("/hello_world")
async def hello_world():
    return {
        "text": "Hello from FastAPI on Vercel with Integrated Translation API!",
        "status": "success",
        "timestamp": "2026-04-11"
    }

@app.post("/api/fetch_context")
async def fetch_context(request: ContextRequest):
    req_time = request.time # format "HH:MM"
    weather = request.weather # e.g. "雨"
    
    valid_pois = []
    
    def time_to_minutes(t_str):
        try:
            h, m = map(int, t_str.split(":"))
            return h * 60 + m
        except:
            return 0
            
    req_minutes = time_to_minutes(req_time)
    
    for item in LOCAL_DICT:
        if not isinstance(item, dict):
            continue
            
        tags = item.get("tags", [])
        
        # 1. 天氣判定：如果下雨，如果含有「🌲 自然戶外」但沒有「🖼️ 室內展覽」或「🛍️ 商圈購物」或「🎳 室內娛樂」，就盡量剔除 (雨天不宜)
        # 基於新的 EMOJI Tags 
        if weather == "雨" and ("🌲 自然戶外" in tags) and not ("🖼️ 室內展覽" in tags or "🛍️ 商圈購物" in tags or "🎳 室內娛樂" in tags or "🍜 在地美食" in tags):
            continue
            
        # 2. 營業時間判定
        open_hours = item.get("open_hours", "00:00-24:00")
        if "-" in open_hours:
            start_str, end_str = open_hours.split("-")
            start_min = time_to_minutes(start_str)
            end_min = time_to_minutes(end_str)
            
            # Simple check, ignoring complex cross-midnight for simple mock
            # Night markets often 17:00-23:59 or 17:00-01:00
            # If 00:00-24:00, always pass
            if open_hours != "00:00-24:00":
                if end_min < start_min: # Cross midnight, e.g. 17:00 - 01:00
                    # if req=23:00 (1380) -> between 1020 and 1440
                    # if req=00:30 (30) -> between 0 and 60
                    if not (req_minutes >= start_min or req_minutes <= end_min):
                        continue
                else:
                    if not (start_min <= req_minutes <= end_min):
                        continue
                        
        valid_pois.append(item)
        
    # Read social sentiment trends
    social_trends = []
    mock_file = Path(__file__).parent / "social_sentiment_mock.json"
    if mock_file.exists():
        try:
            with open(mock_file, "r", encoding="utf-8") as f:
                social_data = json.load(f)
                social_trends = social_data.get("trending_topics", [])
        except Exception as e:
            logger.error(f"Failed to read social trends: {e}")

    return {
        "valid_pois": valid_pois,
        "social_trends": social_trends
    }

# Disabled StaticFiles fallthrough to prevent Vercel returning 200 OK HTML on 404s
# if os.path.exists("public"):
#     app.mount("/", StaticFiles(directory="public", html=True), name="public")
