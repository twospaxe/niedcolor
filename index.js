import express from 'express';
import fetch from 'node-fetch';
import sharp from 'sharp';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const app = express();
const PORT = process.env.PORT || 3000;

// Convert UTC to JST and build image URL
function getJmaImageUrl() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 - 2000); // UTC+9 minus ~2s
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${YYYY}${MM}${DD}${hh}${mm}${ss}`;
  return `http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/jma_s/${YYYY}${MM}${DD}/${timestamp}.jma_s.gif`;
}

// Load and parse CSV once (assumes static station list)
const csvData = fs.readFileSync('./stations.csv', 'utf-8');
const records = parse(csvData, {
  skip_empty_lines: true,
  columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O']
});

app.get('/stations-color', async (req, res) => {
  try {
    const imageUrl = getJmaImageUrl();
    console.log(`Fetching image: ${imageUrl}`);
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    const gifBuffer = Buffer.from(await response.arrayBuffer());

    // Convert GIF to flat PNG (RGB)
    const pngBuffer = await sharp(gifBuffer)
      .ensureAlpha()
      .removeAlpha()
      .png()
      .toBuffer();

    // Save debug PNG
    await sharp(pngBuffer).toFile('/tmp/debug-output.png');

    // Get raw RGB data
    const { data, info } = await sharp(pngBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Log all unique colors
    const colorSet = new Set();
    for (let i = 0; i < data.length; i += 3) {
      colorSet.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    console.log('Unique colors in image:', [...colorSet]);

    const width = info.width;
    const height = info.height;

    // Clone buffer to mark station pixels
    const stationOverlay = Buffer.from(data);

    // Process stations
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

      // Overlay red dot
      stationOverlay[idx + 0] = 255; // R
      stationOverlay[idx + 1] = 0;   // G
      stationOverlay[idx + 2] = 0;   // B

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

    // Save marked image
    await sharp(stationOverlay, {
      raw: {
        width,
        height,
        channels: 3
      }
    }).png().toFile('/tmp/marked-stations.png');

    res.json(result);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Something went wrong: ' + error.message);
  }
});

// Expose debug image
app.get('/debug-image', (req, res) => {
  res.sendFile('/tmp/debug-output.png');
});

// Expose overlay-marked image
app.get('/marked-stations', (req, res) => {
  res.sendFile('/tmp/marked-stations.png');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
