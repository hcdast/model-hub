const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

/** Serve the built SPA and its same-origin API; no frontend dependencies required. */
function createPortalServer({ root = path.join(__dirname, 'dist'), apiTarget = process.env.PORTAL_API_TARGET || 'http://127.0.0.1:7000' } = {}) {
  const directory = path.resolve(root);
  const upstream = new URL(apiTarget);
  if (!['http:', 'https:'].includes(upstream.protocol)) throw new Error('PORTAL_API_TARGET must be an HTTP(S) origin');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname.startsWith('/api/')) {
      // The backend routes start with /v1. Keep cookies and authorization intact.
      const transport = upstream.protocol === 'https:' ? https : http;
      const targetPath = requestUrl.pathname.slice(4) + requestUrl.search;
      const proxy = transport.request({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port, method: req.method, path: targetPath, headers: { ...req.headers, host: upstream.host } }, response => {
        res.writeHead(response.statusCode || 502, response.headers);
        response.pipe(res);
      });
      proxy.setTimeout(60000, () => proxy.destroy(new Error('API timeout')));
      proxy.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 502, message: 'API service unavailable' }));
      });
      req.on('aborted', () => proxy.destroy());
      req.pipe(proxy);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(requestUrl.pathname); } catch { res.writeHead(400); res.end(); return; }
    if (pathname.includes('\0')) { res.writeHead(400); res.end(); return; }
    let file = path.resolve(directory, `.${pathname}`);
    if (file !== directory && !file.startsWith(`${directory}${path.sep}`)) { res.writeHead(403); res.end(); return; }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        if (path.extname(pathname)) { res.writeHead(404); res.end(); return; }
        file = path.join(directory, 'index.html');
      }
      fs.stat(file, (statError, fileStat) => {
        if (statError || !fileStat.isFile()) { res.writeHead(404); res.end('Build the portal first.'); return; }
        res.writeHead(200, {
          'Content-Type': types[path.extname(file)] || 'application/octet-stream',
          'Content-Length': fileStat.size,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': file.startsWith(path.join(directory, 'assets') + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = fs.createReadStream(file);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
      });
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 7004);
  createPortalServer().listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Model Hub portal listening on ${port}`));
}
module.exports = { createPortalServer };
