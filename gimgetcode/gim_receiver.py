#!/usr/bin/env python3
"""用于 IGS-SSR VTEC（RTCM 4076 IM201）的最小化长时间运行 NTRIP 接收器。"""

from __future__ import annotations

import argparse
import base64
import logging
import os
import random
import signal
import socket
import ssl
import struct
import threading
import time
import tomllib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import BinaryIO, Iterator
from urllib.parse import unquote, urlsplit


LOG = logging.getLogger("gim_receiver")
# GPS 纪元参考，用于将 GPS 周秒转换为日历日期时间。
GPS_EPOCH = datetime(1980, 1, 6, tzinfo=timezone.utc)
WEEK_SECONDS = 7 * 86400


@dataclass(frozen=True)
class StreamConfig:
    """单个 NTRIP 数据流的配置。"""

    name: str
    url: str
    username: str
    password: str
    ntrip_version: int
    verify_tls: bool


@dataclass(frozen=True)
class AppConfig:
    """从 TOML 加载的全局应用配置。"""

    data_root: Path
    save_raw: bool
    connect_timeout: float
    read_timeout: float
    reconnect_initial: float
    reconnect_max: float
    heartbeat_interval: float
    streams: tuple[StreamConfig, ...]


@dataclass(frozen=True)
class IonoLayer:
    """单个电离层高度的球谐系数层。"""

    height_m: float
    degree: int
    order: int
    c_nm: tuple[tuple[float, ...], ...]
    s_nm: tuple[tuple[float, ...], ...]


@dataclass(frozen=True)
class VtecMessage:
    """解码后的 VTEC 消息，包含元数据和球谐层信息。"""

    epoch_seconds: int
    update_interval: int
    multiple_message: bool
    ssr_iod: int
    provider_id: int
    solution_id: int
    quality: float
    layers: tuple[IonoLayer, ...]


class BitReader:
    """用于原始 RTCM/IGS-SSR 消息载荷的位级读取器。"""

    def __init__(self, data: bytes):
        self._data = data
        self._position = 0

    def unsigned(self, width: int) -> int:
        """读取宽度为 `width` 位的无符号整数。"""
        if width < 0 or self._position + width > len(self._data) * 8:
            raise ValueError("truncated IGS-SSR message")
        value = 0
        for _ in range(width):
            byte_index, bit_index = divmod(self._position, 8)
            value = (value << 1) | ((self._data[byte_index] >> (7 - bit_index)) & 1)
            self._position += 1
        return value

    def signed(self, width: int) -> int:
        """读取宽度为 `width` 位的二进制补码有符号整数。"""
        value = self.unsigned(width)
        sign = 1 << (width - 1)
        return value - (1 << width) if value & sign else value


def crc24q(data: bytes) -> int:
    """使用多项式 0x1864CFB 计算 RTCM CRC-24Q 校验和。"""
    crc = 0
    for byte in data:
        crc ^= byte << 16
        for _ in range(8):
            crc <<= 1
            if crc & 0x1000000:
                crc ^= 0x1864CFB
    return crc & 0xFFFFFF


class RtcmFramer:
    """从字节流中提取完整 RTCM 帧。"""

    def __init__(self) -> None:
        self._buffer = bytearray()
        self.bad_crc = 0

    def feed(self, data: bytes) -> Iterator[bytes]:
        """馈入原始字节并生成完整且 CRC 验证通过的 RTCM 帧。"""
        self._buffer.extend(data)
        while True:
            start = self._buffer.find(0xD3)
            if start < 0:
                # 缓冲区中未找到有效的 RTCM 起始标记。
                self._buffer.clear()
                return
            if start:
                # 丢弃起始标记前的无效数据。
                del self._buffer[:start]
            if len(self._buffer) < 3:
                # 需要至少 3 个字节来确定载荷长度。
                return
            if self._buffer[1] & 0xFC:
                # 标头位无效，跳过当前字节继续查找。
                del self._buffer[0]
                continue
            payload_size = ((self._buffer[1] & 0x03) << 8) | self._buffer[2]
            frame_size = payload_size + 6
            if len(self._buffer) < frame_size:
                # 等待剩余的帧数据。
                return
            frame = bytes(self._buffer[:frame_size])
            expected = int.from_bytes(frame[-3:], "big")
            if crc24q(frame[:-3]) != expected:
                self.bad_crc += 1
                del self._buffer[0]
                continue
            del self._buffer[:frame_size]
            yield frame


def decode_vtec_frame(frame: bytes) -> VtecMessage | None:
    """解码单个 RTCM VTEC 帧并返回结构化的 VTEC 元数据。

    支持 RTCM 1264 和 IGS-SSR 4076/IM201 帧。如果帧不是支持的 VTEC 类型，返回 None。
    """
    payload_size = ((frame[1] & 0x03) << 8) | frame[2]
    if len(frame) != payload_size + 6 or crc24q(frame[:-3]) != int.from_bytes(frame[-3:], "big"):
        raise ValueError("invalid RTCM frame")

    bits = BitReader(frame[3:-3])
    message_type = bits.unsigned(12)

    if message_type == 4076:
        # IGS-SSR 4076 帧包含一个额外的版本字段。
        bits.unsigned(3)
        if bits.unsigned(8) != 201:
            return None
    elif message_type != 1264:
        return None

    epoch_seconds = bits.unsigned(20)
    update_interval = bits.unsigned(4)
    multiple_message = bool(bits.unsigned(1))
    ssr_iod = bits.unsigned(4)
    provider_id = bits.unsigned(16)
    solution_id = bits.unsigned(4)
    quality = bits.unsigned(9) / 20.0

    # VTEC 包含一个或多个球谐系数层。
    layer_count = bits.unsigned(2) + 1
    layers: list[IonoLayer] = []
    for _ in range(layer_count):
        height_m = bits.unsigned(8) * 10000.0
        degree = bits.unsigned(4) + 1
        order = bits.unsigned(4) + 1
        if order > degree:
            raise ValueError(f"invalid VTEC degree/order {degree}/{order}")

        c = [[0.0] * (order + 1) for _ in range(degree + 1)]
        s = [[0.0] * (order + 1) for _ in range(degree + 1)]

        for m in range(order + 1):
            for n in range(m, degree + 1):
                c[n][m] = bits.signed(16) / 200.0
        for m in range(1, order + 1):
            for n in range(m, degree + 1):
                s[n][m] = bits.signed(16) / 200.0

        layers.append(
            IonoLayer(
                height_m=height_m,
                degree=degree,
                order=order,
                c_nm=tuple(tuple(row) for row in c),
                s_nm=tuple(tuple(row) for row in s),
            )
        )

    return VtecMessage(
        epoch_seconds=epoch_seconds,
        update_interval=update_interval,
        multiple_message=multiple_message,
        ssr_iod=ssr_iod,
        provider_id=provider_id,
        solution_id=solution_id,
        quality=quality,
        layers=tuple(layers),
    )


def resolve_gps_epoch(epoch_seconds: int, now: datetime | None = None) -> datetime:
    """将 GPS 周秒转换为相邻周的日历日期时间。"""
    now = now or datetime.now(timezone.utc)
    # BNC 直接写入 bncTime 日历字段，因此选择相对于当前 UTC 时间最近的 GPS 周。
    gps_now = (now - GPS_EPOCH).total_seconds() + 18.0
    week = int(gps_now // WEEK_SECONDS)
    candidate = GPS_EPOCH + timedelta(seconds=week * WEEK_SECONDS + epoch_seconds)
    while candidate - now > timedelta(days=3.5):
        candidate -= timedelta(days=7)
    while now - candidate > timedelta(days=3.5):
        candidate += timedelta(days=7)
    return candidate


def format_bnc_vtec(message: VtecMessage, mountpoint: str, epoch: datetime) -> str:
    """将解码后的 VTEC 数据格式化为 BNC 兼容的 ASCII 输出。"""
    second = epoch.second + epoch.microsecond / 1_000_000
    lines = [
        f"> VTEC {epoch.year:04d} {epoch.month:02d} {epoch.day:02d} "
        f"{epoch.hour:02d} {epoch.minute:02d} {second:04.1f} "
        f"{message.update_interval} {len(message.layers)} {mountpoint}\n"
    ]
    for number, layer in enumerate(message.layers, start=1):
        lines.append(
            f"{number:2d} {layer.degree:2d} {layer.order:2d} {layer.height_m:10.1f}\n"
        )
        for matrix in (layer.c_nm, layer.s_nm):
            for row in matrix:
                lines.append("".join(f"{value:10.4f}" for value in row) + "\n")
    return "".join(lines)


class ChunkedDecoder:
    def __init__(self) -> None:
        self._buffer = bytearray()
        self._remaining = 0
        self._finished = False

    def feed(self, data: bytes) -> bytes:
        self._buffer.extend(data)
        output = bytearray()
        while not self._finished:
            if self._remaining == 0:
                end = self._buffer.find(b"\r\n")
                if end < 0:
                    break
                line = bytes(self._buffer[:end]).split(b";", 1)[0]
                del self._buffer[: end + 2]
                self._remaining = int(line, 16)
                if self._remaining == 0:
                    self._finished = True
                    break
            if len(self._buffer) < self._remaining + 2:
                break
            output.extend(self._buffer[: self._remaining])
            if self._buffer[self._remaining : self._remaining + 2] != b"\r\n":
                raise OSError("malformed HTTP chunked stream")
            del self._buffer[: self._remaining + 2]
            self._remaining = 0
        return bytes(output)


class NtripConnection:
    def __init__(
        self,
        sock: socket.socket,
        initial: bytes,
        chunked: bool,
        read_timeout: float,
    ):
        self.sock = sock
        self.initial = initial
        self.chunked = ChunkedDecoder() if chunked else None
        self.read_timeout = read_timeout

    def chunks(self, stop: threading.Event) -> Iterator[bytes]:
        pending = self.initial
        last_data = time.monotonic()
        while not stop.is_set():
            try:
                data = pending or self.sock.recv(65536)
            except socket.timeout:
                if time.monotonic() - last_data >= self.read_timeout:
                    raise OSError(
                        f"NTRIP data timeout after {self.read_timeout:g} s"
                    )
                continue
            pending = b""
            if not data:
                raise OSError("NTRIP 链接关闭")
            last_data = time.monotonic()
            if self.chunked:
                data = self.chunked.feed(data)
            if data:
                yield data

    def close(self) -> None:
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


def split_ntrip_response(data: bytes) -> tuple[bytes, bytes] | None:
    """将 NTRIP 响应字节拆分为头部和初始主体数据。"""
    first_line_end = data.find(b"\r\n")
    if first_line_end >= 0 and data[:first_line_end].startswith(b"ICY 200"):
        # 旧版 NTRIP v1 可能省略 HTTP 头部终止符。
        initial = data[first_line_end + 2 :]
        if initial.startswith(b"\r\n"):
            initial = initial[2:]
        return data[:first_line_end], initial
    header_end = data.find(b"\r\n\r\n")
    if header_end >= 0:
        return data[:header_end], data[header_end + 4 :]
    return None


def connect_ntrip(stream: StreamConfig, connect_timeout: float, read_timeout: float) -> NtripConnection:
    """建立 NTRIP 连接并返回一个流式包装。"""
    parsed = urlsplit(stream.url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"{stream.name}: URL 必须是 http[s]://host[:port]/mountpoint")

    port = parsed.port or (443 if parsed.scheme == "https" else 2101)
    sock = socket.create_connection((parsed.hostname, port), timeout=connect_timeout)

    if parsed.scheme == "https":
        context = ssl.create_default_context()
        if not stream.verify_tls:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        sock = context.wrap_socket(sock, server_hostname=parsed.hostname)

    sock.settimeout(connect_timeout)

    username = stream.username or unquote(parsed.username or "")
    password = stream.password or unquote(parsed.password or "")
    target = parsed.path or "/"
    if parsed.query:
        target += "?" + parsed.query

    if stream.ntrip_version == 1:
        headers = [
            f"GET {target} HTTP/1.0",
            "User-Agent: NTRIP BNC/2.13.4 (LINUX)",
            f"Host: {parsed.hostname}",
        ]
    else:
        headers = [
            f"GET {target} HTTP/1.1",
            f"Host: {parsed.hostname}:{port}",
            "Ntrip-Version: Ntrip/2.0",
            "User-Agent: NTRIP gim-receiver/1.0",
            "Accept: */*",
            "Connection: close",
        ]

    if username or password:
        token = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
        headers.append(f"Authorization: Basic {token}")

    sock.sendall(("\r\n".join(headers) + "\r\n\r\n").encode("ascii"))

    response = bytearray()
    split_response: tuple[bytes, bytes] | None = None
    while split_response is None:
        part = sock.recv(4096)
        if not part:
            sock.close()
            raise OSError("在响应头之前链接被关闭")
        response.extend(part)
        split_response = split_ntrip_response(bytes(response))
        if len(response) > 65536:
            sock.close()
            raise OSError("NTRIP 响应头超过 64 KiB")

    header_data, initial = split_response
    header_lines = header_data.split(b"\r\n")
    status = header_lines[0].decode("latin-1", "replace")
    if not (status.startswith("ICY 200") or " 200 " in status):
        sock.close()
        raise OSError(f"caster rejected request: {status}")

    header_map = {}
    for line in header_lines[1:]:
        if b":" in line:
            key, value = line.split(b":", 1)
            header_map[key.strip().lower()] = value.strip().lower()

    is_chunked = b"chunked" in header_map.get(b"transfer-encoding", b"")
    sock.settimeout(1.0)
    return NtripConnection(sock, initial, is_chunked, read_timeout)


class DailyWriter:
    """将原始 RTCM 帧和解码后的 VTEC 文本写入每日文件。"""

    def __init__(self, root: Path, mountpoint: str, save_raw: bool):
        self.root = root
        self.mountpoint = mountpoint
        self.save_raw = save_raw
        self._day_key: tuple[int, int] | None = None
        self._ssr: BinaryIO | None = None
        self._raw: BinaryIO | None = None

    def _rotate(self, epoch: datetime) -> None:
        """当 UTC 日期变化时切换输出文件。"""
        key = (epoch.year, epoch.timetuple().tm_yday)
        if key == self._day_key:
            return
        self.close()

        year, doy = key
        day_root = self.root / f"{year:04d}" / f"{doy:03d}"
        ssr_dir = day_root / "ssr"
        ssr_dir.mkdir(parents=True, exist_ok=True)

        stem = f"{self.mountpoint}_S_{year:04d}{doy:03d}0000_01D_ION"
        self._ssr = open(ssr_dir / f"{stem}.ssr", "ab", buffering=0)

        if self.save_raw:
            raw_dir = day_root / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            self._raw = open(raw_dir / f"{stem}.rtcm3", "ab", buffering=0)

        self._day_key = key

    def write_raw(self, epoch: datetime, frame: bytes) -> None:
        """将原始 RTCM 字节追加到当前日期的原始文件。"""
        self._rotate(epoch)
        if self._raw is not None:
            self._raw.write(frame)

    def write_vtec(self, epoch: datetime, text: str) -> None:
        """将格式化后的 VTEC 文本追加到当前日期的 SSR 文件。"""
        self._rotate(epoch)
        assert self._ssr is not None
        self._ssr.write(text.encode("ascii"))

    def close(self) -> None:
        """关闭所有打开的输出文件。"""
        for stream in (self._ssr, self._raw):
            if stream is not None:
                stream.close()
        self._ssr = None
        self._raw = None
        self._day_key = None


class StreamWorker(threading.Thread):
    """维护单个 NTRIP 数据流连接的工作线程。"""

    def __init__(
        self,
        config: AppConfig,
        stream: StreamConfig,
        stop: threading.Event,
        initial_delay: float = 0.0,
    ):
        super().__init__(name=f"ntrip-{stream.name}", daemon=False)
        self.config = config
        self.stream = stream
        self.stop = stop
        self.initial_delay = initial_delay
        self.frames = 0
        self.vtec_messages = 0
        self.last_message: datetime | None = None

    def run(self) -> None:
        writer = DailyWriter(self.config.data_root, self.stream.name, self.config.save_raw)
        framer = RtcmFramer()
        delay = self.config.reconnect_initial
        try:
            if self.initial_delay > 0:
                LOG.info(
                    "%s: staggered start in %.1f s",
                    self.stream.name,
                    self.initial_delay,
                )
                if self.stop.wait(self.initial_delay):
                    return

            while not self.stop.is_set():
                connection: NtripConnection | None = None
                try:
                    LOG.info("%s: connecting", self.stream.name)
                    connection = connect_ntrip(
                        self.stream, self.config.connect_timeout, self.config.read_timeout
                    )
                    LOG.info("%s: connected", self.stream.name)
                    delay = self.config.reconnect_initial

                    for chunk in connection.chunks(self.stop):
                        for frame in framer.feed(chunk):
                            self.frames += 1
                            writer.write_raw(datetime.now(timezone.utc), frame)
                            message = decode_vtec_frame(frame)
                            if message is None:
                                continue

                            epoch = resolve_gps_epoch(message.epoch_seconds)
                            writer.write_vtec(
                                epoch,
                                format_bnc_vtec(message, self.stream.name, epoch),
                            )
                            self.vtec_messages += 1
                            self.last_message = datetime.now(timezone.utc)
                except Exception as exc:
                    if not self.stop.is_set():
                        wait_seconds = delay * random.uniform(0.8, 1.2)
                        LOG.warning(
                            "%s: %s; reconnect in %.1f s",
                            self.stream.name,
                            exc,
                            wait_seconds,
                        )
                        self.stop.wait(wait_seconds)
                        delay = min(self.config.reconnect_max, max(delay * 2, delay + 1))
                finally:
                    if connection is not None:
                        connection.close()
        finally:
            writer.close()
            LOG.info("%s: stopped", self.stream.name)


def _required_env(name: str, stream_name: str) -> str:
    if not name:
        return ""
    value = os.environ.get(name)
    if value is None:
        raise ValueError(f"{stream_name}: environment variable {name!r} is not set")
    return value


def _credential(item: dict, field: str, stream_name: str) -> str:
    """直接读取凭据或从配置的环境变量中读取。"""
    direct = str(item.get(field, ""))
    env_name = str(item.get(f"{field}_env", ""))
    if direct and env_name:
        raise ValueError(
            f"{stream_name}: set only one of {field!r} or {field + '_env'!r}"
        )
    return direct if direct else _required_env(env_name, stream_name)


def load_config(path: Path) -> AppConfig:
    """从 TOML 文件加载应用配置并验证流设置。"""
    with open(path, "rb") as stream:
        raw = tomllib.load(stream)

    receiver = raw.get("receiver", {})
    streams: list[StreamConfig] = []
    names: set[str] = set()

    for item in raw.get("stream", []):
        name = str(item["name"]).strip()
        if (
            not name
            or name in names
            or any(ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for ch in name)
        ):
            raise ValueError(f"无效或重复的流名称: {name!r}")
        names.add(name)

        version = int(item.get("ntrip_version", 2))
        if version not in (1, 2):
            raise ValueError(f"{name}: ntrip_version must be 1 or 2")

        streams.append(
            StreamConfig(
                name=name,
                url=str(item["url"]),
                username=_credential(item, "username", name),
                password=_credential(item, "password", name),
                ntrip_version=version,
                verify_tls=bool(item.get("verify_tls", True)),
            )
        )

    if not streams:
        raise ValueError("配置中不包含 [[stream]] 条目")

    return AppConfig(
        data_root=Path(receiver.get("data_root", "./data")).expanduser().resolve(),
        save_raw=bool(receiver.get("save_raw", True)),
        connect_timeout=float(receiver.get("connect_timeout", 20)),
        read_timeout=float(receiver.get("read_timeout", 90)),
        reconnect_initial=float(receiver.get("reconnect_initial", 5)),
        reconnect_max=float(receiver.get("reconnect_max", 300)),
        heartbeat_interval=float(receiver.get("heartbeat_interval", 300)),
        streams=tuple(streams),
    )


def configure_logging(level: str, log_file: Path | None) -> None:
    """设置控制台和可选文件日志记录。"""
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="%(asctime)s %(levelname)s [%(threadName)s] %(message)s",
        handlers=handlers,
    )


def main() -> int:
    """NTRIP VTEC 接收器的命令行入口。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=("DEBUG", "INFO", "WARNING", "ERROR"),
    )
    parser.add_argument("--log-file", type=Path)
    parser.add_argument("--check-config", action="store_true")
    args = parser.parse_args()

    configure_logging(args.log_level, args.log_file)
    config = load_config(args.config)

    LOG.info(
        "configuration valid: %d streams, data_root=%s",
        len(config.streams),
        config.data_root,
    )
    if args.check_config:
        return 0

    stop = threading.Event()

    def request_stop(signum: int, _frame: object) -> None:
        LOG.info("received signal %s, stopping", signum)
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    workers = [
        StreamWorker(config, stream, stop, initial_delay=index * 2.0)
        for index, stream in enumerate(config.streams)
    ]
    for worker in workers:
        worker.start()

    try:
        while not stop.wait(config.heartbeat_interval):
            for worker in workers:
                age = (
                    "never"
                    if worker.last_message is None
                    else f"{(datetime.now(timezone.utc) - worker.last_message).total_seconds():.0f}s ago"
                )
                LOG.info(
                    "%s: heartbeat frames=%d vtec=%d last_vtec=%s alive=%s",
                    worker.stream.name,
                    worker.frames,
                    worker.vtec_messages,
                    age,
                    worker.is_alive(),
                )
    finally:
        stop.set()
        for worker in workers:
            worker.join(timeout=config.read_timeout + 5)

    return 0 if all(not worker.is_alive() for worker in workers) else 1


if __name__ == "__main__":
    raise SystemExit(main())
