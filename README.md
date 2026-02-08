# YouTube Scraper — Apify Actor

An Apify actor that turns YouTube videos into structured, readable content. Give it a video URL and it extracts:

- **Full transcript** with timestamps
- **Video metadata** (title, channel, duration, views, description)
- **Chapters** parsed from the description
- **All links** found in the description and transcript
- **Still frames** captured at chapter boundaries or regular intervals

Built to plug directly into **n8n** workflows so you can pipe the structured output into further processing (AI summarization, note generation, etc.).

## Why?

Watching a 45-minute tutorial to find the 3 minutes that matter is painful. This actor gives you the transcript, the timestamps, the links, and snapshots — a static, searchable version of any YouTube video.

## Input

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `videoUrl` | string | *(required)* | YouTube URL or video ID |
| `language` | string | `"en"` | Transcript language code |
| `captureFrames` | boolean | `true` | Capture still frames |
| `maxFrames` | integer | `10` | Max frames to capture |
| `frameIntervalSeconds` | integer | `60` | Interval between frames (when no chapters) |

## Output

The actor pushes a single dataset item with:

```jsonc
{
  "videoId": "dQw4w9WgXcQ",
  "title": "Video Title",
  "channelName": "Channel",
  "channelUrl": "https://...",
  "duration": "10:35",
  "durationSeconds": 635,
  "viewCount": 123456,
  "description": "...",
  "thumbnailUrl": "https://i.ytimg.com/vi/.../maxresdefault.jpg",
  "chapters": [
    { "title": "Introduction", "startSeconds": 0, "startFormatted": "0:00" }
  ],
  "transcript": [
    { "text": "Hello everyone", "startSeconds": 0.5, "durationSeconds": 2.1, "startFormatted": "0:00" }
  ],
  "fullTranscriptText": "Hello everyone ...",
  "links": [
    { "url": "https://example.com", "context": "Check out https://example.com for more" }
  ],
  "frames": [
    { "timestampSeconds": 5, "timestampFormatted": "0:05", "label": "Introduction", "imageUrl": "https://..." }
  ],
  "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

## n8n Integration

### Setup

1. Deploy this actor to Apify (or run it locally with `apify run`)
2. In n8n, add an **Apify** node (or use the HTTP Request node against the Apify API)
3. Wire it up:

```
[Webhook / Manual Trigger]
        │
        ▼
[Apify Node — run "youtube-scraper"]
   Input: { "videoUrl": "{{$json.youtubeUrl}}" }
        │
        ▼
[Process the output]
   - Feed fullTranscriptText to an AI node for summarization
   - Extract links for further scraping
   - Use chapters to create a table of contents
   - Reference frames for visual documentation
```

### Example n8n HTTP Request (no Apify node needed)

```
POST https://api.apify.com/v2/acts/<your-actor-id>/runs?token=<your-token>
Content-Type: application/json

{
  "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
  "language": "en",
  "captureFrames": true
}
```

Then poll or use a webhook to get the dataset results.

## Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Or build and run
npm run build
npm start
```

Set the input in `apify_storage/key_value_stores/default/INPUT.json`:

```json
{
    "videoUrl": "https://www.youtube.com/watch?v=VIDEO_ID",
    "language": "en"
}
```

## Architecture

```
src/
  main.ts        — Actor entrypoint, orchestrates everything
  types.ts       — TypeScript interfaces for input/output
  transcript.ts  — YouTube transcript/caption extraction
  metadata.ts    — Video metadata, chapter, and link extraction
  frames.ts      — Still frame capture (ffmpeg when available, thumbnails as fallback)
```

## Frame Capture

The actor supports two modes for still frame capture:

1. **ffmpeg + yt-dlp** (Docker / Apify cloud) — downloads a single frame at each timestamp. High quality, exact timestamps. The Dockerfile installs ffmpeg.
2. **Thumbnail fallback** — when ffmpeg isn't available, uses YouTube's thumbnail API. Less precise but works everywhere.

## License

MIT
