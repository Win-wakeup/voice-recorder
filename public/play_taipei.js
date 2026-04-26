
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




async function handleUserInput(textInput) {
    if (!textInput || textInput.trim() === "") return;
    showStatus("AI 處理中...");
    
    addChatBubble("user", textInput);

    try {
        const gpsCoords = await getCurrentGPS();
        const currentTime = new Date().getHours() + ":" + String(new Date().getMinutes()).padStart(2, '0');

        showStatus("AI 分析您的需求中...");
        
        const llmRes = await fetch("/api/play_taipei/query", {
            method: "POST", headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                user_text: textInput, 
                tags: selectedTags, // will be empty string now since we removed the tags
                session_id: "dino",
                context: { 
                    lat: gpsCoords.lat, 
                    lng: gpsCoords.lng, 
                    current_time: currentTime, 
                    weather: "Sunny" 
                }
            })
        });
        const llmFinalData = await llmRes.json();

        if (!llmFinalData || llmFinalData.status === "error" || llmFinalData.detail) {
            throw new Error("大腦運算失敗：" + (llmFinalData.detail || ""));
        }

        // --- NEW SWIPE LOGIC STUB ---
        if (llmFinalData.requires_clarification) {
            // Stage 1: AI needs to ask more questions
            addChatBubble("ai", llmFinalData.voice_script || llmFinalData.translation.zh);
            
            // QUICK REPLIES INJECTION
            if (llmFinalData.quick_replies && llmFinalData.quick_replies.length > 0) {
                const qrContainer = document.createElement("div");
                qrContainer.className = "quick-replies-container";
                qrContainer.style.display = "flex";
                qrContainer.style.gap = "8px";
                qrContainer.style.flexWrap = "wrap";
                qrContainer.style.margin = "5px 0 15px 10px";
                llmFinalData.quick_replies.forEach(reply => {
                    const btn = document.createElement("button");
                    btn.innerText = reply;
                    btn.style.padding = "6px 14px";
                    btn.style.borderRadius = "20px";
                    btn.style.border = "1px solid #3b82f6";
                    btn.style.background = "#eff6ff";
                    btn.style.color = "#1d4ed8";
                    btn.style.cursor = "pointer";
                    btn.style.fontSize = "0.9rem";
                    btn.style.transition = "background 0.2s";
                    btn.onmouseover = () => btn.style.background = "#dbeafe";
                    btn.onmouseout = () => btn.style.background = "#eff6ff";
                    btn.onclick = () => {
                        // Remov the pills after click to prevent spam
                        qrContainer.remove();
                        document.getElementById('text-input').value = reply;
                        document.getElementById('send-button').click();
                    };
                    qrContainer.appendChild(btn);
                });
                document.getElementById("chat-history").appendChild(qrContainer);
                document.getElementById("chat-history").scrollTop = document.getElementById("chat-history").scrollHeight;
            }
            
            showStatus("請點擊選項或輸入您的回覆！");
        } else {
            // Stage 2: AI has collected enough constraints and generated pool
            addChatBubble("ai", llmFinalData.voice_script || "我已經挑選出一些最棒的選項了，請從畫廊中確認！");
            
            // Render gallery or directly show itinerary if the user asked for a schedule
            if(llmFinalData.swipe_candidates && llmFinalData.swipe_candidates.length > 0) {
                if (llmFinalData.is_itinerary === true) {
                    renderTimeline(llmFinalData.swipe_candidates, {lat: gpsCoords.lat, lng: gpsCoords.lng});
                    showView('itinerary-view');
                } else {
                    renderGallery(llmFinalData.swipe_candidates);
                    showView('gallery-view');
                }
            } else {
                 addChatBubble("ai", "抱歉，目前找不到符合您條件的地點。");
                 showStatus("請更改條件後再試一次！");
            }
        }

    } catch (e) {
        console.error(e);
        addChatBubble("ai", `發生異常：大腦運算失敗：${e.message}`);
        showStatus("發生異常：" + e.message);
    }
}

// ==========================================
// Chat UI 歷史冒泡功能
// ==========================================
// ==========================================
// Chat UI 歷史冒泡功能
// ==========================================
function addChatBubble(sender, text) {
    const historyBox = document.getElementById("chat-history");
    const div = document.createElement("div");
    
    // HTML Entity parsing layer effectively handles line breaks
    let formattedText = text.replace(/\\n/g, '<br>');

    if (sender === "user") {
        div.style.alignSelf = "flex-end";
        div.style.background = "#dbeafe";
        div.style.color = "#1e3a8a";
        div.innerHTML = `<i class="fas fa-user"></i> <span>${formattedText}</span>`;
    } else {
        div.style.alignSelf = "flex-start";
        div.style.background = "#f3f4f6";
        div.style.color = "#1f2937";
        div.innerHTML = `<i class="fas fa-robot"></i> <span>${formattedText}</span>`;
    }
    
    div.style.padding = "10px 15px";
    div.style.borderRadius = "20px";
    div.style.maxWidth = "80%";
    div.style.wordBreak = "break-word";
    
    historyBox.appendChild(div);
    historyBox.scrollTop = historyBox.scrollHeight;
}

// 視圖切換函數
function showView(viewId) {
    const views = ['chat-view', 'gallery-view', 'swipe-view', 'itinerary-view'];
    views.forEach(v => {
        document.getElementById(v).style.display = (v === viewId) ? (v==='gallery-view'?'block':(v==='swipe-view'?'flex':'block')) : 'none';
        if (v === viewId && document.getElementById(v).style.display === 'block' && v === 'swipe-view') {
           document.getElementById(v).style.display = 'flex'; // swipe view needs flex
        }
    });
}
// ==========================================
// 綁定文字輸入
// ==========================================
document.getElementById('send-button').addEventListener('click', () => {
    const textInput = document.getElementById('text-input');
    const text = textInput.value.trim();
    if (text) {
        textInput.value = '';
        handleUserInput(text);
    }
});
document.getElementById('text-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('send-button').click();
});

// ==========================================
// SWIPE UI STATES & LOGIC
// ==========================================
window.swipeCandidates = [];
window.likedVenues = [];
window.currentIndex = 0;

function renderGallery(candidates) {
    window.swipeCandidates = candidates;
    const container = document.getElementById("gallery-container");
    container.innerHTML = "";
    candidates.forEach(poi => {
        const html = `
        <div style="background: white; border-radius: 8px; padding: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); border-top: 4px solid #2563eb;">
           <h4 style="margin: 0 0 10px 0; color: #1e3a8a;">${poi.name}</h4>
           <div style="font-size: 0.8rem; margin-bottom: 8px; color: #4b5563;">💰 ${poi.price || '未知'} | 🚶 ${poi.distance || '未知'}</div>
           <p style="font-size: 0.8rem; color: #6b7280; line-height: 1.4; margin: 0;">${(poi.description||'').substring(0, 45)}...</p>
        </div>`;
        container.innerHTML += html;
    });
}

function startSwipePhase() {
    window.currentIndex = 0;
    window.likedVenues = [];
    document.getElementById('swipe-stats').innerText = `進度：0 選中 / 已看 0 張`;
    showView('swipe-view');
    renderCurrentCard();
}

function renderCurrentCard() {
    const stack = document.getElementById('card-stack');
    stack.innerHTML = "";

    if (window.currentIndex >= window.swipeCandidates.length) {
        if (window.likedVenues.length === 0) {
            stack.innerHTML = `
                <div style="text-align: center; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
                    <h3 style="color: #ef4444; margin-bottom: 10px;"><i class="fas fa-times-circle"></i> 都不喜歡嗎？</h3>
                    <p>沒有選中任何地點，沒關係！</p>
                    <button onclick="document.getElementById('text-input').value = '這批不喜歡！請給我完全不同的新選項！'; document.getElementById('send-button').click(); showView('chat-view');" style="margin-top: 20px; width: 100%; padding: 15px; background: #3b82f6; color: white; border: none; border-radius: 12px; font-size: 1.1rem; cursor: pointer;">為我重刷一批！ 🔄</button>
                </div>
            `;
        } else {
            stack.innerHTML = `
                <div style="text-align: center; background: white; padding: 30px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
                    <h3 style="color: #1e40af; margin-bottom: 10px;"><i class="fas fa-flag-checkered"></i> 牌組滑完了！</h3>
                    <p>您總共挑選了 <strong>${window.likedVenues.length}</strong> 個想去的地方！</p>
                    ${ (parseInt(sessionStorage.getItem("targetCount")) > 0 && window.likedVenues.length > parseInt(sessionStorage.getItem("targetCount"))) ? 
                    `<p style="color: #ea580c; font-size: 0.9rem;">您原本只計畫去 ${parseInt(sessionStorage.getItem("targetCount"))} 家，但多選了！要不要精簡一下？</p>
                     <button onclick="startTournament()" style="margin-top: 10px; width: 100%; padding: 15px; background: #6366f1; color: white; border: none; border-radius: 12px; font-size: 1.1rem; cursor: pointer;"><i class="fas fa-khanda"></i> 啟動 1v1 淘汰賽</button>
                     <button onclick="pickRandom()" style="margin-top: 10px; width: 100%; padding: 15px; background: #f59e0b; color: white; border: none; border-radius: 12px; font-size: 1.1rem; cursor: pointer;"><i class="fas fa-dice"></i> 閉著眼睛隨機挑</button>
                     <button onclick="generateFinalItinerary()" style="margin-top: 10px; width: 100%; padding: 15px; background: #9ca3af; color: white; border: none; border-radius: 12px; font-size: 0.95rem; cursor: pointer;">不管啦我全都要去</button>` 
                    : `<button onclick="generateFinalItinerary()" style="margin-top: 20px; width: 100%; padding: 15px; background: #10b981; color: white; border: none; border-radius: 12px; font-size: 1.1rem; cursor: pointer;">生成我的完美行程表 ✨</button>` }
                </div>
            `;
        }
        document.querySelector("#swipe-view > div:nth-child(2)").style.display = "none"; // Hide buttons
        return;
    }

    document.querySelector("#swipe-view > div:nth-child(2)").style.display = "flex"; // Show buttons

    const poi = window.swipeCandidates[window.currentIndex];
    stack.innerHTML = `
        <div id="swipe-card-ui" style="width: 90%; max-width: 400px; height: 95%; background: white; border-radius: 20px; box-shadow: 0 15px 35px rgba(0,0,0,0.2); display: flex; flex-direction: column; overflow: hidden; transition: transform 0.3s, opacity 0.3s;">
            <div style="background: linear-gradient(135deg, #1e3a8a, #3b82f6); color: white; padding: 20px;">
                <h2 style="margin: 0; font-size: 1.4rem;">${poi.name}</h2>
            </div>
            <div style="padding: 20px; flex: 1; display: flex; flex-direction: column;">
                <div style="background: #eff6ff; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
                    <p style="margin: 5px 0; color: #1e40af;"><strong>🕒 建議停留：</strong>${poi.time || '未知'}</p>
                    <p style="margin: 5px 0; color: #1e40af;"><strong>💰 價格帶：</strong>${poi.price || '未知'}</p>
                    <p style="margin: 5px 0; color: #1e40af;"><strong>🚶 距離：</strong>${poi.distance || '未知'}</p>
                </div>
                <div style="flex: 1; overflow-y: auto;">
                    <p style="line-height: 1.6; color: #374151; font-size: 0.95rem;">${poi.description}</p>
                    <div style="margin-top: 20px; padding-top: 15px; border-top: 1px dashed #d1d5db;">
                        <p style="font-size: 0.85rem; color: #6b7280; margin-bottom: 5px;"><i class="fas fa-map-marker-alt"></i> ${poi.address}</p>
                        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(poi.name + (((poi.address||"").includes("📍")) ? "" : " " + (poi.address||"")))}" target="_blank" style="display: inline-block; font-size: 0.8rem; background: #e0e7ff; color: #4338ca; padding: 4px 10px; border-radius: 12px; text-decoration: none;"><i class="fas fa-map"></i> 在 Google Maps 上查看</a>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function handleSwipe(direction) {
    const card = document.getElementById("swipe-card-ui");
    const poi = window.swipeCandidates[window.currentIndex];
    
    // Add quick animation
    if (card) {
        if (direction === 'left') {
            card.style.transform = "translateX(-150%) rotate(-15deg)";
            card.style.opacity = "0";
        } else {
            card.style.transform = "translateX(150%) rotate(15deg)";
            card.style.opacity = "0";
        }
    }
    
    if (direction === 'right') {
        window.likedVenues.push(poi);
    }
    
    window.currentIndex++;
    document.getElementById('swipe-stats').innerText = `進度：${window.likedVenues.length} 選中 / 已看 ${window.currentIndex} 張`;
    
    setTimeout(() => {
        renderCurrentCard();
    }, 300);
}

window.startSwipePhase = startSwipePhase;
window.handleSwipe = handleSwipe;
window.generateFinalItinerary = async function() {
    showStatus("正在幫您規劃完美動線...");
    
    try {
        const schedRes = await fetch("/api/play_taipei/schedule_itinerary", {
            method: "POST", headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                liked_venues: window.likedVenues,
                context: { lat: 25.0422, lng: 121.5355, current_time: "09:00", weather: "Sunny" }
            })
        });
        const finalData = await schedRes.json();
        
        if (finalData.swipe_candidates && finalData.swipe_candidates.length > 0) {
            const gpsCoords = await getCurrentGPS().catch(() => ({ lat: 25.0422, lng: 121.5355 }));
            const itineraryHtml = extractTimelineHTML(finalData.swipe_candidates, gpsCoords);
            document.getElementById("itinerary-display").innerHTML = itineraryHtml;
            showView('itinerary-view');
            showStatus("行程表準備就緒！");
        } else {
            throw new Error("無法生成行程");
        }
    } catch(e) {
        showStatus("行程生成失敗：" + e.message);
    }
};

// ==========================================
// 1V1 ELIMINATION TOURNAMENT LOGIC
// ==========================================
window.tournamentQueue = [];
window.tournamentWinners = [];
window.tournamentTarget = 1;

window.pickRandom = function() {
    let target = parseInt(sessionStorage.getItem("targetCount")) || 1;
    let shuffled = [...window.likedVenues].sort(() => 0.5 - Math.random());
    window.likedVenues = shuffled.slice(0, target);
    generateFinalItinerary();
};

window.startTournament = function() {
    window.tournamentQueue = [...window.likedVenues];
    window.tournamentWinners = [];
    window.tournamentTarget = parseInt(sessionStorage.getItem("targetCount")) || 1;
    document.getElementById('swipe-stats').innerHTML = `<strong>⚔️ 淘汰賽進行中</strong>`;
    renderTournamentCard();
};

function buildTourneyCard(poi, side) {
    return `
        <div onclick="winTournament('${side}')" style="background: white; border-radius: 15px; border: 3px solid ${side==='left'?'#ef4444':'#3b82f6'}; padding: 15px; margin-bottom: 5px; flex: 1; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <h3 style="margin:0 0 5px 0; color: #1f2937;">${poi.name}</h3>
            <p style="margin: 0; font-size: 0.8rem; color: #4b5563;">💰 ${poi.price} | 🚶 ${poi.distance}</p>
            <p style="margin: 5px 0 0 0; font-size: 0.75rem; color: #6b7280;"> ${(poi.description||'').substring(0,60)}... </p>
            <div style="font-weight: bold; margin-top: 5px; color: ${side==='left'?'#ef4444':'#3b82f6'};">👉 選擇這家</div>
        </div>
    `;
}

window.winTournament = function(side) {
    if (side === 'left') {
        window.tournamentWinners.push(window.lastLeftPoi);
    } else {
        window.tournamentWinners.push(window.lastRightPoi);
    }
    renderTournamentCard();
};

function renderTournamentCard() {
    const stack = document.getElementById('card-stack');
    
    if (window.tournamentQueue.length === 0) {
        if (window.tournamentWinners.length <= window.tournamentTarget) {
            window.likedVenues = [...window.tournamentWinners];
            generateFinalItinerary();
            return;
        }
        window.tournamentQueue = [...window.tournamentWinners];
        window.tournamentWinners = [];
    }
    
    if (window.tournamentQueue.length === 1) {
        window.tournamentWinners.push(window.tournamentQueue.pop());
        renderTournamentCard();
        return;
    }
    
    window.lastLeftPoi = window.tournamentQueue.pop();
    window.lastRightPoi = window.tournamentQueue.pop();
    
    stack.innerHTML = `
        <div style="display:flex; flex-direction: column; width: 95%; max-width: 400px; height: 90%; gap: 10px;">
            <div style="text-align: center; color: white; background: #1e3a8a; padding: 10px; border-radius: 10px; font-weight: bold;">淘汰賽二選一！請點擊勝出者</div>
            ${buildTourneyCard(window.lastLeftPoi, 'left')}
            <div style="text-align:center; font-weight:900; color:#ef4444; font-size: 1.2rem;">VS</div>
            ${buildTourneyCard(window.lastRightPoi, 'right')}
        </div>
    `;
    document.querySelector("#swipe-view > div:nth-child(2)").style.display = "none";
}
