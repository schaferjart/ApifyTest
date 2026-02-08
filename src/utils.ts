import { log } from 'crawlee';

/**
 * Fetch with automatic retry and exponential backoff.
 * Retries on 429 (rate limit) and 5xx (server errors).
 * Does not retry on 403/404 (client errors that won't resolve with retries).
 */
export async function fetchWithRetry(
    url: string,
    options?: RequestInit,
    maxRetries = 3,
    baseDelayMs = 1000,
): Promise<Response> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(url, options);
            if (res.ok || res.status === 404 || res.status === 403) {
                return res;
            }
            if (attempt < maxRetries && (res.status === 429 || res.status >= 500)) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                log.warning(`Fetch returned ${res.status} for ${url}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            return res;
        } catch (err) {
            if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt);
                log.warning(`Fetch failed for ${url}: ${(err as Error).message}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
    throw new Error('fetchWithRetry: should be unreachable');
}

/** Standard headers to mimic a real browser when fetching YouTube pages. */
export const YOUTUBE_HEADERS: Record<string, string> = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Extract ytInitialPlayerResponse JSON from a YouTube watch page HTML string.
 * Tries multiple regex patterns as YouTube occasionally changes the format.
 * Returns the parsed object or null if extraction fails.
 */
export function extractPlayerResponse(html: string): Record<string, unknown> | null {
    const patterns = [
        /var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s,
        /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s,
        /window\["ytInitialPlayerResponse"\]\s*=\s*(\{.+?\})\s*;/s,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
            try {
                return JSON.parse(match[1]);
            } catch {
                continue;
            }
        }
    }
    return null;
}
