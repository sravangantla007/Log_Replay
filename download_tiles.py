import math
import os
import urllib.request
import time

def deg2num(lat_deg, lon_deg, zoom):
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return (xtile, ytile)

def download_tiles(min_lat, max_lat, min_lon, max_lon, min_zoom, max_zoom):
    total = 0
    downloaded = 0
    for z in range(min_zoom, max_zoom + 1):
        x1, y1 = deg2num(max_lat, min_lon, z)
        x2, y2 = deg2num(min_lat, max_lon, z)
        
        # Adjust for crossing the antimeridian if necessary
        x_start = min(x1, x2)
        x_end = max(x1, x2)
        y_start = min(y1, y2)
        y_end = max(y1, y2)
        
        total += (x_end - x_start + 1) * (y_end - y_start + 1)

    print(f"Total tiles to download: {total}")
    
    for z in range(min_zoom, max_zoom + 1):
        x1, y1 = deg2num(max_lat, min_lon, z)
        x2, y2 = deg2num(min_lat, max_lon, z)
        
        x_start, x_end = min(x1, x2), max(x1, x2)
        y_start, y_end = min(y1, y2), max(y1, y2)
        
        for x in range(x_start, x_end + 1):
            for y in range(y_start, y_end + 1):
                url = f"https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"
                local_dir = f"tiles/{z}/{x}"
                local_path = f"{local_dir}/{y}.png"
                
                os.makedirs(local_dir, exist_ok=True)
                
                if not os.path.exists(local_path):
                    try:
                        req = urllib.request.Request(url, headers={'User-Agent': 'FlightReplayApp/1.0'})
                        with urllib.request.urlopen(req) as response, open(local_path, 'wb') as out_file:
                            out_file.write(response.read())
                        downloaded += 1
                        print(f"Downloaded {local_path} ({downloaded}/{total})")
                        time.sleep(0.1) # Be polite to OSM servers
                    except Exception as e:
                        print(f"Failed {url}: {e}")
                else:
                    downloaded += 1
                    
    print(f"Finished downloading {downloaded} tiles.")

if __name__ == "__main__":
    print("Map Tile Downloader for Offline Use")
    print("-----------------------------------")
    try:
        lat = float(input("Enter central Latitude (e.g. 34.05): "))
        lon = float(input("Enter central Longitude (e.g. -118.25): "))
        radius_km = float(input("Enter radius in km (e.g. 2): "))
        
        # Rough approximation: 1 degree latitude is ~111 km
        lat_diff = radius_km / 111.0
        lon_diff = radius_km / (111.0 * math.cos(math.radians(lat)))
        
        min_lat = lat - lat_diff
        max_lat = lat + lat_diff
        min_lon = lon - lon_diff
        max_lon = lon + lon_diff
        
        print(f"\nBounding Box: [{min_lat:.5f}, {min_lon:.5f}] to [{max_lat:.5f}, {max_lon:.5f}]")
        
        download_tiles(min_lat, max_lat, min_lon, max_lon, min_zoom=10, max_zoom=17)
    except ValueError:
        print("Invalid input. Please enter numbers.")
