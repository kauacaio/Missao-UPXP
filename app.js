const config = window.UPXP_CONFIG || {};
const configured = config.supabaseUrl && !config.supabaseUrl.includes("SEU-PROJETO");
const db = configured ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;

function getSavedPlayer() {
  try { return JSON.parse(localStorage.getItem("upxp_player") || "null"); }
  catch { localStorage.removeItem("upxp_player"); return null; }
}

const state = { player: getSavedPlayer(), challenge: null, selectedAnswer: null, previous: "welcomeScreen", channel: null };
const TOTAL_CHALLENGES = 12;
const screens = [...document.querySelectorAll(".screen")];
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  const current = screens.find((s) => s.classList.contains("active"));
  if (current && id === "rankingScreen") state.previous = current.id;
  screens.forEach((s) => s.classList.toggle("active", s.id === id));
  $("rankingShortcut").classList.toggle("hidden", !state.player || id === "rankingScreen");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function toast(message, type = "") {
  const el = $("toast"); el.textContent = message; el.className = `toast show ${type}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (el.className = "toast"), 3500);
}

function ensureConfigured() {
  if (db) return true;
  toast("Configure o Supabase no arquivo config.js.", "error"); return false;
}

async function registerPlayer(event) {
  event.preventDefault(); if (!ensureConfigured()) return;
  const button = event.submitter; button.disabled = true; button.textContent = "ENTRANDO...";
  const payload = { name: $("playerName").value.trim(), school: $("playerSchool").value.trim(), class_name: $("playerClass").value.trim() };
  const { data, error } = await db.from("players").insert(payload).select("id,name,school,class_name,score,completed_count").single();
  button.disabled = false; button.innerHTML = "ENTRAR NO JOGO <span>→</span>";
  if (error) return toast("Não foi possível entrar. Tente novamente.", "error");
  state.player = data; localStorage.setItem("upxp_player", JSON.stringify(data)); updatePlayer(); showScreen("gameScreen");
}

async function refreshPlayer() {
  if (!db || !state.player) return false;
  const { data, error } = await db.from("players").select("id,name,school,class_name,score,completed_count").eq("id", state.player.id).single();
  if (error || !data) return false;
  state.player = data; localStorage.setItem("upxp_player", JSON.stringify(data)); updatePlayer(); return true;
}

function updatePlayer() {
  if (!state.player) return;
  $("playerGreeting").textContent = state.player.name;
  $("playerScore").textContent = state.player.score || 0;
  const count = state.player.completed_count || 0;
  $("progressText").textContent = `${count} de ${TOTAL_CHALLENGES} desafios`;
  $("progressBar").style.width = `${Math.min(100, (count / TOTAL_CHALLENGES) * 100)}%`;
}

async function validateCode(event) {
  event.preventDefault(); if (!ensureConfigured() || !state.player) return;
  const code = $("codeInput").value.trim().toUpperCase(); const button = event.submitter;
  button.disabled = true; button.textContent = "BUSCANDO..."; $("codeMessage").textContent = ""; $("codeMessage").className = "message";
  const { data, error } = await db.rpc("get_challenge_by_code", { entered_code: code, player_uuid: state.player.id });
  button.disabled = false; button.textContent = "VALIDAR";
  if (error || !data?.length) { $("codeMessage").textContent = "Código não encontrado. Confira os caracteres e tente novamente."; $("codeMessage").className = "message error"; return; }
  const challenge = data[0];
  if (challenge.already_answered) { $("codeMessage").textContent = "Este desafio já foi concluído. Procure outro ponto da missão."; $("codeMessage").className = "message success"; return; }
  state.challenge = challenge; renderChallenge(); showScreen("challengeScreen");
}

function renderChallenge() {
  const c = state.challenge; state.selectedAnswer = null; $("challengeLocation").textContent = c.location_name; $("challengePoints").textContent = `+${c.points} PONTOS`;
  $("questionText").textContent = c.question; $("answerFeedback").className = "feedback hidden";
  $("answersList").innerHTML = c.options.map((option, index) => `<button class="answer" data-index="${index}"><b>${String.fromCharCode(65 + index)}</b><span>${escapeHtml(option)}</span></button>`).join("");
  $("confirmAnswer").disabled = true; $("confirmAnswer").innerHTML = "CONFIRMAR RESPOSTA <span>→</span>";
}

function selectAnswer(index) {
  state.selectedAnswer = index;
  document.querySelectorAll(".answer").forEach((button) => button.classList.toggle("selected", Number(button.dataset.index) === index));
  $("confirmAnswer").disabled = false;
}

async function submitAnswer(index) {
  if (index === null || index === undefined) return;
  $("confirmAnswer").disabled = true; $("confirmAnswer").textContent = "ENVIANDO...";
  document.querySelectorAll(".answer").forEach((b) => (b.disabled = true));
  const { data, error } = await db.rpc("submit_answer", { player_uuid: state.player.id, challenge_uuid: state.challenge.challenge_id, selected_index: index });
  if (error) { toast("Não foi possível registrar a resposta.", "error"); document.querySelectorAll(".answer").forEach((b) => (b.disabled = false)); $("confirmAnswer").disabled = false; $("confirmAnswer").innerHTML = "CONFIRMAR RESPOSTA <span>→</span>"; return; }
  const result = data[0]; const feedback = $("answerFeedback");
  document.querySelector(`.answer[data-index="${index}"]`)?.classList.add(result.is_correct ? "correct" : "wrong");
  feedback.className = `feedback ${result.is_correct ? "success" : "failure"}`;
  feedback.innerHTML = `<strong>${result.is_correct ? `Acertou! +${result.points_earned} pontos` : "Não foi dessa vez!"}</strong><p>${escapeHtml(result.explanation || "Continue explorando o campus.")}</p><button class="primary-button" data-action="continue">CONTINUAR A MISSÃO →</button>`;
  await refreshPlayer();
}

async function loadRanking() {
  showScreen("rankingScreen"); if (!ensureConfigured()) return;
  const { data, error } = await db.from("leaderboard").select("id,name,school,score,completed_count").limit(50);
  if (error) return toast("Não foi possível carregar o ranking.", "error");
  const top = data.slice(0, 3); $("podium").innerHTML = top.map((p, i) => `<article class="podium-card place-${i + 1}"><span>${i === 0 ? "🏆" : i === 1 ? "🥈" : "🥉"}</span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.school)}</small><b>${p.score} pts</b></article>`).join("");
  $("rankingList").innerHTML = data.map((p, i) => `<div class="ranking-row ${p.id === state.player?.id ? "is-you" : ""}"><b>${String(i + 1).padStart(2, "0")}</b><span><strong>${escapeHtml(p.name)}${p.id === state.player?.id ? " (você)" : ""}</strong><small>${escapeHtml(p.school)}</small></span><em>${p.score}</em></div>`).join("");
  $("rankingEmpty").classList.toggle("hidden", data.length > 0);
}

function subscribeRanking() {
  if (!db || state.channel) return;
  state.channel = db.channel("ranking-live").on("postgres_changes", { event: "UPDATE", schema: "public", table: "players" }, () => {
    if ($("rankingScreen").classList.contains("active")) loadRanking();
  }).subscribe();
}

function escapeHtml(value = "") { const d = document.createElement("div"); d.textContent = value; return d.innerHTML; }

document.addEventListener("click", (event) => {
  const answer = event.target.closest(".answer"); if (answer) return selectAnswer(Number(answer.dataset.index));
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "start") showScreen(state.player ? "gameScreen" : "registerScreen");
  if (action === "home") showScreen("welcomeScreen");
  if (action === "game" || action === "continue") { $("codeInput").value = ""; showScreen("gameScreen"); }
  if (action === "show-ranking") loadRanking();
  if (action === "previous") showScreen(state.previous === "rankingScreen" ? "welcomeScreen" : state.previous);
  if (action === "logout") { localStorage.removeItem("upxp_player"); state.player = null; showScreen("welcomeScreen"); }
});
$("rankingShortcut").addEventListener("click", loadRanking);
$("registerForm").addEventListener("submit", registerPlayer);
$("codeForm").addEventListener("submit", validateCode);
$("codeInput").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  $("codeMessage").textContent = ""; $("codeMessage").className = "message";
});
$("confirmAnswer").addEventListener("click", () => submitAnswer(state.selectedAnswer));

async function restoreSession() {
  if (!state.player) return;
  updatePlayer();
  showScreen("gameScreen");
  if (!db) return;
  const valid = await refreshPlayer();
  if (!valid) {
    localStorage.removeItem("upxp_player");
    state.player = null;
    showScreen("welcomeScreen");
    toast("Sua participação não foi encontrada. Entre novamente.", "error");
  }
}

restoreSession();
subscribeRanking();
