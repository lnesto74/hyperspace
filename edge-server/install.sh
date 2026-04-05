#!/bin/bash
# =============================================================================
# Hyperspace Edge Server — Bootstrap Installer
# =============================================================================
# One-command setup for a fresh Ubuntu/Debian Linux machine.
# Installs: SSH, Docker, Tailscale, Mosquitto clients, jq
# Clones edge-server from GitHub, configures, builds, and validates.
#
# Usage (on a fresh Linux machine):
#   curl -fsSL https://raw.githubusercontent.com/lnesto74/hyperspace/main/edge-server/install.sh | bash
#
# Or after cloning the repo:
#   cd edge-server && chmod +x install.sh && ./install.sh
#
# Safe to re-run — every step is idempotent.
# =============================================================================
set -euo pipefail

# ── Configuration ──
GITHUB_REPO="git@github.com:lnesto74/hyperspace.git"
GITHUB_REPO_HTTPS="https://github.com/lnesto74/hyperspace.git"
EDGE_DIR="$HOME/edge-server"
DEFAULT_BRIDGE_IP="100.76.196.2"
BRANCH="main"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

step_num=0
step() {
  step_num=$((step_num + 1))
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  Step ${step_num}: $1${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${CYAN}→${NC} $1"; }

abort() { fail "$1"; exit 1; }

# =============================================================================
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     Hyperspace Edge Server — Bootstrap Installer  ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Check OS ──
step "Checking operating system"

if [[ "$(uname -s)" != "Linux" ]]; then
  abort "This script is for Linux only (detected: $(uname -s)). Run on the edge machine, not your Mac."
fi

if ! command -v apt-get &>/dev/null; then
  abort "Only Debian/Ubuntu (apt-get) is supported. Detected: $(cat /etc/os-release 2>/dev/null | head -1 || echo 'unknown')."
fi

. /etc/os-release 2>/dev/null || true
ok "OS: ${PRETTY_NAME:-Linux} ($(uname -m))"

# ── Step 2: Install OpenSSH Server ──
step "Installing OpenSSH server"

if systemctl is-active --quiet ssh 2>/dev/null || systemctl is-active --quiet sshd 2>/dev/null; then
  ok "SSH server already running"
else
  info "Installing openssh-server..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq openssh-server
  sudo systemctl enable --now ssh
  ok "SSH server installed and started"
fi

# ── Step 3: Install Docker ──
step "Installing Docker"

if command -v docker &>/dev/null; then
  ok "Docker already installed: $(docker --version)"
else
  info "Installing Docker via official script..."
  curl -fsSL https://get.docker.com | sh
  ok "Docker installed: $(docker --version)"
fi

# Ensure current user is in docker group
if ! groups | grep -q docker; then
  info "Adding $USER to docker group..."
  sudo usermod -aG docker "$USER"
  warn "Group change applied. If 'docker compose' fails later, log out and back in."
fi

# Install Compose plugin if missing
if ! docker compose version &>/dev/null 2>&1; then
  info "Installing docker-compose-plugin..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-compose-plugin
fi
ok "Docker Compose: $(docker compose version 2>/dev/null || echo 'available')"

# ── Step 4: Disable system Mosquitto ──
step "Checking for conflicting system Mosquitto"

if systemctl is-active --quiet mosquitto 2>/dev/null; then
  info "Stopping system mosquitto (conflicts with Docker Mosquitto on port 1883)..."
  sudo systemctl stop mosquitto
  sudo systemctl disable mosquitto
  ok "System mosquitto stopped and disabled"
elif systemctl is-enabled --quiet mosquitto 2>/dev/null; then
  sudo systemctl disable mosquitto
  ok "System mosquitto disabled (was not running)"
else
  ok "No conflicting system mosquitto found"
fi

# ── Step 5: Install Tailscale ──
step "Installing Tailscale"

if command -v tailscale &>/dev/null; then
  ok "Tailscale already installed"
else
  info "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
  ok "Tailscale installed"
fi

sudo systemctl enable --now tailscaled 2>/dev/null || true

# Check if already authenticated
TS_STATUS=$(tailscale status --json 2>/dev/null | jq -r '.Self.Online // false' 2>/dev/null || echo "false")
if [[ "$TS_STATUS" == "true" ]]; then
  TS_IP=$(tailscale ip -4 2>/dev/null || echo "unknown")
  ok "Tailscale connected (IP: $TS_IP)"
else
  echo ""
  echo -e "  ${YELLOW}Tailscale needs authentication.${NC}"
  echo -e "  ${BOLD}Running 'sudo tailscale up' — open the URL it prints in your browser.${NC}"
  echo ""
  sudo tailscale up
  sleep 2
  TS_IP=$(tailscale ip -4 2>/dev/null || echo "unknown")
  ok "Tailscale connected (IP: $TS_IP)"
fi

# ── Step 6: Install CLI tools ──
step "Installing CLI tools (mosquitto-clients, jq, git)"

sudo apt-get update -qq
sudo apt-get install -y -qq mosquitto-clients jq git
ok "mosquitto_sub, mosquitto_pub, jq, git installed"

# ── Step 7: Get edge-server code from GitHub ──
step "Getting edge-server code from GitHub"

CLONE_DIR="$HOME/.hyperspace-repo"

if [[ -d "$CLONE_DIR/.git" ]]; then
  info "Updating existing repo..."
  cd "$CLONE_DIR"
  git pull --ff-only origin "$BRANCH" 2>/dev/null || git fetch origin "$BRANCH" && git reset --hard "origin/$BRANCH"
  ok "Repository updated"
else
  info "Cloning Hyperspace repository (sparse: edge-server only)..."
  # Try SSH first, fall back to HTTPS
  if git ls-remote "$GITHUB_REPO" &>/dev/null 2>&1; then
    git clone --depth 1 --branch "$BRANCH" --sparse "$GITHUB_REPO" "$CLONE_DIR"
  elif git ls-remote "$GITHUB_REPO_HTTPS" &>/dev/null 2>&1; then
    git clone --depth 1 --branch "$BRANCH" --sparse "$GITHUB_REPO_HTTPS" "$CLONE_DIR"
  else
    abort "Cannot access repository. Ensure SSH keys or HTTPS credentials are configured.\n  SSH:   $GITHUB_REPO\n  HTTPS: $GITHUB_REPO_HTTPS"
  fi
  cd "$CLONE_DIR"
  git sparse-checkout set edge-server
  ok "Repository cloned (sparse: edge-server)"
fi

# Copy edge-server to deployment directory
info "Syncing to $EDGE_DIR..."
mkdir -p "$EDGE_DIR"
rsync -a --delete \
  --exclude 'frontend/node_modules' \
  --exclude 'backend/node_modules' \
  --exclude 'data' \
  "$CLONE_DIR/edge-server/" "$EDGE_DIR/"
ok "Edge server synced to $EDGE_DIR"

# ── Step 8: Configure Mosquitto ──
step "Configuring Mosquitto MQTT broker"

CONF="$EDGE_DIR/mosquitto/config/mosquitto.conf"

# Ensure log_dest is stdout (not file — avoids permission errors)
if grep -q 'log_dest file' "$CONF" 2>/dev/null; then
  sed -i 's|^log_dest file.*|log_dest stdout|' "$CONF"
  sed -i 's|^log_type all.*|log_type notice|' "$CONF"
  ok "Fixed logging to stdout"
else
  ok "Logging already set to stdout"
fi

# Ensure listener binds 0.0.0.0
if ! grep -q 'listener 1883 0.0.0.0' "$CONF" 2>/dev/null; then
  sed -i 's|^listener 1883$|listener 1883 0.0.0.0|' "$CONF"
fi

# Ask for bridge target IP
echo ""
echo -e "  ${BOLD}MQTT Bridge Target${NC}"
echo -e "  The edge bridges trajectory data to the main Hyperspace server via Tailscale."
echo -e "  Enter the Tailscale IP of the main server running Mosquitto on port 1883."
echo ""
read -rp "  Main server Tailscale IP [$DEFAULT_BRIDGE_IP]: " BRIDGE_IP
BRIDGE_IP="${BRIDGE_IP:-$DEFAULT_BRIDGE_IP}"

sed -i "s|^address .*|address ${BRIDGE_IP}:1883|" "$CONF"
ok "Bridge target set to ${BRIDGE_IP}:1883"

# Ensure data/log directories exist
mkdir -p "$EDGE_DIR/mosquitto/data" "$EDGE_DIR/mosquitto/log" "$EDGE_DIR/data"

# ── Step 9: Build and start Docker stack ──
step "Building and starting Docker containers"

cd "$EDGE_DIR"

# Remove obsolete compose version key
sed -i '/^version:/d' docker-compose.yml 2>/dev/null || true

# Ensure nothing else holds port 1883
if ss -tlnp 2>/dev/null | grep -q ':1883 '; then
  warn "Port 1883 is in use. Attempting to free it..."
  sudo systemctl stop mosquitto 2>/dev/null || true
  sleep 1
fi

info "Running docker compose up -d --build (first build takes 3-5 minutes)..."
sg docker -c "docker compose up -d --build" 2>/dev/null || docker compose up -d --build
ok "Docker stack started"

# Wait for containers to stabilize
info "Waiting for containers to stabilize..."
sleep 5

# ── Step 10: Install Tailscale watchdog cron ──
step "Installing Tailscale watchdog (auto-reconnect)"

WATCHDOG="$EDGE_DIR/tailscale-watchdog.sh"
if [[ -f "$WATCHDOG" ]]; then
  sudo cp "$WATCHDOG" /usr/local/bin/tailscale-watchdog.sh
  sudo chmod +x /usr/local/bin/tailscale-watchdog.sh
  # Add cron if not already present
  if ! crontab -l 2>/dev/null | grep -q 'tailscale-watchdog'; then
    (crontab -l 2>/dev/null; echo "*/2 * * * * /usr/local/bin/tailscale-watchdog.sh >> /var/log/tailscale-watchdog.log 2>&1") | crontab -
    ok "Watchdog cron installed (runs every 2 minutes)"
  else
    ok "Watchdog cron already installed"
  fi
else
  warn "tailscale-watchdog.sh not found, skipping"
fi

# ── Step 11: Validation ──
step "Running validation tests"

PASS=0
FAIL_COUNT=0

run_test() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" &>/dev/null; then
    ok "$name"
    PASS=$((PASS + 1))
  else
    fail "$name"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# Container checks
run_test "Docker is running" "docker info"
run_test "edge-mosquitto container is up" "docker ps --format '{{.Names}}' | grep -q edge-mosquitto"
run_test "edge-lidar-server container is up" "docker ps --format '{{.Names}}' | grep -q edge-lidar-server"

# Port checks
run_test "Port 1883 (MQTT) is listening" "ss -tlnp | grep -q ':1883 '"
run_test "Port 8080 (Edge UI) is listening" "ss -tlnp | grep -q ':8080 '"

# Service checks
run_test "Edge UI responds on :8080" "curl -sf http://127.0.0.1:8080/api/config > /dev/null"
run_test "Tailscale is connected" "tailscale status --json 2>/dev/null | jq -e '.Self.Online == true'"

# MQTT round-trip test
info "Testing MQTT pub/sub round-trip..."
TEST_MSG="hyperspace-install-test-$(date +%s)"
MQTT_RESULT=""
# Subscribe in background, wait for 1 message with 5s timeout
timeout 5 mosquitto_sub -h 127.0.0.1 -p 1883 -t 'hyperspace/install-test' -C 1 > /tmp/mqtt-test-result.txt 2>/dev/null &
SUB_PID=$!
sleep 1
mosquitto_pub -h 127.0.0.1 -p 1883 -t 'hyperspace/install-test' -m "$TEST_MSG" 2>/dev/null
wait $SUB_PID 2>/dev/null || true
MQTT_RESULT=$(cat /tmp/mqtt-test-result.txt 2>/dev/null || echo "")
rm -f /tmp/mqtt-test-result.txt

if [[ "$MQTT_RESULT" == "$TEST_MSG" ]]; then
  ok "MQTT pub/sub round-trip works"
  PASS=$((PASS + 1))
else
  fail "MQTT pub/sub round-trip failed"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Bridge connectivity test
info "Testing bridge connectivity to ${BRIDGE_IP}:1883..."
if timeout 3 bash -c "echo > /dev/tcp/${BRIDGE_IP}/1883" 2>/dev/null; then
  ok "Main server MQTT broker reachable at ${BRIDGE_IP}:1883"
  PASS=$((PASS + 1))
else
  warn "Cannot reach ${BRIDGE_IP}:1883 — bridge will retry. Ensure Mosquitto runs on the main server."
fi

# ── Step 12: Summary ──
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Installation Complete${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

TS_IP=$(tailscale ip -4 2>/dev/null || echo "unknown")
HOSTNAME=$(hostname)

echo -e "  ${BOLD}Edge Device${NC}"
echo -e "  Hostname:      $HOSTNAME"
echo -e "  Tailscale IP:  ${GREEN}$TS_IP${NC}"
echo -e "  LAN IPs:       $(hostname -I 2>/dev/null | tr ' ' ', ' || echo 'unknown')"
echo ""
echo -e "  ${BOLD}Services${NC}"
echo -e "  Edge UI:       ${GREEN}http://${TS_IP}:8080${NC}"
echo -e "  MQTT Broker:   mqtt://${TS_IP}:1883"
echo -e "  Bridge Target: ${BRIDGE_IP}:1883"
echo ""
echo -e "  ${BOLD}Validation${NC}"
echo -e "  Tests passed:  ${GREEN}${PASS}${NC}"
if [[ $FAIL_COUNT -gt 0 ]]; then
  echo -e "  Tests failed:  ${RED}${FAIL_COUNT}${NC}"
fi
echo ""
echo -e "  ${BOLD}Next Steps${NC}"
echo -e "  1. Open ${GREEN}http://${TS_IP}:8080${NC} in your browser"
echo -e "  2. Or use the Edge Simulator Control in the main Hyperspace app"
echo -e "  3. Select your venue and set device ID"
echo -e "  4. Choose ${CYAN}Simulate${NC} (test) or ${CYAN}Live Tracks${NC} (real LiDAR)"
echo ""
echo -e "  ${BOLD}Useful Commands${NC}"
echo -e "  cd ~/edge-server && docker compose ps          # container status"
echo -e "  cd ~/edge-server && docker compose logs -f     # live logs"
echo -e "  mosquitto_sub -h 127.0.0.1 -p 1883 -t '#' -v  # watch MQTT traffic"
echo ""

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}All systems go! 🚀${NC}"
else
  echo -e "  ${YELLOW}${BOLD}Some tests failed — review the output above.${NC}"
fi
echo ""
