import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDraft, draftReducer, type DraftState, type Media} from '../../src/lib/draft.ts';
import {restoreState} from '../../src/lib/restore.ts';

// Structural extension permits RED against the old Media type without suppressing type errors.
type SourcedMedia = Media & {source?: 'library' | 'camera'};
function state(source?: SourcedMedia['source']): DraftState {
  const media: SourcedMedia = {id:'m1',kind:'photo',mime:'image/jpeg',name:'original.jpg',size:100,saveStatus:'unsaved',...(source?{source}:{})};
  return {current:{...createDraft({id:'d1',index:1,tags:['#LT'],now:1}),body:'残す本文',media},history:[],nextId:2};
}
test('explicit original confirmation saves unsaved library media without handoff',()=>{
  const before=state('library');
  const after=draftReducer(before,{type:'saveConfirmed',draftId:'d1',mediaId:'m1'});
  assert.equal(after.current.media?.saveStatus,'saved');
  assert.equal((after.current.media as SourcedMedia).source,'library');
  assert.equal(after.current.body,before.current.body);
  assert.deepEqual(after.current.tags,before.current.tags);
  assert.equal(before.current.media?.saveStatus,'unsaved');
});
for(const source of ['camera',undefined] as const)test(`unsaved camera or legacy media cannot skip handoff (${source})`,()=>{
  const before=state(source);
  assert.deepEqual(draftReducer(before,{type:'saveConfirmed',draftId:'d1',mediaId:'m1'}),before);
});
for(const target of [{draftId:'d1',mediaId:'wrong'},{draftId:'wrong',mediaId:'m1'}])test(`library confirmation ignores stale target ${JSON.stringify(target)}`,()=>{
  const before=state('library');
  assert.deepEqual(draftReducer(before,{type:'saveConfirmed',...target}),before);
});
for(const source of ['library','camera',undefined] as const)test(`restore retains optional source without inventing one (${source})`,()=>{
  const before=state(source);
  const restored=restoreState({drafts:[before.current],meta:{currentDraftId:'d1',tags:['#LT'],nextId:2}},100);
  assert.ok(restored);
  assert.deepEqual(restored.current.media,before.current.media);
  assert.equal((restored.current.media as SourcedMedia).source,source);
});
