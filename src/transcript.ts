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

interface CaptionTrack {
    baseUrl: string;
    languageCode: string;
    name?: { simpleText?: string };
    kind?: string;
}

/**
 * Fetch transcript by scraping the watch page for caption track URLs,
 * then fetching the timedtext XML directly.
 *
 * This avoids third-party libraries that break when YouTube updates their player.
 */
export async function fetchTranscript(
    videoId: string,
    language: string = 'en',
): Promise<TranscriptSegment[]> {
    log.info(`Fetching transcript for video ${videoId} (lang: ${language})`);

    try {
        // Step 1: Fetch watch page to find caption tracks
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const res = await fetch(watchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        const html = await res.text();

        // Extract ytInitialPlayerResponse which contains captionTracks
        const playerMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
        if (!playerMatch) {
            log.warning('Could not find ytInitialPlayerResponse in page');
            return [];
        }

        const player = JSON.parse(playerMatch[1]) as {
            captions?: {
                playerCaptionsTracklistRenderer?: {
                    captionTracks?: CaptionTrack[];
                };
            };
        };

        const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (!tracks || tracks.length === 0) {
            log.warning('No caption tracks found for this video');
            return [];
        }

        // Step 2: Pick the best track — prefer exact language match, then auto-generated
        let track = tracks.find((t) => t.languageCode === language && t.kind !== 'asr');
        if (!track) track = tracks.find((t) => t.languageCode === language);
        if (!track) track = tracks.find((t) => t.kind !== 'asr'); // any manual track
        if (!track) track = tracks[0]; // fallback to first available

        log.info(`Using caption track: ${track.languageCode} (${track.kind ?? 'manual'})`);

        // Step 3: Fetch the timedtext XML
        // Append fmt=json3 to get JSON format instead of XML
        const captionUrl = `${track.baseUrl}&fmt=json3`;
        const captionRes = await fetch(captionUrl);
        if (!captionRes.ok) {
            log.warning(`Caption fetch failed with status ${captionRes.status}`);
            return [];
        }

        const captionData = (await captionRes.json()) as {
            events?: Array<{
                tStartMs?: number;
                dDurationMs?: number;
                segs?: Array<{ utf8?: string }>;
            }>;
        };

        if (!captionData.events) {
            log.warning('No events in caption data');
            return [];
        }

        // Step 4: Parse into our format
        const segments: TranscriptSegment[] = [];

        for (const event of captionData.events) {
            // Skip events without text segments (e.g. line break markers)
            if (!event.segs) continue;

            const text = event.segs
                .map((s) => s.utf8 ?? '')
                .join('')
                .trim();

            if (!text || text === '\n') continue;

            const startMs = event.tStartMs ?? 0;
            const durationMs = event.dDurationMs ?? 0;
            const startSeconds = Math.round((startMs / 1000) * 100) / 100;
            const durationSeconds = Math.round((durationMs / 1000) * 100) / 100;

            segments.push({
                text,
                startSeconds,
                durationSeconds,
                startFormatted: formatTimestamp(startMs / 1000),
            });
        }

        return segments;
    } catch (err) {
        log.warning(`Could not fetch transcript: ${(err as Error).message}`);
        return [];
    }
}
