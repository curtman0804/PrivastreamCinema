#!/bin/bash
# Startup script for torrent-server - installs deps if missing then starts
cd /app/torrent-server

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing torrent-server dependencies..."
    npm install --production 2>&1
    echo "Dependencies installed."
fi

# Start the server
exec node server.js
