/** Input schema for the actor */
export interface ActorInput {
    /** YouTube video URL or video ID */
    videoUrl: string;
    /** Language code for transcript (default: 'en') */
    language?: string;
    /** Whether to capture still frames at key moments */
    captureFrames?: boolean;
    /** Maximum number of frames to capture (default: 10) */
    maxFrames?: number;
    /** Frame capture interval in seconds — only used if no chapters exist (default: 60) */
    frameIntervalSeconds?: number;
}

/** A single transcript segment */
export interface TranscriptSegment {
    text: string;
    startSeconds: number;
    durationSeconds: number;
    startFormatted: string;
}

/** A chapter/section in the video */
export interface VideoChapter {
    title: string;
    startSeconds: number;
    startFormatted: string;
}

/** A link found in the description or transcript */
export interface ExtractedLink {
    url: string;
    context: string;
}

/** A captured still frame */
export interface StillFrame {
    timestampSeconds: number;
    timestampFormatted: string;
    label: string;
    imageUrl: string;
    isFallback?: boolean;
    transcriptContext?: string;
    chapterTitle?: string;
    relevance?: string;
    tileRect?: { x: number; y: number; w: number; h: number };
}

/** Full output of the actor */
export interface ActorOutput {
    videoId: string;
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
    transcript: TranscriptSegment[];
    fullTranscriptText: string;
    links: ExtractedLink[];
    frames: StillFrame[];
    videoUrl: string;
}
