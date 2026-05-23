/**
 * surrit-extractor.ts — Playwright-based M3U8 URL extractor for 123av.com.
 *
 * Launches a headless Chromium browser, navigates to a 123av.com video page,
 * clicks the player to trigger stream loading, and intercepts the .m3u8
 * network request to capture the stream URL.
 *
 * This is the same approach used by the 123AV_app Android app.
 *
 * Usage (CLI):
 *   npx tsx src/surrit-extractor.ts <video-page-url> [timeout_ms]
 *
 * Example:
 *   npx tsx src/surrit-extractor.ts "https://123av.com/en/v/FC2-PPV-4905651" 60000
 *
 * Outputs the m3u8 URL to stdout on success, or "ERROR: <message>" on failure.
 */

import { chromium } from 'playwright';

export interface ExtractionResult {
  success: boolean;
  m3u8Url?: string;
  error?: string;
}

/**
 * Extract the M3U8 stream URL from a 123av.com video page.
 *
 * Launches a headless Chromium browser, loads the video page,
 * clicks the player to trigger stream loading, and intercepts
 * network requests to capture the first .m3u8 URL.
 *
 * @param videoPageUrl Full 123av.com video page URL (e.g., https://123av.com/en/v/FC2-PPV-4905651)
 * @param timeoutMs Maximum time to wait for m3u8 URL (default 60000ms)
 * @returns Promise resolving to ExtractionResult with m3u8Url on success
 */
export async function extractM3u8FromPage(
  videoPageUrl: string,
  timeoutMs: number = 60000
): Promise<ExtractionResult> {
  const m3u8Urls: string[] = [];

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
    });

    const page = await context.newPage();

    // Remove webdriver flag for headless detection evasion
    await page.addInitScript({
      content: `
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = { runtime: {} };
      `,
    });

    // Intercept ALL requests before navigation
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('.m3u8')) {
        m3u8Urls.push(url);
      }
    });

    // Intercept responses too (m3u8 URLs might appear in response bodies or redirects)
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('.m3u8') && !m3u8Urls.includes(url)) {
        m3u8Urls.push(url);
      }

      // Check response body for m3u8 URLs
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json') || contentType.includes('text') || contentType.includes('javascript')) {
          const body = await response.text().catch(() => '');
          if (body) {
            const matches = body.match(/https?:\/\/[^"'\s<>]*\.m3u8[^"'\s<>]*/gi);
            if (matches) {
              matches.forEach((u) => {
                if (!m3u8Urls.includes(u)) m3u8Urls.push(u);
              });
            }
          }
        }
      } catch {
        // Binary or inaccessible response — ignore
      }
    });

    // Navigate to the 123av.com video page
    await page.goto(videoPageUrl, {
      waitUntil: 'networkidle',
      timeout: Math.min(timeoutMs, 60000),
    });

    // Wait a moment for Petite-Vue Movie component to initialize
    await page.waitForTimeout(3000);

    // Click the player to trigger stream loading (like the 123AV_app does)
    const playerSelectors = [
      '#player', '#player button', '#player a',
      '[v-scope*="Movie"] button:first-child',
      'button[class*="watch"]', 'a[class*="watch"]',
      '.plyr', 'video',
    ];
    for (const sel of playerSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ timeout: 3000 }).catch(() => {});
          console.error(`[surrit-extractor] Clicked player: ${sel}`);
          break;
        }
      } catch {
        // Selector didn't match — try next
      }
    }

    // Also try clicking the center of the page (where player typically is)
    try {
      await page.mouse.click(960, 400);
    } catch {
      // Ignore click errors
    }

    // Wait for m3u8 URL to appear
    const startTime = Date.now();
    while (m3u8Urls.length === 0 && Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(500);

      // Periodically check DOM for m3u8 URLs
      try {
        const content = await page.content();
        const matches = content.match(/https?:\/\/[^"'\s<>]*\.m3u8[^"'\s<>]*/gi);
        if (matches) {
          matches.forEach((u) => {
            if (!m3u8Urls.includes(u)) m3u8Urls.push(u);
          });
        }
      } catch {
        // Ignore DOM access errors
      }
    }

    if (m3u8Urls.length > 0) {
      // Prefer the main video.m3u8 over quality variants (qc/v.m3u8)
      const mainM3u8 = m3u8Urls.find(u => u.includes('video.m3u8'));
      const url = mainM3u8 || m3u8Urls[0];
      return { success: true, m3u8Url: url };
    }

    return {
      success: false,
      error: 'No m3u8 URL intercepted. The site player may have changed.',
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Browser error: ${error.message || String(error)}`,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ─── CLI Entry Point ─────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('ERROR: Usage: npx tsx src/surrit-extractor.ts <video-page-url> [timeout_ms]');
    process.exit(1);
  }

  const videoUrl = args[0];
  const timeout = args[1] ? parseInt(args[1], 10) : 60000;

  if (!videoUrl.includes('123av.com/v/') && !videoUrl.includes('123av.com/en/v/') && !videoUrl.includes('123av.com/zh/v/')) {
    console.error('ERROR: URL must be a 123av.com video page URL');
    process.exit(1);
  }

  const result = await extractM3u8FromPage(videoUrl, timeout);

  if (result.success && result.m3u8Url) {
    console.log(result.m3u8Url);
  } else {
    console.error(`ERROR: ${result.error}`);
    process.exit(1);
  }
}

// Only run CLI if executed directly (not imported as module)
const isMainModule =
  process.argv[1]?.endsWith('surrit-extractor.ts') ||
  process.argv[1]?.endsWith('surrit-extractor.js');
if (isMainModule) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message || String(error)}`);
    process.exit(1);
  });
}
