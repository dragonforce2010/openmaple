import { useEffect, useRef, useState } from "react";
import type { User } from "../types";
import { AVATARS, Av, Icon } from "../ui";
import { useI18n, type AccessibleTenant } from "../appConfig";


export function UserArea(props: {
  currentUser: User;
  open: boolean;
  setOpen: (value: boolean) => void;
  onSettings: () => void;
  onHelp: () => void;
  onKeys: () => void;
  onLogout: () => void;
  tenants: AccessibleTenant[];
  currentTenantId?: string;
  onSwitchTenant: (tenant: AccessibleTenant) => void;
  canManageWorkspace?: boolean;
}) {
  const { language, setLanguage } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [pane, setPane] = useState<"main" | "lang" | "avatars" | "tenants">("main");
  const [avatarId, setAvatarId] = useState(() => window.localStorage.getItem("cc_avatar") || "");
  const pickAvatar = (id: string) => {
    const next = avatarId === id ? "" : id;
    setAvatarId(next);
    window.localStorage.setItem("cc_avatar", next);
  };
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const onDoc = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) props.setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") props.setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = (props.currentUser.name || "U").slice(0, 1).toUpperCase();
  return (
    <div className="user-wrap" ref={wrapRef}>
      <div className="sidebar-user" id="user-trigger">
        <button className="av-btn" aria-haspopup="true" aria-expanded={props.open} aria-label={L("用户菜单", "User menu")} onClick={() => { setPane("main"); props.setOpen(!props.open); }}>
          <Av avatarId={avatarId} initial={initial} />
        </button>
        <div className="meta" role="button" tabIndex={0} onClick={() => { setPane("main"); props.setOpen(!props.open); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPane("main"); props.setOpen(!props.open); } }}><b>{props.currentUser.name}</b><span>{props.currentUser.email}</span></div>
        <button className="user-gear" aria-haspopup="true" aria-label={L("用户菜单", "User menu")} onClick={() => { setPane("main"); props.setOpen(!props.open); }}><Icon name="i-settings" size={16} /></button>
      </div>
      {props.open ? (
        <div className="user-menu open" role="menu">
          {pane === "main" ? (
            <>
              <div className="um-head"><Av avatarId={avatarId} initial={initial} cls="sm" /><div className="um-id"><b>{props.currentUser.name}</b><span>{props.currentUser.email}</span></div></div>
              <div className="um-sec">
                <button className="um-item" role="menuitem" onClick={() => setPane("avatars")}><Icon name="i-user" size={16} /><span>{L("更换头像", "Change avatar")}</span><span className="um-meta"><Icon name="i-chevron-right" size={14} /></span></button>
                <button className="um-item" role="menuitem" onClick={props.onSettings}><Icon name="i-settings" size={16} /><span>{L("设置", "Settings")}</span><kbd>⌘,</kbd></button>
                <button className="um-item" role="menuitem" onClick={() => setPane("lang")}><Icon name="i-languages" size={16} /><span>{L("语言", "Language")}</span><span className="um-meta">{language === "zh" ? "中文" : "English"} <Icon name="i-chevron-right" size={14} /></span></button>
                {props.tenants.length > 1 ? (
                  <button className="um-item" role="menuitem" onClick={() => setPane("tenants")}><Icon name="i-boxes" size={16} /><span>{L("切换租户", "Switch tenant")}</span><span className="um-meta"><Icon name="i-chevron-right" size={14} /></span></button>
                ) : null}
                <button className="um-item" role="menuitem" onClick={props.onHelp}><Icon name="i-book" size={16} /><span>{L("获取帮助", "Get help")}</span></button>
              </div>
              <div className="um-div" />
              <div className="um-sec">
                {props.canManageWorkspace ? <button className="um-item" role="menuitem" onClick={props.onKeys}><Icon name="i-key" size={16} /><span>{L("秘钥", "API keys")}</span></button> : null}
              </div>
              <div className="um-div" />
              <button className="um-item danger" role="menuitem" onClick={props.onLogout}><Icon name="i-logout" size={16} /><span>{L("退出登录", "Log out")}</span></button>
            </>
          ) : pane === "lang" ? (
            <>
              <button className="um-back" onClick={() => setPane("main")}><Icon name="i-arrow-left" size={15} /> {L("语言", "Language")}</button>
              <div className="um-sec">
                <button className="um-item" role="menuitemradio" aria-checked={language === "zh"} onClick={() => setLanguage("zh")}><span>中文</span>{language === "zh" ? <Icon name="i-check" size={16} /> : null}</button>
                <button className="um-item" role="menuitemradio" aria-checked={language === "en"} onClick={() => setLanguage("en")}><span>English</span>{language === "en" ? <Icon name="i-check" size={16} /> : null}</button>
              </div>
            </>
          ) : pane === "tenants" ? (
            <>
              <button className="um-back" onClick={() => setPane("main")}><Icon name="i-arrow-left" size={15} /> {L("切换租户", "Switch tenant")}</button>
              <div className="um-sec">
                {props.tenants.map((tenant) => {
                  const isCurrent = tenant.id === props.currentTenantId;
                  return (
                    <button key={tenant.id} className="um-item" role="menuitemradio" aria-checked={isCurrent} onClick={() => props.onSwitchTenant(tenant)}>
                      <Icon name="i-boxes" size={16} />
                      <span>{tenant.name}</span>
                      <span className="um-meta">{Number(tenant.is_owner) === 1 ? L("所有者", "Owner") : L("成员", "Member")}</span>
                      {isCurrent ? <Icon name="i-check" size={16} /> : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <button className="um-back" onClick={() => setPane("main")}><Icon name="i-arrow-left" size={15} /> {L("更换头像", "Change avatar")}</button>
              <div className="av-grid">
                {AVATARS.map((avatar) => (
                  <button key={avatar.id} className={avatarId === avatar.id ? "av-opt on" : "av-opt"} title={avatar.name} onClick={() => pickAvatar(avatar.id)}>
                    <div className="av lg av-animal" style={{ background: avatar.bg }}><span className="av-emoji">{avatar.emoji}</span></div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
