'use strict';

const ALLOWED_RICH_TEXT_EDITOR_LABELS = new Set([
  'Descrição (opcional)',
  'Bio',
  'Conteudo',
]);

function richTextSemanticValueMatches(actualValue, expectedValue) {
  return actualValue === expectedValue || actualValue === `${expectedValue}\n`;
}

async function fillRichTextEditorText(editor, value) {
  const label = (await editor.getAttribute('aria-label')) || '';
  if (!ALLOWED_RICH_TEXT_EDITOR_LABELS.has(label)) {
    throw new Error(
      `Rich-text input helper refuses non-canonical editor label "${label}".`,
    );
  }

  const selectAll = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
  let lastValue = '';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await editor.click();
    await editor.press(selectAll);
    await editor.press('Backspace');
    await editor.pressSequentially(value, { delay: 10 });
    lastValue = await editor.inputValue();

    // Flutter exposes the document's terminal paragraph as one trailing LF.
    if (richTextSemanticValueMatches(lastValue, value)) {
      return editor;
    }
  }

  throw new Error(
    `${label} rich-text editor did not retain the authored text; last semantic value was ${JSON.stringify(lastValue)}.`,
  );
}

async function selectRichTextEditorContents(page, editor) {
  const label = (await editor.getAttribute('aria-label')) || '';
  if (!ALLOWED_RICH_TEXT_EDITOR_LABELS.has(label)) {
    throw new Error(
      `Rich-text selection helper refuses non-canonical editor label "${label}".`,
    );
  }

  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
}

module.exports = {
  fillRichTextEditorText,
  selectRichTextEditorContents,
};
