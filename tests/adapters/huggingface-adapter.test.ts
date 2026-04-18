import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureOllamaReady: vi.fn(),
  runCalls: [] as Array<{ model: string | undefined; prompt: string }>,
}));

vi.mock('../../src/adapters/ollama-runtime.js', () => ({
  ensureOllamaReady: mocks.ensureOllamaReady,
}));

vi.mock('../../src/adapters/ollama-adapter.js', () => ({
  OllamaAdapter: class {
    readonly type = 'ollama' as const;
    constructor(readonly model?: string) {}
    async detect() {
      return { installed: true, models: [this.model].filter(Boolean) };
    }
    async *run(prompt: string) {
      mocks.runCalls.push({ model: this.model, prompt });
      yield `ran:${this.model}`;
    }
    cancel() {}
  },
}));

const { HuggingFaceAdapter, normalizeHuggingFaceOllamaModel } = await import('../../src/adapters/huggingface-adapter.js');

describe('HuggingFaceAdapter', () => {
  beforeEach(() => {
    mocks.ensureOllamaReady.mockReset();
    mocks.runCalls.length = 0;
  });

  it('normalizes Hugging Face model ids to Ollama hf.co refs', () => {
    expect(normalizeHuggingFaceOllamaModel('AI4Chem/ChemLLM-7B-GGUF:Q4_K_M')).toBe('hf.co/AI4Chem/ChemLLM-7B-GGUF:Q4_K_M');
    expect(normalizeHuggingFaceOllamaModel('huggingface.co/AI4Chem/ChemLLM-7B-GGUF')).toBe('hf.co/AI4Chem/ChemLLM-7B-GGUF');
    expect(normalizeHuggingFaceOllamaModel('hf.co/AI4Chem/ChemLLM-7B-GGUF')).toBe('hf.co/AI4Chem/ChemLLM-7B-GGUF');
  });

  it('pulls the HF model through Ollama before running', async () => {
    const adapter = new HuggingFaceAdapter('AI4Chem/ChemLLM-7B-GGUF:Q4_K_M');
    let output = '';

    for await (const chunk of adapter.run('chem task')) output += chunk;

    expect(mocks.ensureOllamaReady).toHaveBeenCalledWith('hf.co/AI4Chem/ChemLLM-7B-GGUF:Q4_K_M', undefined, undefined);
    expect(mocks.runCalls).toEqual([{ model: 'hf.co/AI4Chem/ChemLLM-7B-GGUF:Q4_K_M', prompt: 'chem task' }]);
    expect(output).toBe('ran:hf.co/AI4Chem/ChemLLM-7B-GGUF:Q4_K_M');
  });
});
