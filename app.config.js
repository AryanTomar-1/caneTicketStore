try { require('dotenv').config(); } catch (e) {}

module.exports = ({ config }) => {
  const isPreview = process.env.APP_ENV === 'preview' || process.env.EAS_BUILD_PROFILE === 'preview';

  // Merge expo-secure-store plugin into the plugins array from app.json
  const basePlugins = Array.isArray(config.plugins) ? config.plugins : [];
  const hasSecureStore = basePlugins.some(p =>
    p === 'expo-secure-store' || (Array.isArray(p) && p[0] === 'expo-secure-store')
  );

  return {
    ...config,
    name: isPreview ? 'Smart Kissan (Preview)' : (config.name || 'Smart Kissan'),
    android: {
      ...config.android,
      package: isPreview
        ? 'com.aryan_tomar.SmartKissan.preview'
        : (config.android?.package || 'com.aryan_tomar.SmartKissan'),
    },
    plugins: hasSecureStore ? basePlugins : [...basePlugins, 'expo-secure-store'],
    extra: {
      ...config.extra,
      googleClientIdWeb: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB || '',
      googleClientSecret: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET || '',
    },
  };
};
