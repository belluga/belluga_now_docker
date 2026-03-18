const { expect } = require('@playwright/test');

const tenantUrl = process.env.NAV_TENANT_URL;
const secret = process.env.STAGE_INVITE_TEST_SUPPORT_SECRET;

function requireStageInviteSupportConfig() {
  expect(
    tenantUrl,
    'Missing NAV_TENANT_URL. Stage invite support requires the live tenant URL.',
  ).toBeTruthy();
  expect(
    secret,
    'Missing STAGE_INVITE_TEST_SUPPORT_SECRET. Stage invite support requires the stage test-support secret.',
  ).toBeTruthy();

  return {
    tenantUrl,
    secret,
  };
}

async function bootstrapInviteFixture(request, scenario) {
  const { tenantUrl, secret } = requireStageInviteSupportConfig();
  const runId = `playwright-${Date.now()}-${scenario.replaceAll('_', '-')}`;
  const endpoint = new URL('/api/v1/test-support/invites/bootstrap', tenantUrl).toString();
  const response = await request.post(endpoint, {
    failOnStatusCode: false,
    headers: {
      Accept: 'application/json',
      'X-Test-Support-Key': secret,
    },
    data: {
      run_id: runId,
      scenario,
    },
  });

  expect(response.status(), `Fixture bootstrap must succeed: ${endpoint}`).toBe(200);
  const payload = await response.json();
  return {
    runId: payload.run_id || runId,
    shareCode: payload.share_code || '',
    inviteUrl: payload.invite_url || '',
    eventId: payload.event_id || '',
    payload,
  };
}

async function cleanupInviteFixture(request, runId) {
  if (!runId) {
    return;
  }

  const { tenantUrl, secret } = requireStageInviteSupportConfig();
  const endpoint = new URL('/api/v1/test-support/invites/cleanup', tenantUrl).toString();
  const response = await request.post(endpoint, {
    failOnStatusCode: false,
    headers: {
      Accept: 'application/json',
      'X-Test-Support-Key': secret,
    },
    data: {
      run_id: runId,
    },
  });

  expect(response.status(), `Fixture cleanup must succeed: ${endpoint}`).toBe(200);
}

module.exports = {
  bootstrapInviteFixture,
  cleanupInviteFixture,
  requireStageInviteSupportConfig,
};
