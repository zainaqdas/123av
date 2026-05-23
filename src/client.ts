/**
 * Client class — main entry point for the 123av.com scraper.
 *
 * Provides methods for:
 * - Getting video metadata and stream URLs
 * - Searching for videos (via native site search scraping)
 * - Browsing listing pages (new releases, genres, etc.)
 * - Getting related videos
 *
 * Modeled after the missav-api Client class, but replaces the Recombee
 * search API with direct site scraping.
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { CloudflareFetcher } from './fetcher';
import { Cache } from './cache';
import { Video } from './video';
import type {
  ClientConfig,
  VideoAttributes,
  VideoSummary,
  BrowseResult,
  GenreInfo,
  SearchOptions,
} from './types';
import {
  BASE_URL,
  DEFAULT_LISTING_PATH,
  VIDEO_PAGE_PATH,
  VIDEO_CODE_REGEX,
  CSS_UTILITY_REGEX,
  PAGE_REGEX,
  DEFAULT_TIMEOUT,
  DEFAULT_CACHE_TTL,
  MOVIE_INIT_REGEX,
} from './constants';

export class Client {
  private baseUrl: string;
  private fetcher: CloudflareFetcher;
  private cache: Cache;

  constructor(config: ClientConfig = {}) {
    this.baseUrl = config.baseUrl || BASE_URL;
    
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;
    const useBypass = config.useCloudflareBypass ?? true;
    this.fetcher = new CloudflareFetcher(timeout, useBypass ? 3 : 1);

    const cacheTtl = config.cacheTtl ?? DEFAULT_CACHE_TTL;
    this.cache = new Cache(cacheTtl);
  }

  // ─── Video Methods ─────────────────────────────────────────────

  /**
   * Get a Video object for the given video code or URL.
   * @param codeOrUrl Video code (e.g., "FC2-PPV-4905651") or full URL
   */
  async getVideo(codeOrUrl: string): Promise<Video> {
    const code = Video.extractCodeFromUrl(codeOrUrl) || codeOrUrl.toUpperCase();
    
    // Try to get the internal ID from a cached page or fetch it
    let id = this.getCachedMovieId(code);
    if (!id) {
      id = await this.fetchMovieId(code);
    }

    return new Video(id, code, this.fetcher, this.cache);
  }

  /**
   * Get all video attributes directly (convenience method).
   */
  async getVideoAttributes(codeOrUrl: string): Promise<VideoAttributes> {
    const video = await this.getVideo(codeOrUrl);
    return video.getAllAttributes();
  }

  /**
   * Get the internal numeric movie ID for a video code.
   * This is needed for the Movie component initialization.
   */
  private async fetchMovieId(code: string): Promise<number> {
    const url = `${this.baseUrl}${VIDEO_PAGE_PATH}/${code}`;
    const html = await this.fetcher.fetch(url);
    
    // Try to find Movie({id: 123, code: 'XXX'}) in the HTML
    const match = html.match(MOVIE_INIT_REGEX);
    if (match) {
      const id = parseInt(match[1], 10);
      this.cache.set(`movieId:${code}`, id);
      return id;
    }

    // Fallback: throw — we need the real ID to construct Video objects
    throw new Error(
      `Could not find internal movie ID for code "${code}". ` +
      `The page structure may have changed.`
    );
  }

  /** Get cached movie ID or undefined */
  private getCachedMovieId(code: string): number | undefined {
    return this.cache.get<number>(`movieId:${code}`);
  }

  // ─── Search ────────────────────────────────────────────────────

  /**
   * Search for videos on 123av.com by scraping the native search page.
   * Returns an async generator that yields Video objects.
   *
   * Unlike the missav-api which uses the Recombee API, this method
   * scrapes 123av.com's native search results at /search/{query}.
   *
   * @param query Search query (video code, keyword, actress name, etc.)
   * @param options Search options
   */
  async *search(
    query: string,
    options: SearchOptions = {}
  ): AsyncGenerator<Video> {
    const maxWorkers = options.maxWorkers ?? 10;
    const videoCount = options.videoCount ?? 50;

    let page = 1;
    let totalFetched = 0;

    while (totalFetched < videoCount) {
      const results = await this.getSearchResults(query, page);
      
      if (results.videos.length === 0) break;

      // Fetch video details in batches
      for (const batch of this.chunk(results.videos, maxWorkers)) {
        const promises = batch.map(async (summary) => {
          try {
            return await this.getVideo(summary.code);
          } catch (error) {
            console.error(`Failed to fetch video ${summary.code}:`, error);
            return null;
          }
        });

        const videos = (await Promise.all(promises)).filter(Boolean) as Video[];
        
        for (const video of videos) {
          if (totalFetched >= videoCount) return;
          yield video;
          totalFetched++;
        }
      }

      if (!results.hasMore) break;
      page++;
    }
  }

  /**
   * Get search results for a specific page.
   */
  private async getSearchResults(query: string, page: number): Promise<BrowseResult> {
    const encodedQuery = encodeURIComponent(query);
    // The site's Search() component uses action="search" (relative path)
    // with name="keyword", meaning the search is submitted as a query parameter.
    // Try both URL patterns as the exact format depends on the site's routing.
    const url = `${this.baseUrl}${DEFAULT_LISTING_PATH}?keyword=${encodedQuery}&page=${page}`;
    
    const html = await this.fetcher.fetch(url);
    const $ = cheerio.load(html);

    const videos = this.parseVideoGrid($);
    const totalPages = this.getTotalPages($);

    return {
      videos,
      totalPages,
      currentPage: page,
      hasMore: page < totalPages,
    };
  }

  // ─── Browsing / Listing Pages ──────────────────────────────────

  /**
   * Browse the main listing page (dm9).
   * @param page Page number (1-based)
   */
  async browseHome(page: number = 1): Promise<BrowseResult> {
    const url = `${this.baseUrl}${DEFAULT_LISTING_PATH}?page=${page}`;
    return this.scrapeListPage(url, page);
  }

  /**
   * Browse new releases.
   */
  async browseNew(page: number = 1): Promise<BrowseResult> {
    const url = `${this.baseUrl}${DEFAULT_LISTING_PATH}?section=new-release&page=${page}`;
    return this.scrapeListPage(url, page);
  }

  /**
   * Browse recent updates.
   */
  async browseRecentUpdate(page: number = 1): Promise<BrowseResult> {
    const url = `${this.baseUrl}${DEFAULT_LISTING_PATH}?section=recent-update&page=${page}`;
    return this.scrapeListPage(url, page);
  }

  /**
   * Browse trending videos.
   */
  async browseTrending(page: number = 1): Promise<BrowseResult> {
    const url = `${this.baseUrl}${DEFAULT_LISTING_PATH}?section=trending&page=${page}`;
    return this.scrapeListPage(url, page);
  }

  /**
   * Browse uncensored videos.
   */
  async browseUncensored(page: number = 1): Promise<BrowseResult> {
    const url = `${this.baseUrl}${DEFAULT_LISTING_PATH}?section=uncensored&page=${page}`;
    return this.scrapeListPage(url, page);
  }

  /**
   * Browse a specific genre/category.
   */
  async browseGenre(genre: string, page: number = 1): Promise<BrowseResult> {
    const url = `${this.baseUrl}${DEFAULT_LISTING_PATH}?section=${encodeURIComponent(genre)}&page=${page}`;
    return this.scrapeListPage(url, page);
  }

  /**
   * Browse videos by actress.
   */
  async browseActress(actress: string, page: number = 1): Promise<BrowseResult> {
    const actressSlug = actress.toLowerCase().replace(/\s+/g, '-');
    const url = `${this.baseUrl}/en/actress/${actressSlug}?page=${page}`;
    return this.scrapeListPage(url, page);
  }

  /**
   * Browse videos by maker/studio.
   */
  async browseMaker(maker: string, page: number = 1): Promise<BrowseResult> {
    const makerSlug = maker.toLowerCase().replace(/\s+/g, '-');
    const url = `${this.baseUrl}/en/maker/${makerSlug}?page=${page}`;
    return this.scrapeListPage(url, page);
  }

  // ─── Related Videos ────────────────────────────────────────────

  /**
   * Get related/similar videos for a given video.
   */
  async getRelatedVideos(code: string): Promise<VideoSummary[]> {
    const url = `${this.baseUrl}${VIDEO_PAGE_PATH}/${code}`;
    const html = await this.fetcher.fetch(url);
    const $ = cheerio.load(html);

    const summaries: VideoSummary[] = [];
    const seen = new Set<string>();

    // Exclude the current video from related results
    seen.add(code.toUpperCase());

    // Find all links to other video pages
    $('a[href*="/v/"]').each((_, el) => {
      const href = $(el).attr('href');
      const relatedCode = Video.extractCodeFromUrl(href || '');
      
      if (relatedCode && !seen.has(relatedCode)) {
        seen.add(relatedCode);
        
        const title = $(el).attr('title') || $(el).find('img').attr('alt') || '';
        const thumbnail = $(el).find('img').attr('data-src')
          || $(el).find('img').attr('src')
          || '';
        const duration = $(el).find('[class*="duration"]').text().trim()
          || undefined;

        summaries.push({
          code: relatedCode,
          title,
          url: `${this.baseUrl}${VIDEO_PAGE_PATH}/${relatedCode.toLowerCase()}`,
          thumbnail,
          duration,
        });
      }
    });

    return summaries;
  }

  // ─── Genre & Maker Lists ───────────────────────────────────────

  /**
   * Get the list of available genres/categories.
   */
  async getGenreList(): Promise<GenreInfo[]> {
    const url = `${this.baseUrl}${DEFAULT_LISTING_PATH}`;
    const html = await this.fetcher.fetch(url);
    const $ = cheerio.load(html);

    const genres: GenreInfo[] = [];
    const seen = new Set<string>();

    // Look for genre/section links
    $('a[href*="section="]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const sectionMatch = href.match(/section=([^&]+)/);
      
      if (sectionMatch) {
        const slug = sectionMatch[1];
        if (!seen.has(slug)) {
          seen.add(slug);
          genres.push({
            name: $(el).text().trim() || slug.replace(/-/g, ' '),
            slug,
            url: `${this.baseUrl}${DEFAULT_LISTING_PATH}?section=${slug}`,
          });
        }
      }
    });

    return genres;
  }

  // ─── Parsing Utilities ─────────────────────────────────────────

  /**
   * Parse the video grid from a listing page.
   * Extracts video codes, titles, and thumbnails from the page.
   */
  private parseVideoGrid($: CheerioAPI): VideoSummary[] {
    const results: VideoSummary[] = [];
    const seen = new Set<string>();

    // Strategy 1: Find all anchor tags with /v/ in href
    $('a[href*="/v/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const code = Video.extractCodeFromUrl(href);
      
      if (!code || seen.has(code)) return;
      
      // Filter out CSS utility-class-looking codes
      if (CSS_UTILITY_REGEX.test(code)) return;
      
      seen.add(code);

      // Get title from various sources
      const title =
        $(el).attr('title') ||
        $(el).find('[class*="title"]').text().trim() ||
        $(el).find('img').attr('alt') ||
        $(el).text().trim() ||
        '';

      // Get thumbnail
      const thumbnail =
        $(el).find('img').attr('data-src') ||
        $(el).find('img').attr('src') ||
        $(el).find('[data-preview]').attr('data-preview') ||
        $(el).find('[data-poster]').attr('data-poster') ||
        '';

      // Get duration
      const duration =
        $(el).find('[class*="duration"]').text().trim() ||
        $(el).attr('data-duration') ||
        undefined;

      results.push({
        code,
        title: title || code,
        url: `${this.baseUrl}${VIDEO_PAGE_PATH}/${code.toLowerCase()}`,
        thumbnail,
        duration,
      });
    });

    // Strategy 2 (fallback): If no results, try finding video codes in image alt text
    if (results.length === 0) {
      $('img[alt]').each((_, el) => {
        const alt = $(el).attr('alt') || '';
        const codeMatch = alt.match(VIDEO_CODE_REGEX);
        
        if (codeMatch && !seen.has(codeMatch[1])) {
          const code = codeMatch[1].toUpperCase();
          if (CSS_UTILITY_REGEX.test(code)) return;
          
          seen.add(code);

          // Walk up to find the parent link
          const parentLink = $(el).closest('a');
          const href = parentLink.attr('href') || `${VIDEO_PAGE_PATH}/${code.toLowerCase()}`;

          results.push({
            code,
            title: alt,
            url: href.startsWith('http') ? href : `${this.baseUrl}${href}`,
            thumbnail: $(el).attr('data-src') || $(el).attr('src') || '',
          });
        }
      });
    }

    return results;
  }

  /**
   * Get the total number of pages from pagination links.
   */
  private getTotalPages($: CheerioAPI): number {
    let total = 1;

    $('a[href*="page="]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(PAGE_REGEX);
      if (match) {
        total = Math.max(total, parseInt(match[1], 10));
      }
    });

    return total;
  }

  /**
   * Scrape a listing page and return parsed results.
   */
  private async scrapeListPage(url: string, page: number): Promise<BrowseResult> {
    const cacheKey = `page:${url}`;
    const cached = this.cache.get<string>(cacheKey);
    
    let html: string;
    if (cached) {
      html = cached;
    } else {
      html = await this.fetcher.fetch(url);
      this.cache.set(cacheKey, html);
    }

    const $ = cheerio.load(html);
    const videos = this.parseVideoGrid($);
    const totalPages = this.getTotalPages($);

    return {
      videos,
      totalPages,
      currentPage: page,
      hasMore: page < totalPages,
    };
  }

  // ─── Utilities ─────────────────────────────────────────────────

  /** Split an array into chunks of the given size */
  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /** Clean up resources */
  async close(): Promise<void> {
    await this.fetcher.close();
  }

  /** Get information about the client configuration */
  getInfo(): object {
    return {
      baseUrl: this.baseUrl,
      fetcher: this.fetcher.getInfo(),
      cacheSize: this.cache.size,
    };
  }
}
