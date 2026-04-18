export type AdapterType = 'claude' | 'codex' | 'ollama' | 'hermes' | 'metadata' | 'huggingface';

export interface AdapterConfig {
  type: AdapterType;
  model?: string;
  host?: string;
  contextLength?: number;
  numParallel?: number;
  maxLoadedModels?: number;
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
  metadata: DetectInfo;
  huggingface: DetectInfo;
}

export interface RunOptions {
  signal?: AbortSignal;
  cwd?: string;
  systemPrompt?: string;
  allowTools?: boolean;
  responseFormat?: string;
  hideThinking?: boolean;
  think?: boolean | string;
  temperature?: number;
  seed?: number;
}

export interface AgentAdapter {
  readonly type: AdapterType;
  readonly model: string | undefined;
  detect(): Promise<DetectInfo | OllamaDetectInfo>;
  run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void>;
  cancel(): void;
}
