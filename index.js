app.get('/stations-color', async (req, res) => {
  try {
    // Load and parse the CSV
    const csvData = fs.readFileSync('./stations.csv', 'utf-8');
    const records = parse(csvData, {
      skip_empty_lines: true,
      columns: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O']
    });

    // Get real-time JMA image URL
    const imageUrl = getJmaImageUrl();
    console.log(`Fetching image: ${imageUrl}`);

    // Download and decode the image
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    const buffer = await response.buffer();
    const image = sharp(buffer);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;

    // Process each station
    const result = records.map(row => {
      const name = row['E'];
      const lon = parseFloat(row['I']);
      const lat = parseFloat(row['J']);
      const x = parseInt(row['K']);
      const y = parseInt(row['L']);

      if (
        isNaN(lat) || isNaN(lon) ||
        isNaN(x) || isNaN(y) ||
        x < 0 || x >= width ||
        y < 0 || y >= height
      ) {
        console.warn(`Skipping station "${name}" — invalid data (x=${x}, y=${y}, lat=${lat}, lon=${lon})`);
        return null;
      }

      const idx = (y * width + x) * 3;
      if (idx + 2 >= data.length) {
        console.warn(`Skipping station "${name}" — pixel index out of bounds`);
        return null;
      }

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      return {
        name,
        lat,
        lon,
        x,
        y,
        color: { r, g, b }
      };
    }).filter(Boolean); // Remove any null entries

    res.json(result);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Something went wrong: ' + error.message);
  }
});
