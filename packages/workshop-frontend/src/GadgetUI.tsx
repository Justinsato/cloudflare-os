import { useState, useEffect, useRef } from 'react'
import { Text, Loader, Banner } from '@cloudflare/kumo'
import { Sparkle } from '@phosphor-icons/react'
import { RpcStub, RpcTarget, newMessagePortRpcSession } from 'capnweb'
import { GadgetClient, GadgetSnapshotClient, ConsoleLogEvent, type GadgetHost } from '@gadgets/workshop-shared/api'
import { prepareUiPage, uiModuleKey, type UiPage } from '@gadgets/workshop-shared/ui-page'
import { CAPNWEB_MODULE_URL, SANDBOX_HEAD } from './sandboxDocument'
import { useOptionalTheme } from './ThemeContext'
import type { ResolvedThemeMode } from './theme'

// Unfortunately, we will have to embed the code as a data: URL, because our iframe is totally
// sandboxed. Even more unfortunately, since it's a module which we need to import from, we can't
// use the data URL as a <script> tag's source. Instead, we have to use it in an import statement.
// And, guess what? That import statement is going to appear in the runtime, which is *also* a
// data: URL, so we have a doubly-nested data: URL. We'll use base64 encoding for the inner
// data: and URL encoding for the outer, as this largely avoids double-escaping.
//
// The runtime is a module script placed before the gadget's entry. Module scripts run in document
// order, so what it sets up exists before any gadget module evaluates, even one the entry imports:
// for a legacy UI, its globals. It must stay synchronous: a top-level await would let the entry run
// first. For a UI that `callsMain`, the `gadget` and `host` stubs stay in the runtime's module
// scope, so they reach only the code `main()` hands them to.
const MISSING_MAIN = "client.js's default export has no main() function. Start the UI with " +
  '`export default { main(gadget) { ... } }`.'
const runtimeUrl = (callsMain: boolean) => `data:text/javascript;charset=utf-8,${encodeURIComponent(String.raw`import { RpcTarget, RpcStub, newMessagePortRpcSession } from "${CAPNWEB_MODULE_URL}";

// The main object of the frame's one RPC session with the page (GadgetFrameRoot), and its
// properties: the gadget's server-side Durable Object, and the page's GadgetHost.
let root, gadget, host;
{
  let {port1, port2} = new MessageChannel();
  window.parent.postMessage("handshake", "*", [port2]);
  root = newMessagePortRpcSession(port1);
  gadget = root.gadget;
  host = root.host;
}

// Settles a call to the page whose result the runtime ignores, so nothing stays held on either
// end. A failed call is dropped, since reporting it would make another call.
let notify = call => { call.then(() => {}, () => {}); };
${callsMain ? '' : `
globalThis.gadget = gadget;
globalThis.RpcTarget = RpcTarget;
globalThis.RpcStub = RpcStub;
`}

// Monkey-patch console to forward logs to the page.
for (let level of ['debug', 'info', 'log', 'warn', 'error']) {
  let original = console[level];
  console[level] = (...args) => {
    original.apply(console, args);
    try {
      let message = args.map(arg => {
        if (typeof arg === 'string') return arg;
        try { return JSON.stringify(arg); }
        catch { return String(arg); }
      });
      notify(root.reportConsole(level, message));
    } catch {};
  };
}

// Allow user-activated target=_blank links, but block programmatic popups.
const blockedOpen = () => {
  console.error('window.open() is disabled in Gadget UIs. Use a link with target="_blank" instead.');
  return null;
};
window.open = blockedOpen;
globalThis.open = blockedOpen;
try {
  Window.prototype.open = blockedOpen;
} catch {}

// Forward Escape key presses to the page. The sandboxed iframe captures keydown events when it
// has focus, so the page never sees them. The workshop UI uses Escape to exit fullscreen gadget
// mode, so forward it explicitly.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') notify(root.escape());
}, true);

window.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const anchor = event.target.closest('a[href][target]');
  if (!anchor || anchor.target.toLowerCase() !== '_blank') {
    return;
  }

  const rel = new Set((anchor.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
  rel.add('noopener');
  anchor.setAttribute('rel', Array.from(rel).join(' '));
}, true);

// Capture unhandled exceptions and promise rejections. The error listener captures because a
// module graph that fails to fetch fires a non-bubbling error only on its <script> element. An
// ErrorEvent's location is sent on its own because a SyntaxError's stack carries none; the parent
// names the file.
let reportError = (message, at) => notify(root.reportConsole('error', message, at));
window.addEventListener('error', (event) => {
  if (event instanceof ErrorEvent) {
    reportError(['Uncaught', event.error?.stack || event.message],
        { url: event.filename, line: event.lineno, column: event.colno });
  } else if (event.target instanceof HTMLScriptElement) {
    reportError(['Failed to load script'], { url: event.target.src });
  }
}, true);
window.addEventListener('unhandledrejection', (event) => {
  let reason = event.reason;
  reportError(['Unhandled promise rejection:', reason?.stack || String(reason)]);
});
${callsMain ? `
// The same module instance the entry's <script> loads. A main() that throws or rejects is reported
// as an unhandled rejection.
import(${JSON.stringify(uiModuleKey('client.js'))}).then(entry => {
  let main = entry.default?.main;
  if (typeof main !== 'function') {
    reportError([${JSON.stringify(MISSING_MAIN)}]);
    return;
  }
  return main.call(entry.default, gadget, host);
}, () => {
  // The entry's <script> element reports a module that fails to load or to evaluate.
});
` : ''}
//# sourceURL=gadget-runtime.js`)}`
const LEGACY_RUNTIME_URL = runtimeUrl(false)
const MAIN_RUNTIME_URL = runtimeUrl(true)

/** How the frame runs the gadget, as `globalThis.gadgetRenderMode` tells its code; unset live. */
export type GadgetRenderMode = 'snapshot'

/** The longest view state a gadget may keep in the page URL; longer ones are ignored. */
export const MAX_GADGET_VIEW_STATE_LENGTH = 2000

// Brick overlay: a module script ahead of the runtime and so of every gadget module. It follows the
// workspace theme, keeps the gadget's view state in the page URL, opens links to other gadgets in
// place, and reports the first paint so the parent can drop its loading cover.
const BRICK_PRELUDE_BODY = encodeURIComponent(String.raw`// The workspace's light/dark mode. The workspace has one theme switch and every gadget follows
// it: the frame opens with __gadgetTheme (declared at the top of this module),
// and the parent posts {type: 'theme', theme} whenever it changes. Gadgets style both modes with
// @media (prefers-color-scheme: dark) or :root[data-theme="dark"], read window.gadgetTheme, or
// listen for the 'gadget-theme' event. Installed ahead of the runtime's handshake so the parent's
// first post can't arrive ahead of the listener.
{
  let current = __gadgetTheme === 'dark' ? 'dark' : 'light';
  const applyTheme = (theme) => {
    current = theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  };
  applyTheme(current);
  Object.defineProperty(window, 'gadgetTheme', { get: () => current, enumerable: true });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'theme' || (data.theme !== 'light' && data.theme !== 'dark')) return;
    if (data.theme === current) return;
    applyTheme(data.theme);
    window.dispatchEvent(new CustomEvent('gadget-theme', { detail: { theme: data.theme } }));
  });
}

// The UI's view state (sort, filters, selected tab), kept in the workspace page's URL by the parent
// so a reload or a shared link restores it. __gadgetViewState is declared at the top of this module
// with the state the page opened with. Gadget code is a separate module, so it reaches gadgetView
// as a global.
globalThis.gadgetView = {
  get params() { return new URLSearchParams(__gadgetViewState); },
  set(params) {
    __gadgetViewState = new URLSearchParams(params).toString();
    window.parent.postMessage({ type: 'view-state', state: __gadgetViewState }, '*');
  },
};

// A link to another gadget in this workspace opens it in place. The frame can't navigate the
// page itself (no allow-top-navigation), so it asks the parent. Recognized: data-workpiece-id or
// data-workpiece-title on any element, an href "#w=<id>", or a workspace URL carrying "?w=<id>".
// The link can also open the target on a view state (the query it reads from gadgetView.params):
// data-workpiece-view="<query>", the rest of "#w=<id>&<query>", or the URL's "view=<id>:<query>".
window.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const el = event.target.closest('[data-workpiece-id],[data-workpiece-title],a[href]');
  if (!el) return;
  let id = el.getAttribute('data-workpiece-id');
  let title = el.getAttribute('data-workpiece-title');
  let view = el.getAttribute('data-workpiece-view');
  if (id == null && title == null && el.tagName === 'A') {
    const href = el.getAttribute('href') || '';
    const hash = /^#w=(\d+)(?:&(.*))?$/.exec(href);
    if (hash) {
      id = hash[1];
      if (view == null && hash[2]) view = hash[2];
    } else {
      try {
        const url = new URL(href);
        if (/^\/workspace\/[^/]+\/?$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('w') || '')) {
          id = url.searchParams.get('w');
          const saved = url.searchParams.get('view') || '';
          if (view == null && saved.startsWith(id + ':')) view = saved.slice(id.length + 1);
        }
      } catch {}
    }
  }
  if (id == null && title == null) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.parent.postMessage({ type: 'open-workpiece', id: id == null ? undefined : Number(id), title: title ?? undefined, view: view ?? undefined }, '*');
}, true);

// Tell the parent once the frame shows something, so it can drop its loading cover. "Something"
// is a rendered element with text or media; a gadget's own loading text counts. Re-checked on
// every DOM change and on resize (a frame laid out while hidden has no boxes yet).
{
  const MEDIA = 'img,svg,canvas,video,iframe,input,button,select,textarea,table';
  let reported = false;
  const shows = (el) => {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'TEMPLATE') return false;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    return el.matches(MEDIA) || el.textContent.trim() !== '' || el.querySelector(MEDIA) !== null;
  };
  const check = () => {
    if (reported || !document.body || !Array.from(document.body.children).some(shows)) return;
    reported = true;
    observer.disconnect();
    window.removeEventListener('resize', check);
    requestAnimationFrame(() => window.parent.postMessage({ type: 'painted' }, '*'));
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', check);
  setTimeout(check, 0);
}
//# sourceURL=gadget-brick-prelude.js
`)
const brickPreludeUrl = (viewState: string, theme: ResolvedThemeMode) =>
  'data:text/javascript;charset=utf-8,' +
  encodeURIComponent(`let __gadgetViewState = ${JSON.stringify(viewState)};\nconst __gadgetTheme = ${JSON.stringify(theme)};\n`) +
  BRICK_PRELUDE_BODY

// A module script of its own, ahead of the runtime and so of every gadget module, which keeps the
// runtime's URLs, embedding Cap'n Web, encoded once at load rather than per mode on each render.
const RENDER_MODE_URLS: Record<GadgetRenderMode, string> = {
  snapshot: `data:text/javascript;charset=utf-8,${encodeURIComponent('globalThis.gadgetRenderMode = "snapshot";')}`,
}

type OpenAgentChat = (chatToken: string) => Promise<void>

// The Workshop as a gadget UI's host.
class WorkshopGadgetHost extends RpcTarget implements GadgetHost {
  readonly #openAgentChat: OpenAgentChat

  constructor(openAgentChat: OpenAgentChat) {
    super()
    this.#openAgentChat = openAgentChat
  }

  async openAgentChat(chatToken: string): Promise<void> {
    // The frame is untrusted, and nothing generates RPC validation in the frontend.
    if (typeof chatToken !== 'string') throw new TypeError('chatToken must be a string.')
    await this.#openAgentChat(chatToken)
  }
}

// Where a console call or uncaught error happened in the frame, as the browser reported it.
type ConsoleLocation = { url?: string; line?: number; column?: number }

// What the frame's runtime reports to the page, apart from anything gadget code calls.
type FrameEvents = {
  reportConsole(level: ConsoleLogEvent['level'], message: string[], at?: ConsoleLocation): void
  escape(): void
}

// The main object of the frame's RPC session. The frame reaches the gadget's server and the host
// through one session, so a capability passed between them never proxies through the frame. Its
// methods are the runtime's, which keeps the root out of gadget code's reach.
class GadgetFrameRoot extends RpcTarget {
  readonly #gadget: RpcTarget
  readonly #host: GadgetHost
  readonly #events: FrameEvents

  constructor(gadget: RpcTarget, host: GadgetHost, events: FrameEvents) {
    super()
    this.#gadget = gadget
    this.#host = host
    this.#events = events
  }

  get gadget() {
    return this.#gadget
  }

  get host() {
    return this.#host
  }

  reportConsole(level: ConsoleLogEvent['level'], message: string[], at?: ConsoleLocation) {
    this.#events.reportConsole(level, message, at)
  }

  escape() {
    this.#events.escape()
  }
}

const createSandboxedHtml = (page: UiPage, renderMode: GadgetRenderMode | undefined, viewState: string, theme: ResolvedThemeMode): string => {
  // The theme is also on <html> so the first paint, before any script runs, is in the right mode.
  return `<!DOCTYPE html>
<html data-theme="${theme}" style="color-scheme: ${theme}">
<head>
  ${SANDBOX_HEAD}
  <script type="importmap">${page.importMap}</script>
</head>
<body>
    ${renderMode ? `<script type="module" src="${RENDER_MODE_URLS[renderMode]}"></script>` : ''}
    <script type="module" src="${brickPreludeUrl(viewState, theme)}"></script>
    <script type="module" src="${page.callsMain ? MAIN_RUNTIME_URL : LEGACY_RUNTIME_URL}"></script>
    <script type="module" src="${page.entryUrl}"></script>
</body>
</html>`.trim()
}

interface GadgetUIProps {
  gadget: RpcStub<GadgetClient> | RpcStub<GadgetSnapshotClient>
  height: string
  reloadTrigger?: number
  isVisible?: boolean
  chatId?: number
  // Set for a snapshot, which the gadget's code reads as `globalThis.gadgetRenderMode`.
  renderMode?: GadgetRenderMode
  onConsoleLog?: (log: ConsoleLogEvent) => void
  // Fires when the user presses Escape while the gadget iframe has focus. Sandboxed iframes
  // capture keydown events, so we forward Escape explicitly from inside the iframe.
  onIframeEscape?: () => void
  // Reports whether the "No gadget UI yet" placeholder is showing: true only once a load has
  // confirmed the gadget has no UI, so a spinner or a not-yet-loaded view never counts.
  onNoUiChange?: (showsNoUi: boolean) => void
  // Shows the user the chat the gadget names (GadgetHost.openAgentChat). Without it, the request
  // does nothing. `signal` aborts once the frame's RPC session ends, so a request still in
  // progress can be dropped rather than act for a view that's gone.
  onOpenAgentChat?: (chatToken: string, signal: AbortSignal) => Promise<void>
  // Brick overlay: open another gadget in this workspace (legacy iframe postMessage).
  onOpenWorkpiece?: (target: { id?: number; title?: string; view?: string }) => void
  // Brick overlay: gadget view-state kept in the workspace URL.
  viewState?: string
  onViewStateChange?: (state: string) => void
}

// How long to wait for a UI bundle before offering a retry instead of a spinner. Not a latency
// budget: the point at which we conclude the reply is never coming.
const UI_BUNDLE_LOAD_TIMEOUT_MS = 20_000
// How long the loading cover stays over a frame that never reports content (a gadget that draws
// nothing, or an old bundle without the paint check). After this the frame shows as it is.
const PAINT_COVER_TIMEOUT_MS = 10_000
const RECONNECT_TIMEOUT_MS = 5_000

export default function GadgetUI(props: GadgetUIProps) {
  return <GadgetUISession key={props.chatId} {...props} />
}

// Outside a ThemeProvider (isolated renders), follow whatever mode the page applied.
function documentThemeMode(): ResolvedThemeMode {
  return document.documentElement.getAttribute('data-mode') === 'dark' ? 'dark' : 'light'
}

function GadgetUISession({ gadget, height, reloadTrigger, isVisible = true, chatId, renderMode, onConsoleLog, onIframeEscape, onNoUiChange, onOpenAgentChat, onOpenWorkpiece, viewState, onViewStateChange }: GadgetUIProps) {
  // The workspace's resolved light/dark mode, which every gadget frame follows.
  const themeContext = useOptionalTheme()
  const resolvedTheme: ResolvedThemeMode = themeContext?.resolvedThemeMode ?? documentThemeMode()
  const themeRef = useRef(resolvedTheme)
  themeRef.current = resolvedTheme
  const [sandboxedHtml, setSandboxedHtml] = useState<string | null>(null)
  // The frame HTML that has reported content (see the paint check in the prelude). The cover shows
  // over the frame until the current HTML has painted.
  const [paintedHtml, setPaintedHtml] = useState<string | null>(null)
  const sandboxedHtmlRef = useRef(sandboxedHtml)
  sandboxedHtmlRef.current = sandboxedHtml
  const painted = sandboxedHtml !== null && paintedHtml === sandboxedHtml
  const [loading, setLoading] = useState(false)
  // A connection failure is tied to the client it was tried on, so a replacement gets its own try.
  const [error, setError] = useState<{ message: string; stub?: GadgetUIProps['gadget'] } | null>(null)
  const errorMessage = error && (error.stub ?? gadget) === gadget ? error.message : null
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isInvalidated, setIsInvalidated] = useState(false)
  const [iframeGeneration, setIframeGeneration] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const prevReloadTriggerRef = useRef(reloadTrigger)
  // Identifies the newest bundle load, so an older one can't write state after being superseded.
  const loadGenerationRef = useRef(0)
  // Bumped by the retry button to ask for a fresh load.
  const [retryNonce, setRetryNonce] = useState(0)
  const connectionGenerationRef = useRef(0)
  const handshakePendingRef = useRef<number | null>(null)
  const gadgetRef = useRef(gadget)
  gadgetRef.current = gadget
  // TODO: Remove `any` when Cap'n Web fixes cyclic type issues (RpcStub<any> triggers deep instantiation)
  const gadgetStubRef = useRef<any>(null)
  const pendingGadgetStubRef = useRef<{
    promise: Promise<any>
    resolve: (stub: any) => void
    reject: (reason: unknown) => void
  } | null>(null)
  const rpcSessionRef = useRef<any>(null)
  // Aborted when rpcSessionRef's session ends, dropping the host requests it made.
  const rpcSessionAbortRef = useRef<AbortController | null>(null)
  // Each module's path by its data: URL, for naming the file in errors the iframe forwards.
  const pathsByUrlRef = useRef(new Map<string, string>())
  // Keep latest callbacks in refs so the message-handler effect never tears down the RPC session.
  const onIframeEscapeRef = useRef(onIframeEscape)
  const onConsoleLogRef = useRef(onConsoleLog)
  onIframeEscapeRef.current = onIframeEscape
  onConsoleLogRef.current = onConsoleLog
  const onNoUiChangeRef = useRef(onNoUiChange)
  onNoUiChangeRef.current = onNoUiChange
  const onOpenAgentChatRef = useRef(onOpenAgentChat)
  onOpenAgentChatRef.current = onOpenAgentChat
  const onOpenWorkpieceRef = useRef(onOpenWorkpiece)
  onOpenWorkpieceRef.current = onOpenWorkpiece
  const onViewStateChangeRef = useRef(onViewStateChange)
  onViewStateChangeRef.current = onViewStateChange
  const viewStateRef = useRef(viewState ?? '')

  // A code change invalidates the view without clearing `hasLoaded`, so the previous load's "no UI"
  // result must not keep counting while the replacement load is pending.
  const showsNoUi = hasLoaded && !isInvalidated && !loading && !error && !sandboxedHtml
  useEffect(() => {
    if (!showsNoUi) return
    onNoUiChangeRef.current?.(true)
    return () => onNoUiChangeRef.current?.(false)
  }, [showsNoUi])

  const suspendGadgetCalls = () => {
    if (!pendingGadgetStubRef.current) {
      let resolve!: (stub: any) => void
      let reject!: (reason: unknown) => void
      const promise = new Promise<any>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
      })
      void promise.catch(() => {})
      pendingGadgetStubRef.current = { promise, resolve, reject }
    }
    return pendingGadgetStubRef.current
  }

  const installGadgetStub = (stub: any) => {
    gadgetStubRef.current = stub
    stub.onRpcBroken?.(() => {
      if (gadgetStubRef.current === stub) suspendGadgetCalls()
    })
  }

  const resetConnection = (reason: unknown) => {
    ++connectionGenerationRef.current
    handshakePendingRef.current = null
    pendingGadgetStubRef.current?.reject(reason)
    pendingGadgetStubRef.current = null
    gadgetStubRef.current?.[Symbol.dispose]?.()
    gadgetStubRef.current = null
    rpcSessionRef.current?.[Symbol.dispose]?.()
    rpcSessionRef.current = null
    rpcSessionAbortRef.current?.abort(reason)
    rpcSessionAbortRef.current = null
  }

  const reloadIframe = (reason: unknown) => {
    resetConnection(reason)
    setIframeGeneration(generation => generation + 1)
  }

  useEffect(() => {
    if (!rpcSessionRef.current) {
      if (handshakePendingRef.current !== null) {
        reloadIframe(new Error('Gadget changed during RPC handshake.'))
      }
      return
    }

    const generation = ++connectionGenerationRef.current
    const isCurrent = () => generation === connectionGenerationRef.current
    const pendingStub = suspendGadgetCalls()
    const replacementPromise = Promise.resolve().then(() => gadget.connectToGadget(chatId))
    void replacementPromise.then(stub => {
      if (!isCurrent()) stub[Symbol.dispose]?.()
    }, () => {})

    const reconnect = async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        // A pipelined client resolves only once the connection is back and the workspace reopened.
        // The budget is for the gadget's own answer, not for the outage before it.
        await gadget
        const replacementStub = await Promise.race([
          replacementPromise,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Timed out reconnecting gadget UI.')), RECONNECT_TIMEOUT_MS)
          }),
        ])
        if (!isCurrent()) return
        const oldStub = gadgetStubRef.current
        installGadgetStub(replacementStub)
        pendingStub.resolve(replacementStub)
        if (pendingGadgetStubRef.current === pendingStub) pendingGadgetStubRef.current = null
        oldStub?.[Symbol.dispose]?.()
      } catch (caught) {
        if (isCurrent()) reloadIframe(caught)
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
    }
    void reconnect()
  }, [gadget, chatId])

  // Effect to handle reloadTrigger changes (code changes)
  useEffect(() => {
    // Only react if reloadTrigger has actually changed from the previous value
    if (reloadTrigger !== undefined && reloadTrigger !== prevReloadTriggerRef.current && reloadTrigger > 0) {
      // Mark as invalidated but don't reload unless visible
      setIsInvalidated(true)
      // After a failed load the view is still invalidated, so the flag alone wouldn't reload it.
      setRetryNonce(nonce => nonce + 1)
      if (!isVisible) {
        // If not visible, just clear the current state
        setSandboxedHtml(null)
        setHasLoaded(false)
        setError(null)
      }
      // Update the ref to the current value
      prevReloadTriggerRef.current = reloadTrigger
    }
  }, [reloadTrigger, isVisible])

  // Effect to load UI bundle when component becomes visible for the first time or when invalidated
  useEffect(() => {
    // Only load if:
    // 1. Component is visible AND
    // 2. Either never loaded before OR invalidated due to code changes
    if (!isVisible || (hasLoaded && !isInvalidated)) {
      return
    }

    // Superseded loads are ignored by generation rather than by a per-run `cancelled` flag: a run
    // cancelled mid-call would skip its own `setLoading(false)`, leaving the spinner up with
    // nothing to clear it. Comparing generations means the newest run always owns the flag.
    const generation = ++loadGenerationRef.current
    const isCurrent = () => loadGenerationRef.current === generation

    // A dropped RPC never settles -- e.g. the stub was disposed under us by a reconnect -- and there
    // is nothing to catch. Rather than spin indefinitely, stop owning the load and offer a retry: the
    // call is idempotent, and a button is a far better answer than a spinner that never resolves.
    const giveUp = setTimeout(() => {
      if (!isCurrent()) return
      loadGenerationRef.current++      // so a late reply can no longer write state
      setLoading(false)
      setError({ message: 'Timed out loading this view.' })
    }, UI_BUNDLE_LOAD_TIMEOUT_MS)

    const loadUiBundle = async () => {
      try {
        setLoading(true)
        setError(null)

        const bundle = await gadget.getUiBundle(chatId)
        if (!isCurrent()) return
        if (bundle) {
          const page = prepareUiPage(bundle, CAPNWEB_MODULE_URL)
          pathsByUrlRef.current = page.pathsByUrl
          setSandboxedHtml(createSandboxedHtml(page, renderMode, viewStateRef.current, themeRef.current))
        } else {
          setSandboxedHtml(null)
        }
        // A failed load stays unloaded, so a replacement gadget client retries it.
        setHasLoaded(true)
        setIsInvalidated(false)
      } catch (err) {
        if (!isCurrent()) return
        console.error('Failed to load UI bundle:', err)
        // Includes imports that break the rules for UI code, so the agent needs to see it.
        const message = err instanceof Error ? err.message : 'Failed to load UI bundle'
        onConsoleLogRef.current?.({ timestamp: new Date(), level: 'error', message: [message] })
        setError({ message })
      } finally {
        if (isCurrent()) setLoading(false)
        clearTimeout(giveUp)
      }
    }

    loadUiBundle()
    return () => {
      clearTimeout(giveUp)
      // Dependencies can change without starting a replacement load (most importantly when the
      // view becomes hidden). Revoke this run explicitly so its late reply cannot populate state
      // for a different gadget, chat, or visibility lifecycle.
      if (isCurrent()) loadGenerationRef.current++
    }
  // LSP reports an error here, but tsc does not.
  // The LSP error is due to bugs that need to be fixed in Cap'n Web.
  }, [gadget, isVisible, hasLoaded, isInvalidated, chatId, renderMode, retryNonce])

  // Reads its callbacks through refs, so the handshake effect never tears down the RPC session.
  const frameEvents: FrameEvents = {
    reportConsole: (level, message, at) => {
      let location: string | undefined
      if (at?.url) {
        // Chrome names a module by its sourceURL; other browsers may give its data: URL. One not
        // in the bundle, like the runtime's, can embed hundreds of KB, so it isn't echoed whole.
        const path = pathsByUrlRef.current.get(at.url) ??
          (at.url.startsWith('data:') ? `${at.url.slice(0, 40)}…` : at.url)
        location = at.line ? `${path}:${at.line}:${at.column}` : path
      }
      onConsoleLogRef.current?.({
        timestamp: new Date(),
        level,
        message: location ? [...message, `at ${location}`] : message,
      })
    },
    escape: () => onIframeEscapeRef.current?.(),
  }

  // Tell the frame about theme changes without reloading it. Posted only to our own frame's window,
  // and the prelude accepts it only from window.parent. The target origin is "*" because a
  // sandboxed frame's origin is opaque.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'theme', theme: resolvedTheme }, '*')
  }, [resolvedTheme])

  useEffect(() => {
    if (sandboxedHtml === null || !isVisible) return
    const timeout = setTimeout(() => setPaintedHtml(sandboxedHtml), PAINT_COVER_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [sandboxedHtml, isVisible])

  // Effect to handle iframe RPC handshake
  useEffect(() => {
    let cancelled = false

    const handleMessage = async (event: MessageEvent) => {
      // Only handle messages from our iframe. As an extra level of paranoia, also make sure it's
      // from the null origin, just in case somehow the frame managed to browse away (though that
      // should be blocked). Yes, the null origin is identified by the string value "null", not the
      // JS `null`.
      if (event.source !== iframeRef.current?.contentWindow ||
          event.origin !== "null") {
        return
      }

      if (event.data?.type === 'painted') {
        setPaintedHtml(sandboxedHtmlRef.current)
        return
      }
      if (event.data?.type === 'open-workpiece') {
        const id = Number.isSafeInteger(event.data.id) ? event.data.id as number : undefined
        const title = typeof event.data.title === 'string' ? event.data.title : undefined
        const view = typeof event.data.view === 'string' && event.data.view.length <= MAX_GADGET_VIEW_STATE_LENGTH
          ? event.data.view
          : undefined
        if (id !== undefined || title !== undefined) onOpenWorkpieceRef.current?.({ id, title, view })
        return
      }
      if (event.data?.type === 'view-state') {
        const state = event.data.state
        if (typeof state !== 'string' || state.length > MAX_GADGET_VIEW_STATE_LENGTH) return
        viewStateRef.current = state
        onViewStateChangeRef.current?.(state)
        return
      }

      if (event.data === 'handshake' && event.ports && event.ports[0]) {
        const port = event.ports[0]
        // The frame's listener is up by now. Re-send the theme in case it changed between building
        // the srcdoc and the frame loading, when a post would have reached the blank document.
        iframeRef.current?.contentWindow?.postMessage({ type: 'theme', theme: themeRef.current }, '*')
        const client = gadgetRef.current
        let gadgetStub: any = null
        resetConnection(new Error('Gadget iframe reloaded.'))
        const generation = connectionGenerationRef.current
        handshakePendingRef.current = generation
        const isCurrent = () => !cancelled &&
          generation === connectionGenerationRef.current &&
          event.source === iframeRef.current?.contentWindow
        try {
          // Open the RPC connection to the gadget's server side
          gadgetStub = await client.connectToGadget(chatId)
          if (!isCurrent()) {
            gadgetStub[Symbol.dispose]?.()
            port.close()
            return
          }
          installGadgetStub(gadgetStub)
          // Redirectable target: swapping gadgetStubRef reconnects top-level calls without reloading.
          const forwardingTarget = new Proxy(new RpcTarget() as any, {
            get: (target, property, receiver) => {
              if (typeof property === 'symbol' || property in target) {
                return Reflect.get(target, property, receiver)
              }
              const pending = pendingGadgetStubRef.current
              return pending
                ? (...args: any[]) => pending.promise.then(stub => stub[property](...args))
                : gadgetStubRef.current[property]
            },
          })
          const sessionAbort = new AbortController()
          const host = new WorkshopGadgetHost(async chatToken => {
            await onOpenAgentChatRef.current?.(chatToken, sessionAbort.signal)
          })
          rpcSessionRef.current = newMessagePortRpcSession(
              port, new GadgetFrameRoot(forwardingTarget, host, frameEvents))
          rpcSessionRef.current.onRpcBroken((reason: unknown) => sessionAbort.abort(reason))
          rpcSessionAbortRef.current = sessionAbort
        } catch (caught) {
          gadgetStub?.[Symbol.dispose]?.()
          port.close()
          if (!isCurrent()) return
          console.error('Failed to establish RPC connection:', caught)
          setError({ message: 'Failed to connect gadget to server', stub: client })
        } finally {
          if (handshakePendingRef.current === generation) handshakePendingRef.current = null
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      cancelled = true
      window.removeEventListener('message', handleMessage)
      resetConnection(new Error('Gadget RPC session was closed.'))
    }
  }, [])

  // A new key or document replaces the frame, whose session lingers until the next handshake (or
  // never comes, with no UI to show); its host requests mustn't outlive the frame.
  const frameKey = `${reloadTrigger}:${iframeGeneration}`
  useEffect(() => () => {
    rpcSessionAbortRef.current?.abort(new Error('Gadget iframe was replaced.'))
    rpcSessionAbortRef.current = null
  }, [frameKey, sandboxedHtml])

  if (!isVisible && !hasLoaded) {
    // Don't render anything if not visible and never loaded
    return (
      <div
        className="flex items-center justify-center text-kumo-subtle"
        style={{ height }}
      >
        <Text variant="secondary">
          Switch to this tab to load the Gadget UI
        </Text>
      </div>
    )
  }

  // Until the first bundle reply, the view is loading: the load effect sets `loading` only after
  // the first paint, which would otherwise flash the "No gadget UI yet" placeholder.
  if (loading || (!hasLoaded && !errorMessage)) {
    return <GadgetLoading height={height} />
  }

  if (errorMessage) {
    return (
      <div style={{
        height,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '20px'
      }}>
        <Banner
          variant="error"
          title="Error"
          description={errorMessage}
          action={
            <Banner.Action
              onClick={() => {
                setError(null)
                setHasLoaded(false)
                setIsInvalidated(false)
                setRetryNonce(n => n + 1)
              }}
            >
              Try again
            </Banner.Action>
          }
        />
      </div>
    )
  }

  if (!sandboxedHtml) {
    return (
      <div
        className="relative overflow-hidden bg-kumo-base"
        style={{
          height,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          className="themed-accent-glow absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
          style={{
            filter: 'blur(18px)',
          }}
        />

        <div className="relative flex max-w-sm flex-col items-center gap-3 px-6 text-center">
          <div className="themed-user-bubble-shadow flex h-12 w-12 items-center justify-center rounded-xl border border-kumo-line bg-kumo-elevated text-kumo-subtle">
            <Sparkle size={22} weight="regular" />
          </div>
          <div className="space-y-1">
            <h2 className="text-[20px] leading-7 font-normal tracking-[-0.45px] text-kumo-default">
              No gadget UI yet
            </h2>
            <p className="text-[15px] leading-5 font-normal tracking-[-0.3px] text-kumo-subtle">
              When the gadget builds one, it will appear here.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative" style={{ height, width: '100%' }}>
      {!painted && <GadgetLoading height="100%" overlay />}
      <iframe
        key={frameKey}
        ref={iframeRef}
        srcDoc={sandboxedHtml}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          border: 'none',
          // Chromium derives the embedded document's prefers-color-scheme from this, so gadgets
          // styled with @media (prefers-color-scheme: dark) follow the workspace switch.
          colorScheme: resolvedTheme,
        }}
        // allow-downloads: a gadget can hand the viewer a file it already holds (a report's PDF, a
        // workbook) with an <a download> link on a blob: URL, on a click.
        sandbox="allow-scripts allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-downloads"
        title="Gadget UI"
      />
    </div>
  )
}

// The pane's loading state, shown while the UI bundle loads and then over the frame until the
// gadget paints, so the pane never sits blank.
function GadgetLoading({ height, overlay = false }: { height: string; overlay?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-3 bg-kumo-base ${overlay ? 'absolute inset-0 z-[1]' : ''}`}
      style={{ height }}
    >
      <Loader size="lg" />
      <Text variant="secondary">Loading view…</Text>
    </div>
  )
}
