import { rewrite, singleKeyMap, isPlainObject, PropertyMap } from '../src/rewrite';

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
      rewrite({ ONE: { CHILDNAME: 'x' }, Kids: [{ ChildName: 'y' }, 'str', null] }, map),
    ).toEqual({ one: { childName: 'x' }, kids: [{ childName: 'y' }, 'str', null] });
  });

  it('leaves non-object values for nested props untouched', () => {
    expect(rewrite({ one: 'not-an-object' }, map)).toEqual({ one: 'not-an-object' });
    expect(rewrite({ ONE: null }, map)).toEqual({ one: null });
  });

  it('prefers the exact-case key when duplicates differ only by case', () => {
    expect(rewrite({ FIRSTNAME: 'a', firstName: 'b' }, map)).toEqual({ firstName: 'b' });
    expect(rewrite({ firstName: 'b', FIRSTNAME: 'a' }, map)).toEqual({ firstName: 'b' });
  });

  it('lets the last duplicate win when neither is exact-case', () => {
    expect(rewrite({ FIRSTNAME: 'a', FirstName: 'b' }, map)).toEqual({ firstName: 'b' });
  });

  it('drops prototype-polluting keys', () => {
    const input = JSON.parse('{"__proto__": {"polluted": 1}, "constructor": 1, "prototype": 2, "firstName": "a"}');
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

describe('singleKeyMap', () => {
  it('maps exactly one key and leaves the rest alone', () => {
    expect(rewrite({ USERID: 1, other: 2 }, singleKeyMap('userId'))).toEqual({ userId: 1, other: 2 });
  });
});

describe('isPlainObject', () => {
  it.each([[{}], [Object.create(null)], [{ a: 1 }]])('accepts %p', (v) => expect(isPlainObject(v)).toBe(true));
  it('accepts fast-querystring output (prototype is itself null-prototype)', () => {
    function Empty() {}
    Empty.prototype = Object.create(null);
    expect(isPlainObject(new (Empty as any)())).toBe(true);
  });
  it.each([[null], [undefined], [[]], ['s'], [1], [new Date()], [new (class X {})()]])('rejects %p', (v) =>
    expect(isPlainObject(v)).toBe(false),
  );
});
