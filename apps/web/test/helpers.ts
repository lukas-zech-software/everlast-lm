import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** E2E helpers: sign in through the real UI; seed data through the real authenticated API. */

let counter = 0;
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${counter++}@example.test`;
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/");
  await page.getByTestId("signin-email").fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("notebook-grid")).toBeVisible();
}

export async function token(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post("/auth/local/login", { data: { email } });
  return ((await res.json()) as { id_token: string }).id_token;
}

export async function apiCall<T>(request: APIRequestContext, email: string, method: string, path: string, data?: unknown): Promise<T> {
  const res = await request.fetch(path, {
    method,
    headers: { authorization: `Bearer ${await token(request, email)}` },
    ...(data !== undefined ? { data } : {}),
  });
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBe(true);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

export async function createNotebook(request: APIRequestContext, email: string, title?: string): Promise<string> {
  const body = await apiCall<{ notebook: { id: string } }>(request, email, "POST", "/api/notebooks", title ? { title } : {});
  return body.notebook.id;
}

export async function addTextSource(request: APIRequestContext, email: string, notebookId: string, text: string): Promise<string> {
  const { source } = await apiCall<{ source: { id: string } }>(request, email, "POST", `/api/notebooks/${notebookId}/sources/text`, {
    attempt_id: randomUUID(),
    text,
  });
  return source.id;
}

/** Uploads a file through the real upload capability flow. */
export async function uploadSource(request: APIRequestContext, email: string, notebookId: string, fileName: string, bytes: Buffer): Promise<string> {
  const attempt = randomUUID();
  const { items } = await apiCall<{ items: { source: { id: string }; upload: { url: string; headers: Record<string, string> } }[] }>(
    request,
    email,
    "POST",
    `/api/notebooks/${notebookId}/sources/uploads`,
    { files: [{ attempt_id: attempt, file_name: fileName, declared_bytes: bytes.length }] }
  );
  const item = items[0]!;
  const put = await request.fetch(item.upload.url, { method: "PUT", headers: item.upload.headers, data: bytes });
  expect(put.status()).toBe(204);
  await apiCall(request, email, "POST", `/api/notebooks/${notebookId}/sources/${item.source.id}/complete`, { attempt_id: attempt });
  return item.source.id;
}

export async function waitReady(request: APIRequestContext, email: string, notebookId: string, count: number): Promise<void> {
  await expect
    .poll(async () => {
      const { sources } = await apiCall<{ sources: { status: string }[] }>(request, email, "GET", `/api/notebooks/${notebookId}/sources`);
      return sources.filter((s) => s.status === "Ready" || s.status === "Failed").length;
    }, { timeout: 30_000 })
    .toBe(count);
}
