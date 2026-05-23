/**
 * CloudflareFetcher — delegates HTTP requests to a Python helper using curl_cffi
 * for Chrome TLS fingerprint impersonation to bypass Cloudflare protection.
 *
 * Modeled after the missav-api CloudflareFetcher.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { resolve, join, dirname } from 'path';

const execFileAsync = promisify(execFile);

/** Python binary names to try (in priority order) */
const PYTHON_BINARIES = ['python3', 'python'];

/** Possible locations for the fetcher_helper.py script */
const SCRIPT_PATHS = [
  // Relative to source directory (development)
  join(__dirname, 'fetcher_helper.py'),
  // Relative to compiled dist/ directory
  join(dirname(__dirname), 'src', 'fetcher_helper.py'),
  // One level up from dist/
  join(dirname(dirname(__dirname)), 'src', 'fetcher_helper.py'),
  // Relative to cwd
  join(process.cwd(), 'src', 'fetcher_helper.py'),
  // Parent of cwd (for monorepo/subdirectory setups like Next.js in web/)
  join(process.cwd(), '..', 'src', 'fetcher_helper.py'),
];

/**
 * Resolve the Python 3 binary path.
 * Tries common locations including virtual environments.
 */
function resolvePythonBinary(): string {
  // Collect candidate paths (prefer cwd-local, then parent-dir for monorepos)
  const candidates = [
    // Pattern 1: python3 -m venv .  (creates bin/ at project root)
    join(process.cwd(), 'bin', 'python3'),
    // Pattern 2: python3 -m venv venv (creates venv/bin/)
    join(process.cwd(), 'venv', 'bin', 'python3'),
    // Pattern 3: python3 -m venv .venv (Poetry, uv, VS Code default)
    join(process.cwd(), '.venv', 'bin', 'python3'),
    // Parent-dir patterns for monorepo/subdirectory setups (e.g., Next.js in web/)
    join(process.cwd(), '..', 'bin', 'python3'),
    join(process.cwd(), '..', 'venv', 'bin', 'python3'),
    join(process.cwd(), '..', '.venv', 'bin', 'python3'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Use python3 as system fallback (found on most systems)
  return 'python3';
}

/**
 * Resolve the path to fetcher_helper.py.
 * Tries multiple locations to support dev, compiled, and deployed scenarios.
 */
function resolvePythonScript(): string {
  for (const scriptPath of SCRIPT_PATHS) {
    if (existsSync(scriptPath)) {
      return scriptPath;
    }
  }
  // Fall back to the first path — let Python report the error
  return SCRIPT_PATHS[0];
}

export class CloudflareFetcher {
  private pythonBin: string;
  private pythonScript: string;
  private timeout: number;
  private retries: number;

  constructor(timeout: number = 30000, retries: number = 3) {
    this.pythonBin = resolvePythonBinary();
    this.pythonScript = resolvePythonScript();
    this.timeout = timeout;
    this.retries = retries;
  }

  /**
   * Fetch a URL using the Python curl_cffi helper.
   * @param url The URL to fetch
   * @returns The response body as a string
   */
  async fetch(url: string): Promise<string> {
    const timeoutSeconds = Math.floor(this.timeout / 1000);
    
    try {
      const { stdout, stderr } = await execFileAsync(
        this.pythonBin,
        [
          this.pythonScript,
          url,
          '--timeout', String(timeoutSeconds),
          '--retries', String(this.retries),
        ],
        {
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large pages
          timeout: this.timeout + 10000, // Give Python extra time beyond request timeout
        }
      );

      if (stderr && stderr.trim()) {
        // Log non-critical stderr (retry messages, etc.)
        // Only throw on actual errors
        if (stderr.includes('ERROR:')) {
          throw new Error(`Python fetcher error: ${stderr.trim()}`);
        }
      }

      if (!stdout || !stdout.trim()) {
        throw new Error('Python fetcher returned empty response');
      }

      return stdout;
    } catch (error: unknown) {
      const err = error as Error & { code?: string; stderr?: string };
      
      if (err.code === 'ENOENT') {
        throw new Error(
          `Failed to execute Python fetcher. Ensure Python 3 and curl_cffi are installed:\n` +
          `  python3 -m venv venv && source venv/bin/activate && pip install curl-cffi\n` +
          `  Python binary: ${this.pythonBin}\n` +
          `  Script path: ${this.pythonScript}`
        );
      }

      throw new Error(
        `Failed to fetch page: ${err.message}\n` +
        `Ensure Python 3 and curl_cffi are installed:\n` +
        `  python3 -m venv venv && source venv/bin/activate && pip install curl-cffi`
      );
    }
  }

  /**
   * Test if the Python fetcher is working.
   * @returns true if the fetcher is operational
   */
  async test(): Promise<boolean> {
    try {
      await execFileAsync(this.pythonBin, ['-c', 'from curl_cffi import requests; print("ok")'], {
        timeout: 10000,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Cleanup (no-op for this implementation) */
  async close(): Promise<void> {
    // No persistent resources to clean up
  }

  /** Get information about the Python fetcher configuration */
  getInfo(): { pythonBin: string; scriptPath: string; timeout: number; retries: number } {
    return {
      pythonBin: this.pythonBin,
      scriptPath: this.pythonScript,
      timeout: this.timeout,
      retries: this.retries,
    };
  }
}
