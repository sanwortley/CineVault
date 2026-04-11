from __future__ import annotations

from pathlib import Path
from typing import Iterator

from app.services.filename_parser import parse_movie_filename

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".m4v"}


def scan_video_files(root: Path) -> Iterator[dict]:
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue

        parsed = parse_movie_filename(path.name)
        stat = path.stat()

        yield {
            "file_name": path.name,
            "file_path": str(path),
            "file_size_mb": round(stat.st_size / (1024 * 1024), 2),
            "extension": path.suffix.lower(),
            "detected_title": parsed["title"],
            "detected_year": parsed["year"],
        }
