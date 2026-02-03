#!/bin/bash

# Hyperspace Server Stop Script

echo "🛑 Stopping Hyperspace Server..."

# Kill by saved PIDs
if [ -f /tmp/hyperspace-pids.txt ]; then
    read MOSQUITTO_PID BACKEND_PID FRONTEND_PID < /tmp/hyperspace-pids.txt
    kill -9 $MOSQUITTO_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null
    rm /tmp/hyperspace-pids.txt
fi

# Also kill by port (in case PIDs are stale)
lsof -ti :1883 | xargs kill -9 2>/dev/null
lsof -ti :3001 | xargs kill -9 2>/dev/null
lsof -ti :5173 | xargs kill -9 2>/dev/null

echo "✅ All services stopped"
