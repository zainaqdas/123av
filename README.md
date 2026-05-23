# 123AV API — Unofficial Node.js/TypeScript Scraper

> A comprehensive scraper for 123av.com that extracts video metadata, stream URLs, and browses listings with Cloudflare bypass.

---

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [The Cloudflare Problem](#the-cloudflare-problem)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [Client](#client)
  - [Video](#video)
  - [Cache](#cache)
  - [CloudflareFetcher](#cloudflarefetcher)
- [Stream URL Extraction](#stream-url-extraction)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Error Handling](#error-handling)

---

## Overview

`123av-api` is an unofficial Node.js/TypeScript scraper for 123av.com. It:

1. **Bypasses Cloudflare** using Python's `curl_cffi` library with Chrome TLS fingerprint impersonation (same technique as missav-api)
2. **Extracts video metadata** by parsing HTML with cheerio
3. **Discovers HLS stream URLs** using multiple fallback strategies (direct regex, script extraction, base64 decoding, data attributes, iframes)
4. **Searches videos** by scraping the native search page (no third-party API dependency)
5. **Browses listings** by scraping category, genre, actress, and maker pages

Unlike the missav-api which relies on the Recombee recommendation API for search, this scraper uses **only direct site scraping** — no external API dependencies, no rotating tokens to maintain.

---

## Architecture

```
┌──────────────────────────────────┐
│ 123av.com Server                 │
│ (behind Cloudflare protection)   │
└──────┬───────────────────────────┘
       │
┌──────▼──────────────────────────────────────┐
│ 123av-api Client                            │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ CloudflareFetcher                        │ │
│ │ spawns → python3 fetcher_helper.py <url> │ │
│ │ ↓                                        │ │
│ │ curl_cffi (Chrome TLS impersonation)     │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────┐ ┌────────────────┐ │
│ │ Video                │ │ Cache          │ │
│ │ (lazy-loaded attrs)  │ │ (in-memory,    │ │
│ │ + multi-strategy     │ │ TTL-based)     │ │
│ │   m3u8 extraction)   │ │                │ │
│ └──────────────────────┘ └────────────────┘ │
│                                              │
│ Search: Scrapes /search/{query} directly     │
│ (no Recombee dependency)                     │
└──────────────────────────────────────────────┘
```

**All requests go through a single path**: `CloudflareFetcher` → Python `curl_cffi` → Cloudflare → 123av.com. No separate API domains, no HMAC signing, no token rotation.

---

## The Cloudflare Problem

123av.com is behind Cloudflare. When you make a plain HTTP request (via `axios`, `fetch`, or `curl`), Cloudflare may respond with a challenge page. This blocks all standard HTTP clients.

We chose **curl_cffi** — it impersonates Chrome's TLS/JA3 fingerprint at the libcurl level. Cloudflare sees the exact TLS handshake pattern of a real Chrome browser and lets the request through.

**If Cloudflare is not actively challenging** (as observed in some scenarios), the site may work with standard HTTP — but curl_cffi provides a robust fallback.

---

## Installation

```bash
npm install 123av-api
```

### Python Dependency (for Cloudflare bypass)

The scraper requires Python 3 with `curl_cffi`:

```bash
# Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate

# Install curl_cffi
pip install curl-cffi
```

The fetcher auto-detects Python in:
1. `<project_root>/bin/python3` (project venv)
2. `<cwd>/bin/python3` (current directory venv)
3. `python3` (system PATH fallback)

---

## Quick Start

```typescript
import { Client } from '123av-api';

async function main() {
  const client = new Client();

  // ─── Get video metadata + stream URL ───
  const attrs = await client.getVideoAttributes('FC2-PPV-4905651');
  console.log('Title:', attrs.title);
  console.log('Duration:', attrs.duration, 'seconds');
  console.log('M3U8:', attrs.m3u8Url);
  console.log('Thumbnail:', attrs.thumbnail);
  console.log('Genres:', attrs.genres);
  console.log('Actresses:', attrs.actresses);

  // ─── Search videos ───
  for await (const video of client.search('MIDA', { videoCount: 20 })) {
    const title = await video.getTitle();
    const m3u8 = await video.getM3u8Url();
    console.log(`${video.code}: ${title} — ${m3u8 || 'no stream'}`);
  }

  // ─── Browse new releases ───
  const { videos, totalPages, hasMore } = await client.browseNew();
  console.log(`Found ${videos.length} videos on page 1 of ${totalPages}`);

  // ─── Browse uncensored ───
  const uncensored = await client.browseUncensored();
  console.log('Uncensored videos:', uncensored.videos.length);

  // ─── Get related videos ───
  const related = await client.getRelatedVideos('FC2-PPV-4905651');
  console.log('Related:', related.map(v => v.code));

  // ─── Get genre list ───
  const genres = await client.getGenreList();
  console.log('Available sections:', genres.map(g => g.name));

  // ─── Cleanup ───
  await client.close();
}

main().catch(console.error);
```

---

## API Reference

### Client

```typescript
class Client {
  constructor(config?: ClientConfig)

  // Video
  getVideo(codeOrUrl: string): Promise<Video>
  getVideoAttributes(codeOrUrl: string): Promise<VideoAttributes>

  // Search (async generator — batched concurrent fetches)
  search(query: string, options?: SearchOptions): AsyncGenerator<Video>

  // Browsing / Listings
  browseHome(page?: number): Promise<BrowseResult>
  browseNew(page?: number): Promise<BrowseResult>
  browseRecentUpdate(page?: number): Promise<BrowseResult>
  browseTrending(page?: number): Promise<BrowseResult>
  browseUncensored(page?: number): Promise<BrowseResult>
  browseGenre(genre: string, page?: number): Promise<BrowseResult>
  browseActress(actress: string, page?: number): Promise<BrowseResult>
  browseMaker(maker: string, page?: number): Promise<BrowseResult>

  // Related videos
  getRelatedVideos(code: string): Promise<VideoSummary[]>

  // Lists
  getGenreList(): Promise<GenreInfo[]>

  // Lifecycle
  close(): Promise<void>
  getInfo(): object
}
```

#### ClientConfig

```typescript
interface ClientConfig {
  baseUrl?: string;            // Default: "https://123av.com"
  cacheTtl?: number;           // Default: 300000 (5 min). 0 to disable.
  timeout?: number;            // Default: 30000 (30 sec)
  useCloudflareBypass?: boolean; // Default: true
}
```

#### SearchOptions

```typescript
interface SearchOptions {
  videoCount?: number;  // Max results (default: 50)
  maxWorkers?: number;  // Concurrent fetches (default: 10)
}
```

### Video

The `Video` class uses **lazy loading** with a **concurrency guard**: if multiple getters are called in parallel (via `Promise.all`), they share the same page fetch — the page downloads only once.

```typescript
class Video {
  readonly url: string;
  readonly code: string;

  // All async — each triggers ensureLoaded() if not already loaded
  getTitle(): Promise<string>
  getPublishDate(): Promise<string | undefined>
  getTitleJapanese(): Promise<string | undefined>
  getGenres(): Promise<string[]>
  getSeries(): Promise<string | undefined>
  getManufacturer(): Promise<string | undefined>
  getActresses(): Promise<string[]>
  getThumbnail(): Promise<string>
  getDuration(): Promise<number | undefined>
  getM3u8Url(): Promise<string | undefined>
  getVideoSources(): Promise<string[]>

  // Convenience — calls all getters in parallel (one fetch)
  getAllAttributes(): Promise<VideoAttributes>

  // Static utilities
  static isVideoCode(code: string): boolean
  static extractCodeFromUrl(url: string): string | null
}
```

### VideoAttributes

```typescript
interface VideoAttributes {
  code: string;
  title: string;
  titleJapanese?: string;
  publishDate?: string;
  duration?: number;        // seconds
  genres: string[];
  series?: string;
  manufacturer?: string;
  actresses: string[];
  thumbnail: string;
  m3u8Url?: string;         // HLS master playlist
  videoSources?: string[];   // Direct mp4/webm URLs
}
```

### Cache

```typescript
class Cache {
  constructor(defaultTtl?: number)  // default: 300000ms (5 min)
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T, ttl?: number): void
  has(key: string): boolean
  delete(key: string): void
  clear(): void
  get size(): number
}
```

Key behaviors:
- **Default TTL**: 5 minutes
- **Lazy expiration**: Expired entries deleted on read, not background sweep
- **Cache disabled**: Set `cacheTtl: 0` in config — entries expire immediately
- **Cache keys**: Pages: `page:{url}`, Video HTML: `html:{url}`, Movie IDs: `movieId:{code}`

### CloudflareFetcher

```typescript
class CloudflareFetcher {
  constructor(timeout?: number, retries?: number)
  fetch(url: string): Promise<string>
  test(): Promise<boolean>
  close(): Promise<void>
  getInfo(): object
}
```

---

## Stream URL Extraction

The most critical feature — extracting HLS stream URLs. The scraper uses **6 fallback strategies** in order:

| # | Strategy | What it does |
|---|----------|-------------|
| 1 | **Direct m3u8 regex** | Search entire page HTML for `.m3u8` URLs |
| 2 | **Script extraction** | Search `<script>` tag content for m3u8 URLs |
| 3 | **Common patterns** | Look for `source`, `src`, `url`, `stream`, `file`, `video` assignments containing m3u8/mp4 URLs |
| 4 | **Base64 decode** | Find and decode `atob()`/base64-encoded URL strings |
| 5 | **Data attributes** | Check `data-stream`, `data-src-m3u8`, `data-m3u8` attributes |
| 6 | **Iframe fallback** | Return iframe `src` as a last resort |

The first successful strategy returns immediately — subsequent strategies are not tried.

---

## Data Flow Diagrams

### Single Video Fetch

```
client.getVideoAttributes("FC2-PPV-4905651")
│
▼
client.getVideo("FC2-PPV-4905651")
│
├── Check cache for movieId
├── Fetch page to extract Movie({id, code})
│
▼
new Video(id, code, fetcher, cache)
│
▼
video.getAllAttributes()
│
├──▶ Promise.all([
│     getTitle(), getPublishDate(), getGenres(),
│     getSeries(), getManufacturer(), getActresses(),
│     getThumbnail(), getDuration(), getM3u8Url(),
│     getVideoSources()
│   ])
│
▼
┌─── ensureLoaded() ───────────┐
│ (runs only once — all getters │
│  share this single fetch)     │
│                               │
│ cache hit → use cached HTML   │
│ cache miss → fetch via        │
│   CloudflareFetcher           │
│   → Python curl_cffi          │
│   → 123av.com                 │
└───────────┬───────────────────┘
            │
            ▼
cheerio.load(html)
Extract from DOM:
├─ h1 → title
├─ meta[og:image] → thumbnail
├─ meta[video:duration] → duration
├─ a[href*=genre] → genres
├─ a[href*=actress] → actresses
└─ m3u8 strategies → stream URL
│
▼
Return VideoAttributes object
```

### Search Flow (No Recombee!)

```
client.search("FC2-PPV")
│
▼
Scrape: https://123av.com/en/dm9/search/FC2-PPV?page=1
│  (via CloudflareFetcher → Python curl_cffi)
│
▼
cheerio.load(html) → parseVideoGrid($)
│
├── Find all <a href="/v/..."> links
├── Extract video codes via regex
├── Filter out CSS utility false positives
├── Extract titles, thumbnails, durations
│
▼
Build video URLs from codes
│
▼
Split into batches of maxWorkers (10)
│
▼
For each batch:
┌── Promise.all(codes.map(code => client.getVideo(code)))
│   └── Each Video is fetched individually
└── Yield each resolved Video object
│
▼
AsyncGenerator yields Video objects
```

---

## Error Handling

### Cloudflare Challenge Failure
If the Python helper can't bypass Cloudflare after 3 retries:
```
Failed to fetch page: Cloudflare challenge could not be resolved
Ensure Python 3 and curl_cffi are installed:
python3 -m venv venv && source venv/bin/activate && pip install curl-cffi
```

### Python Not Found
If Python 3 or curl_cffi is not installed:
```
Failed to execute Python fetcher. Ensure Python 3 and curl_cffi are installed.
Python binary: python3
Script path: /path/to/fetcher_helper.py
```

### M3U8 Extraction Failure
If no stream URL can be found, `getM3u8Url()` returns `undefined` — no error is thrown. The caller should handle missing stream URLs gracefully.

### Search Failures
Individual video failures during search are caught and logged — one bad video won't crash the entire search. Failed videos are simply skipped.

---

## Comparison with missav-api

| Feature | missav-api | 123av-api |
|---------|-----------|-----------|
| **Cloudflare bypass** | curl_cffi (same) | curl_cffi (same) |
| **Search backend** | Recombee API (HMAC-signed) | Native site search scraping |
| **External dependencies** | Recombee (PUBLIC_TOKEN rotates) | None |
| **Stream URL extraction** | Obfuscated JS pipe-reversal | 6-strategy fallback |
| **Lazy loading** | Promise guard | Promise guard (same) |
| **Caching** | TTL in-memory | TTL in-memory (same) |
| **Concurrency** | Batched with maxWorkers | Batched with maxWorkers (same) |

---

*This is an unofficial scraper. Use responsibly and in accordance with the target website's terms of service.*
