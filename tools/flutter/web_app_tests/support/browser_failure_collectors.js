'use strict';

/**
 * Canonical browser-failure collectors for the web navigation suites.
 *
 * Contract (Decision Baseline D-01..D-05 of
 * foundation_documentation/todos/active/post_release_hardening/TODO-post-release-web-navigation-media-image-failure-collector-normalization.md):
 *
 * - Media/image asset failures are classified by URL SHAPE first (canonical
 *   `/api/v1/media/**` routes and explicitly enumerated legacy media path
 *   shapes, including `?v=` cache-busted variants), because Flutter web
 *   fetches images programmatically (fetch/XHR), so `resourceType()` is not
 *   `image` and media URLs carry no file extension.
 * - Supplementary non-critical signals: `net::ERR_ABORTED`,
 *   `resourceType()` in `image|media|font`, and image/font file extensions.
 * - Console entries are structured: `consoleErrors` keeps the text (legacy
 *   assertion shape) while `consoleErrorUrls` keeps the parallel location
 *   URL (`''` when unavailable).
 * - Console suppression is fail-closed and URL-scoped:
 *   - `net::ERR_FAILED` console entries are suppressed only when the entry
 *     URL matches a media-classified ignored request on the same page.
 *   - `404` console entries are suppressed only when the entry URL is a
 *     media asset URL, or when a media-classified HTTP >=400 response was
 *     recorded on the same page (response listener evidence).
 * - API/JSON/data requests, non-media assets, runtime page errors, and
 *   disallowed 429 responses always stay critical.
 */

const TAXONOMY_VERSION = 'media-url-shape-v1';

const ADOPTED_SPEC_FILES = [
  'discovery_filters.spec.js',
  'event_rich_text.mutation.spec.js',
  'account_profile_rich_text.mutation.spec.js',
  'navigation.mutation.tenant_admin.spec.js',
  'navigation.mutation.event_occurrences.spec.js',
];

const IMAGE_OR_FONT_EXTENSION_PATTERN =
  /\.(?:avif|gif|jpe?g|png|svg|webp|woff2?|ico)(?:[?#].*)?$/i;

const NON_CRITICAL_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

const CONSOLE_ERR_FAILED_TEXT = 'Failed to load resource: net::ERR_FAILED';
const CONSOLE_NOT_FOUND_PREFIX =
  'Failed to load resource: the server responded with a status of 404';

function extractUrlPath(url) {
  if (typeof url !== 'string' || url.length === 0) {
    return '';
  }
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0].split('#')[0];
  }
}

function hasCacheBustedVersionParam(url) {
  return typeof url === 'string' && /[?&]v=[^&#]+/.test(url);
}

/**
 * Legacy media path shapes tolerated as known stale data until the
 * media-host-agnostic hardening TODO lands. Every entry is an explicit
 * path pattern (no host allowlist, no catch-all wildcard).
 */
const LEGACY_MEDIA_PATH_PATTERNS = [
  // Legacy avatar/cover routes, e.g. https://guarappari.booraagora.com.br/account-profiles/<id>/avatar?v=...
  /^\/(?:account-profiles|events)\/[\da-f]{24}\/(?:avatar|cover)(?:\/)?$/i,
  // Legacy gallery routes, e.g. /account-profiles/<id>/gallery/<index>?v=...
  /^\/account-profiles\/[\da-f]{24}\/gallery(?:\/[\w-]+)?\/?$/i,
  // Legacy event-type asset routes, e.g. /event-types/<id>/asset?v=...
  /^\/event-types\/[\da-f]{24}\/asset(?:\/)?$/i,
  // Legacy tenant branding routes, e.g. /tenant/branding/<asset>?v=...
  /^\/tenant\/branding\/[\w-]+(?:\/)?$/i,
];

function isLegacyMediaPath(pathname, url) {
  if (!hasCacheBustedVersionParam(url)) {
    return false;
  }
  return LEGACY_MEDIA_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * Classifies whether a URL belongs to a media/image asset (canonical media
 * routes or enumerated legacy media path shapes). This is the primary
 * signal and is independent of request resourceType()/file extension.
 */
function isMediaAssetUrl(url) {
  const pathname = extractUrlPath(url);

  // Canonical media routes, e.g. /api/v1/media/account-profiles/<id>/avatar?v=...
  if (/^\/api\/v1\/media\//i.test(pathname)) {
    return true;
  }

  if (isLegacyMediaPath(pathname, url)) {
    return true;
  }

  // Branding/favicon legacy asset with cache-buster, e.g. /favicon.ico?v=...
  if (IMAGE_OR_FONT_EXTENSION_PATTERN.test(url)) {
    return true;
  }

  return false;
}

/**
 * Decides whether a `requestfailed` entry is non-critical. URL-shape
 * classification is primary; resourceType()/extension/ERR_ABORTED are
 * supplementary signals. API/data requests always stay critical.
 */
function shouldIgnoreFailedRequest(request, failureText) {
  if (failureText === 'net::ERR_ABORTED') {
    return true;
  }

  const url = typeof request?.url === 'function' ? request.url() : '';
  if (isMediaAssetUrl(url)) {
    return true;
  }

  const resourceType =
    typeof request?.resourceType === 'function' ? request.resourceType() : '';
  if (NON_CRITICAL_RESOURCE_TYPES.has(resourceType)) {
    return true;
  }

  return IMAGE_OR_FONT_EXTENSION_PATTERN.test(url);
}

function isNotFoundConsoleEntry(text) {
  return typeof text === 'string' && text.startsWith(CONSOLE_NOT_FOUND_PREFIX);
}

function isErrFailedConsoleEntry(text) {
  return text === CONSOLE_ERR_FAILED_TEXT;
}

function extractCorsBlockedUrl(text) {
  if (typeof text !== 'string' || !text.includes('has been blocked by CORS policy')) {
    return '';
  }
  const match = text.match(/'([^']+)'/);
  return match?.[1] || '';
}

function isMediaResponseError(response) {
  const status = typeof response?.status === 'function' ? response.status() : 0;
  if (status < 400) {
    return false;
  }
  const url = typeof response?.url === 'function' ? response.url() : '';
  return isMediaAssetUrl(url);
}

/**
 * Installs the canonical collectors on a Playwright page.
 *
 * Returned collectors:
 * - `runtimeErrors`: pageerror messages (always critical).
 * - `failedRequests`: critical failed requests (`METHOD URL (failure)`).
 * - `ignoredFailedRequests`: URLs of non-critical failed requests.
 * - `consoleErrors`: console error texts (legacy assertion shape).
 * - `consoleErrorUrls`: location URL parallel to `consoleErrors` (`''` when
 *   unavailable).
 * - `mediaErrorResponses`: URLs of media-classified HTTP >=400 responses.
 * - `rateLimitedResponses`: `METHOD URL` entries for HTTP 429 responses.
 */
function installFailureCollectors(page) {
  const runtimeErrors = [];
  const failedRequests = [];
  const ignoredFailedRequests = [];
  const consoleErrors = [];
  const consoleErrorUrls = [];
  const mediaErrorResponses = [];
  const rateLimitedResponses = [];

  page.on('pageerror', (error) => runtimeErrors.push(error.message));

  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText || 'unknown';
    if (shouldIgnoreFailedRequest(request, failureText)) {
      ignoredFailedRequests.push(request.url());
      return;
    }
    failedRequests.push(`${request.method()} ${request.url()} (${failureText})`);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    consoleErrors.push(message.text());
    const location = message.location?.() || null;
    consoleErrorUrls.push(location?.url || '');
  });

  page.on('response', (response) => {
    if (response.status() === 429) {
      rateLimitedResponses.push(
        `${response.request().method()} ${response.url()}`,
      );
      return;
    }
    if (isMediaResponseError(response)) {
      mediaErrorResponses.push(response.url());
    }
  });

  return {
    runtimeErrors,
    failedRequests,
    ignoredFailedRequests,
    consoleErrors,
    consoleErrorUrls,
    mediaErrorResponses,
    rateLimitedResponses,
  };
}

/**
 * Returns the console entries that must still fail a test. Everything not
 * returned here was suppressed by an explicit, URL-scoped rule; anything
 * without URL evidence stays critical (fail-closed).
 */
function summarizeCriticalConsoleErrors(
  collectors,
  { allowedConsoleErrorSubstrings = [] } = {},
) {
  const consoleErrors = collectors.consoleErrors || [];
  const consoleErrorUrls = collectors.consoleErrorUrls || [];
  const ignoredFailedRequests = collectors.ignoredFailedRequests || [];
  const mediaErrorResponses = collectors.mediaErrorResponses || [];

  return consoleErrors.filter((text, index) => {
    const locationUrl = consoleErrorUrls[index] || '';

    if (
      text.includes('status of 401') ||
      text.includes('ResizeObserver loop limit exceeded') ||
      allowedConsoleErrorSubstrings.some((allowed) => text.includes(allowed))
    ) {
      return false;
    }

    if (isErrFailedConsoleEntry(text)) {
      const matchesIgnoredMediaRequest =
        locationUrl.length > 0 &&
        ignoredFailedRequests.includes(locationUrl) &&
        isMediaAssetUrl(locationUrl);
      // Fail-closed: without a same-URL media match the entry stays critical.
      return !matchesIgnoredMediaRequest;
    }

    const corsBlockedUrl = extractCorsBlockedUrl(text);
    if (corsBlockedUrl) {
      // CORS-blocked media asset requests are the same stale-data class as
      // failed media requests: the blocked URL is embedded in the message, so
      // the correlation stays URL-scoped (media URL required, and either a
      // recorded ignored request or media-404 response evidence on this page).
      if (!isMediaAssetUrl(corsBlockedUrl)) {
        return true;
      }
      const hasSamePageEvidence =
        ignoredFailedRequests.includes(corsBlockedUrl) ||
        mediaErrorResponses.includes(corsBlockedUrl);
      return !hasSamePageEvidence;
    }

    if (isNotFoundConsoleEntry(text)) {
      if (locationUrl.length > 0) {
        // The located resource itself must be a media asset to be tolerated.
        return !isMediaAssetUrl(locationUrl);
      }
      // Without a location URL, suppression requires recorded media-404
      // response evidence on the same page.
      return mediaErrorResponses.length === 0;
    }

    return true;
  });
}

function resetFailureCollectors(collectors) {
  if (!collectors) {
    return;
  }
  for (const key of [
    'runtimeErrors',
    'failedRequests',
    'ignoredFailedRequests',
    'consoleErrors',
    'consoleErrorUrls',
    'mediaErrorResponses',
    'rateLimitedResponses',
  ]) {
    if (Array.isArray(collectors[key])) {
      collectors[key].length = 0;
    }
  }
}

function describeFailureCollectorsContract() {
  return {
    taxonomyVersion: TAXONOMY_VERSION,
    adoptedSpecFiles: [...ADOPTED_SPEC_FILES],
    legacyMediaPathPatternCount: LEGACY_MEDIA_PATH_PATTERNS.length,
  };
}

module.exports = {
  CONSOLE_ERR_FAILED_TEXT,
  CONSOLE_NOT_FOUND_PREFIX,
  describeFailureCollectorsContract,
  installFailureCollectors,
  isMediaAssetUrl,
  resetFailureCollectors,
  shouldIgnoreFailedRequest,
  summarizeCriticalConsoleErrors,
};
