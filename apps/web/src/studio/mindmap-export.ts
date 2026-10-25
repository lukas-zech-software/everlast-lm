import type { StudioMindmapExportScene } from "@everlast/contracts";

/**
 * [011-studio-mindmaps-data-tables] T033 — Browser SVG download, 2x Canvas PNG conversion,
 * and pending Blob/object-URL revocation cleanup (FR-ST-09, NFR-SEC-02, NFR-EVAL-04; FR-004, FR-011, FR-014, SC-004, SC-008).
 */

const activeObjectUrls = new Set<string>();

export function revokePendingExportUrls(): void {
  for (const url of activeObjectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore if already revoked or in mock DOM
    }
  }
  activeObjectUrls.clear();
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  activeObjectUrls.add(url);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
    activeObjectUrls.delete(url);
  }, 5_000);
}

/**
 * Rasterizes a validated self-contained SVG scene to a 2x resolution PNG Blob using the browser Canvas API.
 */
export async function rasterizeSvgSceneToPng(scene: StudioMindmapExportScene): Promise<Blob> {
  const scale = scene.scale ?? 2;
  const targetWidth = Math.round(scene.width * scale);
  const targetHeight = Math.round(scene.height * scale);

  const svgBlob = new Blob([scene.svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  activeObjectUrls.add(svgUrl);

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not rasterize mindmap SVG to PNG."));
      img.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D Canvas context is unavailable.");
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error("Canvas PNG encoding failed."));
        else resolve(blob);
      }, "image/png");
    });
    return pngBlob;
  } finally {
    try {
      URL.revokeObjectURL(svgUrl);
    } catch {
      // ignore
    }
    activeObjectUrls.delete(svgUrl);
  }
}

export async function downloadMindmapScene(scene: StudioMindmapExportScene): Promise<void> {
  if (scene.format === "svg") {
    const blob = new Blob([scene.svg], { type: "image/svg+xml;charset=utf-8" });
    triggerBlobDownload(blob, scene.filename.endsWith(".svg") ? scene.filename : `${scene.filename}.svg`);
    return;
  }
  const pngBlob = await rasterizeSvgSceneToPng(scene);
  triggerBlobDownload(pngBlob, scene.filename.endsWith(".png") ? scene.filename : `${scene.filename}.png`);
}
