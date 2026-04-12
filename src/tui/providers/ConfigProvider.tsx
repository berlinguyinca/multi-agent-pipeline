import React, { createContext, useContext } from 'react';
import type { PipelineConfig } from '../../types/config.js';
import type { DetectionResult } from '../../types/adapter.js';

interface ConfigContextValue {
  config: PipelineConfig;
  detection: DetectionResult;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}

export interface ConfigProviderProps {
  config: PipelineConfig;
  detection: DetectionResult;
  children?: React.ReactNode;
}

export function ConfigProvider({ config, detection, children }: ConfigProviderProps) {
  return React.createElement(
    ConfigContext.Provider,
    { value: { config, detection } },
    children,
  );
}
