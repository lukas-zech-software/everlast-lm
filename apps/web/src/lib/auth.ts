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
  signOut: () => Promise<void>;
}

export interface PasswordAuthModule {
  signInWithEmailAndPassword: (auth: unknown, email: string, password: string) => Promise<unknown>;
  createUserWithEmailAndPassword?: (
    auth: unknown,
    email: string,
    password: string,
  ) => Promise<unknown>;
}

interface FirebaseAppModule {
  initializeApp: (config: { apiKey: string; authDomain: string }) => unknown;
}

interface FirebaseUser {
  email?: string | null;
  getIdToken: () => Promise<string>;
}

interface FirebaseAuth {
  tenantId: string | null;
  currentUser: FirebaseUser | null;
}

interface FirebaseAuthModule extends PasswordAuthModule {
  getAuth: (app: unknown) => FirebaseAuth;
  getRedirectResult: (auth: FirebaseAuth) => Promise<unknown>;
  onAuthStateChanged: (auth: FirebaseAuth, cb: (user: FirebaseUser | null) => void) => () => void;
  SAMLAuthProvider: new (providerId: string) => unknown;
  OAuthProvider: new (providerId: string) => unknown;
  signInWithRedirect: (auth: FirebaseAuth, provider: unknown) => Promise<void>;
  signOut: (auth: FirebaseAuth) => Promise<void>;
}

function decodeJwtPayload(token: string): { email?: string; exp?: number } | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    return JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/"))) as {
      email?: string;
      exp?: number;
    };
  } catch {
    return null;
  }
}

function decodeEmail(token: string): string | null {
  return decodeJwtPayload(token)?.email ?? null;
}

function tokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 < Date.now() + 30_000;
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
export function renderPasswordSignIn(
  root: HTMLElement,
  authModule: PasswordAuthModule,
  auth: unknown,
): Promise<void> {
  return new Promise((resolve) => {
    clear(root);
    const email = h("input", {
      type: "email",
      name: "email",
      placeholder: "you@example.com",
      required: true,
      "data-testid": "signin-email",
      autocomplete: "email",
    });
    const password = h("input", {
      type: "password",
      name: "password",
      placeholder: "Password",
      required: true,
      "data-testid": "signin-password",
      autocomplete: "current-password",
    });
    const message = h("p", {
      class: "muted",
      "data-testid": "signin-message",
      text: "Sign in with your existing account. Contact your administrator if you need access.",
    });
    const signIn = h("button", { class: "btn btn-primary", type: "submit", text: "Sign in" });
    const form = h(
      "form",
      { class: "signin", "data-testid": "signin-form" },
      h("h1", { text: "Everlast LM" }),
      message,
      email,
      password,
      signIn,
    );
    const run = async () => {
      if (!form.reportValidity()) return;
      message.textContent = "Signing in…";
      try {
        await authModule.signInWithEmailAndPassword(auth, email.value.trim(), password.value);
        resolve();
      } catch {
        message.textContent =
          "Sign-in failed. Check email and password, or contact your administrator.";
      }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run();
    });
    root.append(form);
    email.focus();
  });
}

function renderLocalSignIn(root: HTMLElement): Promise<string> {
  return new Promise((resolve) => {
    clear(root);
    const input = h("input", {
      type: "email",
      name: "email",
      placeholder: "you@example.com",
      required: true,
      "data-testid": "signin-email",
      autocomplete: "email",
    });
    const form = h(
      "form",
      { class: "signin", "data-testid": "signin-form" },
      h("h1", { text: "Everlast LM" }),
      h("p", { class: "muted", text: "Development sign-in (local identity issuer)." }),
      input,
      h("button", { class: "btn btn-primary", type: "submit", text: "Sign in" }),
    );
    const submitLocalSignIn = async (): Promise<void> => {
      const res = await fetch("/auth/local/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: input.value }),
      });
      if (!res.ok) return;
      const { id_token } = (await res.json()) as { id_token: string };
      resolve(id_token);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitLocalSignIn();
    });
    root.append(form);
    input.focus();
  });
}

function readStoredLocalToken(): string | null {
  try {
    return localStorage.getItem(LOCAL_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function startSession(root: HTMLElement): Promise<Session> {
  const config = (await (await fetch("/auth/config")).json()) as AuthConfig;

  if (config.mode === "local") {
    let token = readStoredLocalToken();
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
      getIdToken: () => Promise.resolve(current),
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
      signOut() {
        current = "";
        localStorage.removeItem(LOCAL_TOKEN_KEY);
        location.assign("/");
        return Promise.resolve();
      },
    };
  }

  const ip = config.identity_platform;
  if (!ip) throw new Error("Identity Platform client configuration is missing");
  // Browser-native, pinned external ESM; TypeScript does not resolve HTTPS modules.
  const appModule = (await import(
    // @ts-expect-error TS2307: browser loads this literal CDN module at runtime (D6, CC-09).
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"
  )) as unknown as FirebaseAppModule;
  const authModule = (await import(
    // @ts-expect-error TS2307: same pinned browser-only Firebase SDK; no computed module path.
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"
  )) as unknown as FirebaseAuthModule;
  const app = appModule.initializeApp({ apiKey: ip.apiKey, authDomain: ip.authDomain });
  const auth = authModule.getAuth(app);
  if (ip.tenantId) auth.tenantId = ip.tenantId;
  await authModule.getRedirectResult(auth).catch(() => null);
  let user = await new Promise<FirebaseUser | null>((resolve) => {
    const unsubscribe = authModule.onAuthStateChanged(auth, (u) => {
      unsubscribe();
      resolve(u);
    });
  });
  if (!user && signInMethod(ip.providerId) === "password") {
    await renderPasswordSignIn(root, authModule, auth);
    user = auth.currentUser;
  }
  if (!user) {
    const provider =
      signInMethod(ip.providerId) === "saml"
        ? new authModule.SAMLAuthProvider(ip.providerId)
        : new authModule.OAuthProvider(ip.providerId);
    await authModule.signInWithRedirect(auth, provider);
    await new Promise<never>(() => undefined); // navigation away
    throw new Error("Redirecting for authentication");
  }
  setTokenProvider({
    getIdToken: () => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null)),
    onUnauthenticated: () => {
      void authModule.signOut(auth).then(() => {
        location.assign("/");
      });
    },
  });
  return {
    email: user.email ?? null,
    signOut: () =>
      authModule.signOut(auth).then(() => {
        location.assign("/");
      }),
  };
}
