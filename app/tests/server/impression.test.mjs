import test from 'node:test';
import assert from 'node:assert/strict';
import {PROMPT} from '../../server/ai-worker.mjs';
test('summary contract requests grounded impressions across video scenes',()=>{
 for (const pattern of [/感想/,/便利そう/,/ユースケース/,/複数.*時系列/,/体験.*捏造/,/readable:false/]) assert.match(PROMPT,pattern);
});
