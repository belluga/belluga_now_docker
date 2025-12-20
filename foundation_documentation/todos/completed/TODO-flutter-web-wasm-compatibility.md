# TODO (V1): Restore Flutter Web WASM compatibility (plugin + icon tree-shaking)

**Owners:** Delphi + Flutter team  
**Status:** Completed  
**Scope:** `flutter-app` (build tooling + presentation widgets)  

## Problem
Flutter Web WASM builds failed due to:
1) A web plugin importing `dart:html` (WASM-incompatible) via `platform_device_id_web`.
2) Non-constant `IconData(...)` construction triggering Flutter’s icon tree-shaker failure.

## Resolution
1) Removed `platform_device_id_plus` usage/dependency and replaced device id usage with a wasm-safe placeholder until a proper strategy is defined.
2) Reworked favorites badge rendering to avoid runtime `IconData(...)` construction; render glyphs via `Text(String.fromCharCode(...), TextStyle(fontFamily: ...))` instead.

## Validation
- `fvm flutter analyze` passes.
- `fvm flutter build web --wasm --release` succeeds.

