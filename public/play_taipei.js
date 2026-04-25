// public/play_taipei.js
let selectedTags = [];
let isRecording = false;
let mediaRecorder;
let audioChunks = [];

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
        btn.style.backgroundColor = "#ef4444"; 
    } else {
        btn.classList.remove('recording-pulse');
        btn.style.backgroundColor = "#2563eb"; 
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
            resolve({ lat: 25.0330, lng: 121.5654 }); 
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
    container.innerHTML = ''; 
    
    if (!itineraryArray || itineraryArray.length === 0) return;

    let htmlStr = '<div class="timeline">';
    itineraryArray.forEach((poi, index) => {
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords.lat},${originCoords.lng}&destination=${encodeURIComponent(poi.name)}&travelmode=transit`;
        const priceTag = poi.price ? `<span class="price-badge" style="background:#fcd34d;color:#92400e;padding:2px 6px;border-radius:12px;font-size:0.8rem;margin-left:5px;display:inline-block;white-space:nowrap;margin-bottom:4px;"><i class="fas fa-coins"></i> ${poi.price}</span>` : "";
        const distanceTag = poi.distance ? `<span class="distance-badge" style="background:#bfdbfe;color:#1e40af;padding:2px 6px;border-radius:12px;font-size:0.8rem;margin-left:5px;display:inline-block;white-space:nowrap;margin-bottom:4px;"><i class="fas fa-walking"></i> ${poi.distance}</span>` : "";
        htmlStr += `
        <div class="timeline-item" style="animation-delay: ${index * 0.2}s">
            <div class="timeline-dot"></div>
            <div class="timeline-line"></div>
            <div class="timeline-content glass-panel">
                <h3>${poi.name} <span class="time-tag">${POI_Time_String(poi)}</span></h3>
                <div style="margin-top:4px; margin-bottom:8px;">${distanceTag} ${priceTag}</div>
                <p class="ai-reason"><i class="fas fa-sparkles"></i> ${poi.description}</p>
                <a class="nav-btn" href="${mapsUrl}" target="_blank">
                     <i class="fas fa-subway"></i> 出發導航
                </a>
            </div>
        </div>`;
    });
    htmlStr += '</div>';
    container.innerHTML = htmlStr;
}

function POI_Time_String(poi) {
    return poi.time_suggested || poi.time || "推薦";
}

function renderSubtitles(translationObj) {
    if (!translationObj) return;
    const board = document.getElementById('subtitle-board');
    board.style.display = 'block';
    document.getElementById('sub-zh').innerText = translationObj.zh || "";
    document.getElementById('sub-en').innerText = translationObj.en || "";
}

// --- 核心音訊錄製與微服務連鎖打點 ---
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
        
        document.getElementById('subtitle-board').style.display = 'none';
        document.getElementById('itinerary-display').innerHTML = '';
    } catch (err) {
        console.error("無法存取麥克風", err);
        showStatus("麥克風授權失敗：" + err.message);
    }
}

function stopRecording(e) {
    e.preventDefault();
    if(!isRecording) return;
    mediaRecorder.stop();
    isRecording = false;
    setMicState(false);
}

async function processVoiceData() {
    toggleMicButton(false);
    showStatus("AI 處理中...");
    
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

    // ✨ Cleanup microphone stream track to free hardware
    if (mediaRecorder && mediaRecorder.stream) {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    if (audioBlob.size < 1000) {
        showStatus("錄音時間太短，請按住重新說話！");
        toggleMicButton(true);
        return;
    }

    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    try {
        const sttRes = await fetch("/api/stt", { method: "POST", body: formData });
        const sttData = await sttRes.json();
        
        if (sttData.status === "error") {
            throw new Error("STT 語音辨識失敗：" + (sttData.error || "未知錯誤"));
        }
        
        const userText = sttData.text;
        console.log("辨識結果：", userText);

        showStatus("定位中...");
        const gpsCoords = await getCurrentGPS();
        const currentTime = new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2, '0');

        showStatus("載入即時情境與社群情報...");
        const contextResToB = await fetch("/api/fetch_context", {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                time: currentTime, 
                weather: "晴天" 
            })
        });
        const dataB = await contextResToB.json();
        const validPois = dataB.valid_pois || [];
        const trending = dataB.social_trends || [];

        showStatus("AI 規劃行程中...");
        const currentUserId = "dino"; 
        
        const llmResToA = await fetch("/api/play_taipei/query", {
            method: "POST", headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                user_text: userText, 
                tags: selectedTags,
                session_id: currentUserId,
                context: { 
                    lat: gpsCoords.lat, 
                    lng: gpsCoords.lng, 
                    current_time: currentTime, 
                    weather: "Sunny" 
                }
            })
        });
        const llmFinalData = await llmResToA.json();

        if (!llmFinalData || llmFinalData.status === "error" || llmFinalData.detail) {
            throw new Error("大腦運算失敗：" + (llmFinalData.detail || ""));
        }

        renderSubtitles(llmFinalData.translation);
        if (llmFinalData.itinerary && llmFinalData.itinerary.length > 0) {
            renderTimeline(llmFinalData.itinerary, gpsCoords);
        }

        showStatus("為您語音播報...");
        const ttsFormData = new FormData();
        ttsFormData.append("voice_id", "21m00Tcm4TlvDq8ikWAM"); 
        ttsFormData.append("text", llmFinalData.voice_script || llmFinalData.translation.en || "");

        const ttsRes = await fetch("/api/tts", { 
            method: "POST", 
            body: ttsFormData 
        });
        
        if (!ttsRes.ok) {
            const errBody = await ttsRes.text();
            throw new Error(`TTS API 錯誤 (${ttsRes.status}): ${errBody}`);
        }
        
        const mp3Blob = await ttsRes.blob();
        const audio = new Audio(URL.createObjectURL(mp3Blob));
        await audio.play();
        
        showStatus("導覽完畢！有問題隨時問我！");

    } catch (e) {
        console.error(e);
        showStatus("發生異常：" + e.message);
    } finally {
        toggleMicButton(true);
    }
}
