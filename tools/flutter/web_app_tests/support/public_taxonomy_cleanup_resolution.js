function readCanonicalAccountSlugFromProfileDetail(detail) {
  return (
    detail?.account_slug?.toString().trim()
    || detail?.account?.slug?.toString().trim()
    || detail?.account_profile?.account_slug?.toString().trim()
    || detail?.account_profile?.account?.slug?.toString().trim()
    || ''
  );
}

function readCanonicalAccountSlugFromAccountRow(row) {
  return (
    row?.slug?.toString().trim()
    || row?.account?.slug?.toString().trim()
    || ''
  );
}

function readAccountIdFromProfileRecord(record) {
  return (
    record?.account_id?.toString().trim()
    || record?.account?.id?.toString().trim()
    || record?.account_profile?.account_id?.toString().trim()
    || record?.account_profile?.account?.id?.toString().trim()
    || ''
  );
}

function buildAccountSlugIndexById(accountRows) {
  const accountSlugById = new Map();
  for (const row of accountRows || []) {
    const accountId = row?.id?.toString().trim() || row?.account?.id?.toString().trim() || '';
    const accountSlug = readCanonicalAccountSlugFromAccountRow(row);
    if (accountId && accountSlug) {
      accountSlugById.set(accountId, accountSlug);
    }
  }
  return accountSlugById;
}

function resolveAccountSlugFromIndexByProfileRecord(accountSlugById, record) {
  const accountId = readAccountIdFromProfileRecord(record);
  if (!accountId) {
    return '';
  }
  return accountSlugById.get(accountId)?.toString().trim() || '';
}

module.exports = {
  buildAccountSlugIndexById,
  readAccountIdFromProfileRecord,
  readCanonicalAccountSlugFromAccountRow,
  readCanonicalAccountSlugFromProfileDetail,
  resolveAccountSlugFromIndexByProfileRecord,
};
