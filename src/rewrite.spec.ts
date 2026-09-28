import {
	rewrite,
	singleKeyMap,
	mergeMaps,
	isPlainObject,
	PropertyEntry,
	PropertyMap,
} from './rewrite';

const childMap: PropertyMap = new Map([['childname', { name: 'childName' }]]);
const map: PropertyMap = new Map([
	['firstname', { name: 'firstName' }],
	['kids', { name: 'kids', nested: () => childMap }],
	['one', { name: 'one', nested: () => childMap }],
]);

describe('rewrite', () => {
	it('maps keys to canonical names case-insensitively', () => {
		expect(rewrite({ FIRSTNAME: 'a' }, map)).toEqual({ firstName: 'a' });
	});

	it('passes unknown keys through untouched', () => {
		expect(rewrite({ Unknown: 1 }, map)).toEqual({ Unknown: 1 });
	});

	it('recurses into nested objects and arrays of objects', () => {
		expect(
			rewrite(
				{
					ONE: { CHILDNAME: 'x' },
					Kids: [{ ChildName: 'y' }, 'str', null],
				},
				map
			)
		).toEqual({
			one: { childName: 'x' },
			kids: [{ childName: 'y' }, 'str', null],
		});
	});

	it('leaves non-object values for nested props untouched', () => {
		expect(rewrite({ one: 'not-an-object' }, map)).toEqual({
			one: 'not-an-object',
		});
		expect(rewrite({ ONE: null }, map)).toEqual({ one: null });
	});

	it('prefers the exact-case key when duplicates differ only by case', () => {
		expect(rewrite({ FIRSTNAME: 'a', firstName: 'b' }, map)).toEqual({
			firstName: 'b',
		});
		expect(rewrite({ firstName: 'b', FIRSTNAME: 'a' }, map)).toEqual({
			firstName: 'b',
		});
	});

	it('lets the last duplicate win when neither is exact-case', () => {
		expect(rewrite({ FIRSTNAME: 'a', FirstName: 'b' }, map)).toEqual({
			firstName: 'b',
		});
	});

	it('drops prototype-polluting keys', () => {
		const input = JSON.parse(
			'{"__proto__": {"polluted": 1}, "constructor": 1, "prototype": 2, "firstName": "a"}'
		);
		const out = rewrite(input, map);
		expect(Object.keys(out)).toEqual(['firstName']);
		expect(({} as any).polluted).toBeUndefined();
	});

	it('copies non-plain values by reference', () => {
		const d = new Date();
		expect(rewrite({ FIRSTNAME: d }, map).firstName).toBe(d);
	});

	it('handles null-prototype input objects (Node querystring output)', () => {
		const input = Object.create(null);
		input.FIRSTNAME = 'a';
		expect(rewrite(input, map)).toEqual({ firstName: 'a' });
	});

	it('does not mutate the input', () => {
		const input = { FIRSTNAME: 'a' };
		rewrite(input, map);
		expect(input).toEqual({ FIRSTNAME: 'a' });
	});
});

describe('rewrite with exact spellings, resolvers and dictionaries', () => {
	const idMap: PropertyMap = new Map([
		['id', { name: 'id', exact: ['id', 'ID'] }],
	]);

	it('keeps every exact spelling and collapses only non-exact variants', () => {
		expect(rewrite({ id: 'a', ID: 'b' }, idMap)).toEqual({
			id: 'a',
			ID: 'b',
		});
		expect(rewrite({ Id: 'a', ID: 'b' }, idMap)).toEqual({
			id: 'a',
			ID: 'b',
		});
	});

	it('recurses through arrays of arrays', () => {
		expect(rewrite({ KIDS: [[{ CHILDNAME: 'a' }], 'x'] }, map)).toEqual({
			kids: [[{ childName: 'a' }], 'x'],
		});
	});

	it('rewrites dictionary values but never dictionary keys', () => {
		const dict: PropertyMap = new Map([
			[
				'entries',
				{ name: 'entries', dictionary: true, nested: () => childMap },
			],
		]);
		expect(
			rewrite(
				{ ENTRIES: { CHILDNAME: { CHILDNAME: 1 }, other: 'x' } },
				dict
			)
		).toEqual({
			entries: { CHILDNAME: { childName: 1 }, other: 'x' },
		});
	});

	it('drops prototype-polluting keys inside dictionaries', () => {
		const dict: PropertyMap = new Map([
			[
				'entries',
				{ name: 'entries', dictionary: true, nested: () => childMap },
			],
		]);
		const input = JSON.parse(
			'{"entries": {"__proto__": {"polluted": 1}, "ok": {"CHILDNAME": 1}}}'
		);
		expect(rewrite(input, dict)).toEqual({
			entries: { ok: { childName: 1 } },
		});
		expect(({} as any).polluted).toBeUndefined();
	});

	it('gives resolvers the raw child and the already renamed parent', () => {
		const seen: unknown[] = [];
		const m: PropertyMap = new Map<string, PropertyEntry>([
			['kind', { name: 'kind' }],
			[
				'child',
				{
					name: 'child',
					nested: (child, parent) => {
						seen.push([{ ...child }, { ...parent }]);
						return childMap;
					},
				},
			],
		]);
		expect(rewrite({ CHILD: { CHILDNAME: 'a' }, KIND: 'k' }, m)).toEqual({
			child: { childName: 'a' },
			kind: 'k',
		});
		expect(seen).toEqual([
			[{ CHILDNAME: 'a' }, { child: { CHILDNAME: 'a' }, kind: 'k' }],
		]);
	});

	it('leaves a nested value alone when the resolver returns nothing', () => {
		const m: PropertyMap = new Map([
			['child', { name: 'child', nested: () => undefined }],
		]);
		expect(rewrite({ CHILD: { X: 1 } }, m)).toEqual({ child: { X: 1 } });
	});
});

describe('mergeMaps', () => {
	it('unions exact spellings and keeps the first nested resolver without mutating inputs', () => {
		const a: PropertyMap = new Map([
			['firstname', { name: 'firstName', nested: () => childMap }],
		]);
		const b: PropertyMap = new Map([
			['firstname', { name: 'firstname' }],
			['other', { name: 'other' }],
		]);
		const merged = mergeMaps([a, b]);
		expect(merged.get('firstname')).toEqual({
			name: 'firstName',
			exact: ['firstName', 'firstname'],
			nested: expect.any(Function),
		});
		expect(merged.get('other')).toEqual({
			name: 'other',
			exact: ['other'],
		});
		expect(a.get('firstname')!.exact).toBeUndefined();
	});

	it('deduplicates spellings and propagates the dictionary flag', () => {
		const a: PropertyMap = new Map([
			['x', { name: 'x', nested: () => childMap }],
		]);
		const b: PropertyMap = new Map([
			['x', { name: 'x', dictionary: true }],
		]);
		expect(mergeMaps([a, a, b]).get('x')).toEqual({
			name: 'x',
			exact: ['x'],
			nested: expect.any(Function),
			dictionary: true,
		});
	});
});

describe('singleKeyMap', () => {
	it('maps exactly one key and leaves the rest alone', () => {
		expect(
			rewrite({ USERID: 1, other: 2 }, singleKeyMap('userId'))
		).toEqual({ userId: 1, other: 2 });
	});
});

describe('isPlainObject', () => {
	it.each([[{}], [Object.create(null)], [{ a: 1 }]])('accepts %p', (v) =>
		expect(isPlainObject(v)).toBe(true)
	);
	it('accepts fast-querystring output (prototype is itself null-prototype)', () => {
		function Empty() {}
		Empty.prototype = Object.create(null);
		expect(isPlainObject(new (Empty as any)())).toBe(true);
	});
	it.each([
		[null],
		[undefined],
		[[]],
		['s'],
		[1],
		[new Date()],
		[new (class X {})()],
	])('rejects %p', (v) => expect(isPlainObject(v)).toBe(false));
});
