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

function getAcMapUrl() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 - 1000); // JST -1s
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/acmap_s/${YYYY}${MM}${DD}/${YYYY}${MM}${DD}${hh}${mm}${ss}.acmap_s.gif`;
}

function toJstString(date) {
  if (!date) return null;
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().replace('T', ' ').replace('Z', ' JST');
}

// ------------------------------
// Cache storage
// ------------------------------
let latestStations = [];    // From jma_s
let latestAcStations = [];  // From acmap_s
let latestImage = null;     // jma_s PNG
let latestAcMap = null;     // acmap_s PNG
let lastUpdate = null;
let lastAcUpdate = null;
let lastImageUrl = null;
let lastAcImageUrl = null;

// ------------------------------
// JMA_S Updater (intensity map)
// ------------------------------
async function updateCache() {
  try {
    const imageUrl = getJmaImageUrl();
    lastImageUrl = imageUrl;
    console.log(`🔄 Fetching jma_s: ${imageUrl}`);

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

      if (isNaN(lat) || isNaN(lon) || isNaN(x) || isNaN(y) || x < 0 || y < 0 || x >= width || y >= height) {
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

    // Store
    latestStations = result;
    latestImage = pngBuffer;
    lastUpdate = new Date();

    console.log(`✅ jma_s cache updated at ${toJstString(lastUpdate)}`);
  } catch (err) {
    console.error('❌ Error updating jma_s:', err.message);
  }
}

// ------------------------------
// AC_MAP Updater (acceleration map)
// ------------------------------
async function updateAcMap() {
  try {
    const imageUrl = getAcMapUrl();
    lastAcImageUrl = imageUrl;
    console.log(`🔄 Fetching acmap_s: ${imageUrl}`);

    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch AC map: ${response.statusText}`);
    const gifBuffer = Buffer.from(await response.arrayBuffer());

    // Convert to PNG & raw data
    const pngBuffer = await sharp(gifBuffer).removeAlpha().png().toBuffer();
    const { data, info } = await sharp(pngBuffer).raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    // Extract colors at station coordinates
    const result = stationRecords.map(row => {
      const name = row['F'];
      const lon = parseFloat(row['J']);
      const lat = parseFloat(row['K']);
      const x = Math.round(parseFloat(row['L']) + parseFloat(row['N'] || 0));
      const y = Math.round(parseFloat(row['M']) + parseFloat(row['O'] || 0));

      if (isNaN(lat) || isNaN(lon) || isNaN(x) || isNaN(y) || x < 0 || y < 0 || x >= width || y >= height) {
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

    // Store
    latestAcStations = result;
    latestAcMap = pngBuffer;
    lastAcUpdate = new Date();

    console.log(`✅ acmap_s cache updated at ${toJstString(lastAcUpdate)}`);
  } catch (err) {
    console.error('❌ Error updating acmap_s:', err.message);
  }
}

// ------------------------------
// Run both updaters every second
// ------------------------------
updateCache();
updateAcMap();
setInterval(updateCache, 1000);
setInterval(updateAcMap, 1000);

// ------------------------------
// Routes
// ------------------------------
app.get('/stations-color', (req, res) => {
  if (!latestStations.length) {
    return res.status(503).json({ error: 'jma_s cache not ready yet' });
  }
  res.json(latestStations);
});

app.get('/acmap-color', (req, res) => {
  if (!latestAcStations.length) {
    return res.status(503).json({ error: 'acmap_s cache not ready yet' });
  }
  res.json(latestAcStations);
});

app.get('/marked-stations', (req, res) => {
  if (!latestImage) {
    return res.status(503).send('jma_s image not ready yet');
  }
  res.type('png').send(latestImage);
});

app.get('/ac_map', (req, res) => {
  if (!latestAcMap) {
    return res.status(503).send('acmap_s image not ready yet');
  }
  res.type('png').send(latestAcMap);
});

// Debug endpoint
app.get('/status', (req, res) => {
  res.json({
    jma_s: {
      lastUpdateUtc: lastUpdate ? lastUpdate.toISOString() : null,
      lastUpdateJst: toJstString(lastUpdate),
      lastImageUrl,
      stationsCached: latestStations.length
    },
    acmap_s: {
      lastUpdateUtc: lastAcUpdate ? lastAcUpdate.toISOString() : null,
      lastUpdateJst: toJstString(lastAcUpdate),
      lastImageUrl: lastAcImageUrl,
      stationsCached: latestAcStations.length
    }
  });
});

// ------------------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
