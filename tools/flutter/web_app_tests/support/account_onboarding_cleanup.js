function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

function buildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

async function cleanupOnboardedAccount(api, baseUrl, token, accountSlug) {
  const slug = accountSlug?.toString().trim();
  if (!slug) {
    return;
  }

  await api.delete(
    buildUrl(baseUrl, `/admin/api/v1/accounts/${encodeURIComponent(slug)}`),
    {
      headers: authHeaders(token),
      failOnStatusCode: false,
    },
  );
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
