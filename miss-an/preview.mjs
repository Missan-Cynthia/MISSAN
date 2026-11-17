import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const types = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', png: 'image/png', webmanifest: 'application/manifest+json'
};
const shoppingAssets = new Set(['index.html', 'app.css', 'app.js', 'orders.js', 'miss-an-logo.png']);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const shoppingPrefix = '/shopping/';
  const shopping = path.startsWith(shoppingPrefix);
  const filename = path.slice(shopping ? shoppingPrefix.length : 1) || 'index.html';
  const publicAsset = /^[a-z0-9-]+\.(html|js|css|png|webmanifest)$/.test(filename);
  if (!(shopping ? shoppingAssets.has(filename) : publicAsset) || request.method !== 'GET') {
    response.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(new URL((shopping ? '../shopping/' : './public/') + filename, import.meta.url));
    response.writeHead(200, {
      'Content-Type': types[filename.split('.').at(-1)],
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    }).end(data);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(Number(process.env.MISS_AN_PORT ?? 4173), '127.0.0.1', () => {
  console.log('MISS AN · http://127.0.0.1:' + server.address().port);
});
