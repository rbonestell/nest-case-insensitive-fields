import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CaseInsensitiveFieldsInterceptor } from './interceptor';

@Module({
	providers: [
		{
			provide: APP_INTERCEPTOR,
			useClass: CaseInsensitiveFieldsInterceptor,
		},
	],
})
export class CaseInsensitiveFieldsModule {}
