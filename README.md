<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="200" alt="Nest Logo" /></a>
</p>

<p align="center">Case-insensitive request body and query fields for NestJS DTOs, recursively, with no decorators!</p>
<p align="center">
  <a href="https://www.npmjs.com/package/nest-case-insensitive-fields" target="_blank"><img alt="NPM Version" src="https://img.shields.io/npm/v/nest-case-insensitive-fields?logo=npm&logoColor=white"></a>
  <a href="https://github.com/rbonestell/nest-case-insensitive-fields/actions/workflows/build.yml?query=branch%3Amain" target="_blank"><img alt="Build Status" src="https://img.shields.io/github/actions/workflow/status/rbonestell/nest-case-insensitive-fields/build.yml?logo=typescript&logoColor=white"></a>
  <a href="https://github.com/rbonestell/nest-case-insensitive-fields/actions/workflows/test.yml?query=branch%3Amain" target="_blank"><img alt="Test Results" src="https://img.shields.io/github/actions/workflow/status/rbonestell/nest-case-insensitive-fields/test.yml?branch=main&logo=jest&logoColor=white&label=tests"></a>
  <a href="https://app.codecov.io/gh/rbonestell/nest-case-insensitive-fields/tree/main/src" target="_blank"><img alt="Test Coverage" src="https://img.shields.io/codecov/c/github/rbonestell/nest-case-insensitive-fields?logo=codecov&logoColor=white"></a>
  <a href="https://github.com/rbonestell/nest-case-insensitive-fields/blob/main/LICENSE" target="_blank"><img alt="GitHub License" src="https://img.shields.io/github/license/rbonestell/nest-case-insensitive-fields?color=71C347">
</a>
</p>

## Description

A lightweight library that makes incoming request **body** and **query** keys match your DTO properties case-insensitively, recursively through nested DTOs and arrays of DTOs. Import one module and `{ "FIRSTNAME": "bob", "Address": { "ZIPCODE": "12345" } }` arrives as `{ firstName, address: { zipCode } }` before `ValidationPipe` (class-transformer + class-validator) ever sees it. No decorators, no per-DTO wiring.

## Features

- ✨ One module import, zero configuration
- 🎯 No decorators required on your DTOs
- 🔁 Recursive through nested DTOs and arrays of DTOs
- 🛡️ Works with your existing `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform` all keep working)
- 🚀 Express 5 and Fastify adapters supported
- ⚡ Zero dependencies (only NestJS, class-validator and class-transformer peer dependencies)

## Requirements

- Node.js >= 20.0.0
- NestJS >= 11.0.0 (11 and 12 supported)
- class-validator and class-transformer

## Installation

```bash
npm install nest-case-insensitive-fields
```

## Quick Start

### Simply import the module into your root module

```typescript
import { Module } from '@nestjs/common';
import { CaseInsensitiveFieldsModule } from 'nest-case-insensitive-fields';

@Module({ imports: [CaseInsensitiveFieldsModule] })
export class AppModule {}
```

That is the whole setup. Keep using `ValidationPipe` however you already do (`useGlobalPipes`, `APP_PIPE`, per-controller).

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class AddressDto {
	@IsString() zipCode: string;
}

class CreateUserDto {
	@IsString() firstName: string;
	@ValidateNested() @Type(() => AddressDto) address: AddressDto;
}

@Controller('users')
export class UsersController {
	@Post()
	create(@Body() dto: CreateUserDto) {
		// A request body of { "FIRSTNAME": "bob", "Address": { "ZIPCODE": "12345" } }
		// arrives here as { firstName: 'bob', address: { zipCode: '12345' } }
		return dto;
	}
}
```

### Scoping to a single controller or route

To apply it to one controller or handler instead of globally, use the interceptor directly:

```typescript
import { UseInterceptors } from '@nestjs/common';
import { CaseInsensitiveFieldsInterceptor } from 'nest-case-insensitive-fields';

@UseInterceptors(CaseInsensitiveFieldsInterceptor)
```

### Multipart bodies

`FileInterceptor` (multer) fills `req.body` *after* the global interceptor has already run, so on multipart routes apply the interceptor at method level, after the file interceptor:

```typescript
@Post('upload')
@UseInterceptors(FileInterceptor('file'), CaseInsensitiveFieldsInterceptor)
upload(@Body() dto: CreateUserDto) {}
```

## How it works

A global interceptor runs before any pipe. For each `@Body()` / `@Query()` parameter it looks up the DTO class from Nest's route metadata, builds a cached map of lowercase key → property name for that class, and rewrites the request object in place. Property names come from:

1. class-validator decorators (inherited ones included)
2. class-transformer `@Type` / `@Expose` metadata. Every spelling of an `@Expose({ name })` property, including its own property name, is routed to the wire name, because that is the only key class-transformer reads for it
3. the `@nestjs/swagger` CLI plugin's generated metadata, when enabled
4. the class's own instance fields (fields with initializers, or all fields when TypeScript's `useDefineForClassFields` is on, i.e. `target` >= ES2022)

Nested DTOs are found through `@Type(() => Child)`, the Swagger plugin, or the reflected `design:type`. Request-dependent `@Type` callbacks and `discriminator` options are resolved per value, against the same data class-transformer will see. Arrays at any depth and `Map<string, Child>` dictionaries are handled; dictionary keys are never rewritten.

`@Body('field')` and `@Query('field')` are matched case-insensitively as well, and a DTO-typed selected parameter is normalized like any other. All parameters that read the same source are merged and the source is rewritten once.

### Rules

- Keys that match no known property are passed through unchanged, so `whitelist` still strips them.
- An exact spelling of a declared property is always kept and never renamed. `{ firstName, FIRSTNAME }` keeps `firstName`; a DTO declaring both `id` and `ID` receives both. Only spellings that match no declared property exactly are renamed, to the first declared one.
- `__proto__`, `constructor` and `prototype` keys are dropped.
- Bodies that are not plain objects (arrays, primitives, missing) are left alone.

### Limits

- Only pipes and handlers see the rewritten keys. Middleware and guards run earlier and see the original keys. **Adoption warning:** authorization, tenant selection or field blocklists that read raw body or query keys in middleware or guards will disagree with what the handler receives. Move such checks to the validated DTO, or resolve names the same way this library does.
- Multipart bodies need the method-level interceptor shown above.
- HTTP only. GraphQL, microservices and WebSockets are untouched.
- Route params and headers are not rewritten. Param names come from your route pattern; headers are already case-insensitive.
- A field with no class-validator, `@Type` or `@Expose` decorator, no initializer and no Swagger plugin metadata is invisible at runtime under the default Nest `tsconfig` (`target: ES2021`), so it keeps whatever case the client sent.
- Each DTO class is instantiated once (with no arguments, errors ignored) the first time it is seen, to discover fields with initializers. A DTO whose constructor has side effects will see one extra construction.
- `@Type`-only properties are discovered through a private class-transformer map, since it has no public enumeration API. If a future class-transformer version renames it, those properties fall back to the other sources.
- Nested query objects (`?filter[NAME]=x`) only exist if your app enables the extended query parser (`app.set('query parser', 'extended')` on Express 5).

## API Reference

### `CaseInsensitiveFieldsModule`

Static module with no options. Importing it registers `CaseInsensitiveFieldsInterceptor` as a global interceptor (`APP_INTERCEPTOR`).

### `CaseInsensitiveFieldsInterceptor`

The `NestInterceptor` that performs the rewrite. Exported for `app.useGlobalInterceptors()` or `@UseInterceptors()` on a controller or handler.

## Testing

```bash
# Run unit and end-to-end tests (Express and Fastify)
npm run test
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is [MIT licensed](LICENSE).
