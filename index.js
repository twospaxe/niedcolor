import express from 'express';
import fetch from 'node-fetch';
import sharp from 'sharp';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const app = express();
const PORT = process.env.PORT || 3000;

// Convert current UTC time to JST and build JMA image URL
function getJmaImageUrl() {
  // JST time, minus 2 seconds
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 - 2000); // UTC +9, minus 2s
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
        color: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
      };
    }).filter(Boolean); // Remove any null entries

    res.json(result);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Something went wrong: ' + error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
