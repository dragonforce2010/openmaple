import { useEffect, useRef, useState } from "react";
import { agentLoopOptions, useL } from "../../appConfig";
import type { AgentLoopType, ModelConfig, ModelConnectivityResult } from "../../types";

export function Select(props: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  // show the search box regardless of option count (default only kicks in above 6 options)
  forceSearch?: boolean;
  // fired when the menu expands — use to refresh options from the backend on open
  onOpen?: () => void;
}) {
  const L = useL();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  function toggleOpen() {
    setOpen((value) => {
      if (!value) props.onOpen?.();
      return !value;
    });
  }
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const onDoc = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // mirror native <select>: an unmatched/empty value falls back to the first option instead of showing a placeholder
  const current = props.options.find((option) => option.value === props.value) ?? props.options[0];
  const showSearch = Boolean(props.searchable) && (Boolean(props.forceSearch) || props.options.length > 6);
  const filtered = showSearch && query
    ? props.options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
    : props.options;
  return (
    <div className={`sel${open ? " open" : ""}`} ref={ref}>
      <button type="button" className="sel-trigger" onClick={toggleOpen}>
        <span className="sel-value">{current ? current.label : props.placeholder ?? ""}</span>
        <svg className="ic sel-caret">
          <use href="#i-chevron-down" />
        </svg>
      </button>
      <div className="dropdown sel-menu">
        {showSearch ? (
          <input
            className="sel-search"
            autoFocus
            value={query}
            placeholder={L("搜索…", "Search…")}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}
        {filtered.map((option) => (
          <button
            type="button"
            key={option.value}
            className={option.value === props.value ? "on" : ""}
            onClick={() => {
              props.onChange(option.value);
              setOpen(false);
            }}
          >
            <span className="sel-opt-label">{option.label}</span>
            <svg className="ic">
              <use href="#i-check" />
            </svg>
          </button>
        ))}
        {filtered.length === 0 ? <div className="sel-empty">{L("无匹配", "No matches")}</div> : null}
      </div>
    </div>
  );
}

export function ModelPicker(props: {
  label: string;
  value: string;
  modelConfigs: ModelConfig[];
  onChange: (value: string) => void;
  includeDefault?: boolean;
}) {
  const L = useL();
  const defaultConfig = props.modelConfigs.find((config) => config.is_default) ?? props.modelConfigs[0] ?? null;
  const options: Array<{ value: string; label: string }> = [
    ...(props.includeDefault
      ? [{ value: "", label: defaultConfig ? `${L("默认", "Default")} · ${defaultConfig.name} · ${defaultConfig.model_name}` : L("默认模型", "Default model") }]
      : []),
    ...props.modelConfigs.map((config) => ({
      value: config.id,
      label: `${config.is_default ? `${L("默认", "Default")} · ` : ""}${config.name} · ${config.model_name}`
    }))
  ];
  return (
    <div className="model-picker">
      <span className="model-picker-label">{props.label}</span>
      <Select value={props.value} options={options} onChange={props.onChange} placeholder={L("选择模型", "Select model")} />
    </div>
  );
}

export function AgentLoopPicker(props: { value: AgentLoopType; onChange: (value: AgentLoopType) => void }) {
  const L = useL();
  return (
    <div className="model-picker">
      <span className="model-picker-label">{L("Agent 循环", "Agent loop")}</span>
      <Select
        value={props.value}
        options={agentLoopOptions.map((loop) => ({ value: loop.type, label: loop.label }))}
        onChange={(value) => props.onChange(value as AgentLoopType)}
      />
    </div>
  );
}

export function ConnectivityResult({ result }: { result: ModelConnectivityResult }) {
  const L = useL();
  return (
    <div className={`conn-result ${result.ok ? "ok" : "bad"}`}>
      <div className="cr-head">
        <span className="cr-dot" />
        <span>{result.ok ? L("连接成功", "Connected") : L("连接失败", "Connection failed")}</span>
        <span className="cr-latency">{result.status ? `HTTP ${result.status}` : L("无响应", "No response")} · {result.latency_ms}ms</span>
      </div>
      <div className="cr-body">
        {result.message ? (
          <div className="cr-row"><span className="cr-k">{L("消息", "Message")}</span><span className="cr-v">{result.message}</span></div>
        ) : null}
        <div className="cr-row"><span className="cr-k">Endpoint</span><span className="cr-v mono">{result.model} @ {result.base_url}</span></div>
      </div>
    </div>
  );
}
