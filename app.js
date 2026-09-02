const config = window.UPXP_CONFIG || {};
const configured = config.supabaseUrl && !config.supabaseUrl.includes("SEU-PROJETO");
const db = configured ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;

function getSavedPlayer() {
  try { return JSON.parse(localStorage.getItem("upxp_player") || "null"); }
  catch { localStorage.removeItem("upxp_player"); return null; }
}

const state = { player: getSavedPlayer(), challenge: null, selectedAnswer: null, previous: "welcomeScreen", channel: null, lastRanking: [], activity: [], feedTurn: 0 };
const MOTIVATIONAL_MESSAGES = [
  "Todo campeão começa pelo primeiro desafio.",
  "Cada resposta aproxima você do pódio.",
  "Continue explorando — o próximo código pode mudar o jogo.",
  "Grandes resultados são construídos desafio por desafio.",
];
const screens = [...document.querySelectorAll(".screen")];
const $ = (id) => document.getElementById(id);

function sortLeaderboard(players = []) {
  return [...players].sort((a, b) =>
    (Number(b.score) || 0) - (Number(a.score) || 0) ||
    (Number(b.completed_count) || 0) - (Number(a.completed_count) || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
  );
}

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
  const payload = {
    participant_name: $("playerName").value.trim(),
    participant_phone: $("playerPhone").value.replace(/\D/g, ""),
    accepts_marketing: $("marketingConsent").checked,
  };
  const { data, error } = await db.rpc("register_player", payload).single();
  button.disabled = false; button.innerHTML = "ENTRAR NO JOGO <span>→</span>";
  if (error) return toast("Não foi possível entrar. Tente novamente.", "error");
  state.player = data; localStorage.setItem("upxp_player", JSON.stringify(data)); updatePlayer(); showScreen("instructionsScreen");
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
  if (!state.activity.length) $("motivationText").textContent = MOTIVATIONAL_MESSAGES[Math.min(count, MOTIVATIONAL_MESSAGES.length - 1)];
}

function showNextFeedMessage() {
  const text = $("motivationText");
  if (!text) return;
  const showActivity = state.activity.length && state.feedTurn % 2 === 1;
  if (showActivity) {
    const message = state.activity.shift();
    state.activity.push(message);
    text.textContent = message;
  } else {
    text.textContent = MOTIVATIONAL_MESSAGES[Math.floor(state.feedTurn / 2) % MOTIVATIONAL_MESSAGES.length];
  }
  text.classList.remove("feed-pulse");
  void text.offsetWidth;
  text.classList.add("feed-pulse");
  state.feedTurn += 1;
}

async function updateActivityFeed() {
  if (!db) return;
  const { data, error } = await db.from("leaderboard").select("id,name,score,completed_count").order("score", { ascending:false }).order("completed_count", { ascending:false }).order("name", { ascending:true }).limit(10);
  if (error || !data) return;
  const orderedData = sortLeaderboard(data);
  if (state.lastRanking.length) {
    const oldPositions = new Map(state.lastRanking.map((player, index) => [player.id, index + 1]));
    const changes = [];
    orderedData.forEach((player, index) => {
      const oldPosition = oldPositions.get(player.id);
      const newPosition = index + 1;
      if (oldPosition && newPosition < oldPosition) changes.push(`${player.name} subiu para ${newPosition}º lugar 🚀`);
      if (oldPosition && newPosition > oldPosition) changes.push(`${player.name} caiu para ${newPosition}º lugar`);
    });
    if (changes.length) {
      state.activity = [...changes.slice(0, 4), ...state.activity].filter((message, index, list) => list.indexOf(message) === index).slice(0, 6);
      state.feedTurn = 1;
      showNextFeedMessage();
    }
  }
  state.lastRanking = orderedData;
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
  const { data, error } = await db.from("leaderboard").select("id,name,school,score,completed_count").order("score", { ascending:false }).order("completed_count", { ascending:false }).order("name", { ascending:true }).limit(50);
  if (error) return toast("Não foi possível carregar o ranking.", "error");
  const ranking = sortLeaderboard(data);
  const top = ranking.slice(0, 3);
  $("podium").innerHTML = top.map((p, i) => `<article class="podium-card place-${i + 1}"><span>${i === 0 ? "🏆" : i === 1 ? "🥈" : "🥉"}</span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.school)}</small><b>${p.score} pts</b></article>`).join("");
  $("rankingList").innerHTML = ranking.map((p, i) => `<div class="ranking-row ${p.id === state.player?.id ? "is-you" : ""}"><b>${String(i + 1).padStart(2, "0")}</b><span><strong>${escapeHtml(p.name)}${p.id === state.player?.id ? " (você)" : ""}</strong><small>${escapeHtml(p.school)}</small></span><em>${p.score}</em></div>`).join("");
  $("rankingEmpty").classList.toggle("hidden", ranking.length > 0);
}

function subscribeRanking() {
  if (!db || state.channel) return;
  state.channel = db.channel("ranking-live").on("postgres_changes", { event: "UPDATE", schema: "public", table: "players" }, () => {
    updateActivityFeed();
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
  if (action === "enter-game") { sessionStorage.setItem("upxp_instructions_seen", "1"); showScreen("gameScreen"); }
  if (action === "show-ranking") loadRanking();
  if (action === "previous") showScreen(state.previous === "rankingScreen" ? "welcomeScreen" : state.previous);
});
$("rankingShortcut").addEventListener("click", loadRanking);
$("registerForm").addEventListener("submit", registerPlayer);
$("codeForm").addEventListener("submit", validateCode);
$("codeInput").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  $("codeMessage").textContent = ""; $("codeMessage").className = "message";
});
$("playerPhone").addEventListener("input", (event) => {
  const digits = event.target.value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) event.target.value = digits;
  else if (digits.length <= 6) event.target.value = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  else if (digits.length <= 10) event.target.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  else event.target.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
});
$("confirmAnswer").addEventListener("click", () => submitAnswer(state.selectedAnswer));

async function restoreSession() {
  if (!state.player) return;
  updatePlayer();
  showScreen(sessionStorage.getItem("upxp_instructions_seen") ? "gameScreen" : "instructionsScreen");
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
updateActivityFeed();
setInterval(showNextFeedMessage, 6000);
