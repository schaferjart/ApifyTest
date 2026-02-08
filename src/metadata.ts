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
 * Fetch video metadata using youtubei.js (Innertube client — no API key needed).
 */
export async function fetchMetadata(videoId: string): Promise<VideoMetadata> {
    log.info(`Fetching metadata for video ${videoId}`);

    const { Innertube } = await import('youtubei.js');
    const yt = await Innertube.create({ generate_session_locally: true });

    const info = await yt.getBasicInfo(videoId);
    const details = info.basic_info;

    const title = details.title ?? 'Unknown';
    const channelName = details.channel?.name ?? details.author ?? 'Unknown';
    const channelUrl = details.channel?.url ?? '';
    const durationSeconds = details.duration ?? 0;
    const description = details.short_description ?? '';
    const viewCount = details.view_count ?? 0;

    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    // Parse chapters from description
    const chapters = parseChapters(description);

    // Extract links from description
    const links = extractLinks(description);

    return {
        title,
        channelName,
        channelUrl,
        publishedDate: '', // basic_info doesn't always have this; we set what we can
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
