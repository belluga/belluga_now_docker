const { execFileSync } = require('child_process');
const path = require('path');

function requireLocalDiagnosticContract() {
  if (process.env.NAV_WEB_TEST_TYPE !== 'diagnostic') {
    throw new Error('Local docker artisan is restricted to the diagnostic suite.');
  }
  if (process.env.NAV_DEPLOY_LANE !== 'local') {
    throw new Error('Local docker artisan is restricted to NAV_DEPLOY_LANE=local.');
  }
  if (process.env.NAV_RUNTIME_DB_MUTATION_ALLOWED !== '1') {
    throw new Error('Local docker artisan requires NAV_RUNTIME_DB_MUTATION_ALLOWED=1.');
  }

  const tenantUrl = process.env.NAV_TENANT_URL?.toString().trim();
  if (!tenantUrl) {
    throw new Error('Local docker artisan requires NAV_TENANT_URL.');
  }

  const allowedHosts = (
    process.env.NAV_DIAGNOSTIC_LOCAL_ALLOWED_TENANT_HOSTS
    || 'localhost,127.0.0.1,::1'
  )
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const tenantHost = new URL(tenantUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!allowedHosts.includes(tenantHost)) {
    throw new Error(
      `Local docker artisan refuses NAV_TENANT_URL host "${tenantHost}". Allowed: ${allowedHosts.join(', ')}`,
    );
  }
}

function executeLocalDockerArtisan(command, args = []) {
  requireLocalDiagnosticContract();
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const dockerService =
    process.env.NAV_RUNTIME_DB_MUTATION_DOCKER_SERVICE?.toString().trim() || 'app';

  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      dockerService,
      'php',
      'artisan',
      command,
      ...args.map((value) => value.toString()),
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'ignore',
      timeout: 30000,
    },
  );
}

module.exports = {
  executeLocalDockerArtisan,
};
