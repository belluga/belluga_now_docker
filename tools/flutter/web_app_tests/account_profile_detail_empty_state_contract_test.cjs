#!/usr/bin/env node

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFavoritableProfileTypes,
  buildMinimalEmptyStateExpectation,
  isMinimalNoSections,
  selectMinimalEmptyStateCandidate,
} = require('./support/account_profile_detail_empty_state_contract');

test('selectMinimalEmptyStateCandidate prefers a favoritable minimal profile over a generic one', async () => {
  const rows = [
    { slug: 'orla-de-meaipe' },
    { slug: 'ananda-torres' },
  ];
  const hydrated = new Map([
    ['orla-de-meaipe', {
      slug: 'orla-de-meaipe',
      name: 'Orla de Meaípe',
      type: 'local-publico',
      agenda_occurrences: [],
      nested_profile_groups: [],
    }],
    ['ananda-torres', {
      slug: 'ananda-torres',
      name: 'Ananda Torres',
      type: 'artist',
      agenda_occurrences: [],
      nested_profile_groups: [],
    }],
  ]);
  const favoritableTypes = buildFavoritableProfileTypes([
    { type: 'local-publico', capabilities: { is_favoritable: false } },
    { type: 'artist', capabilities: { is_favoritable: true } },
  ]);

  const candidate = await selectMinimalEmptyStateCandidate(
    rows,
    async (row) => hydrated.get(row.slug),
    favoritableTypes,
  );

  assert.deepStrictEqual(candidate, {
    profile: hydrated.get('ananda-torres'),
    variant: 'favorite-empty-state',
  });
  assert.deepStrictEqual(buildMinimalEmptyStateExpectation(candidate), {
    visibleLabel: 'Favorite para ser avisado das novidades sobre Ananda Torres.',
    hiddenLabel: 'Mais sobre este perfil',
    assertionLabel: 'Account Profile favorite empty state',
  });
});

test('selectMinimalEmptyStateCandidate falls back to a generic empty state when no favoritable minimal profile exists', async () => {
  const rows = [
    { slug: 'orla-de-meaipe' },
    { slug: 'praia-do-morro' },
  ];
  const hydrated = new Map([
    ['orla-de-meaipe', {
      slug: 'orla-de-meaipe',
      name: 'Orla de Meaípe',
      type: 'local-publico',
      agenda_occurrences: [],
      nested_profile_groups: [],
    }],
    ['praia-do-morro', {
      slug: 'praia-do-morro',
      name: 'Praia do Morro',
      type: 'local-publico',
      agenda_occurrences: [],
      nested_profile_groups: [],
    }],
  ]);
  const favoritableTypes = buildFavoritableProfileTypes([
    { type: 'local-publico', capabilities: { is_favoritable: false } },
  ]);

  const candidate = await selectMinimalEmptyStateCandidate(
    rows,
    async (row) => hydrated.get(row.slug),
    favoritableTypes,
  );

  assert.deepStrictEqual(candidate, {
    profile: hydrated.get('orla-de-meaipe'),
    variant: 'generic-empty-state',
  });
  assert.deepStrictEqual(buildMinimalEmptyStateExpectation(candidate), {
    visibleLabel: 'Mais sobre este perfil',
    hiddenLabel: 'Favorite para ser avisado das novidades sobre Orla de Meaípe.',
    assertionLabel: 'Account Profile generic empty state',
  });
});

test('isMinimalNoSections rejects profiles that publish extra sections', () => {
  assert.equal(
    isMinimalNoSections({
      name: 'Com bio',
      type: 'artist',
      bio: 'Publicado',
      agenda_occurrences: [],
      nested_profile_groups: [],
    }),
    false,
  );
  assert.equal(
    isMinimalNoSections({
      name: 'Sem secoes',
      type: 'artist',
      agenda_occurrences: [],
      nested_profile_groups: [],
    }),
    true,
  );
});
