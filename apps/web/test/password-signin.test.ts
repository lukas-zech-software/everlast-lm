import { afterEach, expect, it, vi } from "vitest";
import { MockElement, setupMockDOM } from "./mock-dom.ts";
import { renderPasswordSignIn } from "../src/lib/auth.ts";
/** [001-workspace-foundation] T058 — FR-WM-04, NFR-SEC-02, D22: sign-in survives disabled signup. */
afterEach(() => vi.unstubAllGlobals());
it("offers existing-account sign-in without creating accounts", async () => {
  const { document } = setupMockDOM();
  Object.assign(MockElement.prototype, { getAttributeNames() { return []; } });
  const root = document.createElement("main");
  const signInWithEmailAndPassword = vi.fn().mockResolvedValue({});
  const createUserWithEmailAndPassword = vi.fn();
  const done = renderPasswordSignIn(root as unknown as HTMLElement, { signInWithEmailAndPassword, createUserWithEmailAndPassword }, {});
  expect(root.querySelector('[data-testid="signup"]')).toBeNull();
  expect(root.querySelector('[data-testid="signin-message"]')!.textContent).toMatch(/administrator/i);
  const form = root.querySelector("form")!;
  Object.assign(form, { reportValidity: () => true });
  Object.assign(root.querySelector('[data-testid="signin-email"]')!, { value: " existing@example.test " });
  Object.assign(root.querySelector('[data-testid="signin-password"]')!, { value: "password-value" });
  form.dispatchEvent({ type: "submit", preventDefault() {} });
  await done;
  expect(signInWithEmailAndPassword).toHaveBeenCalledWith({}, "existing@example.test", "password-value");
  expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
});
