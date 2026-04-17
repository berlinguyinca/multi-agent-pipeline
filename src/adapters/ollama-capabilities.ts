import { ensureOllamaReady } from './ollama-runtime.js';

export interface OllamaConcurrencyProbeOptions {
  host?: string;
  model: string;
  models?: string[];
  maxParallel?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface OllamaConcurrencyProbeResult {
  maxParallel: number;
  testedParallel: number;
  baselineFirstChunkMs?: number;
  reason?: string;
}

const probeCache = new Map<string, Promise<OllamaConcurrencyProbeResult>>();

export function resetOllamaCapabilityProbeCacheForTests(): void {
  probeCache.clear();
}

export async function probeOllamaConcurrencyCapacity(
  options: OllamaConcurrencyProbeOptions,
): Promise<OllamaConcurrencyProbeResult> {
  const maxParallel = Math.max(1, Math.min(8, Math.floor(options.maxParallel ?? 3)));
  if (maxParallel <= 1) {
    return { maxParallel: 1, testedParallel: 1, reason: 'maxParallel <= 1' };
  }

  const models = normalizeProbeModels(options);
  const cacheKey = `${options.host ?? 'default'}:${models.join(',')}:${maxParallel}:${options.timeoutMs ?? 20_000}`;
  const cached = probeCache.get(cacheKey);
  if (cached) return cached;

  const promise = probeOllamaConcurrencyCapacityUncached({ ...options, maxParallel });
  probeCache.set(cacheKey, promise);
  return promise;
}

async function probeOllamaConcurrencyCapacityUncached(
  options: Required<Pick<OllamaConcurrencyProbeOptions, 'model' | 'maxParallel'>> & OllamaConcurrencyProbeOptions,
): Promise<OllamaConcurrencyProbeResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const models = normalizeProbeModels(options);

  try {
    if (!options.fetchFn) {
      for (const model of new Set(models)) {
        await ensureOllamaReady(model, options.host);
      }
    }

    const baseline = await measureFirstChunk({ ...options, model: models[0]!, fetchFn, timeoutMs });
    let detected = 1;

    for (let parallel = 2; parallel <= options.maxParallel; parallel += 1) {
      const startedAt = Date.now();
      const measurements = await Promise.allSettled(
        Array.from({ length: parallel }, (_value, index) =>
          measureFirstChunk({ ...options, model: models[index % models.length]!, fetchFn, timeoutMs }),
        ),
      );
      const elapsed = Date.now() - startedAt;
      const fulfilled = measurements.filter((item): item is PromiseFulfilledResult<number> => item.status === 'fulfilled');
      const threshold = Math.min(timeoutMs, Math.max(8_000, baseline * 2.5));
      const allNonBlocking =
        fulfilled.length === parallel &&
        fulfilled.every((item) => item.value <= threshold) &&
        elapsed <= threshold + 2_000;

      if (!allNonBlocking) break;
      detected = parallel;
    }

    return {
      maxParallel: detected,
      testedParallel: options.maxParallel,
      baselineFirstChunkMs: baseline,
      ...(detected === 1 ? { reason: 'probe observed serial or delayed concurrent responses' } : {}),
    };
  } catch (err: unknown) {
    return {
      maxParallel: 1,
      testedParallel: options.maxParallel,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeProbeModels(options: OllamaConcurrencyProbeOptions): string[] {
  const models = (options.models && options.models.length > 0 ? options.models : [options.model])
    .map((model) => model.trim())
    .filter(Boolean);
  return models.length > 0 ? models : [options.model];
}

async function measureFirstChunk(options: {
  host?: string;
  model: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
}): Promise<number> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.fetchFn(new URL('/api/chat', options.host ?? 'http://127.0.0.1:11434'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        stream: true,
        think: false,
        options: {
          temperature: 0,
          num_predict: 8,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama probe failed with status ${response.status}: ${await response.text()}`);
    }
    if (!response.body) {
      throw new Error('Ollama probe response did not include a stream body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return Date.now() - startedAt;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (lineHasContent(line)) return Date.now() - startedAt;
        }
      }
    } finally {
      reader.releaseLock();
      controller.abort();
    }
  } finally {
    clearTimeout(timeout);
  }
}

function lineHasContent(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  try {
    const payload = JSON.parse(trimmed) as { message?: { content?: unknown }; response?: unknown; done?: unknown };
    return (
      (typeof payload.message?.content === 'string' && payload.message.content.length > 0) ||
      (typeof payload.response === 'string' && payload.response.length > 0) ||
      payload.done === true
    );
  } catch {
    return false;
  }
}
