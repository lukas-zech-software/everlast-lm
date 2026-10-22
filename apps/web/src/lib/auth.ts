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

const FIREBASE_VERSION = "12.19.0";
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
 * Identity Platform sign-in method for one provider id (D6). `google.com` (Google, owner decision 2026-10-22) and
 * `password` (email/password, owner decision 2026-10-20) are the dev PoC methods; `saml.*` and other ids redirect
 * to the OIDC/SAML provider.
 */
export function signInMethod(providerId: string): "google" | "password" | "saml" | "oauth" {
  if (providerId === "google.com") return "google";
  if (providerId === "password") return "password";
  return providerId.startsWith("saml.") ? "saml" : "oauth";
}

/** Sign-in methods for a comma-separated provider id list, in configured order (dev PoC: `google.com,password`). */
export function signInMethods(providerIds: string): ReturnType<typeof signInMethod>[] {
  return providerIds.split(",").map((id) => id.trim()).filter(Boolean).map(signInMethod);
}

function authErrorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code ?? "");
}

/**
 * Sign-in page for the dev PoC methods: a "Sign in with Google" button and/or the email/password form (sign in, or
 * create the account on first use). Google uses a popup rather than a redirect, because the redirect flow needs the
 * auth domain (`<project>.firebaseapp.com`) to share storage with the app, which current browsers block.
 */
function renderInteractiveSignIn(root: HTMLElement, authModule: any, auth: unknown, methods: { google: boolean; password: boolean }): Promise<void> {
  return new Promise((resolve) => {
    clear(root);
    const message = h("p", {
      class: "muted",
      "data-testid": "signin-message",
      text: methods.password ? "Sign in, or create an account with a new email and password." : "Sign in with your Google account.",
    });
    const form = h("form", { class: "signin", "data-testid": "signin-form" }, h("h1", { text: "Everlast LM" }), message);
    let focusTarget: HTMLElement | null = null;

    if (methods.google) {
      const google = h("button", { class: methods.password ? "btn" : "btn btn-primary", type: "button", "data-testid": "signin-google", text: "Sign in with Google" });
      google.addEventListener("click", async () => {
        message.textContent = "Signing in…";
        try {
          await authModule.signInWithPopup(auth, new authModule.GoogleAuthProvider());
          resolve();
        } catch (error) {
          const code = authErrorCode(error);
          message.textContent =
            code === "auth/popup-blocked" ? "The browser blocked the sign-in window. Allow pop-ups for this site and try again." :
            code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" ? "Sign-in was cancelled." :
            "Google sign-in failed. Please try again.";
        }
      });
      form.append(google);
      focusTarget = google;
      if (methods.password) form.append(h("p", { class: "muted", text: "or" }));
    }

    if (methods.password) {
      const email = h("input", { type: "email", name: "email", placeholder: "you@example.com", required: true, "data-testid": "signin-email", autocomplete: "email" });
      const password = h("input", { type: "password", name: "password", placeholder: "Password (min. 6 characters)", required: true, minlength: "6", "data-testid": "signin-password", autocomplete: "current-password" });
      const signIn = h("button", { class: "btn btn-primary", type: "submit", text: "Sign in" });
      const signUp = h("button", { class: "btn", type: "button", "data-testid": "signup", text: "Create account" });
      form.append(email, password, signIn, signUp);
      const run = async (create: boolean) => {
        if (!form.reportValidity()) return;
        message.textContent = create ? "Creating account…" : "Signing in…";
        try {
          if (create) await authModule.createUserWithEmailAndPassword(auth, email.value.trim(), password.value);
          else await authModule.signInWithEmailAndPassword(auth, email.value.trim(), password.value);
          resolve();
        } catch (error) {
          const code = authErrorCode(error);
          message.textContent =
            code === "auth/email-already-in-use" ? "This email already has an account. Use Sign in." :
            code === "auth/weak-password" ? "The password needs at least 6 characters." :
            create ? "The account could not be created." : "Sign-in failed. Check email and password, or create an account.";
        }
      };
      form.addEventListener("submit", (event) => { event.preventDefault(); void run(false); });
      signUp.addEventListener("click", () => void run(true));
      focusTarget = email;
    } else {
      form.addEventListener("submit", (event) => event.preventDefault());
    }

    root.append(form);
    focusTarget?.focus();
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
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = (await import(/* @vite-ignore */ `${base}/firebase-app.js`)) as any;
  const authModule = (await import(/* @vite-ignore */ `${base}/firebase-auth.js`)) as any;
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
  const providerIds = ip.providerId.split(",").map((id) => id.trim()).filter(Boolean);
  const methods = signInMethods(ip.providerId);
  const interactive = { google: methods.includes("google"), password: methods.includes("password") };
  if (!user && (interactive.google || interactive.password)) {
    await renderInteractiveSignIn(root, authModule, auth, interactive);
    user = auth.currentUser;
  }
  if (!user) {
    const providerId = providerIds[0] ?? "";
    const provider = signInMethod(providerId) === "saml" ? new authModule.SAMLAuthProvider(providerId) : new authModule.OAuthProvider(providerId);
    await authModule.signInWithRedirect(auth, provider);
    await new Promise(() => undefined); // navigation away
  }
  setTokenProvider({
    getIdToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
    onUnauthenticated: () => void authModule.signOut(auth).then(() => location.assign("/")),
  });
  return { email: user.email ?? null, signOut: () => authModule.signOut(auth).then(() => location.assign("/")) };
}
