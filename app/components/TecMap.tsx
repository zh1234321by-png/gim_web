"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Coastline = Array<[number, number]>;

type GridMetadata = {
  lat: number[];
  lon: number[];
  shape: [number, number];
  resolution: { lat: number; lon: number };
  unit: string;
};

type GimFrame = {
  epoch: string;
  values: number[];
  min: number;
  max: number;
  mean: number;
  source: {
    transport?: string;
    message?: string;
    caster?: string;
    mountpoint?: string;
    providerId?: number;
    solutionId?: number;
    qualityTecu?: number;
    layerHeightsKm?: number[];
    file?: string;
  };
};

type FramesPayload = {
  schema: string;
  status: "live" | "sample";
  generatedAt: string;
  grid: GridMetadata;
  frames: GimFrame[];
  latestIndex: number;
};

type LatestPayload = {
  schema: string;
  status: "live" | "history";
  generatedAt: string;
  grid: GridMetadata;
  frame: GimFrame;
};

type TimelineEpoch = {
  epoch: string;
  min: number;
  max: number;
  mean: number;
  source: GimFrame["source"];
};

type TimelinePayload = {
  schema: string;
  status: "history";
  date: string;
  timeZone: "UTC";
  coverage: {
    frameCount: number;
    oldestEpoch: string | null;
    latestEpoch: string | null;
    historyHours: number;
  };
  epochs: TimelineEpoch[];
};

type SeriesPoint = {
  epoch: string;
  value: number | null;
};

type SeriesPayload = {
  schema: string;
  status: string;
  unit: string;
  selected: {
    lat: number;
    lon: number;
    latIndex: number;
    lonIndex: number;
  };
  points: SeriesPoint[];
};

type Selection = {
  latIndex: number;
  lonIndex: number;
  lat: number;
  lon: number;
};

type ConnectionState =
  | "connecting"
  | "live"
  | "history"
  | "stale"
  | "sample"
  | "offline";

export type RealtimeTelemetry = {
  state: ConnectionState;
  epoch: string | null;
  frameCount: number;
  maximum: number | null;
  mean: number | null;
  latencySeconds: number | null;
  qualityTecu: number | null;
  source: string;
  mountpoint: string;
};

type TecMapProps = {
  compact?: boolean;
  onTelemetry?: (telemetry: RealtimeTelemetry) => void;
};

const API_BASE = "/api/realtime";
const DEMO_URL = "/realtime/demo.json";
const MAX_CLIENT_FRAMES = 36;
const POLL_INTERVAL_MS = 15_000;
const DEFAULT_COLOR_MAX = 80;
const VIEWER_URL = "/tools/gim-viewer.html";
const DEFAULT_MOUNTPOINT = "IONO00XAN1";

let coastlinePromise: Promise<Coastline[]> | null = null;

function turbo(value: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, value));
  const red = [0.13572138, 4.6153926, -42.66032258, 132.13108234, -152.94239396, 59.28637943];
  const green = [0.09140261, 2.19418839, 4.84296658, -14.18503333, 4.27729857, 2.82956604];
  const blue = [0.1066733, 12.64194608, -60.58204836, 110.36276771, -89.90310912, 27.34824973];
  const terms = [1, t, t * t, t ** 3, t ** 4, t ** 5];
  const channel = (coefficients: number[]) =>
    Math.max(
      0,
      Math.min(
        255,
        Math.round(
          255 *
            coefficients.reduce(
              (sum, coefficient, index) => sum + coefficient * terms[index],
              0,
            ),
        ),
      ),
    );
  return [channel(red), channel(green), channel(blue)];
}

function loadCanonicalCoastlines(): Promise<Coastline[]> {
  if (coastlinePromise) return coastlinePromise;
  coastlinePromise = fetch(VIEWER_URL, { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`coastline source returned ${response.status}`);
      }
      const source = await response.text();
      const marker = "const COASTLINES = ";
      const start = source.indexOf(marker);
      if (start < 0) throw new Error("COASTLINES marker is missing");
      const jsonStart = start + marker.length;
      let jsonEnd = source.indexOf(";\nconst el", jsonStart);
      if (jsonEnd < 0) jsonEnd = source.indexOf(";\r\nconst el", jsonStart);
      if (jsonEnd < 0) throw new Error("COASTLINES terminator is missing");
      return JSON.parse(source.slice(jsonStart, jsonEnd)) as Coastline[];
    })
    .catch((error) => {
      coastlinePromise = null;
      throw error;
    });
  return coastlinePromise;
}

function epochLabel(epoch: string) {
  const value = new Date(epoch);
  if (Number.isNaN(value.getTime())) return epoch;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(value)
    .replace(/\//g, "-")
    .replace(" ", " · ");
}

function shortEpochLabel(epoch: string) {
  const value = new Date(epoch);
  if (Number.isNaN(value.getTime())) return epoch;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function ageSeconds(epoch: string | undefined) {
  if (!epoch) return null;
  const value = new Date(epoch).getTime();
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round((Date.now() - value) / 1000));
}

function connectionCopy(state: ConnectionState) {
  if (state === "live") return "REAL-TIME STREAM";
  if (state === "history") return "HISTORICAL REPLAY";
  if (state === "stale") return "STREAM STALE";
  if (state === "sample") return "RECENT SAMPLE";
  if (state === "offline") return "SOURCE OFFLINE";
  return "CONNECTING";
}

function utcDateLabel(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function nearestIndex(axis: number[], target: number) {
  let selected = 0;
  for (let index = 1; index < axis.length; index += 1) {
    if (Math.abs(axis[index] - target) < Math.abs(axis[selected] - target)) {
      selected = index;
    }
  }
  return selected;
}

function localSeries(
  payload: FramesPayload,
  selection: Selection,
): SeriesPayload {
  const width = payload.grid.lon.length;
  const valueIndex = selection.latIndex * width + selection.lonIndex;
  return {
    schema: payload.schema,
    status: payload.status,
    unit: payload.grid.unit,
    selected: selection,
    points: payload.frames.map((frame) => ({
      epoch: frame.epoch,
      value: Number.isFinite(frame.values[valueIndex])
        ? frame.values[valueIndex]
        : null,
    })),
  };
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

function normalizePayload(payload: FramesPayload) {
  if (
    !payload.grid?.lat?.length ||
    !payload.grid?.lon?.length ||
    !payload.frames?.length
  ) {
    throw new Error("real-time payload is empty");
  }
  const expected = payload.grid.lat.length * payload.grid.lon.length;
  const frames = payload.frames.filter(
    (frame) => frame.values.length === expected,
  );
  if (!frames.length) throw new Error("real-time grid shape is invalid");
  return {
    ...payload,
    frames,
    latestIndex: frames.length - 1,
  };
}

export default function TecMap({
  compact = false,
  onTelemetry,
}: TecMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(true);
  const [payload, setPayload] = useState<FramesPayload | null>(null);
  const [connection, setConnection] =
    useState<ConnectionState>("connecting");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [coastlines, setCoastlines] = useState<Coastline[]>([]);
  const [colorMax, setColorMax] = useState(DEFAULT_COLOR_MAX);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [series, setSeries] = useState<SeriesPayload | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [historyDate, setHistoryDate] = useState(() => utcDateLabel());
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [historyFrame, setHistoryFrame] = useState<GimFrame | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMessage, setHistoryMessage] = useState(
    "服务器连续保存 7 天历元，可按 UTC 日期回放",
  );
  const [mapTooltip, setMapTooltip] = useState<{
    text: string;
    left: number;
    top: number;
  } | null>(null);
  const [chartTooltip, setChartTooltip] = useState<{
    text: string;
    left: number;
    top: number;
  } | null>(null);

  const liveFrame = payload?.frames[
    Math.min(frameIndex, Math.max(0, payload.frames.length - 1))
  ];
  const frame = historyFrame ?? liveFrame;

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    let cancelled = false;
    loadCanonicalCoastlines()
      .then((items) => {
        if (!cancelled) setCoastlines(items);
      })
      .catch(() => {
        if (!cancelled) setCoastlines([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      setConnection("connecting");
      try {
        const live = normalizePayload(
          await readJson<FramesPayload>(
            `${API_BASE}/frames.json?limit=24`,
          ),
        );
        if (cancelled) return;
        setPayload(live);
        setFrameIndex(live.frames.length - 1);
        setConnection("live");
      } catch {
        try {
          const sample = normalizePayload(
            await readJson<FramesPayload>(DEMO_URL),
          );
          if (cancelled) return;
          setPayload({ ...sample, status: "sample" });
          setFrameIndex(sample.frames.length - 1);
          setConnection("sample");
        } catch {
          if (!cancelled) setConnection("offline");
        }
      }
    };

    const pollLatest = async () => {
      try {
        const latest = await readJson<LatestPayload>(
          `${API_BASE}/latest.json?t=${Date.now()}`,
        );
        if (cancelled || !latest.frame?.values?.length) return;
        setPayload((current) => {
          const currentFrames =
            current?.status === "live" ? current.frames : [];
          const existing = currentFrames.findIndex(
            (item) => item.epoch === latest.frame.epoch,
          );
          const nextFrames =
            existing >= 0
              ? currentFrames.map((item, index) =>
                  index === existing ? latest.frame : item,
                )
              : [...currentFrames, latest.frame].slice(-MAX_CLIENT_FRAMES);
          const next: FramesPayload = {
            schema: latest.schema,
            status: "live",
            generatedAt: latest.generatedAt,
            grid: latest.grid,
            frames: nextFrames,
            latestIndex: nextFrames.length - 1,
          };
          return next;
        });
        setConnection("live");
      } catch {
        setConnection((current) =>
          current === "live" ? "stale" : current,
        );
      }
    };

    void loadInitial();
    const timer = window.setInterval(() => void pollLatest(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!timeline && playingRef.current && payload?.frames.length) {
      setFrameIndex(payload.frames.length - 1);
    }
  }, [payload?.frames.length, timeline]);

  useEffect(() => {
    if (
      !playing ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const count = timeline?.epochs.length ?? payload?.frames.length ?? 0;
    if (count < 2) return;
    const timer = window.setInterval(() => {
      if (timeline) {
        setHistoryIndex((current) => (current + 1) % timeline.epochs.length);
      } else if (payload) {
        setFrameIndex((current) => (current + 1) % payload.frames.length);
      }
    }, compact ? 1_500 : 1_000);
    return () => window.clearInterval(timer);
  }, [compact, payload, playing, timeline]);

  useEffect(() => {
    if (!timeline?.epochs.length) return;
    const selected = timeline.epochs[
      Math.min(historyIndex, timeline.epochs.length - 1)
    ];
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setHistoryLoading(true);
      try {
        const selectedFrame = await readJson<LatestPayload>(
          `${API_BASE}/frame.json?epoch=${encodeURIComponent(selected.epoch)}`,
        );
        if (!cancelled) {
          setHistoryFrame(selectedFrame.frame);
          setHistoryMessage(
            `${timeline.date} UTC · ${timeline.epochs.length} 个归档历元`,
          );
        }
      } catch {
        if (!cancelled) {
          setHistoryMessage("该历元读取失败，请确认实时归档服务正在运行");
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [historyIndex, timeline]);

  useEffect(() => {
    const latency = ageSeconds(frame?.epoch);
    const effectiveState = timeline
      ? "history"
      : connection === "live" && latency !== null && latency > 900
        ? "stale"
        : connection;
    onTelemetry?.({
      state: effectiveState,
      epoch: frame?.epoch ?? null,
      frameCount: timeline?.epochs.length ?? payload?.frames.length ?? 0,
      maximum: frame?.max ?? null,
      mean: frame?.mean ?? null,
      latencySeconds: timeline ? null : latency,
      qualityTecu:
        typeof frame?.source.qualityTecu === "number"
          ? frame.source.qualityTecu
          : null,
      source:
        frame?.source.transport ??
        (connection === "sample" ? "历史 SSR 样例" : "等待数据源"),
      mountpoint: frame?.source.mountpoint ?? DEFAULT_MOUNTPOINT,
    });
  }, [
    connection,
    frame,
    onTelemetry,
    payload?.frames.length,
    timeline,
  ]);

  const drawMap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload || !frame) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#e9eef2";
    context.fillRect(0, 0, width, height);

    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = payload.grid.lon.length;
    gridCanvas.height = payload.grid.lat.length;
    const gridContext = gridCanvas.getContext("2d");
    if (!gridContext) return;
    const image = gridContext.createImageData(
      gridCanvas.width,
      gridCanvas.height,
    );
    for (let index = 0; index < frame.values.length; index += 1) {
      const value = frame.values[index];
      const pixel = index * 4;
      if (!Number.isFinite(value)) continue;
      const [red, green, blue] = turbo(value / colorMax);
      image.data[pixel] = red;
      image.data[pixel + 1] = green;
      image.data[pixel + 2] = blue;
      image.data[pixel + 3] = 255;
    }
    gridContext.putImageData(image, 0, 0);

    const xy = (lon: number, lat: number): [number, number] => [
      ((lon + 180) / 360) * width,
      ((90 - lat) / 180) * height,
    ];
    const [gridLeft, gridTop] = xy(
      payload.grid.lon[0],
      payload.grid.lat[0],
    );
    const [gridRight, gridBottom] = xy(
      payload.grid.lon[payload.grid.lon.length - 1],
      payload.grid.lat[payload.grid.lat.length - 1],
    );
    context.imageSmoothingEnabled = true;
    context.drawImage(
      gridCanvas,
      gridLeft,
      gridTop,
      gridRight - gridLeft,
      gridBottom - gridTop,
    );

    context.lineWidth = Math.max(1, dpr * 0.7);
    context.strokeStyle = "rgba(255,255,255,.42)";
    for (let lon = -120; lon <= 120; lon += 60) {
      const x = xy(lon, 0)[0];
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = xy(0, lat)[1];
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.lineWidth = Math.max(1, dpr * 0.85);
    context.strokeStyle = "rgba(22,31,39,.82)";
    context.lineJoin = "round";
    for (const path of coastlines) {
      context.beginPath();
      let previous: [number, number] | null = null;
      for (const point of path) {
        const projected = xy(point[0], point[1]);
        if (
          previous === null ||
          Math.abs(projected[0] - previous[0]) > width / 2
        ) {
          context.moveTo(projected[0], projected[1]);
        } else {
          context.lineTo(projected[0], projected[1]);
        }
        previous = projected;
      }
      context.stroke();
    }

    if (selection) {
      const [x, y] = xy(selection.lon, selection.lat);
      context.fillStyle = "rgba(255,255,255,.96)";
      context.strokeStyle = "#b42318";
      context.lineWidth = 2 * dpr;
      context.beginPath();
      context.arc(x, y, 7 * dpr, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.fillStyle = "#b42318";
      context.beginPath();
      context.arc(x, y, 2.5 * dpr, 0, Math.PI * 2);
      context.fill();
    }
  }, [coastlines, colorMax, frame, payload, selection]);

  useEffect(() => {
    drawMap();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(drawMap);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawMap]);

  const pointerSelection = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!payload || !frame) return null;
      const rect = event.currentTarget.getBoundingClientRect();
      const longitude =
        ((event.clientX - rect.left) / rect.width) * 360 - 180;
      const latitude =
        90 - ((event.clientY - rect.top) / rect.height) * 180;
      const lonIndex = nearestIndex(payload.grid.lon, longitude);
      const latIndex = nearestIndex(payload.grid.lat, latitude);
      const valueIndex = latIndex * payload.grid.lon.length + lonIndex;
      return {
        selection: {
          latIndex,
          lonIndex,
          lat: payload.grid.lat[latIndex],
          lon: payload.grid.lon[lonIndex],
        },
        value: frame.values[valueIndex],
        rect,
      };
    },
    [frame, payload],
  );

  const handleMapMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const point = pointerSelection(event);
    if (!point) return;
    const left = event.clientX - point.rect.left + 12;
    const top = event.clientY - point.rect.top + 12;
    setMapTooltip({
      text: `${point.selection.lon.toFixed(1)}°, ${point.selection.lat.toFixed(1)}° · ${
        Number.isFinite(point.value) ? point.value.toFixed(2) : "—"
      } TECU`,
      left,
      top,
    });
  };

  const loadHistoryDate = async () => {
    setPlaying(false);
    setHistoryLoading(true);
    setHistoryMessage(`正在读取 ${historyDate} UTC 的归档索引…`);
    try {
      const nextTimeline = await readJson<TimelinePayload>(
        `${API_BASE}/timeline.json?date=${encodeURIComponent(historyDate)}`,
      );
      if (!nextTimeline.epochs.length) {
        setTimeline(null);
        setHistoryFrame(null);
        setHistoryMessage(
          `${historyDate} UTC 暂无归档；Caster 无法倒播，需保证后台接收服务持续运行`,
        );
        return;
      }
      setTimeline(nextTimeline);
      setHistoryIndex(nextTimeline.epochs.length - 1);
      setHistoryFrame(null);
      setHistoryMessage(
        `${historyDate} UTC · ${nextTimeline.epochs.length} 个归档历元`,
      );
    } catch {
      setTimeline(null);
      setHistoryFrame(null);
      setHistoryMessage("历史索引不可用，请检查实时归档服务");
    } finally {
      setHistoryLoading(false);
    }
  };

  const returnToLive = () => {
    setTimeline(null);
    setHistoryFrame(null);
    setHistoryIndex(0);
    setPlaying(true);
    setHistoryMessage("已返回实时；服务器连续保存 7 天历元");
    if (payload?.frames.length) setFrameIndex(payload.frames.length - 1);
  };

  const selectMapPoint = async (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const point = pointerSelection(event);
    if (!point || !payload) return;
    setSelection(point.selection);
    setSeriesLoading(true);
    setSeries(localSeries(payload, point.selection));
    try {
      const historyQuery = timeline
        ? `date=${encodeURIComponent(timeline.date)}`
        : "hours=24";
      const remote = await readJson<SeriesPayload>(
        `${API_BASE}/series.json?lat=${point.selection.lat}&lon=${point.selection.lon}&${historyQuery}`,
      );
      setSeries(remote);
    } catch {
      setSeries(localSeries(payload, point.selection));
    } finally {
      setSeriesLoading(false);
    }
  };

  const seriesValues = useMemo(
    () =>
      series?.points
        .map((point) => point.value)
        .filter((value): value is number => typeof value === "number") ?? [],
    [series],
  );

  const drawSeries = useCallback(() => {
    const canvas = chartRef.current;
    if (!canvas || !series || !series.points.length || !seriesValues.length) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#f7fafb";
    context.fillRect(0, 0, width, height);

    const padding = {
      left: 54 * dpr,
      right: 18 * dpr,
      top: 23 * dpr,
      bottom: 34 * dpr,
    };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const rawMin = Math.min(...seriesValues);
    const rawMax = Math.max(...seriesValues);
    const range = Math.max(1, rawMax - rawMin);
    const minimum = Math.max(0, rawMin - range * 0.12);
    const maximum = rawMax + range * 0.12;
    const xAt = (index: number) =>
      padding.left +
      (series.points.length <= 1
        ? 0
        : (index / (series.points.length - 1)) * plotWidth);
    const yAt = (value: number) =>
      padding.top + ((maximum - value) / (maximum - minimum)) * plotHeight;

    context.strokeStyle = "#d7e0e5";
    context.lineWidth = dpr;
    context.font = `${10 * dpr}px Arial`;
    context.fillStyle = "#5f6f78";
    context.textBaseline = "middle";
    context.textAlign = "right";
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = padding.top + (tick / 4) * plotHeight;
      const value = maximum - (tick / 4) * (maximum - minimum);
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      context.fillText(value.toFixed(1), padding.left - 7 * dpr, y);
    }

    context.strokeStyle = "#1769aa";
    context.lineWidth = 2 * dpr;
    context.beginPath();
    let started = false;
    series.points.forEach((point, index) => {
      if (typeof point.value !== "number") {
        started = false;
        return;
      }
      const x = xAt(index);
      const y = yAt(point.value);
      if (!started) {
        context.moveTo(x, y);
        started = true;
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();

    context.fillStyle = "#405664";
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(
      shortEpochLabel(series.points[0].epoch),
      padding.left,
      height - padding.bottom + 9 * dpr,
    );
    context.textAlign = "right";
    context.fillText(
      shortEpochLabel(series.points[series.points.length - 1].epoch),
      width - padding.right,
      height - padding.bottom + 9 * dpr,
    );
    context.fillStyle = "#1769aa";
    context.textAlign = "left";
    context.textBaseline = "bottom";
    context.fillText("VTEC (TECU)", padding.left, padding.top - 6 * dpr);
  }, [series, seriesValues]);

  useEffect(() => {
    drawSeries();
    const canvas = chartRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(drawSeries);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawSeries]);

  const handleChartMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (!series?.points.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const left = 54;
    const right = 18;
    const relative = Math.max(
      0,
      Math.min(
        1,
        (event.clientX - rect.left - left) /
          Math.max(1, rect.width - left - right),
      ),
    );
    const index = Math.round(relative * (series.points.length - 1));
    const point = series.points[index];
    setChartTooltip({
      text: `${epochLabel(point.epoch)} UTC · ${
        typeof point.value === "number" ? point.value.toFixed(2) : "—"
      } TECU`,
      left: Math.min(rect.width - 215, Math.max(6, event.clientX - rect.left + 10)),
      top: 8,
    });
  };

  const latency = ageSeconds(frame?.epoch);
  const effectiveConnection: ConnectionState = timeline
    ? "history"
    : connection === "live" && latency !== null && latency > 900
      ? "stale"
      : connection;
  const sourceLabel =
    frame?.source.mountpoint ??
    frame?.source.file ??
    DEFAULT_MOUNTPOINT;
  const controlCount =
    timeline?.epochs.length ?? payload?.frames.length ?? 0;
  const controlIndex = timeline ? historyIndex : frameIndex;

  return (
    <div
      className={`tec-module realtime-tec ${compact ? "compact-tec" : ""}`}
    >
      <div className="tec-stream-bar">
        <span className={`stream-state state-${effectiveConnection}`}>
          <i />
          {connectionCopy(effectiveConnection)}
        </span>
        <span>
          {sourceLabel}
          {frame?.source.message ? ` · ${frame.source.message}` : ""}
        </span>
        <span>{frame ? `${epochLabel(frame.epoch)} UTC` : "等待首个历元"}</span>
      </div>

      <div className="map-stage">
        <canvas
          ref={canvasRef}
          aria-label="全球电离层总电子含量实时地图；点击任意网格查看时间序列"
          onPointerMove={handleMapMove}
          onPointerLeave={() => setMapTooltip(null)}
          onPointerDown={selectMapPoint}
        />
        {mapTooltip ? (
          <div
            className="tec-tooltip"
            style={{ left: mapTooltip.left, top: mapTooltip.top }}
          >
            {mapTooltip.text}
          </div>
        ) : null}
        <div className="map-corner-note">
          <span>GRID 2.5° × 5°</span>
          <span>
            {timeline
              ? `正在回放 ${timeline.date} UTC`
              : "点击地图查看该点 24 h VTEC"}
          </span>
        </div>
      </div>

      <div className="history-controls">
        <label>
          <span>历史回放 · UTC 日期</span>
          <input
            type="date"
            value={historyDate}
            max={utcDateLabel()}
            onChange={(event) => setHistoryDate(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void loadHistoryDate()}
          disabled={historyLoading}
        >
          {historyLoading ? "读取中…" : "读取当日"}
        </button>
        {timeline ? (
          <button type="button" className="return-live" onClick={returnToLive}>
            返回实时
          </button>
        ) : null}
        <span>{historyMessage}</span>
      </div>

      <div className="map-controls">
        <div className="map-transport">
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              if (timeline?.epochs.length) {
                setHistoryIndex(
                  (value) =>
                    (value - 1 + timeline.epochs.length) %
                    timeline.epochs.length,
                );
              } else {
                setFrameIndex((value) =>
                  payload?.frames.length
                    ? (value - 1 + payload.frames.length) %
                      payload.frames.length
                    : 0,
                );
              }
            }}
            aria-label="上一历元"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            aria-label={playing ? "暂停动画" : "播放动画"}
          >
            {playing ? "Ⅱ" : "▶"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              if (timeline?.epochs.length) {
                setHistoryIndex(
                  (value) => (value + 1) % timeline.epochs.length,
                );
              } else {
                setFrameIndex((value) =>
                  payload?.frames.length
                    ? (value + 1) % payload.frames.length
                    : 0,
                );
              }
            }}
            aria-label="下一历元"
          >
            ›
          </button>
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(0, controlCount - 1)}
          value={Math.min(controlIndex, Math.max(0, controlCount - 1))}
          onChange={(event) => {
            if (timeline) {
              setHistoryIndex(Number(event.target.value));
            } else {
              setFrameIndex(Number(event.target.value));
            }
            setPlaying(false);
          }}
          aria-label={timeline ? "历史 GIM 历元" : "实时 GIM 历元"}
        />
        <span>
          {controlCount ? `${controlIndex + 1} / ${controlCount}` : "0 / 0"}
        </span>
      </div>

      <div className="tec-legend">
        <span>0</span>
        <i />
        <span>{colorMax} TECU</span>
        <label>
          色标上限
          <select
            value={colorMax}
            onChange={(event) => setColorMax(Number(event.target.value))}
          >
            {[60, 80, 100, 120].map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selection && series ? (
        <section className="tec-series-panel">
          <div className="series-heading">
            <div>
              <span>SELECTED GRID / 24 H TRACE</span>
              <strong>
                {selection.lon.toFixed(1)}°, {selection.lat.toFixed(1)}°
              </strong>
            </div>
            <div>
              <span>{series.points.length} EPOCHS</span>
              <button
                type="button"
                onClick={() => {
                  setSelection(null);
                  setSeries(null);
                }}
              >
                关闭
              </button>
            </div>
          </div>
          <div className="series-chart-shell">
            <canvas
              ref={chartRef}
              aria-label={`经度 ${selection.lon.toFixed(1)} 度、纬度 ${selection.lat.toFixed(1)} 度的 VTEC 时间序列`}
              onPointerMove={handleChartMove}
              onPointerLeave={() => setChartTooltip(null)}
            />
            {chartTooltip ? (
              <div
                className="tec-tooltip chart-tooltip"
                style={{
                  left: chartTooltip.left,
                  top: chartTooltip.top,
                }}
              >
                {chartTooltip.text}
              </div>
            ) : null}
            {seriesLoading ? (
              <span className="series-loading">正在读取完整历史…</span>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
