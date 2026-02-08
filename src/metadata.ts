import { log } from 'crawlee';
import type { VideoChapter, ExtractedLink } from './types.js';
import { formatTimestamp } from './transcript.js';

/** Regex to find URLs in text */
const URL_REGEX = /https?:\/\/[^\s)<>\"]+/g;

/** Regex to find timestamp-based chapters in descriptions like "0:00 Intro" */
const CHAPTER_REGEX = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)$/gm;

export interface VideoMetadata {
    title: string;
    channelName: string;
    channelUrl: string;
    publishedDate: string;
    duration: string;
    durationSeconds: number;
    viewCount: number;
    description: string;
    thumbnailUrl: string;
    chapters: VideoChapter[];
    links: ExtractedLink[];
}

/**
 * Fetch video metadata by scraping the YouTube watch page.
 *
 * Strategy:
 *  1. oEmbed API for title + channel (always works, official endpoint)
 *  2. Watch page HTML → extract ytInitialPlayerResponse JSON for duration,
 *     description, view count, etc.
 */
export async function fetchMetadata(videoId: string): Promise<VideoMetadata> {
    log.info(`Fetching metadata for video ${videoId}`);

    // --- oEmbed (reliable basics) ---
    let title = 'Unknown';
    let channelName = 'Unknown';
    let channelUrl = '';

    try {
        const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
        const oembedRes = await fetch(oembedUrl);
        if (oembedRes.ok) {
            const oembed = (await oembedRes.json()) as {
                title?: string;
                author_name?: string;
                author_url?: string;
            };
            title = oembed.title ?? title;
            channelName = oembed.author_name ?? channelName;
            channelUrl = oembed.author_url ?? channelUrl;
        }
    } catch (err) {
        log.warning(`oEmbed fetch failed: ${(err as Error).message}`);
    }

    // --- Watch page scrape (description, duration, views) ---
    let description = '';
    let durationSeconds = 0;
    let viewCount = 0;
    let publishedDate = '';

    try {
        const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const watchRes = await fetch(watchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        const html = await watchRes.text();

        // Extract ytInitialPlayerResponse
        const playerMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
        if (playerMatch) {
            const player = JSON.parse(playerMatch[1]) as {
                videoDetails?: {
                    shortDescription?: string;
                    lengthSeconds?: string;
                    viewCount?: string;
                    title?: string;
                    author?: string;
                    channelId?: string;
                };
                microformat?: {
                    playerMicroformatRenderer?: {
                        publishDate?: string;
                        description?: { simpleText?: string };
                    };
                };
            };
            const details = player.videoDetails;
            if (details) {
                description = details.shortDescription ?? '';
                durationSeconds = parseInt(details.lengthSeconds ?? '0', 10);
                viewCount = parseInt(details.viewCount ?? '0', 10);
                // Use playerResponse title/author as fallback
                if (title === 'Unknown') title = details.title ?? title;
                if (channelName === 'Unknown') channelName = details.author ?? channelName;
                if (!channelUrl && details.channelId) {
                    channelUrl = `https://www.youtube.com/channel/${details.channelId}`;
                }
            }
            const micro = player.microformat?.playerMicroformatRenderer;
            if (micro) {
                publishedDate = micro.publishDate ?? '';
            }
        }
    } catch (err) {
        log.warning(`Watch page scrape failed: ${(err as Error).message}`);
    }

    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    const chapters = parseChapters(description);
    const links = extractLinks(description);

    return {
        title,
        channelName,
        channelUrl,
        publishedDate,
        duration: formatTimestamp(durationSeconds),
        durationSeconds,
        viewCount,
        description,
        thumbnailUrl,
        chapters,
        links,
    };
}

/**
 * Parse chapter markers from a video description.
 * YouTube chapters are lines like "0:00 Introduction" or "1:23:45 Advanced Topics"
 */
export function parseChapters(description: string): VideoChapter[] {
    const chapters: VideoChapter[] = [];
    let match: RegExpExecArray | null;

    // Reset regex
    CHAPTER_REGEX.lastIndex = 0;

    while ((match = CHAPTER_REGEX.exec(description)) !== null) {
        const hours = match[1] ? parseInt(match[1], 10) : 0;
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;

        chapters.push({
            title: match[4].trim(),
            startSeconds: totalSeconds,
            startFormatted: formatTimestamp(totalSeconds),
        });
    }

    return chapters;
}

/**
 * Extract all URLs from a text block, with surrounding context.
 */
export function extractLinks(text: string): ExtractedLink[] {
    const links: ExtractedLink[] = [];
    const seen = new Set<string>();

    let match: RegExpExecArray | null;
    const regex = new RegExp(URL_REGEX.source, 'g');

    while ((match = regex.exec(text)) !== null) {
        let url = match[0];
        // Clean trailing punctuation that's likely not part of the URL
        url = url.replace(/[.,;:!?)]+$/, '');

        if (seen.has(url)) continue;
        seen.add(url);

        // Grab some context around the link
        const start = Math.max(0, match.index - 40);
        const end = Math.min(text.length, match.index + url.length + 40);
        const context = text.slice(start, end).replace(/\n/g, ' ').trim();

        links.push({ url, context });
    }

    return links;
}
