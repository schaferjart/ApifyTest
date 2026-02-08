FROM apify/actor-node:18

# Install ffmpeg for frame extraction
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev --include=dev && npm run build

COPY . ./
RUN npm run build

CMD ["npm", "start"]
