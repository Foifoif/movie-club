#!/usr/bin/env python3
"""Local static file server for movie-club.

`python3 -m http.server` defaults to HTTP/1.0, which closes the TCP
connection after every single request. This page loads ~13 resources
(React, ReactDOM, Babel, Supabase, CSS, and the in-browser-transformed
js/*.js files) nearly simultaneously on first paint, and that connection
churn against a one-shot-per-request server occasionally drops a request.

Babel's in-browser script loader (index.html uses <script type="text/babel">
for js/config.js, db.js, components.js, pages.js, app.js) silently skips a
script tag whose XHR fails, instead of stopping — so a dropped request for
e.g. js/config.js doesn't error loudly, it just lets db.js/components.js
run without the globals config.js was supposed to define (dbSaveRating,
devNow, etc.), surfacing later as a confusing "X is not defined" error deep
inside a component. The app's top-level ErrorBoundary catches the resulting
render crash and shows a friendly fallback screen, but it's still confusing
to hit locally.

This server keeps connections alive (HTTP/1.1) and binds explicitly to
127.0.0.1, which avoids that class of transient failure. Production is
unaffected either way — this repo is deployed on Netlify (see _redirects),
not served by this script.

Usage: python3 serve.py [port]  (defaults to 8000)
"""
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class KeepAliveHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    host = "127.0.0.1"
    with ThreadingHTTPServer((host, port), KeepAliveHandler) as httpd:
        print(f"Serving movie-club at http://{host}:{port}/  (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
