FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    build-essential \
    gcc \
    g++ \
    make \
    libsqlite3-dev \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

RUN mkdir -p /app/data \
    /app/uploads/avatars \
    /app/uploads/badges \
    /app/uploads/attachments \
    /app/uploads/voice \
    /app/uploads/video_notes \
    /app/uploads/ringtones \
    /app/uploads/wallpapers

EXPOSE 4000

CMD ["node", "dist/index.js"]
