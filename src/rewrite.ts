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

export function isPlainObject(
	value: unknown
): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value))
		return false;
	const proto = Object.getPrototypeOf(value);
	// Third case: fast-querystring (Fastify) builds query objects from a prototype that is itself null-prototype.
	return (
		proto === null ||
		proto === Object.prototype ||
		Object.getPrototypeOf(proto) === null
	);
}

export function singleKeyMap(name: string): PropertyMap {
	return new Map([[name.toLowerCase(), { name }]]);
}

export function rewrite(
	input: Record<string, unknown>,
	map: PropertyMap
): Record<string, unknown> {
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

function rewriteNested(
	value: unknown,
	nested: PropertyEntry['nested']
): unknown {
	if (!nested) return value;
	if (Array.isArray(value))
		return value.map((item) =>
			isPlainObject(item) ? rewrite(item, nested()) : item
		);
	return isPlainObject(value) ? rewrite(value, nested()) : value;
}
