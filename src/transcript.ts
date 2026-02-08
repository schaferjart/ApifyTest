import { log } from 'crawlee';
import type { TranscriptSegment } from './types.js';

/**
 * Extract the video ID from various YouTube URL formats.
 */
export function extractVideoId(urlOrId: string): string {
    // Already a plain video ID (11 chars, alphanumeric + dash/underscore)
    if (/^[\w-]{11}$/.test(urlOrId)) {
        return urlOrId;
    }

    try {
        const url = new URL(urlOrId);
        // youtube.com/watch?v=ID
        if (url.searchParams.has('v')) {
            return url.searchParams.get('v')!;
        }
        // youtu.be/ID or youtube.com/embed/ID or youtube.com/shorts/ID
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) {
            const lastPart = pathParts[pathParts.length - 1];
            if (/^[\w-]{11}$/.test(lastPart)) {
                return lastPart;
            }
        }
    } catch {
        // not a URL
    }

    throw new Error(`Could not extract video ID from: ${urlOrId}`);
}

/**
 * Format seconds to HH:MM:SS or MM:SS
 */
export function formatTimestamp(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);

    if (h > 0) {
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Fetch transcript/captions for a YouTube video.
 * Uses the youtube-transcript package which pulls auto-generated or manual captions.
 */
export async function fetchTranscript(
    videoId: string,
    language: string = 'en',
): Promise<TranscriptSegment[]> {
    // Dynamic import because youtube-transcript is ESM
    const { YoutubeTranscript } = await import('youtube-transcript');

    log.info(`Fetching transcript for video ${videoId} (lang: ${language})`);

    try {
        const raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: language });

        return raw.map((item: { text: string; offset: number; duration: number }) => ({
            text: item.text,
            startSeconds: Math.round(item.offset / 1000 * 100) / 100,
            durationSeconds: Math.round(item.duration / 1000 * 100) / 100,
            startFormatted: formatTimestamp(item.offset / 1000),
        }));
    } catch (err) {
        log.warning(`Could not fetch transcript: ${(err as Error).message}`);
        return [];
    }
}
