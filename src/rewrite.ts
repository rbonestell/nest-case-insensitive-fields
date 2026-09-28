export type Type<T = unknown> = new (...args: any[]) => T;

/**
 * Picks the property map for one nested value. `child` is the raw incoming value; `parent` is the
 * container it sits in, already renamed, which is what class-transformer hands to `@Type` callbacks.
 */
export type NestedResolver = (
	child: Record<string, unknown>,
	parent: Record<string, unknown>
) => PropertyMap | undefined;

export interface PropertyEntry {
	/** Key written for any spelling not listed in `exact`. For an `@Expose({ name })` property this is the wire name. */
	name: string;
	/** Spellings preserved verbatim. Defaults to `[name]`. */
	exact?: string[];
	/** Resolves the map for a nested DTO value, or for each element of an array of them. */
	nested?: NestedResolver;
	/** The property is a dictionary (a reflected `Map`): keys are kept, values are rewritten. */
	dictionary?: boolean;
}

/** lowercase incoming key -> entry */
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

export function singleKeyMap(
	name: string,
	nested?: NestedResolver
): PropertyMap {
	return new Map([
		[name.toLowerCase(), nested ? { name, nested } : { name }],
	]);
}

/** Combines the maps of every parameter that reads the same request source, so the source is rewritten once. */
export function mergeMaps(maps: PropertyMap[]): PropertyMap {
	const out: PropertyMap = new Map();
	for (const map of maps) {
		for (const [key, entry] of map) {
			const spellings = entry.exact ?? [entry.name];
			const existing = out.get(key);
			if (!existing) {
				out.set(key, { ...entry, exact: [...spellings] });
				continue;
			}
			for (const spelling of spellings)
				if (!existing.exact!.includes(spelling))
					existing.exact!.push(spelling);
			existing.nested ??= entry.nested;
			if (entry.dictionary) existing.dictionary = true;
		}
	}
	return out;
}

export function rewrite(
	input: Record<string, unknown>,
	map: PropertyMap
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const exactWritten = new Set<string>();
	const pending = new Map<string, PropertyEntry>();
	// Pass 1: rename keys. Exact spellings are kept; other variants collapse to `name` unless an exact key was written.
	for (const key of Object.keys(input)) {
		if (BLOCKED_KEYS.has(key)) continue;
		const entry = map.get(key.toLowerCase());
		if (!entry) {
			out[key] = input[key];
			continue;
		}
		const isExact = (entry.exact ?? [entry.name]).includes(key);
		const target = isExact ? key : entry.name;
		if (!isExact && exactWritten.has(target)) continue;
		if (isExact) exactWritten.add(key);
		out[target] = input[key];
		if (entry.nested || entry.dictionary) pending.set(target, entry);
	}
	// Pass 2: recurse, so resolvers see the renamed parent.
	for (const [target, entry] of pending)
		out[target] = rewriteNested(out[target], entry, out);
	return out;
}

function rewriteNested(
	value: unknown,
	entry: PropertyEntry,
	parent: Record<string, unknown>
): unknown {
	if (entry.dictionary && isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			if (!BLOCKED_KEYS.has(key))
				out[key] = rewriteElement(value[key], entry, parent);
		}
		return out;
	}
	return rewriteElement(value, entry, parent);
}

function rewriteElement(
	value: unknown,
	entry: PropertyEntry,
	parent: Record<string, unknown>
): unknown {
	if (Array.isArray(value))
		return value.map((item) => rewriteElement(item, entry, parent));
	if (!isPlainObject(value) || !entry.nested) return value;
	const nestedMap = entry.nested(value, parent);
	return nestedMap ? rewrite(value, nestedMap) : value;
}
