import { existsSync, readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

export function prototypeResponse(prototypeHtmlPath: string) {
  if (!existsSync(prototypeHtmlPath)) {
    return new Response(`Prototype UI is missing: ${prototypeHtmlPath}`, { status: 503 });
  }
  return new Response(dynamicPrototypeHtml(prototypeHtmlPath), {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function dynamicPrototypeHtml(prototypeHtmlPath: string) {
  if (process.env.MAPLE_PROTOTYPE_DYNAMIC === "0") return readFileSync(prototypeHtmlPath, "utf8");
  const html = readFileSync(prototypeHtmlPath, "utf8");
  return html.replace(
    /<script type="__bundler\/manifest">\s*([\s\S]*?)\s*<\/script>/,
    (_match, rawManifest: string) => {
      const manifest = JSON.parse(rawManifest) as Record<string, { mime: string; compressed?: boolean; data: string }>;
      for (const entry of Object.values(manifest)) {
        if (!entry.mime.includes("javascript")) continue;
        const bytes = Buffer.from(entry.data, "base64");
        const source = (entry.compressed ? gunzipSync(bytes) : bytes).toString("utf8");
        const transformed = transformPrototypeBundle(source);
        const output = entry.compressed ? gzipSync(Buffer.from(transformed, "utf8")) : Buffer.from(transformed, "utf8");
        entry.data = output.toString("base64");
      }
      return `<script type="__bundler/manifest">\n${JSON.stringify(manifest)}\n</script>`;
    }
  );
}

function transformPrototypeBundle(source: string) {
  const hydrate = `
async function mapleHydrateFromApi(){
  try{
    const params = new URLSearchParams(location.search);
    const headers = params.get('dev_login') === '1' ? {'x-maple-api-key':'maple_dev_key'} : {};
    const response = await fetch('/v1/console_snapshot', { credentials:'include', headers });
    if(!response.ok) return;
    const data = await response.json();
    if(data.me){ Object.assign(ME, data.me); ME.initial=(ME.name&&ME.name[0]||ME.email&&ME.email[0]||'M').toUpperCase(); }
    replaceMapleArray(WORKSPACES, data.workspaces);
    replaceMapleArray(AGENTS, data.agents);
    replaceMapleArray(SESSIONS, data.sessions);
    replaceMapleArray(ENVS, data.environments);
    replaceMapleArray(VAULTS, data.vaults);
    replaceMapleArray(MODELS, data.models);
    replaceMapleArray(API_KEYS, data.api_keys);
    replaceMapleObject(TENANT, data.tenant);
    replaceMapleObject(EVENTS_BY, data.events_by);
    replaceMapleObject(EVENT_DETAIL, data.event_detail);
    COUNTS.agents=AGENTS.length; COUNTS.sessions=SESSIONS.length; COUNTS.environments=ENVS.length; COUNTS.vaults=VAULTS.length; COUNTS.models=MODELS.length;
    if(WORKSPACES[0] && !WORKSPACES.some(w=>w.id===state.ws)) state.ws=WORKSPACES[0].id;
    if(!SESSIONS.some(s=>s.id===state.curSession)) state.curSession=SESSIONS[0]&&SESSIONS[0].id||'';
    state.sel.agents=AGENTS[0]&&AGENTS[0].id||'';
    state.sel.envs=ENVS[0]&&ENVS[0].id||'';
    state.sel.vaults=VAULTS[0]&&VAULTS[0].id||'';
    state.sel.models=MODELS[0]&&MODELS[0].id||'';
  }catch(error){ console.error('[maple] console snapshot failed', error); }
}
function replaceMapleArray(target,value){ target.splice(0,target.length,...(Array.isArray(value)?value:[])); }
function replaceMapleObject(target,value){ Object.keys(target).forEach(k=>delete target[k]); Object.assign(target,value||{}); }
function mapleHeaders(extra){
  const headers=Object.assign({'content-type':'application/json'},extra||{});
  if(new URLSearchParams(location.search).get('dev_login')==='1') headers['x-maple-api-key']='maple_dev_key';
  return headers;
}
async function mapleApi(path,options){
  const init=Object.assign({},options||{});
  const method=String(init.method||'GET').toUpperCase();
  const headers=mapleHeaders(init.headers);
  if(method==='PATCH'||method==='DELETE'){
    headers['x-http-method-override']=method;
    init.method='POST';
  }
  const response=await fetch(path,Object.assign({credentials:'include'},init,{headers}));
  if(!response.ok){
    let text='';
    try{text=await response.text();}catch(_){}
    throw new Error(text||String(response.status));
  }
  if(response.status===204) return null;
  return response.json();
}
async function mapleRefresh(){
  await mapleHydrateFromApi();
  if(typeof renderNav==='function') renderNav();
  if(typeof syncWsPicker==='function') syncWsPicker();
  if(typeof mount==='function') mount();
}
function mapleWorkspaceId(){ return state.ws&&state.ws!=='__all__'?state.ws:(WORKSPACES[0]&&WORKSPACES[0].id||''); }
function mapleSlug(value){ return String(value||'workspace').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,30)||'workspace'; }
function mapleRuntimePoolDefaults(){ return {desired_size:1,min_instances_per_function:1,max_instances_per_function:100,max_concurrency_per_instance:1000,cpu_milli:2000,memory_mb:4096}; }
`;
  let output = source.replace("/* ============================================================\n   INIT", `${hydrate}\n/* ============================================================\n   INIT`);
  output = output.replace(
    "function curWs(){ return WORKSPACES.find(w=>w.id===state.ws) || WORKSPACES[0]; }",
    "function curWs(){ return WORKSPACES.find(w=>w.id===state.ws) || WORKSPACES[0] || {id:'',name:L('未开通工作区','No workspace'),color:'#8b5cf6',geo:'',note:''}; }"
  );
  output = output.replace(
    /function confirmNewSession\(\)\{[\s\S]*?\n\}\nfunction hashStr/,
    `async function confirmNewSession(){
  const ag=$('#ns-agent')&&$('#ns-agent').value; const a=AGENTS.find(x=>x.id===ag);
  if(!a){ toast(L('请先创建 Agent','Create an agent first'),'err'); return; }
  const env=ENVS[0];
  if(!env){ toast(L('请先创建环境','Create an environment first'),'err'); return; }
  const title=($('#ns-title').value||'').trim()||L('未命名会话','Untitled session');
  try{
    const session=await mapleApi('/v1/sessions',{method:'POST',body:JSON.stringify({
      workspace_id:mapleWorkspaceId()||undefined,
      agent:ag,
      environment_id:env.id,
      title,
      vault_ids:VAULTS[0]?[VAULTS[0].id]:[],
      resources:[],
      metadata:{source:'prototype_console'}
    })});
    closeModal(); toast(L('会话已创建','Session created'));
    await mapleHydrateFromApi(); renderNav(); syncWsPicker(); mount();
    openSession(session&&session.id);
  }catch(error){ toast(L('会话创建失败','Session create failed')+' · '+(error&&error.message||error),'err'); }
}
function hashStr`
  );
  output = output.replace(
    /function askSubmit\(\)\{[\s\S]*?\n\}\nfunction askDefaultBody\(\)\{[\s\S]*?\n\}\n\n\/\* ============================================================\n   POPUP/,
    `function askSubmit(){
  const q=$('#ask-q'); const v=(q.value||'').trim();
  if(!v){ toast(L('请输入问题','Type a question first'),'info'); q.focus(); return; }
  const body=$('#ask-body'); const evs=curEvents(); const count=evs.length;
  body.insertAdjacentHTML('afterbegin','<section class="acard"><h3>'+L('回答','Answer')+'</h3><p>'+L('已根据当前 Session 的事件重新分析：','Re-analyzed the current session events: ')+'<b>'+esc(v)+'</b> — '+(count?L('请查看事件分布与工具调用明细。','Review the event distribution and tool-call details.'):L('当前没有可分析的事件。','There are no events to analyze yet.'))+'</p></section>');
  q.value='';
  toast(L('已生成回答','Answer generated'));
}
function askDefaultBody(){
  const current=SESSIONS.find(s=>s.id===state.curSession);
  const evs=curEvents();
  const toolCount=evs.filter(e=>e.kind==='tool'||e.role==='Tool').length;
  const status=current&&current.status||'idle';
  if(!current) return '<section class="acard"><h3>'+L('回答','Answer')+'</h3><p>'+L('当前还没有 Session。创建并运行 Session 后，Ask Maple 会基于真实事件进行分析。','No session yet. Ask Maple will analyze real events after a session is created and run.')+'</p><div class="tile-grid c3"><div class="tile"><div class="lbl">Events</div><div class="num">0</div></div><div class="tile"><div class="lbl">Tools</div><div class="num">0</div></div><div class="tile"><div class="lbl">Status</div><div class="num">idle</div></div></div></section>';
  const groups={}; evs.forEach(e=>{ const key=e.kind==='tool'?'tool.result':(e.role||'Session'); groups[key]=(groups[key]||0)+1; });
  const max=Math.max(1,...Object.values(groups));
  const rows=Object.entries(groups).map(r=>'<div class="mc-row"><span>'+esc(r[0])+'</span><div class="track"><i style="width:'+Math.round(Number(r[1])/max*100)+'%"></i></div><b>'+r[1]+'</b></div>').join('');
  return '<section class="acard"><h3>'+L('回答','Answer')+'</h3><p>'+L('当前 Session 状态为','Current session status is')+' '+esc(status)+'，'+L('共记录','with')+' '+evs.length+' '+L('个事件、','events and')+' '+toolCount+' '+L('次工具调用。','tool calls.')+'</p><div class="tile-grid c3"><div class="tile"><div class="lbl">Events</div><div class="num">'+evs.length+'</div></div><div class="tile"><div class="lbl">Tools</div><div class="num">'+toolCount+'</div></div><div class="tile"><div class="lbl">Status</div><div class="num">'+esc(status)+'</div></div></div></section><section class="acard"><h3>'+L('事件分布','Event distribution')+'</h3><div class="mini-chart">'+(rows||'<div class="panel-empty">'+L('暂无事件','No events')+'</div>')+'</div></section>';
}

/* ============================================================
   POPUP`
  );
  output = output.replace(
    "  const tiles=[\n    ['i-brain',L('活跃 Agent','Active agents'),'3',L('共 3 个','3 total'),'up','agents'],\n    ['i-terminal',L('运行中 Session','Running sessions'),'1',L('4 个会话','4 sessions'),'','sessions'],\n    ['i-server',L('环境','Environments'),'4',L('3 就绪','3 ready'),'','envs'],\n    ['i-gauge',L('模型接入点','Model endpoints'),'3',L('1 默认','1 default'),'','models']\n  ];",
    "  const runningSessions=SESSIONS.filter(s=>s.status==='running').length;\n  const readyEnvs=ENVS.length;\n  const defaultModels=MODELS.filter(m=>m.def).length;\n  const tiles=[\n    ['i-brain',L('活跃 Agent','Active agents'),String(AGENTS.length),L('共 '+AGENTS.length+' 个',AGENTS.length+' total'),AGENTS.length?'up':'','agents'],\n    ['i-terminal',L('运行中 Session','Running sessions'),String(runningSessions),L(SESSIONS.length+' 个会话',SESSIONS.length+' sessions'),'','sessions'],\n    ['i-server',L('环境','Environments'),String(ENVS.length),L(readyEnvs+' 就绪',readyEnvs+' ready'),'','envs'],\n    ['i-gauge',L('模型接入点','Model endpoints'),String(MODELS.length),L(defaultModels+' 默认',defaultModels+' default'),'','models']\n  ];"
  );
  output = output.replace(
    /function confirmCreateWorkspace\(\)\{[\s\S]*?\n\}\n\n\/\* ============================================================\n   API KEYS/,
    `async function confirmCreateWorkspace(){
  const n=($('#ws-name').value||'').trim(); if(!n){ toast(L('请填写名称','Name is required'),'err'); $('#ws-name').focus(); return; }
  try{
    const body={workspace:{name:n,description:'',slug:mapleSlug(n)},runtime_provider:'vefaas',sandbox_provider:'e2b',runtime_pool:mapleRuntimePoolDefaults(),model_config_ids:MODELS.map(m=>m.id),api_key:{display_name:'Default workspace key',scopes:['control_plane','data_plane']},provider_credentials:{}};
    const created=await mapleApi('/v1/workspaces',{method:'POST',body:JSON.stringify(body)});
    await mapleHydrateFromApi();
    state.ws=(created&&created.workspace&&created.workspace.id)||state.ws;
    if(state.ws) LS.set('cc_ws',state.ws);
    closeModal(); syncWsPicker(); toast(L('工作区已创建 · ','Workspace created · ')+n); renderNav(); mount();
  }catch(error){ toast(L('工作区创建失败','Workspace create failed')+' · '+(error&&error.message||error),'err'); }
}

/* ============================================================
   API KEYS`
  );
  output = output.replace(
    /function openCreateKey\(\)\{[\s\S]*?\n\}\nfunction confirmCreateKey\(\)\{[\s\S]*?\n\}\nfunction copyKey/,
    `function openCreateKey(){
  const wsId=mapleWorkspaceId();
  if(!wsId){ toast(L('请先创建工作区','Create a workspace first'),'info'); return; }
  const w=WORKSPACES.find(x=>x.id===wsId)||WORKSPACES[0];
  openModal('<div class="modal"><div class="modal-head"><b>'+L('创建 API Key','Create API key')+'</b><button class="x" onclick="closeModal()" aria-label="'+L('关闭','Close')+'">'+ic('i-x',18)+'</button></div><div class="modal-body"><div class="modal-note">'+ic('i-alert',16)+' '+L('密钥归属当前工作区，创建者被移除后仍然有效。','This key is owned by the workspace and stays active even after its creator is removed.')+'</div><label class="form">'+L('名称','Name')+'<input class="fld" id="ak-name" placeholder="my-api-key" /></label><div class="form">'+L('归属工作区','Workspace')+'<div class="ws-readonly" id="ak-ws" data-ws="'+wsId+'"><span class="ws-dot" style="background:'+w.color+'"></span>'+esc(w.name)+'<span class="ro-tag">'+L('当前工作区','Current')+'</span></div></div></div><div class="modal-foot"><button class="btn secondary" onclick="closeModal()">'+L('取消','Cancel')+'</button><button class="btn primary" onclick="confirmCreateKey()">'+L('创建 Key','Create key')+'</button></div></div>');
}
async function confirmCreateKey(){
  const n=($('#ak-name').value||'').trim(); if(!n){ toast(L('请填写名称','Name is required'),'err'); $('#ak-name').focus(); return; }
  const wsId=$('#ak-ws').dataset.ws;
  try{
    const created=await mapleApi('/v1/workspaces/'+encodeURIComponent(wsId)+'/api_keys',{method:'POST',body:JSON.stringify({display_name:n,scopes:['control_plane','data_plane']})});
    const full=created&&created.key||'';
    await mapleHydrateFromApi(); mount();
    const escaped=String(full).replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'");
    openModal('<div class="modal"><div class="modal-head"><b>'+L('API Key 已创建','API key created')+'</b><button class="x" onclick="closeModal()" aria-label="'+L('关闭','Close')+'">'+ic('i-x',18)+'</button></div><div class="modal-body"><div class="modal-note">'+ic('i-alert',16)+' '+L('请立即复制并妥善保存。出于安全考虑，关闭后将无法再次查看完整密钥。','Copy and store it now. For security, you will not be able to view the full key again.')+'</div><div class="reveal-key"><code id="reveal-code">'+esc(full)+'</code><button class="btn secondary compact" onclick="copyKey(\\''+escaped+'\\')">'+ic('i-file',13)+' '+L('复制','Copy')+'</button></div></div><div class="modal-foot"><button class="btn primary" onclick="closeModal()">'+L('完成','Done')+'</button></div></div>');
    toast(L('API Key 已创建','API key created'));
  }catch(error){ toast(L('API Key 创建失败','API key create failed')+' · '+(error&&error.message||error),'err'); }
}
function copyKey`
  );
  output = output.replace(
    "function confirmRenameKey(id){ const k=API_KEYS.find(x=>x.id===id); if(!k) return; const n=($('#rk-name').value||'').trim(); if(!n){ toast(L('请填写名称','Name is required'),'err'); return; } k.name=n; closeModal(); toast(L('已重命名','Renamed')); mount(); }",
    "async function confirmRenameKey(id){ const k=API_KEYS.find(x=>x.id===id); if(!k) return; const n=($('#rk-name').value||'').trim(); if(!n){ toast(L('请填写名称','Name is required'),'err'); return; } try{ await mapleApi('/v1/workspaces/'+encodeURIComponent(k.ws)+'/api_keys/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({display_name:n})}); closeModal(); toast(L('已重命名','Renamed')); await mapleRefresh(); }catch(error){ toast(L('重命名失败','Rename failed')+' · '+(error&&error.message||error),'err'); } }"
  );
  output = output.replace(
    "onConfirm:()=>{ const i=API_KEYS.findIndex(x=>x.id===id); if(i>=0) API_KEYS.splice(i,1); toast(L('API Key 已删除','API key deleted')); mount(); } });",
    "onConfirm:async()=>{ try{ await mapleApi('/v1/workspaces/'+encodeURIComponent(k.ws)+'/api_keys/'+encodeURIComponent(id),{method:'DELETE'}); toast(L('API Key 已删除','API key deleted')); await mapleRefresh(); }catch(error){ toast(L('删除失败','Delete failed')+' · '+(error&&error.message||error),'err'); } } });"
  );
  output = output.replace(
    /function confirmCreateVault\(\)\{[\s\S]*?\n\}\nfunction viewMemory/,
    `async function confirmCreateVault(){
  const n=($('#vault-name').value||'').trim(); if(!n){ toast(L('请填写名称','Name is required'),'err'); return; }
  try{
    const wsId=mapleWorkspaceId();
    await mapleApi('/v1/vaults',{method:'POST',body:JSON.stringify({workspace_id:wsId||undefined,display_name:n,metadata:{source:'prototype_console'}})});
    closeModal(); toast(L('凭证库已创建','Vault created')); await mapleRefresh();
  }catch(error){ toast(L('凭证库创建失败','Vault create failed')+' · '+(error&&error.message||error),'err'); }
}
function viewMemory`
  );
  output = output.replace(
    /function saveEnv\(isNew\)\{[\s\S]*?\n\}\nfunction cancelEnv/,
    `async function saveEnv(isNew){
  flushEnvDraft(); const d=state.env.draft;
  const wsId=mapleWorkspaceId();
  const metadata=Object.fromEntries((d.meta||[]).filter(m=>m&&m[0]).map(m=>[m[0],m[1]||'']));
  metadata.description=d.desc||'';
  const payload={workspace_id:wsId||undefined,name:d.name,description:d.desc||'',config:{sandbox:{provider:d.rt||'e2b'},networking:{mode:d.net||'cloud_limited'},packages:d.pkgs||[]},metadata};
  try{
    let saved;
    if(isNew){
      if(!d.name){ toast(L('请填写环境名称','Environment name is required'),'err'); return; }
      saved=await mapleApi('/v1/environments',{method:'POST',body:JSON.stringify(payload)});
    } else {
      saved=await mapleApi('/v1/environments/'+encodeURIComponent(state.route.id),{method:'PATCH',body:JSON.stringify(payload)});
    }
    state.env.dirty=false; state.env.draft=null; toast(L('配置已保存','Configuration saved'));
    await mapleHydrateFromApi(); renderNav(); navigate('environment',{id:saved&&saved.id||state.route.id});
  }catch(error){ toast(L('环境保存失败','Environment save failed')+' · '+(error&&error.message||error),'err'); }
}
function cancelEnv`
  );
  output = output.replace(
    /function saveWorkspaceSettings\(\)\{[\s\S]*?\n\}\nfunction openProvision/,
    `async function saveWorkspaceSettings(){
  const n=((state._wsDraft&&state._wsDraft.name)||'').trim();
  if(!n){ toast(L('请填写工作区名称','Workspace name is required'),'err'); if(state._wsTab!=='basic') wsGo('basic'); const el=$('#wsc-name'); if(el) el.focus(); return; }
  const id=mapleWorkspaceId();
  if(!id){ toast(L('请先创建工作区','Create a workspace first'),'info'); return; }
  try{
    await mapleApi('/v1/workspaces/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({name:n,description:(state._wsDraft&&state._wsDraft.desc)||''})});
    closeModal(); toast(L('工作区设置已保存','Workspace settings saved')); await mapleRefresh();
  }catch(error){ toast(L('保存失败','Save failed')+' · '+(error&&error.message||error),'err'); }
}
function openProvision`
  );
  output = output.replace(
    /function confirmAddModel\(\)\{[\s\S]*?\n\n\/\* ============================================================\n   SKILLS/,
    `async function confirmAddModel(){
  const d=state._modelDraft; const n=(d.name||'').trim();
  if(!n){ toast(L('请填写名称','Name is required'),'err'); return; }
  if(!(d.models&&d.models.length)){ toast(L('请至少添加一个模型名称','Add at least one model name'),'err'); return; }
  const base=(d.url||'').trim()||'https://api.openai.com/v1';
  try{
    if(d.id){
      await mapleApi('/v1/model_configs/'+encodeURIComponent(d.id),{method:'PATCH',body:JSON.stringify({name:n,base_url:base,model_name:d.models[0]})});
      toast(L('模型已更新','Model updated'));
    } else {
      const created=await mapleApi('/v1/model_configs',{method:'POST',body:JSON.stringify({kind:'custom',name:n,base_url:base,model_name:d.models[0],api_key:d.key||'',is_default:MODELS.length===0})});
      state.sel.models=created&&created.id||state.sel.models;
      toast(L('模型已添加','Model added'));
    }
    closeModal(); await mapleRefresh();
  }catch(error){ toast(L('模型保存失败','Model save failed')+' · '+(error&&error.message||error),'err'); }
}
async function setDefaultModel(id){ closeAllPopups(); try{ await mapleApi('/v1/model_configs/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({is_default:true})}); toast(L('已设为默认模型','Set as default model')); await mapleRefresh(); }catch(error){ toast(L('设置失败','Set default failed')+' · '+(error&&error.message||error),'err'); } }
function deleteModel(id){
  closeAllPopups(); const m=MODELS.find(x=>x.id===id); if(!m) return;
  openConfirm({ title:L('删除模型接入点','Delete model endpoint'),
    body:L('删除后，引用此接入点的工作区与 Agent 将无法调用该模型。','Workspaces and agents referencing this endpoint will no longer be able to use it.'),
    cancel:L('取消','Cancel'), confirm:L('删除','Delete'), danger:true,
    onConfirm:async()=>{ try{ await mapleApi('/v1/model_configs/'+encodeURIComponent(id),{method:'DELETE'}); toast(L('模型已删除','Model deleted')); await mapleRefresh(); }catch(error){ toast(L('删除失败','Delete failed')+' · '+(error&&error.message||error),'err'); } } });
}

/* ============================================================
	   SKILLS`
  );
  output = output.replace(
    /function qsConfigHtml\(\)\{[\s\S]*?\n\}\nfunction qsCopyCode/,
    `function qsAgentConfigText(){
  const a=state.qs.agent; if(!a) return state.qs.fmt==='json'?tplJson(4):tplYaml(4);
  const c=a.config||a;
  if(state.qs.fmt==='json') return JSON.stringify(c,null,2);
  const model=c.model||{};
  return 'name: '+(c.name||a.name||'Agent')+'\\ndescription: '+(c.description||a.description||'')+'\\nmodel:\\n  provider: '+(model.provider||'custom')+'\\n  id: '+(model.id||'')+(model.config_id?'\\n  config_id: '+model.config_id:'')+'\\nsystem: '+(c.system||'')+'\\nagent_loop:\\n  type: '+(((c.agent_loop||{}).type)||'anthropic_claude_code')+'\\ntools: '+JSON.stringify(c.tools||[])+'\\nmcp_servers: '+JSON.stringify(c.mcp_servers||[])+'\\nskills: '+JSON.stringify(c.skills||[]);
}
function qsConfigHtml(){
  const a=state.qs.agent;
  const label=a?(esc(a.name||'Agent')+' · '+esc(a.id||'')):L('等待 Agent 创建','Waiting for agent');
  const status=a?'created':L('待创建','pending');
  return '<div class="qs-config"><div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:10px;margin:0 0 14px"><span class="status active">'+status+'</span><span>'+label+'</span></div><div class="fmt-tabs" style="padding:0 0 10px"><button class="'+(state.qs.fmt==='yaml'?'on':'')+'" onclick="setFmt(\\'yaml\\')">YAML</button><button class="'+(state.qs.fmt==='json'?'on':'')+'" onclick="setFmt(\\'json\\')">JSON</button><div class="right"><button class="icon-btn" onclick="copyConfig()">'+ic('i-copy',15)+'</button></div></div><pre class="qs-tpld-code"><code>'+esc(qsAgentConfigText())+'</code></pre></div>';
}
function qsCopyCode`
  );
  output = output.replace(
    "function copyConfig(){ navClip(state.qs.fmt==='json'?tplJson(4):tplYaml(4)); }",
    "function copyConfig(){ navClip(qsAgentConfigText()); }"
  );
  output = output.replace(
    /function qsGenerate\(\)\{[\s\S]*?\n\}\nfunction qsScrollConv/,
    `function qsPromptAgentPayload(prompt,model){
  const modelName=(model&&((model.models&&model.models[0])||model.model||model.name))||'prototype-model';
  return { name:L('客服 Agent','Support Agent'), description:prompt.slice(0,180)||L('通过 Quickstart 创建','Created from Quickstart'), model:{provider:'custom',id:modelName,name:model&&model.name||modelName,config_id:model&&model.id||undefined}, system:'你是一位专业、友好的客服代表。严格依据已连接的知识与工具回答；超出范围时说明限制并升级人工。\\n\\n用户需求：'+prompt, tools:[], mcp_servers:[], skills:[], agent_loop:{type:'anthropic_claude_code',config:{execution:'provider'},hooks:[]}, metadata:{source:'prototype_quickstart'} };
}
function qsCodeBody(value){ try{return JSON.stringify(value,null,2);}catch(_){return String(value||'');} }
async function qsGenerate(){
  const ta=$('#qs-prompt-input'); const prompt=(ta&&ta.value.trim())||DEFAULT_PROMPT;
  state.qs.started=true; state.qs.step=0; state.qs.viewTpl=null; state.qs.agent=null; state.qs.env=null; state.qs.session=null; state.qs.chat=[];
  state.qs.conv=[{type:'user',text:prompt},{type:'status',icon:'i-sparkles',text:L('正在创建 Agent','Creating agent')}];
  renderQsAll(); qsScrollConv();
  try{
    const wsId=mapleWorkspaceId();
    if(!wsId) throw new Error(L('请先创建工作区','Create a workspace first'));
    const model=MODELS[0];
    if(!model) throw new Error(L('请先添加模型接入点','Add a model endpoint first'));
    const agentPayload=qsPromptAgentPayload(prompt,model);
    const agent=await mapleApi('/v1/agents',{method:'POST',body:JSON.stringify(Object.assign({workspace_id:wsId},agentPayload))});
    state.qs.agent=agent;
    state.qs.conv.push({type:'status',text:L('Agent 已创建','Agent created')},{type:'code',method:'POST',path:'/v1/agents',body:qsCodeBody(Object.assign({workspace_id:wsId},agentPayload))},{type:'text',text:L('Agent 已成功创建——它定义了助手的角色、模型与工具。接下来准备运行环境。','Agent created — it defines the role, model and tools. Next, prepare a runtime environment.')});
    state.qs.step=1; state.qs.rtab='config'; await mapleHydrateFromApi(); renderQsAll(); qsScrollConv();
    let env=ENVS[0];
    if(!env){
      const envPayload={workspace_id:wsId,name:'quickstart-e2b-env',description:'Quickstart runtime environment',config:{sandbox:{provider:'e2b'},networking:{mode:'cloud_limited'},packages:[]},metadata:{description:'Quickstart runtime environment',source:'prototype_quickstart'}};
      env=await mapleApi('/v1/environments',{method:'POST',body:JSON.stringify(envPayload)});
      state.qs.conv.push({type:'status',text:L('环境已创建','Environment created')},{type:'code',method:'POST',path:'/v1/environments',body:qsCodeBody(envPayload)});
    } else {
      state.qs.conv.push({type:'status',text:L('环境已就绪','Environment ready')},{type:'text',text:L('复用当前工作区已有环境：','Reusing existing environment: ')+(env.name||env.id)});
    }
    state.qs.env=env; state.qs.step=2; await mapleHydrateFromApi(); renderQsAll(); qsScrollConv();
    const envId=env&&env.id||(ENVS[0]&&ENVS[0].id);
    if(!envId) throw new Error(L('运行环境不可用','Runtime environment is unavailable'));
    const title=prompt.slice(0,36)||L('Quickstart Session','Quickstart session');
    const sessionPayload={workspace_id:wsId,agent:agent.id,environment_id:envId,title,vault_ids:VAULTS[0]?[VAULTS[0].id]:[],resources:[],metadata:{source:'prototype_quickstart'}};
    const session=await mapleApi('/v1/sessions',{method:'POST',body:JSON.stringify(sessionPayload)});
    state.qs.session=session; state.curSession=session&&session.id||state.curSession;
    state.qs.conv.push({type:'status',text:L('Session 已创建','Session created')},{type:'code',method:'POST',path:'/v1/sessions',body:qsCodeBody(sessionPayload)},{type:'text',text:L('你的 Session 已创建！在右侧 Preview 面板发送第一条消息，开始与 Agent 对话。','Your session is created — send a message in Preview to start chatting with the agent.')});
    state.qs.step=3; state.qs.rtab='preview'; await mapleHydrateFromApi(); renderQsAll(); qsScrollConv(); renderNav(); toast(L('Session 已启动','Session started'));
  }catch(error){
    state.qs.conv.push({type:'status',icon:'i-alert',text:L('Quickstart 失败','Quickstart failed')},{type:'text',text:String(error&&error.message||error)});
    renderQsAll(); qsScrollConv(); toast(L('Quickstart 失败','Quickstart failed')+' · '+(error&&error.message||error),'err');
  }
}
function qsScrollConv`
  );
  output = output.replace(
    /function qsTestHtml\(\)\{[\s\S]*?\n\}\nfunction qsTestSend\(\)\{[\s\S]*?\n\}\nfunction afterQuickstart/,
    `function qsTestHtml(){
  const msgs=state.qs.chat.length?state.qs.chat:[{who:'agent',text:L('你好，我是客服 Agent。请问有什么可以帮你？','Hi, I am your support agent. How can I help?')}];
  const env=state.qs.env||ENVS[0]||{}; const session=state.qs.session||{};
  const viewAction=session.id?"openSession('"+session.id+"')":"toast(L('请先创建 Session','Create a session first'),'info')";
  return '<div class="qs-prev-head"><span>'+ic('i-cloud',14)+' '+esc(env.name||env.id||'Environment')+'</span><button class="more" onclick="'+viewAction+'">'+L('查看会话','View session')+' ↗</button></div><div class="chat" id="qs-chat">'+msgs.map(m=>'<div class="bubble '+m.who+'"><span class="who">'+(m.who==='user'?L('你','You'):'Agent')+'</span>'+esc(m.text)+'</div>').join('')+'</div><div class="composer"><input id="qs-test-input" placeholder="'+L('给 Agent 发条消息…','Send a message to the agent…')+'" onkeydown="if(event.key===\\'Enter\\')qsTestSend()" /><button class="send-btn" onclick="qsTestSend()">'+ic('i-arrow-up',16)+'</button></div>';
}
async function qsTestSend(){
  const inp=$('#qs-test-input'); const v=(inp&&inp.value||'').trim(); if(!v) return;
  const session=state.qs.session; if(!session||!session.id){ toast(L('请先创建 Session','Create a session first'),'err'); return; }
  if(!state.qs.chat.length) state.qs.chat.push({who:'agent',text:L('你好，我是客服 Agent。请问有什么可以帮你？','Hi, I am your support agent. How can I help?')});
  state.qs.chat.push({who:'user',text:v}); inp.value='';
  const chat=$('#qs-chat'); if(chat){ chat.innerHTML=state.qs.chat.map(m=>'<div class="bubble '+m.who+'"><span class="who">'+(m.who==='user'?L('你','You'):'Agent')+'</span>'+esc(m.text)+'</div>').join('')+'<div class="bubble agent"><span class="who">Agent</span><span class="typing"><i></i><i></i><i></i></span></div>'; chat.scrollTop=chat.scrollHeight; }
  try{
    await mapleApi('/v1/sessions/'+encodeURIComponent(session.id)+'/events',{method:'POST',body:JSON.stringify({events:[{type:'user.message',content:[{type:'text',text:v}],payload:{source:'prototype_quickstart_preview'}}]})});
    state.qs.chat.push({who:'agent',text:L('消息已发送到真实 Session；事件流会记录后续回答。','Message sent to the real session; the event stream will record the follow-up answer.')});
    await mapleHydrateFromApi();
  }catch(error){
    state.qs.chat.push({who:'agent',text:L('发送失败：','Send failed: ')+(error&&error.message||error)});
  }
  const c=$('#qs-chat'); if(c){ c.innerHTML=state.qs.chat.map(m=>'<div class="bubble '+m.who+'"><span class="who">'+(m.who==='user'?L('你','You'):'Agent')+'</span>'+esc(m.text)+'</div>').join(''); c.scrollTop=c.scrollHeight; }
}
function afterQuickstart`
  );
  output = output.replace(
    "function panelAgent(id){\n  const a=AGENTS.find(x=>x.id===id)||AGENTS[0];\n  return `<div class=\"drawer-detail\">",
    "function panelAgent(id){\n  const a=AGENTS.find(x=>x.id===id)||AGENTS[0];\n  if(!a) return `<div class=\"panel-empty\">${L('暂无 Agent','No agents')}</div>`;\n  return `<div class=\"drawer-detail\">"
  );
  output = output.replace(
    "function panelEnv(id){\n  const e=ENVS.find(x=>x.id===id)||ENVS[0];\n  return settingsHead(e.name,e.id,'i-server')+kv(L('运行时','Runtime'),e.rt)+kv('Networking',netLabel(e.net))+kv(L('包','Packages'),e.pkgs.length)+",
    "function panelEnv(id){\n  const e=ENVS.find(x=>x.id===id)||ENVS[0];\n  if(!e) return `<div class=\"panel-empty\">${L('暂无环境','No environments')}</div>`;\n  return settingsHead(e.name,e.id,'i-server')+kv(L('运行时','Runtime'),e.rt)+kv('Networking',netLabel(e.net))+kv(L('包','Packages'),e.pkgs.length)+"
  );
  output = output.replace(
    "function panelVault(id){ const v=VAULTS.find(x=>x.id===id)||VAULTS[0];\n  return settingsHead(v.name,v.id,'i-key')+kv(L('凭证数','Credentials'),v.cred)+kv(L('作用域','Scope'),'workspace')+",
    "function panelVault(id){ const v=VAULTS.find(x=>x.id===id)||VAULTS[0];\n  if(!v) return `<div class=\"panel-empty\">${L('暂无凭证库','No vaults')}</div>`;\n  return settingsHead(v.name,v.id,'i-key')+kv(L('凭证数','Credentials'),v.cred)+kv(L('作用域','Scope'),'workspace')+"
  );
  output = output.replace(
    "function viewSessions(){\n  ensureSel();\n  const s=SESSIONS.find(x=>x.id===state.curSession)||SESSIONS[0];",
    "function viewSessions(){\n  ensureSel();\n  const s=SESSIONS.find(x=>x.id===state.curSession)||SESSIONS[0];\n  if(!s) return pageHead('Sessions', L('暂无会话。请先创建 Agent、Environment 后再新建 Session。','No sessions yet. Create an agent and environment first.'), `<button class=\"btn primary\" onclick=\"openNewSession()\">${ic('i-plus',15)} ${L('新建 Session','New session')}</button>`) + `<div class=\"panel-empty\">${L('暂无会话','No sessions')}</div>`;"
  );
  output = output.replace(
    "if(LS.get('cc_authed')){\n  if(LS.get('cc_provision')) state.route={view:'provision'};\n  renderShell();\n} else {\n  renderAuthGate();\n}",
    "if(new URLSearchParams(location.search).get('dev_login')==='1') LS.set('cc_authed','1');\n(async()=>{ await mapleHydrateFromApi();\nif(LS.get('cc_authed')){\n  if(LS.get('cc_provision')) state.route={view:'provision'};\n  renderShell();\n} else {\n  renderAuthGate();\n}\n})();"
  );
  return output;
}
