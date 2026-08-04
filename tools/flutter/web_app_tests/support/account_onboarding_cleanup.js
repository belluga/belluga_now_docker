function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function accountStillExists(
  api,
  baseUrl,
  token,
  accountSlug,
  { requestTimeoutMs = 30000 } = {},
) {
  const response = await api.get(
    buildUrl(baseUrl, `/admin/api/v1/accounts/${encodeURIComponent(accountSlug)}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: requestTimeoutMs,
    },
  );

  const status = response.status();
  if (status === 404) {
    return false;
  }
  if (status >= 200 && status < 300) {
    return true;
  }
  throw new Error(
    `[cleanupOnboardedAccount] probe for ${accountSlug} returned HTTP ${status}.`,
  );
}

async function normalizeLegacyOwnedAccountForCleanup(
  api,
  baseUrl,
  token,
  accountSlug,
  { requestTimeoutMs = 30000 } = {},
) {
  const response = await api.patch(
    buildUrl(baseUrl, `/admin/api/v1/accounts/${encodeURIComponent(accountSlug)}`),
    {
      headers: authHeaders(token),
      data: {
        ownership_state: 'unmanaged',
      },
      failOnStatusCode: false,
      timeout: requestTimeoutMs,
    },
  );

  const status = response.status();
  if (status >= 200 && status < 300) {
    console.warn(
      `[cleanupOnboardedAccount] normalized legacy ownership_state to unmanaged for ${accountSlug}.`,
    );
    return true;
  }

  if (status !== 404) {
    console.warn(
      `[cleanupOnboardedAccount] legacy ownership normalization for ${accountSlug} returned HTTP ${status}.`,
    );
  }

  return false;
}

async function deleteAccount(
  api,
  baseUrl,
  token,
  accountSlug,
  { requestTimeoutMs = 30000 } = {},
) {
  return api.delete(
    buildUrl(baseUrl, `/admin/api/v1/accounts/${encodeURIComponent(accountSlug)}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: requestTimeoutMs,
    },
  );
}

async function forceDeleteAccount(
  api,
  baseUrl,
  token,
  accountSlug,
  { requestTimeoutMs = 30000 } = {},
) {
  const url = buildUrl(
    baseUrl,
    `/admin/api/v1/accounts/${encodeURIComponent(accountSlug)}/force_delete`,
  );
  const requestOptions = {
    headers: authHeaders(token),
    failOnStatusCode: false,
    timeout: requestTimeoutMs,
  };

  if (typeof api.post === 'function') {
    return api.post(url, requestOptions);
  }

  return api.delete(url, requestOptions);
}

async function cleanupOnboardedAccount(
  api,
  baseUrl,
  token,
  accountSlug,
  {
    strict = true,
    maxAttempts = Number(process.env.NAV_ACCOUNT_CLEANUP_MAX_ATTEMPTS || 5),
    baseDelayMs = Number(process.env.NAV_ACCOUNT_CLEANUP_BASE_DELAY_MS || 500),
    requestTimeoutMs = Number(
      process.env.NAV_ACCOUNT_CLEANUP_REQUEST_TIMEOUT_MS || 30000,
    ),
  } = {},
) {
  const slug = accountSlug?.toString().trim();
  if (!slug) {
    const message = 'Cleanup requires a canonical account slug.';
    if (strict) {
      throw new Error(message);
    }
    console.warn(`[cleanupOnboardedAccount] ${message}`);
    return false;
  }

  const boundedAttempts = Number.isFinite(maxAttempts) && maxAttempts > 0
    ? Math.floor(maxAttempts)
    : 5;
  const boundedBaseDelayMs = Number.isFinite(baseDelayMs) && baseDelayMs >= 0
    ? Math.floor(baseDelayMs)
    : 500;
  const boundedRequestTimeoutMs =
    Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? Math.floor(requestTimeoutMs)
      : 30000;
  let lastProbeError = null;
  let confirmedStillExists = false;
  let legacyOwnershipNormalizationAttempted = false;

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    let response;
    let usedForceDelete = false;
    try {
      usedForceDelete = typeof api.post === 'function';
      response = usedForceDelete
        ? await forceDeleteAccount(
          api,
          baseUrl,
          token,
          slug,
          {
            requestTimeoutMs: boundedRequestTimeoutMs,
          },
        )
        : await deleteAccount(
          api,
          baseUrl,
          token,
          slug,
          {
            requestTimeoutMs: boundedRequestTimeoutMs,
          },
        );
    } catch (error) {
      console.warn(
        `[cleanupOnboardedAccount] force-delete attempt ${attempt} for ${slug} threw ${error}.`,
      );
      await sleep(boundedBaseDelayMs * attempt);
      continue;
    }
    let status = response.status();
    if (status === 404 && usedForceDelete) {
      const stillExists = await accountStillExists(api, baseUrl, token, slug, {
        requestTimeoutMs: boundedRequestTimeoutMs,
      });
      if (!stillExists) {
        return;
      }
      response = await deleteAccount(
        api,
        baseUrl,
        token,
        slug,
        {
          requestTimeoutMs: boundedRequestTimeoutMs,
        },
      );
      status = response.status();
    }
    if (status === 404) {
      return;
    }
    if (status === 422 && !legacyOwnershipNormalizationAttempted) {
      legacyOwnershipNormalizationAttempted = true;
      const normalized = await normalizeLegacyOwnedAccountForCleanup(
        api,
        baseUrl,
        token,
        slug,
        {
          requestTimeoutMs: boundedRequestTimeoutMs,
        },
      );
      if (normalized) {
        response = typeof api.post === 'function'
          ? await forceDeleteAccount(
            api,
            baseUrl,
            token,
            slug,
            {
              requestTimeoutMs: boundedRequestTimeoutMs,
            },
          )
          : await deleteAccount(
            api,
            baseUrl,
            token,
            slug,
            {
              requestTimeoutMs: boundedRequestTimeoutMs,
            },
          );
        status = response.status();
        if (status === 404) {
          return;
        }
      }
    }

    if (status < 200 || status >= 300) {
      console.warn(
        `[cleanupOnboardedAccount] delete/finalize attempt ${attempt} for ${slug} returned HTTP ${status}.`,
      );
    }

    let stillExists = true;
    try {
      stillExists = await accountStillExists(api, baseUrl, token, slug, {
        requestTimeoutMs: boundedRequestTimeoutMs,
      });
      lastProbeError = null;
    } catch (error) {
      lastProbeError = error;
      console.warn(
        `[cleanupOnboardedAccount] probe attempt ${attempt} for ${slug} threw ${error}.`,
      );
      await sleep(boundedBaseDelayMs * attempt);
      continue;
    }

    if (!stillExists) {
      return;
    }

    confirmedStillExists = true;
    await sleep(boundedBaseDelayMs * attempt);
  }

  if (!confirmedStillExists && lastProbeError != null) {
    throw lastProbeError;
  }

  const message = `Cleanup did not remove onboarded account ${slug}.`;
  if (strict) {
    throw new Error(message);
  }
  console.warn(`[cleanupOnboardedAccount] ${message}`);
  return false;
}

async function cleanupOnboardedAccounts(
  api,
  baseUrl,
  token,
  accountSlugs,
  options,
) {
  const uniqueAccountSlugs = [...new Set(
    (accountSlugs || [])
      .map((accountSlug) => accountSlug?.toString().trim())
      .filter(Boolean),
  )];
  const results = await Promise.allSettled(
    uniqueAccountSlugs.map((accountSlug) =>
      cleanupOnboardedAccount(api, baseUrl, token, accountSlug, options)),
  );
  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);

  if (errors.length === 0) {
    return;
  }

  if ((options?.strict ?? true) === false) {
    return false;
  }

  throw new AggregateError(
    errors,
    `Failed to clean ${errors.length} onboarded account(s).`,
  );
}

async function runCleanupPreservingPrimaryError(primaryError, cleanup) {
  let cleanupError = null;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (cleanupError == null) {
    return;
  }

  if (primaryError == null) {
    throw cleanupError;
  }

  throw new AggregateError(
    [primaryError, cleanupError],
    'Primary failure was accompanied by cleanup failure.',
  );
}

async function runCleanupSteps(steps) {
  const errors = [];

  for (const step of steps || []) {
    if (typeof step !== 'function') {
      continue;
    }

    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 0) {
    return;
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  throw new AggregateError(
    errors,
    `Failed to complete ${errors.length} cleanup step(s).`,
  );
}

module.exports = {
  cleanupOnboardedAccount,
  cleanupOnboardedAccounts,
  runCleanupPreservingPrimaryError,
  runCleanupSteps,
};
