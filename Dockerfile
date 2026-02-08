FROM apify/actor-node:18

# Install ffmpeg and yt-dlp for frame extraction (Alpine uses apk, not apt-get)
RUN apk add --no-cache ffmpeg python3 py3-pip \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --include=dev

# Copy source and build
COPY . ./
RUN npm run build

# Remove dev dependencies for smaller image
RUN npm prune --omit=dev

CMD ["npm", "start"]
