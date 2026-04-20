import * as os from 'node:os';
import type { PipelineConfig } from '../types/config.js';

export interface HardwareModelCandidate {
  model: string;
  installed: boolean;
  fitsHardware: boolean;
  estimatedMemoryGb: number;
  reason: string;
}

export interface HardwareModelSelection {
  selected: HardwareModelCandidate;
  candidates: HardwareModelCandidate[];
  rejected: HardwareModelCandidate[];
  hardware: {
    totalMemoryGb: number;
    usableMemoryGb: number;
    maxLoadedModels: number;
    numParallel: number;
  };
}

export function selectHardwareFitModel(options: {
  description: string;
  installedModels: string[];
  preferredModels?: string[];
  ollama: Pick<PipelineConfig['ollama'], 'maxLoadedModels' | 'numParallel'>;
  totalMemoryBytes?: number;
}): HardwareModelSelection {
  const totalMemoryGb = (options.totalMemoryBytes ?? os.totalmem()) / 1024 ** 3;
  const loadedModelBudget = Math.max(1, options.ollama.maxLoadedModels);
  const usableMemoryGb = Math.max(1, (totalMemoryGb * 0.7) / loadedModelBudget);
  const models = uniqueStrings([
    ...options.installedModels,
    ...(options.preferredModels ?? []),
    ...curatedModelsForDescription(options.description),
    ...fallbackModelCandidates(),
  ]);
  const candidates = models.map((model) => {
    const estimatedMemoryGb = estimateModelMemoryGb(model);
    const installed = options.installedModels.includes(model);
    const fitsHardware = estimatedMemoryGb <= usableMemoryGb;
    return {
      model,
      installed,
      fitsHardware,
      estimatedMemoryGb,
      reason: fitsHardware
        ? `estimated ${formatGb(estimatedMemoryGb)}GB fits within ${formatGb(usableMemoryGb)}GB per loaded model`
        : `estimated ${formatGb(estimatedMemoryGb)}GB exceeds ${formatGb(usableMemoryGb)}GB per loaded model`,
    };
  });

  const fit = candidates
    .filter((candidate) => candidate.fitsHardware)
    .sort((a, b) => modelScore(b, options.description) - modelScore(a, options.description))[0];
  const fallback = candidates
    .filter((candidate) => fallbackModelCandidates().includes(candidate.model))
    .find((candidate) => candidate.fitsHardware) ?? {
      model: 'phi3:mini',
      installed: false,
      fitsHardware: true,
      estimatedMemoryGb: 3,
      reason: 'last-resort small general-purpose model; selected because all researched candidates exceeded the local memory budget',
    };
  const selected = fit ?? fallback;

  return {
    selected,
    candidates,
    rejected: candidates.filter((candidate) => !candidate.fitsHardware),
    hardware: {
      totalMemoryGb,
      usableMemoryGb,
      maxLoadedModels: loadedModelBudget,
      numParallel: Math.max(1, options.ollama.numParallel),
    },
  };
}

function curatedModelsForDescription(description: string): string[] {
  const lower = description.toLowerCase();
  if (/(chem|molecule|drug|metabol|taxonomy|classyfire|chemont|smiles|iupac)/.test(lower)) {
    return [
      'hf.co/AI4Chem/ChemLLM-7B-Chat-1.5-DPO-GGUF:Q4_K_M',
      'qwen2.5:7b',
      'gemma4:9b',
      'gemma4:26b',
    ];
  }
  if (/(code|implement|build|debug|test|typescript|python|sql|database)/.test(lower)) {
    return ['deepseek-coder:latest', 'qwen2.5-coder:7b', 'qwen2.5:7b'];
  }
  if (/(design|ux|visual|presentation)/.test(lower)) {
    return ['qwen2.5:14b', 'qwen2.5:7b', 'gemma4:9b'];
  }
  return ['gemma4:26b', 'qwen2.5:7b', 'llama3.1:8b'];
}

function fallbackModelCandidates(): string[] {
  return ['qwen2.5:3b', 'gemma3:4b', 'phi3:mini'];
}

function estimateModelMemoryGb(model: string): number {
  const lower = model.toLowerCase();
  const match = /(?:^|[^0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/i.exec(lower);
  const params = match ? Number(match[1]) : lower.includes('deepseek-coder') ? 7 : 9;
  const bytesPerParam = /q2|q3/i.test(model)
    ? 0.45
    : /q4|gguf|hf\.co/i.test(model)
      ? 0.65
      : /q5/i.test(model)
        ? 0.8
        : /q8/i.test(model)
          ? 1.2
          : 0.7;
  return Math.max(3, params * bytesPerParam);
}

function modelScore(candidate: HardwareModelCandidate, description: string): number {
  const lower = `${candidate.model}\n${description}`.toLowerCase();
  const domainBonus = /(chem|molecule|drug|metabol|taxonomy)/.test(description.toLowerCase()) && /(chem|hf\.co\/ai4chem)/.test(lower)
    ? 100
    : 0;
  const installedBonus = candidate.installed ? 20 : 0;
  const sizePenalty = candidate.estimatedMemoryGb / 10;
  return domainBonus + installedBonus - sizePenalty;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatGb(value: number): string {
  return value.toFixed(1);
}
