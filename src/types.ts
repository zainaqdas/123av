/**
 * Core type definitions for the 123av.com scraper.
 */

/** Configuration options for the Client */
export interface ClientConfig {
  /** Base URL for 123av.com (default: https://123av.com) */
  baseUrl?: string;
  /** Cache time-to-live in milliseconds (default: 300000 = 5 min). Set to 0 to disable. */
  cacheTtl?: number;
  /** Timeout for HTTP requests in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to attempt Cloudflare bypass via curl_cffi (default: true) */
  useCloudflareBypass?: boolean;
}

/** Video metadata attributes extracted from a video page */
export interface VideoAttributes {
  /** The video code (e.g., "FC2-PPV-4905651", "DASS-978") */
  code: string;
  /** English/canonical title */
  title: string;
  /** Japanese/original title if available */
  titleJapanese?: string;
  /** Release/publish date */
  publishDate?: string;
  /** Duration in seconds */
  duration?: number;
  /** Genres/tags */
  genres: string[];
  /** Series name if applicable */
  series?: string;
  /** Manufacturer/studio */
  manufacturer?: string;
  /** Actress/performers */
  actresses: string[];
  /** Cover/thumbnail image URL */
  thumbnail: string;
  /** M3U8 playlist URL (master HLS stream) */
  m3u8Url?: string;
  /** Direct video source URLs if available */
  videoSources?: string[];
}

/** Summary of a video from a listing/search results page */
export interface VideoSummary {
  /** Video code */
  code: string;
  /** Video title */
  title: string;
  /** Full URL to the video page */
  url: string;
  /** Thumbnail/preview image URL */
  thumbnail: string;
  /** Duration string (e.g., "01:10:19") */
  duration?: string;
}

/** Results from browsing a listing page */
export interface BrowseResult {
  /** Videos found on the page */
  videos: VideoSummary[];
  /** Total number of pages available */
  totalPages: number;
  /** Current page number */
  currentPage: number;
  /** Whether there are more pages after this one */
  hasMore: boolean;
}

/** Genre information */
export interface GenreInfo {
  /** Genre name (human-readable) */
  name: string;
  /** Genre slug for URL construction */
  slug: string;
  /** Full URL to the genre page */
  url: string;
}

/** Search options */
export interface SearchOptions {
  /** Maximum number of video results to return (default: 50) */
  videoCount?: number;
  /** Maximum number of concurrent fetches (default: 10) */
  maxWorkers?: number;
}

/** Cache entry with TTL */
export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}
