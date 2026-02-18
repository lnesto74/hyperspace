#!/bin/bash
#
# Build script for sim-tracker .deb package
# Creates a Debian package that can be used to test the Conversion Service
#

set -e

PACKAGE_NAME="sim-tracker"
VERSION="1.0.0"
ARCH="amd64"
BUILD_DIR="build"
DEB_NAME="${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"

echo "========================================"
echo "Building ${DEB_NAME}"
echo "========================================"

# Clean previous build
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}/DEBIAN"
mkdir -p "${BUILD_DIR}/opt/sim-tracker/src"
mkdir -p "${BUILD_DIR}/usr/bin"

# Copy application files
cp src/tracker.js "${BUILD_DIR}/opt/sim-tracker/src/"
cp package.json "${BUILD_DIR}/opt/sim-tracker/"

# Copy Debian control files
cp debian/control "${BUILD_DIR}/DEBIAN/"
cp debian/postinst "${BUILD_DIR}/DEBIAN/"
chmod 755 "${BUILD_DIR}/DEBIAN/postinst"

# Create symlink script for /usr/bin
cat > "${BUILD_DIR}/usr/bin/sim-tracker" << 'EOF'
#!/bin/bash
exec node /opt/sim-tracker/src/tracker.js "$@"
EOF
chmod 755 "${BUILD_DIR}/usr/bin/sim-tracker"

# Set permissions
find "${BUILD_DIR}" -type d -exec chmod 755 {} \;
find "${BUILD_DIR}/opt" -type f -exec chmod 644 {} \;
chmod 755 "${BUILD_DIR}/opt/sim-tracker/src/tracker.js"

# Build the .deb package
echo "Creating .deb package..."
dpkg-deb --build "${BUILD_DIR}" "${DEB_NAME}"

# Show result
echo ""
echo "========================================"
echo "Build complete!"
echo "========================================"
echo "Package: ${DEB_NAME}"
echo "Size: $(du -h ${DEB_NAME} | cut -f1)"
echo ""
echo "To install locally (for testing):"
echo "  sudo dpkg -i ${DEB_NAME}"
echo ""
echo "To use with Conversion Service:"
echo "  Upload ${DEB_NAME} in the 'Convert .deb' tab"
echo "========================================"
