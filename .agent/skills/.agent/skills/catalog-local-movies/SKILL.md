---
name: catalog-local-movies
description: Use this skill when the user wants to scan a local folder of movie files, detect likely movie titles from filenames, build a personal movie catalog, and prepare metadata/posters/safe summaries without copying large video files.
---

# Catalog Local Movies

## Goal
Create or improve a local movie-library application that reads a folder of video files, identifies likely movie titles, and presents a clean catalog UI.

## Instructions
1. Prefer reading the user's local movie folder instead of uploading or duplicating heavy files.
2. Scan recursively for video extensions like `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, and `.m4v`.
3. Normalize noisy filenames before trying to identify a movie title.
4. Keep file-path indexing separate from external metadata resolution.
5. If metadata integration is not implemented yet, scaffold the interfaces and keep the current app functional.
6. When changing Python code, preserve a simple local-first architecture.
7. If needed, use `scripts/scan_movies.py` as a reference utility.

## Constraints
- Do not copy or re-encode large video files.
- Do not assume the filename is perfect; clean release tags first.
- Do not reveal spoilers in generated summaries.
