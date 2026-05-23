/**
 * browser-test.ts — Playwright-based network interception test.
 *
 * Launches a headless Chromium browser, navigates to a 123av.com video page,
 * intercepts ALL network requests and responses to capture:
 * - The AJAX endpoint the Petite-Vue Movie component calls
 * - The m3u8/HLS stream URL
 * - All XHR/fetch requests and their responses
 *
 * Usage:
 *   npx ts-node src/browser-test.ts
 *
 * Requirements:
 *   Playwright + Chromium installed: npx playwright install chromium
 */

import { chromium, type Page, type Request, type Response } from 'playwright';

// ─── Configuration ───────────────────────────────────────────────

const VIDEO_CODE = 'FC2-PPV-4905651';
const VIDEO_URL = `https://123av.com/en/v/${VIDEO_CODE}`;

// ─── Network Logging ─────────────────────────────────────────────

interface NetworkEntry {
  type: 'REQUEST' | 'RESPONSE';
  url: string;
  method?: string;
  resourceType?: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  responseBody?: string;
  timestamp: number;
}

const networkLog: NetworkEntry[] = [];
const m3u8Urls: string[] = [];
const ajaxEndpoints: string[] = [];

async function onRequest(request: Request) {
  const url = request.url();
  const resourceType = request.resourceType();
  const method = request.method();

  // Log all AJAX/XHR/fetch requests
  if (resourceType === 'xhr' || resourceType === 'fetch') {
    ajaxEndpoints.push(url);
    console.log(`  [AJAX ${method}] ${url}`);
  }

  networkLog.push({
    type: 'REQUEST',
    url,
    method,
    resourceType,
    timestamp: Date.now(),
  });
}

async function onResponse(response: Response) {
  const request = response.request();
  const url = response.url();
  const status = response.status();
  const resourceType = request.resourceType();

  // Check for m3u8 in the URL itself
  if (url.includes('.m3u8')) {
    m3u8Urls.push(url);
    console.log(`  [M3U8 FOUND in URL] ${url} (status: ${status})`);
  }

  let responseBody: string | undefined;

  // For XHR/fetch responses, try to read the body
  if (resourceType === 'xhr' || resourceType === 'fetch') {
    try {
      // Try to get response body as text (only works for same-origin or if CORS allows)
      responseBody = await response.text().catch(() => undefined);

      if (responseBody) {
        // Check for m3u8 URLs in the response body
        const m3u8Match = responseBody.match(/https?:\/\/[^"'\s<>]*\.m3u8[^"'\s<>]*/gi);
        if (m3u8Match) {
          m3u8Match.forEach(u => {
            m3u8Urls.push(u);
            console.log(`  [M3U8 FOUND in Response Body] ${u}`);
          });
        }

        // Check for other stream URL patterns
        const streamMatch = responseBody.match(/"(?:streamUrl|stream_url|url|src|source|m3u8|hls|video_url)"\s*:\s*"([^"]+)"/gi);
        if (streamMatch) {
          console.log(`  [Stream URL Fields in Response] ${responseBody.substring(0, 500)}`);
        }
      }
    } catch {
      // Body may not be accessible (e.g., binary, different origin)
    }

    console.log(`  [AJAX RESP ${status}] ${url}`);
    if (responseBody) {
      // Truncate for logging
      const truncated = responseBody.length > 300
        ? responseBody.substring(0, 300) + '...'
        : responseBody;
      console.log(`    Body: ${truncated}`);
    }
  }

  networkLog.push({
    type: 'RESPONSE',
    url,
    resourceType,
    status,
    statusText: response.statusText(),
    responseBody,
    timestamp: Date.now(),
  });
}

// ─── Main Test ───────────────────────────────────────────────────

async function main() {
  console.log('=== 123AV Browser-Based Network Interception Test ===\n');
  console.log(`Target: ${VIDEO_URL}`);
  console.log(`Video Code: ${VIDEO_CODE}\n`);

  // Launch browser with realistic fingerprint
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });

  const page: Page = await context.newPage();

  // Register network interceptors BEFORE navigation
  page.on('request', onRequest);
  page.on('response', onResponse);

  console.log('Navigating to video page...\n');

  try {
    // Navigate and wait for the page to fully load
    await page.goto(VIDEO_URL, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    console.log('\nPage loaded. Waiting for dynamic content...\n');

    // Wait for the Petite-Vue Movie component to initialize
    // The Movie component creates a <video> element or iframe when ready
    try {
      // Wait for either a video element, an iframe, or the Movie scope to appear
      await page.waitForSelector(
        'video, iframe, [v-scope*="Movie"], #player video, #player iframe',
        { timeout: 20000 }
      );
      console.log('✅ Video player element detected!\n');
    } catch {
      console.log('⚠️  No video/iframe element detected within timeout.');
      console.log('   The page may have loaded but the player initialized differently.\n');
    }

    // Additional wait to catch any delayed AJAX calls
    await page.waitForTimeout(5000);

    // Try to extract the Movie component's internal state from the DOM
    console.log('--- Page Analysis ---');
    const pageContent = await page.content();

    // Look for m3u8 in the final rendered DOM
    const m3u8InDom = pageContent.match(/https?:\/\/[^"'\s<>]*\.m3u8[^"'\s<>]*/gi);
    if (m3u8InDom) {
      console.log('📹 m3u8 URLs found in final DOM:');
      m3u8InDom.forEach(u => console.log(`   ${u}`));
      m3u8Urls.push(...m3u8InDom);
    }

    // Look for Movie component data
    const movieMatch = pageContent.match(/Movie\(\{id:\s*(\d+),\s*code:\s*'([^']+)'\}\)/);
    if (movieMatch) {
      console.log(`\n🎬 Movie Component: id=${movieMatch[1]}, code=${movieMatch[2]}`);
    }

    // Check the page title
    const title = await page.title();
    console.log(`\n📄 Page Title: ${title}`);

  } catch (error) {
    console.error('Error during page navigation:', error);
  } finally {
    // ─── Results Summary ──────────────────────────────────────────

    console.log('\n' + '='.repeat(70));
    console.log('RESULTS SUMMARY');
    console.log('='.repeat(70));

    // All m3u8 URLs found
    console.log(`\n🎬 M3U8 Stream URLs Found: ${m3u8Urls.length}`);
    if (m3u8Urls.length > 0) {
      const unique = [...new Set(m3u8Urls)];
      unique.forEach((u, i) => console.log(`   ${i + 1}. ${u}`));
    } else {
      console.log('   ⚠️  None found');
    }

    // All AJAX endpoints hit
    console.log(`\n🔌 AJAX/XHR Endpoints Hit: ${ajaxEndpoints.length}`);
    if (ajaxEndpoints.length > 0) {
      const unique = [...new Set(ajaxEndpoints)];
      unique.forEach((u, i) => console.log(`   ${i + 1}. ${u}`));
    } else {
      console.log('   ⚠️  No AJAX calls intercepted');
    }

    // Resource type breakdown
    const resourceTypes = new Map<string, number>();
    networkLog
      .filter(e => e.type === 'REQUEST')
      .forEach(e => {
        const rt = e.resourceType || 'unknown';
        resourceTypes.set(rt, (resourceTypes.get(rt) || 0) + 1);
      });

    console.log(`\n📊 Network Requests by Type:`);
    [...resourceTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => console.log(`   ${type}: ${count}`));

    // Key discovery: if we found an AJAX endpoint that returns m3u8 data
    console.log('\n🔍 ENDPOINT DISCOVERY:');
    if (m3u8Urls.length > 0) {
      // Find which AJAX endpoint returned the m3u8 data
      for (const entry of networkLog) {
        if (entry.type === 'RESPONSE' && entry.responseBody) {
          const m3u8Match = entry.responseBody.match(/https?:\/\/[^"'\s<>]*\.m3u8[^"'\s<>]*/gi);
          if (m3u8Match) {
            const requestEntry = networkLog.find(
              e => e.type === 'REQUEST' && e.url === entry.url
            );
            console.log(`   Source: ${entry.url}`);
            console.log(`   Method: ${requestEntry?.method || 'GET'}`);
            console.log(`   Resource Type: ${entry.resourceType}`);
            console.log(`   Response contains m3u8: YES ✅`);
          }
        }
      }
    } else {
      console.log('   No m3u8 URLs found in any network response.');
      console.log('   The site may use WebSocket, DRM-encrypted streams, or');
      console.log('   external player embeds that hide the stream URL.');
    }

    // Save full log for additional analysis
    console.log('\n💾 Saving full network log to /tmp/123av-network-log.json...');
    const fs = await import('fs');
    fs.writeFileSync(
      '/tmp/123av-network-log.json',
      JSON.stringify(networkLog, null, 2)
    );

    await browser.close();
  }

  console.log('\n=== Test Complete ===');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
