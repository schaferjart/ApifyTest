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

    if (!input.videoUrl) {
        throw new Error('Missing required input field "videoUrl". Provide a YouTube URL or video ID.');
    }

    const language = input.language ?? 'en';
    const shouldCaptureFrames = input.captureFrames ?? true;
    const maxFrames = input.maxFrames ?? 10;
    const frameInterval = input.frameIntervalSeconds ?? 60;

    const videoId = extractVideoId(input.videoUrl);
    log.info(`Processing video: ${videoId}`);

    // ----- Fetch metadata + transcript in parallel -----
    const [metadata, transcript] = await Promise.all([
        fetchMetadata(videoId),
        fetchTranscript(videoId, language),
    ]);

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
