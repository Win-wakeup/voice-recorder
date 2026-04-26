// --- i18n 多語言數據 ---
const i18n = {
    'zh-TW': {
        subtitle: "AI 智慧旅宿守門員",
        desc: "為您找出附近高性價比的住宿，確保安心且超值。",
        placeholder: "手動搜尋地點 (如: 台北101)",
        dist0: "0 ~ 500 公尺 (近距離)",
        dist1: "500 公尺 ~ 1 公里 (步程)",
        dist2: "1 ~ 5 公里 (短程車程)",
        dist3: "5 ~ 10 公里 (長程距離)",
        or: "— 或者 —",
        btnLocate: "我目前的位置",
        loading: "分析周邊即時房價中...",
        top10: "Top 10 行旅推薦",
        export: "匯出 JSON",
        empty: "請點擊上方按鈕開始搜尋",
        notFoundArea: "此區域找不到飯店",
        alertEmpty: "請先輸入地點名稱！",
        notFoundLocation: "找不到該地點，請嘗試輸入更具體的名稱。",
        errorAPI: "無法連接伺服器，請確認後端已啟動。",
        errorLoc: "地點搜尋發生錯誤，請稍後再試。",
        errorGeo: "無法取得位置，請確認瀏覽器授權。錯誤代碼：",
        myLocation: "您的位置",
        searchResult: "搜尋結果: ",
        price: "價位: TWD",
        rating: "評分:",
        value: "性價比:",
        geoNotSupport: "您的瀏覽器不支援地理定位！"
    },
    'en': {
        subtitle: "AI Smart Accommodation Guard",
        desc: "Find the most cost-effective accommodations near you securely.",
        placeholder: "Search location (e.g. Taipei 101)",
        dist0: "0 - 500 m (Very Close)",
        dist1: "500 m - 1 km (Walking)",
        dist2: "1 - 5 km (Short Drive)",
        dist3: "5 - 10 km (Long Drive)",
        or: "— OR —",
        btnLocate: "My Current Location",
        loading: "Analyzing local real-time prices...",
        top10: "Top 10 Recommendations",
        export: "Export JSON",
        empty: "Click a button above to start searching",
        notFoundArea: "No hotels found in this area",
        alertEmpty: "Please enter a location name!",
        notFoundLocation: "Location not found, please try a different name.",
        errorAPI: "Cannot connect to server. Ensure backend is running.",
        errorLoc: "Search error, please try again later.",
        errorGeo: "Cannot get location. Check browser permissions. Error: ",
        myLocation: "Your Location",
        searchResult: "Search result: ",
        price: "Price: TWD",
        rating: "Rating:",
        value: "Value Score:",
        geoNotSupport: "Geolocation is not supported by your browser!"
    },
    'ja': {
        subtitle: "AI スマートガード",
        desc: "近くで最もコスパの良い宿泊施設を安全に見つけます。",
        placeholder: "場所を検索 (例: 台北101)",
        dist0: "0 ~ 500 m (すぐ近く)",
        dist1: "500 m ~ 1 km (徒歩圏内)",
        dist2: "1 ~ 5 km (短いドライブ)",
        dist3: "5 ~ 10 km (長いドライブ)",
        or: "— または —",
        btnLocate: "現在地",
        loading: "周辺のリアルタイム価格を分析中...",
        top10: "トップ 10 おすすめ",
        export: "JSON 出力",
        empty: "上のボタンをクリックして検索を開始してください",
        notFoundArea: "このエリアにはホテルが見つかりません",
        alertEmpty: "場所の名前を入力してください！",
        notFoundLocation: "場所が見つかりません。別の名前をお試しください。",
        errorAPI: "サーバーに接続できません。",
        errorLoc: "検索エラーが発生しました。後でもう一度お試しください。",
        errorGeo: "位置情報が取得できません。権限を確認してください。エラー: ",
        myLocation: "現在地",
        searchResult: "検索結果: ",
        price: "価格: TWD",
        rating: "評価:",
        value: "コスパ:",
        geoNotSupport: "お使いのブラウザは位置情報をサポートしていません！"
    }
};

let currentLang = 'zh-TW';

// 初始化 Leaflet 地圖 (預設地點：台北車站)
const map = L.map('map').setView([25.0478, 121.5170], 14);
let currentMarkers = [];
let currentHotels = [];

// 使用 CartoDB Dark Matter 圖層
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors, © CARTO'
}).addTo(map);

// DOM 元素
const locateBtn = document.getElementById('locateBtn');
const searchBtn = document.getElementById('searchBtn');
const locationInput = document.getElementById('locationInput');
const distanceSelect = document.getElementById('distanceSelect');
const loadingState = document.getElementById('loadingState');
const listHeader = document.getElementById('listHeader');
const hotelList = document.getElementById('hotelList');
const exportBtn = document.getElementById('exportBtn');
const langSelect = document.getElementById('langSelect');

// --- 語言切換邏輯 ---
function updateUI() {
    const t = i18n[currentLang];
    
    document.getElementById('ui-subtitle').innerText = t.subtitle;
    document.getElementById('ui-desc').innerText = t.desc;
    document.getElementById('locationInput').placeholder = t.placeholder;
    
    distanceSelect.options[0].text = t.dist0;
    distanceSelect.options[1].text = t.dist1;
    distanceSelect.options[2].text = t.dist2;
    distanceSelect.options[3].text = t.dist3;
    
    document.getElementById('orSeparator').innerText = t.or;
    document.getElementById('locateBtn').innerHTML = `<span class="icon">📍</span> ${t.btnLocate}`;
    document.getElementById('ui-loading').innerText = t.loading;
    document.getElementById('ui-top10').innerText = t.top10;
    document.getElementById('ui-export').innerText = t.export;
    
    // 如果是首頁空狀態
    if (hotelList.innerHTML.includes('empty-state')) {
        const text = currentHotels.length === 0 && !listHeader.classList.contains('hidden') 
            ? t.notFoundArea : t.empty;
        hotelList.innerHTML = `<li class="empty-state">${text}</li>`;
    } else {
        // 如果已經有資料，重新渲染飯店卡片即可更新語言
        if (currentHotels.length > 0) renderHotels(currentHotels);
    }
}

langSelect.addEventListener('change', (e) => {
    currentLang = e.target.value;
    updateUI();
});
// --------------------

// 監聽定位按鈕
locateBtn.addEventListener('click', () => {
    const t = i18n[currentLang];
    if ("geolocation" in navigator) {
        setLoading(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                handleMapCenterChange(lat, lng, t.myLocation);
                fetchHotels(lat, lng);
            },
            (error) => {
                setLoading(false);
                alert(`${t.errorGeo} ${error.message}`);
                console.log("Fallback to demo location...");
                handleMapCenterChange(25.0339, 121.5644, "Fallback");
                fetchHotels(25.0339, 121.5644); 
            }
        );
    } else {
        alert(t.geoNotSupport);
    }
});

// 監聽搜尋按鈕 (手動輸入地點)
searchBtn.addEventListener('click', async () => {
    const t = i18n[currentLang];
    const query = locationInput.value.trim();
    if (!query) {
        alert(t.alertEmpty);
        return;
    }
    
    setLoading(true);
    try {
        // 利用 OpenStreetMap 的地理編碼服務
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        const data = await res.json();
        
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            handleMapCenterChange(lat, lng, t.searchResult + data[0].display_name);
            fetchHotels(lat, lng);
        } else {
            alert(t.notFoundLocation);
            setLoading(false);
        }
    } catch (e) {
        console.error(e);
        alert(t.errorLoc);
        setLoading(false);
    }
});

// 地圖視角與中心標記切換共用函式
function handleMapCenterChange(lat, lng, title) {
    if (!map) return;
    map.flyTo([lat, lng], 15);
    
    L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: "#3b82f6",
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
    }).addTo(map).bindPopup(title).openPopup();
}

// 負責呼叫 FastAPI API
async function fetchHotels(lat, lng) {
    const t = i18n[currentLang];
    const distRange = distanceSelect.value.split(',');
    const minR = parseFloat(distRange[0]);
    const maxR = parseFloat(distRange[1]);

    try {
        const response = await fetch(`http://127.0.0.1:8000/api/hotels?lat=${lat}&lng=${lng}&min_radius=${minR}&max_radius=${maxR}`);
        if (!response.ok) throw new Error("API FAILED");
        
        const resData = await response.json();
        const hotels = resData.data;
        currentHotels = hotels;

        renderHotels(hotels);
    } catch (error) {
        console.error(error);
        hotelList.innerHTML = `<li class="empty-state">${t.errorAPI}</li>`;
    } finally {
        setLoading(false);
    }
}

// 渲染清單與 Leaflet 地圖標記
function renderHotels(hotels) {
    const t = i18n[currentLang];
    
    // 清除舊地圖標記
    currentMarkers.forEach(m => map.removeLayer(m));
    currentMarkers = [];
    hotelList.innerHTML = "";

    if (!hotels || hotels.length === 0) {
        hotelList.innerHTML = `<li class="empty-state">${t.notFoundArea}</li>`;
        listHeader.classList.add('hidden');
        exportBtn.disabled = true;
        return;
    }

    listHeader.classList.remove('hidden');
    exportBtn.disabled = false;

    hotels.forEach((hotel, index) => {
        // --- 設定左側清單 UI ---
        const li = document.createElement("li");
        li.className = "hotel-card";
        li.style.animationDelay = `${index * 0.1}s`;
        li.innerHTML = `
            <div class="hotel-header">
                <div class="hotel-name">${index + 1}. ${hotel.name}</div>
                <div class="hotel-score">${hotel.rating}</div>
            </div>
            <div class="hotel-details">
                <div class="price"><span style="font-size:0.75rem">${t.price.replace('TWD','')} </span>TWD ${hotel.price.toLocaleString()}</div>
                <div class="value-badge">${t.value} ${hotel.value_score}</div>
            </div>
        `;

        hotelList.appendChild(li);

        // --- 設定地圖 Marker ---
        const marker = L.marker([hotel.lat, hotel.lng]).addTo(map);
        marker.bindPopup(`
            <h3>${hotel.name}</h3>
            <div style="color: black;">${t.price} ${hotel.price}</div>
            <div style="color: black;">${t.rating} ${hotel.rating}</div>
            <div style="color: #10b981; font-weight: bold; margin-top: 4px;">${t.value} ${hotel.value_score}</div>
        `);
        currentMarkers.push(marker);

        // --- 互動事件 ---
        li.addEventListener('mouseenter', () => {
            marker.openPopup();
        });
        li.addEventListener('click', () => {
            map.flyTo([hotel.lat, hotel.lng], 16);
            marker.openPopup();
            // Highlight active element
            document.querySelectorAll('.hotel-card').forEach(c => c.classList.remove('active'));
            li.classList.add('active');
        });
    });
}

// 匯出 JSON 功能給隊友
exportBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentHotels, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "top_10_hotels_for_safety_check.json");
    document.body.appendChild(downloadAnchorNode); // Firefox required
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
});

// UI 控制
function setLoading(isLoading) {
    if (isLoading) {
        loadingState.classList.remove('hidden');
        hotelList.innerHTML = "";
        listHeader.classList.add('hidden');
        exportBtn.disabled = true;
    } else {
        loadingState.classList.add('hidden');
    }
}
