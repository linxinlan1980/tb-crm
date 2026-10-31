import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = resolve(fileURLToPath(new URL('../apps/web/dist/', import.meta.url)));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
http
  .createServer(async (req, res) => {
    if (req.url?.startsWith('/api/')) {
      const proxy = http.request(
        {
          hostname: '127.0.0.1',
          port: Number(process.env.PORT || 4000),
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${process.env.PORT || 4000}` },
        },
        (up) => {
          res.writeHead(up.statusCode || 502, up.headers);
          up.pipe(res);
        },
      );
      proxy.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'API尚未就绪，请稍后重试' }));
      });
      req.pipe(proxy);
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname),
        path = resolve(root, '.' + pathname);
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep) && path !== root) {
        res.writeHead(403).end();
        return;
      }
      let target = path;
      try {
        if (!(await stat(target)).isFile()) target = resolve(root, 'index.html');
      } catch {
        target = resolve(root, 'index.html');
      }
      res.writeHead(200, {
        'Content-Type': mime[extname(target)] || 'application/octet-stream',
        'Cache-Control': target.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      createReadStream(target).pipe(res);
    } catch {
      res.writeHead(400).end('Invalid request');
    }
  })
  .listen(Number(process.env.WEB_PORT || 3000), process.env.WEB_HOST || '127.0.0.1', () =>
    console.log(`CRM Web: http://localhost:${process.env.WEB_PORT || 3000}`),
  );
