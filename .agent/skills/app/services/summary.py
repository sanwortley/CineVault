from __future__ import annotations

from typing import Optional


def build_safe_summary(title: str, year: Optional[int] = None) -> str:
    year_text = f" ({year})" if year else ""
    return (
        f"{title}{year_text} es una película que sigue una premisa central clara y atractiva, "
        "presentando a sus personajes principales, el tono general de la historia y el conflicto inicial, "
        "sin revelar giros importantes ni el desenlace. En una siguiente iteración, este resumen puede "
        "reemplazarse por uno generado desde metadata real de TMDb u OMDb."
    )
