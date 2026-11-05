FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fL https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && echo "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795  /usr/local/bin/yt-dlp" | sha256sum -c - \
    && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && chmod +x node_modules/@ffmpeg-installer/linux-x64/ffmpeg
COPY *.mjs ./

ENV NODE_ENV=production
ENV YT_DLP_PATH=/usr/local/bin/yt-dlp
USER node
CMD ["node", "bot.mjs"]
