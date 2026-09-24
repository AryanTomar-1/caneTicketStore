import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { exportFullDatabase, importDatabase, RestoreMode, RestoreResult } from './storage';

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Exports all SmartKissan data to a JSON file and opens Android Share sheet.
 *
 * FILE LOCATION on Android:
 *  - The file is first written to the app's temporary cache directory
 *    (expo-file-system: FileSystem.cacheDirectory).
 *  - When the user picks "Save to Downloads" or "Files" in the Share sheet,
 *    Android saves it to the device's Downloads/ or Documents/ folder,
 *    which is accessible via any File Manager app.
 *  - When the user picks "Drive", "WhatsApp", etc. the file is sent directly.
 *
 * @returns Path of the exported temp file, or throws on error.
 */
export const exportBackupToFile = async (): Promise<string> => {
  const payload = await exportFullDatabase();
  const json = JSON.stringify(payload, null, 2);

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  const filename = `SmartKissan_Backup_${timestamp}.json`;
  const filePath = `${FileSystem.cacheDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(filePath, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error(
      'शेयरिंग इस डिवाइस पर उपलब्ध नहीं है। फ़ाइल यहाँ सेव हुई:\n' + filePath
    );
  }

  await Sharing.shareAsync(filePath, {
    mimeType: 'application/json',
    dialogTitle: 'SmartKissan बैकअप सेव करें',
    UTI: 'public.json',
  });

  return filePath;
};

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Opens the system file picker and imports a SmartKissan JSON backup.
 * Returns null if the user cancelled.
 */
export const importBackupFromFile = async (
  mode: RestoreMode
): Promise<RestoreResult | null> => {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const uri = asset.uri;

  // Read file contents
  const content = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return importDatabase(content, mode);
};
