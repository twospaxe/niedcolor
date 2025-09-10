import express from 'express';
import fetch from 'node-fetch';
import sharp from 'sharp';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import cors from 'cors';

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ------------------------------
// Load stations once at startup
// ------------------------------
const stationRecords = parse(fs.readFileSync('./stationeng.csv', 'utf-8'), {
  skip_empty_lines: true,
  columns: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P']
});

// ------------------------------
// Helpers
// ------------------------------
function getJmaImageUrl() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 - 1000); // JST -1s
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/jma_s/${YYYY}${MM}${DD}/${YYYY}${MM}${DD}${hh}${mm}${ss}.jma_s.gif`;
}

// ------------------------------
// Cache storage
// ------------------------------
let latestStations = [];    // JSON result
let latestImage = null;     // PNG buffer
let lastUpdate = null;

// ------------------------------
// Background updater
// ------------------------------
async function updateCache() {
  try {
    const imageUrl = getJmaImageUrl();
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch JMA image: ${response.statusText}`);
    const gifBuffer = Buffer.from(await response.arrayBuffer());

    // Convert to PNG & raw data
    const pngBuffer = await sharp(gifBuffer).removeAlpha().png().toBuffer();
    const { data, info } = await sharp(pngBuffer).raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    // Build station color data
    const result = stationRecords.map(row => {
      const name = row['F'];
      const lon = parseFloat(row['J']);
      const lat = parseFloat(row['K']);
      const x = Math.round(parseFloat(row['L']) + parseFloat(row['N'] || 0));
      const y = Math.round(parseFloat(row['M']) + parseFloat(row['O'] || 0));

      if (
        isNaN(lat) || isNaN(lon) ||
        isNaN(x) || isNaN(y) ||
        x < 0 || x >= width ||
        y < 0 || y >= height
      ) {
        return null;
      }

      const idx = (y * width + x) * 3;
      return {
        name,
        lat,
        lon,
        x,
        y,
        color: {
          r: data[idx],
          g: data[idx + 1],
          b: data[idx + 2]
        }
      };
    }).filter(Boolean);

    // Store in cache
    latestStations = result;
    latestImage = pngBuffer;
    lastUpdate = new Date();

    console.log(`✅ Cache updated at ${lastUpdate.toISOString()}`);
  } catch (err) {
    console.error('❌ Error updating cache:', err.message);
  }
}

// Run once at startup, then every second
updateCache();
setInterval(updateCache, 1000);

// ------------------------------
// Routes
// ------------------------------
app.get('/stations-color', (req, res) => {
  if (!latestStations.length) {
    return res.status(503).json({ error: 'Cache not ready yet' });
  }
  res.json(latestStations);
});

app.get('/marked-stations', (req, res) => {
  if (!latestImage) {
    return res.status(503).send('Cache not ready yet');
  }
  res.type('png').send(latestImage);
});

// ------------------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
