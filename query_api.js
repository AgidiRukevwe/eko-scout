fetch('http://localhost:3000/api/admin/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: "SELECT name, count(*) FROM osm_pois GROUP BY name ORDER BY count(*) DESC LIMIT 20" })
}).then(r => r.json()).then(j => console.log(JSON.stringify(j, null, 2))).catch(console.error);
