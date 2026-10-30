import test from 'node:test';
import assert from 'node:assert/strict';
import { barWidth } from '../public/js/ui.js';

test('progress bar width clamps to 0–100%', () => {
  assert.equal(barWidth(-10), '0');
  assert.equal(barWidth(0), '0');
  assert.equal(barWidth(50), 'max(2px, 50%)');
  assert.equal(barWidth(100), 'max(2px, 100%)');
  assert.equal(barWidth(150), 'max(2px, 100%)');
});

test('progress bar is at least 2px when value is above zero', () => {
  assert.equal(barWidth(0.1), 'max(2px, 0.1%)');
  assert.equal(barWidth(1), 'max(2px, 1%)');
});

test('morning summary renders light Markdown safely', async () => {
  const { summaryHtml } = await import('../public/js/pages/today.js');
  const html = summaryHtml('**Shoot:** [Script](https://docs.google.com/d/a?x=1&y=2) now.\n- **Olivia:** done\n- two\n\n**Bad:** <b>x</b> [y](javascript:alert(1))');
  assert.equal(html, '<section><p><strong>Shoot:</strong> <a href="https://docs.google.com/d/a?x=1&amp;y=2" target="_blank" rel="noopener">Script</a> now.</p>'
    + '<ul><li><strong>Olivia:</strong> done</li><li>two</li></ul></section>'
    + '<section><p><strong>Bad:</strong> &lt;b&gt;x&lt;/b&gt; [y](javascript:alert(1))</p></section>');
});
