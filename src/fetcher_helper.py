#!/usr/bin/env python3
"""
fetcher_helper.py — TLS-impersonated HTTP fetcher for bypassing Cloudflare.

This script is spawned by the Node.js CloudflareFetcher class.
It uses curl_cffi to impersonate Chrome's TLS/JA3 fingerprint,
allowing requests to pass through Cloudflare's bot detection.

Usage:
    python3 fetcher_helper.py <url> [--timeout 30] [--retries 3]

Output:
    Prints the response body to stdout on success.
    Exits with non-zero code and prints error to stderr on failure.

Requirements:
    pip install curl-cffi
"""

import sys
import time
import argparse

try:
    from curl_cffi import requests
except ImportError:
    print(
        "ERROR: curl_cffi is not installed. "
        "Install it with: pip install curl-cffi",
        file=sys.stderr,
    )
    sys.exit(1)


def fetch_with_retry(url: str, timeout: int = 30, retries: int = 3) -> str:
    """
    Fetch a URL using Chrome TLS impersonation with retry logic.
    
    Detects Cloudflare challenge pages by looking for common
    Cloudflare challenge indicators in the response body.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        "Accept": (
            "text/html,application/xhtml+xml,"
            "application/xml;q=0.9,image/webp,*/*;q=0.8"
        ),
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Ch-Ua": (
            '"Google Chrome";v="131", "Chromium";v="131", '
            '"Not_A Brand";v="24"'
        ),
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }
    
    # Cloudflare challenge indicators to detect
    challenge_indicators = [
        "Just a moment...",
        "Checking your browser",
        "cf-challenge-running",
        "Please turn JavaScript on",
        "cf-browser-verification",
        "Attention Required! | Cloudflare",
        "jschl-answer",
        "challenge-form",
        "DDoS protection by",
    ]
    
    last_error = None
    
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(
                url,
                impersonate="chrome131",
                headers=headers,
                timeout=timeout,
            )
            
            # Check for Cloudflare challenge page
            is_challenge = any(
                indicator.lower() in resp.text.lower()
                for indicator in challenge_indicators
            )
            
            if not is_challenge:
                return resp.text
            
            if attempt < retries:
                print(
                    f"[retry {attempt}/{retries}] Cloudflare challenge detected, "
                    f"retrying in 2s...",
                    file=sys.stderr,
                )
                time.sleep(2)
            else:
                last_error = RuntimeError(
                    "Cloudflare challenge could not be resolved after "
                    f"{retries} attempts"
                )
        except Exception as e:
            last_error = e
            if attempt < retries:
                print(
                    f"[retry {attempt}/{retries}] Request failed: {e}, "
                    f"retrying in 2s...",
                    file=sys.stderr,
                )
                time.sleep(2)
    
    if last_error:
        raise last_error
    
    raise RuntimeError("Failed to fetch page for unknown reason")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch a URL with Chrome TLS impersonation"
    )
    parser.add_argument("url", help="URL to fetch")
    parser.add_argument(
        "--timeout", type=int, default=30, help="Request timeout in seconds"
    )
    parser.add_argument(
        "--retries", type=int, default=3, help="Number of retry attempts"
    )
    
    args = parser.parse_args()
    
    try:
        html = fetch_with_retry(args.url, args.timeout, args.retries)
        print(html)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
