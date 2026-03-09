from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.services.file_scanner import scan_video_files
from app.services.summary import build_safe_summary

app = FastAPI(title="Movie Library Starter")
templates = Jinja2Templates(directory="app/templates")


@app.get("/", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "movies": [],
            "selected_path": "",
            "error": None,
        },
    )


@app.post("/scan", response_class=HTMLResponse)
async def scan(request: Request, folder_path: str = Form(...)) -> HTMLResponse:
    root = Path(folder_path).expanduser()

    if not root.exists() or not root.is_dir():
        return templates.TemplateResponse(
            request,
            "index.html",
            {
                "movies": [],
                "selected_path": folder_path,
                "error": "La carpeta no existe o no es válida.",
            },
            status_code=400,
        )

    movies = []
    for item in scan_video_files(root):
        item["safe_summary"] = build_safe_summary(item["detected_title"], item.get("detected_year"))
        movies.append(item)

    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "movies": movies,
            "selected_path": str(root),
            "error": None,
        },
    )
