// public/translate.js

let isRecording = false;
let mediaRecorder;
let audioChunks = [];

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
        btn.style.backgroundColor = "#8b5cf6"; 
    }
}

function toggleMicButton(enabled) {
    document.getElementById('record-button').disabled = !enabled;
}

function renderSubtitles(translationObj) {
    if (!translationObj) return;
    document.getElementById('sub-zh').innerText = translationObj.zh || "";
    document.getElementById('sub-en').innerText = translationObj.en || "";
}

// 事件綁定
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
        showStatus("請說話中...");
        
        // 隱藏舊看板內容以顯示新的
        document.getElementById('sub-zh').innerText = "...";
        document.getElementById('sub-en').innerText = "...";
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

// 核心非同步調度
async function processVoiceData() {
    toggleMicButton(false);
    showStatus("AI 辨識與翻譯中...");
    
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append("audio", audioBlob, "recording.webm");

    try {
        // [步驟 1] STT
        const sttRes = await fetch("/api/stt", { method: "POST", body: formData });
        const sttData = await sttRes.json();
        
        if (sttData.status === "error") {
            throw new Error("STT 語音辨識失敗：" + (sttData.error || "未知錯誤"));
        }
        const userText = sttData.text;
        console.log("辨識結果：", userText);

        // [步驟 2] 雙向翻譯
        showStatus("即時翻譯中...");
        const currentUserId = "dino"; 
        
        const transRes = await fetch("/api/translate", {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                ride_id: currentUserId,
                text: userText
            })
        });
        const transData = await transRes.json();
        
        if (!transRes.ok) {
            throw new Error(`翻譯失敗 (${transRes.status}): ${JSON.stringify(transData)}`);
        }

        const translation = { zh: transData.original_zh || userText, en: transData.final_english };
        renderSubtitles(translation);
        
        // [步驟 3] 語音合成播報 (語音克隆 TTS)
        showStatus("以您的音色合成翻譯中...");
        
        // 使用克隆 Endpoint，傳入剛剛錄製的音檔當作 sample
        const cloneFormData = new FormData();
        cloneFormData.append("file", audioBlob, "recording.webm");
        cloneFormData.append("text", translation.en);

        const ttsRes = await fetch("/api/clone", { 
            method: "POST", 
            body: cloneFormData 
        });
        
        if (!ttsRes.ok) {
            const errBody = await ttsRes.text();
            throw new Error(`語音克隆錯誤 (${ttsRes.status}): ${errBody}`);
        }
        
        const mp3Blob = await ttsRes.blob();
        const audio = new Audio(URL.createObjectURL(mp3Blob));
        await audio.play();
        
        showStatus("想翻譯什麼？按住麥克風告訴我！");

    } catch (e) {
        console.error(e);
        showStatus("發生異常：" + e.message);
    } finally {
        toggleMicButton(true);
    }
}
