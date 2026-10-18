import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const supabase = createClient("https://pguyhknljcrnwoidhlzp.supabase.co", "sb_publishable_hi_rSiAXwQqOqhaXsryUHw_pMu5f35I");
const $ = (selector) => document.querySelector(selector);
const keyboardRows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const puzzleWords = new Set("xylyl glyph nymph kudzu whomp whoop mooch foggy zippy piezo phono poppy knock chomp gonzo jumpy fjord whizz psych kazoo slunk stank tacky wacky bawdy cliff bongo mambo kabob hokum hooch goofy chunk prawn funky fungi feign gnome bugle bundt pylon rotor bogus mogul nexus emcee cajun blood cajon axiom cacti eerie azure frown thumb quiet quite boxer clown zebra moxie toxic motif shoed lunch vault guide scalp chair fight rough rogue helix tenor essay gamma vexed party neigh eight marsh cache moist posit evade tread adder melee penal cease orate snipe plait shirt worst horse usual empty apply gleek sitar cower waste".split(" "));
const legacyPlayerId = localStorage.playerId;
let playerId;
let puzzle;
let currentRows = [];
let activeGuess = "";
let availablePuzzles = [];
let validWords = new Set();
let dictionaryReady = false;

function letterStates(rows = []) {
  const rank = { absent: 1, present: 2, correct: 3 };
  const states = new Map();
  rows.forEach(({ guess, feedback }) => [...guess].forEach((letter, index) => {
    const state = feedback[index];
    if (!states.has(letter) || rank[state] > rank[states.get(letter)]) states.set(letter, state);
  }));
  return states;
}
function boardRowsMarkup(rows, editable = false) {
  return Array.from({ length: 6 }, (_, row) => {
    const guess = rows[row]?.guess || (editable && row === currentRows.length ? activeGuess : "");
    const feedback = rows[row]?.feedback || [];
    return `<div class="row">${Array.from({ length: 5 }, (_, col) => `<span class="tile ${feedback[col] || ""}">${guess[col] || ""}</span>`).join("")}</div>`;
  }).join("");
}
function boardMarkup(rows, className = "board") { return `<div class="${className}">${boardRowsMarkup(rows)}</div>`; }
function drawBoard() { $("#board").innerHTML = boardRowsMarkup(currentRows, true); }
function drawKeyboard() {
  const states = letterStates(currentRows);
  const row = (letters) => [...letters].map((letter) => `<button type="button" class="key ${states.get(letter) || ""}" data-key="${letter}">${letter}</button>`).join("");
  $("#game-keyboard").innerHTML = `<div class="key-row">${row(keyboardRows[0])}</div><div class="key-row">${row(keyboardRows[1])}</div><div class="key-row"><button type="button" class="key action" data-key="enter">Enter</button>${row(keyboardRows[2])}<button type="button" class="key action" data-key="backspace" aria-label="Delete last letter">⌫</button></div>`;
}
function redraw() { drawBoard(); drawKeyboard(); }
function showMessage(text, error = false) { const el = $("#message"); el.textContent = text; el.classList.toggle("error", error); }
function setKeyboardDisabled(disabled) { document.querySelectorAll("#game-keyboard button").forEach((button) => { button.disabled = disabled; }); }
function localDate(date) { return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric" }); }
async function loadDictionary() {
  try {
    const response = await fetch("valid-words.txt");
    if (!response.ok) throw new Error("Dictionary unavailable");
    validWords = new Set((await response.text()).split(/\r?\n/).map((word) => word.trim().toLowerCase()).filter(Boolean));
    puzzleWords.forEach((word) => validWords.add(word)); dictionaryReady = true;
  } catch { showMessage("The word list could not load. Please refresh and try again.", true); }
}
async function authenticate() {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    session = data.session;
  }
  playerId = session.user.id;
  if (legacyPlayerId && legacyPlayerId !== playerId) await supabase.rpc("claim_legacy_games", { p_legacy_player_id: legacyPlayerId });
  localStorage.playerId = playerId;
}
async function loadAvailablePuzzles() {
  const { data } = await supabase.rpc("get_available_puzzles");
  availablePuzzles = data || [];
  const latest = availablePuzzles.at(-1)?.puzzle_date;
  if (latest) $("#puzzle-date").max = latest;
}
async function activatePuzzle(nextPuzzle) {
  puzzle = nextPuzzle; currentRows = []; activeGuess = "";
  $("#subtitle").textContent = localDate(puzzle.puzzle_date);
  $("#game-card").classList.remove("hidden"); $("#results-card").classList.add("hidden"); $("#game-keyboard").classList.remove("hidden"); $(".keyboard-note").classList.remove("hidden"); $("#other-games").classList.add("hidden"); showMessage(""); redraw();
  const { data } = await supabase.rpc("get_player_game", { p_puzzle_id:puzzle.id, p_player_id:playerId });
  const savedGame = data?.[0];
  if (!savedGame) return;
  currentRows = savedGame.rows || []; redraw();
  if (savedGame.state !== "playing") finishGame(savedGame);
}
async function loadToday() {
  const { data, error } = await supabase.rpc("get_today_puzzle");
  if (error || !data?.[0]) { $("#subtitle").textContent = "No puzzle has been published yet. Check back soon."; return; }
  activatePuzzle(data[0]);
}
async function loadDate(date) {
  const { data, error } = await supabase.rpc("get_puzzle_for_date", { p_date:date });
  if (error || !data?.[0]) return showMessage("That puzzle is unavailable. Future dates stay locked.", true);
  $("#archive-panel").classList.add("hidden"); activatePuzzle(data[0]);
}
async function submitGuess() {
  if (activeGuess.length !== 5) return showMessage("Enter five letters first.", true);
  if (!dictionaryReady) return showMessage("Loading the word list…", true);
  if (!validWords.has(activeGuess)) return showMessage("That isn’t in the word list.", true);
  setKeyboardDisabled(true); showMessage("");
  const { data, error } = await supabase.rpc("submit_guess", { p_puzzle_id:puzzle.id, p_player_id:playerId, p_player_name:"Player", p_guess:activeGuess });
  setKeyboardDisabled(false);
  if (error || !data?.[0]) return showMessage(error?.message || "That didn’t work. Please try again.", true);
  const result = data[0]; currentRows = result.rows; activeGuess = ""; redraw();
  if (result.state === "playing") return showMessage(`${6 - result.guess_count} guesses remaining.`);
  finishGame(result);
}
function finishGame(result) {
  $("#game-keyboard").classList.add("hidden"); $(".keyboard-note").classList.add("hidden"); showMessage(""); showResults(result);
}
function useKey(key) {
  if (key === "enter") return submitGuess();
  if (key === "backspace") { activeGuess = activeGuess.slice(0, -1); showMessage(""); return drawBoard(); }
  if (activeGuess.length < 5) { activeGuess += key; showMessage(""); drawBoard(); }
}
async function showResults(result) {
  $("#results-card").classList.remove("hidden");
  $("#result-heading").textContent = result.state === "won" ? "You got it!" : `The word was ${result.answer.toUpperCase()}.`;
  $("#result-copy").textContent = result.state === "won" ? `Solved in ${result.guess_count} guess${result.guess_count === 1 ? "" : "es"}.` : "Try another day’s puzzle whenever you like.";
  const { data } = await supabase.rpc("get_puzzle_stats", { p_puzzle_id:puzzle.id }); const stats = data?.[0] || {};
  $("#stats").innerHTML = [[stats.players || 0,"players"],[stats.solved || 0,"solved"],[stats.average_guesses || "—","avg. guesses"]].map(([value,label]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join("");
}
async function loadOtherGames() {
  const button = $("#other-games-button"); button.disabled = true;
  const { data, error } = await supabase.rpc("get_completed_boards", { p_puzzle_id:puzzle.id }); button.disabled = false;
  if (error) {
    const reason = error.message === "Finish this puzzle first."
      ? "Finish this puzzle on this browser first, then try again."
      : `The shared-board request failed: ${error.message}`;
    $("#other-boards").innerHTML = `<p class="empty-boards">${reason}</p>`;
    $("#other-games").classList.remove("hidden");
    return;
  }
  $("#other-boards").innerHTML = data?.length
    ? data.map((game) => `<article class="shared-game"><p>${game.state === "won" ? `Solved in ${game.guess_count} guess${game.guess_count === 1 ? "" : "es"}` : "Did not solve"}</p>${boardMarkup(game.rows, "shared-board")}</article>`).join("")
    : `<p class="empty-boards">No other completed games yet.</p>`;
  $("#other-games").classList.remove("hidden");
}
$("#game-keyboard").addEventListener("click", (event) => { const key = event.target.closest("button")?.dataset.key; if (key) useKey(key); });
document.addEventListener("keydown", (event) => {
  if ($("#game-keyboard").classList.contains("hidden") || event.metaKey || event.ctrlKey || event.altKey) return;
  if (/^[a-zA-Z]$/.test(event.key)) useKey(event.key.toLowerCase()); else if (event.key === "Backspace") useKey("backspace"); else if (event.key === "Enter") useKey("enter");
});
$("#archive-toggle").addEventListener("click", () => $("#archive-panel").classList.toggle("hidden"));
$("#date-button").addEventListener("click", () => { const date = $("#puzzle-date").value; if (date) loadDate(date); });
$("#random-button").addEventListener("click", () => { if (availablePuzzles.length) loadDate(availablePuzzles[Math.floor(Math.random() * availablePuzzles.length)].puzzle_date); });
$("#play-again").addEventListener("click", () => $("#game-card").scrollIntoView({ behavior:"smooth" }));
$("#other-games-button").addEventListener("click", loadOtherGames);
async function start() {
  try { await authenticate(); await Promise.all([loadDictionary(), loadAvailablePuzzles()]); await loadToday(); }
  catch { $("#subtitle").textContent = "The private game session could not start. Please refresh."; }
}
start();
