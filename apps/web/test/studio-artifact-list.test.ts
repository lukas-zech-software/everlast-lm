import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/studio/markdown.ts";
import { StudioArtifactListController } from "../src/studio/artifact-list.ts";
import type { StudioApi, ArtifactDto } from "../src/studio/api.ts";

const base = { notebook_id: "n", plugin_type: "report", payload_json: null, progress: null, failure: null, attempt: 1, retry_of: null } as const;
const mk = (o: Partial<ArtifactDto> & { id: string; status: ArtifactDto["status"] }): ArtifactDto => ({ ...base, subtype: "briefing_doc", title: "Briefing doc", ...o } as ArtifactDto);

function setup(artifacts: ArtifactDto[]) {
  const calls: string[] = [];
  const api: StudioApi = {
    list: async () => artifacts,
    get: async (id) => ({ artifact: { ...mk({ id, status: "Completed" }), payload_json: { content_md: "# T\n\n- <script>x</script> [1]", citations: [] } } }),
    create: async () => mk({ id: "new", status: "Queued" }),
    cancel: async () => mk({ id: "c", status: "Cancelled" }),
    retry: async () => mk({ id: "r", status: "Queued" }),
    convert: async (id) => (calls.push("convert:" + id), { source_id: "s" }),
    remove: async (id) => void calls.push("delete:" + id),
    suggestions: async () => ({ state: "SuggestionsLoading" }),
  };
  const copied: string[] = [];
  const ctl = new StudioArtifactListController({ api, clipboard: { writeText: async (t) => void copied.push(t) } });
  return { ctl, calls, copied };
}

describe("StudioArtifactListController (FR-ST-10, FR-008)", () => {
  it("disables template buttons for an empty scope", () => {
    const { ctl } = setup([]);
    expect(ctl.templatesEnabled(0)).toBe(false);
    expect(ctl.templatesEnabled(2)).toBe(true);
  });
  it("labels Queued/Running rows 'Generating Briefing doc...' and Failed rows with the explanation", async () => {
    const { ctl } = setup([
      mk({ id: "1", status: "Queued" }),
      mk({ id: "2", status: "Running" }),
      mk({ id: "3", status: "Failed", failure: { code: "SourceChanged", message: "Source was replaced." } }),
    ]);
    await ctl.refresh();
    expect(ctl.rows().map((r) => r.label)).toEqual(["Generating Briefing doc...", "Generating Briefing doc...", "Briefing doc — Source was replaced."]);
  });
  it("opens completed artifacts as escaped Markdown HTML, copies, converts and deletes", async () => {
    const { ctl, calls, copied } = setup([mk({ id: "1", status: "Completed" })]);
    await ctl.refresh();
    const html = await ctl.open("1");
    expect(html).toContain("<h1>T</h1>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    await ctl.copy("1");
    expect(copied[0]).toContain("# T");
    await ctl.convert("1");
    await ctl.remove("1");
    expect(calls).toEqual(["convert:1", "delete:1"]);
    expect(ctl.rows()).toHaveLength(0);
  });
  it("renders tables and badges safely", () => {
    const html = renderMarkdown("| A | B |\n| --- | --- |\n| x | <b>y</b> [1] |");
    expect(html).toContain("<table>");
    expect(html).toContain("&lt;b&gt;");
  });
});
