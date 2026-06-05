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

  return response.status() !== 404;
}

async function cleanupOnboardedAccount(api, baseUrl, token, accountSlug) {
  const slug = accountSlug?.toString().trim();
  if (!slug) {
    return;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await api.delete(
      buildUrl(baseUrl, `/admin/api/v1/accounts/${encodeURIComponent(slug)}`),
      {
        headers: authHeaders(token),
        failOnStatusCode: false,
        timeout: 15000,
      },
    );

    if (!(await accountStillExists(api, baseUrl, token, slug))) {
      return;
    }

    await sleep(500 * attempt);
  }

  throw new Error(`Cleanup did not remove onboarded account ${slug}.`);
}

async function cleanupOnboardedAccounts(api, baseUrl, token, accountSlugs) {
  for (const accountSlug of accountSlugs || []) {
    await cleanupOnboardedAccount(api, baseUrl, token, accountSlug);
  }
}

module.exports = {
  cleanupOnboardedAccount,
  cleanupOnboardedAccounts,
};
