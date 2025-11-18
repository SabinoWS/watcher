# Player HLS

Player de vídeo HLS (HTTP Live Streaming) com suporte para headers customizados e extração automática de links.

## ✨ Funcionalidades

- 🎬 Reprodução de vídeos HLS (.m3u8)
- 🔗 Extração automática de links de stream
- 🌐 Proxy server-side para contornar problemas de CORS
- 📱 Interface moderna e responsiva
- ⚡ Carregamento automático após extração de link

## 🚀 Como usar

### Opção 1: Usando o Makefile (Recomendado)

1. **Inicie o servidor:**
```bash
make run
```

ou simplesmente:
```bash
make
```

2. **Acesse no navegador:**
```
http://localhost:8000
```

### Opção 2: Usando Node.js diretamente

1. **Inicie o servidor:**
```bash
node server.js
```

2. **Acesse no navegador:**
```
http://localhost:8000
```

### Opção 3: Abrir diretamente (pode ter problemas de CORS)

Simplesmente abra o arquivo `index.html` no navegador. **Nota:** Pode ocorrer erro de CORS se o servidor CDN verificar o header `Origin`. A funcionalidade de extração automática não funcionará sem o servidor.

## 📖 Como usar a extração automática de links

1. **Cole o link** no campo superior
2. **Clique em "Extrair Link"** ou pressione Enter
3. O sistema irá:
   - Fazer scraping da página
   - Extrair automaticamente o link do stream `.m3u8`
   - Preencher o campo de URL do vídeo
   - Carregar o vídeo automaticamente

### Uso manual

Se preferir, você pode colar diretamente o link `.m3u8` no campo inferior e clicar em "Carregar Vídeo".

## ⚙️ Configuração

### Headers HTTP

O player está configurado para enviar os seguintes headers HTTP (exatamente como no curl que funciona):

- `Referer`
- `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36`
- `Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7`

**Importante:** O header `Origin` é controlado automaticamente pelo navegador e não pode ser falsificado por questões de segurança. O navegador define o `Origin` baseado na URL da página atual.

### Endpoints do Servidor

- `GET /extract?url=<link>` - Extrai o link do stream de uma página
- `GET /proxy/<url_encoded>` - Proxy para requisições HLS com headers customizados
- `GET /` - Serve a interface do player (index.html)

## 🔧 Solução de Problemas

### Erro 403 Forbidden
- Certifique-se de que está usando um servidor HTTP (não abrindo via `file://`)
- Os headers `Referer`, `User-Agent` e `Accept-Language` estão sendo enviados corretamente

### Erro de CORS
- O servidor CDN pode estar verificando o header `Origin`

## 📝 Notas Técnicas

- O player usa a biblioteca [hls.js](https://github.com/video-dev/hls.js/) para reprodução HLS
- Funciona em todos os navegadores modernos (Chrome, Firefox, Edge, Safari)
- Os headers são configurados via proxy server-side que intercepta todas as requisições HTTP
- A extração de links funciona através de scraping server-side, evitando problemas de CORS
- Suporta HTML comprimido (gzip, deflate, brotli) na extração de links
- Múltiplos padrões de busca para encontrar links `.m3u8` no HTML

## 🛠️ Comandos Makefile

- `make run` ou `make start` - Inicia o servidor na porta 8000
- `make install` - Instala as dependências do projeto (se necessário)
- `make help` - Mostra a lista de comandos disponíveis

## 📦 Dependências

- Node.js (versão 12 ou superior)
- Nenhuma dependência externa necessária (usa apenas módulos nativos do Node.js)

