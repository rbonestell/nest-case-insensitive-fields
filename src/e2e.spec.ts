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
import { Type } from 'class-transformer';
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
