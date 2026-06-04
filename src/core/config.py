import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/ekoscout")
    OVERPASS_URL = "http://overpass-api.de/api/interpreter"
    
    # Target bounding boxes for Yaba, Ikeja, Gbagada, Lekki/VI (approximate)
    # Format: (south, west, north, east)
    TARGET_BBOXES = {
        "Yaba": (6.49, 3.36, 6.53, 3.40),
        "Ikeja": (6.58, 3.32, 6.63, 3.37),
        "Gbagada": (6.54, 3.37, 6.57, 3.40),
        "Lekki": (6.42, 3.43, 6.47, 3.55)
    }

config = Config()
