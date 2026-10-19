/**
 * Lightweight in-memory DOM harness for Vitest tests running in Node environment.
 * Supports element hierarchy, classList, dataset, compound querySelector, innerHTML parsing, events, and localStorage.
 */

export class MockClassList {
  private classes = new Set<string>();

  constructor(initial = "") {
    if (initial) {
      initial.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    }
  }

  add(...tokens: string[]) {
    tokens.forEach((t) => {
      if (t) {
        t.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
      }
    });
  }

  remove(...tokens: string[]) {
    tokens.forEach((t) => {
      if (t) {
        t.split(/\s+/).filter(Boolean).forEach((c) => this.classes.delete(c));
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
    return Array.from(this.classes).join(" ");
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
    const [, isClosing, tagName, rawAttrs, isSelfClosing, textContent] = match;

    if (textContent) {
      const text = textContent.trim();
      if (text) {
        if (current !== root) {
          current.textContent = (current.textContent ? current.textContent + " " : "") + text;
        } else {
          const textEl = new MockElement("span");
          textEl.textContent = text;
          root.appendChild(textEl);
        }
      }
    } else if (tagName) {
      const tag = tagName.toLowerCase();
      const isVoid = Boolean(isSelfClosing) || ["img", "input", "br", "hr", "meta", "link"].includes(tag);

      if (isClosing) {
        for (let i = stack.length - 1; i > 0; i--) {
          const stackItem = stack[i];
          if (stackItem && stackItem.tagName.toLowerCase() === tag) {
            stack.splice(i);
            current = stack[stack.length - 1] ?? root;
            break;
          }
        }
      } else {
        const el = new MockElement(tag);
        parseAttributes(rawAttrs ?? "", el);
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
  if (sel.startsWith(".") && sel.indexOf(".", 1) !== -1) {
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
      const [attr, rawVal] = inner.split("=");
      const val = (rawVal ?? "").replace(/['"]/g, "");
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
  private eventListeners: Record<string, Function[]> = {};
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
    const attrs = Array.from(this.attributes.entries())
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
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
      const key = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
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
      const key = name.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      delete this.dataset[key];
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

  append(...nodes: (MockElement | string)[]) {
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
    let el: MockElement | null = this;
    while (el) {
      if (matchesSelectorList(el, selector)) return el;
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
    if (idx !== -1) {
      this.children.splice(idx, 0, newChild);
    } else {
      this.children.push(newChild);
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

  addEventListener(type: string, listener: Function) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(listener);
  }

  removeEventListener(type: string, listener: Function) {
    if (this.eventListeners[type]) {
      this.eventListeners[type] = this.eventListeners[type].filter((l) => l !== listener);
    }
  }

  dispatchEvent(event: { type: string; [key: string]: any }): boolean {
    const listeners = this.eventListeners[event.type] || [];
    listeners.forEach((l) => l.call(this, event));
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
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
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
    getElementById: (id: string) => elementsById.get(id) || null,
    documentElement: new MockElement("html"),
    body: new MockElement("body"),
  };

  const localStorageMock = new MockLocalStorage();

  const windowListeners: Record<string, Function[]> = {};

  const windowMock = {
    innerWidth: initialWidth,
    innerHeight: 900,
    localStorage: localStorageMock,
    addEventListener: (type: string, fn: Function) => {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: Function) => {
      if (windowListeners[type]) {
        windowListeners[type] = windowListeners[type].filter((l) => l !== fn);
      }
    },
    dispatchEvent: (event: { type: string; [key: string]: any }) => {
      (windowListeners[event.type] || []).forEach((fn) => fn(event));
    },
    resizeTo: (width: number) => {
      windowMock.innerWidth = width;
      windowMock.dispatchEvent({ type: "resize" });
    },
  };

  (globalThis as any).window = windowMock;
  (globalThis as any).document = documentMock;
  (globalThis as any).localStorage = localStorageMock;
  (globalThis as any).HTMLElement = MockElement;

  return {
    window: windowMock,
    document: documentMock,
    localStorage: localStorageMock,
  };
}
