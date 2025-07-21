import express from 'express';
import fetch from 'node-fetch';
import sharp from 'sharp';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const app = express();
const PORT = process.env.PORT || 3000;

function getJmaImageUrl() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 - 2000); // JST
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
    const csvData = fs.readFileSync('./stations.csv', 'utf-8');
    const records = parse(csvData, {
      skip_empty_lines: true,
      columns: ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O']
    });

    const imageUrl = getJmaImageUrl();
    console.log(`Fetching image: ${imageUrl}`);
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    const gifBuffer = Buffer.from(await response.arrayBuffer());

    // Decode and convert the image to RGB
    const pngBuffer = await sharp(gifBuffer)
      .removeAlpha()
      .png()
      .toBuffer();

    const { data, info } = await sharp(pngBuffer)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const width = info.width;
    const height = info.height;

    // ✅ Generate station overlay
    const overlay = Buffer.alloc(width * height * 4, 0); // RGBA transparent
    for (const row of records) {
      const x = parseInt(row['K']);
      const y = parseInt(row['L']);
      if (
        !isNaN(x) && !isNaN(y) &&
        x >= 0 && x < width &&
        y >= 0 && y < height
      ) {
        const idx = (y * width + x) * 4;
        overlay[idx] = 255;     // R
        overlay[idx + 1] = 0;   // G
        overlay[idx + 2] = 0;   // B
        overlay[idx + 3] = 255; // A (fully opaque red pixel)
      }
    }

    const markedImage = await sharp(pngBuffer)
      .composite([{ input: overlay, raw: { width, height, channels: 4 }, blend: 'over' }])
      .png()
      .toFile('/tmp/marked-stations.png');

    // ✨ Log unique colors in the base image
    const colorSet = new Set();
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      colorSet.add(`${r},${g},${b}`);
    }
    console.log('Unique colors in image:', [...colorSet]);

    // Build station color data
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
        console.warn(`Skipping station "${name}" — invalid data`);
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

    res.json(result);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Something went wrong: ' + error.message);
  }
});

// Serve debug image
app.get('/marked-stations', (req, res) => {
  res.sendFile('/tmp/marked-stations.png');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
