module.exports = ({ config }) => {
  const isPreview = process.env.APP_ENV === 'preview' || process.env.EAS_BUILD_PROFILE === 'preview';

  return {
    ...config,
    name: isPreview ? 'Smart Kissan (Preview)' : (config.name || 'Smart Kissan'),
    android: {
      ...config.android,
      package: isPreview
        ? 'com.aryan_tomar.SmartKissan.preview'
        : (config.android?.package || 'com.aryan_tomar.SmartKissan'),
    },
  };
};
