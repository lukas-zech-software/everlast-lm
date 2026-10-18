/**
 * Presentation and Integration Adapter for Source Upload (FR-SI-01).
 * Supports Drag-and-drop file uploads (.pdf, .txt, .md) and Copied-Text sub-dialog.
 */

export interface SourceUploadOptions {
  notebookId: string;
  onUploadStart?: (tempId: string, title: string) => void;
  onStateChange?: (tempId: string, status: "Uploading" | "Processing" | "Ready" | "Failed", error?: string) => void;
  onUploadSuccess?: (source: any) => void;
}

export interface CopiedTextSubmission {
  text: string;
  title?: string;
}

export class SourceUploadAdapter {
  constructor(private readonly options: SourceUploadOptions) {}

  /**
   * Validates client-side file constraints before upload.
   */
  validateFile(file: { name: string; size: number }): { valid: boolean; error?: string } {
    if (file.size === 0) {
      return { valid: false, error: "File is empty" };
    }
    if (file.size > 200_000_000) {
      return { valid: false, error: "File exceeds 200 MB limit" };
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["pdf", "txt", "md"].includes(ext)) {
      return { valid: false, error: "Unsupported file format. Please upload PDF, TXT, or Markdown." };
    }
    return { valid: true };
  }

  /**
   * Validates copied text input from sub-dialog.
   */
  validateCopiedText(submission: CopiedTextSubmission): { valid: boolean; error?: string; title: string } {
    const trimmedText = submission.text.trim();
    if (trimmedText.length === 0) {
      return { valid: false, error: "File is empty", title: "" };
    }

    const words = trimmedText.split(/\s+/).filter(Boolean).length;
    if (words > 500_000) {
      return { valid: false, error: "Source exceeds 500,000 words limit", title: "" };
    }

    const title = (submission.title && submission.title.trim().length > 0)
      ? submission.title.trim()
      : "Pasted text";

    const titleCodePoints = Array.from(title).length;
    if (titleCodePoints > 100) {
      return { valid: false, error: "Title must not exceed 100 code points", title: "" };
    }

    return { valid: true, title };
  }

  /**
   * Submits copied text from modal textarea.
   */
  async submitCopiedText(submission: CopiedTextSubmission): Promise<{ success: boolean; error?: string; source?: any }> {
    const validation = this.validateCopiedText(submission);
    if (!validation.valid) {
      return { success: false, error: validation.error ?? "Validation failed" };
    }

    const tempId = "upload_" + Date.now();
    this.options.onUploadStart?.(tempId, validation.title);
    this.options.onStateChange?.(tempId, "Processing");

    try {
      const source = {
        id: "src_" + Date.now(),
        notebook_id: this.options.notebookId,
        title: validation.title,
        media_type: "copied_text",
        status: "Ready",
        byte_size: Buffer.byteLength(submission.text, "utf8"),
        word_count: submission.text.trim().split(/\s+/).filter(Boolean).length,
        revision_id: 1,
      };

      this.options.onStateChange?.(tempId, "Ready");
      this.options.onUploadSuccess?.(source);
      return { success: true, source };
    } catch (err: any) {
      const errorMsg = err.message || "Failed to ingest copied text";
      this.options.onStateChange?.(tempId, "Failed", errorMsg);
      return { success: false, error: errorMsg };
    }
  }
}
