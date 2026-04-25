
function extractTimelineHTML(itineraryArray, originCoords) {
    if (!itineraryArray || itineraryArray.length === 0) return "";
    let htmlStr = '<div class="timeline" style="margin-top:15px; width:100%;">';
    itineraryArray.forEach((poi, index) => {
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords.lat},${originCoords.lng}&destination=${encodeURIComponent(poi.name)}&travelmode=transit`;
        const timeTag = poi.time || "推薦";
        const priceTag = poi.price ? `<span class="price-badge" style="background:#fcd34d;color:#92400e;padding:2px 6px;border-radius:12px;font-size:0.8rem;margin-left:5px;display:inline-block;white-space:nowrap;margin-bottom:4px;"><i class="fas fa-coins"></i> ${poi.price}</span>` : "";
        const distanceTag = poi.distance ? `<span class="distance-badge" style="background:#bfdbfe;color:#1e40af;padding:2px 6px;border-radius:12px;font-size:0.8rem;margin-left:5px;display:inline-block;white-space:nowrap;margin-bottom:4px;"><i class="fas fa-walking"></i> ${poi.distance}</span>` : "";
        
        htmlStr += `
        <div class="timeline-item" style="animation-delay: ${index * 0.2}s">
            <div class="timeline-dot"></div>
            <div class="timeline-line"></div>
            <div class="timeline-content glass-panel" style="background: rgba(255,255,255,0.7);">
                <h3 style="margin-top:0;">${poi.name} <span class="time-tag">${timeTag}</span></h3>
                <div style="margin-bottom:8px; margin-top:5px;">${distanceTag} ${priceTag}</div>
                <p class="ai-reason" style="font-size:0.9rem;"><i class="fas fa-sparkles"></i> ${poi.description}</p>
                <a class="nav-btn" href="${mapsUrl}" target="_blank" style="margin-top:5px; padding: 5px 10px; font-size:0.8rem;">
                     出發導航
                </a>
            </div>
        </div>`;
    });
    htmlStr += "</div>";
    return htmlStr;
}
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
    // Disabled: Handled natively by Chat Bubble addChatBubble() function now
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

async function handleUserInput(textInput, audioBlob) {
    toggleMicButton(false);
    showStatus("AI 處理中...");
    
    let userText = textInput;

    if (audioBlob) {
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
            if (sttData.status === "error") throw new Error("STT failed");
            userText = sttData.text;
        } catch(e) {
            showError("語音辨識失敗");
            toggleMicButton(true);
            return;
        }
    }
    
    addChatBubble("user", userText);

    try {
        const gpsCoords = await getCurrentGPS();
        const currentTime = new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2, '0');

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

        // 把舊的字幕塞進 ChatBox，把行程 render timeline 給 ChatBox
        let itineraryHtml = "";
        if (llmFinalData.itinerary && llmFinalData.itinerary.length > 0) {
             const tempDiv = document.createElement("div");
             // use the global renderTimeline mechanism but inject directly to string
             itineraryHtml = extractTimelineHTML(llmFinalData.itinerary, gpsCoords);
        }

        const aid = addChatBubble("ai", llmFinalData.translation.zh + " / " + llmFinalData.translation.en, true, itineraryHtml);

        showStatus("為您語音播報...");
        const ttsFormData = new FormData();
        ttsFormData.append("voice_id", "21m00Tcm4TlvDq8ikWAM"); 
        ttsFormData.append("text", llmFinalData.voice_script || llmFinalData.translation.en || "");

        const ttsRes = await fetch("/api/tts", { 
            method: "POST", 
            body: ttsFormData 
        });
        
        if (!ttsRes.ok) throw new Error(`TTS API 錯誤`);
        
        const mp3Blob = await ttsRes.blob();
        
        // mount audio player to DOM
        const audioEl = document.createElement("audio");
        audioEl.id = aid;
        audioEl.src = URL.createObjectURL(mp3Blob);
        document.body.appendChild(audioEl);
        
        window.togglePlay(aid);
        showStatus("導覽完畢！有問題隨時問我！");

    } catch (e) {
        console.error(e);
        addChatBubble("ai", `發生異常：大腦運算失敗：${e.message}`);
        showStatus("發生異常：" + e.message);
    } finally {
        toggleMicButton(true);
    }
}

// Redirect processVoiceData
async function processVoiceData() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    if (mediaRecorder && mediaRecorder.stream) {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    await handleUserInput("", audioBlob);
}
// ==========================================
// Chat UI 歷史冒泡功能
// ==========================================
let currentAudio = null;

function addChatBubble(sender, text, isAudio = false, itineraryHtml = "") {
    const historyBox = document.getElementById("chat-history");
    const id = "audio-" + Date.now();
    let innerContent = `<span>${text}</span>`;
    
    if (isAudio) {
        innerContent = `
        <div style="display:flex; align-items:center; gap:8px;">
            <button id="btn-${id}" onclick="togglePlay('${id}')" style="background:#4b5563; border:none; width:30px; height:30px; border-radius:50%; color:white; cursor:pointer;">
                <i class="fas fa-play"></i>
            </button>
            <span style="flex:1;">${text}</span>
        </div>`;
    }
    
    // 如果有行程推薦，把它串接在文字後面
    if (itineraryHtml !== "") {
        innerContent += itineraryHtml;
    }

    const div = document.createElement("div");
    if (sender === "user") {
        div.style.alignSelf = "flex-end";
        div.style.background = "#dbeafe";
        div.style.color = "#1e3a8a";
        div.innerHTML = `<i class="fas fa-user"></i> ${innerContent}`;
    } else {
        div.style.alignSelf = "flex-start";
        div.style.background = "#f3f4f6";
        div.style.color = "#1f2937";
        div.innerHTML = `<i class="fas fa-robot"></i> ${innerContent}`;
    }
    div.style.padding = "10px 15px";
    div.style.borderRadius = "20px";
    div.style.maxWidth = "80%";
    div.style.wordBreak = "break-word";
    
    // AI 泡泡需要儲存 Audio ID 屬性
    if (isAudio) {
        div.setAttribute("data-audio-id", id);
    }
    
    historyBox.appendChild(div);
    historyBox.scrollTop = historyBox.scrollHeight;
    return id;
}

window.togglePlay = function(id) {
    const audioEl = document.getElementById(id);
    const btn = document.getElementById("btn-" + id);
    
    if (currentAudio && currentAudio !== audioEl) {
        currentAudio.pause();
        const prevBtn = document.getElementById("btn-" + currentAudio.id);
        if(prevBtn) prevBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
    
    if (audioEl.paused) {
        audioEl.play();
        btn.innerHTML = '<i class="fas fa-pause"></i>';
        currentAudio = audioEl;
    } else {
        audioEl.pause();
        btn.innerHTML = '<i class="fas fa-play"></i>';
        currentAudio = null;
    }
    
    audioEl.onended = () => {
        btn.innerHTML = '<i class="fas fa-play"></i>';
        currentAudio = null;
    };
};

// ==========================================
// 綁定文字與錄音多重輸入
// ==========================================
document.getElementById('send-button').addEventListener('click', () => {
    const textInput = document.getElementById('text-input');
    const text = textInput.value.trim();
    if (text) {
        textInput.value = '';
        handleUserInput(text, null); // process text command
    }
});
document.getElementById('text-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('send-button').click();
});
