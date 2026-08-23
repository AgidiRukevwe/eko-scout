import requests
import json

query_no_area = """
[out:json][timeout:90];
(
  nwr["amenity"](6.35, 3.05, 6.70, 3.75);
  nwr["shop"](6.35, 3.05, 6.70, 3.75);
  nwr["office"](6.35, 3.05, 6.70, 3.75);
  nwr["leisure"](6.35, 3.05, 6.70, 3.75);
  nwr["healthcare"](6.35, 3.05, 6.70, 3.75);
);
out count;
"""

query_with_area = """
[out:json][timeout:90];
area["name"="Lagos"]->.searchArea;
(
  nwr["amenity"](area.searchArea)(6.35, 3.05, 6.70, 3.75);
  nwr["shop"](area.searchArea)(6.35, 3.05, 6.70, 3.75);
  nwr["office"](area.searchArea)(6.35, 3.05, 6.70, 3.75);
  nwr["leisure"](area.searchArea)(6.35, 3.05, 6.70, 3.75);
  nwr["healthcare"](area.searchArea)(6.35, 3.05, 6.70, 3.75);
);
out count;
"""

try:
    resp = requests.post(
        'https://overpass-api.de/api/interpreter', 
        data=query_no_area.encode('utf-8'),
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'eko-scout-app/1.0',
        }
    )
    print('Status (No Area):', resp.status_code)
    data = resp.json()
    print('Total elements without area filter:', data.get('elements', []))
except Exception as e:
    print('Error:', e)
    
try:
    resp = requests.post(
        'https://overpass-api.de/api/interpreter', 
        data=query_with_area.encode('utf-8'),
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'eko-scout-app/1.0',
        }
    )
    print('Status (With Area):', resp.status_code)
    data = resp.json()
    print('Total elements with "Lagos" area filter:', data.get('elements', []))
except Exception as e:
    print('Error:', e)
