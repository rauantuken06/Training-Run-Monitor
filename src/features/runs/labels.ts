import type { DataQualitySeverity, MetricKey, RunScenario, RunStatus } from '../../types/training';

export const STATUS_LABEL: Readonly<Record<RunStatus, string>> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};

export const SCENARIO_LABEL: Readonly<Record<RunScenario, string>> = {
  healthy: 'Healthy',
  noisy: 'Noisy',
  plateau: 'Plateau',
  diverging: 'Diverging',
  nan_loss: 'NaN loss',
  infinite_loss: 'Infinite loss',
  duplicate_steps: 'Duplicate steps',
  unsorted_steps: 'Unsorted steps',
  missing_steps: 'Missing steps',
  missing_values: 'Missing values',
  large_dataset: '1M points',
  loss_spike: 'Loss spike',
};

export const METRIC_LABEL: Readonly<Record<MetricKey, string>> = {
  loss: 'Loss',
  lr: 'Learning rate',
  grad_norm: 'Gradient norm',
};

export const SEVERITY_LABEL: Readonly<Record<DataQualitySeverity, string>> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};
