/**
 * The one place the tutor apps talk to the MCP host.
 *
 * `startApp` wires an ext-apps `App`: tool results become `onData`, theme /
 * style variables follow the host, and the returned `Host` exposes the
 * handful of host features the apps use (call an app-only tool, put a message
 * in the chat, tell the model what changed, open a link), each behind a
 * capability flag so buttons the host cannot honour are hidden.
 *
 * Dev-only preview: when `window.__MCP_APP_PREVIEW__` holds an object with the
 * shape of the tool's `structuredContent`, it is rendered immediately without
 * connecting to a host (used for screenshots).
 */
import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

declare global {
  interface Window {
    __MCP_APP_PREVIEW__?: unknown;
    /** Preview only: canned `structuredContent` per app-only tool name. */
    __MCP_APP_PREVIEW_TOOLS__?: Record<string, unknown>;
  }
}

export interface ToolOutcome<T> {
  ok: boolean;
  /** `structuredContent` of the result (null on a protocol failure). */
  data: T | null;
  /** The text content, joined — the error message when `ok` is false. */
  text: string;
}

export interface HostCaps {
  tools: boolean;
  message: boolean;
  context: boolean;
  links: boolean;
}

export interface Host {
  readonly preview: boolean;
  readonly connected: boolean;
  readonly caps: HostCaps;
  callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<ToolOutcome<T>>;
  /** Put a user message into the chat. Resolves false when the host refused. */
  sendMessage(text: string): Promise<boolean>;
  /** Tell the model the app's current state (after an edit or save). */
  updateModelContext(text: string, structured?: Record<string, unknown>): Promise<void>;
  openLink(url: string): Promise<void>;
  /** Called once the host connection is up (capabilities known). */
  onReady(cb: () => void): void;
}

export interface StartOptions<T> {
  name: string;
  onData: (data: T) => void;
  onError: (message: string) => void;
}

function resultText(result: CallToolResult): string {
  return (result.content ?? [])
    .map((c) => (c.type === 'text' ? c.text : ''))
    .filter(Boolean)
    .join('\n');
}

export function startApp<T>(opts: StartOptions<T>): Host {
  const preview = typeof window !== 'undefined' && window.__MCP_APP_PREVIEW__ !== undefined && window.__MCP_APP_PREVIEW__ !== null;
  const app = new App({ name: opts.name, version: '1.0.0' });
  const caps: HostCaps = preview
    ? { tools: true, message: true, context: true, links: true }
    : { tools: false, message: false, context: false, links: false };
  let connected = false;
  const readyCallbacks: Array<() => void> = [];

  const applyContext = (ctx: ReturnType<App['getHostContext']>) => {
    if (!ctx) return;
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
    if (ctx.safeAreaInsets) {
      const { top, right, bottom, left } = ctx.safeAreaInsets;
      document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
    }
  };

  app.ontoolresult = (result) => {
    if (result.isError) {
      opts.onError(resultText(result) || 'The tool returned an error.');
      return;
    }
    const data = result.structuredContent as T | undefined;
    if (!data) {
      opts.onError('The tool returned no data to show.');
      return;
    }
    opts.onData(data);
  };
  app.onhostcontextchanged = (ctx) => applyContext(ctx);
  app.onerror = (err) => console.error(`[${opts.name}]`, err);

  const host: Host = {
    get preview() {
      return preview;
    },
    get connected() {
      return connected;
    },
    caps,
    async callTool<R>(name: string, args: Record<string, unknown>): Promise<ToolOutcome<R>> {
      if (preview) {
        await new Promise((r) => setTimeout(r, 300));
        const canned = window.__MCP_APP_PREVIEW_TOOLS__?.[name];
        if (canned !== undefined) return { ok: true, data: canned as R, text: 'preview' };
        return { ok: false, data: null, text: 'Preview mode: the host is not connected, so nothing was saved.' };
      }
      try {
        const result = await app.callServerTool({ name, arguments: args });
        const text = resultText(result);
        if (result.isError) return { ok: false, data: null, text: text || `${name} failed.` };
        return { ok: true, data: (result.structuredContent as R | undefined) ?? null, text };
      } catch (err) {
        return { ok: false, data: null, text: err instanceof Error ? err.message : String(err) };
      }
    },
    async sendMessage(text: string): Promise<boolean> {
      if (preview || !caps.message) return false;
      try {
        const res = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
        return !res.isError;
      } catch (err) {
        console.warn(`[${opts.name}] sendMessage failed`, err);
        return false;
      }
    },
    async updateModelContext(text: string, structured?: Record<string, unknown>): Promise<void> {
      if (preview || !caps.context) return;
      try {
        await app.updateModelContext({ content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}) });
      } catch (err) {
        console.warn(`[${opts.name}] updateModelContext failed`, err);
      }
    },
    async openLink(url: string): Promise<void> {
      if (preview) {
        window.open(url, '_blank', 'noopener');
        return;
      }
      if (!caps.links) return;
      try {
        await app.openLink({ url });
      } catch (err) {
        console.warn(`[${opts.name}] openLink failed`, err);
      }
    },
    onReady(cb) {
      if (connected || preview) cb();
      else readyCallbacks.push(cb);
    },
  };

  if (preview) {
    // Render synchronously-ish so screenshots never race the first paint.
    queueMicrotask(() => opts.onData(window.__MCP_APP_PREVIEW__ as T));
    return host;
  }

  app
    .connect()
    .then(() => {
      connected = true;
      const hc = app.getHostCapabilities();
      caps.tools = !!hc?.serverTools;
      caps.message = !!hc?.message;
      caps.context = !!hc?.updateModelContext;
      caps.links = !!hc?.openLinks;
      applyContext(app.getHostContext());
      for (const cb of readyCallbacks.splice(0)) cb();
    })
    .catch((err) => {
      console.error(`[${opts.name}] connect failed`, err);
      opts.onError('Could not connect to the host.');
    });

  return host;
}
