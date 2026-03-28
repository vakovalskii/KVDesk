# CI/CD: GitHub Actions Release

## Workflow

`.github/workflows/release.yml` — builds ValeDesk for all platforms on git tag push.

### Trigger

```bash
git tag v0.0.9
git push origin v0.0.9
```

Or manually via GitHub Actions > Release > Run workflow.

### Build Matrix

| Platform | Runner | Target | Artifacts |
|----------|--------|--------|-----------|
| macOS ARM64 | `macos-latest` | `aarch64-apple-darwin` | `.dmg` |
| macOS Intel | `macos-13` | `x86_64-apple-darwin` | `.dmg` |
| Linux x64 | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `.AppImage`, `.deb` |
| Windows x64 | `windows-latest` | `x86_64-pc-windows-msvc` | `.msi`, `.exe` |

### Output

Draft GitHub Release with all artifacts attached.

## Required GitHub Secrets

Go to **Settings > Secrets and variables > Actions** and add:

### macOS Signing & Notarization

| Secret | Description | How to get |
|--------|-------------|------------|
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` certificate | See below |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` file | Set when exporting |
| `KEYCHAIN_PASSWORD` | Any random password for temp keychain | Generate: `openssl rand -hex 16` |
| `APPLE_ID` | Your Apple ID email | e.g. `your@email.com` |
| `APPLE_PASSWORD` | App-specific password | [appleid.apple.com](https://appleid.apple.com) > Sign-In and Security > App-Specific Passwords |
| `APPLE_TEAM_ID` | Team ID from Apple Developer | `A933C2TJXU` |

#### Export certificate as base64

```bash
# 1. Export from Keychain Access:
#    Open Keychain Access > My Certificates > "Developer ID Application: Valeriy Kovalsky"
#    Right-click > Export > Save as .p12

# 2. Convert to base64:
base64 -i certificate.p12 | pbcopy
# Paste into APPLE_CERTIFICATE secret
```

### Tauri Update Signing (optional)

| Secret | Description |
|--------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | For Tauri auto-updater |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the key |

Generate:
```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/ValeDesk.key
```

### Windows Signing (optional)

For Windows code signing, set `certificateThumbprint` in `tauri.conf.json` and add:

| Secret | Description |
|--------|-------------|
| `WINDOWS_CERTIFICATE` | Base64 `.pfx` certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Certificate password |

## Build Steps

1. **npm ci** — install Node dependencies
2. **npm run build** — build frontend (Vite)
3. **npm run build:sidecar** — bundle Node.js sidecar (pkg)
4. **cargo tauri build** — compile Rust + bundle app
5. **codesign** — sign macOS app (via Tauri, uses `signingIdentity` from config)
6. **notarytool** — submit to Apple for notarization + staple
7. **upload** — artifacts to GitHub Release

## Local Release (macOS)

```bash
# Build + sign + notarize locally
APPLE_SIGNING_IDENTITY="Developer ID Application: Valeriy Kovalsky (A933C2TJXU)" \
  make bundle

# Manual notarize
xcrun notarytool submit path/to/ValeDesk.dmg \
  --keychain-profile AC_PASSWORD --wait
xcrun stapler staple path/to/ValeDesk.dmg
```
