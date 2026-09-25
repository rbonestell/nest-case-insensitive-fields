# nestjs-case-insensitive-fields — Design

Date: 2026-09-25
Status: approved design, pending implementation plan

## Goal

A library that a NestJS 11+ application imports as a single module. After that,
incoming request body and query keys match DTO property names regardless of
case, recursively through nested DTOs and arrays of DTOs, with no decorators or
per-DTO wiring. Existing `ValidationPipe` settings (`whitelist`,
`forbidNonWhitelisted`, `transform`) keep working because the rewrite happens
before any pipe runs.

## Non-goals

- GraphQL, microservices, WebSockets. HTTP only.
- Route params (`@Param`). Their names come from the route pattern, not the client.
- Headers. Node already lowercases them.
- Value-level case-insensitivity (enum values, etc.).
- Options or configuration. None until a concrete need appears.

## Research summary (verified 2026-09-25 on Nest 11.2.6, Express 5.2.1, Fastify)

- No existing npm package does this. Closest is `serialize-interceptor` (Nest 8, body only, snake→camel).
- Lifecycle is middleware → guards → interceptors → pipes → handler. Pipes run inside the interceptor chain, so an interceptor that mutates `req.body` / `req.query` is seen by `@Body()` / `@Query()` and every pipe.
- Global pipe order is root-module `APP_PIPE`, then imported-module `APP_PIPE`, then `useGlobalPipes()`. A pipe shipped by an imported module runs after a `ValidationPipe` registered via `APP_PIPE` in `AppModule`. That rules out a pipe-based design.
- Express 5 defines `req.query` as a prototype getter that re-parses the URL on every read. Assignment throws; in-place mutation is lost. `Object.defineProperty(req, 'query', { value, writable: true, configurable: true, enumerable: true })` on the instance shadows it. Fastify exposes `query` and `body` as plain instance properties.
- Route argument metadata: `Reflect.getMetadata(ROUTE_ARGS_METADATA, controllerClass, methodName)` → `{ "<paramtype>:<index>": { index, data, pipes } }`; `RouteParamtypes.BODY = 3`, `QUERY = 4`. Parameter classes: `Reflect.getMetadata('design:paramtypes', controllerClass.prototype, methodName)`. Both constants are imported by `@nestjs/swagger` from `@nestjs/common/constants` and `@nestjs/common/enums/route-paramtypes.enum`, and still resolve on Nest 12 (ESM, exports map `./*` → `./*.js`).
- Property-name sources:
  - class-validator: `getMetadataStorage().getTargetValidationMetadatas(cls, '', false, false)` → entries with `propertyName`, `type`, `each`; includes inherited metadata.
  - class-transformer: `defaultMetadataStorage` from `class-transformer/cjs/storage`; `findTypeMetadata(cls, prop)` → `{ typeFunction, reflectedType }` (walks ancestors); `getExposedMetadatas(cls)` → `@Expose` entries incl. `options.name`.
  - Swagger CLI plugin: static `cls._OPENAPI_METADATA_FACTORY()` → `{ prop: { type?: () => X | [X], ... } }`, per class (ancestors must be walked separately). Only present when the plugin is enabled.
  - `new cls()` own keys: lists every declared field when `useDefineForClassFields` is on (TS default for target ≥ ES2022). Nest 11 CLI template targets ES2021 and SWC disables it, so this is best effort only.
- Nest 12 (released 2026-09-23) core packages are ESM-only. A CommonJS library still loads under it on Node ≥ 20.19 / 22.12 via `require(esm)`.

## Public API

```ts
import { CaseInsensitiveFieldsModule } from 'nestjs-case-insensitive-fields';

@Module({ imports: [CaseInsensitiveFieldsModule] })
export class AppModule {}
```

- `CaseInsensitiveFieldsModule` — static module, no options. Provides
  `{ provide: APP_INTERCEPTOR, useClass: CaseInsensitiveFieldsInterceptor }`.
- `CaseInsensitiveFieldsInterceptor` — exported for `app.useGlobalInterceptors()`
  or `@UseInterceptors()` on a single controller.

## Components

### `CaseInsensitiveFieldsInterceptor` (`src/interceptor.ts`)

```
intercept(ctx, next):
  if ctx.getType() !== 'http' → next.handle()
  req = ctx.switchToHttp().getRequest()
  args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ctx.getClass(), ctx.getHandler().name) ?? {}
  paramtypes = Reflect.getMetadata('design:paramtypes', ctx.getClass().prototype, ctx.getHandler().name) ?? []
  for each [key, { index, data }] in args:
    paramtype = Number(key.split(':')[0])
    source = BODY → 'body' | QUERY → 'query' | else skip
    current = req[source]; skip unless plain object
    if data (e.g. @Body('userId')): rewritten = rewrite(current, singleKeyMap(data))
    else if isUserClass(paramtypes[index]): rewritten = rewrite(current, propertyMap(paramtypes[index]))
    else skip
    assign(req, source, rewritten)
  return next.handle()
```

`assign` uses `Object.defineProperty` for both sources (works on Express 5's
prototype getter and on Fastify's plain properties).

`isUserClass(t)`: `typeof t === 'function'` and not one of `String, Number,
Boolean, Object, Array, Date, Map, Set, Symbol, Function, Promise`.

### Property map (`src/property-map.ts`)

`propertyMap(cls): Map<lowercaseKey, { name: string; nested?: () => Type }>`,
cached per class in a `WeakMap`.

Sources merged in order (first writer of a lowercase key wins; later sources
only add missing keys or fill in a missing `nested`):

1. class-validator metadata → property names; `nestedValidation` entries mark
   candidates for a nested type.
2. class-transformer: `getExposedMetadatas` → property names, plus
   `options.name` as an additional alias for the same property.
   `findTypeMetadata(cls, prop)` → `nested` via `typeFunction()`.
3. Swagger factory: walk `cls` and its ancestors; each `_OPENAPI_METADATA_FACTORY()`
   result adds property names; `type()` returning a user class or `[UserClass]`
   sets `nested`.
4. `Object.keys(new cls())` inside try/catch → property names only.
5. For any property still lacking `nested`,
   `Reflect.getMetadata('design:type', cls.prototype, prop)` if it is a user class.

`nested` is stored as a thunk and resolved lazily so recursive DTO graphs and
forward references work.

### Rewrite (`src/rewrite.ts`)

`rewrite(obj, map)`:

- Output starts as `{}`.
- For each own enumerable key of `obj` (in insertion order):
  - Drop `__proto__`, `constructor`, `prototype`.
  - `entry = map.get(key.toLowerCase())`.
  - No entry → copy `out[key] = value` unchanged.
  - Entry → canonical `name = entry.name`. If `out[name]` was already written
    by an exact-case key, skip. Otherwise write, and record whether this write
    was exact-case.
  - If `entry.nested` resolves to a user class: plain-object value → recurse;
    array value → map elements, recursing into plain-object elements and
    copying everything else.
- Everything else (primitives, Dates, Buffers, class instances) is copied by
  reference.

`singleKeyMap(name)` builds a one-entry map `{ [name.toLowerCase()]: { name } }`
for the `@Body('field')` case.

### Module (`src/module.ts`) and index (`src/index.ts`)

Static `@Module` with the `APP_INTERCEPTOR` provider; index re-exports the module
and interceptor.

## Compatibility

- `peerDependencies`: `@nestjs/common` and `@nestjs/core` `^11 || ^12`,
  `class-validator >=0.14`, `class-transformer ^0.5`, `reflect-metadata`.
- Deep imports written with the `.js` suffix
  (`@nestjs/common/constants.js`, `@nestjs/common/enums/route-paramtypes.enum.js`,
  `class-transformer/cjs/storage.js`) so they resolve on Nest 11 (CJS, no exports
  map) and Nest 12 (ESM, `./*` → `./*.js`).
- Build output: CommonJS + `.d.ts` via `tsc`. No ESM build until needed.
- Node ≥ 20.

## Testing

Jest + ts-jest.

Unit (`test/property-map.spec.ts`, `test/rewrite.spec.ts`):
- inherited props from a parent DTO
- nested DTO and array of nested DTOs via `@Type`
- nested via `design:type` only (no `@Type`)
- `@Expose({ name })` alias
- Swagger factory static (hand-written stub on a test class)
- undecorated field found via instantiation
- collision: exact-case key wins over differently cased duplicate
- `__proto__` dropped
- unknown keys pass through untouched
- non-object values untouched

End-to-end (`test/e2e.spec.ts`), run for both `ExpressAdapter` and `FastifyAdapter`
with `ValidationPipe({ whitelist: true, transform: true })`:
- mixed-case body validates and controller receives canonical keys
- mixed-case query validates
- nested body DTO and nested array remapped
- `@Body('field')` receives the value from a differently cased key
- unknown key is still stripped by whitelist
- `ValidationPipe` registered via `APP_PIPE` in the root module still works
  (ordering immunity)
- non-DTO param (`@Body() body: any`) is passed through unchanged

## Repo layout

```
src/index.ts
src/module.ts
src/interceptor.ts
src/property-map.ts
src/rewrite.ts
test/property-map.spec.ts
test/rewrite.spec.ts
test/e2e.spec.ts
package.json  tsconfig.json  tsconfig.build.json  jest.config.js
README.md  LICENSE (MIT)  .gitignore
```

No CI or publish automation in this iteration.
