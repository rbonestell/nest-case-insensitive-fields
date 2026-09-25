import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Expose, Type } from 'class-transformer';
import { isUserClass, propertyMap } from '../src/property-map';

class Child {
  @IsString() childName!: string;
}

class Base {
  @IsString() firstName!: string;
}

class Dto extends Base {
  @IsOptional() @IsInt() age?: number;
  @ValidateNested({ each: true }) @Type(() => Child) kids!: Child[];
  @ValidateNested() one!: Child; // nested type comes from design:type only
  @Expose({ name: 'user_name' }) userName!: string;
  tags: string[] = []; // undecorated, only discoverable by instantiating
}

@Expose() // class-level expose has no propertyName and must be skipped
class SwaggerDto {
  static _OPENAPI_METADATA_FACTORY(): Record<string, any> {
    return {
      title: { required: true, type: () => String },
      items: { required: false, type: () => [Child] },
      owner: { required: false, type: () => Child },
    };
  }
}

class SwaggerSub extends SwaggerDto {
  static _OPENAPI_METADATA_FACTORY(): Record<string, any> {
    return { extra: { required: true, type: () => Number } };
  }
}

class NeedsArgs {
  constructor(x: string) {
    if (!x) throw new Error('boom');
  }
  @IsString() name!: string;
}

const describeMap = (cls: any) =>
  [...propertyMap(cls).entries()].map(([k, e]) => `${k}=${e.name}${e.nested ? '*' : ''}`);

describe('propertyMap', () => {
  it('collects class-validator props including inherited ones', () => {
    expect(describeMap(Dto)).toEqual(expect.arrayContaining(['firstname=firstName', 'age=age']));
  });

  it('marks a nested class declared with @Type', () => {
    expect(propertyMap(Dto).get('kids')!.nested!()).toBe(propertyMap(Child));
  });

  it('marks a nested class declared only through design:type', () => {
    expect(propertyMap(Dto).get('one')!.nested!()).toBe(propertyMap(Child));
  });

  it('does not mark primitives as nested', () => {
    expect(propertyMap(Dto).get('age')!.nested).toBeUndefined();
    expect(propertyMap(Dto).get('firstname')!.nested).toBeUndefined();
  });

  it('adds an @Expose wire name as an alias that rewrites to the wire name', () => {
    expect(propertyMap(Dto).get('user_name')).toEqual({ name: 'user_name' });
    expect(propertyMap(Dto).get('username')!.name).toBe('userName');
  });

  it('finds undecorated fields by instantiating the class', () => {
    expect(propertyMap(Dto).get('tags')!.name).toBe('tags');
  });

  it('reads Swagger plugin factories up the prototype chain and skips class-level @Expose', () => {
    expect(describeMap(SwaggerSub)).toEqual(
      expect.arrayContaining(['title=title', 'items=items*', 'owner=owner*', 'extra=extra']),
    );
    expect(propertyMap(SwaggerSub).get('items')!.nested!()).toBe(propertyMap(Child));
  });

  it('survives constructors that throw', () => {
    expect(propertyMap(NeedsArgs).get('name')!.name).toBe('name');
  });

  it('caches per class', () => {
    expect(propertyMap(Dto)).toBe(propertyMap(Dto));
  });
});

describe('isUserClass', () => {
  it.each([String, Number, Boolean, Object, Array, Date, Map, Set, Symbol, Function, Promise, Buffer])(
    'rejects builtin %p',
    (v) => expect(isUserClass(v)).toBe(false),
  );
  it.each([undefined, null, 'x', 1, () => 1])('rejects non-class %p', (v) => expect(isUserClass(v)).toBe(false));
  it('accepts user classes', () => expect(isUserClass(Child)).toBe(true));
});
