const adminConfig = window.UPXP_CONFIG || {};
const adminDb = window.supabase.createClient(adminConfig.supabaseUrl, adminConfig.supabaseAnonKey);
let allLeads = [];
let stageFilter = "all";
let tagCatalog = [];
let selectedTags = new Set();
const byId = (id) => document.getElementById(id);

function formatPhone(phone = "") {
  const value = phone.replace(/\D/g, "");
  return value.length === 11 ? `(${value.slice(0,2)}) ${value.slice(2,7)}-${value.slice(7)}` : `(${value.slice(0,2)}) ${value.slice(2,6)}-${value.slice(6)}`;
}
function whatsappUrl(phone = "") {
  const digits = String(phone).replace(/\D/g, "");
  const number = /^[0-9]{10,11}$/.test(digits) ? `55${digits}` : digits;
  return /^55[0-9]{10,11}$/.test(number) ? `https://wa.me/${number}` : null;
}
function whatsappButton(phone) {
  const url = whatsappUrl(phone);
  return url ? `<a class="whatsapp-button" href="${url}" target="_blank" rel="noopener noreferrer" draggable="false" aria-label="Abrir conversa no WhatsApp">WhatsApp ↗</a>` : "";
}
function escapeText(value = "") { const el = document.createElement("div"); el.textContent = value; return el.innerHTML; }
function setView(loggedIn) { byId("loginView").classList.toggle("hidden", loggedIn); byId("dashboardView").classList.toggle("hidden", !loggedIn); }

async function loadLeads() {
  const { data: allowed, error: accessError } = await adminDb.rpc("is_campaign_admin");
  if (accessError || allowed !== true) {
    allLeads = []; render(); setView(false);
    byId("loginMessage").textContent = accessError
      ? "Não foi possível verificar seu acesso ao CRM. Tente novamente."
      : "Este usuário ainda não tem acesso ao CRM. A organização precisa liberá-lo em campaign_admins.";
    return;
  }
  const leads = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await adminDb.rpc("get_campaign_leads")
      .order("created_at", { ascending:false }).order("id").range(offset, offset + 499);
    if (error) {
      setView(false);
      byId("loginMessage").textContent = error.code === "PGRST202"
        ? "Atualize o banco executando migracao-crm-privado.sql no Supabase para carregar a participação."
        : "Não foi possível carregar os contatos e a participação. Tente novamente.";
      return;
    }
    if (data?.length) {
      const { data: tagged } = await adminDb.from("campaign_leads").select("id,tags").in("id", data.map(l => l.id));
      const tagsById = new Map((tagged || []).map(l => [l.id, l.tags]));
      data.forEach(l => { l.tags = tagsById.get(l.id) || []; });
    }
    leads.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  allLeads = leads; await loadTagCatalog(); render();
}
function participation(lead) {
  const player = lead.player;
  if (!player || player.completed_count == null) return { key: "unknown", label: "Sem dados", count: -1, score: 0, level: 0 };
  const count = Math.max(0, Number(player.completed_count) || 0);
  const score = Math.max(0, Number(player.score) || 0);
  const key = count >= 5 ? "high" : count >= 2 ? "medium" : count >= 1 ? "low" : "none";
  return { key, count, score, label: { high: "Alta participação", medium: "Em ritmo", low: "Começou", none: "Ainda não jogou" }[key], level: {high: 3, medium: 2, low: 1, none: 0}[key] };
}
function filteredLeads() {
  const rawTerm = byId("searchInput").value.trim().toLowerCase();
  const term = rawTerm.replace(/\D/g, "");
  const filter = byId("consentFilter").value;
  const engagement = byId("engagementFilter").value;
  return allLeads.filter((lead) => (lead.name.toLowerCase().includes(rawTerm) || (term.length > 0 && lead.phone.includes(term)))
    && (filter === "all" || (filter === "yes") === lead.marketing_consent)
    && (engagement === "all" || participation(lead).key === engagement)
    && (stageFilter === "all" || lead.status === stageFilter))
    .sort((a, b) => {
      if (byId("sortOrder").value === "engagement") {
        const pa = participation(a), pb = participation(b);
        const difference = pb.count - pa.count || pb.score - pa.score;
        if (difference) return difference;
      }
      return new Date(b.created_at) - new Date(a.created_at) || a.id.localeCompare(b.id);
    });
}
const stages = { novo: "Novos", contatado: "Contatados", convertido: "Convertidos", descartado: "Descartados" };
const savingLeads = new Set();
function setContactView(view) {
  const list = view === "list";
  byId("kanbanBoard").classList.toggle("hidden", list);
  byId("leadsList").classList.toggle("hidden", !list);
  byId("boardHint").classList.toggle("hidden", list);
  byId("kanbanViewButton").setAttribute("aria-pressed", String(!list));
  byId("listViewButton").setAttribute("aria-pressed", String(list));
}
byId("kanbanViewButton").addEventListener("click", () => setContactView("kanban"));
byId("listViewButton").addEventListener("click", () => setContactView("list"));
function customTags(lead) {
  return (lead.tags || []).map(tag => tagBadge(tag)).join(" ");
}
function renderProfessionalFunnel() {
  const total = allLeads.length;
  const counts = Object.fromEntries(Object.keys(stages).map(key => [key, allLeads.filter(l => l.status === key).length]));
  const percent = count => total ? `${(count / total * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "0%";
  byId("funnelMetrics").innerHTML = [["Leads captados", total], ["Em atendimento", counts.contatado], ["Convertidos", counts.convertido], ["Conversão da base", percent(counts.convertido)]].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");
  byId("salesFunnel").innerHTML = [["novo", "01", "Primeiro contato", "Novos"], ["contatado", "02", "Relacionamento", "Contatados"], ["convertido", "03", "Resultado", "Convertidos"]].map(([key, step, subtitle, label]) => `<button class="funnel-segment segment-${key}" type="button" data-stage="${key}" aria-pressed="${stageFilter === key}"><span class="segment-step">${step}</span><span class="segment-title">${label}<small>${subtitle}</small></span><span class="segment-value"><strong>${counts[key]}</strong><small>${percent(counts[key])} da base</small></span></button>`).join("");
  byId("funnelInsights").innerHTML = `<h3>Resumo da operação</h3><div class="insight-number"><strong>${counts.novo}</strong><span>aguardando primeiro contato</span></div><p>${total ? "Selecione uma etapa no funil para consultar os contatos abaixo." : "O funil será preenchido quando os primeiros contatos forem cadastrados."}</p><div class="funnel-secondary"><button type="button" data-stage="all" aria-pressed="${stageFilter === "all"}"><span>Todos os leads</span><b>${total}</b></button><button type="button" data-stage="descartado" aria-pressed="${stageFilter === "descartado"}"><span>Descartados</span><b>${counts.descartado}</b></button></div><small>Conversão da base: contatos com status Convertido ÷ total de contatos.</small>`;
}
function render() {
  const activeFilters = Number(byId("consentFilter").value !== "all") + Number(byId("engagementFilter").value !== "all");
  byId("filterCount").textContent = activeFilters ? `(${activeFilters})` : "";
  byId("salesFunnel").innerHTML = [["all", "Todos"], ...Object.entries(stages)].map(([key, label]) => {
    const count = key === "all" ? allLeads.length : allLeads.filter(l => l.status === key).length;
    const percent = allLeads.length ? Math.round(count / allLeads.length * 100) : 0;
    const chart = document.body.classList.contains("funnel-page")
      ? `<small>${percent}% do total</small><meter min="0" max="${allLeads.length || 1}" value="${count}" aria-label="${label}: ${count} contatos">${percent}%</meter>` : "";
    return `<button type="button" data-stage="${key}" aria-pressed="${stageFilter === key}"><span>${label}</span><strong>${count}</strong>${chart}</button>`;
  }).join("");
  if (document.body.classList.contains("funnel-page")) renderProfessionalFunnel();
  byId("totalLeads").textContent = allLeads.length;
  byId("marketingLeads").textContent = allLeads.filter(l => l.marketing_consent).length;
  byId("newLeads").textContent = allLeads.filter(l => l.status === "novo").length;
  const leads = filteredLeads();
  byId("emptyState").classList.toggle("hidden", leads.length > 0);
  byId("leadsBody").innerHTML = leads.map(lead => {
    const p = participation(lead), saving = savingLeads.has(lead.id);
    return `<tr data-contact="${escapeText(lead.id)}" aria-busy="${saving}"><td><div class="contact-name-row"><button type="button" class="contact-open" data-contact="${escapeText(lead.id)}">${escapeText(lead.name)}</button>${whatsappButton(lead.phone)}</div><small>${escapeText(formatPhone(lead.phone))}</small></td>
      <td><select class="status-select" aria-label="Status de ${escapeText(lead.name).replace(/"/g, "&quot;")}" data-id="${escapeText(lead.id)}" ${saving ? "disabled" : ""}>${Object.entries(stages).map(([key, title]) => `<option value="${key}" ${key === lead.status ? "selected" : ""}>${title}</option>`).join("")}</select></td>
      <td class="contact-tags-cell"><div class="lead-tags">${customTags(lead) || '<span class="no-tags">—</span>'}</div></td>
      <td><span class="tag ${p.key}">${p.label}</span><small>${p.count < 0 ? "Sem dados do jogo" : `${p.count} desafios · ${p.score} pts`}</small></td>
      <td><span class="tag ${lead.marketing_consent ? "consent" : "neutral"}">${lead.marketing_consent ? "Aceita campanhas" : "Sem consentimento"}</span></td>
      <td class="registration-date">${new Date(lead.created_at).toLocaleDateString("pt-BR")}</td></tr>`;
  }).join("");
  byId("kanbanBoard").innerHTML = Object.entries(stages).map(([status, label]) => {
    const cards = leads.filter(l => l.status === status);
    return `<section class="kanban-column ${status}" data-status="${status}" aria-label="${label}">
      <h2><span>${label}</span><b>${cards.length}</b></h2><div class="kanban-cards">${cards.map(lead => {
        const p = participation(lead), saving = savingLeads.has(lead.id);
        return `<article class="lead-card" data-contact="${escapeText(lead.id)}" draggable="${!saving}" data-id="${escapeText(lead.id)}" aria-busy="${saving}">
          <h3><button type="button" class="contact-open" data-contact="${escapeText(lead.id)}">${escapeText(lead.name)}</button></h3><p class="lead-phone">${escapeText(formatPhone(lead.phone))}</p>${whatsappButton(lead.phone)}
          <div class="lead-tags">${customTags(lead)}<span class="tag ${p.key}" title="Participação pelos desafios concluídos: 1 começou; 2–4 em ritmo; 5+ alta participação.">${p.label}</span><span class="tag ${lead.marketing_consent ? "consent" : "neutral"}">${lead.marketing_consent ? "Aceita campanhas" : "Sem consentimento"}</span></div>
          <p class="lead-meta">${p.count < 0 ? "Sem dados do jogo" : `${p.count} desafios · ${p.score} pts`}</p>
          <label class="move-label">${saving ? "Salvando…" : "Mover para"}<select class="status-select" data-id="${escapeText(lead.id)}" ${saving ? "disabled" : ""}>${Object.entries(stages).map(([key, title]) => `<option value="${key}" ${key === status ? "selected" : ""}>${title}</option>`).join("")}</select></label>
        </article>`;
      }).join("") || '<p class="column-empty">Nenhum contato nesta etapa</p>'}</div></section>`;
  }).join("");
}
async function moveLead(id, status) {
  const lead = allLeads.find(l => l.id === id);
  if (!lead || !Object.hasOwn(stages, status) || lead.status === status || savingLeads.has(id)) return;
  savingLeads.add(id); render();
  byId("boardMessage").textContent = "Salvando alteração…";
  try {
    const { data, error } = await adminDb.from("campaign_leads")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", id).select("id,status").single();
    if (error || !data || data.status !== status) throw new Error("Status não confirmado");
    lead.status = data.status;
    byId("boardMessage").textContent = `Contato movido para ${stages[status]}.`;
  } catch {
    byId("boardMessage").textContent = "Não foi possível salvar. O contato continua na etapa anterior. Tente novamente.";
  } finally {
    savingLeads.delete(id); render();
  }
}
byId("leadsBody").addEventListener("change", event => {
  if (event.target.matches(".status-select")) moveLead(event.target.dataset.id, event.target.value);
});
const board = byId("kanbanBoard");
board.addEventListener("change", event => {
  if (event.target.matches(".status-select")) moveLead(event.target.dataset.id, event.target.value);
});
board.addEventListener("dragstart", event => {
  const card = event.target.closest(".lead-card");
  if (!card || savingLeads.has(card.dataset.id) || event.target.closest("select,a")) { event.preventDefault(); return; }
  event.dataTransfer.setData("text/plain", card.dataset.id);
  event.dataTransfer.effectAllowed = "move";
});
board.addEventListener("dragover", event => {
  const column = event.target.closest(".kanban-column");
  if (column) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
});
board.addEventListener("drop", event => {
  const column = event.target.closest(".kanban-column");
  if (!column) return;
  event.preventDefault();
  moveLead(event.dataTransfer.getData("text/plain"), column.dataset.status);
});
byId("loginForm").addEventListener("submit", async (event) => { event.preventDefault(); byId("loginMessage").textContent = "Entrando..."; const { error } = await adminDb.auth.signInWithPassword({ email:byId("adminEmail").value, password:byId("adminPassword").value }); if (error) return byId("loginMessage").textContent = "E-mail ou senha inválidos."; byId("loginMessage").textContent = ""; setView(true); loadLeads(); });
byId("logoutButton").addEventListener("click", async () => { await adminDb.auth.signOut(); setView(false); });
byId("engagementFilter").addEventListener("change", render);
byId("sortOrder").addEventListener("change", render);
byId("searchInput").addEventListener("input", render); byId("consentFilter").addEventListener("change", render);
byId("exportButton").addEventListener("click", () => { const leads=filteredLeads().filter((l)=>l.marketing_consent); const rows=[["Nome","Telefone","Consentimento marketing","Status","Cadastro","Participação","Desafios concluídos","Pontos"],...leads.map((l)=>[l.name,l.phone,"Sim",l.status,l.created_at,participation(l).label,participation(l).count < 0 ? "" : participation(l).count,participation(l).count < 0 ? "" : participation(l).score])]; const csv="\ufeff"+rows.map((row)=>row.map((v)=>`"${String(v).replace(/"/g,'""')}"`).join(";")).join("\n"); const link=document.createElement("a"); link.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})); link.download=`leads-upxp-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href); });
adminDb.auth.getSession().then(({data}) => { const loggedIn=Boolean(data.session); setView(loggedIn); if(loggedIn) loadLeads(); });

setContactView("list");
byId("salesFunnel").addEventListener("click", event => {
  const button = event.target.closest("[data-stage]");
  if (button) { stageFilter = button.dataset.stage; render(); }
});
let activeContact = null;
let detailVersion = null;
let detailBusy = false;
function detailEnabled(enabled) {
  for (const id of ["tagFieldset", "contactNotes", "saveContact"]) byId(id).disabled = !enabled;
}
function closeContact() {
  if (detailBusy) return;
  activeContact = null; byId("contactDialog").close();
}
byId("closeContact").addEventListener("click", closeContact);
byId("contactDialog").addEventListener("cancel", event => {
  if (detailBusy) event.preventDefault(); else activeContact = null;
});
function leadTemperature(lead) {
  const names = [...new Set((lead.tags || []).map(name => name.toLocaleLowerCase()))];
  const total = names.reduce((sum, name) => sum + Math.max(0, Math.min(100, Number(tagCatalog.find(t => t.name.toLocaleLowerCase() === name)?.temperature_points) || 0)), 0);
  const { count } = participation(lead);
  const game = count >= 10 ? 100 : count >= 5 ? 73 : count >= 2 ? 48 : count >= 1 ? 22 : 0;
  const fill = Math.min(100, game + total);
  const level = fill >= 75 ? 4 : fill >= 50 ? 3 : fill >= 25 ? 2 : fill > 0 ? 1 : 0;
  return { label: ["Sem classificação", "Frio", "Morno", "Quente", "Muito quente"][level],
    color: ["#8b8495", "#3984c6", "#be8a19", "#dd702b", "#d64545"][level], fill,
    description: `${fill}/100 pontos · Jogo: ${count < 0 ? "dados indisponíveis" : `${game} pontos (${count} desafios)`} · Etiquetas: +${total} pontos.` };
}
function renderLeadThermometer(lead) {
  const temperature = leadTemperature(lead);
  const fillHeight = Math.max(0, Math.min(100, temperature.fill));
  byId("leadThermometer").innerHTML = `<div class="thermometer-visual" style="--temperature-color:${temperature.color}" aria-hidden="true"><div class="thermometer-stem"><div class="thermometer-liquid" style="height:${fillHeight}%"></div><div class="thermometer-ticks"></div></div><div class="thermometer-bulb"></div></div><div class="temperature-copy"><small>TEMPERATURA DO LEAD</small><strong style="color:${temperature.color}">${temperature.label}</strong><p>${temperature.description}</p><details><summary>Como é calculado?</summary><p>O jogo é a base: 0 desafios = 0 pontos; 1 = 22; 2–4 = 48; 5–9 = 73; 10+ = 100. Somamos os pontos das etiquetas, contando cada uma uma única vez. O termômetro para em 100. 0: sem classificação · 1–24: frio · 25–49: morno · 50–74: quente · 75–100: muito quente.</p></details></div>`;
}
async function openContact(id) {
  const lead = allLeads.find(l => l.id === id);
  if (!lead || detailBusy) return;
  activeContact = id; detailVersion = null;
  byId("contactTitle").textContent = lead.name;
  byId("contactPhone").textContent = formatPhone(lead.phone);
  byId("contactWhatsApp").innerHTML = whatsappButton(lead.phone);
  renderLeadThermometer(lead);
  selectedTags = new Set(); renderTagPicker(); byId("contactNotes").value = "";
  byId("detailMessage").textContent = "Carregando ficha…";
  detailEnabled(false); byId("contactDialog").showModal();
  try {
    const details = await adminDb.from("campaign_leads").select("tags,notes,updated_at").eq("id", id).single();
    if (activeContact !== id) return;
    if (details.error) throw Error("load");
    detailVersion = details.data.updated_at;
    selectedTags = new Set(details.data.tags || []); renderTagPicker();
    byId("contactNotes").value = details.data.notes || "";
    renderLeadThermometer({ ...allLeads.find(l => l.id === activeContact), tags: [...selectedTags] });
    byId("detailMessage").textContent = ""; detailEnabled(true);
  } catch {
    if (activeContact === id) byId("detailMessage").textContent = "Não foi possível abrir a ficha. Confira a conexão e se a migração do CRM foi aplicada.";
  }
}
for (const id of ["kanbanBoard", "leadsBody"]) byId(id).addEventListener("click", event => {
  if (event.target.closest("select,label,a")) return;
  const contact = event.target.closest("[data-contact]");
  if (contact) openContact(contact.dataset.contact);
});
byId("detailForm").addEventListener("submit", async event => {
  event.preventDefault(); if (!activeContact || detailBusy || !detailVersion) return;
  const tags = [...selectedTags];
  if (tags.length > 15 || tags.some(t => t.length > 40)) {
    byId("detailMessage").textContent = "Use até 15 etiquetas, com no máximo 40 caracteres cada."; return;
  }
  detailBusy = true; detailEnabled(false);
  try {
    const { data, error } = await adminDb.from("campaign_leads").update({ tags, notes: byId("contactNotes").value.trim(), updated_at: new Date().toISOString() })
      .eq("id", activeContact).eq("updated_at", detailVersion).select("updated_at").single();
    if (error || !data) throw Error("save");
    detailVersion = data.updated_at;
    const lead = allLeads.find(l => l.id === activeContact);
    if (lead) lead.tags = tags;
    render();
    renderLeadThermometer({ ...lead, tags });
    byId("detailMessage").textContent = "Etiquetas, temperatura e notas salvas.";
  } catch {
    byId("detailMessage").textContent = "Não foi possível salvar. Se outra pessoa alterou a ficha, copie suas notas e reabra o contato para atualizar.";
  } finally { detailBusy = false; detailEnabled(true); }
});
function tagBadge(name) {
  const tag = tagCatalog.find(t => t.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const color = /^#[0-9a-f]{6}$/i.test(tag?.color || "") ? tag.color : "#6f35e8";
  return `<span class="tag custom-tag" style="--tag-color:${color}"><i aria-hidden="true"></i>${escapeText(name)}<small class="tag-points">+${Number(tag?.temperature_points) || 0}</small></span>`;
}
function renderTagPicker() {
  const names = [...new Set([...tagCatalog.map(t => t.name), ...selectedTags])];
  byId("tagPicker").innerHTML = names.map((name, index) => `<label class="tag-choice"><input type="checkbox" data-tag-index="${index}" ${selectedTags.has(name) ? "checked" : ""}>${tagBadge(name)}</label>`).join("") || '<p class="lead-meta">Nenhuma etiqueta criada. Crie a primeira abaixo.</p>';
  byId("tagPicker").querySelectorAll("input").forEach(input => {
    input.addEventListener("change", () => {
      const name = names[Number(input.dataset.tagIndex)];
      if (input.checked && selectedTags.size >= 15) {
        input.checked = false; byId("detailMessage").textContent = "Selecione no máximo 15 etiquetas."; return;
      }
      if (input.checked) selectedTags.add(name); else selectedTags.delete(name);
      renderLeadThermometer({ ...allLeads.find(l => l.id === activeContact), tags: [...selectedTags] });
      byId("detailMessage").textContent = "Prévia da temperatura. Salve a ficha para aplicar.";
    });
  });
}
async function loadTagCatalog() {
  try {
    const catalog = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await adminDb.from("campaign_tags").select("id,name,color,temperature_points").order("name").order("id").range(offset, offset + 499);
      if (error) throw error;
      catalog.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    tagCatalog = catalog;
    byId("tagCatalog").innerHTML = tagCatalog.map(t => tagBadge(t.name)).join("") || '<p class="lead-meta">Nenhuma etiqueta criada ainda.</p>';
    renderTagPicker(); return true;
  } catch {
    byId("tagMessage").textContent = "Não foi possível carregar as etiquetas. Verifique a conexão e execute a migração atualizada no Supabase.";
    return false;
  }
}
let creatingTag = false;
async function openTags() {
  byId("tagMessage").textContent = "Carregando etiquetas…";
  byId("tagsDialog").showModal();
  byId("saveTag").disabled = true;
  const loaded = await loadTagCatalog();
  byId("saveTag").disabled = !loaded;
  if (loaded) byId("tagMessage").textContent = "";
}
byId("manageTags").addEventListener("click", openTags);
byId("createTagFromContact").addEventListener("click", openTags);
byId("closeTags").addEventListener("click", () => { if (!creatingTag) byId("tagsDialog").close(); });
byId("tagsDialog").addEventListener("cancel", event => { if (creatingTag) event.preventDefault(); });
byId("tagCreateForm").addEventListener("submit", async event => {
  event.preventDefault(); if (creatingTag) return;
  const name = byId("tagName").value.trim(), color = byId("tagColor").value;
  if (!name || name.length > 40) { byId("tagMessage").textContent = "Informe um nome de até 40 caracteres."; return; }
  const temperature_points = Number(byId("tagTemperature").value);
  if (!Number.isInteger(temperature_points) || temperature_points < 0 || temperature_points > 100) return;
  creatingTag = true; byId("saveTag").disabled = true;
  try {
    const { data, error } = await adminDb.from("campaign_tags").insert({ name, color, temperature_points }).select("id,name,color,temperature_points").single();
    if (error || !data) {
      byId("tagMessage").textContent = error?.code === "23505" ? "Esta etiqueta já existe. Use a etiqueta do catálogo." : "Não foi possível confirmar a criação. Atualize o catálogo antes de tentar novamente.";
      return;
    }
    tagCatalog.push(data);
    tagCatalog.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    byId("tagCatalog").innerHTML = tagCatalog.map(t => tagBadge(t.name)).join("");
    renderTagPicker(); render();
    byId("tagName").value = "";
    byId("tagMessage").textContent = "Etiqueta criada para toda a equipe. Selecione-a na ficha e salve para aplicar ao contato.";
  } catch { byId("tagMessage").textContent = "Falha de conexão. Reabra o catálogo para conferir se a etiqueta foi criada."; }
  finally { creatingTag = false; byId("saveTag").disabled = false; }
});

byId("funnelInsights")?.addEventListener("click", event => {
  const button = event.target.closest("[data-stage]");
  if (button) { stageFilter = button.dataset.stage; render(); }
});
