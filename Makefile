# ==========================================================================
# genesis — operator workflow
# Usage: make <target>   (see `make help`)
# ==========================================================================

.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help setup dev build start test typecheck lint seed forms forms-check check-integrations up down logs ps check-compose

help: ## Show this help message
	@echo "genesis — operator workflow"
	@echo "Usage: make <target>"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

## ---- Bootstrap ------------------------------------------------------------

setup: ## Install guard hooks, create .env, generate secrets, install deps
	bash scripts/setup.sh

seed: ## Create a demo client + business in the local database
	npm run seed

forms: ## Fetch the official forms the packets attach (public-domain IRS PDFs)
	npm run forms

forms-check: ## Verify the fetched forms without the network
	npm run forms:check

check-integrations: ## Preflight the Zeus/Cerulean/Oasis/Magnate integrations (read-only)
	npm run check-integrations

## ---- Develop --------------------------------------------------------------

dev: ## Run the portal on http://localhost:3000
	npm run dev

build: ## Production build
	npm run build

start: ## Run the production build
	npm run start

## ---- Verify ---------------------------------------------------------------

test: ## Compile and run the unit tests (node --test)
	npm test

typecheck: ## Type-check the whole app
	npm run typecheck

lint: ## ESLint
	npm run lint

## ---- Compose --------------------------------------------------------------

up: ## Start the genesis portal
	docker compose up -d

down: ## Stop the portal (keeps the data volume)
	docker compose down

logs: ## Tail the portal logs
	docker compose logs -f

ps: ## List service status
	docker compose ps

## ---- Conformity -----------------------------------------------------------

check-commits: ## Run the attribution guard over recent commit messages
	bash .githooks/commit-msg .git/COMMIT_EDITMSG 2>/dev/null || true

check-compose: ## Validate the compose file against .env.example
	cp .env.example .env
	docker compose config --quiet
	rm -f .env
