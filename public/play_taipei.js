// public/play_taipei.js
let selectedTags = [];
let isRecording = false;
let mediaRecorder;
let audioChunks = [];
let currentTTSAudio = null; // 儲存目前正在播放的音訊

function toggleTag(btnElement, tagValue) {
    btnElement.classList.toggle("selected");
    if (btnElement.classList.contains("selected")) selectedTags.push(tagValue);
    else selectedTags = selectedTags.filter(t => t !== tagValue);
}

function showStatus(text) {
    document.getElementById("status-text").innerText = text;
}

function setMicState(active) {
    const btn = document.getElementById("record-button");
    if (active) {
        btn.classList.add("recording-pulse");
        btn.style.backgroundColor = "#ef4444"; 
    } else {
        btn.classList.remove("recording-pulse");
        btn.style.backgroundColor = ""; 
    }
}

function toggleMicButton(enabled) {
    document.getElementById("record-button").disabled = !enabled;
    document.getElementById("send-btn").disabled = !enabled;
    document.getElementById("text-input").disabled = !enabled;
}

// --- GPS 獲取邏輯 ---
function getCurrentGPS() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            resolve({ lat: 25.0330, lng: 121.5654 }); 
        } else {
            navigator.geolocation.getCurrentPosition(
                position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
                error => resolve({ lat: 25.0330, lng: 121.5654 }),
                { timeout: 5000 }
            );
        }
    });
}

// --- 小工具：產出行程卡片的 HTML ---
function extractTimelineHTML(itineraryArray, originCoords) {
    if (!itineraryArray || itineraryArray.length === 0) return "";
    let htmlStr = `<div class="timeline" style="margin-top: 15px;">`;
    itineraryArray.forEach((poi, index) => {
        const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${originCoords.lat},${originCoords.lng}&destination=${encodeURIComponent(poi.name)}&travelmode=transit`;
        const timeTag = poi.time || "推薦";
        htmlStr += `
        <div class="timeline-item" style="animation-delay: ${index * 0.2}s">
            <div class="timeline-dot"></div>
            <div class="timeline-line"></div>
            <div class="timeline-content glass-panel" style="background: rgba(255,255,255,0.7);">
                <h3 style="margin-top:0;">${poi.name} <span class="time-tag">${timeTag}</span></h3>
                <p class="ai-reason"><i class="fas fa-sparkles"></i> ${poi.description}</p>
                <a class="nav-btn" href="${mapsUrl}" target="_blank">
                     <i class="fas fa-subway"></i> 出發導航
                </a>
            </div>
        </div>`;
    });
    htmlStr += "</div>";
    return htmlStr;
}

// --- 附加氣泡到對話框 ---
function appendChatBubble(role, contentHTML) {
    const container = document.getElementById("chat-history");
    const div = document.createElement("div");
    if (role === "user") {
        div.className = "chat-bubble user-bubble";
        div.innerHTML = `<i class="fas fa-user"></i> ${contentHTML}`;
    } else {
        div.className = "chat-bubble ai-bubble";
        div.innerHTML = `<i class="fas fa-robot"></i> ${contentHTML}`;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// --- 音頻控制 ---
document.getElementById("audio-control-btn").addEventListener("click", () => {
    if (currentTTSAudio) {
        if (!currentTTSAudio.paused) {
            currentTTSAudio.pause();
            document.getElementById("audio-control-btn").innerHTML = '<i class="fas fa-play-circle"></i>';
        } else {
            currentTTSAudio.play();
            document.getElementById("audio-control-btn").innerHTML = '<i class="fas fa-pause-circle"></i>';
        }
    }
});

// --- 核心處理管線 ---
async function handleUserInput(userText) {
    toggleMicButton(false);
    appendChatBubble("user", userText);
    document.getElementById("text-input").value = "";
    
    // 中斷前一個音訊
    if (currentTTSAudio && !currentTTSAudio.paused) {
        currentTTSAudio.pause();
    }
    document.getElementById("audio-control-btn").style.display = "none";
    
    const loadingId = "load-" + Date.now();
    appendChatBubble("ai", `<span id="${loadingId}">思考中... <i class="fas fa-spinner fa-spin"></i></span>`);

    try {
        const gpsCoords = await getCurrentGPS();
        const currentTime = new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2, "0");
        const currentUserId = localStorage.getItem("currentUser") || "dino"; 
        
        const llmResToA = await fetch("/api/play_taipei/query", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                user_text: userText, 
                tags: selectedTags,
                session_id: currentUserId,
                context: { 
                    lat: gpsCoords.lat, lng: gpsCoords.lng, 
                    current_time: currentTime, weather: "Sunny" 
                }
            })
        });
        const llmFinalData = await llmResToA.json();

        if (!llmFinalData || llmFinalData.status === "error" || llmFinalData.detail) {
            throw new Error("大腦運算失敗：" + (llmFinalData.detail || ""));
        }

        const voiceScript = llmFinalData.voice_script || "好的，請參考以下資訊。";
        const itineraryHtml = extractTimelineHTML(llmFinalData.itinerary, gpsCoords);
        
        const answerBlock = document.getElementById(loadingId);
        if(answerBlock) {
            answerBlock.parentElement.innerHTML = `<i class="fas fa-robot"></i> ${voiceScript} ${itineraryHtml}`;
        }
        
        // 渲染外部分隔雙語字幕 (可選保留)
        const board = document.getElementById("subtitle-board");
        if(llmFinalData.translation && llmFinalData.translation.en) {
            board.style.display = "block";
            document.getElementById("sub-zh").innerText = llmFinalData.translation.zh || userText;
            document.getElementById("sub-en").innerText = llmFinalData.translation.en || "";
        }

        // 調用獨立 TTS (前端發動)
        showStatus("準備語音中...");
        const ttsFormData = new FormData();
        ttsFormData.append("voice_id", "21m00Tcm4TlvDq8ikWAM"); 
        ttsFormData.append("text", voiceScript);

        const ttsRes = await fetch("/api/tts", { 
            method: "POST", 
            body: ttsFormData 
        });
        
        if (ttsRes.ok) {
            const mp3Blob = await ttsRes.blob();
            currentTTSAudio = new Audio(URL.createObjectURL(mp3Blob));
            currentTTSAudio.play();
            
            document.getElementById("audio-control-btn").style.display = "inline-block";
            document.getElementById("audio-control-btn").innerHTML = '<i class="fas fa-pause-circle"></i>';
            
            currentTTSAudio.onended = () => {
                document.getElementById("audio-control-btn").style.display = "none";
            };
        }
        showStatus("想去哪裡玩？打字或按住麥克風告訴我！");

    } catch (e) {
        console.error(e);
        const answerBlock = document.getElementById(loadingId);
        if(answerBlock) answerBlock.innerText = "發生異常：" + e.message;
        showStatus("發生異常");
    } finally {
        toggleMicButton(true);
        // scroll to bottom again
        const container = document.getElementById("chat-history");
        container.scrollTop = container.scrollHeight;
    }
}

// --- 文字輸入綁定 ---
document.getElementById("send-btn").addEventListener("click", () => {
    const txt = document.getElementById("text-input").value.trim();
    if(txt) handleUserInput(txt);
});
document.getElementById("text-input").addEventListener("keypress", (e) => {
    if(e.key === "Enter") {
        const txt = document.getElementById("text-input").value.trim();
        if(txt) handleUserInput(txt);
    }
});

// --- 語音輸入邏輯 ---
document.getElementById("record-button").addEventListener("mousedown", startRecording);
document.getElementById("record-button").addEventListener("mouseup", stopRecording);
document.getElementById("record-button").addEventListener("touchstart", startRecording);
document.getElementById("record-button").addEventListener("touchend", stopRecording);

async function startRecording(e) {
    e.preventDefault();
    if(isRecording) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        audioChunks = [];
        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };
        mediaRecorder.onstop = processVoiceData;
        mediaRecorder.start();
        isRecording = true;
        setMicState(true);
        showStatus("聽您說話中...");
        if (currentTTSAudio && !currentTTSAudio.paused) currentTTSAudio.pause();
    } catch (err) {
        showStatus("麥克風授權失敗");
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
    showStatus("AI 處理音訊中...");
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    if (mediaRecorder && mediaRecorder.stream) {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    if (audioBlob.size < 1000) {
        showStatus("錄音時間太短！");
        toggleMicButton(true);
        return;
    }
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");
    try {
        const sttRes = await fetch("/api/stt", { method: "POST", body: formData });
        const sttData = await sttRes.json();
        if (sttData.status === "error") throw new Error("STT 失敗");
        handleUserInput(sttData.text);
    } catch (e) {
        showStatus("文字轉換失敗");
        toggleMicButton(true);
    }
}
