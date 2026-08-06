const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const inputPath = path.resolve(__dirname, '../public/realtime/XAN1OPSRTS_20262140000_01D_05M_GIM.INX.gz');
const raw = fs.readFileSync(inputPath);
const text = zlib.gunzipSync(raw).toString('ascii');
const lines = text.split(/\r?\n/);

function parseRowHeader(line) {
  const text = line.trim();
  const combined = /^([+-]?\d+\.\d+)([+-]\d+\.\d+)\s+([+-]?\d+\.\d+)\s+([+-]?\d+\.\d+)\s+([+-]?\d+\.\d+)/.exec(text);
  if (combined) {
    return {
      lat: Number(combined[1]),
      lon1: Number(combined[2]),
      lon2: Number(combined[3]),
      dlon: Number(combined[4]),
    };
  }
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length >= 5 && /^([+-]?\d+\.\d+)$/.test(tokens[0]) && /^([+-]?\d+\.\d+)$/.test(tokens[1])) {
    return {
      lat: Number(tokens[0]),
      lon1: Number(tokens[1]),
      lon2: Number(tokens[2]),
      dlon: Number(tokens[3]),
    };
  }
  return null;
}

for (let i = 0; i < 120; i += 1) {
  const line = lines[i];
  const rowHeader = parseRowHeader(line);
  console.log(i + 1, JSON.stringify(line), rowHeader ? `HEADER ${JSON.stringify(rowHeader)}` : 'NOTHEADER');
}
