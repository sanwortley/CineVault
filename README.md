<p align="center">
  <img src="public/assets/banner.png" alt="CineVault Banner" width="800">
</p>

# <p align="center">🎬 CineVault</p>

<p align="center">
  Aplicación web full-stack para organizar, explorar y reproducir una biblioteca de películas y series, con autenticación de usuarios, metadatos automáticos y streaming adaptativo.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase">
  <img src="https://img.shields.io/badge/Railway-0B0D0E?style=for-the-badge&logo=railway&logoColor=white" alt="Railway">
</p>

---

## ✨ Qué hace

*   🔐 **Autenticación de usuarios** con Supabase Auth (registro, login, sesión y perfiles).
*   🎬 **Metadatos automáticos** desde [TMDb](https://www.themoviedb.org/): posters, sinopsis, géneros, año y calificaciones.
*   📚 **Biblioteca y exploración**: páginas de biblioteca, explorar contenido, subida y ajustes.
*   📽️ **Reproductor propio** con streaming HLS, saltos de 10 s y atajos de teclado.
*   ☁️ **Integraciones**: Google Drive (OAuth) y Real-Debrid como fuentes de reproducción, configurables por el usuario con su propio token.
*   🧹 **Utilidades de biblioteca**: detector de duplicados, parser de nombres de archivo y scripts de mantenimiento en `tools/`.
*   📱 **PWA**: manifest y service worker incluidos.

---

## 🧱 Arquitectura

```
src/        Frontend: React + Vite + TypeScript + Tailwind (páginas, contexto de auth, reproductor)
backend/    API REST en Node.js + Express + TypeScript (~75 endpoints): scanner, TMDb, Drive, HLS, Real-Debrid
database/   Migraciones SQL para Supabase (perfiles, series, caché de metadatos)
tools/      Scripts de mantenimiento
```

*   **Datos y auth**: Supabase (PostgreSQL + Auth), accedido desde el backend y el frontend.
*   **Deploy**: Railway (`railway.json`, `nixpacks.toml`, `Dockerfile`), con healthcheck en `/health`.

---

## 🛠️ Instalación y desarrollo local

### Requisitos
*   Node.js 18 o superior
*   Un proyecto de [Supabase](https://supabase.com/) y una API key de [TMDb](https://www.themoviedb.org/settings/api)

### Pasos

1.  **Clonar e instalar**:
    ```bash
    git clone https://github.com/sanwortley/CineVault.git
    cd CineVault
    npm install
    ```

2.  **Variables de entorno**: copiá `.env.example` a `.env` y completalo (Supabase, TMDb y, opcionalmente, Google OAuth). Las migraciones SQL de `database/` se aplican en el proyecto de Supabase.

3.  **Levantar frontend y backend juntos**:
    ```bash
    npm run web:dev
    ```

Otros scripts útiles: `npm run build`, `npm run typecheck`.

---

## ⚠️ Notas

*   Las descargas directas por torrent están **deshabilitadas** en el backend (`torrentManager.ts` es un stub).
*   La integración con Real-Debrid requiere el token del propio usuario. Usá este proyecto solo con contenido sobre el que tengas derechos.
*   Proyecto personal de aprendizaje; todavía no tiene tests automatizados.

---

<p align="center">Desarrollado por <a href="https://github.com/sanwortley">Santiago Wortley</a></p>
