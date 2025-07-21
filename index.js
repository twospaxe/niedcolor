import express from 'express';
import fetch from 'node-fetch';
import sharp from 'sharp';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const app = express();
const PORT = process.env.PORT || 3000;

// Convert current UTC time to JST (UTC+9)
function getJmaImageUrl() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // JST
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${YYYY}${MM}${DD}${hh}${mm}${ss}`;
  return `http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/jma_s/${YYYY}${MM}${DD}/${timestamp}.jma_s.gif`;
}

app.get('/stations-color', async (req, res) => {
  try {
    const imageUrl = getJmaImageUrl();
    console.log('Fetching image from:', imageUrl);

    // Load and parse CSV
    const csvData = fs.readFileSync('./stations.csv', 'utf-8');
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true
    });

    // Fetch image
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Image not found: ${imageUrl}`);
    const buffer = await response.buffer();
    const image = sharp(buffer);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    // Extract color for each station
    const result = records.map(row => {
      const x = parseInt(row['K']); // pixel X
      const y = parseInt(row['L']); // pixel Y
      const idx = (y * info.width + x) * 3;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      return {
        name: row['E'],              // Station name
        lat: parseFloat(row['J']),  // Latitude
        lon: parseFloat(row['I']),  // Longitude
        color: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      };
    });

    res.json(result);

  } catch (error) {
    console.error(error);
    res.status(500).send('Something went wrong: ' + error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
