#!/bin/bash
#
# Cross-platform build script for sim-tracker .deb package
# Works on Mac and Linux without dpkg-deb
#
# A .deb file is an 'ar' archive containing:
#   - debian-binary (version string)
#   - control.tar.gz (package metadata)
#   - data.tar.gz (actual files)
#

set -e

PACKAGE_NAME="sim-tracker"
VERSION="1.0.0"
ARCH="amd64"
BUILD_DIR="build"
DEB_NAME="${PACKAGE_NAME}_${VERSION}_${ARCH}.deb"

echo "========================================"
echo "Building ${DEB_NAME} (cross-platform)"
echo "========================================"

# Clean previous build
rm -rf "${BUILD_DIR}"
rm -f "${DEB_NAME}"

# Create build directories
mkdir -p "${BUILD_DIR}/control"
mkdir -p "${BUILD_DIR}/data/opt/sim-tracker/src"
mkdir -p "${BUILD_DIR}/data/usr/bin"

# ========== DATA ARCHIVE ==========
echo "Creating data archive..."

# Copy application files
cp src/tracker.js "${BUILD_DIR}/data/opt/sim-tracker/src/"
cp package.json "${BUILD_DIR}/data/opt/sim-tracker/"

# Create launcher script
cat > "${BUILD_DIR}/data/usr/bin/sim-tracker" << 'EOF'
#!/bin/bash
exec node /opt/sim-tracker/src/tracker.js "$@"
EOF

# Set permissions
chmod 755 "${BUILD_DIR}/data/opt/sim-tracker/src/tracker.js"
chmod 755 "${BUILD_DIR}/data/usr/bin/sim-tracker"

# Create data.tar.gz
cd "${BUILD_DIR}/data"
tar czf ../data.tar.gz .
cd ../..

# ========== CONTROL ARCHIVE ==========
echo "Creating control archive..."

# Copy control file
cp debian/control "${BUILD_DIR}/control/"

# Copy and set permissions on postinst
cp debian/postinst "${BUILD_DIR}/control/"
chmod 755 "${BUILD_DIR}/control/postinst"

# Calculate installed size (in KB)
INSTALLED_SIZE=$(du -sk "${BUILD_DIR}/data" | cut -f1)
echo "Installed-Size: ${INSTALLED_SIZE}" >> "${BUILD_DIR}/control/control"

# Create control.tar.gz
cd "${BUILD_DIR}/control"
tar czf ../control.tar.gz .
cd ../..

# ========== DEBIAN-BINARY ==========
echo "2.0" > "${BUILD_DIR}/debian-binary"

# ========== CREATE .DEB ARCHIVE ==========
echo "Creating .deb archive..."

cd "${BUILD_DIR}"
# ar archive with specific order: debian-binary, control.tar.gz, data.tar.gz
ar rcs "../${DEB_NAME}" debian-binary control.tar.gz data.tar.gz
cd ..

# Verify the archive
echo ""
echo "Verifying .deb structure..."
ar -t "${DEB_NAME}"

# Show result
echo ""
echo "========================================"
echo "Build complete!"
echo "========================================"
echo "Package: ${DEB_NAME}"
echo "Size: $(du -h ${DEB_NAME} | cut -f1)"
echo ""
echo "Contents:"
ar -t "${DEB_NAME}"
echo ""
echo "To use with Conversion Service:"
echo "  Upload ${DEB_NAME} in the 'Convert .deb' tab"
echo "========================================"
