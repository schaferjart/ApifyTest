import { Actor } from 'apify';
import { log } from 'crawlee';
import type { ActorInput, ActorOutput } from './types.js';
import { extractVideoId, fetchTranscript } from './transcript.js';
import { fetchMetadata } from './metadata.js';
import { extractLinks } from './metadata.js';
import { pickTimestamps, captureFrames } from './frames.js';

await Actor.init();

try {
    // ----- Input -----
    const input = (await Actor.getInput<ActorInput>()) ?? ({} as ActorInput);

    const rawUrl = (input.videoUrl ?? '').trim();
    if (!rawUrl) {
        throw new Error('Missing required input field "videoUrl". Provide a YouTube URL or video ID.');
    }

    const language = input.language ?? 'en';
    const shouldCaptureFrames = input.captureFrames ?? true;
    const maxFrames = Math.max(1, Math.min(50, input.maxFrames ?? 10));
    const frameInterval = Math.max(10, Math.min(600, input.frameIntervalSeconds ?? 60));

    const videoId = extractVideoId(rawUrl);
    log.info(`Processing video: ${videoId}`);

    // ----- Fetch metadata + transcript in parallel (resilient) -----
    const results = await Promise.allSettled([
        fetchMetadata(videoId),
        fetchTranscript(videoId, language),
    ]);

    const metadata = results[0].status === 'fulfilled'
        ? results[0].value
        : {
            title: 'Unknown',
            channelName: 'Unknown',
            channelUrl: '',
            publishedDate: '',
            duration: '0:00',
            durationSeconds: 0,
            viewCount: 0,
            description: '',
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
            chapters: [],
            links: [],
        };

    if (results[0].status === 'rejected') {
        log.warning(`Metadata fetch failed, using defaults: ${results[0].reason}`);
    }

    const transcript = results[1].status === 'fulfilled' ? results[1].value : [];

    if (results[1].status === 'rejected') {
        log.warning(`Transcript fetch failed, using empty transcript: ${results[1].reason}`);
    }

    // ----- Full transcript as a single text block -----
    const fullTranscriptText = transcript.map((seg) => seg.text).join(' ');

    // ----- Extract links from transcript too -----
    const transcriptLinks = extractLinks(fullTranscriptText);
    const allLinks = [...metadata.links, ...transcriptLinks];

    // De-duplicate links by URL
    const seenUrls = new Set<string>();
    const uniqueLinks = allLinks.filter((l) => {
        if (seenUrls.has(l.url)) return false;
        seenUrls.add(l.url);
        return true;
    });

    // ----- Capture still frames -----
    let frames: ActorOutput['frames'] = [];

    if (shouldCaptureFrames && metadata.durationSeconds > 0) {
        const timestamps = pickTimestamps(
            metadata.durationSeconds,
            metadata.chapters,
            maxFrames,
            frameInterval,
        );

        if (timestamps.length > 0) {
            frames = await captureFrames(videoId, timestamps);
        }
    }

    // ----- Build output -----
    const output: ActorOutput = {
        videoId,
        title: metadata.title,
        channelName: metadata.channelName,
        channelUrl: metadata.channelUrl,
        publishedDate: metadata.publishedDate,
        duration: metadata.duration,
        durationSeconds: metadata.durationSeconds,
        viewCount: metadata.viewCount,
        description: metadata.description,
        thumbnailUrl: metadata.thumbnailUrl,
        chapters: metadata.chapters,
        transcript,
        fullTranscriptText,
        links: uniqueLinks,
        frames,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };

    // ----- Push to dataset -----
    await Actor.pushData(output);

    log.info('Done! Output pushed to default dataset.');
    log.info(`  Title: ${output.title}`);
    log.info(`  Transcript segments: ${transcript.length}`);
    log.info(`  Chapters: ${metadata.chapters.length}`);
    log.info(`  Links found: ${uniqueLinks.length}`);
    log.info(`  Frames captured: ${frames.length}`);
} catch (err) {
    log.error(`Actor failed: ${(err as Error).message}`);
    throw err;
} finally {
    await Actor.exit();
}
