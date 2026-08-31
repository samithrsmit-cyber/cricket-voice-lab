const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  battingTeam: $('#batting-team'),
  bowlingTeam: $('#bowling-team'),
  venue: $('#venue'),
  score: $('#score'),
  over: $('#over'),
  striker: $('#striker'),
  nonStriker: $('#non-striker'),
  bowler: $('#bowler'),
  partnership: $('#partnership'),
  selectedZone: $('#selected-zone'),
  selectionSummary: $('#selection-summary'),
  confirm: $('#confirm-ball'),
  undo: $('#undo'),
  start: $('#start-commentary'),
  stop: $('#stop-commentary'),
  status: $('#status'),
  engineState: $('#engine-state'),
  currentLine: $('#current-line'),
  voiceName: $('#voice-name'),
  history: $('#commentary-history'),
  lineCount: $('#line-count'),
};

const focusTopics = [
  'the current match situation',
  'the partnership and how the batters are settling',
  'the striker and the options available',
  'the bowler and a sensible tactical adjustment',
  'the pattern in the recent deliveries',
  'strike rotation and scoreboard pressure',
];

let matchData = null;
let state = null;
let selectedResult = null;
let selectedZone = null;
let snapshots = [];
let modelReady = false;
let chosenVoice = null;

let running = false;
let speaking = false;
let pumping = false;
let sessionId = 0;
let stateRevision = 0;
let speechToken = 0;
let pendingEvent = null;
let prefetched = null;
let focusIndex = 0;
let spokenCount = 0;
let recentLines = [];
const requestControllers = new Set();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function overText(legalBalls = state.legal_balls) {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', isError);
}

function setEngine(label, className) {
  elements.engineState.textContent = label;
  elements.engineState.className = `engine-state ${className}`;
}

function renderMatch() {
  if (!matchData || !state) return;
  elements.battingTeam.textContent = matchData.match.batting_team;
  elements.bowlingTeam.textContent = matchData.match.bowling_team;
  elements.venue.textContent = matchData.match.venue;
  elements.score.textContent = `${state.score}/${state.wickets}`;
  elements.over.textContent = `${overText()} overs`;
  elements.striker.textContent = state.striker;
  elements.nonStriker.textContent = state.non_striker;
  elements.bowler.textContent = state.bowler;
  elements.partnership.textContent = `${state.partnership_runs} from ${state.partnership_balls}`;
  elements.undo.disabled = snapshots.length === 0;
}

function resultDescription(result) {
  if (!result) return '';
  const labels = {
    wicket: 'Wicket',
    wide: 'Wide',
    'no-ball': 'No-ball',
    bye: 'Bye',
    'leg-bye': 'Leg-bye',
  };
  if (result.kind === 'runs') return `${result.runs} run${result.runs === 1 ? '' : 's'}`;
  return labels[result.kind] || result.kind;
}

function renderSelection() {
  const resultText = resultDescription(selectedResult);
  elements.selectedZone.textContent = selectedZone || 'Not selected';
  elements.selectedZone.classList.toggle('active', Boolean(selectedZone));
  elements.confirm.disabled = !selectedResult;
  if (!selectedResult) {
    elements.selectionSummary.textContent = 'Choose a result. Field position is optional.';
  } else if (selectedZone) {
    elements.selectionSummary.textContent = `${resultText}, towards ${selectedZone}. Ready to confirm.`;
  } else {
    elements.selectionSummary.textContent = `${resultText} selected. You can confirm now or add a field position.`;
  }
}

function chooseResult(button) {
  $$('.result-button').forEach((item) => item.classList.remove('selected'));
  button.classList.add('selected');
  selectedResult = {
    kind: button.dataset.kind,
    runs: Number(button.dataset.runs || 0),
  };
  renderSelection();
}

function chooseZone(button) {
  $$('.zone').forEach((item) => item.classList.remove('selected'));
  button.classList.add('selected');
  selectedZone = button.dataset.zone;
  renderSelection();
}

function swapBatters() {
  [state.striker, state.non_striker] = [state.non_striker, state.striker];
}

function pushRecentBall(label) {
  state.recent_balls.push(label);
  state.recent_balls = state.recent_balls.slice(-8);
}

function applySelectedDelivery() {
  if (!selectedResult || !state) return;
  snapshots.push(clone(state));
  snapshots = snapshots.slice(-30);

  const result = clone(selectedResult);
  const strikerBefore = state.striker;
  const scoreBefore = state.score;
  const wicketsBefore = state.wickets;
  const legal = !['wide', 'no-ball'].includes(result.kind);

  if (result.kind === 'wicket') {
    state.wickets += 1;
    state.partnership_runs = 0;
    state.partnership_balls = 0;
    pushRecentBall('W');
  } else {
    state.score += result.runs;
    state.partnership_runs += result.runs;
    if (result.kind === 'wide') pushRecentBall(`${result.runs}wd`);
    else if (result.kind === 'no-ball') pushRecentBall(`${result.runs}nb`);
    else if (result.kind === 'bye') pushRecentBall(`${result.runs}b`);
    else if (result.kind === 'leg-bye') pushRecentBall(`${result.runs}lb`);
    else pushRecentBall(String(result.runs));
  }

  if (legal) {
    state.legal_balls += 1;
    if (result.kind !== 'wicket') state.partnership_balls += 1;
  }

  if (result.kind === 'runs' && result.runs % 2 === 1) swapBatters();
  if (['bye', 'leg-bye'].includes(result.kind) && result.runs % 2 === 1) swapBatters();

  if (result.kind === 'wicket') {
    const next = matchData.batting_order[state.next_batter_index];
    state.striker = next || `New batter ${state.next_batter_index + 1}`;
    state.next_batter_index += 1;
  }

  if (legal && state.legal_balls % 6 === 0) swapBatters();

  const event = {
    type: result.kind,
    description: resultDescription(result),
    runs_added: state.score - scoreBefore,
    wicket_added: state.wickets - wicketsBefore,
    legal_delivery: legal,
    field_position: selectedZone || null,
    striker_before: strikerBefore,
    score_after: `${state.score}/${state.wickets}`,
    over_after: overText(),
  };
  state.latest_event = event;
  renderMatch();
  queueEvent(event);
  clearSelection();
}

function clearSelection() {
  selectedResult = null;
  selectedZone = null;
  $$('.result-button, .zone').forEach((item) => item.classList.remove('selected'));
  renderSelection();
}

function undoLastDelivery() {
  if (!snapshots.length) return;
  state = snapshots.pop();
  stateRevision += 1;
  abortRequests();
  pendingEvent = {
    type: 'correction',
    description: 'Scoring correction',
    score_after: `${state.score}/${state.wickets}`,
    over_after: overText(),
    field_position: null,
  };
  renderMatch();
  clearSelection();
  if (running && !speaking) pump();
}

function isUrgent(event) {
  return event.type === 'wicket' || (event.type === 'runs' && event.runs_added >= 4);
}

function queueEvent(event) {
  stateRevision += 1;
  pendingEvent = event;
  abortRequests();
  if (!running) return;
  if (isUrgent(event) && speaking) {
    interruptSpeech();
  } else if (!speaking) {
    pump();
  }
}

function stateForModel() {
  return {
    match: matchData.match,
    score: state.score,
    wickets: state.wickets,
    over: overText(),
    striker: state.striker,
    non_striker: state.non_striker,
    bowler: state.bowler,
    partnership_runs: state.partnership_runs,
    partnership_balls: state.partnership_balls,
    recent_balls: state.recent_balls,
  };
}

async function requestCommentary(mode, event, requestSession, revision) {
  const controller = new AbortController();
  requestControllers.add(controller);
  const focus = focusTopics[focusIndex++ % focusTopics.length];
  try {
    const response = await fetch('/api/commentary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        mode,
        state: stateForModel(),
        event,
        focus,
        recent_lines: recentLines,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Qwen could not generate commentary.');
    if (!running || requestSession !== sessionId || revision !== stateRevision) return null;
    return data.commentary;
  } finally {
    requestControllers.delete(controller);
  }
}

function abortRequests() {
  requestControllers.forEach((controller) => controller.abort());
  requestControllers.clear();
  prefetched = null;
}

function startPrefetch() {
  if (!running || pendingEvent || prefetched) return;
  const requestSession = sessionId;
  const revision = stateRevision;
  const promise = requestCommentary('filler', null, requestSession, revision)
    .then((line) => ({ line, requestSession, revision }))
    .catch((error) => ({ error, requestSession, revision }));
  prefetched = { requestSession, revision, promise };
}

async function getNextLine(requestSession) {
  if (pendingEvent) {
    const event = pendingEvent;
    pendingEvent = null;
    const revision = stateRevision;
    try {
      const line = await requestCommentary('event', event, requestSession, revision);
      return line ? { line, kind: 'event', event, revision } : null;
    } catch (error) {
      if (error.name !== 'AbortError' && revision === stateRevision) pendingEvent = event;
      throw error;
    }
  }

  if (prefetched) {
    const current = prefetched;
    prefetched = null;
    const result = await current.promise;
    if (result.error) throw result.error;
    if (result.line && result.requestSession === sessionId && result.revision === stateRevision) {
      return { line: result.line, kind: 'filler', event: null, revision: result.revision };
    }
  }

  const revision = stateRevision;
  const line = await requestCommentary('filler', null, requestSession, revision);
  return line ? { line, kind: 'filler', event: null, revision } : null;
}

async function pump() {
  if (!running || speaking || pumping) return;
  pumping = true;
  const requestSession = sessionId;
  try {
    setStatus(pendingEvent ? 'Qwen is preparing the latest-ball call…' : 'Qwen is preparing the next live line…');
    const item = await getNextLine(requestSession);
    if (!item || !running || requestSession !== sessionId) return;
    speakLine(item, requestSession);
  } catch (error) {
    if (error.name !== 'AbortError' && running && requestSession === sessionId) {
      setStatus(error.message, true);
      window.setTimeout(pump, 1400);
    }
  } finally {
    pumping = false;
    if (running && !speaking && requestSession === sessionId) window.setTimeout(pump, 80);
  }
}

function refreshVoice() {
  if (!('speechSynthesis' in window)) {
    chosenVoice = null;
    elements.voiceName.textContent = 'Browser speech is unavailable';
    return;
  }
  const voices = window.speechSynthesis.getVoices();
  chosenVoice =
    voices.find((voice) => voice.name.toLowerCase().includes('ravi')) ||
    voices.find((voice) => voice.lang.toLowerCase() === 'en-in') ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ||
    voices[0] ||
    null;
  elements.voiceName.textContent = chosenVoice ? chosenVoice.name : 'Waiting for Windows voices…';
}

function addHistory(line, interrupted = false) {
  if (elements.history.querySelector('.empty-history')) elements.history.innerHTML = '';
  const item = document.createElement('li');
  item.textContent = interrupted ? `${line} (interrupted)` : line;
  elements.history.prepend(item);
  while (elements.history.children.length > 12) elements.history.lastElementChild.remove();
  spokenCount += 1;
  elements.lineCount.textContent = `${spokenCount} line${spokenCount === 1 ? '' : 's'}`;
}

function speakLine(item, requestSession) {
  if (!running || requestSession !== sessionId) return;
  const utterance = new SpeechSynthesisUtterance(item.line);
  if (chosenVoice) utterance.voice = chosenVoice;
  utterance.lang = chosenVoice?.lang || 'en-IN';
  utterance.rate = 1;
  utterance.pitch = 0.96;
  utterance.volume = 1;

  const token = ++speechToken;
  let settled = false;
  speaking = true;
  elements.currentLine.textContent = item.line;
  recentLines = [...recentLines, item.line].slice(-8);
  setStatus(item.kind === 'event' ? 'Announcing the confirmed delivery.' : 'Continuous commentary is running.');

  const finish = (interrupted = false) => {
    if (settled || token !== speechToken) return;
    settled = true;
    speaking = false;
    addHistory(item.line, interrupted);
    if (running && requestSession === sessionId) window.setTimeout(pump, 170);
  };

  utterance.onend = () => finish(false);
  utterance.onerror = (event) => {
    const interrupted = ['interrupted', 'canceled'].includes(event.error);
    if (!interrupted) setStatus(`Microsoft voice error: ${event.error}`, true);
    finish(interrupted);
  };

  window.speechSynthesis.speak(utterance);
  startPrefetch();
}

function interruptSpeech() {
  if (!speaking) return;
  speechToken += 1;
  speaking = false;
  window.speechSynthesis.cancel();
  if (running) window.setTimeout(pump, 90);
}

function startCommentary() {
  if (!modelReady || running) return;
  refreshVoice();
  if (!chosenVoice) {
    setStatus('Microsoft Ravi or another Windows English voice was not found.', true);
    return;
  }
  window.speechSynthesis.cancel();
  sessionId += 1;
  running = true;
  speaking = false;
  pumping = false;
  pendingEvent = null;
  prefetched = null;
  elements.start.disabled = true;
  elements.stop.disabled = false;
  setEngine('Running', 'running');
  elements.currentLine.textContent = 'Qwen is preparing the opening line…';
  setStatus('Continuous commentary started. It will continue until you press Stop.');
  pump();
}

function stopCommentary() {
  sessionId += 1;
  running = false;
  speechToken += 1;
  speaking = false;
  pumping = false;
  pendingEvent = null;
  abortRequests();
  window.speechSynthesis.cancel();
  elements.start.disabled = !modelReady;
  elements.stop.disabled = true;
  setEngine(modelReady ? 'Ready' : 'Loading', modelReady ? 'ready' : 'loading');
  elements.currentLine.textContent = 'Commentary stopped.';
  setStatus('Stopped immediately. Press Start Commentary to begin again.');
}

async function checkServer() {
  if (window.location.protocol === 'file:') {
    setStatus('Open this app through start_voice_tester.bat, not as a file.', true);
    setEngine('Offline', 'error');
    return;
  }
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    modelReady = Boolean(data.ready);
    if (data.ready) {
      if (!running) setEngine('Ready', 'ready');
      elements.start.disabled = running;
      if (!running) setStatus(data.message);
    } else if (data.phase === 'error') {
      setEngine('Error', 'error');
      elements.start.disabled = true;
      setStatus(data.message, true);
    } else {
      setEngine('Loading', 'loading');
      elements.start.disabled = true;
      setStatus(data.message);
      window.setTimeout(checkServer, 1000);
    }
  } catch {
    modelReady = false;
    setEngine('Offline', 'error');
    elements.start.disabled = true;
    setStatus('The local commentary server is not running.', true);
    window.setTimeout(checkServer, 1500);
  }
}

async function loadMatch() {
  try {
    const response = await fetch('match.json');
    if (!response.ok) throw new Error('Could not load match.json.');
    matchData = await response.json();
    state = clone(matchData.initial_state);
    renderMatch();
  } catch (error) {
    setStatus(error.message, true);
  }
}

$$('.result-button').forEach((button) => button.addEventListener('click', () => chooseResult(button)));
$$('.zone').forEach((button) => button.addEventListener('click', () => chooseZone(button)));
elements.confirm.addEventListener('click', applySelectedDelivery);
elements.undo.addEventListener('click', undoLastDelivery);
elements.start.addEventListener('click', startCommentary);
elements.stop.addEventListener('click', stopCommentary);

if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = refreshVoice;
refreshVoice();
renderSelection();
loadMatch();
checkServer();
