@echo off
setlocal

REM Este script SIEMPRE sirve desde la carpeta donde vive el .bat (biolab-app/),
REM sin importar desde donde lo ejecutes (doble click, acceso directo, terminal).
REM Si alguna vez esta copia del .bat termina en una carpeta vieja (biolab-app - copia,
REM etc.), el path que imprime abajo lo va a delatar de inmediato.
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ==========================================
echo  BIOLAB - sirviendo desde:
echo  %ROOT%
echo ==========================================
echo.

REM Si quedo un servidor viejo colgado en el puerto 8000 (por ejemplo, una
REM ventana cerrada sin terminar el proceso), lo cerramos antes de arrancar
REM para evitar "address already in use" o quedar pegado a la version vieja.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo Cerrando proceso viejo en el puerto 8000 ^(PID %%p^)...
    taskkill /F /PID %%p >nul 2>&1
)

echo Iniciando servidor en http://localhost:8000 ...
echo ^(Ctrl+C para detener^)
echo.
python -m http.server 8000

endlocal
