/* eslint-env node */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAdiProperties = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const assetsDir = path.join(
        config.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'assets'
      );
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }
      const src = path.join(config.modRequest.projectRoot, 'adi-registration.properties');
      const dest = path.join(assetsDir, 'adi-registration.properties');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('✅ adi-registration.properties copied');
      } else {
        console.warn('⚠️ adi-registration.properties not found');
      }
      return config;
    },
  ]);
};

module.exports = withAdiProperties;