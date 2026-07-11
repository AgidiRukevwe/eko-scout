import { config } from 'dotenv';
config();

async function run() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=hotels+near+Lawani+Street+Lagos&key=${apiKey}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e);
  }
}
run();
