.PHONY: setup dev build test lint docker-up docker-down db-migrate db-seed db-studio

setup: docker-up db-migrate db-seed
	@echo "✅ 开发环境就绪: Web http://localhost:3000 | API http://localhost:4000 | Swagger http://localhost:4000/api/docs | MailHog http://localhost:8025"

docker-up:
	docker compose up -d
	@echo "等待MySQL就绪..." && sleep 5

docker-down:
	docker compose down

db-migrate:
	pnpm db:migrate

db-seed:
	pnpm db:seed

db-studio:
	pnpm db:studio

dev:
	pnpm dev

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint
