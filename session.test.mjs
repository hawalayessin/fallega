import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { withYouTubeSession } from './session.mjs';

test('cookies temporaires limités à YouTube et supprimés après échec', async () => {
  const previous = process.env.YOUTUBE_COOKIES;
  process.env.YOUTUBE_COOKIES = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tTEST\tfake-test-value\n';
  let path;
  try {
    await withYouTubeSession('https://soundcloud.com/artist/track', async (args) => assert.deepEqual(args, []));
    await assert.rejects(withYouTubeSession('https://www.youtube.com/watch?v=WNcsUNKlAKw', async (args) => {
      assert.equal(args[0], '--cookies');
      path = args[1];
      assert.match(await readFile(path, 'utf8'), /fake-test-value/);
      throw new Error('test failure');
    }), /test failure/);
    await assert.rejects(stat(path), { code: 'ENOENT' });
    process.env.YOUTUBE_COOKIES = '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tTEST\tfake\n';
    await assert.rejects(withYouTubeSession('ytsearch1:test', () => assert.fail()), /uniquement/);
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_COOKIES;
    else process.env.YOUTUBE_COOKIES = previous;
  }
});
