"""Scan run and model folders and write the JSON indexes the site's viewer reads.

Runs before every render (see `pre-render` in _quarto.yml). You never need to
run it by hand, but `python scripts/build_index.py` works for a quick check.

A folder becomes an entry when it holds a `run.yml` (checkerboard runs, in
results/runs/) or a `model.yml` (starting models, in models/). Images in the
folder are sorted automatically by file name:

  - a number followed by "km" (z020km.png, slice_20km.png, ..._20 km.png)
      -> recovered depth slice at that depth
  - a name starting with "true" plus a depth (true_z020km.png)
      -> true pattern at that depth
  - a name starting with "true" and no depth (true_checkerboard.png)
      -> true pattern used at every depth
  - anything else (profiles, residuals, GIFs)
      -> "Other figures", captioned from the file name
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"}
DEPTH_RE = re.compile(r"(\d+(?:\.\d+)?)\s*km", re.IGNORECASE)


def depth_of(name: str) -> float | None:
    hits = DEPTH_RE.findall(name)
    return float(hits[-1]) if hits else None


def caption_of(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"^\d+[_-]", "", stem)  # "01_profile" -> "profile"
    return re.sub(r"[_-]+", " ", stem).strip().capitalize()


def num(d: float) -> int | float:
    return int(d) if d == int(d) else d


def scan(folder: Path, meta_name: str, url_prefix: str) -> dict | None:
    meta_file = folder / meta_name
    if not meta_file.exists():
        return None
    meta = yaml.safe_load(meta_file.read_text()) or {}

    slices: dict = {}
    true_slices: dict = {}
    true_any = None
    other = []
    for img in sorted(folder.iterdir()):
        if img.suffix.lower() not in IMAGE_EXT:
            continue
        url = f"{url_prefix}/{folder.name}/{img.name}"
        lower = img.name.lower()
        d = depth_of(img.name)
        if lower.startswith("true"):
            if d is None:
                true_any = url
            else:
                true_slices[num(d)] = url
        elif d is not None and img.suffix.lower() != ".gif":
            slices[num(d)] = url
        else:
            other.append({"src": url, "caption": caption_of(img.name)})

    # Optional per-depth metrics: metrics.csv with a depth_km column plus any
    # number of metric columns (ssim, corr, ...).
    metrics = None
    mfile = folder / "metrics.csv"
    if mfile.exists():
        with mfile.open() as fh:
            rows = list(csv.DictReader(fh))
        if rows and "depth_km" in rows[0]:
            cols = [c for c in rows[0] if c != "depth_km"]
            metrics = {
                c: {num(float(r["depth_km"])): float(r[c]) for r in rows if r.get(c) not in (None, "")}
                for c in cols
            }

    for key in ("date",):
        if key in meta and not isinstance(meta[key], str):
            meta[key] = str(meta[key])

    captions = meta.pop("captions", {}) or {}
    for o in other:
        fname = o["src"].rsplit("/", 1)[-1]
        if fname in captions:
            o["caption"] = captions[fname]

    return {
        "id": folder.name,
        **meta,
        "depths": sorted(set(slices) | set(true_slices)),
        "slices": {str(k): v for k, v in sorted(slices.items())},
        "true": {str(k): v for k, v in sorted(true_slices.items())},
        "true_any": true_any,
        "other": other,
        "metrics": {c: {str(k): v for k, v in sorted(m.items())} for c, m in metrics.items()} if metrics else None,
    }


def build(section: str, meta_name: str) -> list[dict]:
    base = ROOT / section
    entries = []
    if base.exists():
        for folder in sorted(p for p in base.iterdir() if p.is_dir()):
            e = scan(folder, meta_name, folder.parent.name)
            if e:
                entries.append(e)
    # Newest first; undated entries last, in folder-name order.
    entries.sort(key=lambda e: e["id"])
    entries.sort(key=lambda e: e.get("date") or "", reverse=True)
    return entries


def main() -> None:
    runs = build("results/runs", "run.yml")
    (ROOT / "results" / "runs.json").write_text(json.dumps(runs, indent=1))
    models = build("models/items", "model.yml")
    (ROOT / "models" / "models.json").write_text(json.dumps(models, indent=1))
    print(f"build_index: {len(runs)} runs, {len(models)} models")


if __name__ == "__main__":
    main()
