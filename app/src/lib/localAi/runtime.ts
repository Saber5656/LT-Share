import { LOCAL_MODEL_ID, LOCAL_MODEL_REVISION, LOCAL_MODEL_BYTES, LOCAL_SUMMARY_PROMPT, cleanLocalSummary, fitLocalImage } from './summary.ts';

// This bundled browser entry has no bare module imports. Pin the runtime as well
// as the model; load it only on opt-in, without embedding WASM in the Site Worker.
const RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

export async function loadLocalModel(onProgress:(progress:number)=>void) {
  const { AutoProcessor, Qwen3_5ForConditionalGeneration, RawImage, Tensor, env }: typeof import('@huggingface/transformers') = await import(/* @vite-ignore */ RUNTIME_URL);
  // Model/runtime GETs only. No photos, tags or generated text leave the device.
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.cacheKey = 'lt-share-local-ai-v1';
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
  const loaded = new Map<string,number>();
  const progress_callback = (event: {status:string; file?:string; loaded?:number}) => {
    if (event.status === 'progress' && event.file && Number.isFinite(event.loaded)) {
      loaded.set(event.file, Math.max(loaded.get(event.file) ?? 0, event.loaded!));
      onProgress(Math.min(.95, [...loaded.values()].reduce((a,b)=>a+b,0) / LOCAL_MODEL_BYTES * .95));
    }
  };
  const processor = await AutoProcessor.from_pretrained(LOCAL_MODEL_ID, {revision:LOCAL_MODEL_REVISION,progress_callback});
  const model = await Qwen3_5ForConditionalGeneration.from_pretrained(LOCAL_MODEL_ID, {
    revision:LOCAL_MODEL_REVISION,
    dtype:{embed_tokens:'q4',vision_encoder:'fp16',decoder_model_merged:'q4'},
    device:'webgpu',progress_callback,
  });
  return { async generate(blob:Blob):Promise<string> {
    const raw = await RawImage.fromBlob(blob);
    const size = fitLocalImage(raw.width, raw.height);
    const image = await raw.resize(size.width,size.height);
    const text = processor.apply_chat_template([{role:'user',content:[{type:'image'},{type:'text',text:LOCAL_SUMMARY_PROMPT}]}], {add_generation_prompt:true,...{enable_thinking:false}});
    const inputs = await processor(text,image);
    try {
      const output = await model.generate({...inputs,max_new_tokens:200,do_sample:false,repetition_penalty:1.1});
      if (!('slice' in output)) throw new Error('Unexpected model output');
      try {
        const tokens = output.slice(null,[inputs.input_ids.dims.at(-1),null]);
        try { return cleanLocalSummary(processor.batch_decode(tokens,{skip_special_tokens:true})[0] ?? ''); }
        finally { tokens.dispose(); }
      } finally { output.dispose(); }
    } finally {
      for (const tensor of Object.values(inputs)) if (tensor instanceof Tensor) tensor.dispose();
    }
  }};
}
