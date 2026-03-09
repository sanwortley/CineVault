# Movie Library Starter (Python + Antigravity Skills)

Proyecto base para catalogar películas desde una carpeta local, identificar el título probable a partir del nombre del archivo, y preparar la app para integrar metadata/posters/resúmenes sin spoilers.

## Stack
- Python 3.11+
- FastAPI
- Jinja2
- Uvicorn
- SQLite (planeado para siguiente iteración)
- Antigravity Skills en `.agent/skills/`

## Qué hace esta base
- Escanea una carpeta local y subcarpetas.
- Detecta archivos de video (`.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.m4v`).
- Limpia nombres de archivo para inferir título y año.
- Muestra una biblioteca simple en web local.
- Deja lista la estructura para conectar TMDb/OMDb y generar resúmenes sin spoilers.

## Ejecutar
```bash
python -m venv .venv
source .venv/bin/activate  # En Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Abrí `http://127.0.0.1:8000`

## Variables opcionales
Copiá `.env.example` a `.env` si más adelante querés integrar una API de películas.

## Estructura
```text
movie_library_antigravity_starter/
├── .agent/
│   └── skills/
│       ├── catalog-local-movies/
│       ├── normalize-movie-filename/
│       └── write-spoiler-free-summary/
├── app/
│   ├── main.py
│   ├── services/
│   │   ├── file_scanner.py
│   │   ├── filename_parser.py
│   │   └── summary.py
│   └── templates/
│       └── index.html
├── requirements.txt
└── .env.example
```
