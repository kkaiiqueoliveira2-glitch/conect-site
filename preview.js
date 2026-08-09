// Servidor estatico simples pra ver as edicoes ao vivo. node preview.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORTA = 4321;
const RAIZ = __dirname;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';

    const arquivo = path.join(RAIZ, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!arquivo.startsWith(RAIZ)) {
      res.writeHead(403).end('403');
      return;
    }

    fs.readFile(arquivo, (erro, dados) => {
      if (erro) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + rel);
        return;
      }
      res.writeHead(200, {
        'content-type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(dados);
    });
  })
  .listen(PORTA, () => console.log(`preview em http://localhost:${PORTA}`));
