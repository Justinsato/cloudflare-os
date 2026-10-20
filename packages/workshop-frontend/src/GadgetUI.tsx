import { useState, useEffect, useMemo, useRef } from 'react'
import { Text, Loader, Banner } from '@cloudflare/kumo'
import { Sparkle } from '@phosphor-icons/react'
import { RpcStub, RpcTarget, newMessagePortRpcSession } from 'capnweb'
import { GadgetClient, ConsoleLogEvent } from '@gadgets/workshop-shared/api'
import { useOptionalTheme } from './ThemeContext'
import type { ResolvedThemeMode } from './theme'

// We want to inject Cap'n Web into the Gadget. Luckily it has no dependencies, so we can just take
// the whole module and embed it. We can import the module using ?raw to get a string of the
// content.
import CAPNWEB_BUNDLE from 'capnweb?raw'

// btoa() below requires this to stay ASCII; capnweb's build enforces ASCII-only dist bundles
// since 0.11.1.
let CAPNWEB_BUNDLE_ANNOTATED = `//# sourceURL=jsrpc.js\n${CAPNWEB_BUNDLE}`

// Unfortunately, we will have to embed the code as a data: URL, because our iframe is totally
// sandboxed. Even more unfortunately, since it's a module which we need to import from, we can't
// use the data URL as a <script> tag's source. Instead, we have to use it in an import statement.
// And, guess what? That import statement is going to appear in code which is *also* embedded in
// a data: URL, so we have a doubly-nested data: URL. We'll use base64 encoding for the inner
// data: and URL encoding for the outer, as this largely avoids double-escaping.
//
// In any case, we'll prefix the gadget code with this prefix which imports the Cap'n Web library
// (from a massive data URL) and sets up the RPC connection to the parent.
let INJECTED_CODE_PREFIX = encodeURIComponent(String.raw`//# sourceURL=client.js
import { RpcTarget, RpcStub, newMessagePortRpcSession } from "data:text/javascript;charset=utf-8;base64,${btoa(CAPNWEB_BUNDLE_ANNOTATED)}";

// The workspace's light/dark mode. The workspace has one theme switch and every gadget follows
// it: the frame opens with __gadgetTheme (declared ahead of this prefix, see createSandboxedHtml),
// and the parent posts {type: 'theme', theme} whenever it changes. Gadgets style both modes with
// @media (prefers-color-scheme: dark) or :root[data-theme="dark"], read window.gadgetTheme, or
// listen for the 'gadget-theme' event. Installed before the handshake so the parent's first post
// can't arrive ahead of the listener.
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

let gadget;  // RPC stub to the gadget's server-side Durable Object.
{
  let {port1, port2} = new MessageChannel();
  window.parent.postMessage("handshake", "*", [port2]);
  gadget = newMessagePortRpcSession(port1);
}

// The UI's view state (sort, filters, selected tab), kept in the workspace page's URL by the parent
// so a reload or a shared link restores it. __gadgetViewState is declared ahead of this prefix with
// the state the page opened with (see createSandboxedHtml).
const gadgetView = {
  get params() { return new URLSearchParams(__gadgetViewState); },
  set(params) {
    __gadgetViewState = new URLSearchParams(params).toString();
    window.parent.postMessage({ type: 'view-state', state: __gadgetViewState }, '*');
  },
};

// Monkey-patch console to forward logs to the parent frame.
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
      window.parent.postMessage({ type: 'console', level, message }, '*');
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

// Forward Escape key presses to the parent frame. The sandboxed iframe captures keydown events
// when it has focus, so the parent never sees them. The workshop UI uses Escape to exit fullscreen
// gadget mode, so forward it explicitly.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.parent.postMessage({ type: 'escape' }, '*');
  }
}, true);

// A link to another gadget in this workspace opens it in place. The frame can't navigate the
// page itself (no allow-top-navigation), so it asks the parent. Recognized: data-workpiece-id or
// data-workpiece-title on any element, an href "#w=<id>", or a workspace URL carrying "?w=<id>".
window.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const el = event.target.closest('[data-workpiece-id],[data-workpiece-title],a[href]');
  if (!el) return;
  let id = el.getAttribute('data-workpiece-id');
  let title = el.getAttribute('data-workpiece-title');
  if (id == null && title == null && el.tagName === 'A') {
    const href = el.getAttribute('href') || '';
    const hash = /^#w=(\d+)$/.exec(href);
    if (hash) {
      id = hash[1];
    } else {
      try {
        const url = new URL(href);
        if (/^\/workspace\/[^/]+\/?$/.test(url.pathname) && /^\d+$/.test(url.searchParams.get('w') || '')) {
          id = url.searchParams.get('w');
        }
      } catch {}
    }
  }
  if (id == null && title == null) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  window.parent.postMessage({ type: 'open-workpiece', id: id == null ? undefined : Number(id), title: title ?? undefined }, '*');
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

// Capture unhandled exceptions and promise rejections.
window.addEventListener('error', (event) => {
  window.parent.postMessage({
    type: 'console',
    level: 'error',
    message: ['Uncaught', event.error?.stack || event.message],
  }, '*');
});
window.addEventListener('unhandledrejection', (event) => {
  let reason = event.reason;
  window.parent.postMessage({
    type: 'console',
    level: 'error',
    message: ['Unhandled promise rejection:', reason?.stack || String(reason)],
  }, '*');
});

`);

/** The longest view state a gadget may keep in the page URL; longer ones are ignored. */
export const MAX_GADGET_VIEW_STATE_LENGTH = 2000

const createSandboxedHtml = (jsCode: string, viewState: string, theme: ResolvedThemeMode): string => {
  const viewStateDeclaration =
    encodeURIComponent(`let __gadgetViewState = ${JSON.stringify(viewState)};\nconst __gadgetTheme = ${JSON.stringify(theme)};\n`)
  // The theme is also on <html> so the first paint, before any script runs, is in the right mode.
  return `<!DOCTYPE html>
<html data-theme="${theme}" style="color-scheme: ${theme}">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'none'; script-src data: 'unsafe-inline'; style-src data: 'unsafe-inline'; img-src data:; media-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none';">
</head>
<body>
    <script type="module" src="data:text/javascript;charset=utf-8,${viewStateDeclaration}${INJECTED_CODE_PREFIX}${encodeURIComponent(jsCode)}"></script>
</body>
</html>`.trim()
}

interface GadgetUIProps {
  gadget: RpcStub<GadgetClient>
  height: string
  reloadTrigger?: number
  isVisible?: boolean
  chatId?: number
  onConsoleLog?: (log: ConsoleLogEvent) => void
  // Fires when the user presses Escape while the gadget iframe has focus. Sandboxed iframes
  // capture keydown events, so we forward Escape explicitly from inside the iframe.
  onIframeEscape?: () => void
  // Reports whether the "No gadget UI yet" placeholder is showing: true only once a load has
  // confirmed the gadget has no UI, so a spinner or a not-yet-loaded view never counts.
  onNoUiChange?: (showsNoUi: boolean) => void
  // Fires when the gadget asks to open another gadget of this workspace (see the click handler in
  // the injected prefix). Carries an id, a title, or both.
  onOpenWorkpiece?: (target: { id?: number; title?: string }) => void
  // The gadget's view state (a query string, see `gadgetView` in the injected prefix) as the page
  // opened with it. Read when the frame loads; later changes come from the gadget itself.
  viewState?: string
  // Fires when the gadget saves a new view state, for the parent to keep in its URL.
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

function GadgetUISession({ gadget, height, reloadTrigger, isVisible = true, chatId, onConsoleLog, onIframeEscape, onNoUiChange, onOpenWorkpiece, viewState, onViewStateChange }: GadgetUIProps) {
  // The workspace's resolved light/dark mode, which every gadget frame follows.
  const themeContext = useOptionalTheme()
  const resolvedTheme: ResolvedThemeMode = themeContext?.resolvedThemeMode ?? documentThemeMode()
  const themeRef = useRef(resolvedTheme)
  themeRef.current = resolvedTheme
  // The loaded UI bundle's client code; the frame's HTML is built from it per frame load.
  const [uiCode, setUiCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  // Keep latest callbacks in refs so the message-handler effect never tears down the RPC session.
  const onIframeEscapeRef = useRef(onIframeEscape)
  const onConsoleLogRef = useRef(onConsoleLog)
  onIframeEscapeRef.current = onIframeEscape
  onConsoleLogRef.current = onConsoleLog
  const onNoUiChangeRef = useRef(onNoUiChange)
  onNoUiChangeRef.current = onNoUiChange
  const onOpenWorkpieceRef = useRef(onOpenWorkpiece)
  onOpenWorkpieceRef.current = onOpenWorkpiece
  const onViewStateChangeRef = useRef(onViewStateChange)
  onViewStateChangeRef.current = onViewStateChange
  // The gadget's latest view state: the page's to begin with, then whatever the gadget saved. A
  // frame reload (a reconnect, a code change) restores it from here.
  const viewStateRef = useRef(viewState ?? '')
  const sandboxedHtml = useMemo(
    () => uiCode === null ? null : createSandboxedHtml(uiCode, viewStateRef.current, themeRef.current),
    // oxlint-disable-next-line exhaustive-deps -- rebuilt per frame load: reloadTrigger and iframeGeneration key the frame. The theme is posted live rather than rebuilding (and reloading) the frame.
    [uiCode, reloadTrigger, iframeGeneration])

  // The frame HTML that has reported content (see the paint check in the injected prefix). The
  // cover shows over the frame until the current HTML has painted.
  const [paintedHtml, setPaintedHtml] = useState<string | null>(null)
  const sandboxedHtmlRef = useRef(sandboxedHtml)
  sandboxedHtmlRef.current = sandboxedHtml
  const painted = sandboxedHtml !== null && paintedHtml === sandboxedHtml
  useEffect(() => {
    if (sandboxedHtml === null || !isVisible) return
    const timeout = setTimeout(() => setPaintedHtml(sandboxedHtml), PAINT_COVER_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [sandboxedHtml, isVisible])

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
      if (!isVisible) {
        // If not visible, just clear the current state
        setUiCode(null)
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
      setError('Timed out loading this view.')
    }, UI_BUNDLE_LOAD_TIMEOUT_MS)

    const loadUiBundle = async () => {
      try {
        setLoading(true)
        setError(null)

        const bundle = await gadget.getUiBundle(chatId)
        if (!isCurrent()) return
        if (bundle) {
          setUiCode(bundle.jsCode)
        } else {
          setUiCode(null)
        }
        setHasLoaded(true)
        setIsInvalidated(false)
      } catch (err) {
        if (!isCurrent()) return
        console.error('Failed to load UI bundle:', err)
        setError('Failed to load UI bundle')
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
  }, [gadget, isVisible, hasLoaded, isInvalidated, chatId, retryNonce])

  // Tell the frame about theme changes without reloading it. Parent-to-child counterpart of the
  // escape/console messages: posted only to our own frame's window, and the prefix accepts it only
  // from window.parent. The target origin is "*" because a sandboxed frame's origin is opaque.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'theme', theme: resolvedTheme }, '*')
  }, [resolvedTheme])

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

      if (event.data === 'handshake' && event.ports && event.ports[0]) {
        const port = event.ports[0]
        // The frame's listener is up by now. Re-send the theme in case it changed between building
        // the srcdoc and the frame loading, when a post would have reached the blank document.
        iframeRef.current?.contentWindow?.postMessage({ type: 'theme', theme: themeRef.current }, '*')
        let gadgetStub: any = null
        resetConnection(new Error('Gadget iframe reloaded.'))
        const generation = connectionGenerationRef.current
        handshakePendingRef.current = generation
        const isCurrent = () => !cancelled &&
          generation === connectionGenerationRef.current &&
          event.source === iframeRef.current?.contentWindow
        try {
          // Open the RPC connection to the gadget's server side
          gadgetStub = await gadgetRef.current.connectToGadget(chatId)
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
          rpcSessionRef.current = newMessagePortRpcSession(port, forwardingTarget)
        } catch (caught) {
          gadgetStub?.[Symbol.dispose]?.()
          port.close()
          if (!isCurrent()) return
          console.error('Failed to establish RPC connection:', caught)
          setError('Failed to connect gadget to server')
        } finally {
          if (handshakePendingRef.current === generation) handshakePendingRef.current = null
        }
      } else if (event.data?.type === 'console' && onConsoleLogRef.current) {
        onConsoleLogRef.current({
          timestamp: new Date(),
          level: event.data.level,
          message: event.data.message,
        })
      } else if (event.data?.type === 'painted') {
        setPaintedHtml(sandboxedHtmlRef.current)
      } else if (event.data?.type === 'escape') {
        onIframeEscapeRef.current?.()
      } else if (event.data?.type === 'open-workpiece') {
        const id = Number.isSafeInteger(event.data.id) ? event.data.id as number : undefined
        const title = typeof event.data.title === 'string' ? event.data.title : undefined
        if (id !== undefined || title !== undefined) onOpenWorkpieceRef.current?.({ id, title })
      } else if (event.data?.type === 'view-state') {
        const state = event.data.state
        if (typeof state !== 'string' || state.length > MAX_GADGET_VIEW_STATE_LENGTH) return
        viewStateRef.current = state
        onViewStateChangeRef.current?.(state)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      cancelled = true
      window.removeEventListener('message', handleMessage)
      resetConnection(new Error('Gadget RPC session was closed.'))
    }
  }, [])

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
  if (loading || (!hasLoaded && !error)) {
    return <GadgetLoading height={height} />
  }

  if (error) {
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
          description={error}
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
        key={`${reloadTrigger}:${iframeGeneration}`}
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
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
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
