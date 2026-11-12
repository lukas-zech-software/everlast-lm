import { StudioPluginRegistry } from "@everlast/contracts";
import type { StructuredGenerator } from "@everlast/cloud";
import type { EvidenceBatchLimits } from "./evidence.ts";
import { DeterministicMindmapModel, VertexMindmapModel, type MindmapModelClient } from "./mindmaps/model.ts";
import { MindmapGeneratorPlugin } from "./mindmaps/plugin.ts";
import type { BatchLimits } from "./reports/batching.ts";
import { DeterministicReportModel } from "./reports/deterministic-model.ts";
import type { ReportModelClient } from "./reports/model.ts";
import { ReportGeneratorPlugin } from "./reports/plugin.ts";
import { DeterministicDataTableModel, VertexDataTableModel, type DataTableModelClient } from "./tables/model.ts";
import { DataTableGeneratorPlugin } from "./tables/plugin.ts";

/**
 * [011-studio-mindmaps-data-tables] T020, T043 — Typed Studio plugin registry factory registering
 * `report/*`, `mindmap/default`, and `data_table/default` (FR-ST-08/18, FR-ST-10/11, C-03).
 */
export interface StudioRegistryOptions {
  reportModel?: ReportModelClient | undefined;
  reportLimits?: BatchLimits | undefined;
  structureGenerator?: StructuredGenerator | undefined;
  mindmapModel?: MindmapModelClient | undefined;
  mindmapLimits?: EvidenceBatchLimits | undefined;
  dataTableModel?: DataTableModelClient | undefined;
  dataTableLimits?: EvidenceBatchLimits | undefined;
}

export function createStudioPluginRegistry(options: StudioRegistryOptions = {}): StudioPluginRegistry {
  const { structureGenerator } = options;
  const mindmapModel = options.mindmapModel ?? (structureGenerator
    ? new VertexMindmapModel(structureGenerator) : new DeterministicMindmapModel());
  const dataTableModel = options.dataTableModel ?? (structureGenerator
    ? new VertexDataTableModel(structureGenerator) : new DeterministicDataTableModel());
  const registry = new StudioPluginRegistry();
  registry.register(new ReportGeneratorPlugin(options.reportModel ?? new DeterministicReportModel(), options.reportLimits));
  registry.register(new MindmapGeneratorPlugin(mindmapModel, options.mindmapLimits));
  registry.register(new DataTableGeneratorPlugin(dataTableModel, options.dataTableLimits));
  return registry;
}
