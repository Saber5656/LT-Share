import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLocalSummary, fitLocalImage, checkLocalAiSupport } from '../../src/lib/localAi/summary.ts';

test('unreadable or empty model output never becomes a post', () => {
  for (const value of ['', '  ', 'NO_READABLE_TEXT', 'NO_READABLE_TEXT。']) assert.throws(() => cleanLocalSummary(value));
});
test('model output is plain short Japanese text and bounded for post tags', () => {
  assert.equal(cleanLocalSummary('  RustでCLIを作るLT。\n配布の手順を紹介。 '), 'RustでCLIを作るLT。配布の手順を紹介。');
  const text = cleanLocalSummary('あ'.repeat(150));
  assert.ok(Array.from(text).length <= 110);
  assert.throws(() => cleanLocalSummary('<think>unfinished reasoning'));
});
test('small-model hashtag tail is removed without removing a language name like C#', () => {
  assert.equal(cleanLocalSummary('RustでCLIを開発。 #rustcli #cargo-dist #cli'), 'RustでCLIを開発。');
  assert.equal(cleanLocalSummary('RustでCLIを開発。#rustcli #cargo-dist #cli'), 'RustでCLIを開発。');
  assert.equal(cleanLocalSummary('C#でGUIを開発する発表。'), 'C#でGUIを開発する発表。');
  assert.throws(() => cleanLocalSummary('#rustcli #cli'));
});
test('local image resize preserves aspect ratio and limits image token cost', () => {
  assert.deepEqual(fitLocalImage(1920,1080), {width:768,height:432});
  assert.deepEqual(fitLocalImage(320,640), {width:320,height:640});
  assert.throws(() => fitLocalImage(0,100));
});
test('unsupported GPU never claims readiness or downloads a model', async () => {
  assert.equal(await checkLocalAiSupport(undefined), false);
  assert.equal(await checkLocalAiSupport({requestAdapter:async()=>null}), false);
  assert.equal(await checkLocalAiSupport({requestAdapter:async()=>({features:new Set()})}), false);
  assert.equal(await checkLocalAiSupport({requestAdapter:async()=>({features:new Set(['shader-f16'])})}), true);
  assert.equal(await checkLocalAiSupport({requestAdapter:async()=>{throw new Error('driver')}}), false);
});
