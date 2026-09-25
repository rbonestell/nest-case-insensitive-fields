// class-transformer ships its types under types/, not next to cjs/, so the deep import needs this declaration.
declare module 'class-transformer/cjs/storage.js' {
	import { MetadataStorage } from 'class-transformer/types/MetadataStorage';
	export const defaultMetadataStorage: MetadataStorage;
}
