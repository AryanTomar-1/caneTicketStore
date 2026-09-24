# 🚀 OTA (Over-The-Air) Update Guide — Smart Kissan

## How It Works

```
You edit JS/TS code  →  npm run update  →  Users open app  →  Banner appears  →  User taps "अभी लागू करें"  →  Updated ✅
```

No new APK needed. No Play Store submission. Updates land on users' phones **within seconds** of you running the command.

---

## What Changes Can Be Pushed OTA?

| ✅ OTA Safe (No new APK needed) | ❌ Requires New APK Build |
|---|---|
| Business logic (TypeScript/JavaScript) | Adding a new native package (`npm install xyz`) |
| UI changes, new screens | Changing `app.json` permissions |
| Bug fixes | Changing native Android/iOS config |
| New React components | Upgrading Expo SDK version |
| AsyncStorage logic | Changing app icon / splash screen |
| Text/language changes | Changing `android.package` or bundle ID |
| Constants, utils, hooks | Native module changes |

> **Rule of thumb:** If you only touched `.ts`, `.tsx`, or asset files — it's OTA safe.

---

## Pushing an OTA Update (Production)

```bash
# Commit your changes first (good practice)
git add .
git commit -m "fix: corrected date filter bug"

# Push OTA update to ALL production users instantly
npm run update -- --message "fix: corrected date filter bug"
```

Users will see the update banner automatically the next time they open the app.

---

## Pushing a Preview Update (Testing Before Production)

```bash
npm run update:preview -- --message "test: new farmer lookup logic"
```

Only devices built with the `preview` EAS build profile will receive this.

---

## What Happens on the User's Device

1. App opens → waits 3 seconds (so splash screen finishes)
2. Silently checks EAS servers for a new update
3. **If update found:** Downloads it in the background (no interruption to the user)
4. A banner slides in from the top:
   - 🟡 Amber dot while downloading: *"नया अपडेट डाउनलोड हो रहा है..."*
   - 🟢 Green banner when ready: *"✅ नया अपडेट तैयार है!"* + **"अभी लागू करें"** button
5. User taps the button → app reloads instantly with the new code

---

## Checking Recent Updates

```bash
npm run update:check
```

---

## Important Rules

### ⚠️ `runtimeVersion` = `appVersion`
OTA updates **only land on devices running the same app version** (`1.0.0`).
If you increment `version` in `app.json` (e.g., `1.0.1`), you must build a new APK.
After users install the new APK, future OTA updates targeting `1.0.1` will apply.

### ⚠️ Native Changes Always Need a New APK
If you run `npm install some-native-package`, you **must** rebuild:
```bash
eas build --platform android --profile production
```

### ⚠️ First-Time Setup (one-time)
Make sure you're logged into EAS:
```bash
npx eas login
npx eas update:configure   # sets up branches
```

---

## Full Workflow Summary

```
# First time (one-time setup)
npx eas login
npx eas update:configure

# Every time you make OTA-safe code changes
git commit -m "your message"
npm run update -- --message "your message"

# To check what's live
npm run update:check

# Only when you add native packages or change app.json permissions
eas build --platform android --profile production
```
