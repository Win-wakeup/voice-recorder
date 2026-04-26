import axios from 'axios';
import * as cheerio from 'cheerio';

axios.get('https://www.airbnb.com.tw/rooms/1186931556931883767', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0' }
}).then(res => {
    const $ = cheerio.load(res.data);
    console.log('Title:', $('title').text());
    console.log('OG Price:', $('meta[property="og:price:amount"]').attr('content'));
    console.log('Meta Desc:', $('meta[name="description"]').attr('content'));
    console.log('Price Class:', $('._1jo4hgw').text() || $('._tyxjp1').text() || $('._1y74zjx').text());
}).catch(err => console.error(err.message));
