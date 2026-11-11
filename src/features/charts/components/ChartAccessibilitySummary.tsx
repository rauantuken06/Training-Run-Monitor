import type { ChartModel } from '../model/chartModel';
import { chartSummaryText } from '../model/summaryText';

export function ChartAccessibilitySummary({ model }: { model: ChartModel }) {
  return <p className="text-xs text-slate-700 dark:text-slate-300">{chartSummaryText(model)}</p>;
}
