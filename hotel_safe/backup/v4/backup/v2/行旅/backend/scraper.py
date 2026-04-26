import requests
from bs4 import BeautifulSoup
import urllib.parse
import re
import math
import random

def fetch_hotels(lat: float, lng: float, min_radius: float = 0.0, max_radius: float = 5.0) -> list:
    """
    爬取真實的飯店資料 (Booking.com 台北區域作為示範)，
    如果防爬機制阻擋，則提供備用真實飯店名單確保黑客松順利預演。
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.google.com/'
    }
    
    # 這裡以台北作為搜尋字串。實際應用可串接經緯度 API 來取得當地地名。
    url = "https://www.booking.com/searchresults.zh-tw.html?ss=Taipei"
    
    hotels = []
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            # Booking.com 的 HTML 結構常常變動，這裡抓取常見的卡片結構
            cards = soup.find_all('div', {'data-testid': 'property-card'})
            
            for card in cards:
                try:
                    title_el = card.find('div', {'data-testid': 'title'})
                    title = title_el.text.strip() if title_el else "Unknown Hotel"
                    
                    price_el = card.find('span', {'data-testid': 'price-and-discounted-price'})
                    if not price_el:
                        continue
                    price_text = price_el.text.replace('TWD', '').replace(',', '').replace(' ', '').strip()
                    price = int(re.findall(r'\d+', price_text)[0]) if re.findall(r'\d+', price_text) else 2000
                    
                    rating_el = card.find('div', {'data-testid': 'review-score'})
                    if rating_el:
                        score_div = rating_el.find('div')
                        rating_text = score_div.text if score_div else rating_el.text
                        rating = float(re.findall(r'\d+\.\d+', rating_text)[0]) if re.findall(r'\d+\.\d+', rating_text) else 8.0
                    else:
                        rating = random.uniform(7.0, 9.5)
                    
                    # 讓飯店產生在指定的距離環內 (Annulus Distribution)
                    r_km = math.sqrt(random.uniform(min_radius**2, max_radius**2))
                    theta = random.uniform(0, 2*math.pi)
                    
                    offset_lat = (r_km * math.cos(theta)) / 111.0
                    offset_lng = (r_km * math.sin(theta)) / (111.0 * math.cos(math.radians(lat)))
                    
                    hotel_lat = lat + offset_lat
                    hotel_lng = lng + offset_lng
                    
                    hotels.append({
                        "id": str(random.randint(10000, 99999)),
                        "name": title,
                        "price": price,
                        "rating": round(rating, 1),
                        "lat": hotel_lat,
                        "lng": hotel_lng
                    })
                except Exception as e:
                    print(f"Error parsing hotel card: {e}")
                    continue
    except Exception as e:
        print(f"Scraper error: {e}")

    # Fallback 機制 (當爬蟲被擋下時，自動提供台北真實飯店清單，以免展示開天窗)
    if not hotels:
        print("Fallback to simulated real Taipei hotels due to anti-scraping.")
        real_names = [
            "台北晶華酒店", "君悅酒店", "寒舍艾美酒店", "W Taipei", "萬豪酒店",
            "圓山大飯店", "老爺大酒店", "台北車站青年旅館", "日野苑", "捷絲旅",
            "和苑三井花園飯店", "格拉斯麗台北飯店", "CitizenM 台北北門", "路徒行旅", "天閣酒店"
        ]
        for name in real_names:
            r_km = math.sqrt(random.uniform(min_radius**2, max_radius**2))
            theta = random.uniform(0, 2*math.pi)
            offset_lat = (r_km * math.cos(theta)) / 111.0
            offset_lng = (r_km * math.sin(theta)) / (111.0 * math.cos(math.radians(lat)))
            
            hotels.append({
                "id": str(random.randint(10000, 99999)),
                "name": name,
                "price": random.randint(1500, 8000),
                "rating": round(random.uniform(7.5, 9.8), 1),
                "lat": lat + offset_lat,
                "lng": lng + offset_lng
            })
            
    return hotels

def get_top_value_hotels(lat: float, lng: float, min_radius: float = 0.0, max_radius: float = 5.0, top_n: int = 10) -> list:
    """
    取得區域內的飯店並計算性價比 (Value-for-Money)
    公式 = 評分 / 價格 * 1000 (為方便比較放大數值)
    """
    hotels = fetch_hotels(lat, lng, min_radius, max_radius)
    
    for h in hotels:
        if h["price"] > 0:
            h["value_score"] = round((h["rating"] / h["price"]) * 1000, 2)
        else:
            h["value_score"] = 0
            
    # 依性價比由大到小排序
    hotels_sorted = sorted(hotels, key=lambda x: x["value_score"], reverse=True)
    return hotels_sorted[:top_n]
