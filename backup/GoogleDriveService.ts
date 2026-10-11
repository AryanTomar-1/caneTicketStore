// ─── GoogleDriveService.ts ────────────────────────────────────────────────────
// Google OAuth + Drive REST API v3 integration.
// Uses expo-auth-session for PKCE OAuth flow and Drive REST API for file ops.

import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { GoogleTokens, DriveBackupPayload, DriveMetadata, BACKUP_FOLDER_NAME, BACKUP_DATA_FOLDER_NAME, BACKUP_METADATA_FILE, BACKUP_DATA_FILE } from './BackupTypes';
import { getTokens, saveTokens, clearTokens, isTokenExpired } from './BackupStorage';

// Required for OAuth redirect in Expo
WebBrowser.maybeCompleteAuthSession();

// ─── Google OAuth Client ID ───────────────────────────────────────────────────
// Reads from .env (EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID / WEB) or app.json extra
export const getGoogleClientId = (): string => {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ||
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ||
    (Constants.expoConfig?.extra as any)?.googleClientIdWeb ||
    (Constants.expoConfig?.extra as any)?.googleClientIdAndroid ||
    ''
  );
};

export const getGoogleClientSecret = (): string => {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET ||
    (Constants.expoConfig?.extra as any)?.googleClientSecret ||
    ''
  );
};

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

// ─── Auth Discovery ───────────────────────────────────────────────────────────

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Returns the redirect URI for this app.
 * Must match what is configured in Google Cloud Console under Authorized redirect URIs.
 */
export const getRedirectUri = (): string => {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI ||
    'https://auth.expo.io/@dev-aryantomar/SmartKissan'
  );
};

/**
 * Initiate Google OAuth PKCE flow.
 * Returns GoogleTokens on success, throws on failure/cancellation.
 */
export const signInWithGoogle = async (): Promise<GoogleTokens> => {
  const clientId = getGoogleClientId();
  if (!clientId) {
    throw new Error('Google Client ID config nahi hai. Kripya .env me EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB set karein.');
  }

  const redirectUri = getRedirectUri();

  let returnUrl = AuthSession.makeRedirectUri({
    scheme: 'smartkissan',
    path: 'expo-auth-session',
  });
  // auth.expo.io validates returnUrl with URI parser. In standalone APKs,
  // scheme without host/path (e.g. smartkissan://) fails validation.
  if (!returnUrl.includes('://') || returnUrl.endsWith('://') || returnUrl.endsWith(':/')) {
    returnUrl = 'smartkissan://expo-auth-session';
  }

  console.log('[BACKUP] Starting Google OAuth flow...');
  console.log('[BACKUP] Client ID:', clientId);
  console.log('[BACKUP] Redirect URI for Google:', redirectUri);
  console.log('[BACKUP] Return URL for App:', returnUrl);

  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: GOOGLE_SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  });

  const authUrl = await request.makeAuthUrlAsync(discovery);
  const startUrl = `https://auth.expo.io/@dev-aryantomar/SmartKissan/start?authUrl=${encodeURIComponent(authUrl)}&returnUrl=${encodeURIComponent(returnUrl)}`;

  // Capture deep links directly via Linking event in case openAuthSessionAsync resolves with dismiss on Android
  let capturedUrl: string | null = null;
  const linkSub = Linking.addEventListener('url', (event) => {
    console.log('[BACKUP] Linking event received URL:', event.url);
    if (event.url && (event.url.includes('code=') || event.url.includes('error='))) {
      capturedUrl = event.url;
    }
  });

  let result: any;
  try {
    result = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl);
  } finally {
    linkSub.remove();
  }
  console.log('[BACKUP] OAuth result received:', JSON.stringify(result));

  let finalUrl: string | null = null;
  if (result.type === 'success' && result.url) {
    finalUrl = result.url;
  } else if (capturedUrl) {
    console.log('[BACKUP] Using captured deep link URL from Linking event:', capturedUrl);
    finalUrl = capturedUrl;
  } else {
    const initialUrl = await Linking.getInitialURL();
    console.log('[BACKUP] Initial URL check:', initialUrl);
    if (initialUrl && (initialUrl.includes('code=') || initialUrl.includes('error='))) {
      finalUrl = initialUrl;
    }
  }

  if (!finalUrl) {
    if (result.type === 'cancel' || result.type === 'dismiss') {
      console.log('[BACKUP] User cancelled or browser was dismissed without code. result:', result);
      throw new Error('USER_CANCELLED');
    }
    throw new Error('Google authentication failed');
  }

  const parsed = request.parseReturnUrl(finalUrl);
  if (parsed.type !== 'success' || !parsed.params?.code) {
    console.error('[BACKUP] Failed parsing return url:', parsed);
    throw new Error((parsed as any).error?.message || 'Authentication did not return an authorization code');
  }

  console.log('[BACKUP] Google auth code received, exchanging for tokens...');

  // Exchange code for tokens
  const clientSecret = getGoogleClientSecret();
  console.log('[BACKUP] Exchanging code with clientId, clientSecret present:', !!clientSecret);

  let tokenResponse: any;
  try {
    tokenResponse = await AuthSession.exchangeCodeAsync(
      {
        clientId,
        clientSecret: clientSecret || undefined,
        code: parsed.params.code,
        redirectUri,
        extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
      },
      discovery
    );
  } catch (exchangeErr: any) {
    console.warn('[BACKUP] exchangeCodeAsync warning, trying direct token exchange fallback:', exchangeErr?.message);
    const bodyParams: Record<string, string> = {
      grant_type: 'authorization_code',
      code: parsed.params.code,
      redirect_uri: redirectUri,
      client_id: clientId,
    };
    if (clientSecret) {
      bodyParams.client_secret = clientSecret;
    }
    if (request.codeVerifier) {
      bodyParams.code_verifier = request.codeVerifier;
    }

    const res = await fetch(discovery.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(bodyParams).toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[BACKUP] Direct token fetch also failed:', res.status, errText);
      throw exchangeErr;
    }

    const data = await res.json();
    tokenResponse = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      idToken: data.id_token,
      tokenType: data.token_type || 'Bearer',
    };
  }

  if (!tokenResponse.accessToken) {
    throw new Error('Failed to get access token from Google');
  }

  // Fetch user email from userinfo endpoint
  let email: string | undefined;
  let sub: string | undefined;
  try {
    const userInfoResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenResponse.accessToken}` },
    });
    if (userInfoResp.ok) {
      const userInfo = await userInfoResp.json();
      email = userInfo.email;
      sub = userInfo.sub;
    } else {
      console.warn('[BACKUP] Userinfo fetch returned status:', userInfoResp.status);
    }
  } catch (userInfoErr: any) {
    console.warn('[BACKUP] Userinfo endpoint error:', userInfoErr?.message);
  }

  // Robust fallback: decode email from id_token if userinfo didn't return it
  if (!email && tokenResponse.idToken) {
    try {
      const parts = tokenResponse.idToken.split('.');
      if (parts.length >= 2) {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const decodedStr = typeof atob === 'function'
          ? atob(base64)
          : Buffer.from(base64, 'base64').toString('binary');
        const parsed = JSON.parse(decodedStr);
        if (parsed?.email) email = parsed.email;
        if (parsed?.sub) sub = parsed.sub;
        console.log('[BACKUP] Extracted email from idToken fallback:', email);
      }
    } catch (jwtErr: any) {
      console.warn('[BACKUP] Could not parse id_token payload:', jwtErr?.message);
    }
  }

  const tokens: GoogleTokens = {
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken,
    expiresAt: (tokenResponse.issuedAt + (tokenResponse.expiresIn || 3600)) * 1000,
    tokenType: tokenResponse.tokenType || 'Bearer',
    scope: GOOGLE_SCOPES.join(' '),
    email,
    sub,
  };

  await saveTokens(tokens);
  console.log(`[BACKUP] Google account connected: ${email}`);
  return tokens;
};

/**
 * Refresh the access token using the stored refresh token.
 * Returns updated tokens or throws if refresh fails.
 */
export const refreshAccessToken = async (tokens: GoogleTokens): Promise<GoogleTokens> => {
  if (!tokens.refreshToken) {
    throw new Error('No refresh token available');
  }

  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();

  const bodyData: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  };
  if (clientSecret) {
    bodyData.client_secret = clientSecret;
  }

  const response = await fetch(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(bodyData).toString(),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  const updated: GoogleTokens = {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  await saveTokens(updated);
  console.log('[BACKUP] Access token refreshed');
  return updated;
};

/**
 * Get a valid access token, refreshing if needed.
 * Throws if authentication is required.
 */
export const getValidAccessToken = async (): Promise<string> => {
  let tokens = await getTokens();
  if (!tokens) {
    throw new Error('AUTH_REQUIRED');
  }
  if (isTokenExpired(tokens)) {
    console.log('[BACKUP] Token expired, refreshing...');
    try {
      tokens = await refreshAccessToken(tokens);
    } catch {
      await clearTokens();
      throw new Error('AUTH_REQUIRED');
    }
  }
  return tokens.accessToken;
};

/**
 * Sign out — revoke token and clear local storage.
 */
export const signOut = async (): Promise<void> => {
  const tokens = await getTokens();
  if (tokens) {
    try {
      await fetch(`${discovery.revocationEndpoint}?token=${tokens.accessToken}`, { method: 'POST' });
    } catch { /* non-critical */ }
  }
  await clearTokens();
  console.log('[BACKUP] Google account disconnected');
};

// ─── Drive Folder/File Operations ─────────────────────────────────────────────

const driveRequest = async (url: string, options: RequestInit): Promise<Response> => {
  const accessToken = await getValidAccessToken();
  const headers: HeadersInit = {
    Authorization: `Bearer ${accessToken}`,
    ...((options.headers as Record<string, string>) || {}),
  };
  return fetch(url, { ...options, headers });
};

/**
 * List files in Drive matching a query.
 */
const driveListFiles = async (query: string): Promise<any[]> => {
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name,mimeType,modifiedTime)',
    spaces: 'drive',
  });
  const resp = await driveRequest(`${DRIVE_API_BASE}/files?${params}`, { method: 'GET' });
  if (!resp.ok) throw new Error(`Drive list error: ${resp.status}`);
  const data = await resp.json();
  return data.files || [];
};

/**
 * Find or create the "Smart Kisan Backup" folder.
 */
export const findOrCreateBackupFolder = async (): Promise<{ folderId: string; dataFolderId: string }> => {
  console.log('[BACKUP] Finding/creating backup folder in Drive...');

  // Find root folder
  let folders = await driveListFiles(
    `name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  let folderId: string;
  if (folders.length > 0) {
    folderId = folders[0].id;
  } else {
    const resp = await driveRequest(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: BACKUP_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });
    if (!resp.ok) throw new Error(`Failed to create backup folder: ${resp.status}`);
    const created = await resp.json();
    folderId = created.id;
    console.log('[BACKUP] Created "Smart Kisan Backup" folder');
  }

  // Find or create data subfolder
  let dataFolders = await driveListFiles(
    `name='${BACKUP_DATA_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and '${folderId}' in parents and trashed=false`
  );
  let dataFolderId: string;
  if (dataFolders.length > 0) {
    dataFolderId = dataFolders[0].id;
  } else {
    const resp = await driveRequest(`${DRIVE_API_BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: BACKUP_DATA_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [folderId],
      }),
    });
    if (!resp.ok) throw new Error(`Failed to create data folder: ${resp.status}`);
    const created = await resp.json();
    dataFolderId = created.id;
    console.log('[BACKUP] Created "data" subfolder');
  }

  return { folderId, dataFolderId };
};

/**
 * Find a file by name in a folder. Returns file ID or null.
 */
export const findFileInFolder = async (folderId: string, fileName: string): Promise<string | null> => {
  const files = await driveListFiles(
    `name='${fileName}' and '${folderId}' in parents and trashed=false`
  );
  return files.length > 0 ? files[0].id : null;
};

/**
 * Upload (create or update) a JSON file in Drive.
 * Uses multipart upload for metadata + content in one request.
 */
export const uploadJsonFile = async (
  folderId: string,
  fileName: string,
  content: object,
  existingFileId?: string
): Promise<string> => {
  const body = JSON.stringify(content);
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata: any = {
    name: fileName,
    mimeType: 'application/json',
  };
  if (!existingFileId) {
    metadata.parents = [folderId];
  }

  const multipartBody =
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    body +
    closeDelimiter;

  const url = existingFileId
    ? `${DRIVE_UPLOAD_BASE}/files/${existingFileId}?uploadType=multipart`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`;

  const method = existingFileId ? 'PATCH' : 'POST';

  const resp = await driveRequest(url, {
    method,
    headers: {
      'Content-Type': `multipart/related; boundary="${boundary}"`,
      'Content-Length': String(multipartBody.length),
    },
    body: multipartBody,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Drive upload failed (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  console.log(`[BACKUP] Uploaded ${fileName} (id: ${data.id})`);
  return data.id;
};

/**
 * Download and parse a JSON file from Drive by file ID.
 */
export const downloadJsonFile = async (fileId: string): Promise<any> => {
  const resp = await driveRequest(
    `${DRIVE_API_BASE}/files/${fileId}?alt=media`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } }
  );
  if (!resp.ok) throw new Error(`Drive download failed: ${resp.status}`);
  return resp.json();
};

/**
 * Upload the full backup payload.
 */
export const uploadBackupPayload = async (
  dataFolderId: string,
  payload: DriveBackupPayload,
  existingFileId?: string
): Promise<string> => {
  console.log('[BACKUP] Uploading backup payload to Drive...');
  return uploadJsonFile(dataFolderId, BACKUP_DATA_FILE, payload, existingFileId);
};

/**
 * Upload the metadata file.
 */
export const uploadMetadata = async (
  folderId: string,
  metadata: DriveMetadata,
  existingFileId?: string
): Promise<string> => {
  console.log('[BACKUP] Uploading metadata to Drive...');
  return uploadJsonFile(folderId, BACKUP_METADATA_FILE, metadata, existingFileId);
};

/**
 * Download the backup payload.
 */
export const downloadBackupPayload = async (fileId: string): Promise<DriveBackupPayload> => {
  console.log('[BACKUP] Downloading backup payload from Drive...');
  return downloadJsonFile(fileId);
};

/**
 * Download the metadata file.
 */
export const downloadMetadata = async (fileId: string): Promise<DriveMetadata> => {
  console.log('[BACKUP] Downloading metadata from Drive...');
  return downloadJsonFile(fileId);
};
