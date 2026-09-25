import { IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Expose, Type } from 'class-transformer';
import { isUserClass, propertyMap } from './property-map';

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
	@Expose({ name: 'home_address' }) @Type(() => Child) home!: Child;
	@Expose() nickname!: string; // bare @Expose, no wire name
	tags: string[] = []; // undecorated, only discoverable by instantiating
}

@Expose() // class-level expose has no propertyName and must be skipped
class SwaggerDto {
	static _OPENAPI_METADATA_FACTORY(): Record<string, any> {
		return {
			title: { required: true, type: () => String },
			note: { required: false }, // no type at all
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

const boom = () => {
	throw new Error('boom');
};

class BareType {
	@ValidateNested() @Type() one!: Child; // @Type() with no function falls back to design:type
	@IsString() @Type(boom) broken!: string;
}

class ThrowingFactory {
	static _OPENAPI_METADATA_FACTORY(): Record<string, any> {
		throw new Error('boom');
	}
	@IsString() name!: string;
}

class NullFactory {
	static _OPENAPI_METADATA_FACTORY(): Record<string, any> {
		return null as any;
	}
	@IsString() name!: string;
}

class ThrowingTypeFactory {
	static _OPENAPI_METADATA_FACTORY(): Record<string, any> {
		return {
			owner: {
				required: false,
				type: () => {
					throw new Error('boom');
				},
			},
		};
	}
}

class CaseClash {
	@IsString() id!: string;
	@IsString() ID!: string;
}

class AliasClash {
	@Expose({ name: 'Nick' }) nick!: string;
}

class NeedsArgs {
	constructor(x: string) {
		if (!x) throw new Error('boom');
	}
	@IsString() name!: string;
}

const describeMap = (cls: any) =>
	[...propertyMap(cls).entries()].map(
		([k, e]) => `${k}=${e.name}${e.nested ? '*' : ''}`
	);

describe('propertyMap', () => {
	it('collects class-validator props including inherited ones', () => {
		expect(describeMap(Dto)).toEqual(
			expect.arrayContaining(['firstname=firstName', 'age=age'])
		);
	});

	it('marks a nested class declared with @Type', () => {
		expect(propertyMap(Dto).get('kids')!.nested!()).toBe(
			propertyMap(Child)
		);
	});

	it('marks a nested class declared only through design:type', () => {
		expect(propertyMap(Dto).get('one')!.nested!()).toBe(propertyMap(Child));
	});

	it('does not mark primitives as nested', () => {
		expect(propertyMap(Dto).get('age')!.nested).toBeUndefined();
		expect(propertyMap(Dto).get('firstname')!.nested).toBeUndefined();
	});

	it('adds an @Expose wire name as an alias that rewrites to the wire name', () => {
		expect(propertyMap(Dto).get('user_name')).toEqual({
			name: 'user_name',
		});
		expect(propertyMap(Dto).get('username')!.name).toBe('userName');
	});

	it('gives an @Expose alias the nested map of its property', () => {
		const alias = propertyMap(Dto).get('home_address')!;
		expect(alias.name).toBe('home_address');
		expect(alias.nested!()).toBe(propertyMap(Child));
	});

	it('falls back to design:type when @Type() has no type function', () => {
		expect(propertyMap(BareType).get('one')!.nested!()).toBe(
			propertyMap(Child)
		);
	});

	it('treats a throwing @Type function as no nested type', () => {
		expect(propertyMap(BareType).get('broken')!.nested).toBeUndefined();
	});

	it('ignores a Swagger factory that throws', () => {
		expect([...propertyMap(ThrowingFactory).keys()]).toEqual(['name']);
	});

	it('ignores a Swagger factory that returns null', () => {
		expect([...propertyMap(NullFactory).keys()]).toEqual(['name']);
	});

	it('treats a throwing Swagger type function as no nested type', () => {
		const entry = propertyMap(ThrowingTypeFactory).get('owner')!;
		expect(entry.name).toBe('owner');
		expect(entry.nested).toBeUndefined();
	});

	it('collects a bare @Expose property with no alias', () => {
		expect(propertyMap(Dto).get('nickname')).toEqual({ name: 'nickname' });
	});

	it('lets the first declared property win when two differ only by case', () => {
		expect(propertyMap(CaseClash).get('id')!.name).toBe('id');
	});

	it('lets the property win over an @Expose alias that differs only by case', () => {
		expect(propertyMap(AliasClash).get('nick')!.name).toBe('nick');
	});

	it('collects a Swagger property that has no type', () => {
		expect(propertyMap(SwaggerSub).get('note')).toEqual({ name: 'note' });
	});

	it('finds undecorated fields by instantiating the class', () => {
		expect(propertyMap(Dto).get('tags')!.name).toBe('tags');
	});

	it('reads Swagger plugin factories up the prototype chain and skips class-level @Expose', () => {
		expect(describeMap(SwaggerSub)).toEqual(
			expect.arrayContaining([
				'title=title',
				'items=items*',
				'owner=owner*',
				'extra=extra',
			])
		);
		expect(propertyMap(SwaggerSub).get('items')!.nested!()).toBe(
			propertyMap(Child)
		);
	});

	it('survives constructors that throw', () => {
		expect(propertyMap(NeedsArgs).get('name')!.name).toBe('name');
	});

	it('caches per class', () => {
		expect(propertyMap(Dto)).toBe(propertyMap(Dto));
	});
});

describe('isUserClass', () => {
	it.each([
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
	])('rejects builtin %p', (v) => expect(isUserClass(v)).toBe(false));
	it.each([undefined, null, 'x', 1, () => 1])('rejects non-class %p', (v) =>
		expect(isUserClass(v)).toBe(false)
	);
	it('accepts user classes', () => expect(isUserClass(Child)).toBe(true));
});
