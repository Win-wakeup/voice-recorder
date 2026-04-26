import axios from 'axios';
import * as cheerio from 'cheerio';

async function testBookingScrape() {
    const hotelName = "圓山大飯店";
    console.log(`Searching Booking.com for: ${hotelName}`);
    try {
        const { data } = await axios.get(`https://www.booking.com/searchresults.zh-tw.html?ss=${encodeURIComponent(hotelName)}&group_adults=1`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            timeout: 8000
        });
        const $ = cheerio.load(data);
        const text = $('body').text();
        console.log("Response text length:", text.length);
        if (text.includes('booking.com') && text.includes('captcha')) {
            console.log("Blocked by Booking.com captcha/bot protection.");
        } else {
            console.log("Successfully fetched Booking.com!");
        }

        // Just output a small snippet to see what we got
        console.log(text.substring(0, 500).replace(/\s+/g, ' '));
        
    } catch (err) {
        console.error("Error:", err.message);
    }
}

testBookingScrape();
