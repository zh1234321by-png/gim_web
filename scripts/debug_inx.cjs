const fs = require('fs');
const zlib = require('zlib');
const inputPath = new URL('../public/realtime/XAN1OPSRTS_20262140000_01D_05M_GIM.INX.gz', import.meta.url).pathname;
const raw = fs.readFileSync(inputPath);
const text = zlib.gunzipSync(raw).toString('ascii');
const lines = text.split(/\r?\n/);

const epochPattern = /^(\s*[+-]?\d+\s+[+-]?\d+\s+[+-]?\d+\s+[+-]?\d+\s+[+-]?\d+\s+[+-]?\d+)/;
let startLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('START OF TEC MAP')) {
    startLine = i;
    break;
  }
}
console.log('startLine', startLine);
for (let i = startLine; i < Math.min(lines.length, startLine + 300); i++) {
  const line = lines[i];
  const trimmed = line.trim();
  const isEpoch = epochPattern.test(trimmed) && !trimmed.includes('LAT/LON1/LON2/DLON/H');
  const isLatLon = trimmed.includes('LAT/LON1/LON2/DLON/H');
  const looksLikeHeader = /^\s*[+-]?\d+\.\d+[+-]\d+\.\d+\s+[+-]?\d+\.\d+\s+[+-]?\d+\.\d+\s+[+-]?\d+\.\d+/.test(line) || /^\s*[+-]?\d+\.\d+\s+[+-]?\d+\.\d+\s+[+-]?\d+\.\d+\s+[+-]?\d+\.\d+\s+[+-]?\d+\.\d+/.test(line);
  console.log(i + 1, line.replace(/\t/g, '    '), isEpoch, isLatLon, looksLikeHeader);
}