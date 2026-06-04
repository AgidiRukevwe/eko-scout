import requests
from src.core.config import config

def fetch_osm_data(bbox: tuple, element_type: str = "pois"):
    """
    Fetches OSM data for a given bounding box.
    element_type can be 'pois', 'buildings', or 'roads'.
    """
    south, west, north, east = bbox
    bbox_str = f"{south},{west},{north},{east}"
    
    if element_type == "pois":
        query = f"""
        [out:json][timeout:25];
        (
          node["amenity"]({bbox_str});
          way["amenity"]({bbox_str});
        );
        out center;
        """
    elif element_type == "buildings":
        query = f"""
        [out:json][timeout:50];
        (
          way["building"]({bbox_str});
        );
        out center;
        """
    elif element_type == "roads":
        query = f"""
        [out:json][timeout:50];
        (
          way["highway"]({bbox_str});
        );
        out center;
        """
    else:
        raise ValueError("Invalid element_type")
    headers = {
        'User-Agent': 'EkoScout/1.0 (Lagos Intelligence MVP)'
    }
    response = requests.post(config.OVERPASS_URL, data={'data': query}, headers=headers)
    response.raise_for_status()
    return response.json()
