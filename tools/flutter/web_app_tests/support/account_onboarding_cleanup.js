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

async function accountStillExists(api, baseUrl, token, accountSlug) {
  const response = await api.get(
    buildUrl(baseUrl, `/admin/api/v1/accounts/${encodeURIComponent(accountSlug)}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
      timeout: 15000,
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

async function cleanupOnboardedAccount(
  api,
  baseUrl,
  token,
  accountSlug,
  {
    strict = true,
    maxAttempts = Number(process.env.NAV_ACCOUNT_CLEANUP_MAX_ATTEMPTS || 5),
    baseDelayMs = Number(process.env.NAV_ACCOUNT_CLEANUP_BASE_DELAY_MS || 500),
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

  for (let attempt = 1; attempt <= boundedAttempts; attempt += 1) {
    const response = await api.delete(
      buildUrl(baseUrl, `/admin/api/v1/accounts/${encodeURIComponent(slug)}`),
      {
        headers: authHeaders(token),
        failOnStatusCode: false,
        timeout: 15000,
      },
    );
    const status = response.status();
    if (status === 404) {
      return;
    }
    if (status < 200 || status >= 300) {
      console.warn(
        `[cleanupOnboardedAccount] delete attempt ${attempt} for ${slug} returned HTTP ${status}.`,
      );
    }

    if (!(await accountStillExists(api, baseUrl, token, slug))) {
      return;
    }

    await sleep(boundedBaseDelayMs * attempt);
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
  const errors = [];
  for (const accountSlug of accountSlugs || []) {
    try {
      await cleanupOnboardedAccount(api, baseUrl, token, accountSlug, options);
    } catch (error) {
      errors.push(error);
    }
  }

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

module.exports = {
  cleanupOnboardedAccount,
  cleanupOnboardedAccounts,
  runCleanupPreservingPrimaryError,
};
