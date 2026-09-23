const config = window.UPXP_CONFIG || {};
const configured = config.supabaseUrl && !config.supabaseUrl.includes("SEU-PROJETO");
// O participante usa um UUID local; a autenticação do CRM não pertence ao jogo.
const db = configured ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { storageKey: "upxp_game_auth", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}) : null;

function getSavedPlayer() {
  try { return JSON.parse(localStorage.getItem("upxp_player") || "null"); }
  catch { return null; }
}

const state = { player: getSavedPlayer(), challenge: null, selectedAnswer: null, previous: "welcomeScreen", channel: null, lastRanking: [], activity: [], feedTurn: 0 };
state.bonus = null;
state.bonusBusy = false;
state.bonusCelebrated = new Set();
const MOTIVATIONAL_MESSAGES = [
  "Todo campeão começa pelo primeiro desafio.",
  "Cada resposta aproxima você do pódio.",
  "Continue explorando — o próximo código pode mudar o jogo.",
  "Grandes resultados são construídos desafio por desafio.",
];
const screens = [...document.querySelectorAll(".screen")];
const $ = (id) => document.getElementById(id);
const EVENT_END_AT = config.eventEndAt ? new Date(config.eventEndAt) : null;

function sortLeaderboard(players = []) {
  return [...players].sort((a, b) =>
    (Number(b.score) || 0) - (Number(a.score) || 0) ||
    (Number(b.completed_count) || 0) - (Number(a.completed_count) || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")
  );
}

function showScreen(id) {
  const current = screens.find((s) => s.classList.contains("active"));
  if (current && current.id !== "rankingScreen" && id === "rankingScreen") state.previous = current.id;
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
  try {
    const { data, error } = await db.rpc("register_player", payload).single();
    if (error || !data?.id) {
      console.error("Falha no cadastro do participante/CRM", { code: error?.code, message: error?.message });
      const message = error?.code === "P0001" ? error.message : "Não foi possível salvar seu cadastro. Tente novamente ou avise a organização.";
      toast(message, "error"); return;
    }
    state.player = data;
    try { localStorage.setItem("upxp_player", JSON.stringify(data)); }
    catch { toast("Cadastro salvo, mas este navegador não conseguiu guardar sua participação neste aparelho.", "error"); }
    updatePlayer(); showScreen("instructionsScreen");
  } catch {
    toast("Não foi possível confirmar o cadastro. Confira sua conexão e tente novamente com o mesmo telefone.", "error");
  } finally {
    button.disabled = false; button.innerHTML = "ENTRAR NO JOGO <span>→</span>";
  }
}

async function refreshPlayer() {
  if (!db || !state.player) return false;
  const playerId = state.player.id;
  try {
    const { data, error } = await db.from("leaderboard").select("id,name,school,score,completed_count").eq("id", playerId).maybeSingle();
    if (state.player?.id !== playerId) return false;
    if (error) return false;
    if (!data) return "missing";
    state.player = { ...state.player, ...data };
    savePlayerLocally(); updatePlayer(); return true;
  } catch {
    return false;
  }
}

async function refreshPlayerWithRetry(attempts = 2) {
  let result = false;
  for (let i = 0; i < attempts; i++) {
    result = await refreshPlayer();
    if (result === true) return result;
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return result;
}

function savePlayerLocally() {
  try { localStorage.setItem("upxp_player", JSON.stringify(state.player)); }
  catch { /* A participação em memória continua válida sem armazenamento local. */ }
}

function updatePlayer() {
  if (!state.player) return;
  updateBonusUnlock();
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
  if (state.bonus && !state.bonus.finished) return startBonusRound();
  const code = $("codeInput").value.trim().toUpperCase(); const button = event.submitter;
  button.disabled = true; button.textContent = "BUSCANDO..."; $("codeMessage").textContent = ""; $("codeMessage").className = "message";
  const { data, error } = await db.rpc("get_challenge_by_code", { entered_code: code, player_uuid: state.player.id });
  button.disabled = false; button.textContent = "VALIDAR";
  if (error || !data?.length) { $("codeMessage").textContent = "Código não encontrado. Confira os caracteres e tente novamente."; $("codeMessage").className = "message error"; return; }
  const challenge = data[0];
  if (challenge.already_answered) { $("codeMessage").textContent = "Este desafio já foi concluído. Procure outro ponto da missão."; $("codeMessage").className = "message success"; return; }
  state.bonus = null; clearInterval(state.bonusTimer);
  state.challenge = challenge; renderChallenge(); showScreen("challengeScreen");
}

function renderChallenge() {
  $("bonusTimer").classList.toggle("hidden", !state.bonus);
  const c = state.challenge; state.selectedAnswer = null; $("challengeLocation").textContent = c.location_name; $("challengePoints").textContent = `+${c.points} PONTOS`;
  $("questionText").textContent = c.question; $("answerFeedback").className = "feedback hidden";
  $("answersList").innerHTML = c.options.map((option, index) => `<button class="answer" data-index="${index}"><b>${String.fromCharCode(65 + index)}</b><span>${escapeHtml(option)}</span></button>`).join("");
  $("confirmAnswer").disabled = true; $("confirmAnswer").innerHTML = "CONFIRMAR RESPOSTA <span>→</span>";
}

function selectAnswer(index) {
  if (state.answerBusy || state.challenge?.answered || !Number.isInteger(index) || !state.challenge?.options?.[index]) return;
  if (state.bonus && (state.bonusBusy || state.bonus.finished || performance.now() >= state.bonus.deadline)) return;
  state.selectedAnswer = index;
  document.querySelectorAll(".answer").forEach((button) => button.classList.toggle("selected", Number(button.dataset.index) === index));
  $("confirmAnswer").disabled = false;
}

async function submitAnswer(index) {
  if (state.bonus) return submitBonusAnswer(index);
  if (!state.player || !state.challenge || state.challenge.answered || state.answerBusy || !Number.isInteger(index) || index < 0 || index >= state.challenge.options.length) return;
  state.answerBusy = true;
  $("confirmAnswer").disabled = true; $("confirmAnswer").textContent = "ENVIANDO...";
  document.querySelectorAll(".answer").forEach(b => b.disabled = true);
  try {
    const { data, error } = await db.rpc("submit_answer", { player_uuid: state.player.id, challenge_uuid: state.challenge.challenge_id, selected_index: index });
    const result = data?.[0];
    if (error || !result) throw error || Error("Resposta vazia");
    state.challenge.answered = result.is_correct;
  if (result.is_correct) state.player.score = (Number(state.player.score) || 0) + (Number(result.points_earned) || 0);
  const feedback = $("answerFeedback");
  document.querySelector(`.answer[data-index="${index}"]`)?.classList.add(result.is_correct ? "correct" : "wrong");
  feedback.className = `feedback ${result.is_correct ? "success" : "failure"}`;
  feedback.innerHTML = `<strong>${result.is_correct ? `Acertou! +${result.points_earned} pontos` : "Não foi dessa vez!"}</strong><p>${escapeHtml(result.explanation || "Continue explorando o campus.")}</p>${result.is_correct ? '' : '<button class="primary-button" data-action="retry-answer">TENTAR NOVAMENTE →</button>'}<button class="primary-button" data-action="continue">CONTINUAR A MISSÃO →</button>`;
  savePlayerLocally();
  updatePlayer();
  } catch {
    toast("Não foi possível confirmar a resposta. Confira a conexão e tente novamente.", "error");
    document.querySelectorAll(".answer").forEach(b => b.disabled = false);
    $("confirmAnswer").disabled = false; $("confirmAnswer").innerHTML = "CONFIRMAR RESPOSTA <span>→</span>";
  } finally { state.answerBusy = false; }
  if (state.challenge) await refreshPlayer();
}

async function loadRanking() {
  showScreen("rankingScreen"); if (!ensureConfigured()) return;
  try {
    const { data, error } = await db.from("leaderboard").select("id,name,school,score,completed_count").order("score", { ascending:false }).order("completed_count", { ascending:false }).order("name", { ascending:true }).limit(50);
    if (error) throw error;
    const ranking = sortLeaderboard(data);
    const top = ranking.slice(0, 3);
    $("podium").innerHTML = top.map((p, i) => `<article class="podium-card place-${i + 1}"><span>${i === 0 ? "🏆" : i === 1 ? "🥈" : "🥉"}</span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.school)}</small><b>${p.score} pts</b></article>`).join("");
    $("rankingList").innerHTML = ranking.map((p, i) => `<div class="ranking-row ${p.id === state.player?.id ? "is-you" : ""}"><b>${String(i + 1).padStart(2, "0")}</b><span><strong>${escapeHtml(p.name)}${p.id === state.player?.id ? " (você)" : ""}</strong><small>${escapeHtml(p.school)}</small></span><em>${p.score}</em></div>`).join("");
    $("rankingEmpty").classList.toggle("hidden", ranking.length > 0);
  } catch {
    toast("Não foi possível atualizar o ranking. Tente novamente. Sua participação foi mantida.", "error");
  }
}


function updateBonusUnlock() {
  const unlocked = Number(state.player?.score) >= 1000;
  $("bonusContinue").classList.toggle("hidden", !unlocked);
  $("bonusHub").classList.toggle("hidden", !unlocked);
  $("codePanel").classList.toggle("hidden", unlocked);
  if (!unlocked || state.bonusCelebrated.has(state.player.id)) return;
  state.bonusCelebrated.add(state.player.id);
  const key = `upxp_bonus_celebrated_${state.player.id}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch { /* A celebração continua funcionando nesta visita. */ }
  const colors = ["#c8ff3d", "#6f35e8", "#171125", "#ed1c2e"];
  $("bonusConfetti").innerHTML = Array.from({ length: 36 }, (_, i) =>
    `<i style="--x:${(i * 29) % 100}%;--color:${colors[i % colors.length]};--delay:${(i % 7) * .12}s"></i>`).join("");
  $("bonusModal").showModal();
}

async function startBonusRound() {
  if (!ensureConfigured() || !state.player || state.bonusBusy) return;
  state.bonusBusy = true;
  $("bonusContinue").disabled = true;
  $("bonusModal").close();
  const requestedAt = performance.now();
  try {
    const { data, error } = await db.rpc("start_bonus_round", { player_uuid: state.player.id });
    if (error) throw error;
    if (!data) { toast("Você concluiu todas as perguntas disponíveis no modo extra. Confira sua posição no ranking!"); return; }
    clearInterval(state.bonusTimer);
    // Desconta a viagem da requisição: o relógio do aparelho não amplia o prazo do banco.
    state.bonus = { id: data.round_id, deadline: requestedAt + Math.max(0, Date.parse(data.expires_at) - Date.parse(data.server_now)), finished: false };
    state.challenge = data;
    renderChallenge(); showScreen("challengeScreen");
    state.bonusTimer = setInterval(tickBonusTimer, 100);
  } catch {
    toast("Não foi possível abrir a pergunta extra. Tente novamente.", "error");
  } finally {
    state.bonusBusy = false;
    $("bonusContinue").disabled = false;
    if (state.bonus && !state.bonus.finished) tickBonusTimer();
  }
}

function tickBonusTimer() {
  const round = state.bonus;
  if (!round || round.finished) return;
  const remaining = Math.max(0, Math.ceil((round.deadline - performance.now()) / 1000));
  $("bonusTimer").textContent = `${remaining}s para confirmar sua resposta`;
  $("bonusTimer").classList.toggle("urgent", remaining <= 5);
  if (remaining === 0 && !state.bonusBusy) {
    clearInterval(state.bonusTimer);
    submitBonusAnswer(null);
  }
}

async function submitBonusAnswer(index) {
  const round = state.bonus;
  if (!round || round.finished || state.bonusBusy) return;
  if (performance.now() >= round.deadline) index = null;
  if (index === undefined) return;
  state.bonusBusy = true;
  $("confirmAnswer").disabled = true;
  $("confirmAnswer").textContent = "ENVIANDO...";
  document.querySelectorAll(".answer").forEach(b => b.disabled = true);
  try {
    const { data, error } = await db.rpc("submit_bonus_answer", {
      player_uuid: state.player.id, round_uuid: round.id, selected_index: index,
    });
    if (error || !data) throw error || new Error("Resposta vazia");
    round.finished = true;
    clearInterval(state.bonusTimer);
    state.player = { ...state.player, ...data.player };
    savePlayerLocally(); updatePlayer();
    $("bonusTimer").textContent = data.timed_out ? "Tempo esgotado" : "Resposta registrada";
    const feedback = $("answerFeedback");
    feedback.className = `feedback ${data.is_correct ? "success" : "failure"}`;
    feedback.innerHTML = `<strong>${data.timed_out ? "O tempo acabou!" : data.is_correct ? `Acertou! +${data.points_earned} pontos` : "Não foi dessa vez!"}</strong><p>${escapeHtml(data.explanation || "Continue no game e tente a próxima pergunta.")}</p><button class="primary-button" data-action="bonus-next">PRÓXIMA PERGUNTA →</button>`;
    $("confirmAnswer").textContent = "RESPOSTA FINALIZADA";
  } catch {
    // Reenvio usa a mesma rodada; o banco impede pontuação duplicada.
    clearInterval(state.bonusTimer);
    toast("Não foi possível confirmar. Tente enviar novamente; o prazo continua contando.", "error");
    $("confirmAnswer").disabled = false;
    $("confirmAnswer").textContent = "TENTAR NOVAMENTE";
    if (performance.now() < round.deadline) {
      document.querySelectorAll(".answer").forEach(b => b.disabled = false);
      state.bonusTimer = setInterval(tickBonusTimer, 100);
    }
  } finally { state.bonusBusy = false; }
}

function subscribeRanking() {
  if (!db || state.channel) return;
  state.channel = db.channel("ranking-live").on("postgres_changes", { event: "UPDATE", schema: "public", table: "players" }, () => {
    updateActivityFeed();
    if ($("rankingScreen").classList.contains("active")) loadRanking();
  }).subscribe();
}

function escapeHtml(value = "") { const d = document.createElement("div"); d.textContent = value; return d.innerHTML; }

function maybeShowEndMessage() {
  if (!EVENT_END_AT || isNaN(EVENT_END_AT.getTime())) return;
  if (sessionStorage.getItem("upxp_end_shown") === "1") return;
  if (Date.now() < EVENT_END_AT.getTime()) return;
  sessionStorage.setItem("upxp_end_shown", "1");
  const el = $("endModal");
  el?.classList.remove("hidden");
  toast("A Missão UPXP chegou ao fim — confira a mensagem final.", "success");
}

document.addEventListener("click", (event) => {
  const answer = event.target.closest(".answer"); if (answer) return selectAnswer(Number(answer.dataset.index));
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "retry-answer" && state.challenge && !state.challenge.answered && !state.answerBusy && !state.bonus) return renderChallenge();
  if (action === "bonus-next") return startBonusRound();
  if (action === "bonus-dismiss") $("bonusModal").close();
  if (action === "start") showScreen(state.player ? "gameScreen" : "registerScreen");
  if (action === "home") showScreen("welcomeScreen");
  if (action === "game" || action === "continue") { $("codeInput").value = ""; showScreen("gameScreen"); }
  if (action === "enter-game") { sessionStorage.setItem("upxp_instructions_seen", "1"); showScreen("gameScreen"); }
  if (action === "show-ranking") loadRanking();
  if (action === "previous") showScreen(state.previous === "rankingScreen" ? "welcomeScreen" : state.previous);
  if (action === "end-dismiss") $("endModal")?.classList.add("hidden");
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
  const result = await refreshPlayerWithRetry();
  if (result !== true) {
    // O ranking público não é uma fonte de validação da identidade do participante.
    // Ausência ou falha de leitura não invalida o cadastro que já foi confirmado.
    toast("Não foi possível atualizar sua pontuação agora. Sua participação foi mantida.", "error");
  }
}

restoreSession();
subscribeRanking();
updateActivityFeed();
setInterval(showNextFeedMessage, 6000);
setInterval(maybeShowEndMessage, 30000);
maybeShowEndMessage();
