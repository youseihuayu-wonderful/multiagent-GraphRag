.PHONY: install test lint evaluate serve serve-ollama demo frontend-install frontend-dev frontend-build export-frontend export-frontend-ollama

install:
	uv sync --extra dev --no-editable

test:
	uv run pytest --cov=governed_rag --cov-report=term-missing

lint:
	uv run ruff check src tests scripts

evaluate:
	uv run governed-rag-eval

serve:
	PYTHONPATH=src uv run uvicorn governed_rag.api:app --reload

serve-ollama:
	GOVERNED_RAG_LLM_PROVIDER=ollama \
	GOVERNED_RAG_LLM_BASE_URL=http://127.0.0.1:11434 \
	GOVERNED_RAG_LLM_MODEL=qwen2.5:7b \
	GOVERNED_RAG_LLM_API_KEY=ollama-local \
	GOVERNED_RAG_LLM_TIMEOUT_SECONDS=120 \
	PYTHONPATH=src uv run uvicorn governed_rag.api:app --reload

demo:
	uv run governed-rag query "What drove Northstar's cloud revenue and what risks could affect growth?"

frontend-install:
	cd frontend && npm install

frontend-dev:
	cd frontend && npm run dev

frontend-build:
	cd frontend && npm run lint && npm run build

export-frontend:
	PYTHONPATH=src uv run python scripts/export_frontend_assets.py --backend tfidf

export-frontend-ollama:
	PYTHONPATH=src uv run python scripts/export_frontend_assets.py --backend ollama
