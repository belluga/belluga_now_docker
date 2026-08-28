'use strict';

const ALLOWED_RICH_TEXT_EDITOR_LABELS = new Set([
  'Descrição (opcional)',
  'Bio',
  'Conteudo',
]);

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
  selectRichTextEditorContents,
};
