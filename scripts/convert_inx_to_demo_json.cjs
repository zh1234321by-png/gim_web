const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const inputPath = path.resolve(__dirname, '../public/realtime/XAN1OPSRTS_20262140000_01D_05M_GIM.INX.gz');
const outputPath = path.resolve(__dirname, '../public/realtime/demo.json');

const raw = fs.readFileSync(inputPath);
const text = zlib.gunzipSync(raw).toString('ascii');
const lines = text.split(/\r?\n/);

let scale = 1.0;
let lat1 = null;
let lat2 = null;
let dlat = null;
let lon1 = null;
let lon2 = null;
let dlon = null;
let nMaps = null;

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (line.includes('END OF HEADER')) {
    break;
  }
  if (line.includes('# OF MAPS IN FILE')) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    nMaps = Number(tokens[0]);
  }
  if (line.includes('LAT1 / LAT2 / DLAT')) {
    const tokens = line.slice(0, 40).trim().split(/\s+/).filter(Boolean);
    [lat1, lat2, dlat] = tokens.map(Number);
  }
  if (line.includes('LON1 / LON2 / DLON')) {
    const tokens = line.slice(0, 40).trim().split(/\s+/).filter(Boolean);
    [lon1, lon2, dlon] = tokens.map(Number);
  }
  if (/0\.1\s*TECU/i.test(line)) {
    scale = 0.1;
  }
}

if ([lat1, lat2, dlat, lon1, lon2, dlon].some((value) => value === null || Number.isNaN(value))) {
  throw new Error('Unable to parse grid definition from IONEX header.');
}

function range(start, end, step) {
  const values = [];
  let current = start;
  const forward = step > 0;
  while (forward ? current <= end + 1e-9 : current >= end - 1e-9) {
    values.push(Number(current.toFixed(8)));
    current += step;
  }
  return values;
}

const latitudes = range(lat1, lat2, dlat);
const longitudes = range(lon1, lon2, dlon);
const expectedRows = latitudes.length;
const expectedCols = longitudes.length;

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

function parseEpoch(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 6) {
    throw new Error(`Invalid epoch line: ${line}`);
  }
  const [year, month, day, hour, minute, second] = tokens.slice(0, 6).map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
}

function summarize(values) {
  const finite = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!finite.length) {
    return { min: null, max: null, mean: null };
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const mean = finite.reduce((sum, item) => sum + item, 0) / finite.length;
  return {
    min: Number(min.toFixed(2)),
    max: Number(max.toFixed(2)),
    mean: Number(mean.toFixed(2)),
  };
}

const frames = [];
let idx = 0;

while (idx < lines.length) {
  if (!lines[idx].includes('START OF TEC MAP')) {
    idx += 1;
    continue;
  }
  idx += 1;
  if (idx >= lines.length) break;
  const epochLine = lines[idx++];
  const epoch = parseEpoch(epochLine);
  while (idx < lines.length && !lines[idx].includes('LAT/LON1/LON2/DLON/H')) {
    idx += 1;
  }

  const values = [];
  while (idx < lines.length) {
    const line = lines[idx].trim();
    if (line === '') {
      idx += 1;
      continue;
    }
    if (line.includes('END OF TEC MAP')) {
      idx += 1;
      break;
    }
    const rowHeader = parseRowHeader(line);
    if (!rowHeader) {
      throw new Error(`Expected row header but got: ${line}`);
    }
    idx += 1;
    const rowValues = [];
    while (idx < lines.length && rowValues.length < expectedCols) {
      const next = lines[idx].trim();
      if (next === '') {
        idx += 1;
        continue;
      }
      if (next.includes('END OF TEC MAP')) {
        break;
      }
      if (parseRowHeader(next)) {
        break;
      }
      const tokens = next.split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        if (rowValues.length >= expectedCols) break;
        const value = Number(token);
        if (Number.isFinite(value)) {
          rowValues.push(value);
        }
      }
      idx += 1;
    }
    if (rowValues.length !== expectedCols) {
      throw new Error(`Expected ${expectedCols} values for latitude ${rowHeader.lat}, got ${rowValues.length}`);
    }
    values.push(...rowValues.map((value) => (value === 9999 ? null : Number((value * scale).toFixed(2)))));
  }
  if (values.length !== expectedRows * expectedCols) {
    throw new Error(`Expected ${expectedRows * expectedCols} values for frame but got ${values.length}`);
  }
  const { min, max, mean } = summarize(values);
  frames.push({
    epoch,
    values,
    min,
    max,
    mean,
    source: {
      transport: 'IONEX',
      file: path.basename(inputPath),
      mountpoint: 'XAN1OPSRTS',
      message: 'Converted IONEX fallback',
    },
  });
}

if (!frames.length) {
  throw new Error('No frames parsed from the INX file.');
}

const payload = {
  schema: 'segm.realtime-gim.v1',
  status: 'sample',
  generatedAt: new Date().toISOString(),
  grid: {
    lat: latitudes,
    lon: longitudes,
    shape: [expectedRows, expectedCols],
    resolution: { lat: Math.abs(dlat), lon: Math.abs(dlon) },
    unit: 'TECU',
  },
  frames,
  latestIndex: frames.length - 1,
};

fs.writeFileSync(outputPath, JSON.stringify(payload), 'utf8');
console.log(`Wrote ${frames.length} frames to ${outputPath}`);

