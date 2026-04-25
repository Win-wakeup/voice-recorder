import json
import os
import random
from datetime import datetime
from pathlib import Path

def get_fallback_address(name):
    # 簡單的地區分配邏輯增加真實感
    if "信義" in name or "101" in name or "象山" in name:
        return "台北市信義區信義路"
    elif "西門" in name or "紅樓" in name or "剝皮寮" in name or "龍山寺" in name:
        return "台北市萬華區成都路"
    elif "士林" in name or "故宮" in name or "官邸" in name:
        return "台北市士林區基河路"
    elif "陽明山" in name or "北投" in name or "地熱谷" in name:
        return "台北市北投區中山路"
    elif "淡水" in name or "漁人" in name or "紅毛城" in name:
        return "新北市淡水區中正路"
    elif "九份" in name or "黃金" in name:
        return "新北市瑞芳區基山街"
    elif "迪化" in name or "大稻埕" in name or "寧夏" in name:
        return "台北市大同區民生西路"
    elif "華山" in name or "中正" in name or "植物園" in name:
        return "台北市中正區八德路"
    elif "松山" in name or "饒河" in name:
        return "台北市松山區八德路"
    elif "野柳" in name:
        return "新北市萬里區港東路"
    elif "烏來" in name:
        return "新北市烏來區瀑布路"
    
    # 隨機分配其他市區
    districts = [
        "台北市大安區和平東路", "台北市中山區南京東路", 
        "新北市板橋區縣民大道", "台北市南港區忠孝東路"
    ]
    return random.choice(districts)

def is_currently_open(time_range):
    if time_range == "00:00-24:00": return True
    try:
        start_str, end_str = time_range.split("-")
        sh, sm = map(int, start_str.split(":"))
        eh, em = map(int, end_str.split(":"))
        
        now = datetime.now()
        current_minutes = now.hour * 60 + now.minute
        start_min = sh * 60 + sm
        end_min = eh * 60 + em
        
        if end_min < start_min: # 跨夜營業 (ex: 17:00-01:00)
            return current_minutes >= start_min or current_minutes <= end_min
        else: # 一般營業
            return start_min <= current_minutes <= end_min
    except Exception:
        return True # 解析失敗默認開放

def run_scraper():
    print("🚀 Starting Extended 100+ POIs Mock Generator (With Live Hours)...")
    
    transport_methods_pool = [
        "距離捷運站走路 5 分鐘",
        "建議搭乘公車前往，班次密集",
        "附近很難停車，搭乘大眾運輸較佳",
        "搭捷運到達後可轉乘 YouBike",
        "出捷運站即抵達，交通非常便利"
    ]

    links = [
        "https://www.dcard.tw/f/travel",
        "https://www.ptt.cc/bbs/Taipei",
        "https://www.ptt.cc/bbs/Food",
        "https://www.instagram.com/explore/tags/taipei",
    ]
    
    mock_file = Path(__file__).parent / "api" / "taipei_dict.json"
    
    if not mock_file.exists():
        print("❌ Dict file not found!")
        return

    with open(mock_file, "r", encoding="utf-8") as f:
        taipei_dict = json.load(f)

    scraped_data = []

    for item in taipei_dict:
        name = item.get("name", "")
        tags = item.get("tags", [])
        open_hours = item.get("open_hours", "00:00-24:00")
        
        # 依照標籤決定天氣
        if "🖼️ 室內展覽" in tags or "🛍️ 商圈購物" in tags or "🎳 室內娛樂" in tags or "🍜 在地美食" in tags:
            weather = "雨天皆可"
        elif "🌲 自然戶外" in tags or "⛩️ 歷史古蹟" in tags:
            weather = "晴天"
        else:
            weather = random.choice(["晴天", "陰天或涼爽天氣", "雨天皆可"])
            
        address = get_fallback_address(name)
        title = f"{name} ({address})"
        
        scraped_data.append({
            "source": "Mock_Integration_100",
            "title": title,
            "link": random.choice(links),
            "transport_suggestion": random.choice(transport_methods_pool),
            "suitable_weather": weather,
            "tags": tags,
            "open_hours": open_hours,               # 新增：營業時間字串
            "is_open_now": is_currently_open(open_hours) # 新增：當下是否營業的布林值
        })

    save_path = os.path.join("api", "social_sentiment_mock.json")
    os.makedirs("api", exist_ok=True)
    
    with open(save_path, "w", encoding="utf-8") as f:
        json.dump({
            "updated_at": datetime.now().isoformat(),
            "trending_topics": scraped_data
        }, f, ensure_ascii=False, indent=2)

    print(f"✅ Successfully exported live time POI trends to {save_path}!")

if __name__ == "__main__":
    run_scraper()
