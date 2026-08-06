#!/usr/bin/env python3
"""Convert one archived UTC/GPS-calendar day of GIM SSR files to IONEX 1.1."""

from __future__ import annotations

import argparse
import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


ENGINE_PATH = (
    Path(__file__).resolve().parent.parent
    / "python"
    / "ssr_to_ionex4_ionex11_fixed.py"
)


def load_engine():
    spec = importlib.util.spec_from_file_location("ssr_to_ionex_engine", ENGINE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load conversion engine: {ENGINE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def parse_day(value: str | None) -> datetime:
    if value is None:
        return (datetime.now(timezone.utc) - timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    try:
        return datetime.strptime(value, "%Y-%j").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("day must have YYYY-DDD form") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--day", help="YYYY-DDD; defaults to yesterday UTC")
    parser.add_argument("--mountpoint", action="append", default=[], help="repeat to select streams")
    parser.add_argument("--step", type=int, default=300, help="map interval seconds; 0 keeps every epoch")
    parser.add_argument("--quiet", action="store_true", help="suppress per-map statistics")
    args = parser.parse_args()

    day = parse_day(args.day)
    doy = day.timetuple().tm_yday
    day_root = args.data_root.expanduser().resolve() / f"{day.year:04d}" / f"{doy:03d}"
    ssr_dir = day_root / "ssr"
    if not ssr_dir.is_dir():
        parser.error(f"SSR directory does not exist: {ssr_dir}")

    mountpoints = list(dict.fromkeys(args.mountpoint))
    if not mountpoints:
        suffix = f"_S_{day.year:04d}{doy:03d}0000_01D_ION.ssr"
        mountpoints = sorted(
            path.name[: -len(suffix)]
            for path in ssr_dir.glob(f"*{suffix}")
            if path.name.endswith(suffix)
        )
    if not mountpoints:
        parser.error(f"no daily GIM SSR files found in {ssr_dir}")

    engine = load_engine()
    engine.INPUT_PATTERNS = [str(ssr_dir / f"{name}_S_*_ION.ssr") for name in mountpoints]
    engine.OUTPUT_DIR = str(day_root / "ionex")
    engine.OUTPUT_STEP_SECONDS = None if args.step == 0 else args.step
    engine.PRINT_MAP_STATISTICS = not args.quiet
    # This command processes exactly one archived day. Avoid creating a second,
    # partial product solely for the next-day midnight overlap convention.
    engine.INCLUDE_NEXT_DAY_MIDNIGHT = False
    engine.main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
