---
name: normalize-movie-filename
description: Use this skill when the task involves converting noisy release filenames into a clean probable movie title and optional year, especially before querying TMDb or OMDb.
---

# Normalize Movie Filename

## Goal
Turn filenames like `The.Matrix.1999.1080p.BluRay.x264.YIFY.mkv` into a clean candidate title such as `The Matrix` and detect the year if present.

## Instructions
1. Remove file extensions first.
2. Replace separators like `.`, `_`, and `-` with spaces.
3. Remove release noise such as resolutions, codecs, rip sources, release groups, and language tags.
4. Extract a 4-digit year when available.
5. Return a normalized title with minimal assumptions.

## Constraints
- Never use the full raw filename as the final display title if it still contains release noise.
- If multiple candidate years appear, prefer the first plausible movie-release year.
