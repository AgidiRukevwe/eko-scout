fetch('http://localhost:3000/api/location/nearby?lat=6.5143656&lng=3.3836835&radius=5000')
  .then(r => r.json())
  .then(j => console.log(JSON.stringify(j, null, 2)))
  .catch(console.error);
