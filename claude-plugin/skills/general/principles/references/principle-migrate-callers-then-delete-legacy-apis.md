---
name: principle-migrate-callers-then-delete-legacy-apis
description: "Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers."
disable-model-invocation: true
---

# Migrate Callers Then Delete Legacy APIs

When a new internal API replaces an old one, move every caller to the new API and delete the old one in the same wave. A compatibility layer kept "for now" becomes a second API that every later change has to respect.

- Migrate all callers before or together with the deletion, not over an open-ended period
- Delete the old API, its adapters, and its flags in the same wave
- Update tests to assert the new contract, and delete tests that only protect pre-refactor implementation details

**When this applies:**
- No external users depend on backward compatibility
- The project can absorb coordinated breaking changes
- The new API is part of a simplification or refactor initiative
