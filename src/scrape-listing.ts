/**
 * scrape-listing.ts — Use Playwright browser to scrape video codes from listing page,
 * then test stream URL extraction for multiple videos.
 *
 * Usage:
 *   npx tsx src/scrape-listing.ts
 */

import { chromium, type Browser, type Page, type Request, type Response } from 'playwright';

const LISTING_URL = 'https://123av.com/en/dm9?section=trending';
const NUM_VIDEOS_TO_TEST = 5;

interface VideoResult {
  code: string;
  title: string;
  m3u8Urls: string[];
  ajaxEndpoints: string[];
  error?: string;
}

async function scrapeVideoCodes(page: Page): Promise<string[]> {
  console.log(`\n=== Scraping listing page: ${LISTING_URL} ===`);
  await page.goto(LISTING_URL, { waitUntil: 'networkidle', timeout: 60000 });
  
  // Wait for video cards to render
  await page.waitForSelector('a[href*="/v/"]', { timeout: 15000 }).catch(() => {
    console.log('  Warning: no /v/ links found, trying alternative selectors');
  });
  await page.waitForTimeout(3000);

  // Extract all video codes from the rendered page
  const codes = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href*="/v/"]');
    const seen = new Set<string>();
    const codes: string[] = [];
    
    links.forEach(a => {
      const href = a.getAttribute('href') || '';
      const match = href.match(/\/v\/([^/?]+)/i);
      if (match) {
        const code = match[1].toUpperCase();
        // Filter: must match JAV/FC2 video code pattern
        if (/^(FC2-PPV-\d+|[A-Z]{2,6}-\d{2,})$/.test(code) && !seen.has(code)) {
          seen.add(code);
          codes.push(code);
        }
      }
    });
    return codes;
  });

  console.log(`  Found ${codes.length} valid video codes`);
  codes.slice(0, NUM_VIDEOS_TO_TEST).forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
  return codes;
}

async function testVideoStream(
  browser: Browser,
  code: string
): Promise<VideoResult> {
  const url = `https://123av.com/en/v/${code}`;
  console.log(`\n--- Testing: ${code} ---`);
  console.log(`  URL: ${url}`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();
  const m3u8Urls: string[] = [];
  const ajaxEndpoints: string[] = [];

  page.on('request', (req: Request) => {
    const rt = req.resourceType();
    if (rt === 'xhr' || rt === 'fetch') {
      ajaxEndpoints.push(req.url());
    }
    if (req.url().includes('.m3u8')) {
      m3u8Urls.push(req.url());
    }
  });

  page.on('response', async (resp: Response) => {
    const req = resp.request();
    const rt = req.resourceType();
    
    if (resp.url().includes('.m3u8') && !m3u8Urls.includes(resp.url())) {
      m3u8Urls.push(resp.url());
    }

    if (rt === 'xhr' || rt === 'fetch') {
      try {
        const body = await resp.text().catch(() => '');
        const m3u8Matches = body.match(/https?:\/\/[^"'\s<>]*\.m3u8[^"'\s<>]*/gi);
        if (m3u8Matches) {
          m3u8Matches.forEach(u => {
            if (!m3u8Urls.includes(u)) m3u8Urls.push(u);
          });
        }
      } catch { /* ignore */ }
    }
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    
    // Wait for Movie component to initialize
    try {
      await page.waitForSelector(
        'video, iframe, [v-scope*="Movie"], #player video, #player iframe',
        { timeout: 20000 }
      );
    } catch {
      // No player found
    }
    
    await page.waitForTimeout(5000);
  } catch (err) {
    const result: VideoResult = {
      code,
      title: '',
      m3u8Urls,
      ajaxEndpoints,
      error: err instanceof Error ? err.message : String(err),
    };
    await context.close();
    return result;
  }

  const title = await page.title();
  await context.close();

  return {
    code,
    title,
    m3u8Urls: [...new Set(m3u8Urls)],
    ajaxEndpoints: [...new Set(ajaxEndpoints)],
  };
}

async function main() {
  console.log('=== 123AV Multi-Video Stream URL Test ===\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    // Step 1: Scrape video codes from listing page
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    const listPage = await context.newPage();
    let codes = await scrapeVideoCodes(listPage);
    await context.close();

    // If scraping failed, use hardcoded fallback codes
    if (codes.length === 0) {
      console.log('\n⚠️  Listing page scrape returned 0 codes — using fallback codes');
      codes = ['FC2-PPV-4905651', 'DASS-978', 'JUL-123', 'STARS-456', 'ABP-789'];
    }

    const testCodes = codes.slice(0, NUM_VIDEOS_TO_TEST);

    // Step 2: Test each video for stream URLs
    const results: VideoResult[] = [];
    for (const code of testCodes) {
      const result = await testVideoStream(browser, code);
      results.push(result);
    }

    // Step 3: Print results table
    console.log('\n' + '='.repeat(80));
    console.log('RESULTS SUMMARY');
    console.log('='.repeat(80));
    console.log();

    let successCount = 0;
    for (const r of results) {
      const status = r.error
        ? '❌ ERROR'
        : r.m3u8Urls.length > 0
        ? '✅ STREAM FOUND'
        : '⚠️  NO STREAM';

      if (r.m3u8Urls.length > 0) successCount++;

      console.log(`${status} | ${r.code.padEnd(20)} | ${r.title.substring(0, 50)}`);
      
      if (r.error) {
        console.log(`         Error: ${r.error}`);
      }
      if (r.m3u8Urls.length > 0) {
        r.m3u8Urls.forEach(u => console.log(`         m3u8: ${u}`));
      }
      if (r.ajaxEndpoints.length > 0) {
        const ajaxPaths = r.ajaxEndpoints
          .filter(u => u.includes('123av.com'))
          .map(u => new URL(u).pathname);
        if (ajaxPaths.length > 0) {
          console.log(`         AJAX: ${ajaxPaths.join(', ')}`);
        }
      }
      console.log();
    }

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Total: ${results.length} videos | Streams found: ${successCount} | ${results.length > 0 ? Math.round(successCount / results.length * 100) : 0}% success rate`);

  } finally {
    await browser.close();
  }

  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
