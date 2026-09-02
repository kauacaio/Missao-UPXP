const adminConfig = window.UPXP_CONFIG || {};
const adminDb = window.supabase.createClient(adminConfig.supabaseUrl, adminConfig.supabaseAnonKey);
let allLeads = [];
const byId = (id) => document.getElementById(id);

function formatPhone(phone = "") {
  const value = phone.replace(/\D/g, "");
  return value.length === 11 ? `(${value.slice(0,2)}) ${value.slice(2,7)}-${value.slice(7)}` : `(${value.slice(0,2)}) ${value.slice(2,6)}-${value.slice(6)}`;
}
function escapeText(value = "") { const el = document.createElement("div"); el.textContent = value; return el.innerHTML; }
function setView(loggedIn) { byId("loginView").classList.toggle("hidden", loggedIn); byId("dashboardView").classList.toggle("hidden", !loggedIn); }

async function loadLeads() {
  const { data, error } = await adminDb.from("campaign_leads").select("id,name,phone,marketing_consent,status,created_at").order("created_at", { ascending:false });
  if (error) { setView(false); byId("loginMessage").textContent = "Acesso não autorizado para este usuário."; return; }
  allLeads = data || []; render();
}
function filteredLeads() {
  const term = byId("searchInput").value.toLowerCase().replace(/\D/g, "");
  const rawTerm = byId("searchInput").value.toLowerCase(); const filter = byId("consentFilter").value;
  return allLeads.filter((lead) => (lead.name.toLowerCase().includes(rawTerm) || lead.phone.includes(term)) && (filter === "all" || (filter === "yes") === lead.marketing_consent));
}
function render() {
  byId("totalLeads").textContent = allLeads.length; byId("marketingLeads").textContent = allLeads.filter((l) => l.marketing_consent).length; byId("newLeads").textContent = allLeads.filter((l) => l.status === "novo").length;
  const leads = filteredLeads(); byId("emptyState").classList.toggle("hidden", leads.length > 0);
  byId("leadsBody").innerHTML = leads.map((lead) => `<tr><td><strong>${escapeText(lead.name)}</strong></td><td>${formatPhone(lead.phone)}</td><td><span class="badge ${lead.marketing_consent ? "yes" : ""}">${lead.marketing_consent ? "SIM" : "NÃO"}</span></td><td><select class="status-select" data-id="${lead.id}">${["novo","contatado","convertido","descartado"].map((s) => `<option value="${s}" ${s === lead.status ? "selected" : ""}>${s.toUpperCase()}</option>`).join("")}</select></td><td>${new Date(lead.created_at).toLocaleDateString("pt-BR")}</td></tr>`).join("");
}
byId("loginForm").addEventListener("submit", async (event) => { event.preventDefault(); byId("loginMessage").textContent = "Entrando..."; const { error } = await adminDb.auth.signInWithPassword({ email:byId("adminEmail").value, password:byId("adminPassword").value }); if (error) return byId("loginMessage").textContent = "E-mail ou senha inválidos."; byId("loginMessage").textContent = ""; setView(true); loadLeads(); });
byId("logoutButton").addEventListener("click", async () => { await adminDb.auth.signOut(); setView(false); });
byId("searchInput").addEventListener("input", render); byId("consentFilter").addEventListener("change", render);
byId("leadsBody").addEventListener("change", async (event) => { if (!event.target.matches(".status-select")) return; await adminDb.from("campaign_leads").update({ status:event.target.value, updated_at:new Date().toISOString() }).eq("id",event.target.dataset.id); const lead=allLeads.find((l)=>l.id===event.target.dataset.id); if(lead) lead.status=event.target.value; render(); });
byId("exportButton").addEventListener("click", () => { const leads=filteredLeads().filter((l)=>l.marketing_consent); const rows=[["Nome","Telefone","Consentimento marketing","Status","Cadastro"],...leads.map((l)=>[l.name,l.phone,"Sim",l.status,l.created_at])]; const csv="\ufeff"+rows.map((row)=>row.map((v)=>`"${String(v).replace(/"/g,'""')}"`).join(";")).join("\n"); const link=document.createElement("a"); link.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})); link.download=`leads-upxp-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href); });
adminDb.auth.getSession().then(({data}) => { const loggedIn=Boolean(data.session); setView(loggedIn); if(loggedIn) loadLeads(); });
