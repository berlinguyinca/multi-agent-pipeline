export type AdapterType = 'claude' | 'codex' | 'ollama';

export interface AdapterConfig {
  type: AdapterType;
  model?: string;
  apiKey?: string;
  binaryPath?: string;
}

export interface DetectInfo {
  installed: boolean;
  version?: string;
  binaryPath?: string;
}

export interface OllamaDetectInfo extends DetectInfo {
  models: string[];
}

export interface DetectionResult {
  claude: DetectInfo;
  codex: DetectInfo;
  ollama: OllamaDetectInfo;
}

export interface RunOptions {
  signal?: AbortSignal;
  cwd?: string;
  systemPrompt?: string;
}

export interface AgentAdapter {
  readonly type: AdapterType;
  readonly model: string | undefined;
  detect(): Promise<DetectInfo | OllamaDetectInfo>;
  run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void>;
  cancel(): void;
}
