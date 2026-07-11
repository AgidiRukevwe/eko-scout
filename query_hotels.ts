import { config } from 'dotenv';
config();
import { safeQuery } from './src/lib/db';

async function main() {
  const lat = 6.5143656;
  const lng = 3.3836835;
  const radius = 5000;
  const minLat = lat - (radius / 6371000) * (180 / Math.PI);
  const maxLat = lat + (radius / 6371000) * (180 / Math.PI);
  const minLng = lng - (radius / 6371000) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);
  const maxLng = lng + (radius / 6371000) * (180 / Math.PI) / Math.cos((lat * Math.PI) / 180);

  const q = `
    SELECT category, name, lat, lng 
    FROM osm_pois 
    WHERE lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4
    AND name IS NOT NULL AND name <> '' 
    AND category IN ('amenity', 'sport', 'hotel', 'tourism')
  `;

  const rows = await safeQuery(q, [minLat, maxLat, minLng, maxLng]);
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
