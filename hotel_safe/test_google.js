import axios from 'axios';
import * as cheerio from 'cheerio';

async function testGoogleScrape() {
    const hotelName = "圓山大飯店";
    console.log(`Searching Google for: ${hotelName}`);
    try {
        const { data } = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(hotelName + ' 單人 一晚 住宿 價格 NT$')}`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 5000
        });
        const $ = cheerio.load(data);
        const text = $('body').text();
        console.log("Response text length:", text.length);
        if (text.includes('Our systems have detected unusual traffic')) {
            console.log("Blocked by Google captcha");
        }
        const regex = /(?:NT\$|TWD|\$|台幣|一晚(?:約|只要)?)\s*([0-9,]{3,})/gi;
        
        let m;
        let minPrice = Infinity;
        while ((m = regex.exec(text)) !== null) {
            const p = parseInt(m[1].replace(/,/g, ''));
            if (p >= 500 && p <= 30000) {
                if (p < minPrice) minPrice = p;
                console.log("Found price:", p);
            }
        }
        console.log("Lowest price:", minPrice !== Infinity ? minPrice : "Not found");
    } catch (err) {
        console.error("Error:", err.message);
    }
}

testGoogleScrape();
