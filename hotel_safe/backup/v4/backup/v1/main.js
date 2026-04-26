import './style.css';

// DOM Elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const loadingPanel = document.getElementById('loading');
const initialPanel = document.getElementById('initial');
const noResultsPanel = document.getElementById('noResults');
const hotelList = document.getElementById('hotelList');
const suggestionsBox = document.getElementById('suggestionsBox');

// Initialize
function init() {
  console.log("🚀 [Frontend] Application Initializing...");
  
  if (!searchBtn || !searchInput) {
    console.error("❌ [Frontend] Critical elements not found!");
    return;
  }
  
  // 切換 UI 狀態
  if (loadingPanel) loadingPanel.classList.add('hidden');
  if (initialPanel) initialPanel.classList.remove('hidden');
  
  // 綁定事件
  searchBtn.addEventListener('click', () => {
    console.log("👉 [Frontend] Search button clicked");
    if (suggestionsBox) suggestionsBox.classList.add('hidden');
    handleSearch();
  });
  
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      console.log("👉 [Frontend] Enter key pressed");
      if (suggestionsBox) suggestionsBox.classList.add('hidden');
      handleSearch();
    }
  });

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
  const query = searchInput.value.trim();
  
  // 顯示 Loading
  initialPanel.classList.add('hidden');
  noResultsPanel.classList.add('hidden');
  hotelList.classList.add('hidden');
  loadingPanel.classList.remove('hidden');
  
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
    loadingPanel.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <p style="color:#ef4444;">查詢失敗，請確認後端伺服器是否正常運作。</p>
      <p class="small-text" style="color:#ef4444;">${error.message}</p>
    `;
  }
}

function renderResults(data) {
  const { results = [], isFuzzy = false, isExternal = false, isUrlSearch = false, isInvalidUrl = false, scrapedTitle = '' } = data;
  
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
    
    // 處理房價
    let priceText = '價格未提供';
    if (hotel.LowestPrice && hotel.CeilingPrice) {
      priceText = `NT$ ${hotel.LowestPrice} - ${hotel.CeilingPrice}`;
    } else if (hotel.LowestPrice) {
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

        <div class="price-tag">
          <span class="price-label">每晚參考價格</span>
          <span class="price-value">${priceText}</span>
        </div>
        <div class="hotel-footer" style="margin-top:1rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
          ${hotel.Website ? `<a href="${hotel.Website}" target="_blank" class="card-btn" style="padding:0.4rem 0.8rem; border-radius:8px; background:rgba(79, 70, 229, 0.2); color:#a5b4fc; text-decoration:none; font-size:0.85rem;" onclick="event.stopPropagation()">官方網站</a>` : ''}
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.Name + ' ' + (hotel.Add || ''))}" target="_blank" class="card-btn" style="padding:0.4rem 0.8rem; border-radius:8px; background:rgba(59, 130, 246, 0.2); color:#93c5fd; text-decoration:none; font-size:0.85rem; display:flex; align-items:center; gap:0.3rem;" onclick="event.stopPropagation()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 
            地圖與照片
          </a>
        </div>
      </div>
    `;
    
    card.style.cursor = 'pointer'; // 讓卡片看起來可點擊
    card.addEventListener('click', () => openModal(hotel, priceText, isExternal));
    
    hotelList.appendChild(card);
  });
}

// Modal Variables
const hotelModal = document.getElementById('hotelModal');
const modalBody = document.getElementById('modalBody');
const closeModalBtn = document.getElementById('closeModalBtn');
const modalBackdrop = document.querySelector('.modal-backdrop');

function openModal(hotel, priceText, isExternal = false) {
  const website = hotel.Website ? `<a href="${hotel.Website}" target="_blank" class="modal-link"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> 前往官方網站</a>` : '';
  const gmapLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.Name + ' ' + (hotel.Add || ''))}`;
  const gmapBtn = `<a href="${gmapLink}" target="_blank" class="modal-link" style="color: #3b82f6; margin-left: 1rem;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 在 Google Maps 查看照片與地圖</a>`;
  
  // 處理房型資料 (Spec 通常包含房型與價格，以分號分隔)
  let specHtml = '<p>無詳細房型資訊</p>';
  if (hotel.Spec) {
    const specs = hotel.Spec.split(/;|；|,|，/).filter(s => s.trim().length > 0);
    const uniqueSpecs = [...new Set(specs.map(s => s.trim()))];
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

  // 建立 Google Maps iframe
  const mapIframe = `
    <div style="margin-top: 2rem; border-top: 1px solid var(--border); padding-top: 1.5rem; width: 100%;">
      <h4 style="margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; color: var(--text);">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> 
        地圖位置
      </h4>
      <div style="width: 100%; height: 350px; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <iframe 
          width="100%" 
          height="100%" 
          style="border:0;" 
          loading="lazy" 
          allowfullscreen 
          referrerpolicy="no-referrer-when-downgrade" 
          src="https://maps.google.com/maps?q=${encodeURIComponent(hotel.Name + ' ' + (hotel.Add || ''))}&t=&z=15&ie=UTF8&iwloc=&output=embed">
        </iframe>
      </div>
    </div>
  `;

  modalBody.innerHTML = `
    ${modalImageHtml}
    <div class="modal-body-content">
      <h2 class="modal-title">${hotel.Name}</h2>
      <div class="modal-subtitle">${subtitleHtml}</div>
      
      <div class="modal-grid">
        <div class="modal-section">
          <h4><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"></circle><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path></svg> 基本資訊</h4>
          <p><strong>地址：</strong>${hotel.Add || '未提供'}</p>
          <p><strong>電話：</strong>${hotel.Tel || '未提供'}</p>
          <p><strong>信箱：</strong>${hotel.TotalEmail || '未提供'}</p>
          <p><strong>房價參考：</strong>${priceText}</p>
          <p><strong>房間總數：</strong>${hotel.TotalRoom || '未知'} 間</p>
          <div style="margin-top: 1rem; display: flex; flex-wrap: wrap;">
            ${website}
            ${gmapBtn}
          </div>
        </div>
        
        <div class="modal-section">
          <h4><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> 房型與服務</h4>
          <p><strong>房型說明：</strong></p>
          ${specHtml}
          <div style="margin-top: 1.5rem;"></div>
          <p><strong>服務資訊：</strong></p>
          ${serviceHtml}
          <p style="margin-top: 1.5rem;"><strong>停車場：</strong>${hotel.Parkinginfo || '未提供'}</p>
        </div>
      </div>
      
      ${mapIframe}
    </div>
  `;
  
  hotelModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden'; // 防止背景滾動
}

function closeModal() {
  hotelModal.classList.add('hidden');
  document.body.style.overflow = '';
}

if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
if (modalBackdrop) modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// 啟動應用交由 DOMContentLoaded 處理
