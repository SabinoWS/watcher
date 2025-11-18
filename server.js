// Servidor HTTP simples para servir o player HLS
// Execute: node server.js
// Acesse: http://localhost:8000

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

    // Endpoint para extrair link do stream do anroll.net
    if (req.url.startsWith('/extract')) {
        try {
            const urlParams = new URL(req.url, `http://${req.headers.host}`);
            const targetUrl = urlParams.searchParams.get('url');
            
            if (!targetUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Parâmetro "url" não fornecido' }));
                return;
            }
            
            if (!targetUrl.includes('anroll.net')) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'URL inválida. Deve ser um link do anroll.net' }));
                return;
            }

            const urlObj = new URL(targetUrl);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Referer': 'https://www.anroll.net/',
                    'Accept-Encoding': 'gzip, deflate, br'
                }
            };

            const extractReq = client.request(options, (extractRes) => {
                // Verificar se a resposta está comprimida
                const encoding = extractRes.headers['content-encoding'];
                let stream = extractRes;
                
                if (encoding === 'gzip') {
                    stream = extractRes.pipe(zlib.createGunzip());
                } else if (encoding === 'deflate') {
                    stream = extractRes.pipe(zlib.createInflate());
                } else if (encoding === 'br') {
                    stream = extractRes.pipe(zlib.createBrotliDecompress());
                }
                
                let html = '';
                
                stream.on('data', (chunk) => {
                    html += chunk.toString();
                });
                
                stream.on('end', () => {
                    // Procurar por links .m3u8 no HTML
                    // Padrões comuns: URLs com .m3u8, variáveis JavaScript com URLs, etc.
                    let streamUrl = null;
                    
                    // Padrão 1: URLs completas com .m3u8
                    const fullUrlPattern = /https?:\/\/[^\s"'<>;\)]+\.m3u8[^\s"'<>;\)]*/gi;
                    const fullUrlMatches = html.match(fullUrlPattern);
                    if (fullUrlMatches && fullUrlMatches.length > 0) {
                        // Filtrar URLs que parecem ser de CDN de vídeo
                        const cdnUrls = fullUrlMatches.filter(url => 
                            url.includes('cdn') || url.includes('stream') || url.includes('hls') || url.includes('media')
                        );
                        streamUrl = cdnUrls.length > 0 ? cdnUrls[0] : fullUrlMatches[0];
                    }
                    
                    // Padrão 2: Procurar em atributos data, src, url, etc.
                    if (!streamUrl) {
                        const attrPatterns = [
                            /(?:data-)?(?:src|url|source|file|stream|hls|playlist)\s*[:=]\s*["']([^"']*\.m3u8[^"']*)["']/gi,
                            /["']([^"']*cdn[^"']*\.m3u8[^"']*)["']/gi,
                            /["']([^"']*stream[^"']*\.m3u8[^"']*)["']/gi
                        ];
                        
                        for (const pattern of attrPatterns) {
                            const matches = [...html.matchAll(pattern)];
                            if (matches.length > 0) {
                                for (const match of matches) {
                                    const url = (match[1] || match[0]).replace(/^["']|["']$/g, '').trim();
                                    if (url.startsWith('http')) {
                                        streamUrl = url;
                                        break;
                                    }
                                }
                                if (streamUrl) break;
                            }
                        }
                    }
                    
                    // Padrão 3: Procurar em scripts JavaScript (incluindo minificados)
                    if (!streamUrl) {
                        const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
                        let scriptMatch;
                        while ((scriptMatch = scriptPattern.exec(html)) !== null) {
                            const scriptContent = scriptMatch[1];
                            // Procurar URLs .m3u8 no script
                            const scriptUrlPattern = /https?:\/\/[^\s"'<>;\)]+\.m3u8[^\s"'<>;\)]*/gi;
                            const scriptUrls = scriptContent.match(scriptUrlPattern);
                            if (scriptUrls && scriptUrls.length > 0) {
                                // Preferir URLs de CDN
                                const cdnUrl = scriptUrls.find(url => 
                                    url.includes('cdn') || url.includes('stream') || url.includes('hls')
                                );
                                streamUrl = cdnUrl || scriptUrls[0];
                                break;
                            }
                        }
                    }
                    
                    // Padrão 4: Procurar em variáveis JavaScript comuns
                    if (!streamUrl) {
                        const varPatterns = [
                            /(?:var|let|const)\s+\w*(?:url|src|stream|hls|source|file)\w*\s*=\s*["']([^"']*\.m3u8[^"']*)["']/gi,
                            /(?:video|player|media)\.(?:src|url|source)\s*=\s*["']([^"']*\.m3u8[^"']*)["']/gi
                        ];
                        
                        for (const pattern of varPatterns) {
                            const matches = [...html.matchAll(pattern)];
                            if (matches.length > 0) {
                                for (const match of matches) {
                                    const url = (match[1] || match[0]).replace(/^["']|["']$/g, '').trim();
                                    if (url.startsWith('http')) {
                                        streamUrl = url;
                                        break;
                                    }
                                }
                                if (streamUrl) break;
                            }
                        }
                    }
                    
                    if (streamUrl) {
                        // Limpar a URL de caracteres extras
                        streamUrl = streamUrl.trim()
                            .replace(/\\/g, '')  // Remover barras invertidas
                            .replace(/^["']|["']$/g, '')  // Remover aspas no início/fim
                            .replace(/[<>;\)]/g, '');  // Remover caracteres especiais
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, streamUrl: streamUrl }));
                    } else {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Link do stream não encontrado na página. Tente verificar o link manualmente.' }));
                    }
                });
                
                stream.on('error', (error) => {
                    console.error('Erro ao processar resposta:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Erro ao processar a resposta: ' + error.message }));
                });
            });

            extractReq.on('error', (error) => {
                console.error('Erro ao extrair link:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Erro ao acessar a página: ' + error.message }));
            });

            extractReq.end();
        } catch (error) {
            console.error('Erro ao processar requisição /extract:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Erro ao processar requisição: ' + error.message }));
        }
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

    // Se chegou aqui, não é um endpoint especial, então serve arquivos estáticos
    // Mas primeiro, remover query string da URL para evitar problemas
    const urlPath = req.url.split('?')[0];
    
    let filePath = '.' + urlPath;
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
