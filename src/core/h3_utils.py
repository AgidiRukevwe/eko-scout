"""
H3 Spatial Grid Utilities
-------------------------
Helper functions for mapping geographic coordinates (latitude, longitude) to H3 hexagon indexes.
It supports automatic version detection for the `h3-py` library to handle API differences between v3 and v4.
"""

import h3

def enrich_with_h3(lat: float, lng: float) -> dict:
    """
    Converts latitude and longitude to H3 indexes at Resolution 10 and 9.
    R10 -> Precise placement
    R9 -> Neighborhood aggregation
    """
    try:
        # Note: h3-py v4 syntax is latlng_to_cell
        return {
            "h3_r10": h3.latlng_to_cell(lat, lng, 10),
            "h3_r9": h3.latlng_to_cell(lat, lng, 9)
        }
    except AttributeError:
        # Fallback for older h3 versions
        return {
            "h3_r10": h3.geo_to_h3(lat, lng, 10),
            "h3_r9": h3.geo_to_h3(lat, lng, 9)
        }
