#!/usr/bin/env python3
"""Hardened relay for Resume Tailor. Standard library only."""

import hmac
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TARGET_BASE_URL = os.environ.get('TARGET_BASE_URL', 'https://api.tokenbay.com').rstrip('/')
UPSTREAM_API_KEY = os.environ.get('UPSTREAM_API_KEY', '')
ACCESS_TOKEN = os.environ.get('ACCESS_TOKEN', '')
PORT = int(os.environ.get('PORT', '8787'))
UPSTREAM_TIMEOUT = int(os.environ.get('UPSTREAM_TIMEOUT', '120'))
RATE_LIMIT_PER_MIN = int(os.environ.get('RATE_LIMIT_PER_MIN', '20'))
MAX_BODY_BYTES = 1000000
ALLOWED_PREFIX = '/v1/'
PASS_HEADERS = (
    'content-type',
    'accept',
    'user-agent',
    'anthropic-version',
    'anthropic-beta',
    'anthropic-dangerous-direct-browser-access',
)

if UPSTREAM_API_KEY and not ACCESS_TOKEN:
    sys.exit('Refusing to start: UPSTREAM_API_KEY is set but ACCESS_TOKEN is empty.')

_hits = []
_lock = threading.Lock()


def allow_request():
    now = time.time()
    with _lock:
        while _hits and _hits[0] < now - 60:
            _hits.pop(0)
        if len(_hits) >= RATE_LIMIT_PER_MIN:
            return False
        _hits.append(now)
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = 'relay'
    sys_version = ''

    def _send(self, status, body, ctype='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message):
        self._send(status, json.dumps({'error': message}).encode('utf-8'))

    def _client_token(self):
        auth = self.headers.get('Authorization', '')
        if auth.lower().startswith('bearer '):
            return auth[7:].strip()
        return (self.headers.get('x-api-key') or '').strip()

    def do_GET(self):
        if self.path == '/healthz':
            self._send(200, b'ok', 'text/plain')
        else:
            self._forward()

    def do_POST(self):
        self._forward()

    def _forward(self):
        if not self.path.startswith(ALLOWED_PREFIX):
            return self._error(404, 'not found')

        if UPSTREAM_API_KEY:
            supplied = self._client_token().encode('utf-8')
            if not hmac.compare_digest(supplied, ACCESS_TOKEN.encode('utf-8')):
                return self._error(401, 'unauthorized')

        if not allow_request():
            return self._error(429, 'too many requests, slow down')

        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            return self._error(400, 'bad request')

        if length > MAX_BODY_BYTES:
            return self._error(413, 'request too large')

        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() in PASS_HEADERS}

        if UPSTREAM_API_KEY:
            headers['Authorization'] = 'Bearer ' + UPSTREAM_API_KEY
            headers['x-api-key'] = UPSTREAM_API_KEY
        else:
            for name in ('Authorization', 'x-api-key'):
                if self.headers.get(name):
                    headers[name] = self.headers[name]

        headers['Accept-Encoding'] = 'identity'
        req = urllib.request.Request(
            TARGET_BASE_URL + self.path,
            data=body,
            headers=headers,
            method=self.command,
        )
        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
                payload = resp.read()
                self._send(resp.status, payload, resp.headers.get('Content-Type', 'application/json'))
        except urllib.error.HTTPError as e:
            self._send(e.code, e.read(), e.headers.get('Content-Type', 'application/json'))
        except Exception as e:
            print('[relay] upstream error:', repr(e), flush=True)
            self._error(502, 'upstream request failed')

    def log_message(self, fmt, *args):
        print('[relay]', self.address_string(), fmt % args, flush=True)


if __name__ == '__main__':
    print('Relay listening on 0.0.0.0:%d -> %s' % (PORT, TARGET_BASE_URL), flush=True)
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()