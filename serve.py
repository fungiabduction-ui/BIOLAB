#!/usr/bin/env python3
"""
============================================================
  BIOLAB ENGINE v3 — servidor local de desarrollo
  Uso:  python serve.py [puerto]
  Default puerto: 8000
============================================================
Sirve la carpeta del proyecto por HTTP y abre el navegador.
Desactiva el caché para que los cambios se reflejen al instante.
"""
from __future__ import annotations

import http.server
import os
import socketserver
import sys
import webbrowser
from pathlib import Path

PORT    = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT    = Path(__file__).resolve().parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Sirve con cache deshabilitado para desarrollo."""
    def end_headers(self) -> None:
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Log más compacto
        sys.stderr.write("  %s  %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    os.chdir(ROOT)
    banner = f"""
 ===============================================
  BIOLAB ENGINE v3 — servidor local
 ===============================================
  Carpeta:  {ROOT}
  URL:      http://localhost:{PORT}

  CTRL+C para detener.
 ===============================================
"""
    print(banner, flush=True)

    # Abrir el navegador en una pestaña nueva
    try:
        webbrowser.open_new_tab(f"http://localhost:{PORT}")
    except Exception:
        pass

    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        httpd.allow_reuse_address = True
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Servidor detenido.")


if __name__ == "__main__":
    main()
