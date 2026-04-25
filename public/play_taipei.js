// public/play_taipei.js

let currentMode = "translate"; // 預設模式：純翻譯
let selectedTags = [];
let isRecording = false;
let mediaRecorder;
let audioChunks = [];

// --- UI 切換邏輯 ---
function switchMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${mode}`).classList.add('active');
    
    const tagsSection = document.getElementById('tags-section');
    if (mode === 'itinerary') {
        tagsSection.style.display = 'block';
    } else {
        tagsSection.style.display = 'none';
        // 清空選擇的 Tags
        selectedTags = [];
        document.querySelectorAll('.tag-btn').forEach(btn => btn.classList.remove('selected'));
    }
}

function toggleTag(btnElement, tagValue) {
    btnElement.classList.toggle('selected');
    if (btnElement.classList.contains('selected')) {
        selectedTags.push(tagValue);
    } else {
        selectedTags = selectedTags.filter(t => t !== tagValue);
    }
}

function showStatus(text) {
    document.getElementById('status-text').innerText = text;
}

function setMicState(active) {
    const btn = document.getElementById('record-button');
    if (active) {
        btn.classList.add('recording-pulse');
        btn.style.backgroundColor = "#ef4444"; // Red when recording
    } else {
        btn.classList.remove('recording-pulse');
        btn.style.backgroundColor = "#2563eb"; // Blue normal
    }
}

function toggleMicButton(enabled) {
    document.getElementById('record-button').disabled = !enabled;
}

// --- GPS 獲取邏輯 ---
function getCurrentGPS() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            console.warn("瀏覽器不支援 GPS");
            resolve({ lat: 25.0330, lng: 121.5654 }); // 預設 101 座標
        } else {
            navigator.geolocation.getCurrentPosition(
                position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
                error => {
                    console.warn("GPS 獲取失敗，使用預設座標", error);
                    resolve({ lat: 25.0330, lng: 121.5654 });
                },
                { timeout: 5000 }
            );
        }
    });
}

// --- 渲染時間軸卡片 ---
function renderTimeline(itineraryArray, originCoords) {
    const container = document.getElementById('itinerary-display');
    container.innerHTML = ''; // 清空舊資料
    
    if (!itineraryArray || itineraryArray.length === 0) return;

    let htmlStr = '<div class="timeline">';
    
    itineraryArray.forEach((poi, index) => {
        // 利用 Google Maps Dir API 產生帶目前座標的交通路徑連結
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords.lat},${originCoords.lng}&destination=${encodeURIComponent(poi.name)}&travelmode=transit`;
        
        htmlStr += `
        <div class="timeline-item" style="animation-delay: ${index * 0.2}s">
            <div class="timeline-dot"></div>
            <div class="timeline-line"></div>
            <div class="timeline-content glass-panel">
                <h3>${poi.name} <span class="time-tag">${poi.time_suggested || ''}</span></h3>
                <p class="ai-reason"><i class="fas fa-sparkles"></i> ${poi.reason}</p>
                <a class="nav-btn" href="${mapsUrl}" target="_blank">
                     <i class="fas fa-subway"></i> 出發導航
                </a>
            </div>
        </div>`;
    });
    
    htmlStr += '</div>';
    container.innerHTML = htmlStr;
}

function renderSubtitles(translationObj) {
    if (!translationObj) return;
    const board = document.getElementById('subtitle-board');
    board.style.display = 'block';
    document.getElementById('sub-zh').innerText = translationObj.zh || "";
    document.getElementById('sub-en').innerText = translationObj.en || "";
}

// --- 核心音訊錄製與微服務連鎖打點 (The Orchestrator) ---
document.getElementById('record-button').addEventListener('mousedown', startRecording);
document.getElementById('record-button').addEventListener('mouseup', stopRecording);
document.getElementById('record-button').addEventListener('touchstart', startRecording);
document.getElementById('record-button').addEventListener('touchend', stopRecording);

async function startRecording(e) {
    e.preventDefault();
    if(isRecording) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];
        
        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = processVoiceData;
        mediaRecorder.start();
        isRecording = true;
        setMicState(true);
        showStatus("聽您說話中...");
        
        // 隱藏舊看板
        document.getElementById('subtitle-board').style.display = 'none';
        document.getElementById('itinerary-display').innerHTML = '';
    } catch (err) {
        console.error("無法存取麥克風", err);
        showStatus("麥克風授權失敗！");
    }
}

function stopRecording(e) {
    e.preventDefault();
    if(!isRecording) return;
    mediaRecorder.stop();
    isRecording = false;
    setMicState(false);
}

// 核心五步驟 非同步調度
async function processVoiceData() {
    toggleMicButton(false);
    showStatus("AI 處理中...");
    
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    try {
        // [步驟 1] 打給 STT API 轉文字
        // 備註：請確保後端 /api/stt 寫好並回傳純文字
        const sttRes = await fetch("/api/stt", { method: "POST", body: formData });
        const userText = await sttRes.text();
        console.log("辨識結果：", userText);

        // [步驟 2] 拿 GPS 
        showStatus("定位中...");
        const gpsCoords = await getCurrentGPS();
        const currentTime = new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2, '0');

        let validPois = [];
        let trending = "";

        // 若為導覽模式，才去問隊友 B 的過濾清單
        if (currentMode === "itinerary") {
            showStatus("載入即時情境與社群情報...");
            
            // 呼叫隊友 B 寫好的過濾引擎 API
            const contextResToB = await fetch("/api/fetch_context", {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    time: currentTime, 
                    weather: "晴天" // 隊友 B 寫死的情境測試
                })
            });
            const dataB = await contextResToB.json();
            validPois = dataB.valid_pois || [];
            trending = dataB.social_trends || [];
            console.log(`[模組對接] 隊友 B 傳回了 ${validPois.length} 個營業中的景點！`);
        }

        // [步驟 3] 呼叫大腦 (隊友 A)：獲取 JSON
        showStatus("AI 規劃行程中...");
        
        let llmFinalData;
        /* 正式打 A 端點：
        const currentUserId = localStorage.getItem('currentUser') || 'guest';
        const llmResToA = await fetch("/api/play_taipei/llm_generation", {
            method: "POST", headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                mode: currentMode, 
                user_text: userText, 
                session_id: currentUserId,
                context_data: { valid_pois: validPois, social_trending: trending }
            })
        });
        llmFinalData = await llmResToA.json();
        */

        // 開發期 Mock Data (假裝隊友A已經完美回傳了)
        llmFinalData = {
            "translation": {
                "zh": userText || "我現在在台北可以去哪裡玩？",
                "en": "Where can I go for fun in Taipei right now?"
            },
            "voice_script": currentMode === "itinerary" ? "我推薦您立刻前往饒河街觀光夜市，那裡有非常多好吃的美食喔！" : "Where can I go for fun in Taipei right now?",
            "itinerary": currentMode === "itinerary" ? [
                {
                    "name": "饒河街觀光夜市",
                    "time_suggested": "現在出發",
                    "reason": "這個時間最適合去夜市吃晚餐！而且這是 PTT 鄉民強力推薦的在地美食聚集地。"
                }
            ] : []
        };

        // [步驟 4] 前端渲染字幕與卡片
        renderSubtitles(llmFinalData.translation);
        if (llmFinalData.itinerary && llmFinalData.itinerary.length > 0) {
            renderTimeline(llmFinalData.itinerary, gpsCoords);
        }

        // [步驟 5] 拿語音合成並播放
        showStatus("為您語音播報...");
        // 由於原本的 elevenlabs tts 寫在 /api/tts，我們丟給它生成
        const ttsRes = await fetch("/api/tts", { 
            method: "POST", 
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ text: llmFinalData.voice_script }) 
        });
        const mp3Blob = await ttsRes.blob();
        const audio = new Audio(URL.createObjectURL(mp3Blob));
        await audio.play();
        
        showStatus("導覽完畢！有問題隨時問我！");

    } catch (e) {
        console.error(e);
        showStatus("連線出錯，請看 Console 日誌");
    } finally {
        toggleMicButton(true);
    }
}
