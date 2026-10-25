import { StudioPluginRegistry } from "@everlast/contracts";
import type { EvidenceBatchLimits } from "./evidence.ts";
import { DeterministicMindmapModel, type MindmapModelClient } from "./mindmaps/model.ts";
import { MindmapGeneratorPlugin } from "./mindmaps/plugin.ts";
import type { BatchLimits } from "./reports/batching.ts";
import { DeterministicReportModel } from "./reports/deterministic-model.ts";
import type { ReportModelClient } from "./reports/model.ts";
import { ReportGeneratorPlugin } from "./reports/plugin.ts";
import { DeterministicDataTableModel, type DataTableModelClient } from "./tables/model.ts";
import { DataTableGeneratorPlugin } from "./tables/plugin.ts";

/**
 * [011-studio-mindmaps-data-tables] T020, T043 — Typed Studio plugin registry factory registering
 * `report/*`, `mindmap/default`, and `data_table/default` (FR-ST-08/18, FR-ST-10/11, C-03).
 */
export interface StudioRegistryOptions {
  reportModel?: ReportModelClient | undefined;
  reportLimits?: BatchLimits | undefined;
  mindmapModel?: MindmapModelClient | undefined;
  mindmapLimits?: EvidenceBatchLimits | undefined;
  dataTableModel?: DataTableModelClient | undefined;
  dataTableLimits?: EvidenceBatchLimits | undefined;
}

export function createStudioPluginRegistry(options: StudioRegistryOptions = {}): StudioPluginRegistry {
  const registry = new StudioPluginRegistry();
  registry.register(new ReportGeneratorPlugin(options.reportModel ?? new DeterministicReportModel(), options.reportLimits));
  registry.register(new MindmapGeneratorPlugin(options.mindmapModel ?? new DeterministicMindmapModel(), options.mindmapLimits));
  registry.register(new DataTableGeneratorPlugin(options.dataTableModel ?? new DeterministicDataTableModel(), options.dataTableLimits));
  return registry;
}
