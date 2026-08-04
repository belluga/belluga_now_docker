const { expect } = require('@playwright/test');

function cssAttributeValue(value) {
  return JSON.stringify(value).replace(/'/g, "\\'");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFieldPrefixRegex(value) {
  return new RegExp(`^${escapeRegExp(value)}(?:\\b|\\n)`, 'i');
}

function optionLocators(page, optionText) {
  return [
    {
      locator: page.getByText(optionText, { exact: true }),
      strategy: 'exact text',
    },
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

function dropdownSurfaceLocators(page) {
  return [
    page.getByRole('menuitem'),
    page.getByRole('option'),
    page.locator('flt-semantics[role="menuitem"]'),
    page.locator('flt-semantics[role="option"]'),
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

async function hasVisibleDropdownSurface(page) {
  for (const locator of dropdownSurfaceLocators(page)) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const isVisible = await candidate.isVisible().catch(() => false);
      if (isVisible) {
        return true;
      }
    }
  }

  return false;
}

async function scrollDropdownSurface(page) {
  return page.evaluate(() => {
    const selector =
      'flt-semantics[role="menuitem"], flt-semantics[role="option"], [role="menuitem"], [role="option"]';
    const candidates = Array.from(document.querySelectorAll(selector));
    const visibleCandidate = candidates.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    });
    if (!visibleCandidate) {
      return false;
    }

    let current = visibleCandidate.parentElement;
    while (current) {
      const canScroll = current.scrollHeight - current.clientHeight > 4;
      if (canScroll) {
        const maxScrollTop = current.scrollHeight - current.clientHeight;
        if (current.scrollTop >= maxScrollTop - 4) {
          return false;
        }

        current.scrollTop = Math.min(
          maxScrollTop,
          current.scrollTop + Math.max(80, Math.floor(current.clientHeight * 0.75)),
        );
        current.dispatchEvent(new Event('scroll', { bubbles: true }));
        return true;
      }
      current = current.parentElement;
    }

    return false;
  });
}

async function revealDropdownOption(page, optionText, record) {
  if (await resolveOption(page, optionText)) {
    return true;
  }

  await searchDropdownOptions(page, optionText, record);
  if (await resolveOption(page, optionText)) {
    return true;
  }

  for (let index = 0; index < 24; index += 1) {
    const scrolled = await scrollDropdownSurface(page);
    if (!scrolled) {
      break;
    }
    await page.waitForTimeout(100);
    if (await resolveOption(page, optionText)) {
      return true;
    }
  }

  return Boolean(await resolveOption(page, optionText));
}

async function waitForDropdownSurface(page, optionText, timeout = 3000) {
  const locationSearchField = page.getByRole('textbox', {
    name: /Buscar local/i,
  });

  return expect
    .poll(
      async () =>
        Boolean(await resolveOption(page, optionText)) ||
        (await hasVisibleDropdownSurface(page)) ||
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

async function clickFirstVisible(locator, clickOptions = {}) {
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

  // Flutter semantic overlays can momentarily block pointer delivery even
  // after the intended menuitem is visible and enabled.
  const clickAttempts = [
    { timeout: 1500 },
    { timeout: 3000 },
    { timeout: 3000, force: true },
  ];
  let lastError = null;

  for (const attempt of clickAttempts) {
    try {
      await visibleLocator.scrollIntoViewIfNeeded().catch(() => {});
      await visibleLocator.click({
        ...clickOptions,
        ...attempt,
        force: attempt.force || clickOptions.force,
      });
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function focusFirstVisible(locator) {
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const isVisible = await candidate.isVisible().catch(() => false);
    const isEnabled = await candidate.isEnabled().catch(() => false);
    if (!isVisible || !isEnabled) {
      continue;
    }

    await candidate.scrollIntoViewIfNeeded().catch(() => {});
    await candidate.focus().catch(() => {});
    return true;
  }

  return false;
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
      locator: page.getByLabel(fieldLabel),
      description: `labeled dropdown ${fieldLabel}`,
    },
    {
      locator: page.getByRole('combobox', {
        name: new RegExp(fieldLabel, 'i'),
      }),
      description: `combobox ${fieldLabel}`,
    },
    {
      locator: page.getByRole('button', {
        name: buildFieldPrefixRegex(fieldLabel),
      }),
      description: `dropdown ${fieldLabel}`,
    },
    ...(fallbackButtonName
      ? [
          {
            locator: page.getByRole('button', {
              name: buildFieldPrefixRegex(fallbackButtonName),
            }),
            description: `fallback dropdown ${fallbackButtonName}`,
          },
        ]
      : []),
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
      const clicked = await clickFirstVisible(trigger.locator, {
        noWaitAfter: true,
      });
      if (!clicked) {
        continue;
      }
      record(`clicked ${trigger.description}`);
      surfaceOpened = await waitForDropdownSurface(page, optionText);
      if (surfaceOpened) {
        record(`dropdown surface visible for ${fieldLabel}`);
        break;
      }
      if (await focusFirstVisible(trigger.locator)) {
        for (const key of ['Enter', 'ArrowDown']) {
          record(`keyboard open ${trigger.description} via ${key}`);
          await page.keyboard.press(key).catch(() => {});
          surfaceOpened = await waitForDropdownSurface(page, optionText, 1500);
          if (surfaceOpened) {
            record(`dropdown surface visible for ${fieldLabel} via ${key}`);
            break;
          }
        }
        if (surfaceOpened) {
          break;
        }
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

  await revealDropdownOption(page, optionText, record);
  record(`wait for option ${optionText}`);
  const option = await waitForOption(page, optionText);
  record(`resolved option ${optionText} via ${option.strategy}`);
  record(`select option ${optionText} via ${option.strategy}`);
  const clickedOption = await clickFirstVisible(option.locator, {
    noWaitAfter: true,
  });
  expect(
    clickedOption,
    `Dropdown option "${optionText}" must expose at least one visible clickable candidate.`,
  ).toBe(true);
  record(`clicked option ${optionText}`);
}

module.exports = {
  selectDropdownOption,
};
