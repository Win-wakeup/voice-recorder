import puppeteer from 'puppeteer'; 
(async () => { 
  const browser = await puppeteer.launch({headless: "new"}); 
  const page = await browser.newPage(); 
  page.on('console', msg => console.log('PAGE LOG:', msg.text())); 
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message)); 
  await page.goto('http://localhost:5173'); 
  await page.waitForSelector('#searchBtn'); 
  console.log("Clicking search...");
  await page.click('#searchBtn'); 
  await new Promise(r => setTimeout(r, 2000));
  console.log("Clicking locate...");
  await page.click('#locateBtn');
  await new Promise(r => setTimeout(r, 2000)); 
  await browser.close(); 
})();
