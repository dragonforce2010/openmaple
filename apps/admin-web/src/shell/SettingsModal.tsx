import { useEffect, useRef, useState } from "react";
import type { User } from "../types";
import { ACCENTS, Icon, ModalLayer, useTheme } from "../ui";
import { useI18n } from "../appConfig";
import { authProviderLabel } from "../components/shared/misc";

export function SettingsModal(props: { currentUser: User; onClose: () => void }) {
  const { language, setLanguage } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const { theme, setTheme, accent, setAccent, density, setDensity } = useTheme();
  const [tab, setTab] = useState<"appearance" | "language" | "account">("appearance");
  const [accentOpen, setAccentOpen] = useState(false);
  const accentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!accentOpen) return;
    const onDoc = (event: MouseEvent) => { if (accentRef.current && !accentRef.current.contains(event.target as Node)) setAccentOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [accentOpen]);
  const curAccent = ACCENTS.find((option) => option.id === accent) ?? ACCENTS[0];
  return (
    <ModalLayer onClose={props.onClose}>
      <div className="modal lg" role="dialog" aria-modal="true" aria-label={L("设置", "Settings")} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><b>{L("设置", "Settings")}</b><button className="x" onClick={props.onClose} aria-label={L("关闭", "Close")}><Icon name="i-x" size={18} /></button></div>
        <div className="settings-wrap">
          <nav className="settings-nav">
            <button className={`st-tab${tab === "appearance" ? " on" : ""}`} onClick={() => setTab("appearance")}><Icon name="i-grid" size={16} /><span>{L("外观", "Appearance")}</span></button>
            <button className={`st-tab${tab === "language" ? " on" : ""}`} onClick={() => setTab("language")}><Icon name="i-languages" size={16} /><span>{L("语言", "Language")}</span></button>
            <button className={`st-tab${tab === "account" ? " on" : ""}`} onClick={() => setTab("account")}><Icon name="i-user" size={16} /><span>{L("账户", "Account")}</span></button>
          </nav>
          <div className="settings-content">
            {tab === "appearance" ? (
              <>
                <h3 className="st-h">{L("主题", "Theme")}</h3>
                <p className="st-sub">{L("整体界面明暗配色。", "Overall light or dark appearance.")}</p>
                <div className="theme-grid">
                  <button className={`theme-opt${theme !== "light" ? " on" : ""}`} onClick={() => setTheme("dark")}><span className="tw tw-dark"><Icon name="i-moon" size={15} /></span><span className="nm">{L("深色", "Dark")}</span>{theme !== "light" ? <Icon name="i-check" size={15} /> : null}</button>
                  <button className={`theme-opt${theme === "light" ? " on" : ""}`} onClick={() => setTheme("light")}><span className="tw tw-light"><Icon name="i-sun" size={15} /></span><span className="nm">{L("浅色", "Light")}</span>{theme === "light" ? <Icon name="i-check" size={15} /> : null}</button>
                </div>
                <h3 className="st-h" style={{ marginTop: 24 }}>{L("主题色", "Accent color")}</h3>
                <p className="st-sub">{L("用于链接、选中态与强调元素。", "Used for links, selection and emphasis.")}</p>
                <div className="sel-wrap" ref={accentRef}>
                  <button className="sel-btn" aria-haspopup="listbox" aria-expanded={accentOpen} onClick={() => setAccentOpen((value) => !value)}><span className="aw" style={{ background: curAccent.c }} /><span className="nm">{curAccent.name}</span><Icon name="i-chevron-down" size={15} /></button>
                  <div className={`sel-menu${accentOpen ? " open" : ""}`} role="listbox">
                    {ACCENTS.map((option) => (
                      <button key={option.id} className={`sel-opt${accent === option.id ? " on" : ""}`} role="option" aria-selected={accent === option.id} onClick={() => { setAccent(option.id); setAccentOpen(false); }}><span className="aw" style={{ background: option.c }} /><span className="nm">{option.name}</span>{accent === option.id ? <Icon name="i-check" size={15} /> : null}</button>
                    ))}
                  </div>
                </div>
                <h3 className="st-h" style={{ marginTop: 24 }}>{L("密度", "Density")}</h3>
                <p className="st-sub">{L("表格与列表的行高。", "Row height for tables and lists.")}</p>
                <div className="st-seg">
                  <button className={density !== "compact" ? "on" : ""} onClick={() => setDensity("comfortable")}>{L("舒适", "Comfortable")}</button>
                  <button className={density === "compact" ? "on" : ""} onClick={() => setDensity("compact")}>{L("紧凑", "Compact")}</button>
                </div>
              </>
            ) : null}
            {tab === "language" ? (
              <>
                <h3 className="st-h">{L("语言", "Language")}</h3>
                <p className="st-sub">{L("控制台界面语言。", "Interface language for the console.")}</p>
                <div className="st-radio">
                  <button className={`st-opt${language === "zh" ? " on" : ""}`} onClick={() => setLanguage("zh")}><div><b>中文</b><span>简体中文</span></div>{language === "zh" ? <Icon name="i-check" size={16} /> : null}</button>
                  <button className={`st-opt${language === "en" ? " on" : ""}`} onClick={() => setLanguage("en")}><div><b>English</b><span>English (US)</span></div>{language === "en" ? <Icon name="i-check" size={16} /> : null}</button>
                </div>
              </>
            ) : null}
            {tab === "account" ? (
              <>
                <h3 className="st-h">{L("账户", "Account")}</h3>
                <div className="st-row"><span>{L("姓名", "Name")}</span><b>{props.currentUser.name}</b></div>
                <div className="st-row"><span>{L("邮箱", "Email")}</span><b>{props.currentUser.email}</b></div>
                <div className="st-row"><span>{L("登录方式", "Sign-in")}</span><b>{authProviderLabel(props.currentUser.auth_provider)}</b></div>
                <div style={{ marginTop: 18 }}>
                  <button className="btn danger" onClick={async () => { await fetch("/v1/auth/logout", { method: "POST", credentials: "include" }); window.location.reload(); }}><Icon name="i-logout" size={14} /> {L("退出登录", "Log out")}</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </ModalLayer>
  );
}
