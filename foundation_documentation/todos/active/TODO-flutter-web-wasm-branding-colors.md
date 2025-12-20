# TODO (V1): Fix Flutter Web (WASM) branding/theme colors not applying

**Owners:** Delphi + Flutter team  
**Status:** Active  
**Scope:** `flutter-app` (Dart-side bootstrap)  

## Problem
On some Web deployments (notably Flutter Web **WASM** builds), tenant branding colors from `/environment` are not applied inside Flutter UI (theme remains default/blue), even though the host page resolves the correct branding payload.

Example tenant:
- `https://alfredochaves.belluga.app/environment` returns `theme_data_settings.primary_seed_color="#0E9538"` and `secondary_seed_color="#FDC005"`, but Flutter UI remains on fallback/default palette.

## Root Cause (Expected)
The code relies on conditional exports guarded by `if (dart.library.html)` to select web-specific implementations:
- Web `AppDataBackend` listens for `brandingReady` / reads `window.__brandingPayload`
- Web `AppDataLocalInfoSource` reads `window.location`

In Flutter Web **WASM** builds, `dart:html` is not available; therefore `dart.library.html` is false and the app selects the **stub** implementations instead, which:
- call `https://belluga.app/environment?app_domain=...` (landlord default branding)
- use non-web local info sources

Result: theme colors do not match the tenant `/environment`.

## Plan
1. Replace `dart.library.html` guards with `dart.library.js_interop` for web selection.
2. Ensure the following conditional exports select web implementations for both JS and WASM:
   - `lib/infrastructure/dal/dao/laravel_backend/app_data_backend/app_data_backend.dart`
   - `lib/infrastructure/dal/dao/local/app_data_local_info_source/app_data_local_info_source.dart`
   - `lib/application/application.dart`
3. Validate by checking web logs:
   - Expect `[AppDataBackendWeb]` logs and `primary_seed_color` matching `/environment`.

## Acceptance Criteria
- On Web (JS + WASM): tenant UI colorScheme primary/secondary match `/environment.theme_data_settings`.
- `fvm flutter analyze` is clean.

