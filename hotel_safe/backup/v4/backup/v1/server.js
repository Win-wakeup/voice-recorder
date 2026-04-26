import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as cheerio from 'cheerio';

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
            return res.json({
                isFuzzy: false,
                isExternal: true,
                isUrlSearch: true,
                scrapedTitle,
                results: [{
                    Name: scrapedTitle || '未知網頁',
                    Town: '未合法登記',
                    Add: originalQuery,
                    Spec: '警告：您輸入的網址住宿，經系統比對不在觀光署合法登記名單中！',
                    Serviceinfo: '這可能是非法日租套房或未立案旅宿，請特別留意住宿安全。',
                    Website: originalQuery,
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

app.listen(port, () => {
    loadData();
});
