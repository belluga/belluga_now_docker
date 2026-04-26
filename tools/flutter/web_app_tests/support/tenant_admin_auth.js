const { expect } = require('@playwright/test');

function defaultBuildUrl(baseUrl, pathName) {
  return new URL(pathName, baseUrl).toString();
}

function requireAdminCredentials() {
  const email = (process.env.NAV_ADMIN_EMAIL || '').trim();
  const password = process.env.NAV_ADMIN_PASSWORD || '';
  if (!email || !password) {
    throw new Error(
      'Missing NAV_ADMIN_EMAIL/NAV_ADMIN_PASSWORD. Mutation navigation tests must not use committed tenant-admin credential fallbacks.',
    );
  }

  return { email, password };
}

async function loginTenantAdmin({
  api,
  baseUrl,
  deviceName,
  buildUrl = defaultBuildUrl,
}) {
  const { email, password } = requireAdminCredentials();
  const loginResponse = await api.post(
    buildUrl(baseUrl, '/admin/api/v1/auth/login'),
    {
      data: {
        email,
        password,
        device_name: deviceName,
      },
    },
  );
  expect(loginResponse.status(), 'Tenant-admin login must succeed.').toBe(200);

  const loginPayload = await loginResponse.json();
  const token = loginPayload?.data?.token;
  expect(token, 'Tenant-admin login must return a bearer token.').toBeTruthy();

  const meResponse = await api.get(buildUrl(baseUrl, '/admin/api/v1/me'), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  expect(meResponse.status(), 'Tenant-admin /me must succeed after login.').toBe(
    200,
  );
  const mePayload = await meResponse.json();

  return {
    token,
    userId: mePayload?.data?.user_id?.toString() || '',
  };
}

module.exports = {
  loginTenantAdmin,
  requireAdminCredentials,
};
