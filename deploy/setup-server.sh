#!/bin/bash
# ==============================================
# Hyperspace Production Server Setup Script
# Run this on a fresh DigitalOcean Droplet (Docker on Ubuntu 22.04 from Marketplace)
# Usage: curl -sSL <url> | bash  OR  bash setup-server.sh
# ==============================================

set -euo pipefail

echo "╔══════════════════════════════════════════════════════╗"
echo "║  🚀 Hyperspace Production Server Setup (DigitalOcean) ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ---- 1. System update ----
echo "📦 [1/7] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ---- 2. Install Docker ----
# (DigitalOcean "Docker on Ubuntu 22.04" marketplace image has Docker pre-installed)
echo "🐳 [2/7] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "   ✅ Docker installed: $(docker --version)"
else
    echo "   ✅ Docker already installed: $(docker --version)"
fi

# Install Docker Compose plugin (V2)
if ! docker compose version &> /dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi
echo "   ✅ Docker Compose: $(docker compose version)"

# ---- 3. Install Tailscale ----
echo "🔗 [3/7] Installing Tailscale..."
if ! command -v tailscale &> /dev/null; then
    curl -fsSL https://tailscale.com/install.sh | sh
    echo "   ✅ Tailscale installed"
else
    echo "   ✅ Tailscale already installed"
fi

# Start Tailscale (interactive - will show auth URL)
echo ""
echo "   ⚠️  Authenticate Tailscale now:"
echo "   Run: sudo tailscale up --ssh"
echo "   This will print a URL — open it in your browser to authenticate."
echo ""
read -p "   Press ENTER after you've authenticated Tailscale..." _

TAILSCALE_IP=$(tailscale ip -4 2>/dev/null || echo "NOT_CONNECTED")
echo "   ✅ Tailscale IP: $TAILSCALE_IP"

# ---- 4. Create persistent data directories ----
echo "📁 [4/7] Creating persistent data directories..."
mkdir -p /data/hyperspace/db
mkdir -p /data/hyperspace/uploads
mkdir -p /data/hyperspace/models
mkdir -p /var/log/caddy
chmod -R 755 /data/hyperspace
echo "   ✅ /data/hyperspace/{db,uploads,models} created"

# ---- 5. Firewall setup ----
echo "🔒 [5/7] Configuring firewall (UFW)..."
apt-get install -y -qq ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP (Caddy)
ufw allow 443/tcp     # HTTPS (Caddy)
ufw allow 443/udp     # HTTP/3 (QUIC)
# MQTT: only allow from Tailscale interface (100.x.x.x)
ufw allow in on tailscale0 to any port 1883 proto tcp
ufw --force enable
echo "   ✅ Firewall configured (SSH, HTTP/S, MQTT via Tailscale only)"

# ---- 6. System tuning for low latency ----
echo "⚡ [6/7] Applying low-latency network tuning..."
cat >> /etc/sysctl.conf << 'EOF'

# Hyperspace - Low latency tuning
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_nodelay = 1
net.core.netdev_max_backlog = 5000
net.ipv4.tcp_fastopen = 3
EOF
sysctl -p > /dev/null 2>&1
echo "   ✅ TCP tuning applied (tcp_nodelay, tcp_fastopen, buffer sizes)"

# ---- 7. Create deploy helper script ----
echo "📝 [7/7] Creating helper scripts..."

cat > /usr/local/bin/hyperspace-deploy << 'DEPLOY_EOF'
#!/bin/bash
# Quick deploy/redeploy Hyperspace
set -euo pipefail
cd /opt/hyperspace
git pull origin main 2>/dev/null || true
docker compose -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.prod.yml --env-file .env up -d
echo "✅ Hyperspace deployed. Check: docker compose -f docker-compose.prod.yml logs -f"
DEPLOY_EOF
chmod +x /usr/local/bin/hyperspace-deploy

cat > /usr/local/bin/hyperspace-logs << 'LOGS_EOF'
#!/bin/bash
# View Hyperspace logs
cd /opt/hyperspace
docker compose -f docker-compose.prod.yml logs -f --tail=100 "$@"
LOGS_EOF
chmod +x /usr/local/bin/hyperspace-logs

cat > /usr/local/bin/hyperspace-backup << 'BACKUP_EOF'
#!/bin/bash
# Backup SQLite database
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/data/hyperspace/backups"
mkdir -p "$BACKUP_DIR"
# Use sqlite3 .backup for safe hot-backup
cp /data/hyperspace/db/hyperspace.db "$BACKUP_DIR/hyperspace_${TIMESTAMP}.db"
# Keep only last 7 backups
ls -t "$BACKUP_DIR"/hyperspace_*.db | tail -n +8 | xargs rm -f 2>/dev/null
echo "✅ Backup: $BACKUP_DIR/hyperspace_${TIMESTAMP}.db"
BACKUP_EOF
chmod +x /usr/local/bin/hyperspace-backup

# Setup daily backup cron
(crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/hyperspace-backup") | sort -u | crontab -
echo "   ✅ Helper scripts created: hyperspace-deploy, hyperspace-logs, hyperspace-backup"
echo "   ✅ Daily backup cron set (3:00 AM)"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ Server Setup Complete!                            ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "║  Tailscale IP: $TAILSCALE_IP                         "
echo "║                                                      ║"
echo "║  Next steps:                                         ║"
echo "║  1. Clone repo to /opt/hyperspace                    ║"
echo "║  2. Copy .env.production → .env and fill secrets     ║"
echo "║  3. Run: hyperspace-deploy                           ║"
echo "║                                                      ║"
echo "║  Edge devices MQTT: mqtt://$TAILSCALE_IP:1883        "
echo "║                                                      ║"
echo "╚══════════════════════════════════════════════════════╝"
