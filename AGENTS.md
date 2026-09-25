# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A small NestJS library (published to npm as `nestjs-case-insensitive-fields`) that rewrites incoming request `body` and `query` keys to match DTO property names case-insensitively, recursively through nested DTOs, before `ValidationPipe` runs. No decorators required by consumers. README.md's "How it works", "Rules" and "Limits" sections are accurate and must be updated alongside any behavior change.

## Commands

```bash
npm run build                      # tsc -p tsconfig.build.json → dist/ (src only)
npm test                           # jest, all suites
npx jest test/rewrite.spec.ts      # one file
npx jest -t 'exact-case wins'      # one test by name pattern
```

No lint script exists. Tests import from `../src` via ts-jest, so no build is needed to run them. `test/e2e.spec.ts` boots real Nest apps on both Express and Fastify adapters (hence the 15s `testTimeout`); `rewrite.spec.ts` and `property-map.spec.ts` are pure unit tests.

## Architecture

Three source files form a pipeline; understanding it requires reading all three.

**`src/interceptor.ts`** (`CaseInsensitiveFieldsInterceptor`, registered globally via `APP_INTERCEPTOR` in `module.ts`). For HTTP contexts only, it reads Nest's `ROUTE_ARGS_METADATA` off the controller/handler to find `@Body()`/`@Query()` params, and `design:paramtypes` to get their DTO classes. This relies on deep internal imports (`@nestjs/common/constants.js`, `@nestjs/common/enums/route-paramtypes.enum.js`), which is the main risk when bumping the Nest peer range. `@Body('field')` uses a single-key map instead of a DTO map. The rewritten object is set with `Object.defineProperty` rather than assignment because Express 5's `req.query` is a re-parsing getter; an own property shadows it.

**`src/property-map.ts`** builds, per DTO class, a `Map<lowercaseKey, PropertyEntry>` cached in a `WeakMap` keyed by class. Property names are collected from four sources in order: class-validator metadata, class-transformer `@Expose` metadata (an `@Expose({ name })` wire name becomes an alias entry whose `name` is the wire name, not the property), the `@nestjs/swagger` CLI plugin's `_OPENAPI_METADATA_FACTORY` static (walked up the prototype chain), and `Object.keys(new cls())`. Nested DTO classes are resolved per property in order `@Type()` → swagger factory type → reflected `design:type`, and stored as a lazy `nested()` thunk so cycles and forward refs work. `isUserClass` filters out built-ins (`String`, `Object`, `Date`, ...). Because `tsconfig` targets ES2021, source 4 only sees fields with initializers; that is the runtime limitation documented in the README.

**`src/rewrite.ts`** does the pure transformation. Rules: keys not in the map pass through unchanged (so `whitelist` still strips them); when both an exact-case key and a case variant are present the exact one wins regardless of order; `__proto__`/`constructor`/`prototype` are dropped; arrays of nested DTOs are mapped element-wise. `isPlainObject` accepts a third shape, an object whose prototype is itself null-prototype, because Fastify's `fast-querystring` produces query objects that way.

`src/class-transformer-storage.d.ts` is a hand-written module declaration for the deep import `class-transformer/cjs/storage.js`, needed because class-transformer ships its types under `types/` rather than beside `cjs/`. That import is how the library reads `@Type`/`@Expose` metadata without a public API.

## Notes

- `docs/` and `.superpowers/` are gitignored scratch areas and will not exist on a fresh clone; do not reference them.
- `CLAUDE.md` is a symlink to `AGENTS.md`. Edit `AGENTS.md`.
