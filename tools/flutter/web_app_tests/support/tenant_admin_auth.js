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

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function loginTenantAdmin({
  api,
  baseUrl,
  deviceName,
  buildUrl = defaultBuildUrl,
}) {
  const { email, password } = requireAdminCredentials();
  const loginUrl = buildUrl(baseUrl, '/admin/api/v1/auth/login');
  const loginPayload = {
    email,
    password,
    device_name: deviceName,
  };
  let loginResponse = null;
  let lastRejectedBody = '';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    loginResponse = await api.post(loginUrl, {
      data: {
        ...loginPayload,
        device_name: attempt === 0
          ? loginPayload.device_name
          : `${loginPayload.device_name}-retry-${attempt}`,
      },
    });

    if (loginResponse.status() === 200) {
      break;
    }

    lastRejectedBody = await loginResponse.text().catch(() => '');
    if (![403, 408, 429, 500, 502, 503, 504].includes(loginResponse.status())) {
      break;
    }

    await delay(1000 * (attempt + 1));
  }

  expect(
    loginResponse.status(),
    `Tenant-admin login must succeed. Last rejected body: ${lastRejectedBody.slice(
      0,
      300,
    )}`,
  ).toBe(200);

  const loginBody = await loginResponse.json();
  const token = loginBody?.data?.token;
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
