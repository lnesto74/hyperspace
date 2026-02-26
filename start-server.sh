#!/bin/bash

# Hyperspace Server Startup Script
# This starts: Mosquitto MQTT, Backend, and Frontend

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load NVM and use Node 18 (required for Vite/Rollup compatibility)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 18 2>/dev/null || echo "⚠️  NVM not found or Node 18 not installed. Using system Node."
MOSQUITTO_CONFIG="/tmp/mosquitto.conf"

echo "🚀 Starting Hyperspace Server..."
echo "================================"

# Create Mosquitto config for remote connections
cat > "$MOSQUITTO_CONFIG" << EOF
listener 1883 0.0.0.0
allow_anonymous true
EOF

# Kill any existing processes on required ports (thorough cleanup)
echo "🧹 Cleaning up old processes..."
for port in 1883 3001 5173; do
    pids=$(lsof -ti :$port 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "   Killing processes on port $port: $pids"
        echo "$pids" | xargs kill -9 2>/dev/null
    fi
done
# Also kill any orphaned node processes from previous runs
pkill -f "node.*hyperspace.*backend" 2>/dev/null
pkill -f "node.*hyperspace.*frontend" 2>/dev/null
pkill -f "node.*server\.js" 2>/dev/null
sleep 2
# Double-check ports are free
for port in 1883 3001 5173; do
    if lsof -ti :$port > /dev/null 2>&1; then
        echo "   ⚠️  Port $port still in use, force killing..."
        lsof -ti :$port | xargs kill -9 2>/dev/null
        sleep 1
    fi
done

# Start Mosquitto MQTT broker in background
echo "📡 Starting Mosquitto MQTT broker on port 1883..."
mosquitto -c "$MOSQUITTO_CONFIG" > /tmp/mosquitto.log 2>&1 &
MOSQUITTO_PID=$!
sleep 1

if ps -p $MOSQUITTO_PID > /dev/null; then
    echo "   ✅ Mosquitto running (PID: $MOSQUITTO_PID)"
else
    echo "   ❌ Mosquitto failed to start"
    exit 1
fi

# Start Backend with increased heap size to prevent OOM crashes
echo "🔧 Starting Backend on port 3001..."
cd "$PROJECT_DIR/backend"
NODE_OPTIONS="--max-old-space-size=4096" MOCK_LIDAR=false MQTT_ENABLED=true MQTT_BROKER_URL=mqtt://127.0.0.1:1883 npm run dev > /tmp/hyperspace-backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend to actually be ready (health check loop)
echo "   ⏳ Waiting for backend to be ready..."
BACKEND_READY=false
for i in $(seq 1 30); do
    if curl -s http://localhost:3001/api/venues > /dev/null 2>&1; then
        BACKEND_READY=true
        break
    fi
    # Check process is still alive
    if ! ps -p $BACKEND_PID > /dev/null 2>&1; then
        echo "   ❌ Backend process died"
        cat /tmp/hyperspace-backend.log
        exit 1
    fi
    sleep 1
    printf "   ⏳ Attempt %d/30...\r" "$i"
done
echo ""

if $BACKEND_READY; then
    echo "   ✅ Backend running and responding (PID: $BACKEND_PID)"
else
    echo "   ❌ Backend started but not responding after 30s"
    echo "   Last 20 lines of backend log:"
    tail -20 /tmp/hyperspace-backend.log
    exit 1
fi

# Start Frontend
echo "🎨 Starting Frontend on port 5173..."
cd "$PROJECT_DIR/frontend"
npm run dev > /tmp/hyperspace-frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait for frontend to be ready
echo "   ⏳ Waiting for frontend to be ready..."
FRONTEND_READY=false
for i in $(seq 1 20); do
    if curl -s http://localhost:5173 > /dev/null 2>&1; then
        FRONTEND_READY=true
        break
    fi
    if ! ps -p $FRONTEND_PID > /dev/null 2>&1; then
        echo "   ❌ Frontend process died"
        cat /tmp/hyperspace-frontend.log
        exit 1
    fi
    sleep 1
    printf "   ⏳ Attempt %d/20...\r" "$i"
done
echo ""

if $FRONTEND_READY; then
    echo "   ✅ Frontend running and responding (PID: $FRONTEND_PID)"
else
    echo "   ❌ Frontend started but not responding after 20s"
    tail -20 /tmp/hyperspace-frontend.log
    exit 1
fi

# Get Tailscale IP
TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "N/A")

echo ""
echo "================================"
echo "🎉 Hyperspace Server Started!"
echo "================================"
echo ""
echo "📍 URLs:"
echo "   Frontend:  http://localhost:5173"
echo "   Backend:   http://localhost:3001"
echo "   MQTT:      mqtt://localhost:1883"
echo ""
echo "📡 For Edge Devices (Tailscale):"
echo "   MQTT Broker: mqtt://$TAILSCALE_IP:1883"
echo ""
echo "📝 Logs:"
echo "   Mosquitto: /tmp/mosquitto.log"
echo "   Backend:   /tmp/hyperspace-backend.log"
echo "   Frontend:  /tmp/hyperspace-frontend.log"
echo ""
echo "🛑 To stop: ./stop-server.sh"
echo ""

# Save PIDs for stop script
echo "$MOSQUITTO_PID $BACKEND_PID $FRONTEND_PID" > /tmp/hyperspace-pids.txt
