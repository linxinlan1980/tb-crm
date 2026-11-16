# tb-crm development rules

1. Read README.md, docs/PROGRESS.md and docs/architecture.md before changing code. Preserve Qwen original materials outside this checkout.
2. Use a feature branch and a reviewable PR; do not merge or deploy without product-owner acceptance. Existing user authorization permits implementation, fixes and validation.
3. All new business functionality needs a stable capability contract: ID, version, input/output schema, permission, effect, state guards and evidence. Web and agent adapters call the same application service.
4. Never take tenant or actor identity from a tool body. Use authenticated context. Default custom scopes to own records until collaboration grants exist.
5. No direct database or arbitrary SQL tools for agents. Keep secrets, real customer documents and internal references out of Git.
6. New TypeScript stays strict; do not add `any` to new business capability code. Existing prototype `any` is technical debt, not an example to copy.
7. Money and state changes need transactions, idempotency, concurrency checks and tests before exposure as agent write tools. Notifications and integration side effects require explicit policies.
8. Validation: pnpm check. HTTP fixture tests are not real-database tests. Track actual MySQL smoke results separately. Never claim a planned check passed.
9. Update docs/PROGRESS.md with completed work, evidence, limitations and the next bounded milestone. Do not invent percentages or production acceptance.
