import {
	CallHandler,
	ExecutionContext,
	Injectable,
	NestInterceptor,
} from '@nestjs/common';
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
	intercept(
		context: ExecutionContext,
		next: CallHandler
	): Observable<unknown> {
		if (context.getType() === 'http') this.rewriteRequest(context);
		return next.handle();
	}

	private rewriteRequest(context: ExecutionContext): void {
		const controller = context.getClass();
		const handler = context.getHandler();
		const req = context.switchToHttp().getRequest();
		const args: Record<string, RouteArg> =
			Reflect.getMetadata(
				ROUTE_ARGS_METADATA,
				controller,
				handler.name
			) ?? {};
		const paramtypes: unknown[] =
			Reflect.getMetadata(
				'design:paramtypes',
				controller.prototype,
				handler.name
			) ?? [];

		for (const [key, arg] of Object.entries(args)) {
			const source = SOURCES[Number(key.split(':')[0])];
			if (!source) continue;
			const current = req[source];
			if (!isPlainObject(current)) continue;
			const map = this.mapFor(arg, paramtypes[arg.index]);
			if (!map) continue;
			// Own property: shadows Express 5's re-parsing `query` getter; plain assignment on Fastify.
			Object.defineProperty(req, source, {
				value: rewrite(current, map),
				writable: true,
				configurable: true,
				enumerable: true,
			});
		}
	}

	private mapFor(arg: RouteArg, paramtype: unknown): PropertyMap | undefined {
		if (typeof arg.data === 'string') return singleKeyMap(arg.data);
		return isUserClass(paramtype) ? propertyMap(paramtype) : undefined;
	}
}
