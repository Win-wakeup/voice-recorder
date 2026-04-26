import './style.css';

window.onerror = function(msg, url, lineNo, columnNo, error) {
  alert('前端發生錯誤 (Line ' + lineNo + '):\n' + msg + '\n請截圖給開發者！');
  return false;
};
window.addEventListener("unhandledrejection", function(event) {
  alert("未預期的非同步錯誤:\n" + (event.reason ? event.reason.stack || event.reason : "Unknown"));
});

// DOM Elements
let searchInput = document.getElementById('searchInput');
let searchBtn = document.getElementById('searchBtn');
let loadingPanel = document.getElementById('loading');
let initialPanel = document.getElementById('initial');
let noResultsPanel = document.getElementById('noResults');
let hotelList = document.getElementById('hotelList');
let suggestionsBox = document.getElementById('suggestionsBox');

// Initialize
function init() {
  console.log("🚀 [Frontend] Application Initializing...");
  
  if (!searchBtn) searchBtn = document.getElementById('searchBtn');
  if (!searchInput) searchInput = document.getElementById('searchInput');
  if (!loadingPanel) loadingPanel = document.getElementById('loading');
  if (!initialPanel) initialPanel = document.getElementById('initial');
  if (!suggestionsBox) suggestionsBox = document.getElementById('suggestionsBox');
  
  if (!searchBtn || !searchInput) {
    alert("初始化失敗：找不到搜尋按鈕或輸入框！請重新整理頁面。");
    return;
  }
  
  // 切換 UI 狀態
  if (loadingPanel) loadingPanel.classList.add('hidden');
  if (initialPanel) initialPanel.classList.remove('hidden');
  
  // 綁定事件
  if (!searchBtn.dataset.initialized) {
    searchBtn.addEventListener('click', () => {
      console.log("👉 [Frontend] Search button clicked");
      if (suggestionsBox) suggestionsBox.classList.add('hidden');
      handleSearch();
    });
    searchBtn.dataset.initialized = 'true';
  }
  
  if (searchInput && !searchInput.dataset.initialized) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        console.log("👉 [Frontend] Enter key pressed");
        if (suggestionsBox) suggestionsBox.classList.add('hidden');
        handleSearch();
      }
    });
    searchInput.dataset.initialized = 'true';
  }

  // Autocomplete 邏輯
  let debounceTimer;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const query = e.target.value.trim();
      
      if (!query || !suggestionsBox) {
        if (suggestionsBox) suggestionsBox.classList.add('hidden');
        return;
      }
      
      debounceTimer = setTimeout(() => {
        fetchSuggestions(query);
      }, 300); // 300ms 延遲
    });
  }

  // 點擊外部關閉自動完成
  document.addEventListener('click', (e) => {
    if (suggestionsBox && !searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.add('hidden');
    }
  });
  
  console.log("✅ [Frontend] Event listeners bound successfully");
}

async function fetchSuggestions(query) {
  try {
    const response = await fetch(`/api/suggestions?q=${encodeURIComponent(query)}`);
    if (!response.ok) return;
    const suggestions = await response.json();
    
    if (suggestions.length === 0) {
      suggestionsBox.classList.add('hidden');
      return;
    }
    
    suggestionsBox.innerHTML = suggestions.map(s => `
      <div class="suggestion-item">
        <span class="suggestion-name">${s.name}</span>
        <span class="suggestion-add">${s.add}</span>
      </div>
    `).join('');
    
    suggestionsBox.classList.remove('hidden');
    
    // 綁定選項點擊事件
    document.querySelectorAll('.suggestion-item').forEach((item, index) => {
      item.addEventListener('click', () => {
        searchInput.value = suggestions[index].name;
        suggestionsBox.classList.add('hidden');
        handleSearch(); // 直接觸發搜尋
      });
    });
    
  } catch (error) {
    console.error('Fetch suggestions error:', error);
  }
}

document.addEventListener('DOMContentLoaded', init);
// 為了相容 type="module" 可能已經載入完成的情況
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(init, 1);
}

async function handleSearch() {
  if (!searchInput) searchInput = document.getElementById('searchInput');
  const query = searchInput ? searchInput.value.trim() : '';
  
  if (!initialPanel) initialPanel = document.getElementById('initial');
  if (!noResultsPanel) noResultsPanel = document.getElementById('noResults');
  if (!hotelList) hotelList = document.getElementById('hotelList');
  if (!loadingPanel) loadingPanel = document.getElementById('loading');
  
  // 顯示 Loading
  if (initialPanel) initialPanel.classList.add('hidden');
  if (noResultsPanel) noResultsPanel.classList.add('hidden');
  if (hotelList) hotelList.classList.add('hidden');
  if (loadingPanel) loadingPanel.classList.remove('hidden');
  
  // 移除可能存在的舊模糊搜尋提示
  const oldNotice = document.getElementById('fuzzyNotice');
  if (oldNotice) oldNotice.remove();
  
  try {
    // 呼叫後端 API
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('伺服器回應錯誤');
    
    const data = await response.json();
    renderResults(data);
    
  } catch (error) {
    console.error('Search error:', error);
    if (loadingPanel) {
      loadingPanel.innerHTML = `
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <p style="color:#ef4444;">查詢失敗，請確認後端伺服器是否正常運作。</p>
        <p class="small-text" style="color:#ef4444;">${error.message}</p>
      `;
    }
  }
}

let distanceSelect = document.getElementById('distanceSelect');
let locateBtn = document.getElementById('locateBtn');
let currentNearbyResults = [];

// Handle Geolocation Search
function bindLocateBtn() {
  if (!locateBtn) locateBtn = document.getElementById('locateBtn');
  if (locateBtn && !locateBtn.dataset.initialized) {
    locateBtn.addEventListener('click', () => {
      if ("geolocation" in navigator) {
        if (!hotelList) hotelList = document.getElementById('hotelList');
        if (!loadingPanel) loadingPanel = document.getElementById('loading');
        if (!noResultsPanel) noResultsPanel = document.getElementById('noResults');
        
        hotelList.innerHTML = '';
        loadingPanel.classList.remove('hidden');
        noResultsPanel.classList.add('hidden');
        
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            await fetchNearbyHotels(lat, lng);
          },
          async (error) => {
            console.warn("Geolocation failed. Fallback to Taipei 101.", error);
            await fetchNearbyHotels(25.0339, 121.5644); // 備用座標：台北101
          }
        );
      } else {
        alert("您的瀏覽器不支援定位功能。");
      }
    });
    locateBtn.dataset.initialized = 'true';
  }
}
bindLocateBtn();

async function fetchNearbyHotels(lat, lng) {
  try {
    if (!distanceSelect) distanceSelect = document.getElementById('distanceSelect');
    const distRange = distanceSelect ? distanceSelect.value.split(',') : ['0', '5'];
    
    if (!loadingPanel) loadingPanel = document.getElementById('loading');
    if (!hotelList) hotelList = document.getElementById('hotelList');
    if (!noResultsPanel) noResultsPanel = document.getElementById('noResults');
    
    loadingPanel.classList.remove('hidden');
    hotelList.classList.add('hidden');
    noResultsPanel.classList.add('hidden');

    const response = await fetch(`/api/nearby?lat=${lat}&lng=${lng}&min_radius=${distRange[0]}&max_radius=${distRange[1]}`);
    if (!response.ok) throw new Error('伺服器回應錯誤');
    
    const data = await response.json();
    currentNearbyResults = data.results;
    renderResults(data);
  } catch (error) {
    console.error('Nearby search error:', error);
    loadingPanel.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <p style="color:#ef4444;">查詢失敗，請確認後端伺服器是否正常運作。</p>
    `;
  }
}

// Global function to trigger search from modal using current map bounds
window.fetchAndRenderModalNearby = async () => {
  if (!window.modalLeafletMap) return;
  
  document.getElementById('modalNearbyResults').innerHTML = '<div style="text-align:center; padding:1.5rem; color:var(--text-muted);"><div class="spinner" style="width:24px; height:24px; border-width:2px; margin:0 auto 0.5rem;"></div>搜尋地圖範圍內高 CP 值旅宿...</div>';
  
  try {
    const center = window.modalLeafletMap.getCenter();
    const bounds = window.modalLeafletMap.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const excludeParam = window.currentModalHotelName ? `&exclude=${encodeURIComponent(window.currentModalHotelName)}` : '';

    const response = await fetch(`/api/nearby?lat=${center.lat}&lng=${center.lng}&sw_lat=${sw.lat}&sw_lng=${sw.lng}&ne_lat=${ne.lat}&ne_lng=${ne.lng}${excludeParam}`);
    if (!response.ok) throw new Error('伺服器回應錯誤');
    const data = await response.json();
    
    if (window.modalMarkers) {
      window.modalMarkers.forEach(m => window.modalLeafletMap.removeLayer(m));
    }
    window.modalMarkers = [];
    window.modalNearbyData = data.results; // 儲存資料供點擊跳轉使用
    
    if (data.results.length === 0) {
      document.getElementById('modalNearbyResults').innerHTML = `<p style="color:#ef4444; margin-top:1.5rem; text-align:center; padding: 1rem; background: rgba(239, 68, 68, 0.1); border-radius: 8px;">此地圖範圍內找不到其他旅宿，請嘗試「縮小地圖」或「移動位置」！</p>`;
      return;
    }

    let listHtml = '<h4 style="margin-top:1.5rem; margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> 地圖範圍內的高 CP 值推薦</h4><div style="display:flex; flex-direction:column; gap:0.8rem;">';
    
    data.results.forEach((h, idx) => {
      if (h.Py && h.Px) {
        // 周遭合法旅宿：自訂綠色帶數字 marker
        const nearbyIcon = L.divIcon({
          className: '',
          html: `<div style="
            width: 28px; height: 28px;
            background: linear-gradient(135deg, #10b981, #059669);
            border-radius: 50%;
            border: 2.5px solid white;
            box-shadow: 0 3px 10px rgba(16,185,129,0.55);
            display: flex; align-items: center; justify-content: center;
            color: white; font-size: 12px; font-weight: 800;
            font-family: -apple-system, sans-serif;
            line-height: 1;
          ">${idx + 1}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          popupAnchor: [0, -16]
        });
        const m = L.marker([parseFloat(h.Py), parseFloat(h.Px)], { icon: nearbyIcon })
                   .addTo(window.modalLeafletMap)
                   .bindPopup(`
                     <div style="min-width:160px;">
                       <div style="font-weight:700;color:#1f2937;font-size:0.95rem;margin-bottom:4px;">${idx+1}. ${h.Name}</div>
                       <div style="color:#10b981;font-size:0.8rem;font-weight:600;">✅ 合法旅宿</div>
                       <div style="color:#6b7280;font-size:0.8rem;margin-top:4px;">CP值: <strong>${h.cpValue}</strong> &nbsp;|&nbsp; 距離: ${h.distance}km</div>
                       <div style="color:#6b7280;font-size:0.8rem;">NT$ ${h.simulatedPrice} 起</div>
                     </div>
                   `);
        window.modalMarkers.push(m);
      }
      
      listHtml += `
        <div onclick="window.openNearbyHotelDetail(${idx})" onmouseover="this.style.background='rgba(255,255,255,0.08)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'" style="cursor: pointer; background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 12px; border: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center; transition: background 0.2s;">
           <div>
              <strong style="color: var(--text); font-size:1.05rem;">${idx+1}. ${h.Name}</strong>
              <div class="small-text" style="color:var(--text-muted); margin-top:0.3rem;">距離 ${h.distance}km | 模擬評分 ${h.simulatedRating}</div>
           </div>
           <div style="text-align:right;">
             <div style="color:#10b981; font-weight:bold; font-size:1.1rem;">CP: ${h.cpValue}</div>
             <div class="small-text" style="color:var(--text-muted);">NT$ ${h.simulatedPrice} 起</div>
           </div>
        </div>
      `;
    });
    listHtml += '</div>';
    
    document.getElementById('modalNearbyResults').innerHTML = listHtml;
  } catch (error) {
    document.getElementById('modalNearbyResults').innerHTML = `<p style="color:#ef4444; margin-top:1rem; text-align:center;">搜尋失敗，請稍後再試。</p>`;
  }
};

window.openNearbyHotelDetail = (idx) => {
  const hotel = window.modalNearbyData[idx];
  if (!hotel) return;
  
  let priceText = 'NT$ ' + (hotel.LowestPrice || hotel.CeilingPrice || '未提供');
  if (priceText !== 'NT$ 未提供') {
    priceText += ' 起';
  }
  
  // 記錄目前的飯店到歷史堆疊中
  if (!window.modalHistory) window.modalHistory = [];
  if (window.currentModalHotel) {
    window.modalHistory.push({
      hotel: window.currentModalHotel,
      priceText: window.currentModalPriceText,
      isExternal: window.currentModalIsExternal
    });
  }
  
  // 開啟 Modal (自動取代目前的 Modal 內容)
  openModal(hotel, priceText, false);
  
  // 捲動 Modal 到最上方
  const modalContent = document.querySelector('.modal-content');
  if (modalContent) {
    modalContent.scrollTop = 0;
  }
};

window.goBackModal = () => {
  if (!window.modalHistory || window.modalHistory.length === 0) return;
  const prev = window.modalHistory.pop();
  openModal(prev.hotel, prev.priceText, prev.isExternal);
};

window.recenterModalMap = () => {
  if (window.modalLeafletMap && window.currentModalHotelLat && window.currentModalHotelLng) {
    window.modalLeafletMap.setView([window.currentModalHotelLat, window.currentModalHotelLng], 15, { animate: true });
  }
};



function renderResults(data) {
  const { results = [], isFuzzy = false, isExternal = false, isUrlSearch = false, isInvalidUrl = false, isNearbySearch = false, scrapedTitle = '' } = data;
  
  hotelList.innerHTML = '';
  loadingPanel.classList.add('hidden');

  // 如果輸入的網址不是住宿網址
  if (isInvalidUrl) {
    noResultsPanel.classList.remove('hidden');
    hotelList.classList.add('hidden');
    noResultsPanel.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <h3 style="color:#ef4444;">輸入錯誤：非住宿連結</h3>
      <p style="margin-bottom:0.5rem;">您貼上的網址似乎不是旅館或訂房網站的連結。</p>
      <p class="small-text" style="color:var(--text-muted);">(標題為：${scrapedTitle || '未知'})</p>
      <p style="margin-top:1rem;">請輸入正確的旅宿網址或關鍵字後再試一次！</p>
    `;
    return;
  }
  
  if (results.length === 0) {
    noResultsPanel.classList.remove('hidden');
    hotelList.classList.add('hidden');
    // 如果真沒有，回報可能輸入錯誤
    noResultsPanel.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
      <h3>找不到符合條件的旅宿</h3>
      <p>可能輸入錯誤或該旅宿未合法登記，請重新確認關鍵字後再試一次</p>
    `;
    return;
  }
  
  noResultsPanel.classList.add('hidden');
  hotelList.classList.remove('hidden');

  // 建立提示區域
  const noticeDiv = document.createElement('div');
  noticeDiv.id = 'fuzzyNotice';
  noticeDiv.style.gridColumn = "1 / -1";
  noticeDiv.style.padding = "1rem 1.5rem";
  noticeDiv.style.borderRadius = "16px";
  noticeDiv.style.display = "flex";
  noticeDiv.style.alignItems = "center";
  noticeDiv.style.gap = "0.8rem";
  noticeDiv.style.marginBottom = "1rem";
  
  let showNotice = false;

  if (isUrlSearch) {
    showNotice = true;
    if (isExternal) {
      // 網址查無合法資料
      noticeDiv.style.background = "rgba(239, 68, 68, 0.15)";
      noticeDiv.style.border = "1px solid rgba(239, 68, 68, 0.4)";
      noticeDiv.style.color = "#fca5a5";
      noticeDiv.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <div>
          <strong style="display:block;margin-bottom:0.2rem;color:#ef4444;font-size:1.1rem;">⚠️ 非法旅宿警告：此連結指向的住宿可能未合法登記！</strong>
          <span style="line-height:1.4;">網頁標題：「${scrapedTitle || '未知'}」<br>經過比對，這家住宿不在觀光署的合法登記名單中。這可能是非法日租套房或未立案旅宿，存在安全疑慮，請特別留意！</span>
        </div>
      `;
    } else {
      // 網址查有合法資料
      noticeDiv.style.background = "rgba(16, 185, 129, 0.15)";
      noticeDiv.style.border = "1px solid rgba(16, 185, 129, 0.4)";
      noticeDiv.style.color = "#6ee7b7";
      noticeDiv.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        <div>
          <strong style="display:block;margin-bottom:0.2rem;color:#10b981;font-size:1.1rem;">✅ 連結安全確認：這是一家合法登記的旅宿</strong>
          <span>我們成功識別出您提供的連結是「${results[0].Name}」，並且它已經在觀光署合法登記！以下為其詳細資料。</span>
        </div>
      `;
    }
  } else if (isExternal) {
    showNotice = true;
    noticeDiv.style.background = "rgba(239, 68, 68, 0.15)";
    noticeDiv.style.border = "1px solid rgba(239, 68, 68, 0.4)";
    noticeDiv.style.color = "#fca5a5";
    noticeDiv.innerHTML = `
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      <div>
        <strong style="display:block;margin-bottom:0.2rem;color:#ef4444;font-size:1.1rem;">⚠️ 警告：該旅宿不在合法登記名單中</strong>
        <span style="line-height:1.4;">以下為網路搜尋到的相關資訊。這可能是非法日租套房或未立案旅宿，請特別留意住宿安全！</span>
      </div>
    `;
  } else if (isFuzzy && searchInput.value.trim().length > 0) {
    showNotice = true;
    noticeDiv.style.background = "rgba(236, 72, 153, 0.15)";
    noticeDiv.style.border = "1px solid rgba(236, 72, 153, 0.4)";
    noticeDiv.style.color = "#fbcfe8";
    noticeDiv.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <span>找不到完全相符的結果，可能輸入有誤。以下為您自動尋找的最相似結果：</span>
    `;
  } else if (isNearbySearch) {
    showNotice = true;
    noticeDiv.style.background = "rgba(59, 130, 246, 0.15)";
    noticeDiv.style.border = "1px solid rgba(59, 130, 246, 0.4)";
    noticeDiv.style.color = "#93c5fd";
    noticeDiv.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
      <span>以下為距離您目前位置最近，且「性價比 (CP值)」最高的 Top 10 合法旅宿推薦！</span>
    `;
  }

  if (showNotice) {
    hotelList.appendChild(noticeDiv);
  }
  
  results.forEach((hotel, index) => {
    const card = document.createElement('div');
    card.className = 'hotel-card';
    card.style.animationDelay = `${index * 0.05}s`;
    
    // 如果有提供圖片網址就使用，否則顯示無照片
    let imageHtml = '';
    if (hotel.Picture1) {
      imageHtml = `<img src="${hotel.Picture1}" alt="${hotel.Name}" class="card-img" onerror="this.src='https://images.unsplash.com/photo-1566073771259-6a8506099945?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80'" />`;
    } else {
      imageHtml = `
        <div class="no-image-placeholder">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          <span>目前無照片</span>
        </div>
      `;
    }
    
    // 處理房價 (排除不合理的低價，例如 100 元)
    let priceText = '價格未提供';
    const isValidPrice = hotel.LowestPrice && hotel.LowestPrice >= 500;
    
    if (isValidPrice && hotel.CeilingPrice) {
      priceText = `NT$ ${hotel.LowestPrice} - ${hotel.CeilingPrice}`;
    } else if (isValidPrice) {
      priceText = `NT$ ${hotel.LowestPrice} 起`;
    }
    
    // 處理標籤
    let badgeHtml = '';
    if (isExternal) {
      badgeHtml = `
        <div class="badge-legal" style="background: rgba(239, 68, 68, 0.9); color: white; border: 1px solid rgba(239, 68, 68, 1);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          未合法登記
        </div>
      `;
    } else if (isNearbySearch) {
      badgeHtml = `
        <div class="badge-legal" style="background: rgba(59, 130, 246, 0.9); color: white;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
          性價比 ${hotel.cpValue} | 距離 ${hotel.distance}km
        </div>
      `;
      // Override price text to show simulated price for CP calculation demo
      priceText = `NT$ ${hotel.simulatedPrice} 起 (評分: ${hotel.simulatedRating})`;
    } else {
      badgeHtml = `
        <div class="badge-legal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          合法登記
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-img-wrapper">
        ${imageHtml}
        <div class="img-overlay"></div>
        ${badgeHtml}
      </div>
      <div class="card-content">
        <div class="location-tag">${hotel.Town || '台灣'}</div>
        <h3 class="hotel-name" title="${hotel.Name}">${hotel.Name}</h3>
        
        <ul class="info-list">
          <li class="info-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            <span title="${hotel.Add}">${hotel.Add || '地址未提供'}</span>
          </li>
          <li class="info-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            <span>${hotel.Tel || '電話未提供'}</span>
          </li>
        </ul>


        <div class="hotel-footer" style="margin-top:1rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
          ${(hotel.Website && hotel.Website !== '未找到' && hotel.Website !== '無') ? `<a href="${hotel.Website.startsWith('http') ? hotel.Website : 'http://' + hotel.Website}" target="_blank" class="card-btn" style="padding:0.4rem 0.8rem; border-radius:8px; background:rgba(79, 70, 229, 0.2); color:#a5b4fc; text-decoration:none; font-size:0.85rem;" onclick="event.stopPropagation()">官方網站</a>` : ''}
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.Name + ' ' + (hotel.Add || ''))}" target="_blank" class="card-btn" style="padding:0.4rem 0.8rem; border-radius:8px; background:rgba(59, 130, 246, 0.2); color:#93c5fd; text-decoration:none; font-size:0.85rem; display:flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 
            地圖與照片
          </a>
        </div>
      </div>
    `;
    
    card.style.cursor = 'pointer'; // 讓卡片看起來可點擊
    card.addEventListener('click', () => {
      window.modalHistory = []; // 從主列表點擊時，清空歷史紀錄
      openModal(hotel, priceText, isExternal);
    });
    
    hotelList.appendChild(card);


  });

  // 如果是附近搜尋，在列表最下方加入「匯出 Top 10 JSON」按鈕
  if (isNearbySearch && results.length > 0) {
    const exportDiv = document.createElement('div');
    exportDiv.style.gridColumn = "1 / -1";
    exportDiv.style.textAlign = "center";
    exportDiv.style.marginTop = "2rem";
    
    const expBtn = document.createElement('button');
    expBtn.className = "search-btn";
    expBtn.style.background = "var(--surface)";
    expBtn.style.color = "var(--text)";
    expBtn.style.display = "inline-flex";
    expBtn.style.alignItems = "center";
    expBtn.style.justifyContent = "center";
    expBtn.innerHTML = `💾 匯出 Top 10 JSON (已依性價比遞減排序)`;
    
    expBtn.addEventListener('click', () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentNearbyResults, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "top_10_high_cp_hotels.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
    });
    
    exportDiv.appendChild(expBtn);
    hotelList.appendChild(exportDiv);
  }
}

// Modal Variables
const hotelModal = document.getElementById('hotelModal');
const modalBody = document.getElementById('modalBody');
const closeModalBtn = document.getElementById('closeModalBtn');
const modalBackdrop = document.querySelector('.modal-backdrop');

window.fetchRealPrice = async (hotelName) => {
  const btn = document.getElementById('realPriceBtn');
  const resultDiv = document.getElementById('realPriceResult');
  
  if (btn) btn.innerHTML = '<div class="spinner" style="width:14px; height:14px; border-width:2px; display:inline-block; vertical-align:middle; margin-right:4px;"></div> 查詢中...';
  if (btn) btn.disabled = true;
  
  try {
    const response = await fetch(`/api/realprice?name=${encodeURIComponent(hotelName)}`);
    const data = await response.json();
    
    if (data && data.minPrice) {
      if (btn) btn.style.display = 'none';
      const simBadge = data.isSimulated ? '<span style="font-size:0.75rem; background:rgba(255,255,255,0.2); padding:0.1rem 0.4rem; border-radius:4px; margin-left:0.4rem;">AI 預估</span>' : '<span style="font-size:0.75rem; background:rgba(239,68,68,0.2); color:#fca5a5; padding:0.1rem 0.4rem; border-radius:4px; margin-left:0.4rem;">一晚即時抓取</span>';
      
      let priceDisplay = `NT$ ${data.minPrice.toLocaleString()}`;
      let roomTypeDisplay = data.roomType ? `<div style="color: #6ee7b7; font-size: 0.95rem; margin-bottom: 0.2rem; font-weight: bold;">房型參考：${data.roomType}</div>` : '';

      resultDiv.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 8px; padding: 0.8rem; margin-top: 0.8rem;">
          <div style="color: #6ee7b7; font-size: 0.9rem; margin-bottom: 0.2rem;">推薦平台：<strong>${data.platform}</strong> ${simBadge}</div>
          ${roomTypeDisplay}
          <div style="color: #10b981; font-size: 1.4rem; font-weight: bold;">${priceDisplay} <span style="font-size:0.9rem; font-weight:normal;">/ 1人1晚 (最低價)</span></div>
          <a href="https://www.google.com/search?q=${encodeURIComponent(hotelName + ' ' + data.platform)}" target="_blank" style="display:inline-block; margin-top:0.5rem; color:#93c5fd; text-decoration:underline; font-size:0.85rem;">前往 ${data.platform} 查看最新房價 ↗</a>
        </div>
      `;
    } else {
      if (btn) btn.innerHTML = '重新查詢';
      if (btn) btn.disabled = false;
      resultDiv.innerHTML = `<p style="color:#ef4444; font-size:0.9rem; margin-top:0.5rem;">無法取得即時價格，請稍後再試。</p>`;
    }
  } catch (err) {
    if (btn) btn.innerHTML = '重新查詢';
    if (btn) btn.disabled = false;
    resultDiv.innerHTML = `<p style="color:#ef4444; font-size:0.9rem; margin-top:0.5rem;">伺服器錯誤，請稍後再試。</p>`;
  }
};

function openModal(hotel, priceText, isExternal = false) {
  // 記錄當前正在瀏覽的飯店資訊
  window.currentModalHotel = hotel;
  window.currentModalPriceText = priceText;
  window.currentModalIsExternal = isExternal;

  if (window.modalLeafletMap) {
    window.modalLeafletMap.remove();
    window.modalLeafletMap = null;
    window.modalMapLegend = null; // 圖例跟著地圖一起重置
  }

  const validWeb = hotel.Website && hotel.Website !== '未找到' && hotel.Website !== '無';
  const websiteUrl = validWeb ? (hotel.Website.startsWith('http') ? hotel.Website : 'http://' + hotel.Website) : null;
  const website = validWeb ? `<a href="${websiteUrl}" target="_blank" class="modal-link website"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> 前往官方網站</a>` : '';
  const gmapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.Name + ' ' + (hotel.Add || ''))}`;
  const gmapBtn = `<a href="${gmapLink}" target="_blank" class="modal-link gmap"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 在 Google Maps 查看照片與地圖</a>`;
  
  // 處理房型資料 (Spec 通常包含房型與價格，以分號分隔)
  let specHtml = '<p>無詳細房型資訊</p>';
  if (hotel.Spec) {
    const specs = hotel.Spec.split(/;|；|,|，/).filter(s => s.trim().length > 0);
    const uniqueSpecs = [...new Set(specs.map(s => {
      // 移除看似價格的數字 (3位數以上的數字，可能包含貨幣符號、冒號等)
      return s.replace(/\s*(?:NT\$|TWD|\$|:|：)?\s*\d{3,}[\d,\-~]*\s*/ig, '').trim();
    }).filter(s => s.length > 0))];
    if (uniqueSpecs.length > 0) {
      specHtml = '<ul class="room-type-list">' + 
        uniqueSpecs.map(s => `<li><span class="room-tag">${s}</span></li>`).join('') + 
        '</ul>';
    }
  }

  // 處理服務資訊 (以逗號或分號分隔的標籤)
  let serviceHtml = '<p>無特殊服務資訊</p>';
  if (hotel.Serviceinfo) {
    const services = hotel.Serviceinfo.split(/;|；|,|，/).filter(s => s.trim().length > 0);
    const uniqueServices = [...new Set(services.map(s => s.trim()))];
    if (uniqueServices.length > 0) {
      serviceHtml = '<ul class="room-type-list">' + 
        uniqueServices.map(s => `<li><span class="room-tag" style="background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.3); color: #34d399;">${s}</span></li>`).join('') + 
        '</ul>';
    }
  }

  let modalImageHtml = '';
  if (hotel.Picture1) {
    modalImageHtml = `<img src="${hotel.Picture1}" alt="${hotel.Name}" class="modal-header-img" onerror="this.src='https://images.unsplash.com/photo-1566073771259-6a8506099945?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80'" />`;
  } else {
    modalImageHtml = `
      <div class="modal-header-img no-image-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        <span style="font-size:1.2rem; margin-top:0.5rem;">目前無照片</span>
      </div>
    `;
  }

  const subtitleHtml = isExternal 
    ? `<span style="color:#ef4444;font-weight:bold;">⚠️ 警告：系統判定為未合法登記旅宿</span>` 
    : `${hotel.Town || '台灣'} · <span style="color:#10b981;">✅ 合法登記旅宿</span>`;

  // 建立地圖與推薦列表區塊
  const mapSection = `
    <div style="margin-top: 2rem; border-top: 1px solid var(--border); padding-top: 1.5rem; width: 100%;">
      <h4 style="margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; color: var(--text);">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 
        地圖位置
      </h4>
      <div style="width: 100%; height: 350px; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); position: relative; z-index: 1;">
        <div id="modalLeafletMap" style="width: 100%; height: 100%;"></div>
        <button onclick="window.recenterModalMap()" title="回到原飯店位置" style="position: absolute; bottom: 20px; right: 20px; z-index: 1000; background: rgba(255,255,255,0.9); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.2); padding: 0.6rem; border-radius: 50%; box-shadow: 0 4px 6px rgba(0,0,0,0.2); cursor: pointer; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); transition: all 0.2s;" onmouseover="this.style.background='white'; this.style.transform='scale(1.1)';" onmouseout="this.style.background='rgba(255,255,255,0.9)'; this.style.transform='scale(1)';">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
      </div>
      <div id="modalNearbyResults"></div>
    </div>
  `;

  // 返回上一頁的按鈕
  const backBtnHtml = (window.modalHistory && window.modalHistory.length > 0)
    ? `<button onclick="window.goBackModal()" style="position: absolute; top: 1rem; left: 1rem; z-index: 10; background: rgba(0, 0, 0, 0.65); color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 20px; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; backdrop-filter: blur(8px); font-size: 0.95rem; font-weight: 500; transition: all 0.2s; box-shadow: 0 4px 6px rgba(0,0,0,0.2);" onmouseover="this.style.background='rgba(0,0,0,0.85)'; this.style.transform='translateX(-2px)';" onmouseout="this.style.background='rgba(0,0,0,0.65)'; this.style.transform='translateX(0)';">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg> 
        返回上一家
      </button>`
    : '';

  modalBody.innerHTML = `
    <div style="position: relative;">
      ${backBtnHtml}
      ${modalImageHtml}
    </div>
    <div class="modal-body-content">
      <h2 class="modal-title">${hotel.Name}</h2>
      <div class="modal-subtitle">${subtitleHtml}</div>
      
      <div class="modal-grid">
        <div class="modal-section">
          <h4 class="section-title"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"></circle><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path></svg> 基本資訊</h4>
          
          <ul class="detail-list">
            <li>
              <span class="detail-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 地址</span>
              <span class="detail-value">${(hotel.Add && !hotel.Add.startsWith('http')) ? hotel.Add : '未提供'}</span>
            </li>
            ${(() => {
              const linkUrl = hotel.sourceUrl || (hotel.Add && hotel.Add.startsWith('http') ? hotel.Add : null);
              if (!linkUrl) return '';
              const display = linkUrl.length > 60 ? linkUrl.slice(0, 60) + '…' : linkUrl;
              return `<li>
              <span class="detail-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> 來源連結</span>
              <a href="${linkUrl}" target="_blank" class="detail-value" style="color:#93c5fd; font-size:0.82rem; padding-left:1.4rem; word-break:break-all; text-decoration:underline;">${display}</a>
            </li>`;
            })()}

            <li>
              <span class="detail-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg> 電話</span>
              <span class="detail-value">${hotel.Tel || '未提供'}</span>
            </li>
            <li>
              <span class="detail-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> 信箱</span>
              <span class="detail-value" style="word-break: break-all;">${hotel.TotalEmail || '未提供'}</span>
            </li>
            <li>
              <span class="detail-label"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg> 房間總數</span>
              <span class="detail-value">${hotel.TotalRoom || '未知'} 間</span>
            </li>
            <li class="price-highlight" id="modal-price-container" style="display:flex; justify-content:space-between; align-items:center;">
              <span class="detail-label" style="margin-top:0.2rem;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg> 房價參考</span>
              <div id="modal-price-value" style="display: flex; flex-direction: column; align-items: flex-end; text-align: right;">
                 <a href="https://www.google.com/search?q=${encodeURIComponent(hotel.Name + ' Booking.com 價格')}" target="_blank" style="padding:0.6rem 1.2rem; border-radius:8px; background:rgba(16, 185, 129, 0.15); color:#34d399; text-decoration:none; font-size:0.95rem; display:flex; align-items:center; gap:0.5rem; font-weight:bold; border: 1px solid rgba(16, 185, 129, 0.4); outline:none; transition: background 0.2s;" onmouseover="this.style.background='rgba(16, 185, 129, 0.25)'" onmouseout="this.style.background='rgba(16, 185, 129, 0.15)'">
                    在 Google 查看最新房價 ↗
                 </a>
              </div>
            </li>
          </ul>
          <div id="modal-price-links"></div>
          <div style="margin-top: 1.5rem; display: flex; flex-direction: column; gap: 0.8rem;">
            ${website}
            ${gmapBtn}
          </div>
        </div>
        
        <div class="modal-section">
          <h4 class="section-title"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> 房型與設施</h4>
          
          <div class="subsection">
            <h5 class="subsection-title">客房類型</h5>
            ${specHtml}
          </div>
          
          <div class="subsection" style="margin-top: 1.8rem;">
            <h5 class="subsection-title">服務與設施</h5>
            ${serviceHtml}
          </div>
          
          <div class="subsection" style="margin-top: 1.8rem; padding-top: 1.5rem; border-top: 1px dashed rgba(255,255,255,0.1);">
            <h5 class="subsection-title">附設停車場</h5>
            <p style="color: var(--text-main); font-size: 0.95rem; line-height: 1.5;">${hotel.Parkinginfo || '未提供'}</p>
          </div>
        </div>
      </div>
      
      ${mapSection}
    </div>
  `;
  
  hotelModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden'; // 防止背景滾動

  // 已經改用直接連結 Google 查詢的方式，無需背景發送 /api/realprice 查詢。

  // Initialize Leaflet Map
  if (hotel.Py && hotel.Px) {
    // Timeout ensures the DOM element is rendered before Leaflet initialization
    setTimeout(() => {
      const lat = parseFloat(hotel.Py);
      const lng = parseFloat(hotel.Px);
      
      window.currentModalHotelLat = lat;
      window.currentModalHotelLng = lng;
      window.currentModalHotelName = hotel.Name;
      
      window.modalLeafletMap = L.map('modalLeafletMap').setView([lat, lng], 15);
      
      // Use dark theme maps for better integration with our UI
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap, © CARTO'
      }).addTo(window.modalLeafletMap);
      
      window.modalMainMarker = L.marker([lat, lng]).addTo(window.modalLeafletMap)
        .bindPopup(`<strong style="color:#1f2937;font-size:1rem;">${hotel.Name}</strong><br><span style="color:#6b7280;font-size:0.85rem;">${hotel.Add || ''}</span><br><span style="color:#10b981;font-size:0.8rem;font-weight:bold;">✅ 合法旅宿</span>`).openPopup();

      // 主旅宿：自訂紅色圖釘 marker
      const mainIcon = L.divIcon({
        className: '',
        html: `<div style="
          width: 36px; height: 36px;
          background: linear-gradient(135deg, #ef4444, #dc2626);
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          border: 3px solid white;
          box-shadow: 0 4px 12px rgba(239,68,68,0.6);
          position: relative;
        ">
          <div style="
            position: absolute; top: 50%; left: 50%;
            transform: translate(-50%,-50%) rotate(45deg);
            color: white; font-size: 16px; line-height:1;
          ">🏨</div>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -38]
      });
      window.modalMainMarker.setIcon(mainIcon);
        
      window.modalMarkers = [];

      // 加入地圖圖例（右下角）
      if (!window.modalMapLegend) {
        window.modalMapLegend = L.control({ position: 'bottomright' });
        window.modalMapLegend.onAdd = function() {
          const div = L.DomUtil.create('div');
          div.style.cssText = `
            background: rgba(15,23,42,0.92); backdrop-filter:blur(8px);
            border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
            padding: 8px 12px; font-size: 0.78rem; color: #e2e8f0;
            line-height: 1.8; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            pointer-events: none;
          `;
          div.innerHTML = `
            <div style="font-weight:700; margin-bottom:4px; color:#94a3b8; letter-spacing:0.05em;">圖例</div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="display:inline-block;width:14px;height:14px;background:linear-gradient(135deg,#ef4444,#dc2626);border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(239,68,68,0.6);"></span>
              當前查詢旅宿
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="display:inline-block;width:14px;height:14px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(16,185,129,0.6);"></span>
              周遭合法旅宿 ✅
            </div>
          `;
          return div;
        };
        window.modalMapLegend.addTo(window.modalLeafletMap);
      }
      
      // Auto-search on map move/zoom
      window.modalLeafletMap.on('moveend', () => {
        window.fetchAndRenderModalNearby();
      });
      // Trigger initial search
      window.fetchAndRenderModalNearby();
    }, 100);
  } else if (hotel.Website && hotel.Website.includes('airbnb')) {
    // === Airbnb 房源：自動抓取座標後初始化地圖 ===
    const mapEl = document.getElementById('modalLeafletMap');
    mapEl.innerHTML = `
      <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; gap:0.8rem; color:var(--text-muted);">
        <div class="spinner" style="width:32px; height:32px; border-width:3px;"></div>
        <span style="font-size:0.9rem;">正在從 Airbnb 取得房源座標...</span>
      </div>
    `;

    fetch(`/api/airbnb_location?url=${encodeURIComponent(hotel.Website)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success) {
          mapEl.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#ef4444; font-size:0.9rem;">⚠️ 無法取得座標：${data.error || '未知錯誤'}</div>`;
          return;
        }

        const lat = data.lat;
        const lng = data.lng;
        window.currentModalHotelLat = lat;
        window.currentModalHotelLng = lng;
        window.currentModalHotelName = hotel.Name;

        // 清空 loading 內容（Leaflet 需要空的 div）
        mapEl.innerHTML = '';

        window.modalLeafletMap = L.map('modalLeafletMap').setView([lat, lng], 15);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap, © CARTO'
        }).addTo(window.modalLeafletMap);

        // Airbnb 房源標記：橘色警示圖釘
        const airbnbIcon = L.divIcon({
          className: '',
          html: `<div style="
            width: 36px; height: 36px;
            background: linear-gradient(135deg, #f97316, #ea580c);
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 3px solid white;
            box-shadow: 0 4px 12px rgba(249,115,22,0.65);
            position: relative;">
            <div style="
              position: absolute; top: 50%; left: 50%;
              transform: translate(-50%,-50%) rotate(45deg);
              color: white; font-size: 16px; line-height:1;">⚠️</div>
          </div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 36],
          popupAnchor: [0, -38]
        });

        window.modalMainMarker = L.marker([lat, lng], { icon: airbnbIcon })
          .addTo(window.modalLeafletMap)
          .bindPopup(`
            <div style="min-width:160px;">
              <div style="font-weight:700; color:#1f2937; font-size:0.95rem; margin-bottom:4px;">${hotel.Name}</div>
              <div style="color:#f97316; font-size:0.8rem; font-weight:600;">⚠️ Airbnb 房源（未合法登記）</div>
              <div style="color:#6b7280; font-size:0.8rem; margin-top:4px;">座標來源：Airbnb 頁面地圖</div>
            </div>
          `).openPopup();

        window.modalMarkers = [];

        // 圖例（右下角）
        if (!window.modalMapLegend) {
          window.modalMapLegend = L.control({ position: 'bottomright' });
          window.modalMapLegend.onAdd = function() {
            const div = L.DomUtil.create('div');
            div.style.cssText = `
              background: rgba(15,23,42,0.92); backdrop-filter:blur(8px);
              border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
              padding: 8px 12px; font-size: 0.78rem; color: #e2e8f0;
              line-height: 1.8; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
              pointer-events: none;
            `;
            div.innerHTML = `
              <div style="font-weight:700; margin-bottom:4px; color:#94a3b8; letter-spacing:0.05em;">圖例</div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:14px;height:14px;background:linear-gradient(135deg,#f97316,#ea580c);border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(249,115,22,0.6);"></span>
                Airbnb 房源（未登記）⚠️
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:14px;height:14px;background:linear-gradient(135deg,#10b981,#059669);border-radius:50%;border:2px solid white;box-shadow:0 2px 6px rgba(16,185,129,0.6);"></span>
                周遭合法旅宿 ✅
              </div>
            `;
            return div;
          };
          window.modalMapLegend.addTo(window.modalLeafletMap);
        }

        // 地圖移動時重新搜尋周遭合法旅宿
        window.modalLeafletMap.on('moveend', () => window.fetchAndRenderModalNearby());
        window.fetchAndRenderModalNearby();
      })
      .catch(err => {
        mapEl.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#ef4444; font-size:0.9rem;">⚠️ 座標取得失敗：${err.message}</div>`;
      });
  } else {
    document.getElementById('modalLeafletMap').innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%; color:var(--text-muted);">無座標資訊，無法載入地圖</div>';
  }
}

function closeModal() {
  hotelModal.classList.add('hidden');
  document.body.style.overflow = '';
  if (window.modalLeafletMap) {
    window.modalLeafletMap.remove();
    window.modalLeafletMap = null;
    window.modalMapLegend = null;
  }
}

if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// 全域錯誤監聽
window.addEventListener('error', (e) => {
  console.error('全局錯誤:', e.message, e.filename, e.lineno);
});

// 啟動應用交由 DOMContentLoaded 處理
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
