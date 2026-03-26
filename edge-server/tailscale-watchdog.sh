#!/bin/bash
# Tailscale Watchdog - monitors connection and auto-reconnects
# Install: sudo cp tailscale-watchdog.sh /usr/local/bin/ && sudo chmod +x /usr/local/bin/tailscale-watchdog.sh
# Add to crontab: */2 * * * * /usr/local/bin/tailscale-watchdog.sh >> /var/log/tailscale-watchdog.log 2>&1

LOG_PREFIX="[Tailscale Watchdog]"

# Check if Tailscale is running
if ! pgrep -x "tailscaled" > /dev/null; then
    echo "$(date) $LOG_PREFIX tailscaled not running, starting..."
    systemctl start tailscaled
    sleep 3
fi

# Check connection status
STATUS=$(tailscale status --json 2>/dev/null | jq -r '.Self.Online // false')

if [ "$STATUS" != "true" ]; then
    echo "$(date) $LOG_PREFIX Tailscale offline, reconnecting..."
    tailscale up --accept-routes --reset
    sleep 5
    
    # Verify reconnection
    NEW_STATUS=$(tailscale status --json 2>/dev/null | jq -r '.Self.Online // false')
    if [ "$NEW_STATUS" == "true" ]; then
        echo "$(date) $LOG_PREFIX Reconnected successfully"
    else
        echo "$(date) $LOG_PREFIX Failed to reconnect, will retry next cycle"
    fi
else
    # Silent when connected (uncomment for verbose logging)
    # echo "$(date) $LOG_PREFIX Connected"
    :
fi
