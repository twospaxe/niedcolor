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
const stationRecords = parse(fs.readFileSync('./stationseng1.csv', 'utf-8'), {
  skip_empty_lines: true,
  columns: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P']
});
const stationDatabase = stationRecords
    .map(row => {
        const lon = parseFloat(row['J']);
        const lat = parseFloat(row['K']);
        const x = Math.round(parseFloat(row['L']));
        const y = Math.round(parseFloat(row['M']));

        if (
            isNaN(lat) ||
            isNaN(lon) ||
            isNaN(x) ||
            isNaN(y)
        ) return null;

        return {
            code: row['A'],
            name: row['F'],
            lat,
            lon,
            x,
            y
        };
    })
    .filter(Boolean);
// ------------------------------
// Helpers
// ------------------------------
function toJstString(date) {
  if (!date) return null;
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().replace('T', ' ').replace('Z', ' JST');
}

function getJmaImageUrl(offsetMs = 0) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetMs);
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/jma_s/${YYYY}${MM}${DD}/${YYYY}${MM}${DD}${hh}${mm}${ss}.jma_s.gif`;
}

function getAcMapUrl(offsetMs = 0) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetMs);
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/acmap_s/${YYYY}${MM}${DD}/${YYYY}${MM}${DD}${hh}${mm}${ss}.acmap_s.gif`;
}

// ------------------------------
// Smart fallback fetcher
// ------------------------------
async function fetchWithFallback(primaryUrl, fallbackUrl) {
  const primary = await fetch(primaryUrl);
  if (primary.ok) return primary;

  console.warn(`⚠️ Primary not ready (${primary.status}) → trying fallback...`);
  const fallback = await fetch(fallbackUrl);
  if (fallback.ok) return fallback;

  throw new Error(`Failed to fetch both primary and fallback: ${primaryUrl}`);
}

// ------------------------------
// Cache storage
// ------------------------------
let latestStations = [];
let changedStations = [];
let previousColors = new Map();
let latestImage = null;
let lastUpdate = null;
let lastImageUrl = null;
let updateVersion = 0;
let latestAcStations = [];
let latestAcImage = null;
let lastAcUpdate = null;
let lastAcImageUrl = null;

// ------------------------------
// Shared station reader
// ------------------------------
async function extractStationColors(buffer) {
  const pngBuffer = await sharp(buffer).removeAlpha().png().toBuffer();
  const { data, info } = await sharp(pngBuffer).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  return stationRecords.map(row => {
    const code = row['A'];
    const name = row['F'];
    const lon = parseFloat(row['J']);
    const lat = parseFloat(row['K']);
    const x = Math.round(parseFloat(row['L']));
    const y = Math.round(parseFloat(row['M']));

    if (
      isNaN(lat) || isNaN(lon) ||
      isNaN(x) || isNaN(y) ||
      x < 0 || x >= width ||
      y < 0 || y >= height
    ) return null;

    const idx = (y * width + x) * 3;
    const r = data[idx];
const g = data[idx + 1];
const b = data[idx + 2];

if (r === 0 && g === 0 && b === 0) {
    return null;
}
   return [
    code,
    data[idx],
    data[idx + 1],
    data[idx + 2]
];
  }).filter(Boolean);
}

// ------------------------------
// Updaters
// ------------------------------
async function updateJmaCache() {
  try {
    const imageUrl = getJmaImageUrl();
    const fallbackUrl = getJmaImageUrl(-1000);
    lastImageUrl = imageUrl;

    console.log(`🔄 Fetching jma_s: ${imageUrl}`);
    const response = await fetchWithFallback(imageUrl, fallbackUrl);
    const gifBuffer = Buffer.from(await response.arrayBuffer());

    latestImage = await sharp(gifBuffer).removeAlpha().png().toBuffer();
    latestStations = await extractStationColors(gifBuffer);
    changedStations = [];



for (const station of latestStations) {

    const code = station[0];
    const r = station[1];
    const g = station[2];
    const b = station[3];

    const old = previousColors.get(code);

    if (
        !old ||
        old.r !== r ||
        old.g !== g ||
        old.b !== b
    ) {

        previousColors.set(code, { r, g, b });

        changedStations.push(station);
    }
}
    lastUpdate = new Date();
  if (changedStations.length > 0) {
    updateVersion++;
}
    console.log(`✅ jma_s cache updated at ${toJstString(lastUpdate)}`);
  } catch (err) {
    console.error('❌ Error updating jma_s:', err.message);
  }

}

async function updateAcMapCache() {
  try {
    const imageUrl = getAcMapUrl();
    const fallbackUrl = getAcMapUrl(-1000);
    lastAcImageUrl = imageUrl;

    console.log(`🔄 Fetching acmap_s: ${imageUrl}`);
    const response = await fetchWithFallback(imageUrl, fallbackUrl);
    const gifBuffer = Buffer.from(await response.arrayBuffer());

    latestAcImage = await sharp(gifBuffer).removeAlpha().png().toBuffer();
    latestAcStations = await extractStationColors(gifBuffer);
    lastAcUpdate = new Date();

    console.log(`✅ acmap_s cache updated at ${toJstString(lastAcUpdate)}`);
  } catch (err) {
    console.error('❌ Error updating acmap_s:', err.message);
  }
}

// ------------------------------
// Run every second
// ------------------------------
updateJmaCache();
updateAcMapCache();
setInterval(updateJmaCache, 1000);
setInterval(updateAcMapCache, 1000);

// ------------------------------
// Routes
// ------------------------------
app.get('/stations-color', (req, res) => {
 if (!lastUpdate) {
    return res.status(503).json({ error: "Cache not ready yet" });
}
 
res.json({
    version: updateVersion,
    stations: changedStations
});
});

app.get('/acmap-color', (req, res) => {
  if (!latestAcStations.length) {
    return res.status(503).json({ error: 'AC cache not ready yet' });
  }
  res.json(latestAcStations);
});
app.get("/stations", (req, res) => {

    if (!latestStations.length) {
        return res.status(503).json({ error: "Cache not ready yet" });
    }

    // Create a fast lookup: code -> [code, r, g, b]
    const colorMap = new Map(
        latestStations.map(s => [s[0], s])
    );

    const stations = stationDatabase.map(station => {

        const color = colorMap.get(station.code);

        return [
            station.code,
            station.name,
            station.lat,
            station.lon,
            station.x,
            station.y,
            color ? color[1] : 0,
            color ? color[2] : 0,
            color ? color[3] : 0
        ];

    });

    res.json(stations);

});
app.get('/marked-stations', (req, res) => {
  if (!latestImage) {
    return res.status(503).send('Cache not ready yet');
  }
  res.type('png').send(latestImage);
});

app.get('/marked-acmap', (req, res) => {
  if (!latestAcImage) {
    return res.status(503).send('AC cache not ready yet');
  }
  res.type('png').send(latestAcImage);
});

app.get('/status', (req, res) => {
  res.json({
    jma: {
      lastUpdateUtc: lastUpdate ? lastUpdate.toISOString() : null,
      lastUpdateJst: toJstString(lastUpdate),
      lastImageUrl,
      stationsCached: latestStations.length
    },
    acmap: {
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


app.use(express.json()); // Ensure JSON parsing for this route


