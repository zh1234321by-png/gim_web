"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import ProductSearch from "./ProductSearch";
import TecMap, { type RealtimeTelemetry } from "./TecMap";

const EMPTY_TELEMETRY: RealtimeTelemetry = {
  state: "connecting",
  epoch: null,
  frameCount: 0,
  maximum: null,
  mean: null,
  latencySeconds: null,
  qualityTecu: null,
  source: "正在连接实时数据桥",
  mountpoint: "IONO00XAN1",
};

function valueOrDash(value: number | null, digits = 1) {
  return value === null ? "—" : value.toFixed(digits);
}

function latencyLabel(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function stateCopy(state: RealtimeTelemetry["state"]) {
  if (state === "live") return "LIVE";
  if (state === "history") return "REPLAY";
  if (state === "stale") return "STALE";
  if (state === "sample") return "SAMPLE";
  if (state === "offline") return "OFFLINE";
  return "CONNECTING";
}

export default function ObservatoryConsole() {
  const [telemetry, setTelemetry] =
    useState<RealtimeTelemetry>(EMPTY_TELEMETRY);
  const handleTelemetry = useCallback(
    (value: RealtimeTelemetry) => setTelemetry(value),
    [],
  );

  const epochTime = telemetry.epoch
    ? new Date(telemetry.epoch).toISOString().slice(11, 19)
    : "--:--:--";

  return (
    <>
      <div className="observatory-live-status">
        <div
          className={`system-status console-state state-${telemetry.state}`}
        >
          <i />
          {stateCopy(telemetry.state)}
          <span>
            {telemetry.mountpoint} · {telemetry.source}
          </span>
        </div>
        <span>最后历元 {epochTime} UTC</span>
      </div>

      <section className="dashboard-grid">
        <div className="dashboard-map panel-dark">
          <div className="panel-title">
            <span>VTEC GLOBAL MAP · REAL-TIME</span>
            <span>MODEL · SEGM-GIM / IGS SSR 4076.201</span>
          </div>
          <TecMap compact onTelemetry={handleTelemetry} />
        </div>

        <aside className="space-metrics">
          <article>
            <span>GLOBAL MAX</span>
            <strong>{valueOrDash(telemetry.maximum)}</strong>
            <small>TECU · CURRENT EPOCH</small>
            <i style={{ "--fill": "78%" } as React.CSSProperties} />
          </article>
          <article>
            <span>GLOBAL MEAN</span>
            <strong>{valueOrDash(telemetry.mean)}</strong>
            <small>TECU · AREA GRID</small>
            <i style={{ "--fill": "48%" } as React.CSSProperties} />
          </article>
          <article>
            <span>
              {telemetry.state === "history" ? "VIEW MODE" : "DATA AGE"}
            </span>
            <strong className="metric-text">
              {telemetry.state === "history"
                ? "HISTORY"
                : latencyLabel(telemetry.latencySeconds)}
            </strong>
            <small>
              {telemetry.state === "history"
                ? "UTC DAILY ARCHIVE"
                : "SSR EPOCH → VIEWER"}
            </small>
            <i
              style={{
                "--fill":
                  telemetry.latencySeconds !== null &&
                  telemetry.latencySeconds < 300
                    ? "24%"
                    : "86%",
              } as React.CSSProperties}
            />
          </article>
          <article>
            <span>VTEC QUALITY</span>
            <strong>{valueOrDash(telemetry.qualityTecu, 2)}</strong>
            <small>
              {telemetry.qualityTecu === null
                ? `${telemetry.frameCount} BUFFERED EPOCHS`
                : "TECU · SSR INDICATOR"}
            </small>
            <i style={{ "--fill": "62%" } as React.CSSProperties} />
          </article>
        </aside>

        <div className="dashboard-search panel-dark">
          <div className="panel-title">
            <span>PRODUCT ACCESS</span>
            <Link href="/products">FULL CATALOGUE →</Link>
          </div>
          <ProductSearch condensed />
        </div>

        <div className="dashboard-log panel-dark">
          <div className="panel-title">
            <span>PIPELINE STATUS</span>
            <span>UTC+0</span>
          </div>
          <div className="log-lines">
            <p>
              <time>{epochTime}</time>
              <i className={telemetry.state === "offline" ? "wait" : "ok"} />
              NTRIP {telemetry.mountpoint} · {stateCopy(telemetry.state)}
            </p>
            <p>
              <time>{epochTime}</time>
              <i className={telemetry.frameCount ? "ok" : "wait"} />
              SSR 4076.201 DECODE · {telemetry.frameCount} EPOCHS
            </p>
            <p>
              <time>{epochTime}</time>
              <i className={telemetry.maximum !== null ? "ok" : "wait"} />
              SPHERICAL HARMONIC → 2.5° × 5° GRID
            </p>
            <p>
              <time>{epochTime}</time>
              <i className="ok" />
              POINT SERIES · CLICK MAP TO QUERY 24 H
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
