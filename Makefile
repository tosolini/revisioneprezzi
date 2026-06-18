.PHONY: build up down shell migrate seed test lint logs setup

build:
	docker compose -f docker-compose-build.yml build

up:
	docker compose up -d

down:
	docker compose down

setup: up seed
	@echo "=== Setup completato ==="
	@echo "API: http://localhost:8000"
	@echo "Docs: http://localhost:8000/docs"

shell:
	docker compose exec backend bash

db-shell:
	docker compose exec db psql -U revuser -d revision_db

migrate:
	docker compose exec backend alembic upgrade head

migrate-new:
	docker compose exec backend alembic revision --autogenerate -m "$(name)"

seed:
	docker compose exec backend python scripts/seed_catalogs.py

sync-indices:
	docker compose exec backend python scripts/sync_indices.py $(csv)

test:
	docker compose exec backend python -m pytest tests/ -v

test-coverage:
	docker compose exec backend python -m pytest tests/ -v --cov=app

lint:
	docker compose exec backend ruff check app/

logs:
	docker compose logs -f backend

restart:
	docker compose restart backend
