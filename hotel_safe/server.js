import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

const port = 3000;
let hotelsData = [];

function loadData() {
    console.log('==================================================');
    console.log('[後端階段 1/3] 系統初始化啟動中...');
    try {
        console.log('[後端階段 2/3] 正在讀取並解析旅館資料庫 (public/hotel.json)...');
        const dataPath = path.join(__dirname, 'public', 'hotel.json');
        
        if (!fs.existsSync(dataPath)) {
            console.error('[錯誤] 找不到資料庫檔案，請確保 public/hotel.json 存在');
            return;
        }

        let rawData = fs.readFileSync(dataPath, 'utf8');
        
        // 移除 BOM
        if (rawData.charCodeAt(0) === 0xFEFF) {
            rawData = rawData.slice(1);
        }
        
        const jsonData = JSON.parse(rawData);
        
        if (jsonData.XML_Head && jsonData.XML_Head.Infos && jsonData.XML_Head.Infos.Info) {
            hotelsData = jsonData.XML_Head.Infos.Info;
            console.log(`[後端階段 3/3] 資料庫載入完成！共載入 ${hotelsData.length} 筆合法旅館資料。`);
            console.log(`[系統狀態] 後端伺服器已準備就緒 (Port: ${port})...`);
            console.log('==================================================');
        } else {
            console.error('[錯誤] 資料庫格式不符預期');
        }
    } catch (error) {
        console.error('[錯誤] 載入資料庫失敗:', error.message);
    }
}

// Haversine formula 計算距離 (公里)
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// 附近高性價比旅宿查詢 (整合「行旅」專案邏輯)
app.get('/api/nearby', (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const sw_lat = parseFloat(req.query.sw_lat);
    const sw_lng = parseFloat(req.query.sw_lng);
    const ne_lat = parseFloat(req.query.ne_lat);
    const ne_lng = parseFloat(req.query.ne_lng);
    const min_radius = parseFloat(req.query.min_radius || 0);
    const max_radius = parseFloat(req.query.max_radius || 5);
    const excludeName = req.query.exclude || '';

    if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: "Missing or invalid lat/lng" });
    }

    const useBounds = !isNaN(sw_lat) && !isNaN(sw_lng) && !isNaN(ne_lat) && !isNaN(ne_lng);

    // 建立穩定雜湊函數，確保每家旅館的模擬價格與評分是固定的
    const getDeterministicData = (str) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        const absHash = Math.abs(hash);
        return {
            rating: (7.5 + ((absHash % 24) / 10)).toFixed(1),
            price: 1000 + (absHash % 30) * 100
        };
    };

    let nearbyHotels = [];
    hotelsData.forEach(hotel => {
        if (excludeName && hotel.Name === excludeName) return;
        
        if (hotel.Py && hotel.Px) {
            const hLat = parseFloat(hotel.Py);
            const hLng = parseFloat(hotel.Px);
            if (!isNaN(hLat) && !isNaN(hLng)) {
                let isInside = false;
                const dist = getDistanceFromLatLonInKm(lat, lng, hLat, hLng);
                
                if (useBounds) {
                    if (hLat >= sw_lat && hLat <= ne_lat && hLng >= sw_lng && hLng <= ne_lng) {
                        isInside = true;
                    }
                } else {
                    if (dist >= min_radius && dist <= max_radius) {
                        isInside = true;
                    }
                }

                if (isInside) {
                    // 使用穩定的模擬評價與真實價格以計算性價比 (Value for Money)
                    const simData = getDeterministicData(hotel.Id || hotel.Name || 'unknown');
                    const rating = simData.rating;
                    // 排除觀光署資料庫中不合理的極低報價 (例如 100 元)
                    const price = (hotel.LowestPrice && hotel.LowestPrice >= 500) ? hotel.LowestPrice : simData.price;
                    const cp = price > 0 ? ((parseFloat(rating) / price) * 1000).toFixed(2) : 0;
                    
                    nearbyHotels.push({
                        ...hotel,
                        distance: dist.toFixed(2),
                        simulatedRating: rating,
                        simulatedPrice: price,
                        cpValue: parseFloat(cp)
                    });
                }
            }
        }
    });

    // 依據性價比 (CP值) 降冪排序
    nearbyHotels.sort((a, b) => b.cpValue - a.cpValue);
    
    console.log(`[後端執行狀況] 尋找座標(${lat}, ${lng}) 半徑 ${min_radius}-${max_radius}km 的高性價比旅宿，共找到 ${nearbyHotels.length} 筆資料`);

    return res.json({
        isFuzzy: false,
        isExternal: false,
        isUrlSearch: false,
        isNearbySearch: true,
        results: nearbyHotels.slice(0, 10) // 回傳 Top 10
    });
});

app.get('/api/search', async (req, res) => {
    let originalQuery = (req.query.q || '').trim();
    let query = originalQuery.toLowerCase();
    console.log(`[後端執行狀況] 收到查詢請求，關鍵字: "${originalQuery}"`);
    
    if (!query) {
        console.log(`[後端執行狀況] 收到空查詢，回傳前 50 筆預設資料`);
        return res.json({ isFuzzy: false, isExternal: false, results: hotelsData.slice(0, 50) });
    }

    let isUrl = false;
    let scrapedTitle = '';
    let isAccommodation = false;

    // 判斷是否為網址
    if (originalQuery.startsWith('http://') || originalQuery.startsWith('https://')) {
        isUrl = true;
        
        // 常見的訂房平台網域
        const bookingDomains = ['airbnb', 'agoda', 'booking.com', 'expedia', 'hotels.com', 'tripadvisor', 'trivago', 'asiayo', 'eztravel', 'liontravel', 'klook', 'kkday'];
        const isBookingDomain = bookingDomains.some(domain => originalQuery.toLowerCase().includes(domain));

        console.log(`[後端執行狀況] 偵測到網址輸入，嘗試爬取標題: "${originalQuery}"`);
        try {
            const { data } = await axios.get(originalQuery, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0' },
                timeout: 5000
            });
            const $ = cheerio.load(data);
            scrapedTitle = $('title').text().trim() || $('h1').first().text().trim();
            console.log(`[後端執行狀況] 成功爬取網址標題: "${scrapedTitle}"`);
            
            // 檢查標題是否包含住宿相關關鍵字
            const accKeywords = ['住宿', '飯店', '酒店', '旅館', '民宿', '客棧', '房源', '套房', '行旅', '青年旅館', 'hotel', 'hostel', 'resort', 'inn', 'b&b', 'motel', 'villa'];
            const titleHasAccKeyword = accKeywords.some(kw => scrapedTitle.toLowerCase().includes(kw));

            // 如果是訂房平台，或是標題有住宿關鍵字，則認定為住宿網址
            isAccommodation = isBookingDomain || titleHasAccKeyword;
        } catch (err) {
            console.error('[後端執行狀況] 網址爬取失敗:', err.message);
            // 爬取失敗的話，如果網域是訂房平台，還是算它通過
            isAccommodation = isBookingDomain;
        }
        
        // 如果判斷不是住宿網址，直接回傳錯誤
        if (!isAccommodation) {
            console.log(`[後端執行狀況] 該網址不屬於住宿相關連結，拒絕查詢`);
            return res.json({
                isFuzzy: false,
                isExternal: false,
                isUrlSearch: true,
                isInvalidUrl: true,
                scrapedTitle,
                results: []
            });
        }
    }

    // 第一階段：精準匹配
    const exactResults = hotelsData.filter(hotel => {
        if (isUrl && scrapedTitle) {
            // 如果是網址，檢查爬下來的標題是否包含該旅館名稱
            const cleanTitle = scrapedTitle.replace(/\s+/g, '').toLowerCase();
            const cleanName = hotel.Name.replace(/\s+/g, '').toLowerCase();
            return cleanName.length >= 2 && cleanTitle.includes(cleanName);
        } else {
            const nameMatch = hotel.Name && hotel.Name.toLowerCase().includes(query);
            const addMatch = hotel.Add && hotel.Add.toLowerCase().includes(query);
            return nameMatch || addMatch;
        }
    });

    if (isUrl) {
        if (exactResults.length > 0) {
            console.log(`[後端執行狀況] 網址比對成功！共找到 ${exactResults.length} 筆關聯合法資料`);
            return res.json({ isFuzzy: false, isExternal: false, isUrlSearch: true, scrapedTitle, results: exactResults.slice(0, 50) });
        } else {
            console.log(`[後端執行狀況] 網址比對失敗，該網址可能為非法旅宿`);
            // 嘗試用 Puppeteer 取得實際地址
            let scrapedAddress = null;
            try {
                const isAirbnb = originalQuery.toLowerCase().includes('airbnb');
                if (isAirbnb) {
                    const { data: locData } = await axios.get(`http://localhost:${port}/api/airbnb_location?url=${encodeURIComponent(originalQuery)}`, { timeout: 35000 }).catch(() => ({ data: null }));
                    if (locData && locData.address) scrapedAddress = locData.address;
                }
            } catch (_) {}

            return res.json({
                isFuzzy: false,
                isExternal: true,
                isUrlSearch: true,
                scrapedTitle,
                results: [{
                    Name: scrapedTitle || '未知網頁',
                    Town: '未合法登記',
                    Add: scrapedAddress || '地址未提供（非合法登記旅宿）',
                    Spec: '警告：您輸入的網址住宿，經系統比對不在觀光署合法登記名單中！',
                    Serviceinfo: '這可能是非法日租套房或未立案旅宿，請特別留意住宿安全。',
                    Website: originalQuery,
                    sourceUrl: originalQuery,
                    isExternal: true
                }]
            });
        }
    }

    if (exactResults.length > 0) {
        console.log(`[後端執行狀況] 查詢 "${query}" 完成，共回傳 ${Math.min(exactResults.length, 50)} 筆資料`);
        return res.json({ isFuzzy: false, isExternal: false, results: exactResults.slice(0, 50) });
    }

    // 第二階段：模糊匹配 (容錯、相似字)
    console.log(`[後端執行狀況] 精準匹配未找到 "${query}"，啟動模糊搜尋...`);
    const scoredResults = hotelsData.map(hotel => {
        let maxScore = 0;
        const targets = [hotel.Name, hotel.Town, hotel.Add].filter(Boolean);
        
        for (let text of targets) {
            text = text.toLowerCase();
            let matchCount = 0;
            let queryIdx = 0;
            
            for (let i = 0; i < text.length && queryIdx < query.length; i++) {
                if (text[i] === query[queryIdx]) {
                    matchCount++;
                    queryIdx++;
                } else if (queryIdx > 0 && text[i] === query[queryIdx - 1]) {
                } else {
                    let nextMatch = query.indexOf(text[i], queryIdx);
                    if (nextMatch !== -1 && nextMatch - queryIdx <= 1) {
                        queryIdx = nextMatch + 1;
                        matchCount++;
                    }
                }
            }
            
            let unorderedMatch = 0;
            const textChars = text.split('');
            for (let char of query) {
                const idx = textChars.indexOf(char);
                if (idx !== -1) {
                    unorderedMatch++;
                    textChars[idx] = null; 
                }
            }
            
            const orderedScore = matchCount / query.length;
            const unorderedScore = unorderedMatch / query.length;
            
            const score = Math.max(orderedScore, unorderedScore * 0.8);
            if (score > maxScore) maxScore = score;
        }
        return { hotel, score: maxScore };
    });

    const fuzzyResults = scoredResults
        .filter(item => item.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .map(item => item.hotel);

    if (fuzzyResults.length > 0) {
        console.log(`[後端執行狀況] 模糊搜尋 "${query}" 完成，回傳 ${Math.min(fuzzyResults.length, 50)} 筆相似資料`);
        return res.json({ isFuzzy: true, isExternal: false, results: fuzzyResults.slice(0, 50) });
    }

    // 第三階段：合法資料庫完全查無結果，啟動網路搜尋
    console.log(`[後端執行狀況] 查無合法旅館，啟動網路搜尋: "${query}"`);
    try {
        const { data } = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' 住宿 旅館')}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const $ = cheerio.load(data);
        const externalResults = [];
        
        $('.result').each((i, el) => {
            if (i >= 5) return;
            const title = $(el).find('.result__title').text().trim();
            const snippet = $(el).find('.result__snippet').text().trim();
            const url = $(el).find('.result__url').attr('href');
            
            if (title && snippet) {
                externalResults.push({
                    Name: title,
                    Town: '未註冊/網路搜尋結果',
                    Add: snippet,
                    Spec: '此為網路搜尋結果，該旅宿可能未具備合法登記。',
                    Serviceinfo: '請消費者自行確認其合法性與安全性。',
                    Website: url,
                    isExternal: true
                });
            }
        });
        
        if (externalResults.length > 0) {
            console.log(`[後端執行狀況] 網路搜尋完成，回傳 ${externalResults.length} 筆資料`);
            return res.json({ isFuzzy: false, isExternal: true, results: externalResults });
        }
    } catch (err) {
        console.error('[後端執行狀況] 網路搜尋失敗:', err.message);
    }
    
    // 如果連網路搜尋都失敗，就回傳空陣列
    res.json({ isFuzzy: false, isExternal: false, results: [] });
});

const priceCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

app.get('/api/realprice', async (req, res) => {
    const hotelName = req.query.name;
    if (!hotelName) return res.status(400).json({ error: 'Missing hotel name' });

    const cached = priceCache.get(hotelName);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        console.log(`[後端執行狀況] 命中快取，使用 1 小時內先前查過的價格: "${hotelName}"`);
        return res.json(cached.data);
    }

    console.log(`[後端執行狀況] 正在即時查詢各大平台房價: "${hotelName}"`);
    try {
        const { data } = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(hotelName + ' Booking.com 一位成人 房價 NT$')}`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 5000
        });
        const $ = cheerio.load(data);
        let minPrice = Infinity;
        let maxPrice = -Infinity;
        let platform = 'Booking.com';
        let found = false;
        let roomType = '一位成人'; // 預設

        $('.result__snippet, .result__title').each((i, el) => {
            const text = $(el).text();
            const regex = /(?:NT\$|TWD|\$|台幣|一晚(?:約|只要)?)\s*([0-9,]{3,})/gi;
            
            // 擷取房型關鍵字 (往前抓最多 5 個字)
            const roomRegex = /([\u4e00-\u9fa5]{0,6}(?:雙人房|單人房|家庭房|四人房|雙床房|大床房|標準房|豪華房|套房|客房|床位))/i;
            const roomMatch = text.match(roomRegex);

            let m;
            while ((m = regex.exec(text)) !== null) {
                const p = parseInt(m[1].replace(/,/g, ''));
                if (p >= 500 && p <= 30000) {
                    if (p < minPrice) {
                        minPrice = p;
                        if (roomMatch) roomType = roomMatch[1]; // 儲存對應最低價的房型
                        
                        const lowerText = text.toLowerCase();
                        if (lowerText.includes('agoda')) platform = 'Agoda';
                        else if (lowerText.includes('booking')) platform = 'Booking.com';
                        else if (lowerText.includes('klook')) platform = 'Klook';
                        else if (lowerText.includes('trip')) platform = 'Trip.com';
                    }
                    if (p > maxPrice) maxPrice = p;
                    found = true;
                }
            }
        });

        if (found) {
            console.log(`[後端執行狀況] 成功爬取到即時價格: ${platform} - ${roomType} 一晚 NT$${minPrice} ~ NT$${maxPrice}`);
            const resultData = { minPrice, maxPrice, platform, roomType };
            priceCache.set(hotelName, { data: resultData, timestamp: Date.now() });
            return res.json(resultData);
        } else {
            console.log(`[後端執行狀況] 查無明顯即時價格，套用系統預估模型`);
            let hash = 0;
            for (let i = 0; i < hotelName.length; i++) {
                hash = ((hash << 5) - hash) + hotelName.charCodeAt(i);
                hash |= 0;
            }
            const simMinPrice = 1000 + (Math.abs(hash) % 30) * 100;
            const simMaxPrice = simMinPrice + 500 + (Math.abs(hash) % 15) * 100;
            const platforms = ['Agoda', 'Booking.com', 'Klook', 'Trip.com'];
            const simPlatform = platforms[Math.abs(hash) % platforms.length];
            const resultData = { minPrice: simMinPrice, maxPrice: simMaxPrice, platform: simPlatform, roomType: '標準客房', isSimulated: true };
            priceCache.set(hotelName, { data: resultData, timestamp: Date.now() });
            return res.json(resultData);
        }
    } catch (err) {
        console.error('[後端執行狀況] 價格爬蟲失敗:', err.message);
        return res.json({ minPrice: null, maxPrice: null });
    }
});


app.get('/api/check_links', async (req, res) => {
    const hotelName = req.query.name;
    if (!hotelName) return res.status(400).json({ error: 'Missing hotel name' });

    console.log(`[後端執行狀況] 正在確認訂房平台連結: "${hotelName}"`);
    try {
        const { data } = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(hotelName + ' 訂房 booking klook agoda')}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
            timeout: 5000
        });
        const $ = cheerio.load(data);
        const text = $('body').text().toLowerCase();
        
        let platforms = [];
        if (text.includes('booking.com') || text.includes('booking')) platforms.push('Booking.com');
        if (text.includes('klook.com') || text.includes('klook')) platforms.push('Klook');
        if (text.includes('agoda.com') || text.includes('agoda')) platforms.push('Agoda');

        // 如果都沒找到，給預設的
        if (platforms.length === 0) {
            platforms = ['Booking.com', 'Klook']; 
        }

        return res.json({ success: true, platforms });
    } catch (err) {
        console.error('[後端執行狀況] 確認平台連結失敗:', err.message);
        // 失敗時回傳預設平台
        return res.json({ success: true, platforms: ['Booking.com', 'Klook'] });
    }
});

app.get('/api/suggestions', (req, res) => {
    const query = (req.query.q || '').trim().toLowerCase();
    
    if (!query) {
        return res.json([]);
    }

    // 只搜尋名稱，以求最快速度，並限制回傳 8 筆
    const results = hotelsData.filter(hotel => {
        return hotel.Name && hotel.Name.toLowerCase().includes(query);
    }).slice(0, 8);

    // 只需要名字與地址
    const suggestions = results.map(h => ({
        name: h.Name,
        add: h.Add || '地址未提供'
    }));

    res.json(suggestions);
});

// =====================================================
// [新功能] Airbnb 房源地圖座標爬取
// 輸入: ?url=<airbnb_url>
// 輸出: { lat, lng, address, title }
// =====================================================
app.get('/api/airbnb_location', async (req, res) => {
    const airbnbUrl = req.query.url;
    if (!airbnbUrl) {
        return res.status(400).json({ error: '缺少 url 參數' });
    }
    if (!airbnbUrl.includes('airbnb')) {
        return res.status(400).json({ error: '僅支援 Airbnb 網址' });
    }

    console.log(`[Airbnb定位] 開始爬取座標: ${airbnbUrl}`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--lang=zh-TW'
            ]
        });

        const page = await browser.newPage();

        // 偽裝成真實瀏覽器，避免被 Airbnb 偵測
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW,zh;q=0.9' });

        // 前往頁面，等待網路穩定
        await page.goto(airbnbUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // 方法一：從 __NEXT_DATA__ script tag 讀取 JSON (最可靠)
        let locationData = await page.evaluate(() => {
            const nextDataEl = document.getElementById('__NEXT_DATA__');
            if (!nextDataEl) return null;
            try {
                const json = JSON.parse(nextDataEl.textContent);
                // 遞迴搜尋含有 lat/lng 的物件
                const findLatLng = (obj, depth = 0) => {
                    if (depth > 15 || !obj || typeof obj !== 'object') return null;
                    if (typeof obj.lat === 'number' && typeof obj.lng === 'number') {
                        return { lat: obj.lat, lng: obj.lng };
                    }
                    if (typeof obj.latitude === 'number' && typeof obj.longitude === 'number') {
                        return { lat: obj.latitude, lng: obj.longitude };
                    }
                    for (const key of Object.keys(obj)) {
                        const result = findLatLng(obj[key], depth + 1);
                        if (result) return result;
                    }
                    return null;
                };
                return findLatLng(json);
            } catch (e) {
                return null;
            }
        });

        // 方法二：如果 __NEXT_DATA__ 沒找到，嘗試從 Apollo/GraphQL 快取讀取
        if (!locationData) {
            locationData = await page.evaluate(() => {
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const script of scripts) {
                    const text = script.textContent || '';
                    // 嘗試比對常見的 lat/lng 座標格式
                    const match = text.match(/"lat(?:itude)?"\s*:\s*([0-9]{1,3}\.[0-9]+).*?"l(?:ng|on)(?:gitude)?"\s*:\s*([0-9]{1,3}\.[0-9]+)/);
                    if (match) {
                        const lat = parseFloat(match[1]);
                        const lng = parseFloat(match[2]);
                        // 確認是台灣附近座標 (21~26°N, 119~122°E)
                        if (lat >= 21 && lat <= 26 && lng >= 119 && lng <= 123) {
                            return { lat, lng };
                        }
                    }
                }
                return null;
            });
        }

        // 同時擷取頁面標題與顯示地址
        const pageTitle = await page.title();
        const displayAddress = await page.evaluate(() => {
            // Airbnb 地址通常在包含「鄰近」或區域名稱的 section
            const candidates = [
                document.querySelector('[data-section-id="LOCATION_DEFAULT"] h2'),
                document.querySelector('[data-section-id="LOCATION_DEFAULT"] h3'),
                document.querySelector('section[aria-label*="位置"] h2'),
                document.querySelector('section[aria-label*="location"] h2'),
            ];
            for (const el of candidates) {
                if (el && el.textContent.trim()) return el.textContent.trim();
            }
            return null;
        });

        await browser.close();

        if (locationData) {
            console.log(`[Airbnb定位] ✅ 成功取得座標: lat=${locationData.lat}, lng=${locationData.lng}`);
            return res.json({
                success: true,
                lat: locationData.lat,
                lng: locationData.lng,
                title: pageTitle.replace(' - Airbnb', '').trim(),
                address: displayAddress || '座標已取得，詳細地址請參考地圖'
            });
        } else {
            console.log(`[Airbnb定位] ❌ 無法從頁面解析出座標`);
            return res.json({ success: false, error: '無法解析座標，Airbnb 可能已更新頁面結構' });
        }

    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        console.error(`[Airbnb定位] 爬取失敗: ${err.message}`);
        return res.status(500).json({ success: false, error: err.message });
    }
});

app.listen(port, () => {
    loadData();
});
