from pathlib import Path

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".m4v"}


def scan(root: str) -> list[str]:
    base = Path(root).expanduser()
    return [str(p) for p in base.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS]


if __name__ == "__main__":
    import sys
    for item in scan(sys.argv[1]):
        print(item)
