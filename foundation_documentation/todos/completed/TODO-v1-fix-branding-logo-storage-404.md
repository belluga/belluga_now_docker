# TODO (V1): Fix branding logo `/storage/*` returning 404

**Status:** Completed  
**Owner:** Delphi + Backend/DevOps  
**Goal:** Ensure uploaded branding assets (logos/favicon/PWA icons) served via `/storage/...` URLs resolve successfully (no false 404s) in both local and production NGINX configs.

---

## Context
- Branding uploads are stored on Laravel `public` disk and URLs are returned like: `https://<domain>/storage/landlord/logos/light_logo.png`.
- NGINX currently serves `/storage/` using `alias /var/www/storage/app/public/;` plus `try_files $uri ... =404;`.
- With `alias`, using `try_files $uri` is error-prone because `$uri` still contains the `/storage/...` prefix, which can cause NGINX to test an incorrect filesystem path and return `404` even when the file exists under the aliased directory.

---

## Scope
- Update NGINX `/storage/` location in:
  - `docker/nginx/local.conf.template`
  - `docker/nginx/prod.conf.template`
- Ensure `/storage/*` maps to `/var/www/storage/app/public/*` correctly and returns `404` only when the file truly does not exist.

## Out of Scope
- Changing how Laravel stores branding assets (paths/names/extensions).
- Adding new branding endpoints or changing API payload structure.
- Implementing CDN or signed URLs.

---

## Decisions
- Prefer `try_files $request_filename =404;` inside the `/storage/` `alias` location (or remove `try_files` if unnecessary) to ensure the existence check is performed against the resolved aliased filesystem path.
- Keep caching headers behavior unchanged unless it blocks correctness.

---

## Definition of Done
- Requests to known existing assets (e.g. `/storage/landlord/logos/light_logo.png`, `/storage/landlord/logos/dark_logo.png`, `/storage/landlord/logos/favicon.ico`) return `200` and correct content type.
- Requests to non-existent assets under `/storage/` return `404`.
- Works in both local and production NGINX templates.
- Branding “shortcut” routes also resolve (served by Laravel controller, not static):
  - `/logo-light.png`, `/logo-dark.png`
  - `/icon-light.png`, `/icon-dark.png`

---

## Validation Steps
- Regenerate NGINX config (start/restart stack) and verify:
  - `curl -I https://<domain>/storage/landlord/logos/light_logo.png` returns `200`
  - `curl -I https://<domain>/storage/landlord/logos/favicon.ico` returns `200`
  - `curl -I https://<domain>/storage/landlord/logos/does-not-exist.png` returns `404`
  - `curl -I https://<domain>/logo-light.png` returns `200` (or `302` to a working asset), not `404`
  - `curl -I https://<domain>/logo-dark.png` returns `200` (or `302` to a working asset), not `404`
  - `curl -I https://<domain>/icon-light.png` returns `200` (or `302` to a working asset), not `404`
  - `curl -I https://<domain>/icon-dark.png` returns `200` (or `302` to a working asset), not `404`
- Confirm the file exists on disk in the running container:
  - `ls -la /var/www/storage/app/public/landlord/logos/`
- (Optional) Check NGINX logs for `/storage/` requests to confirm no unexpected rewrites.

---

## Notes / Risk
- If production is behind an additional proxy/CDN, ensure it does not cache the prior 404s (may need cache purge or cache-busting URL versioning).

---

## Outcome Notes
- Fixed NGINX `/storage/` alias existence check by switching to `try_files $request_filename =404;` in both templates.
- Confirmed tenant asset 404s were also caused by missing files on disk (upload not actually persisted); re-uploading tenant assets resolved.
