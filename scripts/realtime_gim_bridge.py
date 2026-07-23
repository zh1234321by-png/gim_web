#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SEGM real-time GIM bridge.

The bridge can either:

1. connect directly to an NTRIP caster and decode IGS SSR 4076.201 with
   ``pyrtcm``; or
2. watch BNC Broadcast Corrections ASCII ``.ssr`` files produced by an
   existing receiver.

Every complete VTEC epoch is expanded from spherical-harmonic coefficients to
the standard 2.5 x 5 degree global grid, stored in SQLite, and exposed through
a small HTTP API consumed by the SEGM web observatory.

No caster credential is ever sent to the browser.
"""

from __future__ import annotations

import argparse
import base64
import glob
import json
import math
import os
import signal
import socket
import sqlite3
import sys
import threading
import time
import zlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, urlparse

import numpy as np


SCHEMA = "segm.realtime-gim.v1"
LATITUDES = np.arange(87.5, -87.5 - 0.01, -2.5, dtype=float)
LONGITUDES = np.arange(-180.0, 180.0 + 0.01, 5.0, dtype=float)
GRID_SHAPE = (LATITUDES.size, LONGITUDES.size)
DEFAULT_HOST = "8.130.47.186"
DEFAULT_PORT = 2101
DEFAULT_MOUNTPOINT = "IONO00XAN1"


@dataclass
class SphericalHarmonicLayer:
    number: int
    degree: int
    order: int
    height_km: float
    c_nm: np.ndarray
    s_nm: np.ndarray


@dataclass
class VtecEpoch:
    epoch_utc: datetime
    second_of_day: float
    update_interval_indicator: int
    mountpoint: str
    layers: list[SphericalHarmonicLayer]
    source: dict[str, Any]


@dataclass
class GridFrame:
    epoch_utc: datetime
    mountpoint: str
    values: np.ndarray
    source: dict[str, Any]
    minimum: float
    maximum: float
    mean: float


class IncompleteVtecBlock(RuntimeError):
    pass


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def fully_normalized_legendre(
    max_degree: int,
    latitudes_rad: np.ndarray,
) -> np.ndarray:
    """Fully normalized associated Legendre functions Pbar_nm(sin(latitude))."""
    x = np.sin(latitudes_rad)
    root = np.sqrt(np.maximum(0.0, 1.0 - x * x))
    p = np.zeros(
        (max_degree + 1, max_degree + 1, x.size),
        dtype=float,
    )
    p[0, 0, :] = 1.0

    for m in range(1, max_degree + 1):
        p[m, m, :] = (2 * m - 1) * root * p[m - 1, m - 1, :]

    for m in range(max_degree):
        p[m + 1, m, :] = (2 * m + 1) * x * p[m, m, :]

    for m in range(max_degree + 1):
        for n in range(m + 2, max_degree + 1):
            p[n, m, :] = (
                (2 * n - 1) * x * p[n - 1, m, :]
                - (n + m - 1) * p[n - 2, m, :]
            ) / (n - m)

    pbar = np.zeros_like(p)
    for n in range(max_degree + 1):
        for m in range(n + 1):
            factor = 1.0 if m == 0 else 2.0
            log_norm = (
                math.log(factor * (2 * n + 1))
                + math.lgamma(n - m + 1)
                - math.lgamma(n + m + 1)
            )
            pbar[n, m, :] = math.exp(0.5 * log_norm) * p[n, m, :]
    return pbar


class GridRecoverer:
    def __init__(self) -> None:
        self.legendre_cache: dict[int, np.ndarray] = {}
        self.latitudes_rad = np.deg2rad(LATITUDES)
        self.longitudes_rad = np.deg2rad(LONGITUDES)

    def recover(self, epoch: VtecEpoch) -> GridFrame:
        if not epoch.layers:
            raise ValueError("VTEC epoch contains no ionospheric layer")

        total = np.zeros(GRID_SHAPE, dtype=float)
        sun_shift = (
            (epoch.second_of_day - 50400.0) * math.pi / 43200.0
        )
        lambda_s = np.mod(self.longitudes_rad + sun_shift, 2.0 * math.pi)

        for layer in deduplicate_layers(epoch.layers):
            pbar = self.legendre_cache.get(layer.degree)
            if pbar is None:
                pbar = fully_normalized_legendre(
                    layer.degree,
                    self.latitudes_rad,
                )
                self.legendre_cache[layer.degree] = pbar

            grid = np.zeros(GRID_SHAPE, dtype=float)
            for n in range(layer.degree + 1):
                max_m = min(n, layer.order)
                for m in range(max_m + 1):
                    longitude_term = (
                        layer.c_nm[n, m] * np.cos(m * lambda_s)
                        + layer.s_nm[n, m] * np.sin(m * lambda_s)
                    )
                    grid += pbar[n, m, :, None] * longitude_term[None, :]
            total += grid

        total = np.maximum(total, 0.0)
        total[~np.isfinite(total)] = np.nan
        finite = total[np.isfinite(total)]
        if finite.size == 0:
            raise ValueError("recovered VTEC grid contains no finite value")

        values = total.astype(np.float32)
        return GridFrame(
            epoch_utc=epoch.epoch_utc,
            mountpoint=epoch.mountpoint,
            values=values,
            source=epoch.source,
            minimum=float(np.min(finite)),
            maximum=float(np.max(finite)),
            mean=float(np.mean(finite)),
        )


def deduplicate_layers(
    layers: Iterable[SphericalHarmonicLayer],
) -> list[SphericalHarmonicLayer]:
    """Drop byte-equivalent duplicated layers emitted by some SSR products."""
    kept: list[SphericalHarmonicLayer] = []
    for layer in layers:
        duplicate = next(
            (
                old
                for old in kept
                if old.degree == layer.degree
                and old.order == layer.order
                and math.isclose(old.height_km, layer.height_km, abs_tol=1e-6)
                and np.allclose(old.c_nm, layer.c_nm, atol=0.01, rtol=0.0)
                and np.allclose(old.s_nm, layer.s_nm, atol=0.01, rtol=0.0)
            ),
            None,
        )
        if duplicate is None:
            kept.append(layer)
    return kept


def next_nonempty_line(lines: list[str], index: int) -> tuple[str, int]:
    while index < len(lines):
        text = lines[index].strip()
        index += 1
        if text:
            return text, index
    raise IncompleteVtecBlock("unexpected end of SSR file")


def parse_bnc_ssr_file(path: str | Path) -> list[VtecEpoch]:
    """Parse every complete ``> VTEC`` block in a BNC ASCII SSR file."""
    text = Path(path).read_text(encoding="ascii", errors="replace")
    lines = text.splitlines()
    epochs: list[VtecEpoch] = []
    index = 0

    while index < len(lines):
        line = lines[index].strip()
        if not line.startswith("> VTEC"):
            index += 1
            continue

        block_start = index
        try:
            fields = line.split()
            if len(fields) < 11:
                raise ValueError(f"invalid VTEC epoch record: {line}")

            year, month, day = map(int, fields[2:5])
            hour, minute = map(int, fields[5:7])
            second = float(fields[7])
            update_indicator = int(fields[8])
            layer_count = int(fields[9])
            mountpoint = fields[10]

            whole_second = int(math.floor(second))
            microsecond = int(round((second - whole_second) * 1e6))
            if microsecond == 1_000_000:
                whole_second += 1
                microsecond = 0
            epoch_utc = datetime(
                year,
                month,
                day,
                hour,
                minute,
                whole_second,
                microsecond,
                tzinfo=timezone.utc,
            )
            second_of_day = hour * 3600.0 + minute * 60.0 + second
            index += 1
            layers: list[SphericalHarmonicLayer] = []

            for _ in range(layer_count):
                header, index = next_nonempty_line(lines, index)
                values = header.split()
                if len(values) < 4:
                    raise ValueError(f"invalid VTEC layer header: {header}")

                number = int(values[0])
                degree = int(values[1])
                order = int(values[2])
                height_km = float(values[3]) / 1000.0
                if degree < 0 or order < 0 or order > degree:
                    raise ValueError(
                        f"invalid degree/order: {degree}/{order}"
                    )

                size = degree + 1
                c_nm = np.zeros((size, size), dtype=float)
                s_nm = np.zeros((size, size), dtype=float)
                for n in range(size):
                    row, index = next_nonempty_line(lines, index)
                    numbers = [float(item) for item in row.split()]
                    if len(numbers) < size:
                        raise IncompleteVtecBlock(
                            f"C row {n}: {len(numbers)} < {size}"
                        )
                    c_nm[n, :] = numbers[:size]
                for n in range(size):
                    row, index = next_nonempty_line(lines, index)
                    numbers = [float(item) for item in row.split()]
                    if len(numbers) < size:
                        raise IncompleteVtecBlock(
                            f"S row {n}: {len(numbers)} < {size}"
                        )
                    s_nm[n, :] = numbers[:size]

                for n in range(size):
                    max_m = min(n, order)
                    c_nm[n, max_m + 1 :] = 0.0
                    s_nm[n, max_m + 1 :] = 0.0
                    s_nm[n, 0] = 0.0

                layers.append(
                    SphericalHarmonicLayer(
                        number=number,
                        degree=degree,
                        order=order,
                        height_km=height_km,
                        c_nm=c_nm,
                        s_nm=s_nm,
                    )
                )

            epochs.append(
                VtecEpoch(
                    epoch_utc=epoch_utc,
                    second_of_day=second_of_day,
                    update_interval_indicator=update_indicator,
                    mountpoint=mountpoint,
                    layers=layers,
                    source={
                        "transport": "BNC SSR ASCII",
                        "file": Path(path).name,
                        "mountpoint": mountpoint,
                    },
                )
            )
        except (IncompleteVtecBlock, ValueError, IndexError) as exc:
            later_header_exists = any(
                item.strip().startswith("> VTEC")
                for item in lines[block_start + 1 :]
            )
            if not later_header_exists:
                print(
                    f"[WAIT] incomplete trailing VTEC block in {path}: {exc}",
                    file=sys.stderr,
                )
                break
            raise RuntimeError(
                f"failed to parse {path} near line {block_start + 1}: {exc}"
            ) from exc

    return epochs


GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)


def gps_sow_to_utc(
    seconds_of_week: float,
    gps_minus_utc: int,
    now_utc: datetime | None = None,
) -> datetime:
    """Resolve a seconds-of-week value to the nearest current GPS week."""
    now_utc = now_utc or datetime.now(timezone.utc)
    now_gps = now_utc + timedelta(seconds=gps_minus_utc)
    week = int((now_gps - GPS_EPOCH).total_seconds() // 604800)
    candidates = [
        GPS_EPOCH + timedelta(weeks=week + offset, seconds=seconds_of_week)
        - timedelta(seconds=gps_minus_utc)
        for offset in (-1, 0, 1)
    ]
    return min(candidates, key=lambda value: abs((value - now_utc).total_seconds()))


def rtcm_to_epoch(
    message: Any,
    mountpoint: str,
    host: str,
    port: int,
    gps_minus_utc: int,
) -> VtecEpoch:
    """Convert a parsed pyrtcm 4076.201 message to the internal epoch model."""
    from pyrtcm import parse_4076_201

    if getattr(message, "identity", "") != "4076_201":
        raise ValueError("RTCM message is not IGS SSR 4076.201")

    parsed = parse_4076_201(message)
    if not parsed:
        raise ValueError("4076.201 message has no coefficient payload")

    layers: list[SphericalHarmonicLayer] = []
    for layer_zero, coefficients in parsed.items():
        suffix = layer_zero + 1
        degree = int(getattr(message, f"IDF037_{suffix:02d}")) + 1
        order = int(getattr(message, f"IDF038_{suffix:02d}")) + 1
        size = degree + 1
        c_nm = np.zeros((size, size), dtype=float)
        s_nm = np.zeros((size, size), dtype=float)

        cosine_values = iter(coefficients["Cosine Coefficients"])
        sine_values = iter(coefficients["Sine Coefficients"])
        for n in range(size):
            for m in range(min(n, order) + 1):
                c_nm[n, m] = float(next(cosine_values))
        for n in range(1, size):
            for m in range(1, min(n, order) + 1):
                s_nm[n, m] = float(next(sine_values))

        layers.append(
            SphericalHarmonicLayer(
                number=suffix,
                degree=degree,
                order=order,
                height_km=float(coefficients["Layer Height"]),
                c_nm=c_nm,
                s_nm=s_nm,
            )
        )

    seconds_of_week = float(message.IDF003)
    epoch_utc = gps_sow_to_utc(seconds_of_week, gps_minus_utc)
    return VtecEpoch(
        epoch_utc=epoch_utc,
        second_of_day=seconds_of_week % 86400.0,
        update_interval_indicator=int(message.IDF004),
        mountpoint=mountpoint,
        layers=layers,
        source={
            "transport": "NTRIP / IGS SSR",
            "message": "4076.201",
            "caster": f"{host}:{port}",
            "mountpoint": mountpoint,
            "providerId": int(message.IDF008),
            "solutionId": int(message.IDF009),
            "iod": int(message.IDF007),
            "qualityTecu": float(message.IDF041),
            "layerHeightsKm": [layer.height_km for layer in layers],
        },
    )


def epoch_to_bnc_ssr(epoch: VtecEpoch) -> str:
    """Serialize one decoded RTCM VTEC epoch in BNC-compatible ASCII form."""
    stamp = epoch.epoch_utc.astimezone(timezone.utc)
    second = stamp.second + stamp.microsecond / 1e6
    lines = [
        (
            f"> VTEC {stamp.year:04d} {stamp.month:02d} {stamp.day:02d} "
            f"{stamp.hour:02d} {stamp.minute:02d} {second:04.1f} "
            f"{epoch.update_interval_indicator:d} {len(epoch.layers):d} "
            f"{epoch.mountpoint}"
        )
    ]
    for layer in epoch.layers:
        lines.append(
            f"{layer.number:2d} {layer.degree:2d} {layer.order:2d} "
            f"{layer.height_km * 1000.0:10.1f}"
        )
        for matrix in (layer.c_nm, layer.s_nm):
            for row in matrix:
                lines.append(" ".join(f"{value:10.4f}" for value in row) + " ")
    return "\n".join(lines) + "\n"


class FrameStore:
    def __init__(self, database: Path, history_hours: float) -> None:
        database.parent.mkdir(parents=True, exist_ok=True)
        self.database = database
        self.history_hours = history_hours
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(
            database,
            check_same_thread=False,
            timeout=30,
        )
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS frames (
                epoch TEXT PRIMARY KEY,
                mountpoint TEXT NOT NULL,
                source_json TEXT NOT NULL,
                values_blob BLOB NOT NULL,
                minimum REAL NOT NULL,
                maximum REAL NOT NULL,
                mean REAL NOT NULL,
                received_at TEXT NOT NULL
            )
            """
        )
        self.connection.commit()

    @staticmethod
    def _pack(values: np.ndarray) -> bytes:
        array = np.asarray(values, dtype="<f4").reshape(GRID_SHAPE)
        return zlib.compress(array.tobytes(order="C"), level=6)

    @staticmethod
    def _unpack(payload: bytes) -> np.ndarray:
        raw = zlib.decompress(payload)
        return np.frombuffer(raw, dtype="<f4").reshape(GRID_SHAPE).copy()

    def put(self, frame: GridFrame) -> bool:
        epoch = iso_utc(frame.epoch_utc)
        with self.lock:
            cursor = self.connection.execute(
                """
                INSERT OR IGNORE INTO frames (
                    epoch, mountpoint, source_json, values_blob,
                    minimum, maximum, mean, received_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    epoch,
                    frame.mountpoint,
                    json.dumps(
                        frame.source,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    self._pack(frame.values),
                    frame.minimum,
                    frame.maximum,
                    frame.mean,
                    iso_utc(datetime.now(timezone.utc)),
                ),
            )
            cutoff = iso_utc(
                datetime.now(timezone.utc)
                - timedelta(hours=self.history_hours + 1.0)
            )
            self.connection.execute(
                "DELETE FROM frames WHERE epoch < ?",
                (cutoff,),
            )
            self.connection.commit()
            return cursor.rowcount > 0

    def _rows(self, limit: int) -> list[sqlite3.Row]:
        self.connection.row_factory = sqlite3.Row
        rows = self.connection.execute(
            "SELECT * FROM frames ORDER BY epoch DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return list(reversed(rows))

    @staticmethod
    def _public_frame(row: sqlite3.Row, values: np.ndarray) -> dict[str, Any]:
        return {
            "epoch": row["epoch"],
            "values": np.round(values.reshape(-1), 2).tolist(),
            "min": round(float(row["minimum"]), 2),
            "max": round(float(row["maximum"]), 2),
            "mean": round(float(row["mean"]), 2),
            "source": json.loads(row["source_json"]),
        }

    @staticmethod
    def grid_metadata() -> dict[str, Any]:
        return {
            "lat": LATITUDES.tolist(),
            "lon": LONGITUDES.tolist(),
            "shape": [int(GRID_SHAPE[0]), int(GRID_SHAPE[1])],
            "resolution": {"lat": 2.5, "lon": 5.0},
            "unit": "TECU",
        }

    def latest_payload(self) -> dict[str, Any] | None:
        with self.lock:
            rows = self._rows(1)
            if not rows:
                return None
            row = rows[0]
            return {
                "schema": SCHEMA,
                "status": "live",
                "generatedAt": iso_utc(datetime.now(timezone.utc)),
                "grid": self.grid_metadata(),
                "frame": self._public_frame(row, self._unpack(row["values_blob"])),
            }

    def frames_payload(
        self,
        limit: int,
        status: str = "live",
    ) -> dict[str, Any] | None:
        limit = max(1, min(limit, 96))
        with self.lock:
            rows = self._rows(limit)
            if not rows:
                return None
            return {
                "schema": SCHEMA,
                "status": status,
                "generatedAt": iso_utc(datetime.now(timezone.utc)),
                "grid": self.grid_metadata(),
                "frames": [
                    self._public_frame(row, self._unpack(row["values_blob"]))
                    for row in rows
                ],
                "latestIndex": len(rows) - 1,
            }

    def series_payload(
        self,
        latitude: float,
        longitude: float,
        hours: float,
    ) -> dict[str, Any] | None:
        latitude_index = int(np.argmin(np.abs(LATITUDES - latitude)))
        longitude_index = int(np.argmin(np.abs(LONGITUDES - longitude)))
        cutoff = iso_utc(
            datetime.now(timezone.utc)
            - timedelta(hours=max(0.25, min(hours, self.history_hours)))
        )
        with self.lock:
            self.connection.row_factory = sqlite3.Row
            rows = self.connection.execute(
                """
                SELECT epoch, values_blob
                FROM frames
                WHERE epoch >= ?
                ORDER BY epoch ASC
                """,
                (cutoff,),
            ).fetchall()
            if not rows:
                rows = self.connection.execute(
                    """
                    SELECT epoch, values_blob
                    FROM frames
                    ORDER BY epoch DESC
                    LIMIT 96
                    """
                ).fetchall()
                rows = list(reversed(rows))
            if not rows:
                return None

            points = []
            for row in rows:
                values = self._unpack(row["values_blob"])
                value = float(values[latitude_index, longitude_index])
                points.append(
                    {
                        "epoch": row["epoch"],
                        "value": round(value, 3) if math.isfinite(value) else None,
                    }
                )

            return {
                "schema": SCHEMA,
                "status": "live",
                "unit": "TECU",
                "selected": {
                    "lat": float(LATITUDES[latitude_index]),
                    "lon": float(LONGITUDES[longitude_index]),
                    "latIndex": latitude_index,
                    "lonIndex": longitude_index,
                },
                "points": points,
            }

    def close(self) -> None:
        with self.lock:
            self.connection.close()


def process_epoch(
    epoch: VtecEpoch,
    recoverer: GridRecoverer,
    store: FrameStore,
    ssr_output_dir: Path | None = None,
) -> bool:
    frame = recoverer.recover(epoch)
    inserted = store.put(frame)
    if not inserted:
        return False

    if ssr_output_dir is not None:
        ssr_output_dir.mkdir(parents=True, exist_ok=True)
        stamp = epoch.epoch_utc.astimezone(timezone.utc)
        day_of_year = stamp.timetuple().tm_yday
        filename = (
            f"{epoch.mountpoint}_S_{stamp.year:04d}{day_of_year:03d}"
            f"0000_01D_ION.ssr"
        )
        with (ssr_output_dir / filename).open(
            "a",
            encoding="ascii",
            newline="\n",
        ) as stream:
            stream.write(epoch_to_bnc_ssr(epoch))

    print(
        f"[GIM] {iso_utc(epoch.epoch_utc)} {epoch.mountpoint} "
        f"min={frame.minimum:.2f} max={frame.maximum:.2f} "
        f"mean={frame.mean:.2f} TECU",
        flush=True,
    )
    return True


def ntrip_request(
    host: str,
    port: int,
    mountpoint: str,
    username: str,
    password: str,
) -> tuple[socket.socket, Any]:
    sock = socket.create_connection((host, port), timeout=20)
    sock.settimeout(60)
    headers = [
        f"GET /{mountpoint.lstrip('/')} HTTP/1.1",
        f"Host: {host}:{port}",
        "Ntrip-Version: Ntrip/2.0",
        "User-Agent: NTRIP SEGM-Realtime-GIM/1.0",
        "Accept: */*",
        "Connection: close",
    ]
    if username or password:
        token = base64.b64encode(
            f"{username}:{password}".encode("utf-8")
        ).decode("ascii")
        headers.append(f"Authorization: Basic {token}")
    request = "\r\n".join(headers) + "\r\n\r\n"
    sock.sendall(request.encode("ascii"))

    stream = sock.makefile("rb")
    status_line = stream.readline(4096).decode("latin-1", errors="replace").strip()
    response_headers: dict[str, str] = {}
    while True:
        line = stream.readline(8192)
        if line in (b"", b"\r\n", b"\n"):
            break
        text = line.decode("latin-1", errors="replace")
        if ":" in text:
            name, value = text.split(":", 1)
            response_headers[name.strip().lower()] = value.strip()

    if "200" not in status_line:
        stream.close()
        sock.close()
        raise ConnectionError(f"NTRIP request failed: {status_line}")
    if response_headers.get("transfer-encoding", "").lower() == "chunked":
        stream.close()
        sock.close()
        raise ConnectionError(
            "Caster returned chunked NTRIP. Configure the caster for raw "
            "RTCM streaming or use the existing BNC receiver with --mode watch."
        )
    return sock, stream


def run_ntrip(
    args: argparse.Namespace,
    recoverer: GridRecoverer,
    store: FrameStore,
    stop_event: threading.Event,
) -> None:
    try:
        from pyrtcm import RTCMReader
    except ImportError as exc:
        raise RuntimeError(
            "pyrtcm is required for --mode ntrip. Install "
            "scripts/requirements-realtime.txt first."
        ) from exc

    received = 0
    delay = 2.0
    while not stop_event.is_set():
        sock: socket.socket | None = None
        stream: Any = None
        try:
            print(
                f"[NTRIP] connecting to {args.host}:{args.port}/"
                f"{args.mountpoint} (anonymous={not bool(args.username)})",
                flush=True,
            )
            sock, stream = ntrip_request(
                args.host,
                args.port,
                args.mountpoint,
                args.username,
                args.password,
            )
            print("[NTRIP] stream connected", flush=True)
            delay = 2.0
            reader = RTCMReader(stream)
            for _, message in reader:
                if stop_event.is_set():
                    break
                if getattr(message, "identity", "") != "4076_201":
                    continue
                epoch = rtcm_to_epoch(
                    message,
                    args.mountpoint,
                    args.host,
                    args.port,
                    args.gps_minus_utc,
                )
                if process_epoch(
                    epoch,
                    recoverer,
                    store,
                    args.ssr_output_dir,
                ):
                    received += 1
                    if args.max_frames and received >= args.max_frames:
                        stop_event.set()
                        break
        except Exception as exc:
            if not stop_event.is_set():
                print(f"[NTRIP] {type(exc).__name__}: {exc}", file=sys.stderr)
                stop_event.wait(delay)
                delay = min(delay * 2.0, 60.0)
        finally:
            if stream is not None:
                try:
                    stream.close()
                except Exception:
                    pass
            if sock is not None:
                try:
                    sock.close()
                except Exception:
                    pass


def changed_ssr_files(
    pattern: str,
    known_mtimes: dict[str, int],
) -> list[str]:
    changed = []
    for filename in sorted(glob.glob(pattern)):
        try:
            mtime = Path(filename).stat().st_mtime_ns
        except OSError:
            continue
        if known_mtimes.get(filename) != mtime:
            known_mtimes[filename] = mtime
            changed.append(filename)
    return changed


def process_ssr_files(
    filenames: Iterable[str],
    recoverer: GridRecoverer,
    store: FrameStore,
    mountpoint: str | None,
    max_frames: int,
) -> int:
    count = 0
    for filename in filenames:
        for epoch in parse_bnc_ssr_file(filename):
            if mountpoint and epoch.mountpoint != mountpoint:
                continue
            if process_epoch(epoch, recoverer, store):
                count += 1
                if max_frames and count >= max_frames:
                    return count
    return count


def run_watch(
    args: argparse.Namespace,
    recoverer: GridRecoverer,
    store: FrameStore,
    stop_event: threading.Event,
) -> None:
    known_mtimes: dict[str, int] = {}
    received = 0
    while not stop_event.is_set():
        try:
            files = changed_ssr_files(args.ssr_glob, known_mtimes)
            if not files and not known_mtimes:
                print(
                    f"[WATCH] waiting for SSR files: {args.ssr_glob}",
                    flush=True,
                )
            received += process_ssr_files(
                files,
                recoverer,
                store,
                args.mountpoint or None,
                max(0, args.max_frames - received) if args.max_frames else 0,
            )
            if args.max_frames and received >= args.max_frames:
                stop_event.set()
                break
        except Exception as exc:
            print(f"[WATCH] {type(exc).__name__}: {exc}", file=sys.stderr)
        stop_event.wait(args.watch_interval)


class RealtimeRequestHandler(BaseHTTPRequestHandler):
    store: FrameStore
    default_frames_limit: int
    verbose_http: bool

    def _send_json(
        self,
        payload: dict[str, Any],
        status: HTTPStatus = HTTPStatus.OK,
    ) -> None:
        body = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _waiting(self) -> None:
        self._send_json(
            {
                "schema": SCHEMA,
                "status": "waiting",
                "message": "No complete SSR VTEC epoch has been received yet.",
            },
            HTTPStatus.SERVICE_UNAVAILABLE,
        )

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)

        try:
            if path in ("/health", "/health.json"):
                latest = self.store.latest_payload()
                self._send_json(
                    {
                        "schema": SCHEMA,
                        "status": "live" if latest else "waiting",
                        "time": iso_utc(datetime.now(timezone.utc)),
                        "latestEpoch": (
                            latest["frame"]["epoch"] if latest else None
                        ),
                    }
                )
                return

            if path.endswith("/latest.json"):
                payload = self.store.latest_payload()
                if payload is None:
                    self._waiting()
                else:
                    self._send_json(payload)
                return

            if path.endswith("/frames.json"):
                limit = int(
                    query.get("limit", [self.default_frames_limit])[0]
                )
                payload = self.store.frames_payload(limit)
                if payload is None:
                    self._waiting()
                else:
                    self._send_json(payload)
                return

            if path.endswith("/series.json"):
                latitude = float(query.get("lat", ["0"])[0])
                longitude = float(query.get("lon", ["0"])[0])
                hours = float(query.get("hours", ["24"])[0])
                payload = self.store.series_payload(
                    latitude,
                    longitude,
                    hours,
                )
                if payload is None:
                    self._waiting()
                else:
                    self._send_json(payload)
                return

            self._send_json(
                {
                    "schema": SCHEMA,
                    "status": "error",
                    "message": "Unknown endpoint.",
                },
                HTTPStatus.NOT_FOUND,
            )
        except (ValueError, TypeError) as exc:
            self._send_json(
                {
                    "schema": SCHEMA,
                    "status": "error",
                    "message": str(exc),
                },
                HTTPStatus.BAD_REQUEST,
            )
        except Exception as exc:
            self._send_json(
                {
                    "schema": SCHEMA,
                    "status": "error",
                    "message": f"{type(exc).__name__}: {exc}",
                },
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def log_message(self, fmt: str, *args: Any) -> None:
        if self.verbose_http:
            super().log_message(fmt, *args)


def serve_http(
    store: FrameStore,
    host: str,
    port: int,
    frames_limit: int,
    verbose: bool,
) -> ThreadingHTTPServer:
    handler = type(
        "ConfiguredRealtimeRequestHandler",
        (RealtimeRequestHandler,),
        {
            "store": store,
            "default_frames_limit": frames_limit,
            "verbose_http": verbose,
        },
    )
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("ntrip", "watch", "once"),
        default="ntrip",
        help="NTRIP direct decode, watch existing SSR files, or convert once.",
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--mountpoint", default=DEFAULT_MOUNTPOINT)
    parser.add_argument(
        "--username",
        default=os.environ.get("NTRIP_USERNAME", ""),
        help="Prefer environment NTRIP_USERNAME; blank means anonymous.",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("NTRIP_PASSWORD", ""),
        help="Prefer environment NTRIP_PASSWORD.",
    )
    parser.add_argument(
        "--gps-minus-utc",
        type=int,
        default=18,
        help="Current GPST-UTC offset used for RTCM epoch labels.",
    )
    parser.add_argument(
        "--ssr-glob",
        default=str(Path("runtime/realtime/ssr") / "*.ssr"),
        help="Input glob for watch/once mode.",
    )
    parser.add_argument(
        "--ssr-output-dir",
        type=Path,
        default=Path("runtime/realtime/ssr"),
        help="Archive decoded NTRIP messages as BNC-compatible SSR ASCII.",
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=Path("runtime/realtime/gim.sqlite3"),
    )
    parser.add_argument("--history-hours", type=float, default=24.0)
    parser.add_argument("--frames-limit", type=int, default=24)
    parser.add_argument("--watch-interval", type=float, default=5.0)
    parser.add_argument("--http-host", default="127.0.0.1")
    parser.add_argument("--http-port", type=int, default=8765)
    parser.add_argument("--no-http", action="store_true")
    parser.add_argument("--verbose-http", action="store_true")
    parser.add_argument(
        "--max-frames",
        type=int,
        default=0,
        help="Stop after N new frames; useful for validation.",
    )
    parser.add_argument(
        "--export-json",
        type=Path,
        help="In once mode, export a browser-compatible frames payload.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.history_hours <= 0:
        raise SystemExit("--history-hours must be positive")
    if args.mode in ("watch", "once") and not args.ssr_glob:
        raise SystemExit("--ssr-glob is required in watch/once mode")

    store = FrameStore(args.database, args.history_hours)
    recoverer = GridRecoverer()
    stop_event = threading.Event()

    def request_stop(*_: Any) -> None:
        stop_event.set()

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)

    try:
        if args.mode == "once":
            files = sorted(glob.glob(args.ssr_glob))
            if not files:
                raise FileNotFoundError(
                    f"no SSR file matches {args.ssr_glob!r}"
                )
            process_ssr_files(
                files,
                recoverer,
                store,
                args.mountpoint or None,
                args.max_frames,
            )
            if args.export_json:
                payload = store.frames_payload(
                    args.frames_limit,
                    status="sample",
                )
                if payload is None:
                    raise RuntimeError("no frame is available for JSON export")
                args.export_json.parent.mkdir(parents=True, exist_ok=True)
                args.export_json.write_text(
                    json.dumps(
                        payload,
                        ensure_ascii=False,
                        separators=(",", ":"),
                        allow_nan=False,
                    ),
                    encoding="utf-8",
                )
                print(f"[WRITE] {args.export_json}", flush=True)
            return 0

        runner = run_ntrip if args.mode == "ntrip" else run_watch
        if args.no_http:
            runner(args, recoverer, store, stop_event)
            return 0

        receiver = threading.Thread(
            target=runner,
            args=(args, recoverer, store, stop_event),
            name=f"realtime-{args.mode}",
            daemon=True,
        )
        receiver.start()
        server = serve_http(
            store,
            args.http_host,
            args.http_port,
            args.frames_limit,
            args.verbose_http,
        )
        server.timeout = 1.0
        print(
            f"[HTTP] http://{args.http_host}:{args.http_port} "
            f"(mode={args.mode})",
            flush=True,
        )
        while not stop_event.is_set():
            server.handle_request()
        server.server_close()
        receiver.join(timeout=5)
        return 0
    finally:
        store.close()


if __name__ == "__main__":
    raise SystemExit(main())
