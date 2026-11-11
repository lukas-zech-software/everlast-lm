// Compatibility re-export: the adapter now lives in the shared `@everlast/cloud/topic-emoji`
// module (FR-WM-02, D23, CC-09). Existing API/worker consumers keep this path until the
// serialized integration slot repoints them (see specs/005-workspace-ui-comfort/evidence).
export * from "@everlast/cloud/topic-emoji";
