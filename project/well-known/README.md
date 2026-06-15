# Well-Known Contract Examples

These files are reference contracts only.

- They describe the payload shape expected for `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`.
- They are not the runtime source of truth for this project.
- The current Belluga Now runtime remains backend-owned and host-resolved through Laravel.

Current Belluga Now reference notes:

- Android payloads are emitted only when the project has a typed Android app identifier plus SHA-256 fingerprints.
- iOS payloads are emitted only when the project has a typed iOS bundle identifier plus `team_id` and allowed path list.
- Current project-specific iOS path families include invite/public-share routes; keep those concrete paths downstream, not as shared example defaults.
