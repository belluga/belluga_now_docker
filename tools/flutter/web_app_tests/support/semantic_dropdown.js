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

async function waitForOption(page, optionText) {
  await expect
    .poll(async () => Boolean(await resolveOption(page, optionText)), {
      timeout: 30000,
      message: `Dropdown option "${optionText}" must become semantically visible.`,
    })
    .toBe(true);
  return resolveOption(page, optionText);
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
  const buttonTrigger = page.getByRole('button', {
    name: new RegExp(fieldLabel, 'i'),
  });
  if ((await buttonTrigger.count()) > 0) {
    record(`open dropdown ${fieldLabel}`);
    await buttonTrigger.last().click();
  } else {
    const fallbackTrigger = fallbackButtonName
      ? page.getByRole('button', { name: new RegExp(fallbackButtonName, 'i') })
      : null;
    if (fallbackTrigger && (await fallbackTrigger.count()) > 0) {
      record(`open fallback dropdown ${fallbackButtonName}`);
      await fallbackTrigger.last().click();
    } else {
      const labelTrigger = page.getByLabel(fieldLabel);
      expect(
        await labelTrigger.count(),
        `Expected a visible trigger for dropdown "${fieldLabel}".`,
      ).toBeGreaterThan(0);
      record(`open labeled dropdown ${fieldLabel}`);
      await labelTrigger.last().click();
    }
  }

  await searchDropdownOptions(page, optionText, record);
  const option = await waitForOption(page, optionText);
  record(`select option ${optionText} via ${option.strategy}`);
  await option.locator.last().click();
}

module.exports = {
  selectDropdownOption,
};
