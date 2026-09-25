# nestjs-case-insensitive-fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A NestJS library that, once imported as a module, makes incoming body and query keys match DTO properties case-insensitively and recursively, with no decorators.

**Architecture:** A global interceptor (registered via `APP_INTERCEPTOR`) reads Nest's route-argument metadata to find the DTO class behind each `@Body()` / `@Query()` parameter, builds a cached lowercase→canonical property map per DTO class from class-validator, class-transformer, Swagger-plugin and instance metadata, and rewrites `req.body` / `req.query` before any pipe runs. Three small modules: `rewrite` (pure key rewriting), `property-map` (metadata discovery), `interceptor` (Nest glue).

**Tech Stack:** TypeScript 5, NestJS 11 (peer range 11–12), class-validator, class-transformer, reflect-metadata, Jest + ts-jest, supertest, Express 5 and Fastify adapters for tests.

**Spec:** `docs/superpowers/specs/2026-09-25-case-insensitive-fields-design.md`

## Global Constraints

- Node `>=20`. Output is CommonJS only (`tsc`), `main: dist/index.js`, `types: dist/index.d.ts`, `files: ["dist"]`.
- Peer dependencies: `@nestjs/common` and `@nestjs/core` `^11.0.0 || ^12.0.0`, `class-transformer ^0.5.0`, `class-validator >=0.14.0`, `reflect-metadata ^0.1.13 || ^0.2.0`.
- Deep imports always carry the `.js` suffix: `@nestjs/common/constants.js`, `@nestjs/common/enums/route-paramtypes.enum.js`, `class-transformer/cjs/storage.js`.
- HTTP only. Only `req.body` and `req.query` are rewritten. Route params and headers are never touched.
- No options, no `forRoot`, no configuration.
- Unmatched keys pass through unchanged. Exact-case key beats a differently cased duplicate. `__proto__`, `constructor`, `prototype` keys are dropped.
- Commit messages: plain conventional style, no AI attribution of any kind (see `~/.claude/CLAUDE.md` §5).
- Do not "improve" adjacent code; every changed line traces to a task step.

## Review Focus

1. **Top-level array body** (`@Body() items: CreateDto[]`): paramtype is `Array`, so the body must pass through untouched and not crash. Pinned in Task 3 (`leaves array bodies untouched`).
2. **Missing body** (POST with no JSON body, `req.body` undefined or `{}`): the interceptor must skip silently and let ValidationPipe return 400. Pinned in Task 3 (`does not crash on an empty body`).
3. **`null` for a nested property** (`{ one: null }`): must be copied as `null`, not recursed into. Pinned in Task 1 (`leaves non-object values for nested props untouched` covers `null` in an array and a string scalar).
4. **Class-level `@Expose()`** produces an expose-metadata entry with no `propertyName`; the map builder must skip it. Pinned in Task 2 (`SwaggerDto` carries a class-level `@Expose()`).
5. **Query duplicates differing only in case** (`?search=a&SEARCH=b`): the exact-case one wins. Pinned in Task 1 (`prefers the exact-case key…`) and Task 3 (`prefers the exact-case query key`).

---

### Task 1: Project scaffold and the pure `rewrite` function

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `jest.config.js`, `.gitignore`, `LICENSE`
- Create: `src/rewrite.ts`
- Test: `test/rewrite.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (from `src/rewrite.ts`):
  - `type Type<T = unknown> = new (...args: any[]) => T`
  - `interface PropertyEntry { name: string; nested?: () => PropertyMap }`
  - `type PropertyMap = Map<string, PropertyEntry>` (key = lowercase incoming key)
  - `isPlainObject(value: unknown): value is Record<string, unknown>`
  - `singleKeyMap(name: string): PropertyMap`
  - `rewrite(input: Record<string, unknown>, map: PropertyMap): Record<string, unknown>`

- [ ] **Step 1: Create the scaffold files**

`package.json`:

```json
{
  "name": "nestjs-case-insensitive-fields",
  "version": "0.1.0",
  "description": "Case-insensitive request body and query fields for NestJS DTOs, recursively, with no decorators.",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "license": "MIT",
  "author": "Bobby Bonestell",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "jest",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["nestjs", "nest", "dto", "case-insensitive", "class-validator", "class-transformer", "interceptor"],
  "peerDependencies": {
    "@nestjs/common": "^11.0.0 || ^12.0.0",
    "@nestjs/core": "^11.0.0 || ^12.0.0",
    "class-transformer": "^0.5.0",
    "class-validator": ">=0.14.0",
    "reflect-metadata": "^0.1.13 || ^0.2.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

(`target: ES2021` mirrors the Nest 11 CLI template, so undecorated fields without initializers are *not* own properties at runtime. The tests are written with that in mind.)

`tsconfig.build.json`:

```json
{ "extends": "./tsconfig.json", "include": ["src"] }
```

`jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  setupFiles: ['reflect-metadata'],
  testTimeout: 15000,
};
```

`.gitignore`:

```
node_modules
dist
coverage
```

`LICENSE`: the standard MIT text with `Copyright (c) 2026 Bobby Bonestell`.

- [ ] **Step 2: Install dev dependencies**

Run:

```bash
npm i -D @nestjs/common@11 @nestjs/core@11 @nestjs/platform-express@11 @nestjs/platform-fastify@11 @nestjs/testing@11 class-transformer class-validator reflect-metadata rxjs supertest @types/supertest jest ts-jest @types/jest typescript@5 @types/node
```

Expected: `package-lock.json` created, no peer warnings about Nest versions. Verify `node -e "console.log(require('typescript').version)"` prints a 5.x version (TypeScript 7 is not supported by ts-jest yet).

- [ ] **Step 3: Write the failing tests**

`test/rewrite.spec.ts`:

```ts
import { rewrite, singleKeyMap, isPlainObject, PropertyMap } from '../src/rewrite';

const childMap: PropertyMap = new Map([['childname', { name: 'childName' }]]);
const map: PropertyMap = new Map([
  ['firstname', { name: 'firstName' }],
  ['kids', { name: 'kids', nested: () => childMap }],
  ['one', { name: 'one', nested: () => childMap }],
]);

describe('rewrite', () => {
  it('maps keys to canonical names case-insensitively', () => {
    expect(rewrite({ FIRSTNAME: 'a' }, map)).toEqual({ firstName: 'a' });
  });

  it('passes unknown keys through untouched', () => {
    expect(rewrite({ Unknown: 1 }, map)).toEqual({ Unknown: 1 });
  });

  it('recurses into nested objects and arrays of objects', () => {
    expect(
      rewrite({ ONE: { CHILDNAME: 'x' }, Kids: [{ ChildName: 'y' }, 'str', null] }, map),
    ).toEqual({ one: { childName: 'x' }, kids: [{ childName: 'y' }, 'str', null] });
  });

  it('leaves non-object values for nested props untouched', () => {
    expect(rewrite({ one: 'not-an-object' }, map)).toEqual({ one: 'not-an-object' });
    expect(rewrite({ ONE: null }, map)).toEqual({ one: null });
  });

  it('prefers the exact-case key when duplicates differ only by case', () => {
    expect(rewrite({ FIRSTNAME: 'a', firstName: 'b' }, map)).toEqual({ firstName: 'b' });
    expect(rewrite({ firstName: 'b', FIRSTNAME: 'a' }, map)).toEqual({ firstName: 'b' });
  });

  it('lets the last duplicate win when neither is exact-case', () => {
    expect(rewrite({ FIRSTNAME: 'a', FirstName: 'b' }, map)).toEqual({ firstName: 'b' });
  });

  it('drops prototype-polluting keys', () => {
    const input = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": 1, "prototype": 2, "firstName": "a"}');
    const out = rewrite(input, map);
    expect(Object.keys(out)).toEqual(['firstName']);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('copies non-plain values by reference', () => {
    const d = new Date();
    expect(rewrite({ FIRSTNAME: d }, map).firstName).toBe(d);
  });

  it('handles null-prototype input objects (Node querystring output)', () => {
    const input = Object.create(null);
    input.FIRSTNAME = 'a';
    expect(rewrite(input, map)).toEqual({ firstName: 'a' });
  });

  it('does not mutate the input', () => {
    const input = { FIRSTNAME: 'a' };
    rewrite(input, map);
    expect(input).toEqual({ FIRSTNAME: 'a' });
  });
});

describe('singleKeyMap', () => {
  it('maps exactly one key and leaves the rest alone', () => {
    expect(rewrite({ USERID: 1, other: 2 }, singleKeyMap('userId'))).toEqual({ userId: 1, other: 2 });
  });
});

describe('isPlainObject', () => {
  it.each([[{}], [Object.create(null)], [{ a: 1 }]])('accepts %p', (v) => expect(isPlainObject(v)).toBe(true));
  it.each([[null], [undefined], [[]], ['s'], [1], [new Date()], [new (class X {})()]])('rejects %p', (v) =>
    expect(isPlainObject(v)).toBe(false),
  );
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx jest test/rewrite.spec.ts`
Expected: FAIL with `Cannot find module '../src/rewrite'`.

- [ ] **Step 5: Implement `src/rewrite.ts`**

```ts
export type Type<T = unknown> = new (...args: any[]) => T;

export interface PropertyEntry {
  /** Canonical key to write. Usually the DTO property name; for an `@Expose({ name })` alias it is the wire name. */
  name: string;
  /** Lazily resolved map for a nested DTO (or array of DTOs) held by this property. */
  nested?: () => PropertyMap;
}

/** lowercase incoming key -> canonical entry */
export type PropertyMap = Map<string, PropertyEntry>;

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function singleKeyMap(name: string): PropertyMap {
  return new Map([[name.toLowerCase(), { name }]]);
}

export function rewrite(input: Record<string, unknown>, map: PropertyMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const exactWritten = new Set<string>();
  for (const key of Object.keys(input)) {
    if (BLOCKED_KEYS.has(key)) continue;
    const entry = map.get(key.toLowerCase());
    if (!entry) {
      out[key] = input[key];
      continue;
    }
    const isExact = key === entry.name;
    if (!isExact && exactWritten.has(entry.name)) continue;
    if (isExact) exactWritten.add(entry.name);
    out[entry.name] = rewriteNested(input[key], entry.nested);
  }
  return out;
}

function rewriteNested(value: unknown, nested: PropertyEntry['nested']): unknown {
  if (!nested) return value;
  if (Array.isArray(value)) return value.map((item) => (isPlainObject(item) ? rewrite(item, nested()) : item));
  return isPlainObject(value) ? rewrite(value, nested()) : value;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest test/rewrite.spec.ts`
Expected: PASS, 15 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json jest.config.js .gitignore LICENSE src/rewrite.ts test/rewrite.spec.ts
git commit -m "feat: project scaffold and case-insensitive key rewrite"
```

---

### Task 2: DTO property discovery (`property-map`)

**Files:**
- Create: `src/property-map.ts`
- Test: `test/property-map.spec.ts`

**Interfaces:**
- Consumes (from `src/rewrite.ts`): `Type`, `PropertyEntry`, `PropertyMap`.
- Produces (from `src/property-map.ts`):
  - `isUserClass(value: unknown): value is Type` — `true` for a class constructor that is not one of `String, Number, Boolean, Object, Array, Date, Map, Set, Symbol, Function, Promise, Buffer`.
  - `propertyMap(cls: Type): PropertyMap` — cached per class in a `WeakMap`.

- [ ] **Step 1: Write the failing tests**

`test/property-map.spec.ts`:

```ts
import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Expose, Type } from 'class-transformer';
import { isUserClass, propertyMap } from '../src/property-map';

class Child {
  @IsString() childName!: string;
}

class Base {
  @IsString() firstName!: string;
}

class Dto extends Base {
  @IsOptional() @IsInt() age?: number;
  @ValidateNested({ each: true }) @Type(() => Child) kids!: Child[];
  @ValidateNested() one!: Child; // nested type comes from design:type only
  @Expose({ name: 'user_name' }) userName!: string;
  tags: string[] = []; // undecorated, only discoverable by instantiating
}

@Expose() // class-level expose has no propertyName and must be skipped
class SwaggerDto {
  static _OPENAPI_METADATA_FACTORY() {
    return {
      title: { required: true, type: () => String },
      items: { required: false, type: () => [Child] },
      owner: { required: false, type: () => Child },
    };
  }
}

class SwaggerSub extends SwaggerDto {
  static _OPENAPI_METADATA_FACTORY() {
    return { extra: { required: true, type: () => Number } };
  }
}

class NeedsArgs {
  constructor(x: string) {
    if (!x) throw new Error('boom');
  }
  @IsString() name!: string;
}

const describeMap = (cls: any) =>
  [...propertyMap(cls).entries()].map(([k, e]) => `${k}=${e.name}${e.nested ? '*' : ''}`);

describe('propertyMap', () => {
  it('collects class-validator props including inherited ones', () => {
    expect(describeMap(Dto)).toEqual(expect.arrayContaining(['firstname=firstName', 'age=age']));
  });

  it('marks a nested class declared with @Type', () => {
    expect(propertyMap(Dto).get('kids')!.nested!()).toBe(propertyMap(Child));
  });

  it('marks a nested class declared only through design:type', () => {
    expect(propertyMap(Dto).get('one')!.nested!()).toBe(propertyMap(Child));
  });

  it('does not mark primitives as nested', () => {
    expect(propertyMap(Dto).get('age')!.nested).toBeUndefined();
    expect(propertyMap(Dto).get('firstname')!.nested).toBeUndefined();
  });

  it('adds an @Expose wire name as an alias that rewrites to the wire name', () => {
    expect(propertyMap(Dto).get('user_name')).toEqual({ name: 'user_name' });
    expect(propertyMap(Dto).get('username')!.name).toBe('userName');
  });

  it('finds undecorated fields by instantiating the class', () => {
    expect(propertyMap(Dto).get('tags')!.name).toBe('tags');
  });

  it('reads Swagger plugin factories up the prototype chain and skips class-level @Expose', () => {
    expect(describeMap(SwaggerSub)).toEqual(
      expect.arrayContaining(['title=title', 'items=items*', 'owner=owner*', 'extra=extra']),
    );
    expect(propertyMap(SwaggerSub).get('items')!.nested!()).toBe(propertyMap(Child));
  });

  it('survives constructors that throw', () => {
    expect(propertyMap(NeedsArgs).get('name')!.name).toBe('name');
  });

  it('caches per class', () => {
    expect(propertyMap(Dto)).toBe(propertyMap(Dto));
  });
});

describe('isUserClass', () => {
  it.each([String, Number, Boolean, Object, Array, Date, Map, Set, Symbol, Function, Promise, Buffer])(
    'rejects builtin %p',
    (v) => expect(isUserClass(v)).toBe(false),
  );
  it.each([undefined, null, 'x', 1, () => 1])('rejects non-class %p', (v) => expect(isUserClass(v)).toBe(false));
  it('accepts user classes', () => expect(isUserClass(Child)).toBe(true));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest test/property-map.spec.ts`
Expected: FAIL with `Cannot find module '../src/property-map'`.

- [ ] **Step 3: Implement `src/property-map.ts`**

```ts
import 'reflect-metadata';
import { getMetadataStorage } from 'class-validator';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage.js';
import { PropertyEntry, PropertyMap, Type } from './rewrite';

const BUILTINS = new Set<unknown>([String, Number, Boolean, Object, Array, Date, Map, Set, Symbol, Function, Promise, Buffer]);
const SWAGGER_FACTORY = '_OPENAPI_METADATA_FACTORY';

export function isUserClass(value: unknown): value is Type {
  return typeof value === 'function' && !!value.prototype && !BUILTINS.has(value);
}

const cache = new WeakMap<Type, PropertyMap>();

export function propertyMap(cls: Type): PropertyMap {
  let map = cache.get(cls);
  if (!map) {
    map = build(cls);
    cache.set(cls, map);
  }
  return map;
}

function build(cls: Type): PropertyMap {
  const names = new Set<string>();
  const aliases = new Map<string, string>(); // wire name -> property name
  const swaggerTypes = new Map<string, Type>();

  // 1. class-validator (includes inherited metadata)
  for (const meta of getMetadataStorage().getTargetValidationMetadatas(cls, '', false, false)) {
    names.add(meta.propertyName);
  }

  // 2. class-transformer @Expose (includes inherited metadata)
  for (const meta of defaultMetadataStorage.getExposedMetadatas(cls)) {
    if (!meta.propertyName) continue; // class-level @Expose()
    names.add(meta.propertyName);
    if (meta.options?.name) aliases.set(meta.options.name, meta.propertyName);
  }

  // 3. @nestjs/swagger CLI plugin factory, own class first then ancestors
  for (let c: any = cls; typeof c === 'function' && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    if (!Object.prototype.hasOwnProperty.call(c, SWAGGER_FACTORY) || typeof c[SWAGGER_FACTORY] !== 'function') continue;
    let meta: Record<string, { type?: () => unknown } | undefined>;
    try {
      meta = c[SWAGGER_FACTORY]() ?? {};
    } catch {
      continue;
    }
    for (const [prop, info] of Object.entries(meta)) {
      names.add(prop);
      const t = swaggerType(info?.type);
      if (t && !swaggerTypes.has(prop)) swaggerTypes.set(prop, t);
    }
  }

  // 4. instance fields (initializers, or all fields when useDefineForClassFields is on)
  try {
    for (const key of Object.keys(new cls())) names.add(key);
  } catch {
    // constructor needs arguments or throws; nothing to learn here
  }

  const map: PropertyMap = new Map();
  const entries = new Map<string, PropertyEntry>();
  for (const name of names) {
    const nestedCls = transformerType(cls, name) ?? swaggerTypes.get(name) ?? reflectedType(cls, name);
    const entry: PropertyEntry = nestedCls ? { name, nested: () => propertyMap(nestedCls) } : { name };
    entries.set(name, entry);
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, entry);
  }
  for (const [wire, prop] of aliases) {
    const key = wire.toLowerCase();
    if (map.has(key)) continue;
    const base = entries.get(prop);
    map.set(key, base?.nested ? { name: wire, nested: base.nested } : { name: wire });
  }
  return map;
}

function transformerType(cls: Type, prop: string): Type | undefined {
  const meta = defaultMetadataStorage.findTypeMetadata(cls, prop);
  if (!meta?.typeFunction) return undefined;
  try {
    const t = meta.typeFunction({ newObject: {}, object: {}, property: prop });
    return isUserClass(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

function swaggerType(fn: (() => unknown) | undefined): Type | undefined {
  if (typeof fn !== 'function') return undefined;
  try {
    const t = fn();
    const inner = Array.isArray(t) ? t[0] : t;
    return isUserClass(inner) ? inner : undefined;
  } catch {
    return undefined;
  }
}

function reflectedType(cls: Type, prop: string): Type | undefined {
  const t = Reflect.getMetadata('design:type', cls.prototype, prop);
  return isUserClass(t) ? t : undefined;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest test/property-map.spec.ts`
Expected: PASS. If TypeScript complains about the `class-transformer/cjs/storage.js` import types, confirm `node_modules/class-transformer/cjs/storage.d.ts` exists; with `moduleResolution: node` the `.js` suffix resolves to it.

- [ ] **Step 5: Commit**

```bash
git add src/property-map.ts test/property-map.spec.ts
git commit -m "feat: discover DTO property names from validator, transformer, swagger and instance metadata"
```

---

### Task 3: Interceptor, module, public index, and end-to-end tests

**Files:**
- Create: `src/interceptor.ts`, `src/module.ts`, `src/index.ts`
- Test: `test/e2e.spec.ts`

**Interfaces:**
- Consumes: `isUserClass`, `propertyMap` (Task 2); `isPlainObject`, `rewrite`, `singleKeyMap`, `PropertyMap` (Task 1).
- Produces (public API from `src/index.ts`): `CaseInsensitiveFieldsModule`, `CaseInsensitiveFieldsInterceptor`.

- [ ] **Step 1: Write the failing end-to-end tests**

`test/e2e.spec.ts`:

```ts
import { Body, Controller, Get, INestApplication, Module, Post, Query, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import request from 'supertest';
import { CaseInsensitiveFieldsModule } from '../src';

class Child {
  @IsString() childName!: string;
}

class CreateDto {
  @IsString() firstName!: string;
  @IsOptional() @Type(() => Number) @IsInt() age?: number;
  @IsOptional() @ValidateNested() @Type(() => Child) one?: Child;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => Child) kids?: Child[];
}

class QueryDto {
  @IsString() search!: string;
  @IsOptional() @Type(() => Number) @IsInt() page?: number;
}

@Controller()
class TestController {
  @Post('items') create(@Body() dto: CreateDto) {
    return dto;
  }
  @Post('field') field(@Body('firstName') firstName: string) {
    return { firstName };
  }
  @Post('any') any(@Body() body: any) {
    return body;
  }
  @Post('bulk') bulk(@Body() items: CreateDto[]) {
    return items;
  }
  @Get('items') list(@Query() q: QueryDto) {
    return q;
  }
}

@Module({ imports: [CaseInsensitiveFieldsModule], controllers: [TestController] })
class AppModule {}

@Module({
  imports: [CaseInsensitiveFieldsModule],
  controllers: [TestController],
  providers: [{ provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true }) }],
})
class AppPipeModule {}

async function boot(adapter: 'express' | 'fastify', rootModule: any = AppModule, globalPipe = true): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [rootModule] }).compile();
  const app = moduleRef.createNestApplication(adapter === 'express' ? new ExpressAdapter() : new FastifyAdapter());
  if (globalPipe) app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  await app.getHttpAdapter().getInstance<any>().ready?.();
  return app;
}

describe.each(['express', 'fastify'] as const)('%s adapter', (adapter) => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await boot(adapter);
  });
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  it('accepts mixed-case body keys', async () => {
    const res = await http().post('/items').send({ FIRSTNAME: 'bob', Age: 3 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ firstName: 'bob', age: 3 });
  });

  it('remaps nested DTOs and arrays of DTOs', async () => {
    const res = await http()
      .post('/items')
      .send({ firstName: 'bob', ONE: { CHILDNAME: 'a' }, Kids: [{ childname: 'b' }] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ firstName: 'bob', one: { childName: 'a' }, kids: [{ childName: 'b' }] });
  });

  it('still strips unknown keys via whitelist', async () => {
    const res = await http().post('/items').send({ firstName: 'bob', Extra: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ firstName: 'bob' });
  });

  it('still rejects invalid bodies', async () => {
    const res = await http().post('/items').send({ FIRSTNAME: 123 });
    expect(res.status).toBe(400);
  });

  it('does not crash on an empty body', async () => {
    const res = await http().post('/items').set('content-type', 'application/json').send('');
    expect(res.status).toBe(400);
  });

  it('serves @Body(field) from a differently cased key', async () => {
    const res = await http().post('/field').send({ firstname: 'amy' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ firstName: 'amy' });
  });

  it('leaves non-DTO bodies untouched', async () => {
    const res = await http().post('/any').send({ FIRSTNAME: 'x' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ FIRSTNAME: 'x' });
  });

  it('leaves array bodies untouched', async () => {
    const res = await http().post('/bulk').send([{ FIRSTNAME: 'x' }]);
    expect(res.status).toBe(201);
    expect(res.body).toEqual([{ FIRSTNAME: 'x' }]);
  });

  it('accepts mixed-case query keys', async () => {
    const res = await http().get('/items?SEARCH=abc&Page=2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ search: 'abc', page: 2 });
  });

  it('prefers the exact-case query key', async () => {
    const res = await http().get('/items?SEARCH=wrong&search=right');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ search: 'right' });
  });
});

describe('ValidationPipe registered via APP_PIPE in the root module', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await boot('express', AppPipeModule, false);
  });
  afterAll(() => app.close());

  it('still sees the rewritten body', async () => {
    const res = await request(app.getHttpServer()).post('/items').send({ FIRSTNAME: 'bob' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ firstName: 'bob' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest test/e2e.spec.ts`
Expected: FAIL with `Cannot find module '../src'`.

- [ ] **Step 3: Implement `src/interceptor.ts`**

```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import { Observable } from 'rxjs';
import { isUserClass, propertyMap } from './property-map';
import { isPlainObject, PropertyMap, rewrite, singleKeyMap } from './rewrite';

const SOURCES: Record<number, 'body' | 'query'> = {
  [RouteParamtypes.BODY]: 'body',
  [RouteParamtypes.QUERY]: 'query',
};

interface RouteArg {
  index: number;
  data?: unknown;
}

@Injectable()
export class CaseInsensitiveFieldsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') this.rewriteRequest(context);
    return next.handle();
  }

  private rewriteRequest(context: ExecutionContext): void {
    const controller = context.getClass();
    const handler = context.getHandler();
    const req = context.switchToHttp().getRequest();
    const args: Record<string, RouteArg> = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler.name) ?? {};
    const paramtypes: unknown[] = Reflect.getMetadata('design:paramtypes', controller.prototype, handler.name) ?? [];

    for (const [key, arg] of Object.entries(args)) {
      const source = SOURCES[Number(key.split(':')[0])];
      if (!source) continue;
      const current = req[source];
      if (!isPlainObject(current)) continue;
      const map = this.mapFor(arg, paramtypes[arg.index]);
      if (!map) continue;
      // Own property: shadows Express 5's re-parsing `query` getter; plain assignment on Fastify.
      Object.defineProperty(req, source, { value: rewrite(current, map), writable: true, configurable: true, enumerable: true });
    }
  }

  private mapFor(arg: RouteArg, paramtype: unknown): PropertyMap | undefined {
    if (typeof arg.data === 'string') return singleKeyMap(arg.data);
    return isUserClass(paramtype) ? propertyMap(paramtype) : undefined;
  }
}
```

`src/module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CaseInsensitiveFieldsInterceptor } from './interceptor';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: CaseInsensitiveFieldsInterceptor }],
})
export class CaseInsensitiveFieldsModule {}
```

`src/index.ts`:

```ts
export { CaseInsensitiveFieldsModule } from './module';
export { CaseInsensitiveFieldsInterceptor } from './interceptor';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest test/e2e.spec.ts`
Expected: PASS, 21 tests (10 per adapter + 1). If the Fastify suite hangs on close, confirm `ready()` was awaited in `boot`.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, three suites.

- [ ] **Step 6: Commit**

```bash
git add src/interceptor.ts src/module.ts src/index.ts test/e2e.spec.ts
git commit -m "feat: interceptor and module that rewrite body and query keys before pipes"
```

---

### Task 4: Build, packaging check and README

**Files:**
- Create: `README.md`
- Verify: `dist/` output, `npm pack` contents

- [ ] **Step 1: Build and inspect the output**

Run: `npm run build && ls dist && node -e "const m=require('./dist'); console.log(Object.keys(m))"`
Expected: `index.js index.d.ts interceptor.js interceptor.d.ts module.js module.d.ts property-map.js property-map.d.ts rewrite.js rewrite.d.ts` and `[ 'CaseInsensitiveFieldsModule', 'CaseInsensitiveFieldsInterceptor' ]`.

- [ ] **Step 2: Check the publish tarball**

Run: `npm pack --dry-run`
Expected: only `package.json`, `README.md`, `LICENSE` and `dist/*` are listed. No `test/`, no `docs/`.

- [ ] **Step 3: Write `README.md`**

```markdown
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
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README"
```

---

### Task 5: Smoke test against NestJS 12 (ESM core)

The Jest suite runs on Nest 11. Nest 12's core packages are ESM-only; this task proves the CommonJS build loads and works under it via `require(esm)`. It runs in the scratchpad, never in the repo, and produces no committed files.

**Files:**
- Create (scratchpad only): `<scratchpad>/nest12/smoke.ts`, `<scratchpad>/nest12/tsconfig.json`

- [ ] **Step 1: Pack the library and set up a Nest 12 sandbox**

Run (replace `<scratchpad>` with the session scratchpad path):

```bash
npm run build && npm pack --pack-destination <scratchpad>
mkdir -p <scratchpad>/nest12 && cd <scratchpad>/nest12 && npm init -y >/dev/null
npm i --silent @nestjs/common@12 @nestjs/core@12 @nestjs/platform-express@12 @nestjs/platform-fastify@12 class-validator class-transformer reflect-metadata rxjs supertest typescript@5 @types/node <scratchpad>/nestjs-case-insensitive-fields-0.1.0.tgz
```

Expected: install succeeds; `npm ls @nestjs/core` shows 12.x.

- [ ] **Step 2: Write the smoke script**

`<scratchpad>/nest12/tsconfig.json`:

```json
{ "compilerOptions": { "target": "ES2022", "module": "commonjs", "moduleResolution": "node", "experimentalDecorators": true, "emitDecoratorMetadata": true, "esModuleInterop": true, "skipLibCheck": true, "outDir": "out", "strict": false }, "files": ["smoke.ts"] }
```

`<scratchpad>/nest12/smoke.ts`:

```ts
import 'reflect-metadata';
import { Body, Controller, Get, Module, Post, Query, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { IsString } from 'class-validator';
import request from 'supertest';
import { CaseInsensitiveFieldsModule } from 'nestjs-case-insensitive-fields';

class Dto { @IsString() firstName: string; }

@Controller()
class C {
  @Post('b') b(@Body() d: Dto) { return d; }
  @Get('q') q(@Query() d: Dto) { return d; }
}

@Module({ imports: [CaseInsensitiveFieldsModule], controllers: [C] })
class Root {}

async function run(adapter?: any) {
  const app = adapter ? await NestFactory.create(Root, adapter, { logger: false }) : await NestFactory.create(Root, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready?.();
  const srv = app.getHttpServer();
  const post = await request(srv).post('/b').send({ FIRSTNAME: 'bob' });
  const get = await request(srv).get('/q?FIRSTNAME=amy');
  console.log(adapter ? 'fastify' : 'express', post.status, JSON.stringify(post.body), get.status, JSON.stringify(get.body));
  if (post.status !== 201 || post.body.firstName !== 'bob' || get.status !== 200 || get.body.firstName !== 'amy') process.exit(1);
  await app.close();
}

run().then(() => run(new FastifyAdapter())).then(() => console.log('NEST 12 SMOKE OK'));
```

- [ ] **Step 3: Run it**

Run: `cd <scratchpad>/nest12 && npx tsc -p . && node out/smoke.js`
Expected:

```
express 201 {"firstName":"bob"} 200 {"firstName":"amy"}
fastify 201 {"firstName":"bob"} 200 {"firstName":"amy"}
NEST 12 SMOKE OK
```

If Node refuses to `require()` the ESM Nest packages, the Node version is below 20.19; the library's `engines` field already requires `>=20`, so record the exact failing version in the README "Limits" section and move on.

- [ ] **Step 4: Record the result**

If the smoke passed, no file changes are needed (README already says 11 or 12). If it failed for a reason other than Node version, open the issue in the final report rather than patching blindly.

---

## Self-review notes

- Spec coverage: public API (Task 3), interceptor flow (Task 3), property map with four sources and nested resolution order (Task 2), rewrite rules incl. collisions and blocked keys (Task 1), compatibility incl. `.js` deep imports and CJS-only build (Tasks 1–3, 5), every listed unit and e2e test (Tasks 1–3), repo layout and README (Tasks 1, 4).
- Types are consistent: `PropertyEntry.nested` is `() => PropertyMap` everywhere; `isUserClass` and `propertyMap` are the only exports of `property-map`; `SOURCES` uses the `RouteParamtypes` numeric enum.
- Review Focus items 1–5 each have a named test in Tasks 1–3.
