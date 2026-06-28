import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';

test('package bin entry is executable for OctoBus long-running instances', async () => {
  const info = await stat(new URL('../bin/cloudwalker.js', import.meta.url));

  assert.equal(Boolean(info.mode & 0o111), true);
});
