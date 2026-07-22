"use client";

import { useEffect, useRef, useState } from "react";

const continents = [
  [[-168,70],[-140,60],[-125,48],[-118,32],[-100,20],[-82,24],[-66,45],[-54,54],[-72,70],[-110,74]],
  [[-82,12],[-70,8],[-54,-10],[-50,-28],[-62,-52],[-74,-44],[-79,-18]],
  [[-12,35],[3,52],[30,64],[60,58],[95,70],[135,53],[164,58],[178,42],[142,8],[116,1],[102,15],[76,8],[60,28],[34,30],[22,14],[12,34]],
  [[-18,34],[10,36],[34,28],[48,10],[40,-18],[24,-35],[10,-34],[-4,-12]],
  [[112,-12],[146,-12],[154,-30],[134,-42],[114,-32]],
  [[-52,82],[-22,74],[-30,60],[-48,62]],
];

function palette(value: number) {
  const stops = [
    [5, 41, 86], [8, 88, 121], [13, 145, 139], [93, 187, 118],
    [215, 220, 71], [250, 174, 45], [233, 82, 53], [139, 33, 68],
  ];
  const scaled = Math.max(0, Math.min(0.999, value)) * (stops.length - 1);
  const i = Math.floor(scaled); const t = scaled - i;
  const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
  return `rgb(${a.map((v, n) => Math.round(v + (b[n] - v) * t)).join(",")})`;
}

export default function TecMap({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(7);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setFrame((f) => (f + 1) % 24), 1500);
    return () => window.clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const w = rect.width, h = rect.height;
      ctx.fillStyle = "#061a2d"; ctx.fillRect(0, 0, w, h);
      const cell = compact ? 7 : 8;
      for (let y = 0; y < h; y += cell) {
        const lat = 90 - (y / h) * 180;
        for (let x = 0; x < w; x += cell) {
          const lon = (x / w) * 360 - 180;
          const solar = Math.max(0, Math.cos((lat * Math.PI) / 180)) * (0.58 + 0.42 * Math.cos(((lon - frame * 15 + 40) * Math.PI) / 180));
          const equatorial = Math.exp(-Math.pow(Math.abs(lat) - 16, 2) / 150) * (0.38 + 0.12 * Math.sin((lon + frame * 9) * Math.PI / 75));
          const wave = 0.08 * Math.sin((lon * 2 + lat + frame * 12) * Math.PI / 90);
          const v = Math.max(0, Math.min(1, 0.08 + solar * 0.62 + equatorial + wave));
          ctx.fillStyle = palette(v); ctx.globalAlpha = 0.93; ctx.fillRect(x, y, cell + 0.5, cell + 0.5);
        }
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(230,247,255,.28)"; ctx.lineWidth = 1;
      for (let lon = -180; lon <= 180; lon += 30) { const x = ((lon + 180) / 360) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let lat = -60; lat <= 60; lat += 30) { const y = ((90 - lat) / 180) * h; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.strokeStyle = "rgba(238,251,255,.82)"; ctx.lineWidth = 1.2;
      continents.forEach((points) => {
        ctx.beginPath(); points.forEach(([lon, lat], index) => { const x = ((lon + 180) / 360) * w; const y = ((90 - lat) / 180) * h; index ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.stroke();
      });
      ctx.fillStyle = "rgba(3,17,30,.82)"; ctx.fillRect(0, 0, w, 24);
      ctx.fillStyle = "rgba(230,247,255,.76)"; ctx.font = "11px ui-monospace, monospace";
      ctx.fillText(`2026-07-22 ${String(frame).padStart(2,"0")}:00 UTC · DEMO STREAM`, 12, 16);
    };
    draw();
    const observer = new ResizeObserver(draw); observer.observe(canvas);
    return () => observer.disconnect();
  }, [frame, compact]);

  return (
    <div className={`tec-module ${compact ? "compact-tec" : ""}`}>
      <div className="map-stage"><canvas ref={canvasRef} aria-label="全球电离层总电子含量演示地图" /></div>
      <div className="map-controls">
        <button type="button" onClick={() => setPlaying((v) => !v)} aria-label={playing ? "暂停动画" : "播放动画"}>{playing ? "Ⅱ" : "▶"}</button>
        <input type="range" min="0" max="23" value={frame} onChange={(e) => { setFrame(Number(e.target.value)); setPlaying(false); }} aria-label="演示历元" />
        <span>{String(frame).padStart(2,"0")}:00 UTC</span>
      </div>
      <div className="tec-legend"><span>0</span><i /><span>80 TECU</span></div>
    </div>
  );
}
