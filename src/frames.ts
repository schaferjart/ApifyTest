import { log } from 'crawlee';
import { Actor } from 'apify';
import type { StillFrame, VideoChapter, TranscriptSegment } from './types.js';
import { formatTimestamp } from './transcript.js';

/** Parsed storyboard tile info */
interface StoryboardTile {
    url: string;
    tileRect: { x: number; y: number; w: number; h: number };
    timestampMs: number;
}

/** Internal timestamp with metadata */
interface TimestampCandidate {
    seconds: number;
    label: string;
    relevance: string;
    priority: number;
    transcriptContext?: string;
    chapterTitle?: string;
}

// --- Visual cue patterns ---
const VISUAL_CUE_PATTERNS = [
    /as you can see/i,
    /let me show you/i,
    /this diagram/i,
    /here'?s the code/i,
    /this example/i,
    /look at this/i,
    /on the screen/i,
    /right here/i,
    /notice that/i,
    /take a look/i,
];

/**
 * Parse a YouTube storyboard spec string into time-indexed thumbnail tiles.
 *
 * Spec format: quality levels separated by `#`.
 * Each level: `baseUrl|width|height|count|cols|rows|intervalMs|sigh|...`
 * The baseUrl contains `$M` placeholder for the sheet index.
 */
export function parseStoryboardSpec(spec: string): StoryboardTile[] {
    const tiles: StoryboardTile[] = [];
    const levels = spec.split('#');
    if (levels.length < 2) return tiles;

    // Use the highest quality level (last one)
    const bestLevel = levels[levels.length - 1];
    const parts = bestLevel.split('|');
    if (parts.length < 8) return tiles;

    // First level has the full base URL, subsequent levels may have partial
    const baseUrlRoot = levels[0].split('|')[0];
    const levelUrl = parts[0] || baseUrlRoot;
    const width = parseInt(parts[1], 10);
    const height = parseInt(parts[2], 10);
    const count = parseInt(parts[3], 10);
    const cols = parseInt(parts[4], 10);
    const rows = parseInt(parts[5], 10);
    const intervalMs = parseInt(parts[6], 10);
    const sigh = parts[7];

    if (!width || !height || !count || !cols || !rows || !intervalMs) return tiles;

    const tilesPerSheet = cols * rows;

    for (let i = 0; i < count; i++) {
        const sheetIndex = Math.floor(i / tilesPerSheet);
        const posInSheet = i % tilesPerSheet;
        const col = posInSheet % cols;
        const row = Math.floor(posInSheet / cols);

        // Replace $M with sheet index and append sigh
        let url = levelUrl.replace('$M', String(sheetIndex));
        if (sigh && !url.includes('sigh=')) {
            url += (url.includes('?') ? '&' : '?') + `sigh=${sigh}`;
        }

        tiles.push({
            url,
            tileRect: { x: col * width, y: row * height, w: width, h: height },
            timestampMs: i * intervalMs,
        });
    }

    return tiles;
}

/**
 * Find the nearest storyboard tile for a given timestamp.
 */
function findNearestTile(tiles: StoryboardTile[], seconds: number): StoryboardTile | null {
    if (tiles.length === 0) return null;
    const targetMs = seconds * 1000;
    let best = tiles[0];
    let bestDist = Math.abs(best.timestampMs - targetMs);
    for (const tile of tiles) {
        const dist = Math.abs(tile.timestampMs - targetMs);
        if (dist < bestDist) {
            best = tile;
            bestDist = dist;
        }
    }
    return best;
}

/**
 * Find the chapter title for a given timestamp.
 */
function getChapterAt(chapters: VideoChapter[], seconds: number): string | undefined {
    let current: string | undefined;
    for (const ch of chapters) {
        if (ch.startSeconds <= seconds) {
            current = ch.title;
        } else {
            break;
        }
    }
    return current;
}

/**
 * Get nearby transcript text for context around a timestamp.
 */
function getTranscriptContext(segments: TranscriptSegment[], seconds: number): string | undefined {
    const nearby = segments.filter(
        (s) => s.startSeconds >= seconds - 5 && s.startSeconds <= seconds + 5,
    );
    if (nearby.length === 0) return undefined;
    return nearby.map((s) => s.text).join(' ').slice(0, 200);
}

/**
 * Determine which timestamps to capture frames at using smart selection.
 *
 * Priority:
 *  1. Visual cues in transcript text
 *  2. Chapter starts (offset by 5s)
 *  3. Topic transitions (>3s gaps in transcript)
 *  4. Interval-based fallback
 *
 * De-duplicates within 10s, keeping higher priority entries.
 */
export function pickTimestamps(
    durationSeconds: number,
    chapters: VideoChapter[],
    maxFrames: number,
    intervalSeconds: number,
    transcript: TranscriptSegment[],
): TimestampCandidate[] {
    const candidates: TimestampCandidate[] = [];

    // Priority 1: Visual cues in transcript
    for (const seg of transcript) {
        for (const pattern of VISUAL_CUE_PATTERNS) {
            if (pattern.test(seg.text)) {
                candidates.push({
                    seconds: seg.startSeconds,
                    label: seg.text.slice(0, 80),
                    relevance: 'visual_cue',
                    priority: 1,
                    transcriptContext: seg.text,
                    chapterTitle: getChapterAt(chapters, seg.startSeconds),
                });
                break; // one match per segment is enough
            }
        }
    }

    // Priority 2: Chapter starts (offset by 5s)
    for (const ch of chapters) {
        const t = Math.min(ch.startSeconds + 5, durationSeconds - 1);
        candidates.push({
            seconds: t,
            label: ch.title,
            relevance: 'chapter_start',
            priority: 2,
            transcriptContext: getTranscriptContext(transcript, t),
            chapterTitle: ch.title,
        });
    }

    // Priority 3: Topic transitions (>3s gaps in transcript)
    for (let i = 1; i < transcript.length; i++) {
        const prev = transcript[i - 1];
        const curr = transcript[i];
        const gap = curr.startSeconds - (prev.startSeconds + prev.durationSeconds);
        if (gap > 3) {
            candidates.push({
                seconds: curr.startSeconds,
                label: `Topic transition at ${formatTimestamp(curr.startSeconds)}`,
                relevance: 'topic_transition',
                priority: 3,
                transcriptContext: curr.text,
                chapterTitle: getChapterAt(chapters, curr.startSeconds),
            });
        }
    }

    // Priority 4: Interval fallback
    const interval = Math.max(intervalSeconds, 10);
    for (let t = interval; t < durationSeconds - 5; t += interval) {
        candidates.push({
            seconds: t,
            label: `Frame at ${formatTimestamp(t)}`,
            relevance: 'interval',
            priority: 4,
            transcriptContext: getTranscriptContext(transcript, t),
            chapterTitle: getChapterAt(chapters, t),
        });
    }

    // De-duplicate within 10s, keeping higher priority (lower number)
    candidates.sort((a, b) => a.priority - b.priority || a.seconds - b.seconds);
    const deduped: TimestampCandidate[] = [];
    for (const c of candidates) {
        const tooClose = deduped.some((d) => Math.abs(d.seconds - c.seconds) < 10);
        if (!tooClose) {
            deduped.push(c);
        }
    }

    // Sort by time order
    deduped.sort((a, b) => a.seconds - b.seconds);

    // Limit to maxFrames via even sampling
    if (deduped.length > maxFrames) {
        const step = deduped.length / maxFrames;
        const sampled: TimestampCandidate[] = [];
        for (let i = 0; i < maxFrames; i++) {
            sampled.push(deduped[Math.floor(i * step)]);
        }
        return sampled;
    }

    return deduped;
}

/**
 * Capture still frames using a fallback chain:
 *  1. ffmpeg (yt-dlp + ffmpeg, requires Docker)
 *  2. Storyboard thumbnail tiles (parsed from spec)
 *  3. hqdefault.jpg fallback
 */
export async function captureFrames(
    videoId: string,
    timestamps: TimestampCandidate[],
    storyboardSpec: string | null,
): Promise<StillFrame[]> {
    const frames: StillFrame[] = [];
    const storyboardTiles = storyboardSpec ? parseStoryboardSpec(storyboardSpec) : [];

    log.info(`Capturing ${timestamps.length} still frames for video ${videoId} (storyboard tiles: ${storyboardTiles.length})`);

    for (const ts of timestamps) {
        const key = `frame-${videoId}-${Math.floor(ts.seconds)}`;
        const base: Omit<StillFrame, 'imageUrl'> = {
            timestampSeconds: ts.seconds,
            timestampFormatted: formatTimestamp(ts.seconds),
            label: ts.label,
            transcriptContext: ts.transcriptContext,
            chapterTitle: ts.chapterTitle,
            relevance: ts.relevance,
        };

        // Fallback 1: ffmpeg
        try {
            const captured = await captureWithFfmpeg(videoId, ts.seconds, key);
            if (captured) {
                frames.push({ ...base, imageUrl: captured });
                continue;
            }
        } catch {
            // ffmpeg not available, fall through
        }

        // Fallback 2: storyboard tile
        const tile = findNearestTile(storyboardTiles, ts.seconds);
        if (tile) {
            frames.push({ ...base, imageUrl: tile.url, tileRect: tile.tileRect });
            continue;
        }

        // Fallback 3: hqdefault.jpg
        frames.push({ ...base, imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` });
    }

    return frames;
}

/**
 * Attempt to capture a single frame using yt-dlp + ffmpeg.
 * Returns a Key-Value Store URL if successful, null otherwise.
 */
async function captureWithFfmpeg(
    videoId: string,
    timestampSeconds: number,
    key: string,
): Promise<string | null> {
    try {
        const { execSync } = await import('child_process');
        const { readFileSync, unlinkSync, existsSync } = await import('fs');

        const tmpFile = `/tmp/${key}.jpg`;
        const timestamp = formatTimestamp(timestampSeconds);
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        const streamUrl = execSync(
            `yt-dlp -f "best[height<=720]" --get-url "${videoUrl}" 2>/dev/null`,
            { encoding: 'utf-8', timeout: 30000 },
        ).trim();

        if (!streamUrl) return null;

        execSync(
            `ffmpeg -ss ${timestamp} -i "${streamUrl}" -frames:v 1 -q:v 2 "${tmpFile}" -y 2>/dev/null`,
            { timeout: 30000 },
        );

        if (!existsSync(tmpFile)) return null;

        const buffer = readFileSync(tmpFile);
        const kvStore = await Actor.openKeyValueStore();
        await kvStore.setValue(key, buffer, { contentType: 'image/jpeg' });

        unlinkSync(tmpFile);

        const storeId = process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
        if (!storeId) return null;
        return `https://api.apify.com/v2/key-value-stores/${storeId}/records/${key}`;
    } catch {
        return null;
    }
}
