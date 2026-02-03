#!/bin/bash

# Hyperspace Server Startup Script
# This starts: Mosquitto MQTT, Backend, and Frontend

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOSQUITTO_CONFIG="/tmp/mosquitto.conf"

echo "🚀 Starting Hyperspace Server..."
echo "================================"

# Create Mosquitto config for remote connections
cat > "$MOSQUITTO_CONFIG" << EOF
listener 1883 0.0.0.0
allow_anonymous true
EOF

# Kill any existing processes on required ports
echo "🧹 Cleaning up old processes..."
lsof -ti :1883 | xargs kill -9 2>/dev/null
lsof -ti :3001 | xargs kill -9 2>/dev/null
lsof -ti :5173 | xargs kill -9 2>/dev/null
sleep 1

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

# Start Backend
echo "🔧 Starting Backend on port 3001..."
cd "$PROJECT_DIR/backend"
MOCK_LIDAR=false MQTT_ENABLED=true MQTT_BROKER_URL=mqtt://127.0.0.1:1883 npm run dev > /tmp/hyperspace-backend.log 2>&1 &
BACKEND_PID=$!
sleep 3

if ps -p $BACKEND_PID > /dev/null; then
    echo "   ✅ Backend running (PID: $BACKEND_PID)"
else
    echo "   ❌ Backend failed to start"
    cat /tmp/hyperspace-backend.log
    exit 1
fi

# Start Frontend
echo "🎨 Starting Frontend on port 5173..."
cd "$PROJECT_DIR/frontend"
npm run dev > /tmp/hyperspace-frontend.log 2>&1 &
FRONTEND_PID=$!
sleep 3

if ps -p $FRONTEND_PID > /dev/null; then
    echo "   ✅ Frontend running (PID: $FRONTEND_PID)"
else
    echo "   ❌ Frontend failed to start"
    cat /tmp/hyperspace-frontend.log
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
