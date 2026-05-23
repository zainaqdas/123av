/**
 * Constants and regex patterns for the 123av.com scraper.
 * These are extracted from reverse-engineering the site's HTML/JS structure.
 */

import type { GenreInfo } from './types';

/** Default base URL for 123av.com */
export const BASE_URL = 'https://123av.com';

/** Default listing page (dm9 category) */
export const DEFAULT_LISTING_PATH = '/en/dm9';

/** CDN base URL for images and assets */
export const CDN_URL = 'https://cdn.123av.me';

/** Video page URL pattern: /en/v/{code} */
export const VIDEO_PAGE_PATH = '/en/v';

/** Default request timeout in ms */
export const DEFAULT_TIMEOUT = 30000;

/** Default cache TTL in ms (5 minutes) */
export const DEFAULT_CACHE_TTL = 300000;

// ─── Regex Patterns ──────────────────────────────────────────────

/** Matches video codes: FC2-PPV-123456 or JAV codes like JUL-123, STARS-456 */
export const VIDEO_CODE_REGEX = /(fc2-ppv-\d+|[A-Z]{2,6}-\d{2,})(?:\?|$)/i;

/** CSS utility class patterns to exclude from video code matches */
export const CSS_UTILITY_REGEX = /^(mb|mt|my|pt|pb|pr|pl|px|py|gap|text|bg|border|font|opacity|flex|grid|w-|h-|min-|max-|rounded|shadow|z-|top-|bottom-|left-|right-|inset-|leading|tracking|align|justify|items|content|self|place|order|col|row|overflow|object|transition|duration|ease|scale|rotate|translate|skew|transform)/;

/** Regex to find m3u8 URLs in page source */
export const M3U8_REGEX = /https?:\/\/[^"'\s<>]*\.m3u8[^"'\s<>]*/gi;

/** Regex to find video source URLs (mp4, ts, etc.) */
export const VIDEO_SOURCE_REGEX = /https?:\/\/[^"'\s<>]*\.(?:mp4|webm|ts|mkv)[^"'\s<>]*/gi;

/** Regex to extract duration from text like "01:10:19" */
export const DURATION_REGEX = /(?:(\d+):)?(\d+):(\d+)/;

/** Regex to find the Movie component initialization in HTML */
export const MOVIE_INIT_REGEX = /Movie\(\{id:\s*(\d+),\s*code:\s*'([^']+)'\}\)/;

/** Regex for pagination links */
export const PAGE_REGEX = /page=(\d+)/;

// ─── AJAX Endpoint Patterns to Try ───────────────────────────────

/** 
 * Multiple AJAX endpoint patterns to attempt when fetching video stream data.
 * The actual endpoint is obfuscated in the minified JS bundle,
 * so we try several common patterns and cache successful hits.
 */
export const AJAX_ENDPOINT_PATTERNS = [
  '/ajax/movie/{id}',
  '/ajax/video/{id}',
  '/ajax/movie/get/{id}',
  '/ajax/movie/{code}',
  '/ajax/video/{code}',
  '/ajax/stream/{id}',
  '/ajax/player/{id}',
  '/ajax/movie/stream/{id}',
  '/movie/{id}',
  '/video/{id}',
];

// ─── Known Site Sections / Category Slugs ────────────────────────

/** Known listing categories from the dm9 page */
export const KNOWN_CATEGORIES: GenreInfo[] = [
  { name: 'Featured', slug: 'featured', url: `${BASE_URL}/en/dm9` },
  { name: 'Just Baked', slug: 'new-release', url: `${BASE_URL}/en/dm9?section=new-release` },
  { name: 'Fresh', slug: 'recent-update', url: `${BASE_URL}/en/dm9?section=recent-update` },
  { name: 'Trending', slug: 'trending', url: `${BASE_URL}/en/dm9?section=trending` },
  { name: 'Uncensored', slug: 'uncensored', url: `${BASE_URL}/en/dm9?section=uncensored` },
  { name: 'Random', slug: 'random', url: `${BASE_URL}/en/dm9?section=random` },
];

/** Genre-specific listing pages (exported for consumer convenience) */
export const GENRE_LIST: GenreInfo[] = [
  { name: 'Censored', slug: 'censored', url: `${BASE_URL}/en/dm9?section=censored` },
  { name: 'Uncensored', slug: 'uncensored', url: `${BASE_URL}/en/dm9?section=uncensored` },
];
