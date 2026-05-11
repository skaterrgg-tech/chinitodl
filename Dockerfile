FROM node:20-slim

# Install ffmpeg + yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg python3 curl --no-install-recommends \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY src/ ./src/

ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
