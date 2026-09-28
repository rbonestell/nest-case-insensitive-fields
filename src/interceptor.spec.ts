import { CaseInsensitiveFieldsInterceptor } from './interceptor';

describe('CaseInsensitiveFieldsInterceptor', () => {
	it('passes non-HTTP contexts straight through without touching the request', () => {
		const interceptor = new CaseInsensitiveFieldsInterceptor();
		const context = {
			getType: () => 'rpc',
			switchToHttp: () => {
				throw new Error('must not be called for non-HTTP contexts');
			},
		} as any;
		const handled = {};
		const next = { handle: () => handled } as any;

		expect(interceptor.intercept(context, next)).toBe(handled);
	});

	it('falls back to the function name when the handler is not on the controller prototype', () => {
		class PlainController {}
		const req = { body: { FIRSTNAME: 'x' } };
		const interceptor = new CaseInsensitiveFieldsInterceptor();
		const context = {
			getType: () => 'http',
			getClass: () => PlainController,
			getHandler: () => function detached() {},
			switchToHttp: () => ({ getRequest: () => req }),
		} as any;
		const next = { handle: () => 'handled' } as any;

		expect(interceptor.intercept(context, next)).toBe('handled');
		expect(req.body).toEqual({ FIRSTNAME: 'x' });
	});

	it('is a no-op for handlers compiled without decorator metadata', () => {
		class PlainController {
			handle() {}
		}
		const req = { body: { FIRSTNAME: 'x' } };
		const interceptor = new CaseInsensitiveFieldsInterceptor();
		const context = {
			getType: () => 'http',
			getClass: () => PlainController,
			getHandler: () => PlainController.prototype.handle,
			switchToHttp: () => ({ getRequest: () => req }),
		} as any;
		const handled = {};
		const next = { handle: () => handled } as any;

		expect(interceptor.intercept(context, next)).toBe(handled);
		expect(req.body).toEqual({ FIRSTNAME: 'x' });
	});
});
