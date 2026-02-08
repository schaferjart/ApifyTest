FROM apify/actor-node:18

# Install ffmpeg for frame extraction (Alpine uses apk, not apt-get)
RUN apk add --no-cache ffmpeg

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --include=dev

# Copy source and build
COPY . ./
RUN npm run build

# Remove dev dependencies for smaller image
RUN npm prune --omit=dev

CMD ["npm", "start"]
