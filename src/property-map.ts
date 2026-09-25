import 'reflect-metadata';
import { getMetadataStorage } from 'class-validator';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage.js';
import { PropertyEntry, PropertyMap, Type } from './rewrite';

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

function build(cls: Type): PropertyMap {
	const names = new Set<string>();
	const aliases = new Map<string, string>(); // wire name -> property name
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
			aliases.set(meta.options.name, meta.propertyName);
	}

	// 3. @nestjs/swagger CLI plugin factory, own class first then ancestors
	for (
		let c: any = cls;
		typeof c === 'function' && c !== Function.prototype;
		c = Object.getPrototypeOf(c)
	) {
		if (
			!Object.prototype.hasOwnProperty.call(c, SWAGGER_FACTORY) ||
			typeof c[SWAGGER_FACTORY] !== 'function'
		)
			continue;
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
		for (const key of Object.keys(new cls() as object)) names.add(key);
	} catch {
		// constructor needs arguments or throws; nothing to learn here
	}

	const map: PropertyMap = new Map();
	const entries = new Map<string, PropertyEntry>();
	for (const name of names) {
		const nestedCls =
			transformerType(cls, name) ??
			swaggerTypes.get(name) ??
			reflectedType(cls, name);
		const entry: PropertyEntry = nestedCls
			? { name, nested: () => propertyMap(nestedCls) }
			: { name };
		entries.set(name, entry);
		const key = name.toLowerCase();
		if (!map.has(key)) map.set(key, entry);
	}
	for (const [wire, prop] of aliases) {
		const key = wire.toLowerCase();
		if (map.has(key)) continue;
		const base = entries.get(prop);
		map.set(
			key,
			base?.nested ? { name: wire, nested: base.nested } : { name: wire }
		);
	}
	return map;
}

function transformerType(cls: Type, prop: string): Type | undefined {
	const meta = defaultMetadataStorage.findTypeMetadata(cls, prop);
	if (!meta?.typeFunction) return undefined;
	try {
		const t = meta.typeFunction({
			newObject: {},
			object: {},
			property: prop,
		});
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
