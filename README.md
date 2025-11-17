# Player HLS

Player de vídeo HLS (HTTP Live Streaming) com suporte para headers customizados.

## 🚀 Como usar

### Opção 1: Usando o servidor Node.js (Recomendado)

1. **Inicie o servidor:**
```bash
node server.js
```

2. **Acesse no navegador:**
```
http://localhost:8000
```

### Opção 2: Abrir diretamente (pode ter problemas de CORS)

Simplesmente abra o arquivo `index.html` no navegador. **Nota:** Pode ocorrer erro de CORS se o servidor CDN verificar o header `Origin`.

## ⚙️ Configuração

O player está configurado para enviar os seguintes headers HTTP (exatamente como no curl que funciona):

- `Referer: https://www.anroll.net/watch/e/jn4F8vMtiL`
- `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36`
- `Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7`

**Importante:** O header `Origin` é controlado automaticamente pelo navegador e não pode ser falsificado por questões de segurança. O navegador define o `Origin` baseado na URL da página atual.

## 🔧 Solução de Problemas

### Erro 403 Forbidden
- Certifique-se de que está usando um servidor HTTP (não abrindo via `file://`)
- Os headers `Referer`, `User-Agent` e `Accept-Language` estão sendo enviados corretamente

### Erro de CORS
- O servidor CDN pode estar verificando o header `Origin`
- Se o servidor CDN aceitar apenas `Origin: https://www.anroll.net`, você precisará:
  - Servir a página de um domínio que tenha esse Origin, OU
  - Usar um proxy server-side que faça as requisições com os headers corretos

## 📝 Notas Técnicas

- O player usa a biblioteca [hls.js](https://github.com/video-dev/hls.js/) para reprodução HLS
- Funciona em todos os navegadores modernos (Chrome, Firefox, Edge, Safari)
- Os headers são configurados via `xhrSetup` do hls.js, que intercepta todas as requisições HTTP

