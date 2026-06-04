import json
from src.core.h3_utils import enrich_with_h3

def normalize_poi(element: dict) -> dict:
    tags = element.get('tags', {})
    lat = element.get('lat') or element.get('center', {}).get('lat')
    lng = element.get('lon') or element.get('center', {}).get('lon')
    
    if lat is None or lng is None:
        return None
        
    h3_indexes = enrich_with_h3(lat, lng)
    
    return {
        "id": element['id'],
        "name": tags.get('name', 'Unknown'),
        "category": tags.get('amenity', 'other'),
        "subcategory": tags.get('shop', 'none'),
        "lat": lat,
        "lng": lng,
        "h3_r10": h3_indexes['h3_r10'],
        "h3_r9": h3_indexes['h3_r9'],
        "tags_json": json.dumps(tags)
    }

def normalize_building(element: dict) -> dict:
    tags = element.get('tags', {})
    lat = element.get('lat') or element.get('center', {}).get('lat')
    lng = element.get('lon') or element.get('center', {}).get('lon')
    
    if lat is None or lng is None:
        return None
        
    h3_indexes = enrich_with_h3(lat, lng)
    
    # Simple building classification
    b_type = tags.get('building', 'yes')
    if b_type in ['apartments', 'house', 'residential']:
        b_type = 'residential'
    elif b_type in ['commercial', 'retail', 'office']:
        b_type = 'commercial'
        
    return {
        "id": element['id'],
        "building_type": b_type,
        "lat": lat,
        "lng": lng,
        "area": 0.0, # Could be calculated roughly if needed
        "h3_r10": h3_indexes['h3_r10'],
        "h3_r9": h3_indexes['h3_r9']
    }

def normalize_road(element: dict) -> dict:
    tags = element.get('tags', {})
    lat = element.get('lat') or element.get('center', {}).get('lat')
    lng = element.get('lon') or element.get('center', {}).get('lon')
    
    if lat is None or lng is None:
        return None
        
    h3_indexes = enrich_with_h3(lat, lng)
    
    return {
        "id": element['id'],
        "road_type": tags.get('highway', 'unknown'),
        "name": tags.get('name', 'Unknown'),
        "length": 0.0, # Not precise without polygon, but fine for MVP
        "lat": lat,
        "lng": lng,
        "h3_r10": h3_indexes['h3_r10'],
        "h3_r9": h3_indexes['h3_r9']
    }
