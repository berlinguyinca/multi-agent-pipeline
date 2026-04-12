import { useState, useCallback, useRef } from 'react';
import type { AgentAdapter } from '../../types/adapter.js';

export interface AgentState {
  output: string;
  streaming: boolean;
  error: string | null;
  run: (prompt: string) => void;
  cancel: () => void;
}

export function useAgent(adapter: AgentAdapter): AgentState {
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    adapter.cancel();
    setStreaming(false);
  }, [adapter]);

  const run = useCallback(
    (prompt: string) => {
      // Cancel any in-flight run
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setOutput('');
      setError(null);
      setStreaming(true);

      async function execute() {
        try {
          const gen = adapter.run(prompt, { signal: controller.signal });
          for await (const chunk of gen) {
            if (controller.signal.aborted) break;
            setOutput((prev) => prev + chunk);
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : String(err));
          }
        } finally {
          if (!controller.signal.aborted) {
            setStreaming(false);
          }
        }
      }

      void execute();
    },
    [adapter]
  );

  return { output, streaming, error, run, cancel };
}
