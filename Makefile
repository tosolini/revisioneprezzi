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

TRIVY_OUTPUT ?= trivy-report

trivy-scan:
	@mkdir -p $(TRIVY_OUTPUT)
	@for service in backend frontend parser; do \
		echo "=== Scanning revprezzi-$$service ==="; \
		docker run --rm \
			-v /var/run/docker.sock:/var/run/docker.sock \
			-v $$HOME/.cache/trivy:/root/.cache \
			ghcr.io/aquasecurity/trivy:latest \
			image --severity HIGH,CRITICAL --exit-code 1 \
			revprezzi-$$service 2>&1 | tee $(TRIVY_OUTPUT)/$$service.txt; \
		code=$$?; \
		if [ $$code -ne 0 ]; then \
			echo "⚠️  revprezzi-$$service: vulnerabilità trovate — vedi $(TRIVY_OUTPUT)/$$service.txt" >&2; \
		else \
			echo "✅ revprezzi-$$service: nessuna vulnerabilità HIGH/CRITICAL"; \
		fi; \
	done; \
	echo "=== Report salvati in $(TRIVY_OUTPUT)/ ==="

trivy-scan-all:
	@mkdir -p $(TRIVY_OUTPUT)
	@for service in backend frontend parser; do \
		echo "=== Scanning revprezzi-$$service ==="; \
		docker run --rm \
			-v /var/run/docker.sock:/var/run/docker.sock \
			-v $$HOME/.cache/trivy:/root/.cache \
			ghcr.io/aquasecurity/trivy:latest \
			image --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL \
			revprezzi-$$service 2>&1 | tee $(TRIVY_OUTPUT)/$$service.txt; \
		echo "✅ $(TRIVY_OUTPUT)/$$service.txt salvato"; \
	done; \
	echo "=== Report completi in $(TRIVY_OUTPUT)/ ==="
