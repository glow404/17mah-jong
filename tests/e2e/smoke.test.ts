import assert from 'node:assert/strict';
import test from 'node:test';

const baseUrl = process.env.E2E_BASE_URL;

test('home page smoke test', { skip: !baseUrl }, async () => {
  const response = await fetch(new URL('/', baseUrl));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /二人麻将|17mah-jong/);
});
