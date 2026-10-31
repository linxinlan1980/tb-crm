# Architecture baseline · 2026-10-31

## Product contract

The product owner authorized AI-assisted construction of tb-crm, with business information and operations accessible to agents. Keep the existing NestJS/React/MySQL direction. This baseline evolves the Qwen prototype incrementally.

## Layering

Web / future MCP adapter → versioned capability registry → application services → state/permission/transaction rules → Prisma/MySQL.

The `capabilities` HTTP adapter currently exposes only `customer.search@1.0` and `customer.get@1.0`. Actor identity is a currently authenticated human user. This is not yet delegated agent authentication. Listing is permission-filtered; invocation validates inputs again and records an execution UUID and outcome. Results are restricted projections without phone/bank/attachment data. Read retries may create new audit entries; write idempotency is not implied.

Customer list/detail and tool queries use the same CustomerService and customerVisibility policy: all scope sees all; dept/team sees public, own and department records; custom defaults to own/public until explicit grants are implemented. Other prototype services have not yet received equivalent record-level review.

## Query boundary

JWTStrategy rejects refresh-as-access tokens and reloads the active user, tenant and role permissions. Global guards protect all routes except explicit @Public handlers. Missing tenant IDs are rejected by forTenant(). Model metadata determines whether deletedAt exists; findUnique is filtered before lookup. Raw system transactions and nested association writes still require per-action review; the extension is not a blanket proof of tenant isolation.

## State and effects

Contract signing and order confirmation now require approved state. Approval callbacks, milestone-payment coupling and full atomic business commands remain pending. No financial write capability is exposed to agents. Introduce a persistent command execution record, idempotency key, expected version and transactional outbox before adding such tools.

## Runtime choices

Node.js 24 and pnpm 11.25.0 are pinned to the available runtime and generated lockfile. Prisma remains on the prototype's major version 6. HS256 is retained for the local baseline, with a separate random JWT_SECRET; production key management is pending. No specific model SDK is required for business capabilities.

## Verification boundaries

HTTP tests use a mocked DB and real NestJS routing/guards/JWT verification. Query-extension tests inspect generated query constraints. MySQL migration/seed/boot/customer+tool smoke is a separate CI job. No production deployment, external system sync, commercial acceptance or comprehensive security certification is established by these checks.

## Known inherited debt

Prototype modules retain untyped DTOs, incomplete row/field permissions, incomplete receipts/approval/event chains, unreviewed raw transactions and missing business tests. Legacy lint exceptions are explicit in eslint.config.mjs; new capability/filter/types code prohibits explicit any. The original 70% overall coverage goal is not achieved by this first baseline.
