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

  const optionByVisibleText = page.getByText(optionText, { exact: true });
  const visibleTextCount = await optionByVisibleText.count();
  for (let index = visibleTextCount - 1; index >= 0; index -= 1) {
    const candidate = optionByVisibleText.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      record(`select option ${optionText} via visible text fallback`);
      await candidate.click().catch(async () => {
        const box = await candidate.boundingBox();
        if (!box) {
          throw new Error(
            `Dropdown "${fieldLabel}" visible text fallback "${optionText}" has no bounding box.`,
          );
        }
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      });
      return;
    }
  }

  throw new Error(
    `Dropdown "${fieldLabel}" did not expose semantic option/menuitem "${optionText}".`,
  );
}

module.exports = {
  selectDropdownOption,
};
