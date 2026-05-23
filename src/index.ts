/**
 * 123av-api — Unofficial Node.js/TypeScript scraper for 123av.com
 *
 * Main entry point. Exports all public classes and types.
 *
 * @example
 * ```typescript
 * import { Client } from '123av-api';
 *
 * const client = new Client();
 *
 * // Get video metadata
 * const attrs = await client.getVideoAttributes('FC2-PPV-4905651');
 * console.log(attrs.title, attrs.m3u8Url);
 *
 * // Search for videos
 * for await (const video of client.search('FC2-PPV')) {
 *   console.log(await video.getTitle());
 * }
 *
 * // Browse new releases
 * const { videos } = await client.browseNew();
 *
 * await client.close();
 * ```
 */

export { Client } from './client';
export { Video } from './video';
export { Cache } from './cache';
export { CloudflareFetcher } from './fetcher';

export type {
  ClientConfig,
  VideoAttributes,
  VideoSummary,
  BrowseResult,
  GenreInfo,
  SearchOptions,
} from './types';
