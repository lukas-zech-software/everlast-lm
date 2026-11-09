import { h, clear } from "./dom.ts";
import { setTokenProvider } from "./api.ts";

/**
 * Sign-in session (FR-WM-04, D6). Production uses Identity Platform (Firebase Auth JS SDK) with the configured
 * OIDC/SAML provider and sends fresh ID tokens. Local development uses the API's local issuer, which is
 * refused in production by the server.
 */

interface AuthConfig {
  mode: "identity-platform" | "local";
  identity_platform?: { apiKey: string; authDomain: string; providerId: string; tenantId?: string };
}

const LOCAL_TOKEN_KEY = "everlast.localToken";

export interface Session {
  email: string | null;
  signOut(): Promise<void>;
}

function decodeEmail(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string; exp?: number };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

function tokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return !payload.exp || payload.exp * 1000 < Date.now() + 30_000;
  } catch {
    return true;
  }
}

/**
 * Identity Platform sign-in method from the configured provider id (D6). `password` is the dev PoC method
 * (Identity Platform email/password, no external IdP); `saml.*` and other ids redirect to the OIDC/SAML provider.
 */
export function signInMethod(providerId: string): "password" | "saml" | "oauth" {
  if (providerId === "password") return "password";
  return providerId.startsWith("saml.") ? "saml" : "oauth";
}

/** FR-WM-04 / D22: existing accounts sign in; administrators provision new accounts. */
export function renderPasswordSignIn(root: HTMLElement, authModule: any, auth: unknown): Promise<void> {
  return new Promise((resolve) => {
    clear(root);
    const email = h("input", { type: "email", name: "email", placeholder: "you@example.com", required: true, "data-testid": "signin-email", autocomplete: "email" });
    const password = h("input", { type: "password", name: "password", placeholder: "Password", required: true, "data-testid": "signin-password", autocomplete: "current-password" });
    const message = h("p", { class: "muted", "data-testid": "signin-message", text: "Sign in with your existing account. Contact your administrator if you need access." });
    const signIn = h("button", { class: "btn btn-primary", type: "submit", text: "Sign in" });
    const form = h("form", { class: "signin", "data-testid": "signin-form" }, h("h1", { text: "Everlast LM" }), message, email, password, signIn);
    const run = async () => {
      if (!form.reportValidity()) return;
      message.textContent = "Signing in…";
      try {
        await authModule.signInWithEmailAndPassword(auth, email.value.trim(), password.value);
        resolve();
      } catch (error) {
        message.textContent = "Sign-in failed. Check email and password, or contact your administrator.";
      }
    };
    form.addEventListener("submit", (event) => { event.preventDefault(); void run(); });
    root.append(form);
    email.focus();
  });
}

function renderLocalSignIn(root: HTMLElement): Promise<string> {
  return new Promise((resolve) => {
    clear(root);
    const input = h("input", { type: "email", name: "email", placeholder: "you@example.com", required: true, "data-testid": "signin-email", autocomplete: "email" });
    const form = h(
      "form",
      { class: "signin", "data-testid": "signin-form" },
      h("h1", { text: "Everlast LM" }),
      h("p", { class: "muted", text: "Development sign-in (local identity issuer)." }),
      input,
      h("button", { class: "btn btn-primary", type: "submit", text: "Sign in" })
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const res = await fetch("/auth/local/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: input.value }),
      });
      if (!res.ok) return;
      const { id_token } = (await res.json()) as { id_token: string };
      resolve(id_token);
    });
    root.append(form);
    input.focus();
  });
}

export async function startSession(root: HTMLElement): Promise<Session> {
  const config = (await (await fetch("/auth/config")).json()) as AuthConfig;

  if (config.mode === "local") {
    let token: string | null = null;
    try {
      token = localStorage.getItem(LOCAL_TOKEN_KEY);
    } catch {
      token = null;
    }
    if (!token || tokenExpired(token)) {
      token = await renderLocalSignIn(root);
      try {
        localStorage.setItem(LOCAL_TOKEN_KEY, token);
      } catch {
        /* session survives only this page */
      }
    }
    let current = token;
    setTokenProvider({
      getIdToken: async () => current,
      onUnauthenticated: () => {
        try {
          localStorage.removeItem(LOCAL_TOKEN_KEY);
        } catch {
          /* ignore */
        }
        location.reload();
      },
    });
    return {
      email: decodeEmail(current),
      async signOut() {
        current = "";
        localStorage.removeItem(LOCAL_TOKEN_KEY);
        location.assign("/");
      },
    };
  }

  const ip = config.identity_platform;
  if (!ip) throw new Error("Identity Platform client configuration is missing");
  // Browser-native, pinned external ESM; TypeScript does not resolve HTTPS modules.
  // @ts-expect-error TS2307: browser loads this literal CDN module at runtime (D6, CC-09).
  const { initializeApp } = (await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js")) as any;
  // @ts-expect-error TS2307: same pinned browser-only Firebase SDK; no computed module path.
  const authModule = (await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js")) as any;
  const app = initializeApp({ apiKey: ip.apiKey, authDomain: ip.authDomain });
  const auth = authModule.getAuth(app);
  if (ip.tenantId) auth.tenantId = ip.tenantId;
  await authModule.getRedirectResult(auth).catch(() => null);
  let user = await new Promise<any>((resolve) => {
    const unsubscribe = authModule.onAuthStateChanged(auth, (u: unknown) => {
      unsubscribe();
      resolve(u);
    });
  });
  if (!user && signInMethod(ip.providerId) === "password") {
    await renderPasswordSignIn(root, authModule, auth);
    user = auth.currentUser;
  }
  if (!user) {
    const provider = signInMethod(ip.providerId) === "saml" ? new authModule.SAMLAuthProvider(ip.providerId) : new authModule.OAuthProvider(ip.providerId);
    await authModule.signInWithRedirect(auth, provider);
    await new Promise(() => undefined); // navigation away
  }
  setTokenProvider({
    getIdToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
    onUnauthenticated: () => void authModule.signOut(auth).then(() => location.assign("/")),
  });
  return { email: user.email ?? null, signOut: () => authModule.signOut(auth).then(() => location.assign("/")) };
}
