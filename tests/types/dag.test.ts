// tests/types/dag.test.ts
import { describe, it, expect } from 'vitest';
import type { DAGPlan, DAGStep, StepResult, DAGNode, DAGEdge } from '../../src/types/dag.js';
import { validateDAGPlan, topologicalSort, getReadySteps, buildDAGResult } from '../../src/types/dag.js';

describe('DAG types', () => {
  const linearPlan: DAGPlan = {
    plan: [
      { id: 'step-1', agent: 'researcher', task: 'Research topic', dependsOn: [] },
      { id: 'step-2', agent: 'coder', task: 'Implement', dependsOn: ['step-1'] },
    ],
  };

  const parallelPlan: DAGPlan = {
    plan: [
      { id: 'step-1', agent: 'researcher', task: 'Research A', dependsOn: [] },
      { id: 'step-2', agent: 'database', task: 'Query B', dependsOn: [] },
      { id: 'step-3', agent: 'coder', task: 'Implement', dependsOn: ['step-1', 'step-2'] },
    ],
  };

  describe('validateDAGPlan', () => {
    it('accepts a valid linear plan', () => {
      expect(validateDAGPlan(linearPlan)).toEqual({ valid: true });
    });

    it('accepts a valid parallel plan', () => {
      expect(validateDAGPlan(parallelPlan)).toEqual({ valid: true });
    });

    it('rejects empty plan', () => {
      const result = validateDAGPlan({ plan: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('rejects duplicate step ids', () => {
      const plan: DAGPlan = {
        plan: [
          { id: 'step-1', agent: 'a', task: 'x', dependsOn: [] },
          { id: 'step-1', agent: 'b', task: 'y', dependsOn: [] },
        ],
      };
      const result = validateDAGPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('duplicate');
    });

    it('rejects reference to unknown dependency', () => {
      const plan: DAGPlan = {
        plan: [
          { id: 'step-1', agent: 'a', task: 'x', dependsOn: ['step-99'] },
        ],
      };
      const result = validateDAGPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('unknown');
    });

    it('rejects cyclic dependency', () => {
      const plan: DAGPlan = {
        plan: [
          { id: 'step-1', agent: 'a', task: 'x', dependsOn: ['step-2'] },
          { id: 'step-2', agent: 'b', task: 'y', dependsOn: ['step-1'] },
        ],
      };
      const result = validateDAGPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cycle');
    });
  });

  describe('topologicalSort', () => {
    it('sorts linear plan in order', () => {
      const sorted = topologicalSort(linearPlan);
      expect(sorted.map((s) => s.id)).toEqual(['step-1', 'step-2']);
    });

    it('puts independent steps before dependents', () => {
      const sorted = topologicalSort(parallelPlan);
      const step3Idx = sorted.findIndex((s) => s.id === 'step-3');
      const step1Idx = sorted.findIndex((s) => s.id === 'step-1');
      const step2Idx = sorted.findIndex((s) => s.id === 'step-2');
      expect(step3Idx).toBeGreaterThan(step1Idx);
      expect(step3Idx).toBeGreaterThan(step2Idx);
    });
  });

  describe('getReadySteps', () => {
    it('returns steps with no dependencies first', () => {
      const completed = new Set<string>();
      const ready = getReadySteps(parallelPlan, completed);
      expect(ready.map((s) => s.id).sort()).toEqual(['step-1', 'step-2']);
    });

    it('returns dependent step once dependencies are met', () => {
      const completed = new Set(['step-1', 'step-2']);
      const ready = getReadySteps(parallelPlan, completed);
      expect(ready.map((s) => s.id)).toEqual(['step-3']);
    });

    it('returns independent step even when a peer is already completed', () => {
      const completed = new Set(['step-1']);
      const ready = getReadySteps(parallelPlan, completed);
      expect(ready.map((s) => s.id)).toEqual(['step-2']);
    });

    it('returns empty when all steps are completed', () => {
      const completed = new Set(['step-1', 'step-2', 'step-3']);
      const ready = getReadySteps(parallelPlan, completed);
      expect(ready).toEqual([]);
    });
  });

  describe('buildDAGResult', () => {
    it('includes runtime recovery edges in addition to planned dependencies', () => {
      const plan: DAGPlan = {
        plan: [
          { id: 'step-1', agent: 'implementation-coder', task: 'Implement', dependsOn: [] },
          { id: 'step-1-recovery-1', agent: 'build-fixer', task: 'Fix compile', dependsOn: [] },
          { id: 'step-1-retry-1', agent: 'implementation-coder', task: 'Retry', dependsOn: ['step-1-recovery-1'] },
        ],
      };
      const results: StepResult[] = [
        {
          id: 'step-1',
          agent: 'implementation-coder',
          task: 'Implement',
          status: 'recovered',
          parentStepId: 'step-1',
          replacementStepId: 'step-1-retry-1',
        },
        {
          id: 'step-1-recovery-1',
          agent: 'build-fixer',
          task: 'Fix compile',
          status: 'completed',
          parentStepId: 'step-1',
          edgeType: 'recovery',
          spawnedByAgent: 'implementation-coder',
        },
        {
          id: 'step-1-retry-1',
          agent: 'implementation-coder',
          task: 'Retry',
          status: 'completed',
          parentStepId: 'step-1',
          edgeType: 'recovery',
        },
      ];

      const dag = buildDAGResult(results, plan);
      expect(dag.nodes).toHaveLength(3);
      expect(dag.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: 'step-1-recovery-1', to: 'step-1-retry-1', type: 'planned' }),
          expect.objectContaining({ from: 'step-1', to: 'step-1-recovery-1', type: 'recovery' }),
          expect.objectContaining({ from: 'step-1', to: 'step-1-retry-1', type: 'recovery' }),
        ]),
      );
    });

    it('carries consensus metadata into DAG graph nodes', () => {
      const plan: DAGPlan = {
        plan: [{ id: 'step-1', agent: 'researcher', task: 'Research', dependsOn: [] }],
      };
      const results: StepResult[] = [{
        id: 'step-1',
        agent: 'researcher',
        task: 'Research',
        status: 'completed',
        consensus: {
          enabled: true,
          runs: 3,
          candidateCount: 3,
          selectedRun: 2,
          agreement: 2 / 3,
          method: 'exact-majority',
          participants: [
            { run: 1, provider: 'ollama', model: 'gemma4:26b', status: 'valid', contribution: 0.5 },
            { run: 2, provider: 'ollama', model: 'qwen2.5:14b', status: 'selected', contribution: 1 },
          ],
        },
      }];

      const dag = buildDAGResult(results, plan);

      expect((dag.nodes[0] as any).consensus).toMatchObject({
        runs: 3,
        method: 'exact-majority',
        selectedRun: 2,
      });
      expect((dag.nodes[0] as any).consensus.participants).toHaveLength(2);
    });

  });
});
