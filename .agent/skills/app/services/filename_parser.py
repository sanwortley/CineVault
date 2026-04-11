from __future__ import annotations

import re
from typing import Optional

NOISE_PATTERNS = [
    r"\b(480p|720p|1080p|2160p|4k)\b",
    r"\b(x264|x265|h264|h265|hevc)\b",
    r"\b(blu[- ]?ray|brrip|webrip|web[- ]?dl|dvdrip|hdrip)\b",
    r"\b(yify|rarbg|etrg|evo)\b",
    r"\b(dual|latino|subtitulado|spanish|english)\b",
]

YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2}|21\d{2})\b")
SEPARATORS_RE = re.compile(r"[._-]+")
MULTISPACE_RE = re.compile(r"\s+")


def parse_movie_filename(filename: str) -> dict:
    base = re.sub(r"\.[A-Za-z0-9]{2,4}$", "", filename)
    normalized = SEPARATORS_RE.sub(" ", base)

    year_match = YEAR_RE.search(normalized)
    year = int(year_match.group(1)) if year_match else None

    cleaned = normalized
    for pattern in NOISE_PATTERNS:
        cleaned = re.sub(pattern, " ", cleaned, flags=re.IGNORECASE)

    if year_match:
        cleaned = cleaned.replace(year_match.group(0), " ")

    cleaned = MULTISPACE_RE.sub(" ", cleaned).strip()
    title = cleaned.title() if cleaned else base.title()

    return {
        "title": title,
        "year": year,
    }
