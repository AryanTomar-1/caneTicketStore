// scripts/bump-version.js
// Automatically increments the patch version in app.json, package.json, and docs/version.json
// e.g. 1.0.0 -> 1.0.1 -> 1.0.2

const fs = require('fs');
const path = require('path');

const appJsonPath = path.join(__dirname, '..', 'app.json');
const pkgJsonPath = path.join(__dirname, '..', 'package.json');
const versionJsonPath = path.join(__dirname, '..', 'docs', 'version.json');

try {
  if (!fs.existsSync(appJsonPath)) {
    console.error('❌ Error: app.json not found!');
    process.exit(1);
  }

  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const currentVersion = appJson.expo?.version || '1.0.0';

  // Increment patch version (major.minor.patch)
  const parts = currentVersion.split('.').map(v => parseInt(v, 10) || 0);
  if (parts.length >= 3) {
    parts[2] += 1;
  } else if (parts.length === 2) {
    parts.push(1);
  } else {
    parts.push(0, 1);
  }
  const newVersion = parts.join('.');

  // 1. Update app.json
  appJson.expo.version = newVersion;
  fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n', 'utf8');

  // 2. Update package.json
  if (fs.existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    pkgJson.version = newVersion;
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8');
  }

  // 3. Update docs/version.json
  let versionData = {
    latestVersion: newVersion,
    minVersion: '1.0.0',
    forceUpdate: false,
    releaseNotes: "नए फीचर्स, बग सुधार और बेहतर प्रदर्शन।",
    playStoreUrl: "https://play.google.com/store/apps/details?id=com.aryan_tomar.SmartKissan"
  };

  if (fs.existsSync(versionJsonPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
      versionData = { ...existing, latestVersion: newVersion };
    } catch (e) {}
  }
  fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2) + '\n', 'utf8');

  console.log('\n========================================================');
  console.log(`🚀 [Smart Kissan] Version bumped: ${currentVersion}  ➔  ${newVersion}`);
  console.log('✅ Updated app.json');
  console.log('✅ Updated package.json');
  console.log('✅ Updated docs/version.json');
  console.log('========================================================\n');
} catch (error) {
  console.error('❌ Error bumping version:', error.message);
  process.exit(1);
}
