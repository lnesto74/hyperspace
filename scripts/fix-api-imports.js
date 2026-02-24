#!/usr/bin/env node
/**
 * Script to update all files to use centralized API config
 * Replaces local API_BASE definitions with import from config/api.ts
 */

const fs = require('fs');
const path = require('path');

const files = [
  'frontend/src/App.tsx',
  'frontend/src/context/ProfitRadarContext.tsx',
  'frontend/src/context/ReplayInsightContext.tsx',
  'frontend/src/context/TrackingContext.tsx',
  'frontend/src/context/NarratorContext.tsx',
  'frontend/src/context/Narrator2Context.tsx',
  'frontend/src/context/HeatmapContext.tsx',
  'frontend/src/context/EdgeCommissioningContext.tsx',
  'frontend/src/context/PlanogramContext.tsx',
  'frontend/src/context/RoiContext.tsx',
  'frontend/src/features/businessReporting/components/DeadZonesViewport.tsx',
  'frontend/src/features/businessReporting/BusinessReportingPage.tsx',
  'frontend/src/components/settings/LogoOverlay.tsx',
  'frontend/src/components/settings/SimulatorControl.tsx',
  'frontend/src/components/settings/WhiteLabelSettings.tsx',
  'frontend/src/components/landing/LandingNarrator.tsx',
  'frontend/src/components/dwgImporter/PreviewPanel.tsx',
  'frontend/src/components/dwgImporter/DwgImportsList.tsx',
  'frontend/src/components/dwgImporter/Layout3DPreview.tsx',
  'frontend/src/components/dwgImporter/DwgImporterPage.tsx',
  'frontend/src/components/dwgImporter/ImportedLayoutLayer.tsx',
  'frontend/src/components/objects/ObjectLibrary.tsx',
  'frontend/src/components/narrator/NarratorDrawer.tsx',
  'frontend/src/components/checkout/CheckoutManagerModal.tsx',
  'frontend/src/components/lidar/LidarNetworkPanel.tsx',
  'frontend/src/components/lidarPlanner/LidarPlannerPage.tsx',
  'frontend/src/components/planogram/PlanogramBuilder.tsx',
  'frontend/src/components/planogram/PlanogramViewport.tsx',
  'frontend/src/components/kpi/ProductAnalyticsTab.tsx',
  'frontend/src/components/kpi/ActivityLedger.tsx',
  'frontend/src/components/kpi/SmartKpiModal.tsx',
  'frontend/src/components/kpi/ZoneSettingsPanel.tsx',
  'frontend/src/components/kpi/ZoneKPIPopup.tsx',
  'frontend/src/components/kpi/VenueKPIThresholdsPanel.tsx',
  'frontend/src/components/venue/MainViewport.tsx',
  'frontend/src/components/venue/SkuDebugOverlay.tsx',
  'frontend/src/components/venue/VenueDwgPanel.tsx',
  'frontend/src/components/venue/FloorplanPanel.tsx',
  'frontend/src/components/venue/VenueSettingsPanel.tsx',
  'frontend/src/components/venue/VenuePanel.tsx',
  'frontend/src/components/timeline/TimelineReplay.tsx',
  'frontend/src/components/edgeCommissioning/EdgeCommissioningPage.tsx',
  'frontend/src/components/edgeCommissioning/PointCloudViewer.tsx',
  'frontend/src/components/edgeCommissioning/ConversionServiceForm.tsx',
  'frontend/src/components/edgeCommissioning/LidarCommissioningWizard.tsx',
  'frontend/src/components/dooh/PlaylistManager.tsx',
  'frontend/src/components/dooh/DoohEffectivenessPage.tsx',
  'frontend/src/components/dooh/DoohAnalyticsPage.tsx',
  'frontend/src/hooks/useDoohVideoPlayer.ts',
];

const rootDir = path.join(__dirname, '..');

function getRelativeImportPath(filePath) {
  const fileDir = path.dirname(filePath);
  const configPath = 'frontend/src/config/api';
  
  // Calculate relative path from file to config
  const fromDir = path.join(rootDir, fileDir);
  const toFile = path.join(rootDir, configPath);
  let relativePath = path.relative(fromDir, toFile);
  
  // Ensure it starts with ./ or ../
  if (!relativePath.startsWith('.')) {
    relativePath = './' + relativePath;
  }
  
  return relativePath;
}

function processFile(filePath) {
  const fullPath = path.join(rootDir, filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }
  
  let content = fs.readFileSync(fullPath, 'utf8');
  const originalContent = content;
  
  // Pattern to match the API_BASE constant definition
  const apiBasePattern = /const API_BASE = import\.meta\.env\.VITE_API_URL \|\| ['"]http:\/\/localhost:3001['"]\n?/g;
  
  // Check if file has the pattern
  if (!apiBasePattern.test(content)) {
    console.log(`⏭️  No match in: ${filePath}`);
    return;
  }
  
  // Reset regex
  apiBasePattern.lastIndex = 0;
  
  // Remove the local API_BASE definition
  content = content.replace(apiBasePattern, '');
  
  // Calculate relative import path
  const importPath = getRelativeImportPath(filePath);
  const importStatement = `import { API_BASE } from '${importPath}'\n`;
  
  // Check if import already exists
  if (content.includes("from '" + importPath + "'") || content.includes('from "' + importPath + '"')) {
    console.log(`⏭️  Import already exists in: ${filePath}`);
    fs.writeFileSync(fullPath, content);
    return;
  }
  
  // Find the best place to add the import (after other imports)
  const importRegex = /^import .* from ['"][^'"]+['"]\n/gm;
  let lastImportMatch;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    lastImportMatch = match;
  }
  
  if (lastImportMatch) {
    const insertPosition = lastImportMatch.index + lastImportMatch[0].length;
    content = content.slice(0, insertPosition) + importStatement + content.slice(insertPosition);
  } else {
    // No imports found, add at the beginning
    content = importStatement + content;
  }
  
  fs.writeFileSync(fullPath, content);
  console.log(`✅ Updated: ${filePath}`);
}

console.log('🔄 Updating API imports...\n');

files.forEach(processFile);

console.log('\n✨ Done!');
