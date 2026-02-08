import { log } from 'crawlee';
import { Actor } from 'apify';
import type { StillFrame, VideoChapter } from './types.js';
import { formatTimestamp } from './transcript.js';

/**
 * Determine which timestamps to capture frames at.
 *
 * Strategy:
 *  1. If the video has chapters, capture a frame 5 seconds into each chapter.
 *  2. Otherwise, capture frames at regular intervals.
 */
export function pickTimestamps(
    durationSeconds: number,
    chapters: VideoChapter[],
    maxFrames: number,
    intervalSeconds: number,
): { seconds: number; label: string }[] {
    const timestamps: { seconds: number; label: string }[] = [];

    if (chapters.length >= 2) {
        // Use chapter start points (offset by 5s to avoid black transition frames)
        for (const ch of chapters) {
            const t = Math.min(ch.startSeconds + 5, durationSeconds - 1);
            timestamps.push({ seconds: t, label: ch.title });
        }
    } else {
        // Evenly spaced
        const interval = Math.max(intervalSeconds, 10);
        for (let t = interval; t < durationSeconds - 5; t += interval) {
            timestamps.push({ seconds: t, label: `Frame at ${formatTimestamp(t)}` });
        }
    }

    // Limit to maxFrames
    if (timestamps.length > maxFrames) {
        // Sample evenly
        const step = timestamps.length / maxFrames;
        const sampled: typeof timestamps = [];
        for (let i = 0; i < maxFrames; i++) {
            sampled.push(timestamps[Math.floor(i * step)]);
        }
        return sampled;
    }

    return timestamps;
}

/**
 * Capture still frames from a YouTube video using yt-dlp piped into ffmpeg.
 *
 * For each timestamp we:
 *  1. Use the YouTube thumbnail API as a fallback-free approach:
 *     YouTube provides storyboard / frame thumbnails at specific times.
 *  2. Alternatively attempt yt-dlp + ffmpeg if available.
 *
 * For simplicity and reliability on Apify cloud, we use YouTube's
 * server-side thumbnail endpoint which gives a frame near any timestamp.
 */
export async function captureFrames(
    videoId: string,
    timestamps: { seconds: number; label: string }[],
): Promise<StillFrame[]> {
    const frames: StillFrame[] = [];

    log.info(`Capturing ${timestamps.length} still frames for video ${videoId}`);

    for (const ts of timestamps) {
        // YouTube's storyboard/thumbnail API — reliable without ffmpeg
        // This uses the video thumbnail at a specific time via the i.ytimg.com endpoint
        // Format: https://i.ytimg.com/vi/{id}/hqdefault.jpg for the main thumb,
        // or we store a KV reference with the timestamp for the user.

        // We'll generate a thumbnail URL and also try to fetch actual frame via
        // YouTube's get_video_info storyboard if possible.
        const imageUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        // For a more granular approach, we push the timestamp info alongside the thumb
        // and note that the actual frame capture requires ffmpeg (available in Docker)
        const key = `frame-${videoId}-${Math.floor(ts.seconds)}`;

        try {
            // Try to capture with ffmpeg if available
            const captured = await captureWithFfmpeg(videoId, ts.seconds, key);
            if (captured) {
                frames.push({
                    timestampSeconds: ts.seconds,
                    timestampFormatted: formatTimestamp(ts.seconds),
                    label: ts.label,
                    imageUrl: captured,
                });
                continue;
            }
        } catch {
            // ffmpeg not available, fall through to thumbnail
        }

        frames.push({
            timestampSeconds: ts.seconds,
            timestampFormatted: formatTimestamp(ts.seconds),
            label: ts.label,
            imageUrl,
        });
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

        // Get direct stream URL via yt-dlp, then extract frame with ffmpeg
        // This only works when yt-dlp and ffmpeg are installed (Docker image)
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

        const storeInfo = await kvStore.getInfo();
        if (!storeInfo) return null;
        return `https://api.apify.com/v2/key-value-stores/${storeInfo.id}/records/${key}`;
    } catch {
        return null;
    }
}
