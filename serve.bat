@echo off
REM ============================================================
REM  BIOLAB ENGINE v3 — servidor local de desarrollo
REM  Doble-click en este archivo para iniciar el servidor.
REM ============================================================

title BIOLAB ENGINE - servidor local

cd /d "%~dp0"

echo.
echo  ===============================================
echo   BIOLAB ENGINE v3 - servidor local
echo  ===============================================
echo.
echo   Carpeta:  %CD%
echo   URL:      http://localhost:8000
echo.
echo   Presiona CTRL+C para detener.
echo  ===============================================
echo.

REM ── 1) Intentar con Python 3 ────────────────────────────────
python --version >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" "http://localhost:8000"
    python -m http.server 8000
    goto :eof
)

REM ── 2) Fallback: Python Launcher ────────────────────────────
py -3 --version >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" "http://localhost:8000"
    py -3 -m http.server 8000
    goto :eof
)

REM ── 3) Fallback: Node.js (npx http-server) ──────────────────
where node >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" "http://localhost:8000"
    npx --yes http-server -p 8000 -c-1 .
    goto :eof
)

echo  [ERROR] No se encontro Python ni Node.js instalados.
echo.
echo   Instalalos desde:
echo     https://www.python.org/downloads/
echo     https://nodejs.org/
echo.
echo  Alternativa rapida: instala la extension "Live Server"
echo  en VSCode y hace click derecho sobre index.html.
echo.
pause
