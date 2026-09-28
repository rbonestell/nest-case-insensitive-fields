import {
	Body,
	Controller,
	Get,
	INestApplication,
	Module,
	Param,
	Post,
	Query,
	UseInterceptors,
	ValidationPipe,
} from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ExpressAdapter, FileInterceptor } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Expose, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import * as request from 'supertest';
import {
	CaseInsensitiveFieldsInterceptor,
	CaseInsensitiveFieldsModule,
} from './index';

class Child {
	@IsString() childName!: string;
}

class CreateDto {
	@IsString() firstName!: string;
	@IsOptional() @Type(() => Number) @IsInt() age?: number;
	@IsOptional() @ValidateNested() @Type(() => Child) one?: Child;
	@IsOptional()
	@ValidateNested({ each: true })
	@Type(() => Child)
	// eslint-disable-next-line indent -- core indent rule mis-measures a property after multi-line decorators
	kids?: Child[];
}

class AliasDto {
	@Expose({ name: 'USERNAME' }) @IsString() userName!: string;
}

class CaseDto {
	@IsString() id!: string;
	@IsString() ID!: string;
}

class UpperChild {
	@IsString() CHILDNAME!: string;
}

const dynamicChildType = ({ object }: { object: any }) =>
	object.kind === 'upper' ? UpperChild : Child;

class DynamicDto {
	@IsString() kind!: string;
	@ValidateNested() @Type(dynamicChildType) child!: Child | UpperChild;
}

class MapDto {
	@ValidateNested() @Type(() => Child) entries!: Map<string, Child>;
}

class GridDto {
	@ValidateNested({ each: true }) @Type(() => Child) grid!: Child[][];
}

class Animal {
	@IsString() type!: string;
}

class Dog extends Animal {
	@IsString() dogName!: string;
}

const petOptions = {
	discriminator: {
		property: 'type',
		subTypes: [{ value: Dog, name: 'dog' }],
	},
	keepDiscriminatorProperty: true,
};

class PetDto {
	@ValidateNested() @Type(() => Animal, petOptions) pet!: Animal;
}

/** Replaces the method with a differently named function, as logging/retry decorators do. */
function Wrap(): MethodDecorator {
	return (_target, _key, descriptor: any) => {
		const original = descriptor.value;
		descriptor.value = function differentName(...args: any[]) {
			return original.apply(this, args);
		};
	};
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
	@Get('ping') ping() {
		return { ok: true };
	}
	@Get('items/:id') one(@Param('id') id: string) {
		return { id };
	}
	@Post('alias') alias(@Body() dto: AliasDto) {
		return dto;
	}
	@Post('two-selectors') twoSelectors(
		@Body('firstName') first: string,
		@Body('firstname') second: string
	) {
		return { first, second };
	}
	@Post('case') caseProps(@Body() dto: CaseDto) {
		return dto;
	}
	@Post('selector-dto') selectorDto(@Body('payload') dto: Child) {
		return dto;
	}
	@Post('empty-selector') emptySelector(@Body('') dto: Child) {
		return dto;
	}
	@Post('wrapped') @Wrap() wrapped(@Body() dto: Child) {
		return dto;
	}
	@Post('grid') grid(@Body() dto: GridDto) {
		return dto;
	}
	@Post('pet') pet(@Body() dto: PetDto) {
		return dto;
	}
	@Post('dynamic') dynamic(@Body() dto: DynamicDto) {
		return dto;
	}
	@Post('map') map(@Body() dto: MapDto) {
		return { entries: Object.fromEntries(dto.entries) };
	}
	// multer fills req.body after the global interceptor ran; the documented workaround is a method-level interceptor after it
	@Post('upload')
	@UseInterceptors(FileInterceptor('file'), CaseInsensitiveFieldsInterceptor)
	upload(@Body() dto: CreateDto) {
		return dto;
	}
}

@Module({
	imports: [CaseInsensitiveFieldsModule],
	controllers: [TestController],
})
class AppModule {}

@Module({
	imports: [CaseInsensitiveFieldsModule],
	controllers: [TestController],
	providers: [
		{
			provide: APP_PIPE,
			useValue: new ValidationPipe({ whitelist: true, transform: true }),
		},
	],
})
class AppPipeModule {}

async function boot(
	adapter: 'express' | 'fastify',
	rootModule: any = AppModule,
	globalPipe = true
): Promise<INestApplication> {
	const moduleRef = await Test.createTestingModule({
		imports: [rootModule],
	}).compile();
	const app = moduleRef.createNestApplication(
		adapter === 'express' ? new ExpressAdapter() : new FastifyAdapter()
	);
	if (globalPipe)
		app.useGlobalPipes(
			new ValidationPipe({ whitelist: true, transform: true })
		);
	await app.init();
	await (app.getHttpAdapter().getInstance() as any).ready?.();
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
		const res = await http()
			.post('/items')
			.send({ FIRSTNAME: 'bob', Age: 3 });
		expect(res.status).toBe(201);
		expect(res.body).toEqual({ firstName: 'bob', age: 3 });
	});

	it('remaps nested DTOs and arrays of DTOs', async () => {
		const res = await http()
			.post('/items')
			.send({
				firstName: 'bob',
				ONE: { CHILDNAME: 'a' },
				Kids: [{ childname: 'b' }],
			});
		expect(res.status).toBe(201);
		expect(res.body).toEqual({
			firstName: 'bob',
			one: { childName: 'a' },
			kids: [{ childName: 'b' }],
		});
	});

	it('still strips unknown keys via whitelist', async () => {
		const res = await http()
			.post('/items')
			.send({ firstName: 'bob', Extra: 1 });
		expect(res.status).toBe(201);
		expect(res.body).toEqual({ firstName: 'bob' });
	});

	it('still rejects invalid bodies', async () => {
		const res = await http().post('/items').send({ FIRSTNAME: 123 });
		expect(res.status).toBe(400);
	});

	it('does not crash on an empty body', async () => {
		// no body and no content-type: reaches the interceptor with req.body undefined on both adapters
		const res = await http().post('/items');
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
		const res = await http()
			.post('/bulk')
			.send([{ FIRSTNAME: 'x' }]);
		expect(res.status).toBe(201);
		expect(res.body).toEqual([{ FIRSTNAME: 'x' }]);
	});

	it('tolerates handlers with no decorated parameters', async () => {
		const res = await http().get('/ping');
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true });
	});

	it('leaves route params alone', async () => {
		const res = await http().get('/items/ABC');
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ id: 'ABC' });
	});

	it('routes every spelling of an @Expose-aliased property to its wire name', async () => {
		const wire = await http().post('/alias').send({ USERNAME: 'bob' });
		expect(wire.status).toBe(201);
		expect(wire.body).toEqual({ userName: 'bob' });
		const property = await http().post('/alias').send({ userName: 'bob' });
		expect(property.status).toBe(201);
		expect(property.body).toEqual({ userName: 'bob' });
		const other = await http().post('/alias').send({ UserName: 'bob' });
		expect(other.status).toBe(201);
		expect(other.body).toEqual({ userName: 'bob' });
	});

	it('serves two selectors that differ only by case from the same body', async () => {
		const res = await http()
			.post('/two-selectors')
			.send({ firstName: 'one', firstname: 'two' });
		expect(res.status).toBe(201);
		expect(res.body).toEqual({ first: 'one', second: 'two' });
	});

	it('keeps DTO properties that differ only by case as distinct fields', async () => {
		const both = await http().post('/case').send({ id: 'one', ID: 'two' });
		expect(both.status).toBe(201);
		expect(both.body).toEqual({ id: 'one', ID: 'two' });
		const variant = await http().post('/case').send({ Id: 'x', ID: 'y' });
		expect(variant.status).toBe(201);
		expect(variant.body).toEqual({ id: 'x', ID: 'y' });
	});

	it('normalizes a DTO selected with @Body(field)', async () => {
		const res = await http()
			.post('/selector-dto')
			.send({ PAYLOAD: { CHILDNAME: 'bob' } });
		expect(res.status).toBe(201);
		expect(res.body).toEqual({ childName: 'bob' });
	});

	it('treats an empty selector as the whole body, as Nest does', async () => {
		const res = await http()
			.post('/empty-selector')
			.send({ CHILDNAME: 'bob' });
		expect(res.status).toBe(201);
		expect(res.body).toEqual({ childName: 'bob' });
	});

	it('still works when a decorator replaced the handler with a differently named function', async () => {
		const res = await http().post('/wrapped').send({ CHILDNAME: 'bob' });
		expect(res.status).toBe(201);
		expect(res.body).toEqual({ childName: 'bob' });
	});

	it('normalizes arrays of arrays of DTOs', async () => {
		const res = await http()
			.post('/grid')
			.send({ GRID: [[{ CHILDNAME: 'bob' }]] });
		expect(res.status).toBe(201);
		expect(res.body).toEqual({ grid: [[{ childName: 'bob' }]] });
	});

	it('normalizes the discriminator-selected subtype, even with a mis-cased discriminator key', async () => {
		const exact = await http()
			.post('/pet')
			.send({ pet: { type: 'dog', DOGNAME: 'rex' } });
		expect(exact.status).toBe(201);
		expect(exact.body).toEqual({ pet: { type: 'dog', dogName: 'rex' } });
		const cased = await http()
			.post('/pet')
			.send({ PET: { TYPE: 'dog', DOGNAME: 'rex' } });
		expect(cased.status).toBe(201);
		expect(cased.body).toEqual({ pet: { type: 'dog', dogName: 'rex' } });
	});

	it('evaluates request-dependent @Type callbacks against the real (renamed) parent', async () => {
		const exact = await http()
			.post('/dynamic')
			.send({ kind: 'upper', child: { CHILDNAME: 'x' } });
		expect(exact.status).toBe(201);
		expect(exact.body).toEqual({
			kind: 'upper',
			child: { CHILDNAME: 'x' },
		});
		const cased = await http()
			.post('/dynamic')
			.send({ KIND: 'upper', CHILD: { childname: 'x' } });
		expect(cased.status).toBe(201);
		expect(cased.body).toEqual({
			kind: 'upper',
			child: { CHILDNAME: 'x' },
		});
		const lower = await http()
			.post('/dynamic')
			.send({ kind: 'lower', child: { CHILDNAME: 'x' } });
		expect(lower.status).toBe(201);
		expect(lower.body).toEqual({
			kind: 'lower',
			child: { childName: 'x' },
		});
	});

	it('keeps dictionary keys of a Map property and normalizes its values', async () => {
		const res = await http()
			.post('/map')
			.send({
				ENTRIES: {
					CHILDNAME: { CHILDNAME: 'one' },
					childName: { childName: 'two' },
				},
			});
		expect(res.status).toBe(201);
		expect(res.body).toEqual({
			entries: {
				CHILDNAME: { childName: 'one' },
				childName: { childName: 'two' },
			},
		});
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

describe('multipart body on Express (multer runs after the global interceptor)', () => {
	let app: INestApplication;
	beforeAll(async () => {
		app = await boot('express');
	});
	afterAll(() => app.close());

	it('is rewritten when the interceptor is applied at method level after FileInterceptor', async () => {
		const res = await request(app.getHttpServer())
			.post('/upload')
			.field('FIRSTNAME', 'bob')
			.attach('file', Buffer.from('x'), 'a.txt');
		expect(res.status).toBe(201);
		expect(res.body).toEqual({ firstName: 'bob' });
	});
});

describe('ValidationPipe registered via APP_PIPE in the root module', () => {
	let app: INestApplication;
	beforeAll(async () => {
		app = await boot('express', AppPipeModule, false);
	});
	afterAll(() => app.close());

	it('still sees the rewritten body', async () => {
		const res = await request(app.getHttpServer())
			.post('/items')
			.send({ FIRSTNAME: 'bob' });
		expect(res.status).toBe(201);
		expect(res.body).toEqual({ firstName: 'bob' });
	});
});
