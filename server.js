// Servidor HTTP simples para servir o player HLS
// Execute: node server.js
// Acesse: http://localhost:8000

const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const HISTORY_FILE = './history.json';

const PORT = 8000;

// Funções para gerenciar histórico
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Erro ao carregar histórico:', error);
    }
    return [];
}

function saveHistory(history) {
    try {
        // Ordenar por data (mais recente primeiro) e limitar a 50 itens
        const sorted = history
            .sort((a, b) => new Date(b.lastWatched) - new Date(a.lastWatched))
            .slice(0, 50);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(sorted, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Erro ao salvar histórico:', error);
        return false;
    }
}

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

const DEFAULT_REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br'
};

function createHttpError(message, statusCode = 500) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function decodeHtmlEntities(text = '') {
    return text
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#x2F;/gi, '/')
        .replace(/&#x3D;/gi, '=');
}

function cleanStreamUrl(url) {
    if (!url) return url;
    return url.trim()
        .replace(/\\/g, '')
        .replace(/^["']|["']$/g, '')
        .replace(/[<>;\)]/g, '');
}

function extractTitleFromHtml(html = '') {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
        return titleMatch[1].replace(/\s+/g, ' ').trim();
    }
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    return h1Match ? h1Match[1].replace(/\s+/g, ' ').trim() : null;
}

function extractAnimesOnlineTitle(html = '') {
    const match = html.match(/<h1[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([^<]+)<\/h1>/i);
    if (match) {
        return match[1].replace(/\s+/g, ' ').trim();
    }
    return null;
}

function findHlsStreamUrl(html = '') {
    let streamUrl = null;

    const fullUrlPattern = /https?:\/\/[^\s"'<>;\)]+\.m3u8[^\s"'<>;\)]*/gi;
    const fullUrlMatches = html.match(fullUrlPattern);
    if (fullUrlMatches && fullUrlMatches.length > 0) {
        const cdnUrls = fullUrlMatches.filter(url =>
            url.includes('cdn') || url.includes('stream') || url.includes('hls') || url.includes('media')
        );
        streamUrl = cdnUrls.length > 0 ? cdnUrls[0] : fullUrlMatches[0];
    }

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

    if (!streamUrl) {
        const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let scriptMatch;
        while ((scriptMatch = scriptPattern.exec(html)) !== null) {
            const scriptContent = scriptMatch[1];
            const scriptUrlPattern = /https?:\/\/[^\s"'<>;\)]+\.m3u8[^\s"'<>;\)]*/gi;
            const scriptUrls = scriptContent.match(scriptUrlPattern);
            if (scriptUrls && scriptUrls.length > 0) {
                const cdnUrl = scriptUrls.find(url =>
                    url.includes('cdn') || url.includes('stream') || url.includes('hls')
                );
                streamUrl = cdnUrl || scriptUrls[0];
                break;
            }
        }
    }

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

    return streamUrl ? cleanStreamUrl(streamUrl) : null;
}

function fetchUrlContent(targetUrl, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(targetUrl);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;
            const headers = {
                ...DEFAULT_REQUEST_HEADERS,
                ...extraHeaders
            };

            if (!headers['Accept-Encoding']) {
                headers['Accept-Encoding'] = 'gzip, deflate, br';
            }

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers
            };

            const request = client.request(options, (response) => {
                const encoding = response.headers['content-encoding'];
                let stream = response;

                if (encoding === 'gzip') {
                    stream = response.pipe(zlib.createGunzip());
                } else if (encoding === 'deflate') {
                    stream = response.pipe(zlib.createInflate());
                } else if (encoding === 'br') {
                    stream = response.pipe(zlib.createBrotliDecompress());
                }

                const chunks = [];
                stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                stream.on('end', () => {
                    const body = Buffer.concat(chunks).toString();
                    resolve({ body, headers: response.headers, statusCode: response.statusCode });
                });
                stream.on('error', reject);
            });

            request.on('error', reject);
            request.end();
        } catch (error) {
            reject(error);
        }
    });
}

function normalizeUrl(url) {
    if (!url) return '';
    return url.trim().replace(/\/+$/, '');
}

function deriveEpisodeId(item = {}) {
    const existingId = normalizeUrl(item.episodeId);
    if (existingId) return existingId;
    const stream = normalizeUrl(item.streamUrl);
    if (stream) return stream;
    const player = normalizeUrl(item.playerUrl);
    if (player) return player;
    const page = normalizeUrl(item.anrollUrl);
    return page || '';
}

function getItemKeys(item = {}) {
    const keys = [];
    const id = deriveEpisodeId(item);
    if (id) {
        keys.push(`episode:${id}`);
    }
    if (item.anrollUrl) {
        keys.push(`page:${normalizeUrl(item.anrollUrl)}`);
    }
    return keys;
}

function findExistingIndex(history = [], candidate = {}) {
    const key = deriveEpisodeId(candidate);
    if (!key) return -1;
    return history.findIndex(item => deriveEpisodeId(item) === key);
}

async function extractFromAnroll(targetUrl) {
    const { body: html } = await fetchUrlContent(targetUrl, {
        'Referer': 'https://www.anroll.net/'
    });

    const streamUrl = findHlsStreamUrl(html);
    if (!streamUrl) {
        throw createHttpError('Link do stream não encontrado na página. Tente verificar o link manualmente.', 404);
    }

    return {
        streamUrl,
        title: extractTitleFromHtml(html),
        playerType: 'hls',
        source: 'anroll'
    };
}

async function extractFromAnimesOnline(targetUrl) {
    const { body: html } = await fetchUrlContent(targetUrl, {
        'Referer': 'https://animesonlinecc.to/'
    });

    const bloggerMatch = html.match(/https:\/\/www\.blogger\.com\/video\.g\?[^"'<> ]+/i);
    if (!bloggerMatch) {
        throw createHttpError('Player do Blogger não encontrado na página.', 404);
    }

    const bloggerUrl = cleanStreamUrl(decodeHtmlEntities(bloggerMatch[0]));
    return {
        streamUrl: bloggerUrl,
        title: extractAnimesOnlineTitle(html) || extractTitleFromHtml(html),
        playerType: 'blogger',
        source: 'animesonline',
        note: 'Player externo do Blogger detectado'
    };
}

const SOURCE_HANDLERS = [
    { name: 'anroll', pattern: /anroll\.net/i, handler: extractFromAnroll },
    { name: 'animesonline', pattern: /animesonlinecc\.to/i, handler: extractFromAnimesOnline }
];

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

    // Endpoint para extrair link do stream
    if (req.url.startsWith('/extract')) {
        try {
            const urlParams = new URL(req.url, `http://${req.headers.host}`);
            const targetUrl = urlParams.searchParams.get('url');
            
            if (!targetUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Parâmetro "url" não fornecido' }));
                return;
            }

            const handler = SOURCE_HANDLERS.find(entry => entry.pattern.test(targetUrl));
            if (!handler) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'URL inválida. Utilize links do anroll.net ou animesonlinecc.to' }));
                return;
            }

            handler.handler(targetUrl)
                .then((result) => {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, ...result }));
                })
                .catch((error) => {
                    console.error('Erro ao extrair link:', error);
                    const statusCode = error.statusCode || 500;
                    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message || 'Erro ao processar requisição' }));
                });
        } catch (error) {
            console.error('Erro ao processar requisição /extract:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Erro ao processar requisição: ' + error.message }));
        }
        return;
    }

    // Endpoint para gerenciar histórico
    if (req.url.startsWith('/api/history')) {
        if (req.method === 'GET') {
            // Retornar histórico
            let history = loadHistory();
            const originalLength = history.length;
            
            // Limpar duplicatas do histórico existente
            // Usar anrollUrl como identificador principal (mesmo episódio = mesmo anrollUrl)
            // Se não houver anrollUrl, usar streamUrl normalizado
            const keyMap = new Map();
            const deduped = [];

            history.forEach(item => {
                const normalizedItem = {
                    ...item,
                    streamUrl: normalizeUrl(item.streamUrl),
                    playerUrl: normalizeUrl(item.playerUrl),
                    anrollUrl: item.anrollUrl ? normalizeUrl(item.anrollUrl) : item.anrollUrl,
                    episodeId: deriveEpisodeId(item) || null
                };

                const key = normalizedItem.episodeId;

                if (!key) {
                    deduped.push(normalizedItem);
                    return;
                }

                if (!keyMap.has(key)) {
                    deduped.push(normalizedItem);
                    keyMap.set(key, deduped.length - 1);
                } else {
                    const existingIndex = keyMap.get(key);
                    const existingItem = deduped[existingIndex];
                    const existingDate = new Date(existingItem.lastWatched || 0);
                    const itemDate = new Date(normalizedItem.lastWatched || 0);
                    if (itemDate > existingDate) {
                        deduped[existingIndex] = normalizedItem;
                    }
                }
            });
            
            // Ordenar por data (mais recente primeiro)
            history = deduped.sort((a, b) => {
                const dateA = new Date(a.lastWatched || 0);
                const dateB = new Date(b.lastWatched || 0);
                return dateB - dateA;
            });
            
            // Se houve mudanças (duplicatas removidas), salvar o histórico limpo
            if (history.length !== originalLength) {
                saveHistory(history);
            }
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(history));
            return;
        } else if (req.method === 'DELETE') {
            // Deletar entrada do histórico
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const history = loadHistory();
                    
                    const deleteKey = deriveEpisodeId(data);
                    let filteredHistory;

                    if (deleteKey) {
                        filteredHistory = history.filter(h => deriveEpisodeId(h) !== deleteKey);
                    } else {
                        const deleteKeys = getItemKeys(data);
                        filteredHistory = history.filter(h => {
                            const historyKeys = getItemKeys(h);
                            return !historyKeys.some(key => deleteKeys.includes(key));
                        });
                    }
                    
                    if (filteredHistory.length < history.length) {
                        if (saveHistory(filteredHistory)) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        } else {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Erro ao salvar histórico' }));
                        }
                    } else {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Episódio não encontrado no histórico' }));
                    }
                } catch (error) {
                    console.error('Erro ao deletar do histórico:', error);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Erro ao processar requisição: ' + error.message }));
                }
            });
            return;
        } else if (req.method === 'POST') {
            // Salvar entrada no histórico
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    const entry = JSON.parse(body);
                    const history = loadHistory();
                    
                    entry.streamUrl = normalizeUrl(entry.streamUrl);
                    entry.playerUrl = normalizeUrl(entry.playerUrl);
                    if (entry.anrollUrl) {
                        entry.anrollUrl = normalizeUrl(entry.anrollUrl);
                    }

                    entry.episodeId = deriveEpisodeId(entry) || null;

                    if (!entry.episodeId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Não foi possível determinar o identificador único do episódio (stream ou player).' }));
                        return;
                    }
                    
                    // Verificar se já existe (por identificador único)
                    const existingIndex = findExistingIndex(history, entry);
                    
                    if (existingIndex >= 0) {
                        // Atualizar entrada existente
                        const existingItem = history[existingIndex];
                        
                        // Verificar se é apenas uma mudança de status watched (sem mudança de progresso)
                        const isOnlyWatchedChange = entry.watched !== undefined && 
                                                   existingItem.watched !== entry.watched &&
                                                   entry.currentTime === existingItem.currentTime &&
                                                   entry.duration === existingItem.duration;
                        
                        // Verificar se é uma atualização de progresso significativa
                        const isProgressUpdate = entry.currentTime !== undefined && 
                                                existingItem.currentTime !== entry.currentTime &&
                                                Math.abs((entry.currentTime || 0) - (existingItem.currentTime || 0)) > 1;
                        
                        history[existingIndex] = {
                            ...existingItem,
                            ...entry,
                            // Normalizar URLs antes de salvar
                            streamUrl: normalizeUrl(entry.streamUrl),
                            playerUrl: normalizeUrl(entry.playerUrl),
                            anrollUrl: entry.anrollUrl ? normalizeUrl(entry.anrollUrl) : entry.anrollUrl,
                            episodeId: entry.episodeId,
                            // Se for apenas mudança de watched, SEMPRE preservar a data original
                            // Só atualizar lastWatched se for uma atualização de progresso real
                            lastWatched: isOnlyWatchedChange ? existingItem.lastWatched :
                                        (isProgressUpdate ? new Date().toISOString() : 
                                        (entry.lastWatched || existingItem.lastWatched || new Date().toISOString()))
                        };
                    } else {
                        // Adicionar nova entrada
                        // Normalizar URLs antes de salvar
                        history.push({
                            ...entry,
                            streamUrl: normalizeUrl(entry.streamUrl),
                            playerUrl: normalizeUrl(entry.playerUrl),
                            anrollUrl: entry.anrollUrl ? normalizeUrl(entry.anrollUrl) : entry.anrollUrl,
                            episodeId: entry.episodeId,
                            lastWatched: entry.lastWatched || new Date().toISOString()
                        });
                    }
                    
                    if (saveHistory(history)) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Erro ao salvar histórico' }));
                    }
                } catch (error) {
                    console.error('Erro ao processar histórico:', error);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Dados inválidos' }));
                }
            });
            return;
        }
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
