---
name: Code Quality Standards
description: Strict coding standards for Orbitae — no any types, no hardcoded vars, proper OOP, security-first, parameterized queries, FAANG staff engineer level.
type: feedback
originSessionId: 12eb007e-eeb2-446e-9ce5-198f501cf6a6
---
Code quality must be of the highest caliber. Specific rules:

- Never use hardcoded variables — use constants, config, or environment variables
- Use proper OOP principles throughout
- All security principles must be followed (OWASP top 10 awareness)
- Use parameterization wherever possible (SQL queries, API calls, configuration)
- Follow all correct development conventions for each language (Rust idioms, React patterns)
- No `any` types in TypeScript — ever
- No `unwrap()` in Rust production code
- No `println!()` — use structured logging

**Why:** Vishesh is a solo developer building a product he wants to sell. The codebase must be maintainable, secure, and professional enough that enterprise teams would trust it with their secrets and infrastructure.

**How to apply:** Every file written should pass a mental "would a FAANG staff engineer approve this in code review?" test. This means proper error types, input validation at boundaries, typed interfaces, documented public APIs, and no shortcuts even under time pressure.
