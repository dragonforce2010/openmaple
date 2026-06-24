import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "./config/i18n";

/* ============================================================
   Icon — renders the inline SVG sprite injected in index.html
   ============================================================ */
export function Icon({ name, size }: { name: string; size?: number }) {
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg className="ic" style={style} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}

/* ============================================================
   Avatars + accents (ported from prototype)
   ============================================================ */
export type Avatar = { id: string; emoji: string; name: string; bg: string };

export const AVATARS: Avatar[] = [
  { id: "tiger", emoji: "🐯", name: "老虎", bg: "radial-gradient(circle at 34% 28%, #ffd886, #f0902f)" },
  { id: "rabbit", emoji: "🐰", name: "兔子", bg: "radial-gradient(circle at 34% 28%, #ffd9e6, #e87fa6)" },
  { id: "bear", emoji: "🐻", name: "小熊", bg: "radial-gradient(circle at 34% 28%, #dcb58e, #a4704a)" },
  { id: "eagle", emoji: "🦅", name: "老鹰", bg: "radial-gradient(circle at 34% 28%, #d3dbe6, #7986a0)" },
  { id: "fox", emoji: "🦊", name: "狐狸", bg: "radial-gradient(circle at 34% 28%, #ffb583, #e76d33)" },
  { id: "panda", emoji: "🐼", name: "熊猫", bg: "radial-gradient(circle at 34% 28%, #f4f4f4, #b4bac4)" },
  { id: "lion", emoji: "🦁", name: "狮子", bg: "radial-gradient(circle at 34% 28%, #ffe492, #e0a235)" },
  { id: "frog", emoji: "🐸", name: "青蛙", bg: "radial-gradient(circle at 34% 28%, #bdeb9f, #67ac4c)" },
  { id: "cat", emoji: "🐱", name: "小猫", bg: "radial-gradient(circle at 34% 28%, #ffdcae, #e0a566)" },
  { id: "koala", emoji: "🐨", name: "考拉", bg: "radial-gradient(circle at 34% 28%, #dde3e8, #99a6b2)" }
];

export function Av({ avatarId, initial, cls }: { avatarId?: string; initial: string; cls?: string }) {
  const a = AVATARS.find((x) => x.id === avatarId);
  const className = `av ${cls ?? ""}`.trim();
  if (a) {
    return (
      <div className={`${className} av-animal`} style={{ background: a.bg }}>
        <span className="av-emoji">{a.emoji}</span>
      </div>
    );
  }
  return <div className={className}>{initial}</div>;
}

export type AccentDef = { id: string; name: string; c: string; soft: string };

export const ACCENTS: AccentDef[] = [
  { id: "blue", name: "经典蓝", c: "#2e79c8", soft: "#16283c" },
  { id: "terra", name: "赤陶", c: "#c36b55", soft: "#3a241d" },
  { id: "green", name: "翠绿", c: "#2e9d6b", soft: "#143026" },
  { id: "violet", name: "靛紫", c: "#7c6bd6", soft: "#241f3a" }
];

export type ThemeMode = "dark" | "light";
export type Density = "comfortable" | "compact";

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.add("no-theme-anim");
  root.setAttribute("data-theme", theme);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-theme-anim")));
}

export function applyAccent(id: string) {
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0];
  const root = document.documentElement;
  root.style.setProperty("--accent", a.c);
  const lightMode = root.getAttribute("data-theme") === "light";
  root.style.setProperty("--accent-soft", `color-mix(in srgb, ${a.c} ${lightMode ? "14%" : "24%"}, var(--panel))`);
}

export function applyDensity(d: Density) {
  document.documentElement.setAttribute("data-density", d === "compact" ? "compact" : "comfortable");
}

type ThemeState = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  accent: string;
  setAccent: (id: string) => void;
  density: Density;
  setDensity: (d: Density) => void;
};

const ThemeContext = createContext<ThemeState>({
  theme: "dark",
  setTheme: () => {},
  accent: "blue",
  setAccent: () => {},
  density: "comfortable",
  setDensity: () => {}
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => (window.localStorage.getItem("cc_theme") === "light" ? "light" : "dark"));
  const [accent, setAccentState] = useState<string>(() => window.localStorage.getItem("cc_accent") || "blue");
  const [density, setDensityState] = useState<Density>(() => (window.localStorage.getItem("cc_density") === "compact" ? "compact" : "comfortable"));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    applyAccent(accent);
    applyDensity(density);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = (next: ThemeMode) => {
    setThemeState(next);
    window.localStorage.setItem("cc_theme", next);
    applyTheme(next);
    applyAccent(accent);
  };
  const setAccent = (id: string) => {
    setAccentState(id);
    window.localStorage.setItem("cc_accent", id);
    applyAccent(id);
  };
  const setDensity = (d: Density) => {
    setDensityState(d);
    window.localStorage.setItem("cc_density", d);
    applyDensity(d);
  };

  return <ThemeContext.Provider value={{ theme, setTheme, accent, setAccent, density, setDensity }}>{children}</ThemeContext.Provider>;
}

/* ============================================================
   Toast — top-right stack, matches prototype markup/animation
   ============================================================ */
export type ToastType = "ok" | "err" | "info";
type ToastItem = { id: number; msg: string; type: ToastType; shown: boolean };

const ToastContext = createContext<(msg: string, type?: ToastType) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((msg: string, type: ToastType = "ok") => {
    const id = ++idRef.current;
    setItems((current) => [...current, { id, msg, type, shown: false }]);
    // mount without `.in`, then flip on next frame so the slide-in transition runs
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setItems((current) => current.map((item) => (item.id === id ? { ...item, shown: true } : item))))
    );
    window.setTimeout(() => {
      setItems((current) => current.map((item) => (item.id === id ? { ...item, shown: false } : item)));
      window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 320);
    }, 2600);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" id="toast-stack">
        {items.map((item) => (
          <div key={item.id} className={["toast", item.type === "ok" ? "" : item.type, item.shown ? "in" : ""].filter(Boolean).join(" ")}>
            <Icon name={item.type === "err" ? "i-alert" : item.type === "info" ? "i-circle-dot" : "i-check"} size={16} />
            <span>{item.msg}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ============================================================
   Confirm dialog — generic destructive-action confirmation
   ============================================================ */
export type ConfirmOpts = { title: string; body?: React.ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };

const ConfirmContext = createContext<(opts: ConfirmOpts) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOpts; resolve: (value: boolean) => void } | null>(null);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ opts, resolve })), []);

  const close = (value: boolean) => {
    setState((current) => {
      current?.resolve(value);
      return null;
    });
  };

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false);
      if (event.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state ? (
        <div className="modal-layer open">
          <div className="scrim" />
          <div className="modal" role="dialog" aria-modal="true" aria-label={state.opts.title} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><b>{state.opts.title}</b></div>
            <div className="modal-body">
              {typeof state.opts.body === "string"
                ? <p className="hint" style={{ color: "var(--muted)", fontSize: "13.5px", lineHeight: 1.6 }}>{state.opts.body}</p>
                : state.opts.body ?? null}
            </div>
            <div className="modal-foot">
              <button className="btn secondary" onClick={() => close(false)}>{state.opts.cancelLabel ?? "取消"}</button>
              <button className={state.opts.danger ? "btn danger" : "btn primary"} onClick={() => close(true)} autoFocus>{state.opts.confirmLabel ?? "确认"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

/* ============================================================
   Drawer stack — up to 3 stacked side-drawers (prototype drillTo)
   ============================================================ */
export type DrawerEntry = { key: string; title: string; sub?: string; body: React.ReactNode; frameless?: boolean; bodyFill?: boolean; routeKind?: string; routeId?: string };
const DRAWER_WIDTHS = ["80%", "60%", "40%"];

const DrawerStackContext = createContext<{ open: (entry: DrawerEntry) => void; replace: (entries: DrawerEntry[]) => void; close: () => void; closeAll: () => void; depth: number; stack: DrawerEntry[] }>({
  open: () => {},
  replace: () => {},
  close: () => {},
  closeAll: () => {},
  depth: 0,
  stack: []
});

export function useDrawerStack() {
  return useContext(DrawerStackContext);
}

export function DrawerStackProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<DrawerEntry[]>([]);
  // Cap at 3 stacked drawers (80%/60%/40%). When full, ignore — callers detect depth>=3 and route to a full page instead.
  const open = useCallback((entry: DrawerEntry) => setStack((current) => (current.length >= 3 ? current : [...current, entry])), []);
  const replace = useCallback((entries: DrawerEntry[]) => setStack(entries.slice(0, 3)), []);
  const close = useCallback(() => setStack((current) => current.slice(0, -1)), []);
  const closeAll = useCallback(() => setStack([]), []);

  useEffect(() => {
    if (!stack.length) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [stack.length, close]);

  return (
    <DrawerStackContext.Provider value={{ open, replace, close, closeAll, depth: stack.length, stack }}>
      {children}
    </DrawerStackContext.Provider>
  );
}

// Rendered INSIDE App's EntityNavProvider so drawer bodies can use useEntityNav().
export function DrawerStackViewport() {
  const { stack, close } = useContext(DrawerStackContext);
  const { language } = useI18n();
  const closeLabel = language === "zh" ? "关闭" : "Close";
  if (!stack.length) return null;
  const scrimZIndex = 99 + (stack.length - 1) * 10;
  return (
    <div className="drawer-stack open">
      <div className="dw-scrim" style={{ zIndex: scrimZIndex }} onClick={close} />
      {stack.map((entry, index) => {
        const panelClass = entry.frameless ? "dw-panel frameless" : "dw-panel";
        const bodyClass = entry.frameless || entry.bodyFill ? "dw-body fill" : "dw-body";
        return (
          <aside key={entry.key} className={panelClass} style={{ width: DRAWER_WIDTHS[index] || "40%", zIndex: 100 + index * 10 }} role="dialog" aria-modal="true" aria-label={entry.title}>
            {entry.frameless ? null : (
              <div className="dw-head">
                <div className="dw-titles"><b>{entry.title}</b>{entry.sub ? <span>{entry.sub}</span> : null}</div>
                <button className="dw-x" onClick={close} aria-label={closeLabel}><Icon name="i-x" size={18} /></button>
              </div>
            )}
            <div className={bodyClass}>{entry.body}</div>
          </aside>
        );
      })}
    </div>
  );
}

/* ============================================================
   Overlay layers — outside-click + Esc close baked in.
   Every side-drawer (.drawer-layer) and modal (.modal-layer) MUST wrap its
   panel in these instead of hand-writing the layer + scrim, so clicking the
   scrim and pressing Escape always close it. Enforced by test:ui-overlay.
   ============================================================ */
function useEscClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
}

export function DrawerLayer({ onClose, className, children }: { onClose: () => void; className?: string; children: React.ReactNode }) {
  useEscClose(onClose);
  return overlayPortal(
    <div className={`drawer-layer open${className ? ` ${className}` : ""}`}>
      <div className="scrim" onClick={onClose} />
      {children}
    </div>
  );
}

export function ModalLayer({ onClose, className, children }: { onClose: () => void; className?: string; children: React.ReactNode }) {
  useEscClose(onClose);
  return overlayPortal(
    <div className={`modal-layer open${className ? ` ${className}` : ""}`}>
      <div className="scrim" onClick={onClose} />
      {children}
    </div>
  );
}

function overlayPortal(children: React.ReactNode) {
  if (typeof document === "undefined") return children;
  return createPortal(children, document.body);
}
