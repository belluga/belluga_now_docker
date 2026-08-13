const fs = require('fs');
const { expect } = require('@playwright/test');
const dropdownDebugEnabled = process.env.DEBUG_SEMANTIC_DROPDOWN === '1';
const dropdownDebugLogPath = process.env.DEBUG_SEMANTIC_DROPDOWN_LOG || '';

function cssAttributeValue(value) {
  return JSON.stringify(value).replace(/'/g, "\\'");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFieldPrefixRegex(value) {
  return new RegExp(`^${escapeRegExp(value)}(?:\\b|\\n)`, 'i');
}

function buildExactTextRegex(value) {
  return new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`, 'i');
}

async function logDropdownDebugState(page, fieldLabel, optionText, record, stage) {
  if (!dropdownDebugEnabled) {
    return;
  }

  const snapshot = await page.evaluate(({ rawFieldLabel, rawOptionText }) => {
    const normalize = (value) => (value || '').toString().replace(/\s+/g, ' ').trim();
    const isVisible = (node) => {
      if (!node) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const style = window.getComputedStyle(node);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0
      );
    };

    const summarizeNode = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName,
        role: node.getAttribute('role') || '',
        aria: node.getAttribute('aria-label') || '',
        expanded: node.getAttribute('aria-expanded') || '',
        text: normalize(node.textContent || '').slice(0, 240),
        className: normalize(node.className || '').slice(0, 160),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      };
    };

    const interesting = [];
    const fieldNeedle = rawFieldLabel.toLowerCase();
    const optionNeedle = rawOptionText.toLowerCase();
    for (const node of document.querySelectorAll('*')) {
      if (!isVisible(node)) {
        continue;
      }

      const role = (node.getAttribute('role') || '').toLowerCase();
      const aria = (node.getAttribute('aria-label') || '').toLowerCase();
      const text = normalize(node.textContent || '').toLowerCase();
      const blob = `${role} ${aria} ${text}`;
      if (
        !blob.includes(fieldNeedle) &&
        !blob.includes(optionNeedle) &&
        !blob.includes('menu') &&
        !blob.includes('option')
      ) {
        continue;
      }

      interesting.push(summarizeNode(node));
      if (interesting.length >= 40) {
        break;
      }
    }

    const scrollables = Array.from(document.querySelectorAll('*'))
      .filter((node) => {
        if (!isVisible(node)) {
          return false;
        }
        return node.scrollHeight - node.clientHeight > 8;
      })
      .map((node) => {
        const summary = summarizeNode(node);
        return {
          ...summary,
          scrollTop: Math.round(node.scrollTop),
          scrollHeight: Math.round(node.scrollHeight),
          clientHeight: Math.round(node.clientHeight),
        };
      })
      .sort((left, right) => {
        return (
          right.scrollHeight - right.clientHeight - (left.scrollHeight - left.clientHeight)
        );
      })
      .slice(0, 20);

    return {
      bodyNeedles: normalize(document.body?.innerText || '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 40),
      interesting,
      scrollables,
    };
  }, { rawFieldLabel: fieldLabel, rawOptionText: optionText });

  const rendered = `debug ${stage} ${JSON.stringify(snapshot)}`;
  record(rendered);
  if (dropdownDebugLogPath) {
    fs.appendFileSync(dropdownDebugLogPath, `${rendered}\n`);
  }
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

async function enumerateLocatorCandidates(locator, limit = 8) {
  const count = await locator.count().catch(() => 0);
  if (count > 0) {
    return Array.from({ length: Math.min(count, limit) }, (_, index) =>
      locator.nth(index),
    );
  }

  // Flutter semantics locators can defer concrete node resolution until
  // action time while still reporting count() === 0 in CanvasKit flows.
  return [locator.first()];
}

async function locatorHasAnyMatch(locator) {
  const count = await locator.count().catch(() => 0);
  if (count > 0) {
    return true;
  }

  return locator
    .first()
    .isVisible()
    .catch(() => false);
}

function dropdownSurfaceLocators(page) {
  return [
    page.getByRole('menuitem'),
    page.getByRole('option'),
    page.locator('flt-semantics[role="menuitem"]'),
    page.locator('flt-semantics[role="option"]'),
  ];
}

async function hasGenericDropdownSurface(page) {
  return page.evaluate(() => {
    const isVisible = (node) => {
      if (!node) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const style = window.getComputedStyle(node);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0
      );
    };

    const isDropdownSurfaceCandidate = (node) => {
      if (
        !node ||
        node === document.body ||
        node === document.documentElement ||
        !isVisible(node)
      ) {
        return false;
      }

      const canScroll = node.scrollHeight - node.clientHeight > 12;
      if (!canScroll) {
        return false;
      }

      const style = window.getComputedStyle(node);
      const isPositioned =
        style.position === 'absolute' ||
        style.position === 'fixed' ||
        style.position === 'sticky' ||
        Number(style.zIndex || '0') > 0;
      if (!isPositioned) {
        return false;
      }

      const labeledChildren = Array.from(
        node.querySelectorAll('flt-semantics[aria-label], [role], [aria-label], div, span'),
      ).filter((candidate) => {
        if (!isVisible(candidate)) {
          return false;
        }
        const text =
          candidate.getAttribute('aria-label') ||
          candidate.textContent ||
          '';
        return text.trim().length > 0;
      });

      return labeledChildren.length >= 3;
    };

    return Array.from(document.querySelectorAll('*')).some(isDropdownSurfaceCandidate);
  });
}

async function resolveOption(page, optionText) {
  for (const candidate of optionLocators(page, optionText)) {
    if (await locatorHasAnyMatch(candidate.locator)) {
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

  return hasGenericDropdownSurface(page);
}

async function scrollDropdownSurface(page) {
  return page.evaluate(() => {
    const isVisible = (node) => {
      if (!node) {
        return false;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }
      const style = window.getComputedStyle(node);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight
      );
    };

    const isDropdownSurfaceCandidate = (node) => {
      if (
        !node ||
        node === document.body ||
        node === document.documentElement ||
        !isVisible(node)
      ) {
        return false;
      }

      const canScroll = node.scrollHeight - node.clientHeight > 12;
      if (!canScroll) {
        return false;
      }

      const style = window.getComputedStyle(node);
      const isPositioned =
        style.position === 'absolute' ||
        style.position === 'fixed' ||
        style.position === 'sticky' ||
        Number(style.zIndex || '0') > 0;
      if (!isPositioned) {
        return false;
      }

      const labeledChildren = Array.from(
        node.querySelectorAll('flt-semantics[aria-label], [role], [aria-label], div, span'),
      ).filter((candidate) => {
        if (!isVisible(candidate)) {
          return false;
        }
        const text =
          candidate.getAttribute('aria-label') ||
          candidate.textContent ||
          '';
        return text.trim().length > 0;
      });

      return labeledChildren.length >= 3;
    };

    const findScrollableSurface = (startNode) => {
      let current = startNode;
      while (current) {
        const canScroll = current.scrollHeight - current.clientHeight > 4;
        if (canScroll) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    };

    const selector =
      'flt-semantics[role="menuitem"], flt-semantics[role="option"], [role="menuitem"], [role="option"]';
    const candidates = Array.from(document.querySelectorAll(selector));
    const visibleCandidate = candidates.find((node) => {
      return isVisible(node);
    });

    let surface = visibleCandidate
      ? findScrollableSurface(visibleCandidate.parentElement)
      : null;

    if (!surface) {
      surface =
        Array.from(document.querySelectorAll('*')).find((node) =>
          isDropdownSurfaceCandidate(node),
        ) || null;
    }

    if (!surface) {
      return false;
    }

    const maxScrollTop = surface.scrollHeight - surface.clientHeight;
    if (surface.scrollTop >= maxScrollTop - 4) {
      return false;
    }

    surface.scrollTop = Math.min(
      maxScrollTop,
      surface.scrollTop + Math.max(80, Math.floor(surface.clientHeight * 0.75)),
    );
    surface.dispatchEvent(new Event('scroll', { bubbles: true }));
    return true;
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

  for (let index = 0; index < 256; index += 1) {
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

async function waitForDropdownSurface(page, optionText, timeout = 5000) {
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
  let visibleLocator = null;

  for (const candidate of await enumerateLocatorCandidates(locator)) {
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
  for (const candidate of await enumerateLocatorCandidates(locator)) {
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
    {
      locator: page.getByText(fieldLabel, { exact: true }),
      description: `exact text trigger ${fieldLabel}`,
    },
    {
      locator: page
        .locator('flt-semantics[role="button"]')
        .filter({ hasText: buildExactTextRegex(fieldLabel) }),
      description: `Flutter semantics trigger ${fieldLabel}`,
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
      if (!(await locatorHasAnyMatch(trigger.locator))) {
        continue;
      }

      openAttempted = true;
      record(`open ${trigger.description}`);
      await logDropdownDebugState(
        page,
        fieldLabel,
        optionText,
        record,
        `before-click ${trigger.description}`,
      );
      const clicked = await clickFirstVisible(trigger.locator, {
        noWaitAfter: true,
      });
      if (!clicked) {
        continue;
      }
      record(`clicked ${trigger.description}`);
      await logDropdownDebugState(
        page,
        fieldLabel,
        optionText,
        record,
        `after-click ${trigger.description}`,
      );
      surfaceOpened = await waitForDropdownSurface(page, optionText);
      if (surfaceOpened) {
        const optionBecameReachable = await revealDropdownOption(
          page,
          optionText,
          record,
        );
        if (optionBecameReachable) {
          record(`dropdown surface visible for ${fieldLabel}`);
          break;
        }

        await logDropdownDebugState(
          page,
          fieldLabel,
          optionText,
          record,
          `surface-opened-but-unreachable ${trigger.description}`,
        );
        surfaceOpened = false;
        record(
          `trigger ${trigger.description} opened a surface without reachable option ${optionText}`,
        );
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(150);
      }
      if (await focusFirstVisible(trigger.locator)) {
        for (const key of ['Space', 'Enter', 'ArrowDown']) {
          record(`keyboard open ${trigger.description} via ${key}`);
          await page.keyboard.press(key).catch(() => {});
          await logDropdownDebugState(
            page,
            fieldLabel,
            optionText,
            record,
            `after-key ${trigger.description} ${key}`,
          );
          surfaceOpened = await waitForDropdownSurface(page, optionText, 1500);
          if (surfaceOpened) {
            const optionBecameReachable = await revealDropdownOption(
              page,
              optionText,
              record,
            );
            if (optionBecameReachable) {
              record(`dropdown surface visible for ${fieldLabel} via ${key}`);
              break;
            }

            await logDropdownDebugState(
              page,
              fieldLabel,
              optionText,
              record,
              `key-surface-opened-but-unreachable ${trigger.description} ${key}`,
            );
            surfaceOpened = false;
            record(
              `keyboard trigger ${trigger.description} via ${key} opened a surface without reachable option ${optionText}`,
            );
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(150);
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
  await logDropdownDebugState(
    page,
    fieldLabel,
    optionText,
    record,
    'before-final-surface-assert',
  );
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
