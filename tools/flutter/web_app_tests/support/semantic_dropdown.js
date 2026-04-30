const { expect } = require('@playwright/test');

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

  const optionByRole = page.getByRole('option', { name: optionText });
  if ((await optionByRole.count()) > 0) {
    record(`select option ${optionText} via role`);
    await optionByRole.last().click();
    return;
  }

  const optionByMenuItem = page.getByRole('menuitem', { name: optionText });
  if ((await optionByMenuItem.count()) > 0) {
    record(`select option ${optionText} via menuitem`);
    await optionByMenuItem.last().click();
    return;
  }

  throw new Error(
    `Dropdown "${fieldLabel}" did not expose semantic option/menuitem "${optionText}".`,
  );
}

module.exports = {
  selectDropdownOption,
};
