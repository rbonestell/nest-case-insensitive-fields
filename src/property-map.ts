import 'reflect-metadata';
import { getMetadataStorage } from 'class-validator';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage.js';
import { NestedResolver, PropertyMap, Type } from './rewrite';

type TypeMetadata = ReturnType<typeof defaultMetadataStorage.findTypeMetadata>;

const BUILTINS = new Set<unknown>([
	String,
	Number,
	Boolean,
	Object,
	Array,
	Date,
	Map,
	Set,
	Symbol,
	Function,
	Promise,
	Buffer,
]);
const SWAGGER_FACTORY = '_OPENAPI_METADATA_FACTORY';

export function isUserClass(value: unknown): value is Type {
	return (
		typeof value === 'function' && !!value.prototype && !BUILTINS.has(value)
	);
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

/** The class and its ancestors, nearest first. */
function* classChain(cls: Type): Generator<Type> {
	for (
		let c: unknown = cls;
		typeof c === 'function' && c !== Function.prototype;
		c = Object.getPrototypeOf(c)
	)
		yield c as Type;
}

function build(cls: Type): PropertyMap {
	const names = new Set<string>();
	const wireNames = new Map<string, string>(); // property -> @Expose({ name })
	const swaggerTypes = new Map<string, Type>();

	// 1. class-validator (includes inherited metadata)
	for (const meta of getMetadataStorage().getTargetValidationMetadatas(
		cls,
		'',
		false,
		false
	)) {
		names.add(meta.propertyName);
	}

	// 2. class-transformer @Expose (includes inherited metadata; class-level @Expose() is already filtered out)
	for (const meta of defaultMetadataStorage.getExposedMetadatas(cls)) {
		names.add(meta.propertyName);
		if (meta.options?.name)
			wireNames.set(meta.propertyName, meta.options.name);
	}

	// 3. class-transformer @Type. There is no public way to enumerate it, so read the private per-class map.
	const typeMetadatas: Map<Type, Map<string, unknown>> | undefined = (
		defaultMetadataStorage as any
	)._typeMetadatas;
	for (const c of classChain(cls))
		for (const prop of typeMetadatas?.get(c)?.keys() ?? []) names.add(prop);

	// 4. @nestjs/swagger CLI plugin factory, own class first then ancestors
	for (const c of classChain(cls)) {
		const factory = Object.prototype.hasOwnProperty.call(c, SWAGGER_FACTORY)
			? (c as any)[SWAGGER_FACTORY]
			: undefined;
		if (typeof factory !== 'function') continue;
		let meta: Record<string, { type?: () => unknown } | undefined>;
		try {
			// called as a method, like @nestjs/swagger does: nestjs-zod's factory reads `this.schema`
			meta = factory.call(c) ?? {};
		} catch {
			continue;
		}
		for (const [prop, info] of Object.entries(meta)) {
			names.add(prop);
			const t = swaggerType(info?.type);
			if (t && !swaggerTypes.has(prop)) swaggerTypes.set(prop, t);
		}
	}

	// 5. instance fields (initializers, or all fields when useDefineForClassFields is on)
	try {
		for (const key of Object.keys(new cls() as object)) names.add(key);
	} catch {
		// constructor needs arguments or throws; nothing to learn here
	}

	const map: PropertyMap = new Map();
	for (const name of names) {
		const wire = wireNames.get(name);
		// class-transformer only reads the wire key of an @Expose({ name }) property, so every spelling routes there
		const canonical = wire ?? name;
		const key = canonical.toLowerCase();
		let entry = map.get(key);
		if (!entry) {
			entry = { name: canonical, exact: [canonical] };
			map.set(key, entry);
		} else if (!entry.exact!.includes(canonical)) {
			entry.exact!.push(canonical);
		}
		if (!entry.nested) {
			const resolver = resolverFor(cls, name, swaggerTypes.get(name));
			if (resolver) entry.nested = resolver;
		}
		if (Reflect.getMetadata('design:type', cls.prototype, name) === Map)
			entry.dictionary = true;
		if (wire && !map.has(name.toLowerCase()))
			map.set(name.toLowerCase(), entry);
	}
	return map;
}

function resolverFor(
	cls: Type,
	prop: string,
	swagger: Type | undefined
): NestedResolver | undefined {
	const meta = defaultMetadataStorage.findTypeMetadata(cls, prop);
	const fallback = swagger ?? reflectedType(cls, prop);
	if (!meta) return fallback ? () => propertyMap(fallback) : undefined;
	const discriminator = meta.options?.discriminator;
	return (child, parent) => {
		let type: unknown;
		if (discriminator?.property && discriminator.subTypes) {
			const value = lookup(child, discriminator.property);
			type = discriminator.subTypes.find(
				(subType) => subType.name === value
			)?.value;
		}
		if (!isUserClass(type)) type = callTypeFunction(meta, parent, prop);
		if (!isUserClass(type)) type = fallback;
		return isUserClass(type) ? propertyMap(type) : undefined;
	};
}

function callTypeFunction(
	meta: TypeMetadata,
	parent: Record<string, unknown>,
	prop: string
): unknown {
	const options = { newObject: {}, object: parent, property: prop };
	try {
		return meta.typeFunction
			? meta.typeFunction(options)
			: meta.reflectedType;
	} catch {
		return undefined;
	}
}

/** Case-insensitive own-property lookup; an exact key wins. */
function lookup(obj: Record<string, unknown>, prop: string): unknown {
	if (Object.prototype.hasOwnProperty.call(obj, prop)) return obj[prop];
	const key = Object.keys(obj).find(
		(k) => k.toLowerCase() === prop.toLowerCase()
	);
	return key === undefined ? undefined : obj[key];
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
