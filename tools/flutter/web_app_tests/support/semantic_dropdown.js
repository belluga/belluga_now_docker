const { expect } = require('@playwright/test');

function cssAttributeValue(value) {
  return JSON.stringify(value).replace(/'/g, "\\'");
}

function optionLocators(page, optionText) {
  return [
    {
      locator: page.getByRole('option', { name: optionText }),
      strategy: 'role',
    },
    {
      locator: page.getByRole('menuitem', { name: optionText }),
      strategy: 'menuitem',
    },
    {
      locator: page.getByRole('button', { name: optionText }),
      strategy: 'semantic button',
    },
    {
      locator: page.locator(
        `flt-semantics[aria-label=${cssAttributeValue(optionText)}]`,
      ),
      strategy: 'Flutter semantic label',
    },
    {
      locator: page.locator(
        `flt-semantics[aria-label*=${cssAttributeValue(optionText)}]`,
      ),
      strategy: 'containing Flutter semantic label',
    },
  ];
}

async function resolveOption(page, optionText) {
  for (const candidate of optionLocators(page, optionText)) {
    if ((await candidate.locator.count()) > 0) {
      return candidate;
    }
  }

  return null;
}

async function searchDropdownOptions(page, optionText, record) {
  const locationSearchField = page.getByRole('textbox', {
    name: /Buscar local/i,
  });
  const searchVisible = await locationSearchField
    .last()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!searchVisible) {
    return;
  }

  record(`filter dropdown options with search ${optionText}`);
  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  await locationSearchField.last().click();
  await page.keyboard.press(selectAll);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(optionText, { delay: 5 });
}

async function waitForDropdownSurface(page, optionText, timeout = 1500) {
  const locationSearchField = page.getByRole('textbox', {
    name: /Buscar local/i,
  });

  return expect
    .poll(
      async () =>
        Boolean(await resolveOption(page, optionText)) ||
        (await locationSearchField
          .last()
          .isVisible()
          .catch(() => false)),
      { timeout },
    )
    .toBe(true)
    .then(() => true)
    .catch(() => false);
}

async function waitForOption(page, optionText) {
  await expect
    .poll(async () => Boolean(await resolveOption(page, optionText)), {
      timeout: 30000,
      message: `Dropdown option "${optionText}" must become semantically visible.`,
    })
    .toBe(true);
  return resolveOption(page, optionText);
}

async function clickFirstVisible(locator) {
  const count = await locator.count();
  let visibleLocator = null;

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const isVisible = await candidate.isVisible().catch(() => false);
    const isEnabled = await candidate.isEnabled().catch(() => false);
    if (isVisible && isEnabled) {
      visibleLocator = candidate;
      break;
    }
  }

  if (!visibleLocator) {
    return false;
  }

  await visibleLocator.click({ timeout: 1500 });
  return true;
}

async function selectDropdownOption(
  page,
  {
    flow = null,
    fieldLabel,
    optionText,
    fallbackButtonName = null,
    logStep = null,
  },
) {
  const record = (message) => {
    if (typeof logStep === 'function') {
      logStep(flow, message);
    }
  };

  const triggerCandidates = [
    {
      locator: page.getByRole('button', {
        name: new RegExp(fieldLabel, 'i'),
      }),
      description: `dropdown ${fieldLabel}`,
    },
    ...(fallbackButtonName
      ? [
          {
            locator: page.getByRole('button', {
              name: new RegExp(fallbackButtonName, 'i'),
            }),
            description: `fallback dropdown ${fallbackButtonName}`,
          },
        ]
      : []),
    {
      locator: page.getByLabel(fieldLabel),
      description: `labeled dropdown ${fieldLabel}`,
    },
  ];

  let openAttempted = false;
  let surfaceOpened = false;
  const failedTriggerDescriptions = new Set();
  const openDeadline = Date.now() + 15000;

  while (!surfaceOpened && Date.now() < openDeadline) {
    for (const trigger of triggerCandidates) {
      if ((await trigger.locator.count()) <= 0) {
        continue;
      }

      openAttempted = true;
      record(`open ${trigger.description}`);
      const clicked = await clickFirstVisible(trigger.locator);
      if (!clicked) {
        continue;
      }
      surfaceOpened = await waitForDropdownSurface(page, optionText);
      if (surfaceOpened) {
        break;
      }
      if (!failedTriggerDescriptions.has(trigger.description)) {
        record(`trigger ${trigger.description} did not expose dropdown surface`);
        failedTriggerDescriptions.add(trigger.description);
      }
    }
    if (!surfaceOpened) {
      await page.waitForTimeout(300);
    }
  }

  expect(
    openAttempted,
    `Expected a visible trigger for dropdown "${fieldLabel}".`,
  ).toBe(true);
  expect(
    surfaceOpened,
    `Dropdown "${fieldLabel}" must expose a selectable surface before choosing "${optionText}".`,
  ).toBe(true);

  await searchDropdownOptions(page, optionText, record);
  const option = await waitForOption(page, optionText);
  record(`select option ${optionText} via ${option.strategy}`);
  await option.locator.last().click();
}

module.exports = {
  selectDropdownOption,
};
