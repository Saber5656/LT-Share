import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as summaryModule from '../../src/lib/summaryImage.ts';
import {createHttpAiProvider} from '../../src/lib/ai.ts';

const summary = summaryModule as typeof summaryModule & {videoSampleTimes(duration:number):number[]; isNearBlackFrame(pixels:Uint8ClampedArray):boolean};

test('short clips sample start middle and end, never the exact duration',()=>{
 const times=summary.videoSampleTimes(3);
 assert.equal(times.length,3);assert.equal(times[0],0);
 assert.ok(times[1]!>=1.4 && times[1]!<=1.6);
 assert.ok(times[2]!>2.8 && times[2]!<3);
});
test('typical clips use about five seconds and include the end',()=>{
 const times=summary.videoSampleTimes(24);
 assert.equal(times.length,6);
 for(let i=1;i<times.length;i++)assert.ok(times[i]!-times[i-1]!>4 && times[i]!-times[i-1]!<=5);
 assert.ok(times.at(-1)!>23.8);
});
test('long videos use at most twelve uniform samples across whole duration',()=>{
 const times=summary.videoSampleTimes(3600);assert.equal(times.length,12);
 assert.equal(times[0],0);assert.ok(times.at(-1)!>3599);
 for(let i=1;i<times.length;i++)assert.ok(Math.abs((times[i]!-times[i-1]!)-(times[1]!-times[0]!))<0.001);
});
test('invalid durations fail and tiny durations stay finite within bounds',()=>{
 for(const value of [0,-1,Infinity,NaN])assert.throws(()=>summary.videoSampleTimes(value));
 const times=summary.videoSampleTimes(0.01);assert.ok(times.every(t=>Number.isFinite(t)&&t>=0&&t<0.01));
});
function pixels(value:number){const p=new Uint8ClampedArray(400*4);for(let i=0;i<p.length;i+=4){p[i]=p[i+1]=p[i+2]=value;p[i+3]=255;}return p;}
test('black compression noise is skipped but dim slide text is retained',()=>{
 assert.equal(summary.isNearBlackFrame(pixels(0)),true);
 assert.equal(summary.isNearBlackFrame(pixels(3)),true);
 const dim=pixels(1);for(let i=0;i<24;i+=4)dim[i]=dim[i+1]=dim[i+2]=35;
 assert.equal(summary.isNearBlackFrame(dim),false);
 assert.equal(summary.isNearBlackFrame(pixels(25)),false);
});
test('photo sizing stays unchanged',()=>{assert.deepEqual(summary.fitSummaryImage(4000,3000),{width:1600,height:1200});});
test('provider passes same abort signal into preparation and never uploads after abort',async()=>{
 const controller=new AbortController();let sent=0;
 const provider=createHttpAiProvider(async()=>{sent++;return Response.json({text:'unexpected'});},async(blob:Blob,signal?:AbortSignal)=>{
  assert.equal(signal,controller.signal);controller.abort();signal!.throwIfAborted();return blob;
 });
 await assert.rejects(provider.generate({image:new Blob(),tags:[],signal:controller.signal}),{name:'AbortError'});assert.equal(sent,0);
});

for(const stage of ['load','seek','encode'] as const)test(`abort during ${stage} releases URL, media and listeners`,async(t)=>{
 const controller=new AbortController();let revoked=0,removed=0,listeners=0;
 let reach!:()=>void;const reached=new Promise<void>(resolve=>{reach=resolve;});
 class Element extends EventTarget {
  naturalWidth=320;naturalHeight=180;videoWidth=320;videoHeight=180;duration=3;
  addEventListener(...args:Parameters<EventTarget['addEventListener']>){listeners++;super.addEventListener(...args);}
  removeEventListener(...args:Parameters<EventTarget['removeEventListener']>){listeners--;super.removeEventListener(...args);}
  set src(_value:string){if(stage==='load')reach();else queueMicrotask(()=>this.dispatchEvent(new Event(stage==='seek'?'loadeddata':'load')));}
  removeAttribute(){removed++;}pause(){}load(){}
 }
 class Video extends Element {get currentTime(){return 0;}set currentTime(_value:number){reach();}}
 const saved = ['Image','HTMLVideoElement','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
 Object.defineProperty(globalThis,'Image',{configurable:true,value:Element});
 Object.defineProperty(globalThis,'HTMLVideoElement',{configurable:true,value:Video});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(tag:string)=>tag==='video'?new Video():{
  width:0,height:0,getContext:()=>({drawImage(){},fillRect(){},fillText(){},getImageData:()=>({data:pixels(25)})}),
  toBlob:()=>reach(),
 }}});
 t.after(()=>{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
 t.mock.method(URL,'createObjectURL',()=> 'blob:test');t.mock.method(URL,'revokeObjectURL',()=>{revoked++;});
 const result=summary.prepareSummaryImage(new Blob([],{type:stage==='seek'?'video/webm':'image/jpeg'}),controller.signal);
 const rejected=assert.rejects(result,{name:'AbortError'});
 await reached;controller.abort();await rejected;
 assert.equal(revoked,1);assert.equal(removed,1);assert.equal(listeners,0);
});
