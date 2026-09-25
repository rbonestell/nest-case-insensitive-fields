# nestjs-case-insensitive-fields

Make incoming request **body** and **query** keys match your DTO properties
case-insensitively, recursively through nested DTOs, with no decorators.

`{ "FIRSTNAME": "bob", "Address": { "ZIPCODE": "12345" } }` → `{ firstName, address: { zipCode } }`
before `ValidationPipe` (class-transformer + class-validator) ever sees it.

## Install

```bash
npm i nestjs-case-insensitive-fields
```

Peer dependencies: `@nestjs/common` and `@nestjs/core` 11 or 12, `class-validator`,
`class-transformer`, `reflect-metadata`. Node 20+.

## Use

```ts
import { Module } from '@nestjs/common';
import { CaseInsensitiveFieldsModule } from 'nestjs-case-insensitive-fields';

@Module({ imports: [CaseInsensitiveFieldsModule] })
export class AppModule {}
```

That is the whole setup. Keep using `ValidationPipe` however you already do
(`useGlobalPipes`, `APP_PIPE`, per-controller); `whitelist`, `forbidNonWhitelisted`
and `transform` keep working.

To scope it to one controller instead, use the interceptor directly:

```ts
@UseInterceptors(CaseInsensitiveFieldsInterceptor)
```

## How it works

A global interceptor runs before any pipe. For each `@Body()` / `@Query()`
parameter it looks up the DTO class from Nest's route metadata, builds a cached
map of lowercase key → property name for that class, and rewrites the request
object in place. Property names come from:

1. class-validator decorators (inherited ones included)
2. class-transformer `@Type` / `@Expose` metadata (an `@Expose({ name })` wire name is matched too)
3. the `@nestjs/swagger` CLI plugin's generated metadata, when enabled
4. the class's own instance fields (fields with initializers, or all fields when
   TypeScript's `useDefineForClassFields` is on, i.e. `target` ≥ ES2022)

Nested DTOs are found through `@Type(() => Child)`, the Swagger plugin, or the
reflected `design:type`. Arrays of nested DTOs are handled.

`@Body('field')` and `@Query('field')` are matched case-insensitively as well.

## Rules

- Keys that match no known property are passed through unchanged, so
  `whitelist` still strips them.
- If the client sends both `firstName` and `FIRSTNAME`, the exact-case one wins.
- `__proto__`, `constructor` and `prototype` keys are dropped.
- Bodies that are not plain objects (arrays, primitives, missing) are left alone.

## Limits

- HTTP only. GraphQL, microservices and WebSockets are untouched.
- Route params and headers are not rewritten. Param names come from your route
  pattern; headers are already case-insensitive.
- A field with no decorator, no initializer and no Swagger plugin metadata is
  invisible at runtime under the default Nest `tsconfig` (`target: ES2021`), so it
  keeps whatever case the client sent.
- Nested query objects (`?filter[NAME]=x`) only exist if your app enables the
  extended query parser (`app.set('query parser', 'extended')` on Express 5).

## License

MIT
