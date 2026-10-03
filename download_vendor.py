import urllib.request
import os

files = {
    'css/leaflet.css': 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'js/vendor/leaflet.js': 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'js/vendor/chart.umd.min.js': 'https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js',
    'js/vendor/three.module.js': 'https://unpkg.com/three@0.170.0/build/three.module.js',
    'js/vendor/GLTFLoader.js': 'https://unpkg.com/three@0.170.0/examples/jsm/loaders/GLTFLoader.js'
}

for local_path, url in files.items():
    os.makedirs(os.path.dirname(local_path), exist_ok=True)
    print(f"Downloading {url} to {local_path}...")
    try:
        urllib.request.urlretrieve(url, local_path)
    except Exception as e:
        print(f"Failed to download {url}: {e}")

print("Done downloading vendor files.")
