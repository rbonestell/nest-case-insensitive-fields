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
import {
	isPlainObject,
	mergeMaps,
	PropertyMap,
	rewrite,
	singleKeyMap,
	Type,
} from './rewrite';

type Source = 'body' | 'query';

const SOURCES: Record<number, Source> = {
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
		const method = methodName(controller, handler);
		const args: Record<string, RouteArg> =
			Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {};
		const paramtypes: unknown[] =
			Reflect.getMetadata(
				'design:paramtypes',
				controller.prototype,
				method
			) ?? [];

		const maps: Partial<Record<Source, PropertyMap[]>> = {};
		for (const [key, arg] of Object.entries(args)) {
			const source = SOURCES[Number(key.split(':')[0])];
			if (!source) continue;
			const map = this.mapFor(arg, paramtypes[arg.index]);
			if (!map) continue;
			// DTO maps go first so their spelling is canonical when a selector differs only by case.
			(maps[source] ??= [])[arg.data ? 'push' : 'unshift'](map);
		}

		for (const [source, list] of Object.entries(maps)) {
			const current = req[source];
			if (!isPlainObject(current)) continue;
			// Own property: shadows Express 5's re-parsing `query` getter; plain assignment on Fastify.
			Object.defineProperty(req, source, {
				value: rewrite(current, mergeMaps(list)),
				writable: true,
				configurable: true,
				enumerable: true,
			});
		}
	}

	private mapFor(arg: RouteArg, paramtype: unknown): PropertyMap | undefined {
		const dto = isUserClass(paramtype) ? propertyMap(paramtype) : undefined;
		// Nest treats a falsy selector as the whole body/query.
		if (typeof arg.data === 'string' && arg.data)
			return singleKeyMap(arg.data, dto && (() => dto));
		return dto;
	}
}

/** Nest keys route metadata by the prototype property name, which a wrapping decorator may not preserve in `fn.name`. */
function methodName(
	controller: Type,
	handler: { readonly name: string }
): string {
	for (
		let proto = controller.prototype;
		proto && proto !== Object.prototype;
		proto = Object.getPrototypeOf(proto)
	) {
		for (const name of Object.getOwnPropertyNames(proto)) {
			if (Object.getOwnPropertyDescriptor(proto, name)?.value === handler)
				return name;
		}
	}
	return handler.name;
}
