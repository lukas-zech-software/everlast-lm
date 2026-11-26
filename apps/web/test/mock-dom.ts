/**
 * Lightweight in-memory DOM harness for Vitest tests running in Node environment.
 * Supports element hierarchy, classList, dataset, compound querySelector, innerHTML parsing, events, and localStorage.
 */

export interface MockEvent {
  type: string;
  target?: unknown;
  currentTarget?: unknown;
  detail?: unknown;
  preventDefault?: () => void;
  stopPropagation?: () => void;
  [key: string]: unknown;
}

export type MockEventListener = (event: MockEvent) => void;

export function asHTMLElement(el: MockElement): HTMLElement {
  return el as unknown as HTMLElement;
}

export function asMockElement(el: unknown): MockElement {
  return el as MockElement;
}

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

interface GlobalWithMockDOM {
  window?: unknown;
  document?: { activeElement?: MockElement | null };
  localStorage?: unknown;
  HTMLElement?: unknown;
}

export class MockClassList {
  private readonly classes = new Set<string>();

  constructor(initial = "") {
    if (initial) {
      initial
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => this.classes.add(c));
    }
  }

  add(...tokens: string[]) {
    tokens.forEach((t) => {
      if (t) {
        t.split(/\s+/)
          .filter(Boolean)
          .forEach((c) => this.classes.add(c));
      }
    });
  }

  remove(...tokens: string[]) {
    tokens.forEach((t) => {
      if (t) {
        t.split(/\s+/)
          .filter(Boolean)
          .forEach((c) => this.classes.delete(c));
      }
    });
  }

  contains(token: string): boolean {
    return this.classes.has(token);
  }

  toggle(token: string, force?: boolean): boolean {
    if (force === true) {
      this.classes.add(token);
      return true;
    }
    if (force === false) {
      this.classes.delete(token);
      return false;
    }
    if (this.classes.has(token)) {
      this.classes.delete(token);
      return false;
    }
    this.classes.add(token);
    return true;
  }

  toString(): string {
    return [...this.classes].join(" ");
  }
}

function parseAttributes(raw: string, el: MockElement) {
  if (!raw) return;
  const attrRegex = /([a-zA-Z0-9-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(raw)) !== null) {
    const name = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    if (name) {
      el.setAttribute(name, val);
    }
  }
}

export function parseHTMLToElements(html: string): MockElement[] {
  const root = new MockElement("root");
  let current: MockElement = root;
  const stack: MockElement[] = [root];

  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9-]+)([^>]*?)(\/)?>|([^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    const [, isClosing, tagName, rawAttrs = "", isSelfClosing, textContent] = match;

    if (textContent) {
      const text = textContent.trim();
      if (text) {
        if (current === root) {
          const textEl = new MockElement("span");
          textEl.textContent = text;
          root.appendChild(textEl);
        } else {
          current.textContent = (current.textContent ? `${current.textContent} ` : "") + text;
        }
      }
    } else if (tagName) {
      const tag = tagName.toLowerCase();
      const isVoid =
        Boolean(isSelfClosing) || ["img", "input", "br", "hr", "meta", "link"].includes(tag);

      if (isClosing) {
        for (let i = stack.length - 1; i > 0; i--) {
          const stackItem = stack[i];
          if (stackItem?.tagName.toLowerCase() === tag) {
            stack.splice(i);
            current = stack[stack.length - 1] ?? root;
            break;
          }
        }
      } else {
        const el = new MockElement(tag);
        parseAttributes(rawAttrs, el);
        current.appendChild(el);

        if (!isVoid) {
          stack.push(el);
          current = el;
        }
      }
    }
  }

  return root.children;
}

/** One simple selector (`.a.b`, `#id`, `[attr]`, `[attr=value]`, `tag`) against one element. */
function matchesSimple(el: MockElement, sel: string): boolean {
  if (sel.startsWith(".") && sel.includes(".", 1)) {
    const classes = sel.split(".").filter(Boolean);
    return classes.every((c) => el.classList.contains(c));
  }
  if (sel.startsWith("#")) {
    return el.id === sel.slice(1);
  }
  if (sel.startsWith(".")) {
    return el.classList.contains(sel.slice(1));
  }
  if (sel.startsWith("[") && sel.endsWith("]")) {
    const inner = sel.slice(1, -1);
    if (inner.includes("=")) {
      const [attr, rawVal = ""] = inner.split("=");
      const val = rawVal.replace(/['"]/g, "");
      if (attr) {
        return el.getAttribute(attr) === val;
      }
    }
    return el.getAttribute(inner) !== null;
  }
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

/** Selector list with optional descendant parts (`.card-head button, .menu`), as used by `closest()`. */
function matchesSelectorList(el: MockElement, selector: string): boolean {
  return selector.split(",").some((part) => {
    const steps = part.trim().split(/\s+/).filter(Boolean);
    const last = steps.pop();
    if (!last || !matchesSimple(el, last)) return false;
    let ancestor = el.parentElement;
    for (let i = steps.length - 1; i >= 0; i--) {
      while (ancestor && !matchesSimple(ancestor, steps[i]!)) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

export class MockElement {
  tagName: string;
  id = "";
  classList: MockClassList;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  value = "";
  scrollTop = 0;
  private _className = "";
  private readonly eventListeners: Record<string, MockEventListener[]> = {};
  private _textContent = "";

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList();
  }

  get className(): string {
    return this.classList.toString() || this._className;
  }

  set className(value: string) {
    this._className = value;
    this.classList = new MockClassList(value);
    this.attributes.set("class", value);
  }

  get textContent(): string {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map((c) => c.textContent).join("");
  }

  set textContent(val: string) {
    this._textContent = val;
  }

  get innerHTML(): string {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this.children.map((c) => c.outerHTML).join("");
  }

  set innerHTML(html: string) {
    this._textContent = "";
    this.children = [];
    if (html.trim()) {
      const parsed = parseHTMLToElements(html);
      parsed.forEach((c) => this.appendChild(c));
    }
  }

  get outerHTML(): string {
    const tag = this.tagName.toLowerCase();
    const attrs = [...this.attributes.entries()].map(([k, v]) => `${k}="${v}"`).join(" ");
    const attrStr = attrs ? ` ${attrs}` : "";
    return `<${tag}${attrStr}>${this.innerHTML}</${tag}>`;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === "id") this.id = value;
    if (name === "class") {
      this.className = value;
    }
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, l: string) => l.toUpperCase());
      this.dataset[key] = value;
    }
  }

  getAttribute(name: string): string | null {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === "id") this.id = "";
    if (name === "class") {
      this.className = "";
    }
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, l: string) => l.toUpperCase());
      Reflect.deleteProperty(this.dataset, key);
    }
  }

  get firstChild(): MockElement | null {
    return this.children[0] ?? null;
  }

  get hidden(): boolean {
    return this.attributes.has("hidden");
  }

  set hidden(value: boolean) {
    if (value) this.setAttribute("hidden", "");
    else this.removeAttribute("hidden");
  }

  /** Reflects the `disabled` attribute like the real DOM property. */
  get disabled(): boolean {
    return this.attributes.has("disabled");
  }

  set disabled(value: boolean) {
    if (value) this.setAttribute("disabled", "");
    else this.removeAttribute("disabled");
  }

  private _checked: boolean | undefined;

  /** Current checkedness; starts from the `checked` attribute like the real DOM. */
  get checked(): boolean {
    return this._checked ?? this.attributes.has("checked");
  }

  set checked(value: boolean) {
    this._checked = value;
  }

  get title(): string {
    return this.attributes.get("title") ?? "";
  }

  set title(value: string) {
    this.setAttribute("title", value);
  }

  /** Records focus on the mock document (`document.activeElement`). */
  focus() {
    const doc = (globalThis as unknown as GlobalWithMockDOM).document;
    if (doc) doc.activeElement = this;
  }

  append(...nodes: Array<MockElement | string>) {
    for (const node of nodes) {
      if (typeof node === "string") {
        const text = new MockElement("#text");
        text.textContent = node;
        this.appendChild(text);
      } else {
        this.appendChild(node);
      }
    }
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  closest(selector: string): MockElement | null {
    if (matchesSelectorList(this, selector)) {
      return this;
    }
    let el = this.parentElement;
    while (el) {
      if (matchesSelectorList(el, selector)) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  appendChild(child: MockElement): MockElement {
    if (child.parentElement && child.parentElement !== this) child.parentElement.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(newChild: MockElement, refChild: MockElement | null): MockElement {
    newChild.parentElement = this;
    if (!refChild) {
      this.children.push(newChild);
      return newChild;
    }
    const idx = this.children.indexOf(refChild);
    if (idx === -1) {
      this.children.push(newChild);
    } else {
      this.children.splice(idx, 0, newChild);
    }
    return newChild;
  }

  removeChild(child: MockElement): MockElement {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  addEventListener(type: string, listener: MockEventListener) {
    const bucket = (this.eventListeners[type] ??= []);
    bucket.push(listener);
  }

  removeEventListener(type: string, listener: MockEventListener) {
    if (this.eventListeners[type]) {
      this.eventListeners[type] = this.eventListeners[type].filter((l) => l !== listener);
    }
  }

  dispatchEvent(event: MockEvent): boolean {
    const listeners = this.eventListeners[event.type] ?? [];
    for (const listener of listeners) {
      listener.call(this, event);
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: "click", target: this });
  }

  scrollIntoView() {
    // stub
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 && all[0] ? all[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];

    const matchesSingle = matchesSimple;

    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        if (matchesSingle(child, selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };

    traverse(this);
    return results;
  }
}

export class MockLocalStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export function setupMockDOM(initialWidth = 1440) {
  const elementsById = new Map<string, MockElement>();

  const documentMock = {
    createElement: (tag: string) => new MockElement(tag),
    createTextNode: (text: string) => {
      const node = new MockElement("#text");
      node.textContent = text;
      return node;
    },
    getElementById: (id: string) => elementsById.get(id) ?? null,
    documentElement: new MockElement("html"),
    body: new MockElement("body"),
    activeElement: null as MockElement | null,
  };

  const localStorageMock = new MockLocalStorage();

  const windowListeners: Record<string, MockEventListener[]> = {};

  const windowMock = {
    innerWidth: initialWidth,
    innerHeight: 900,
    localStorage: localStorageMock,
    addEventListener: (type: string, fn: MockEventListener) => {
      const bucket = (windowListeners[type] ??= []);
      bucket.push(fn);
    },
    removeEventListener: (type: string, fn: MockEventListener) => {
      if (windowListeners[type]) {
        windowListeners[type] = windowListeners[type].filter((l) => l !== fn);
      }
    },
    dispatchEvent: (event: MockEvent) => {
      for (const fn of windowListeners[event.type] ?? []) {
        fn(event);
      }
    },
    resizeTo: (width: number) => {
      windowMock.innerWidth = width;
      windowMock.dispatchEvent({ type: "resize" });
    },
  };

  const globals = globalThis as unknown as GlobalWithMockDOM;
  globals.window = windowMock;
  globals.document = documentMock;
  globals.localStorage = localStorageMock;
  globals.HTMLElement = MockElement;

  return {
    window: windowMock,
    document: documentMock,
    localStorage: localStorageMock,
  };
}
