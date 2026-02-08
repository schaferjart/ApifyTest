# N8N Workflow Setup Guide

## YouTube Video to Static Page

This n8n workflow takes a YouTube video URL, scrapes it using the Apify YouTube Scraper actor, analyzes the transcript with AI, and generates a self-contained HTML page with the video's key content.

## Prerequisites

- **n8n** instance (self-hosted or cloud) — version 1.0+
- **Apify account** with the `youtube-scraper` actor deployed — [apify.com](https://apify.com)
- **OpenAI API key** for the AI transcript analysis step

## Import the Workflow

1. Open your n8n instance
2. Go to **Workflows** in the left sidebar
3. Click **Add Workflow** (or the `+` button)
4. Click the three-dot menu (top right) and select **Import from File...**
5. Select `n8n-workflow.json` from this directory
6. The workflow will appear with 6 connected nodes

## Configure Variables

The workflow uses n8n **variables** for API credentials so they are not hardcoded in the workflow JSON.

1. Go to **Settings > Variables** in your n8n instance (or **Home > Variables** depending on your version)
2. Create these two variables:

| Variable Name | Value | Description |
|---|---|---|
| `APIFY_API_TOKEN` | `apify_api_...` | Your Apify API token (found at Settings > Integrations in Apify Console) |
| `APIFY_ACTOR_ID` | `your-username/youtube-scraper` | The actor ID. Use the full name like `schaferjart/youtube-scraper` or the alphanumeric ID from the actor URL |

## Configure OpenAI Credentials

1. In n8n, go to **Settings > Credentials**
2. Click **Add Credential**
3. Search for **OpenAI API**
4. Enter your OpenAI API key
5. Save the credential
6. Open the workflow, click on the **AI Analyze Transcript** node
7. In the **Credential** dropdown, select the OpenAI credential you just created

## Test the Workflow

### Activate the workflow

1. Open the workflow
2. Toggle the **Active** switch in the top right to enable it
3. Note the webhook URL shown when you click the **Webhook** node — it will look like:
   ```
   https://your-n8n-instance.com/webhook/youtube-to-page
   ```

### Send a test request

Using curl:

```bash
curl -X POST https://your-n8n-instance.com/webhook/youtube-to-page \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

Or with optional parameters:

```bash
curl -X POST https://your-n8n-instance.com/webhook/youtube-to-page \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=VIDEO_ID",
    "language": "en",
    "captureFrames": true,
    "maxFrames": 10,
    "frameIntervalSeconds": 60
  }'
```

The response will be a complete HTML page. Save it to a file to view:

```bash
curl -X POST https://your-n8n-instance.com/webhook/youtube-to-page \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=VIDEO_ID"}' \
  -o video-notes.html

open video-notes.html
```

### Test mode (without activating)

1. Click **Test workflow** in the n8n editor
2. In a separate terminal, send the curl request to the **test** webhook URL (shown when you click the Webhook node with "Test URL" tab)
3. Watch execution progress in the n8n editor

## Workflow Nodes Overview

| # | Node | Purpose |
|---|---|---|
| 1 | **Webhook** | POST endpoint that accepts `{"url": "..."}` |
| 2 | **Run Apify Actor** | Starts the youtube-scraper actor and waits up to 5 minutes for completion |
| 3 | **Fetch Dataset Results** | Retrieves the scraped data (metadata, transcript, chapters, frames, links) |
| 4 | **AI Analyze Transcript** | OpenAI identifies the most valuable transcript sections, filtering out filler |
| 5 | **Generate HTML Page** | JavaScript code node builds a self-contained HTML page |
| 6 | **Respond to Webhook** | Returns the HTML page to the caller |

## Request Body Parameters

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | *(required)* | YouTube video URL or ID |
| `language` | string | `"en"` | Transcript language code |
| `captureFrames` | boolean | `true` | Whether to capture still frames |
| `maxFrames` | number | `10` | Maximum frames to capture |
| `frameIntervalSeconds` | number | `60` | Interval between frames (when no chapters) |

## Customization

### Use a different AI provider

To swap OpenAI for Anthropic Claude or another provider:

1. Delete the **AI Analyze Transcript** node
2. Add a new LLM node for your provider (e.g., **Anthropic**, **Ollama**, **Azure OpenAI**)
3. Copy the system and user prompts from the original node configuration
4. Connect it between **Fetch Dataset Results** and **Generate HTML Page**
5. Adjust the **Generate HTML Page** code node if the output JSON path changes (look for the `aiRaw` variable at the top of the code)

### Modify the HTML output

The HTML template is entirely contained in the **Generate HTML Page** code node. Edit the JavaScript to:

- Change the CSS styling (look for the `<style>` block)
- Add or remove sections
- Modify the page layout
- Change timestamp link format

### Save output to file instead of returning

To save the HTML to a file instead of returning it via webhook:

1. Add a **Write Binary File** node after **Generate HTML Page**
2. Or add an **S3 Upload** / **Google Drive** node to store in the cloud
3. You can keep the **Respond to Webhook** node to return a confirmation with the file URL

### Skip AI analysis

If you want to skip the AI step (faster, no OpenAI cost):

1. Connect **Fetch Dataset Results** directly to **Generate HTML Page**
2. The HTML will still render chapters, transcript, frames, and links — just without the AI-curated "Key Sections" block

## Troubleshooting

**Apify actor times out**: The workflow waits up to 300 seconds (5 minutes). For very long videos, increase the `waitForFinish` parameter in the **Run Apify Actor** node URL, and also increase the node's timeout in Options.

**No transcript returned**: Some videos have captions disabled. The actor will return an empty transcript array. The HTML page will still render metadata, thumbnail, and any available data.

**OpenAI returns invalid JSON**: The code node has fallback handling — if the AI response cannot be parsed, the page will render without the "Key Sections" block but everything else works.

**Webhook not responding**: Make sure the workflow is activated (toggle in top right). Test URLs only work when the n8n editor is open.
