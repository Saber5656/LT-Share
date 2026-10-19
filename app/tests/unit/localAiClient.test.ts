import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalAiClient } from '../../src/lib/localAi/client.ts';

class FakeWorker extends EventTarget {
  sent: any[] = [];
  terminated = false;
  postMessage(message: unknown) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
}
function setup(options = {}) {
  const workers: FakeWorker[] = [];
  const client = new LocalAiClient(() => { const w = new FakeWorker(); workers.push(w); return w; }, options);
  return { client, workers };
}
async function ready(client: LocalAiClient, workers: FakeWorker[]) {
  const p = client.prepare();
  const w = workers.at(-1)!;
  w.reply({ type: 'loaded', id: w.sent.at(-1).id });
  await p;
  return w;
}
test('explicit preparation only, deduplicates inflight load, stable snapshot', async () => {
  const { client, workers } = setup();
  assert.equal(client.getSnapshot(), client.getSnapshot());
  await assert.rejects(client.generate(new Blob()), /ready/i);
  assert.equal(workers.length, 0);
  const a = client.prepare(), b = client.prepare();
  assert.equal(a, b);
  assert.equal(workers[0]!.sent.length, 1);
  workers[0]!.reply({ type: 'loaded', id: workers[0]!.sent[0].id });
  await Promise.all([a, b]);
  await client.prepare();
  assert.equal(workers.length, 1);
  client.dispose();
});
test('busy generation rejects without replacing active request; stale ids ignored', async () => {
  const { client, workers } = setup(); const w = await ready(client, workers);
  const p = client.generate(new Blob(['image'])); const id = w.sent.at(-1).id;
  await assert.rejects(client.generate(new Blob()), /busy/i);
  w.reply({ type: 'result', id: id - 1, text: 'stale' });
  assert.equal(client.getSnapshot().phase, 'generating');
  w.reply({ type: 'result', id, text: 'correct' });
  assert.equal(await p, 'correct'); client.dispose();
});
for (const phase of ['load', 'generate']) test(`cancel rejects active ${phase} and ignores old worker`, async () => {
  const { client, workers } = setup();
  if (phase === 'generate') await ready(client, workers);
  const p = phase === 'load' ? client.prepare() : client.generate(new Blob());
  const old = workers[0]!; const id = old.sent.at(-1).id;
  const rejection = assert.rejects(p, { name: 'AbortError' });
  client.cancel(); await rejection;
  assert.equal(old.terminated, true); assert.equal(client.getSnapshot().phase, 'idle');
  const next = client.prepare();
  old.reply({ type: 'loaded', id }); old.reply({ type: 'result', id, text: 'late' });
  assert.equal(client.getSnapshot().phase, 'loading');
  workers[1]!.reply({ type: 'loaded', id: workers[1]!.sent[0].id }); await next;
  client.dispose();
});
test('ordinary failure keeps model ready for retry; unsupported terminates', async () => {
  const { client, workers } = setup(); const w = await ready(client, workers);
  const p = client.generate(new Blob());
  w.reply({ type: 'error', id: w.sent.at(-1).id, code: 'unreadable', message: 'bad image' });
  await assert.rejects(p, /bad image/);
  assert.deepEqual(client.getSnapshot(), { phase: 'ready', message: 'bad image' });
  assert.equal(w.terminated, false);
  const retry = client.generate(new Blob());
  w.reply({ type: 'error', id: w.sent.at(-1).id, code: 'unsupported' });
  await assert.rejects(retry); assert.equal(w.terminated, true);
  assert.equal(client.getSnapshot().phase, 'unsupported'); client.dispose();
});
test('progress finite and clamped; malformed current replies fail closed', async () => {
  const { client, workers } = setup(); const p = client.prepare(); const w = workers[0]!; const id = w.sent[0].id;
  for (const [progress, expected] of [[-1, 0], [2, 1], [NaN, 1], [Infinity, 1]]) {
    w.reply({ type: 'progress', id, progress }); assert.equal(client.getSnapshot().progress, expected);
  }
  w.reply({ type: 'result', id, text: 42 });
  await assert.rejects(p); assert.equal(client.getSnapshot().phase, 'error'); assert.equal(w.terminated, true);
});
for (const kind of ['error', 'messageerror', 'loadTimeout', 'generationTimeout']) test(`${kind} rejects and cleans up`, async () => {
  const { client, workers } = setup({ loadTimeoutMs: 15, generationTimeoutMs: 15 });
  if (kind === 'generationTimeout') await ready(client, workers);
  const p = kind === 'generationTimeout' ? client.generate(new Blob()) : client.prepare();
  const rejection = assert.rejects(p);
  const w = workers[0]!;
  if (kind === 'error' || kind === 'messageerror') w.dispatchEvent(new Event(kind));
  await rejection; assert.equal(w.terminated, true); assert.equal(client.getSnapshot().phase, 'error');
  w.reply({ type: 'loaded', id: w.sent[0].id }); assert.equal(client.getSnapshot().phase, 'error');
  client.dispose();
});
test('subscribe unsubscribe and dispose cleanup', async () => {
  const { client } = setup(); const seen: string[] = [];
  const unsubscribe = client.subscribe(s => seen.push(s.phase));
  const p = client.prepare(); const rejection = assert.rejects(p, { name: 'AbortError' });
  unsubscribe(); client.dispose(); await rejection; assert.deepEqual(seen, ['loading']);
  assert.equal(client.getSnapshot().phase, 'idle');
});

test('synchronous worker failures reject without stranding state', async () => {
  const client = new LocalAiClient(() => { throw new Error('construction failed'); });
  await assert.rejects(client.prepare(), /construction failed/);
  assert.equal(client.getSnapshot().phase, 'error');
  const w = new FakeWorker();
  w.postMessage = () => { throw new Error('send failed'); };
  const sender = new LocalAiClient(() => w);
  await assert.rejects(sender.prepare(), /send failed/);
  assert.equal(w.terminated, true);
  assert.equal(sender.getSnapshot().phase, 'error');
});
test('subscriber cancellation before send rejects and removes worker listeners', async () => {
  const { client, workers } = setup();
  client.subscribe(s => { if (s.phase === 'loading') client.cancel(); });
  await assert.rejects(client.prepare(), { name: 'AbortError' });
  assert.equal(workers[0]!.sent.length, 0);
  assert.equal(workers[0]!.terminated, true);
  assert.equal(client.getSnapshot().phase, 'idle');
  client.dispose();
});
