#!/bin/bash
set -e

# Install torrent-server dependencies if not present
if [ -d "/app/torrent-server" ] && [ ! -d "/app/torrent-server/node_modules" ]; then
    echo "Installing torrent-server dependencies..."
    cd /app/torrent-server && npm install --production
fi

# Install yt-dlp if not present
if ! command -v yt-dlp &> /dev/null; then
    echo "Installing yt-dlp..."
    pip install yt-dlp
fi

# Start supervisor (manages backend + torrent-server + nginx)
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf -n
