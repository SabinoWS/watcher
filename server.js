// Servidor HTTP simples para servir o player HLS
// Execute: node server.js
// Acesse: http://localhost:8000

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const PORT = 8000;

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);

    // Adicionar headers CORS para permitir requisições cross-origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, Referer, User-Agent, Accept-Language');

    // Responder a requisições OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Proxy para requisições HLS - intercepta requisições para o CDN
    if (req.url.startsWith('/proxy/')) {
        const targetUrl = decodeURIComponent(req.url.substring(7)); // Remove '/proxy/'
        
        try {
            const urlObj = new URL(targetUrl);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;
            
            // Headers exatamente como no curl que funciona
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: req.method,
                headers: {
                    'Origin': 'https://www.anroll.net',
                    'Referer': 'https://www.anroll.net/watch/e/jn4F8vMtiL',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Accept': '*/*',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            };

            const proxyReq = client.request(options, (proxyRes) => {
                // Copiar headers da resposta (exceto alguns que podem causar problemas)
                const headers = { ...proxyRes.headers };
                delete headers['content-encoding']; // Remover encoding para evitar problemas
                delete headers['content-length']; // Deixar o Node calcular
                
                res.writeHead(proxyRes.statusCode, headers);
                proxyRes.pipe(res);
            });

            proxyReq.on('error', (error) => {
                console.error('Erro no proxy:', error);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Erro no proxy: ' + error.message);
            });

            req.pipe(proxyReq);
            return;
        } catch (error) {
            console.error('Erro ao processar URL do proxy:', error);
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('URL inválida');
            return;
        }
    }

    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 - Arquivo não encontrado</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end(`Erro do servidor: ${error.code}`, 'utf-8');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`📺 Abra o player no navegador: http://localhost:${PORT}\n`);
    console.log('Pressione Ctrl+C para parar o servidor\n');
});
