/**
 * Video class — represents a single 123av.com video page.
 *
 * Uses lazy loading with a concurrency guard (Promise-based) to prevent
 * duplicate concurrent fetches. All attribute getters are async and
 * automatically call ensureLoaded() to fetch the page on first access.
 *
 * Modeled after the missav-api Video class.
 */

import * as cheerio from 'cheerio';
import { execFile } from 'child_process';
import { join } from 'path';
import type { CheerioAPI } from 'cheerio';
import type { CloudflareFetcher } from './fetcher';
import type { Cache } from './cache';
import type { VideoAttributes } from './types';
import {
  BASE_URL,
  VIDEO_PAGE_PATH,
  M3U8_REGEX,
  VIDEO_SOURCE_REGEX,
  DURATION_REGEX,
  VIDEO_CODE_REGEX,
  CSS_UTILITY_REGEX,
  AJAX_ENDPOINT_PATTERNS,
  XOR_KEYS,
} from './constants';

export class Video {
  readonly url: string;
  readonly code: string;
  private readonly id: number;

  private fetcher: CloudflareFetcher;
  private cache: Cache;

  private html: string | null = null;
  private $: CheerioAPI | null = null;
  private loadingPromise: Promise<void> | null = null;

  /**
   * @param id The internal numeric video ID (extracted from HTML)
   * @param code The video code (e.g., "FC2-PPV-4905651")
   * @param fetcher CloudflareFetcher instance
   * @param cache Cache instance (optional — pass a disabled cache if not needed)
   */
  constructor(
    id: number,
    code: string,
    fetcher: CloudflareFetcher,
    cache: Cache
  ) {
    this.id = id;
    this.code = code;
    this.url = `${BASE_URL}${VIDEO_PAGE_PATH}/${code}`;
    this.fetcher = fetcher;
    this.cache = cache;
  }

  // ─── Lazy Loading ─────────────────────────────────────────────

  /**
   * Ensure the video page HTML is loaded.
   * Uses a concurrency guard: if multiple getters are called in parallel
   * (via Promise.all), they share the same fetch — the page downloads only once.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.html && this.$) return;

    if (this.loadingPromise) {
      // Fetch already in progress — wait for it
      return this.loadingPromise;
    }

    // Check cache first
    const cacheKey = `html:${this.url}`;
    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      this.html = cached;
      this.$ = cheerio.load(cached);
      return;
    }

    // Fetch with concurrency guard
    this.loadingPromise = (async () => {
      const html = await this.fetcher.fetch(this.url);
      this.html = html;
      // Cache the HTML
      this.cache.set(cacheKey, html);
    })();

    try {
      await this.loadingPromise;
      // Parse HTML after successful fetch
      if (this.html) {
        this.$ = cheerio.load(this.html);
      }
    } finally {
      this.loadingPromise = null;
    }
  }

  // ─── Attribute Getters ─────────────────────────────────────────

  /** Get the video title (English/translated) */
  async getTitle(): Promise<string> {
    await this.ensureLoaded();
    // Title is in an <h1> tag
    const h1 = this.$!('h1').first().text().trim();
    if (h1) return h1;

    // Fallback: check meta og:title
    const ogTitle = this.$!('meta[property="og:title"]').attr('content');
    if (ogTitle) return ogTitle;

    // Fallback: check <title> tag
    return this.$!('title').text().trim();
  }

  /** Get the publish/release date */
  async getPublishDate(): Promise<string | undefined> {
    await this.ensureLoaded();
    // Look for date in meta tags or structured data
    const metaDate = this.$!('meta[property="article:published_time"]').attr('content');
    if (metaDate) return metaDate;

    // Try to find in the details section
    const detailsText = this.$!('#details').text();
    const dateMatch = detailsText.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) return dateMatch[1];

    return undefined;
  }

  /** Get the Japanese/original title if available */
  async getTitleJapanese(): Promise<string | undefined> {
    await this.ensureLoaded();
    // Some videos have a separate Japanese title element
    const jpTitle = this.$!('[class*="title-jp"], [class*="japanese"]').first().text().trim();
    return jpTitle || undefined;
  }

  /** Get genres/tags */
  async getGenres(): Promise<string[]> {
    await this.ensureLoaded();
    const genres: string[] = [];

    // Look for genre links
    this.$!('a[href*="/genre/"]').each((_, el) => {
      const text = this.$!(el).text().trim();
      if (text) genres.push(text);
    });

    // Fallback: meta keywords
    if (genres.length === 0) {
      const keywords = this.$!('meta[name="keywords"]').attr('content');
      if (keywords) {
        return keywords.split(',').map(k => k.trim()).filter(Boolean);
      }
    }

    return [...new Set(genres)];
  }

  /** Get series name */
  async getSeries(): Promise<string | undefined> {
    await this.ensureLoaded();
    // Look for series links or labels
    const seriesLink = this.$!('a[href*="/series/"]').first().text().trim();
    return seriesLink || undefined;
  }

  /** Get manufacturer/studio */
  async getManufacturer(): Promise<string | undefined> {
    await this.ensureLoaded();
    // Look for maker/studio links
    const makerLink = this.$!('a[href*="/maker/"], a[href*="/studio/"]').first().text().trim();
    if (makerLink) return makerLink;

    // Some sites use "manufacturer" label
    const detailsText = this.$!('#details').text();
    const makerMatch = detailsText.match(/manufacturer[:\s]+([^\n]+)/i);
    if (makerMatch) return makerMatch[1].trim();

    return undefined;
  }

  /** Get actress/performers */
  async getActresses(): Promise<string[]> {
    await this.ensureLoaded();
    const actresses: string[] = [];

    // Look for actress links
    this.$!('a[href*="/actress/"], a[href*="/star/"], a[href*="/model/"]').each((_, el) => {
      const text = this.$!(el).text().trim();
      if (text) actresses.push(text);
    });

    return [...new Set(actresses)];
  }

  /** Get the cover/thumbnail image URL */
  async getThumbnail(): Promise<string> {
    await this.ensureLoaded();

    // Check og:image meta tag
    const ogImage = this.$!('meta[property="og:image"]').attr('content');
    if (ogImage) return ogImage;

    // Check data-poster attribute
    const poster = this.$!('[data-poster]').attr('data-poster');
    if (poster) return poster;

    // Check for main image in player
    const playerImg = this.$!('#player img').attr('src');
    if (playerImg) return playerImg;

    // Fallback: return empty string — caller should handle missing thumbnails
    return '';
  }

  /** Get duration in seconds */
  async getDuration(): Promise<number | undefined> {
    await this.ensureLoaded();

    // Check meta video:duration
    const metaDuration = this.$!('meta[property="video:duration"]').attr('content');
    if (metaDuration) {
      const num = parseInt(metaDuration, 10);
      if (!isNaN(num)) return num;
    }

    // Look for duration text (e.g., "01:10:19")
    const durationEl = this.$!('[class*="duration"], [data-duration]').first();
    const durationText = durationEl.text().trim() || durationEl.attr('data-duration') || '';
    
    const match = durationText.match(DURATION_REGEX);
    if (match) {
      const hours = parseInt(match[1] || '0', 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      return hours * 3600 + minutes * 60 + seconds;
    }

    return undefined;
  }

  /**
   * Get the M3U8/HLS stream URL.
   * Uses multiple fallback strategies to extract the stream URL.
   */
  async getM3u8Url(): Promise<string | undefined> {
    await this.ensureLoaded();
    const html = this.html!;

    // Strategy 1: Look for m3u8 URLs directly in the page source
    const m3u8Matches = html.match(M3U8_REGEX);
    if (m3u8Matches && m3u8Matches.length > 0) {
      return m3u8Matches[0];
    }

    // Strategy 2: Look in script tags for embedded URLs
    const scriptContent = this.$!('script').map((_, el) => this.$!(el).html()).get().join('\n');
    
    // Check for m3u8 in scripts
    const scriptM3u8 = scriptContent.match(M3U8_REGEX);
    if (scriptM3u8) return scriptM3u8[0];

    // Strategy 3: Look for common stream URL patterns in scripts
    const sourceUrlMatch = scriptContent.match(
      /(?:source|src|url|stream|file|video)["'\s:=]+(https?:\/\/[^"'\s]+\.(?:m3u8|mp4|ts)[^"'\s]*)/i
    );
    if (sourceUrlMatch) return sourceUrlMatch[1];

    // Strategy 4: Look for base64-encoded URLs
    const b64Match = scriptContent.match(/(?:atob|btoa|base64)\s*\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/);
    if (b64Match) {
      try {
        const decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8');
        const m3u8InB64 = decoded.match(M3U8_REGEX);
        if (m3u8InB64) return m3u8InB64[0];
      } catch {
        // Ignore decode errors
      }
    }

    // Strategy 5: Look for data attributes that might contain stream URLs
    const dataUrl = this.$!('[data-stream], [data-src-m3u8], [data-m3u8]').attr('data-stream') 
      || this.$!('[data-stream], [data-src-m3u8], [data-m3u8]').attr('data-src-m3u8')
      || this.$!('[data-stream], [data-src-m3u8], [data-m3u8]').attr('data-m3u8');
    
    if (dataUrl) {
      const m3u8InData = dataUrl.match(M3U8_REGEX);
      if (m3u8InData) return m3u8InData[0];
      return dataUrl; // Might be the URL directly
    }

    // Strategy 6: Try the confirmed AJAX endpoint with XOR-decoded watch URLs
    // Discovered via Playwright network interception (May 2026):
    // The Petite-Vue Movie component calls /en/ajax/v/{id}/videos
    // which returns base64-XOR-encoded watch URLs pointing to surrit.store
    const m3u8FromAjax = await this.tryAjaxEndpoints();
    if (m3u8FromAjax) return m3u8FromAjax;

    // Strategy 7: Browser-based extraction (Playwright headless Chromium)
    // Loads the 123av.com video page in a real browser, clicks the player,
    // and intercepts the dynamically-constructed m3u8 URL from network requests.
    // This is the same approach used by the 123AV_app Android app.
    const m3u8FromBrowser = await this.extractM3u8WithBrowser(this.url);
    if (m3u8FromBrowser) return m3u8FromBrowser;

    return undefined;
  }

  /** Get all video source URLs (mp4, etc.) */
  async getVideoSources(): Promise<string[]> {
    await this.ensureLoaded();
    const html = this.html!;
    const sources: string[] = [];

    // Find all video source URLs
    const matches = html.match(VIDEO_SOURCE_REGEX);
    if (matches) {
      sources.push(...matches);
    }

    // Also check script content
    const scriptContent = this.$!('script').map((_, el) => this.$!(el).html()).get().join('\n');
    const scriptMatches = scriptContent.match(VIDEO_SOURCE_REGEX);
    if (scriptMatches) {
      sources.push(...scriptMatches);
    }

    return [...new Set(sources)];
  }

  /**
   * Try fetching stream data from known AJAX endpoint patterns.
   *
   * The first pattern (/en/ajax/v/{id}/videos) is the confirmed endpoint
   * discovered via Playwright network interception. It returns:
   * {"status":200,"result":{"watch":[{"url":"base64-xor-encoded"}]}}
   *
   * The url field is base64-encoded after XOR encryption. We try common
   * XOR keys to decode the watch URL, then follow the decoded URL
   * (typically surrit.store) to extract m3u8 URLs.
   *
   * Caches successful patterns per video code for future use.
   */
  private async tryAjaxEndpoints(): Promise<string | undefined> {
    const cacheKey = `ajax:endpoint:${this.code}`;
    const cachedPattern = this.cache.get<string>(cacheKey);

    // Build patterns: use cached pattern first if available, otherwise try all
    const patterns: string[] = cachedPattern
      ? [cachedPattern]
      : AJAX_ENDPOINT_PATTERNS.map(p =>
          p.replace('{id}', String(this.id)).replace('{code}', this.code)
        );

    for (const pattern of patterns) {
      try {
        const url = `${BASE_URL}${pattern}`;
        const response = await this.fetcher.fetch(url);

        // Try to extract m3u8 URL from the response directly
        const m3u8Match = response.match(M3U8_REGEX);
        if (m3u8Match) {
          this.cache.set(cacheKey, pattern);
          return m3u8Match[0];
        }

        // Parse JSON response
        try {
          const json = JSON.parse(response);

          // Handle confirmed endpoint format: {result: {watch: [{url: "..."}]}}
          const watchUrls = json?.result?.watch;
          if (watchUrls && Array.isArray(watchUrls)) {
            const m3u8FromWatch = await this.decodeWatchUrls(watchUrls);
            if (m3u8FromWatch) {
              this.cache.set(cacheKey, pattern);
              return m3u8FromWatch;
            }
          }

          // Handle generic stream URL fields
          const streamUrl =
            json?.result?.streamUrl ||
            json?.result?.url ||
            json?.result?.m3u8 ||
            json?.streamUrl ||
            json?.url ||
            json?.m3u8;

          if (streamUrl && typeof streamUrl === 'string') {
            if (streamUrl.includes('.m3u8')) {
              this.cache.set(cacheKey, pattern);
              return streamUrl;
            }
            const m3u8InJson = streamUrl.match(M3U8_REGEX);
            if (m3u8InJson) {
              this.cache.set(cacheKey, pattern);
              return m3u8InJson[0];
            }
          }
        } catch {
          // Response is not JSON — that's fine
        }
      } catch {
        // Endpoint failed (404, timeout, etc.) — try next
        if (cachedPattern) {
          this.cache.delete(cacheKey);
        }
      }
    }

    return undefined;
  }

  /**
   * Decode base64-XOR-encoded watch URLs from the AJAX response.
   *
   * The watch[] array contains {url: "base64-xor-encoded"} objects.
   * We base64-decode each URL, try XOR keys to decrypt, then follow
   * the resulting stream URL to extract m3u8 URLs.
   */
  private async decodeWatchUrls(
    watchUrls: Array<{ url: string; index?: number; name?: string }>
  ): Promise<string | undefined> {
    for (const watch of watchUrls) {
      if (!watch.url) continue;

      try {
        const decoded = Buffer.from(watch.url, 'base64');
        const decrypted = this.tryXorDecrypt(decoded);
        if (!decrypted) continue;

        // Check if the decrypted URL contains m3u8 directly
        const m3u8Match = decrypted.match(M3U8_REGEX);
        if (m3u8Match) return m3u8Match[0];

        // Otherwise, it's a stream provider URL (surrit.store, etc.)
        // Fetch it and look for m3u8 in the response
        if (decrypted.startsWith('http')) {
          const m3u8FromProvider = await this.fetchStreamProvider(decrypted);
          if (m3u8FromProvider) return m3u8FromProvider;
        }
      } catch {
        // Decode failure — try next watch URL
      }
    }

    return undefined;
  }

  /**
   * Try to XOR-decrypt a buffer using common keys.
   * Returns the decrypted string, or undefined if no key worked.
   */
  private tryXorDecrypt(data: Buffer): string | undefined {
    // Try single-byte XOR keys (common for simple obfuscation)
    for (let key = 0; key < 256; key++) {
      const xored = Buffer.from(data.map(b => b ^ key));
      const text = xored.toString('utf-8');
      if (text.startsWith('http') && !text.includes('\x00')) {
        return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''); // strip control chars
      }
    }

    // Try string XOR keys
    for (const keyStr of XOR_KEYS) {
      const keyBytes = Buffer.from(keyStr);
      const result = Buffer.alloc(data.length);

      for (let i = 0; i < data.length; i++) {
        result[i] = data[i] ^ keyBytes[i % keyBytes.length];
      }

      const text = result.toString('utf-8');
      if (text.startsWith('http') && !text.includes('\x00')) {
        return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
      }
    }

    return undefined;
  }

  /**
   * Fetch a stream provider URL (surrit.store, etc.) and extract m3u8 URLs.
   *
   * Multi-strategy approach:
   * 1. Static: Check response for m3u8 URLs or JSON with media field
   * 2. Browser: If URL is surrit.store, use Playwright headless browser
   *    to load the embed page and intercept the dynamically-constructed m3u8 URL
   */
  private async fetchStreamProvider(providerUrl: string): Promise<string | undefined> {
    // ── Strategy 1: Static extraction ─────────────────────────
    try {
      const response = await this.fetcher.fetch(providerUrl);

      // Check for m3u8 directly
      const m3u8Match = response.match(M3U8_REGEX);
      if (m3u8Match) return m3u8Match[0];

      // Parse JSON and look for base64-encoded media field
      try {
        const json = JSON.parse(response);
        const mediaB64 = json?.result?.media;

        if (mediaB64 && typeof mediaB64 === 'string') {
          const mediaDecoded = Buffer.from(mediaB64, 'base64').toString('utf-8');
          const m3u8InMedia = mediaDecoded.match(M3U8_REGEX);
          if (m3u8InMedia) return m3u8InMedia[0];

          if (mediaDecoded.includes('#EXTM3U') || mediaDecoded.includes('#EXT-X-')) {
            const streamUrlMatch = mediaDecoded.match(
              /https?:\/\/[^\s]+\.(?:m3u8|ts)[^\s]*/i
            );
            if (streamUrlMatch) return streamUrlMatch[0];
          }
        }
      } catch {
        // Not JSON
      }
    } catch {
      // Provider fetch failed for static — try browser below
    }

    // Browser-based extraction is handled by Strategy 7 in getM3u8Url()
    // to avoid redundant browser launches for the same video page.
    return undefined;
  }

  /**
   * Use Playwright headless Chromium to load the 123av.com video page
   * and intercept the dynamically-constructed m3u8 URL from network requests.
   *
   * The player (surrit.store) uses heavily obfuscated JavaScript that
   * constructs the m3u8 URL at runtime. The only reliable way to extract
   * it is via a real browser that executes the JavaScript.
   *
   * This is the same approach used by the 123AV_app Android app.
   * Results are cached per video code to avoid repeated browser launches.
   *
   * @param videoPageUrl The full 123av.com video page URL
   */
  private async extractM3u8WithBrowser(videoPageUrl: string): Promise<string | undefined> {
    const cacheKey = `browser:m3u8:${this.code}`;
    const cached = this.cache.get<string>(cacheKey);
    if (cached !== undefined) {
      return cached || undefined;
    }

    try {
      const { existsSync } = await import('fs');
      let extractorPath = join(process.cwd(), 'src', 'surrit-extractor.ts');
      if (!existsSync(extractorPath)) {
        extractorPath = join(process.cwd(), '..', 'src', 'surrit-extractor.ts');
      }
      if (!existsSync(extractorPath)) {
        return undefined;
      }

      // Resolve project root for cwd
      const projectRoot = join(extractorPath, '..', '..');

      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          'npx',
          ['tsx', extractorPath, videoPageUrl, '60000'],
          {
            timeout: 90000,
            maxBuffer: 1024 * 1024,
            cwd: projectRoot,
          },
          (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr || error.message));
              return;
            }
            const trimmed = stdout.trim();
            if (trimmed.startsWith('ERROR:')) {
              reject(new Error(trimmed));
              return;
            }
            resolve(trimmed);
          }
        );
      });

      const m3u8Url = stdout.trim();
      if (m3u8Url && m3u8Url.startsWith('http') && m3u8Url.includes('.m3u8')) {
        this.cache.set(cacheKey, m3u8Url);
        return m3u8Url;
      }

      this.cache.set(cacheKey, '');
      return undefined;
    } catch {
      this.cache.set(cacheKey, '');
      return undefined;
    }
  }

  // ─── Convenience ───────────────────────────────────────────────

  /**
   * Fetch all video attributes in a single call.
   * All getters share the same page fetch via the concurrency guard.
   */
  async getAllAttributes(): Promise<VideoAttributes> {
    const [
      title,
      titleJapanese,
      publishDate,
      duration,
      genres,
      series,
      manufacturer,
      actresses,
      thumbnail,
      m3u8Url,
      videoSources,
    ] = await Promise.all([
      this.getTitle(),
      this.getTitleJapanese(),
      this.getPublishDate(),
      this.getDuration(),
      this.getGenres(),
      this.getSeries(),
      this.getManufacturer(),
      this.getActresses(),
      this.getThumbnail(),
      this.getM3u8Url(),
      this.getVideoSources(),
    ]);

    return {
      code: this.code,
      title,
      titleJapanese,
      publishDate,
      duration,
      genres,
      series,
      manufacturer,
      actresses,
      thumbnail,
      m3u8Url,
      videoSources,
    };
  }

  // ─── Static Helpers ────────────────────────────────────────────

  /**
   * Extract video code from a URL.
   */
  static extractCodeFromUrl(url: string): string | null {
    // Match /v/{code} pattern
    const match = url.match(/\/v\/([^/?]+)/i);
    if (match) {
      const code = match[1].toUpperCase();
      // Validate it looks like a real video code (not CSS class, not empty)
      if (VIDEO_CODE_REGEX.test(code) && !CSS_UTILITY_REGEX.test(code)) {
        return code;
      }
    }
    return null;
  }

  /**
   * Get the numeric internal ID from the code.
   * This is extracted from the page HTML (Movie component).
   */
  getId(): number {
    return this.id;
  }
}
