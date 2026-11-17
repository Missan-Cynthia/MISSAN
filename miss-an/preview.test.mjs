import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const child = spawn(process.execPath, [fileURLToPath(new URL('./preview.mjs', import.meta.url))], {
  env: {...process.env, MISS_AN_PORT: '0'},
  stdio: ['ignore', 'pipe', 'inherit']
});
try {
  const [ready] = await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code]) => { throw new Error('Preview exited early: ' + code); })
  ]);
  const base = ready.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const assets = ['/', '/index.html', '/style.css', '/app.js', '/config.js', '/cloud.js', '/core.js', '/logo.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', '/sw.js'];
  const responses = await Promise.all(assets.map(path => fetch(base + path)));
  responses.forEach((response, index) => assert.equal(response.status, 200, assets[index]));
  const manifest = await responses[10].json();
  assert.equal(manifest.display, 'standalone');
  assert.equal((await fetch(base + '/wardrobe.js')).status, 200);
  assert.equal((await fetch(base + '/firestore.rules')).status, 404);
  assert.equal((await fetch(base + '/core.test.mjs')).status, 404);
  const shopping = await fetch(base + '/shopping/?embedded=1');
  assert.equal(shopping.status, 200);
  assert.match(await shopping.text(), /購物筆記/);
  for (const asset of ['app.css', 'app.js', 'orders.js', 'miss-an-logo.png']) {
    assert.equal((await fetch(base + '/shopping/' + asset)).status, 200, asset);
  }
  assert.equal((await fetch(base + '/shopping/orders.test.cjs')).status, 404);
  console.log('首頁、PWA 資源、購物模組與公開目錄隔離驗證通過。');
} finally {
  child.kill();
}
