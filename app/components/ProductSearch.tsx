"use client";

import { useState } from "react";
import content from "../../content/site-content.json";

type Result = { name: string; url?: string; cadence: string; status: string };

function dayOfYear(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

export default function ProductSearch({ condensed = false }: { condensed?: boolean }) {
  const [mode, setMode] = useState<"archive" | "realtime">("archive");
  const [kind, setKind] = useState("gim-long");
  const [date, setDate] = useState("2024-01-01");
  const [results, setResults] = useState<Result[]>([]);
  const [searched, setSearched] = useState(false);

  const runSearch = () => {
    setSearched(true);
    if (mode === "realtime" && !content.product.realtimeBaseUrl) {
      setResults([{ name: "XUST 实时电离层产品", cadence: "5分钟（规划）", status: "实时源待接入" }]);
      return;
    }
    const d = new Date(`${date}T00:00:00Z`); const year = d.getUTCFullYear();
    const yy = String(year).slice(-2), doy = String(dayOfYear(date)).padStart(3, "0");
    let name = "";
    if (kind === "gim-long") {
      name = mode === "realtime"
        ? `XAN1OPSRTS_${year}${doy}0000_01D_05M_GIM.INX.gz`
        : `XAN0OPSRAP_${year}${doy}0000_01D_01H_GIM.INX.gz`;
    }
    if (kind === "gim-short") name = `xan${yy}${doy}.ION.gz`;
    if (kind === "dcb") name = `XAN0MGXRAP_${year}${doy}0000_01D_01D_DCB.BSX.gz`;
    const base = mode === "archive" ? content.product.archiveBaseUrl : content.product.realtimeBaseUrl;
    setResults([{
      name,
      cadence: kind === "dcb" ? "1天" : mode === "realtime" ? "5分钟" : "1小时",
      status: mode === "archive" ? "事后产品" : "实时产品已发布",
      url: `${base}/${year}/${doy}/${name}`,
    }]);
  };

  const selectMode = (nextMode: "archive" | "realtime") => {
    setMode(nextMode);
    setSearched(false);
    setResults([]);
    if (nextMode === "realtime") {
      const yesterday = new Date(Date.now() - 86400000);
      setDate(yesterday.toISOString().slice(0, 10));
    } else {
      setDate("2024-01-01");
    }
    
  };
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const newDate = e.target.value;
  if (mode === "archive") {
    const min = new Date("2000-01-01");
    const max = new Date("2025-12-31");
    const selected = new Date(newDate);
    if (selected < min || selected > max) {
      // 自动修正为允许范围内的日期（可设置为边界或保留原值）
      // 这里我们简单拒绝更改，保持原日期不变
      return;
    }
  }
  setDate(newDate);
};
const today = new Date().toLocaleDateString('en-CA');
  return (
    <section className={`product-search ${condensed ? "condensed-search" : ""}`} aria-label="电离层产品检索">
      <div className="search-tabs" role="tablist" aria-label="产品时效">
        <button type="button" className={mode === "archive" ? "active" : ""} onClick={() => selectMode("archive")}>事后产品</button>
        <button type="button" className={mode === "realtime" ? "active" : ""} onClick={() => selectMode("realtime")}>
          实时产品 <span className="mini-badge live-badge">已上线</span>
        </button>
      </div>
      <div className="search-fields">
        <label><span>产品类型</span><select value={kind} onChange={(e) => setKind(e.target.value)}>{content.product.formats.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label><span>产品日期</span><input type="date" value={date} onChange={handleDateChange} min={mode === "archive" ? "2000-01-01" : "2026-07-23"} max={mode === "archive" ? "2025-12-31" : today}/></label>
        <button className="search-button" type="button" onClick={runSearch}>检索产品 <span aria-hidden="true">→</span></button>
      </div>
      {searched && <div className="search-results" aria-live="polite">
        {results.map((result) => <div className="result-row" key={result.name}>
          <div className="file-mark">{result.url ? "GZ" : "RT"}</div>
          <div><strong>{result.name}</strong><span>{result.cadence} · {result.status}</span></div>
          {result.url ? <a href={result.url} target="_blank" rel="noreferrer">打开 / 下载 ↗</a> : <span className="pending-link">配置实时目录后启用</span>}
        </div>)}
      </div>}
      {!searched && <p className="search-note">
        {mode === "archive"
          ? "当前公开目录：2024 年起 XUST GIM / DCB 事后产品。"
          : "实时目录按“年份 / 年积日”发布 5 分钟 GIM、短文件名 IONEX 与日 DCB；默认日期为前一 UTC 日。"}
      </p>}
    </section>
  );
}
