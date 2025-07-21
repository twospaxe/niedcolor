
import express from 'express';
import fetch from 'node-fetch';
import sharp from 'sharp';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/stations-color', async (req, res) => {
  try {
    // Load and parse CSV
    const csvData = fs.readFileSync('./stations.csv', 'utf-8');
    const records = parse(csvData, {
      columns: true,
      skip_empty_lines: true
    });

    // Download JMA image
    const imageUrl = 'http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/jma_s/20250721/20250721202158.jma_s.gif';
    const response = await fetch(imageUrl);
    const buffer = await response.buffer();
    const image = sharp(buffer);
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    // Process each station
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
    res.status(500).send('Something went wrong');
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
