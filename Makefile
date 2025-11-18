.PHONY: run start stop help install

# Variáveis
NODE := node
PORT := 8000
SERVER := server.js

# Comando padrão
.DEFAULT_GOAL := help

# Rodar o servidor
run: start

start:
	@echo "🚀 Iniciando servidor..."
	$(NODE) $(SERVER)

# Instalar dependências (se necessário no futuro)
install:
	@echo "📦 Instalando dependências..."
	npm install

# Ajuda
help:
	@echo "Comandos disponíveis:"
	@echo "  make run     - Inicia o servidor (alias para start)"
	@echo "  make start   - Inicia o servidor na porta $(PORT)"
	@echo "  make install - Instala as dependências do projeto"
	@echo "  make help    - Mostra esta mensagem de ajuda"
	@echo ""
	@echo "O servidor estará disponível em: http://localhost:$(PORT)"

