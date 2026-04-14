export type AdapterType = 'claude' | 'codex' | 'ollama' | 'hermes';

export interface AdapterConfig {
  type: AdapterType;
  model?: string;
  host?: string;
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
  hermes: DetectInfo;
}

export interface RunOptions {
  signal?: AbortSignal;
  cwd?: string;
  systemPrompt?: string;
  allowTools?: boolean;
}

export interface AgentAdapter {
  readonly type: AdapterType;
  readonly model: string | undefined;
  detect(): Promise<DetectInfo | OllamaDetectInfo>;
  run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void>;
  cancel(): void;
}
