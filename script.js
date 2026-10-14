const clock = document.querySelector('.clock');
const minuteDisplay = document.getElementById('timer-minutes');
const secondDisplay = document.getElementById('timer-seconds');
const timerDisplay = document.getElementById('timer-display');
const stateText = document.getElementById('clock-state-text');
const toggleButton = document.getElementById('timer-toggle');
const toggleIcon = document.getElementById('toggle-icon');
const toggleLabel = document.getElementById('toggle-label');
const unitButtons = document.querySelectorAll('[data-unit]');
const units = { seconds: { label: '초', multiplier: 1000, max: 59 }, minutes: { label: '분', multiplier: 60000, max: 59 }, hours: { label: '시간', multiplier: 3600000, max: 23 } };
let selectedUnit = 'minutes';
const status = document.getElementById('timer-status');
const dial = document.querySelector('.duration-dial');
const durationInput = document.getElementById('duration-value');
const tabs = [...document.querySelectorAll('[role="tab"]')];
const themeSelect = document.getElementById('theme-select');
const soundSelect = document.getElementById('sound-select');
const storageKey = 'focus.sessions.v1';
let activeTab = 'timer';
let dialDrag = null;
const timeParts = { hours: 0, minutes: 5, seconds: 15 };
const durationMs = () => Object.entries(timeParts).reduce((total, [unit, value]) => total + value * units[unit].multiplier, 0);
let remaining = durationMs();
let endsAt = 0;
let state = 'idle';
let sessionStartedAt = 0;
let audioContext = null;
const saved = readSaved();
let sessions = saved.sessions;
const settings = saved.settings;

function storageUnavailable() {
  const notice = document.getElementById('storage-status');
  notice.hidden = false;
  notice.textContent = '기록을 저장할 수 없어요.';
}

function readSaved() {
  const fallback = { sessions: [], settings: { theme: 'dark', sound: 'off' } };
  try {
    const data = JSON.parse(localStorage.getItem(storageKey));
    if (!data || data.version !== 1) return fallback;
    const unique = new Map();
    if (Array.isArray(data.sessions)) data.sessions.forEach(session => {
      if (typeof session.id === 'string' && Number.isFinite(session.duration) && session.duration > 0 &&
          session.duration <= 86400000 && Number.isFinite(session.completedAt)) unique.set(session.id, session);
    });
    return {
      sessions: [...unique.values()].sort((a, b) => b.completedAt - a.completedAt),
      settings: {
        theme: data.settings?.theme === 'light' ? 'light' : 'dark',
        sound: data.settings?.sound === 'on' ? 'on' : 'off'
      }
    };
  } catch {
    storageUnavailable();
    return fallback;
  }
}

function saveRecords() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, sessions, settings }));
  } catch {
    storageUnavailable();
  }
}

function formatDuration(milliseconds) {
  const total = Math.round(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  return [hours ? hours + '시간' : '', minutes ? minutes + '분' : '', seconds || !total ? seconds + '초' : ''].filter(Boolean).join(' ');
}

function renderRecords() {
  const focusedMs = sessions.reduce((sum, session) => sum + session.duration, 0);
  document.getElementById('session-count').textContent = sessions.length;
  const recordUnit = focusedMs < 60000 ? units.seconds : focusedMs < 3600000 ? units.minutes : units.hours;
  document.getElementById('focused-minutes').textContent = Math.round(focusedMs / recordUnit.multiplier * 10) / 10;
  document.getElementById('focused-unit').textContent = recordUnit.label;
  const list = document.getElementById('session-list');
  list.replaceChildren();
  sessions.forEach(session => {
    const item = document.createElement('li');
    const date = document.createElement('time');
    date.dateTime = new Date(session.completedAt).toISOString();
    date.textContent = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(session.completedAt);
    const duration = document.createElement('strong');
    duration.textContent = formatDuration(session.duration);
    item.append(date, duration);
    list.append(item);
  });
}

const orb = new FocusOrb(clock, () => ({ state, visible: activeTab === 'timer', ratio: Math.max(0, (durationMs() ? remaining / durationMs() : 1)) }));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function resetOrb() { orb.reset(); }
function requestOrbFrame() { orb.request(); }
function announce(message, kind = 'info') {
  status.textContent = message;
  status.dataset.state = kind;
}

function renderTimer() {
  const totalSeconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const showHours = true;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  document.getElementById('timer-hours').hidden = !showHours;
  document.getElementById('hour-colon').hidden = !showHours;
  document.getElementById('timer-hours').textContent = String(hours).padStart(2, '0');
  timerDisplay.classList.toggle('has-hours', showHours);
  minuteDisplay.textContent = String(minutes).padStart(2, '0');
  secondDisplay.textContent = String(seconds).padStart(2, '0');
  timerDisplay.setAttribute('aria-label', `남은 시간 ${hours}시간 ${minutes}분 ${seconds}초`);
  if (reducedMotion.matches) requestOrbFrame();
}

function setState(nextState) {
  state = nextState;
  clock.dataset.state = state;
  const running = state === 'running';
  stateText.textContent = { idle: 'READY', running: 'IN FOCUS', paused: 'PAUSED', completed: 'WELL DONE' }[state];
  toggleLabel.textContent = { idle: '집중 시작', running: '일시정지', paused: '집중 이어가기', completed: '다시 집중하기' }[state];
  toggleIcon.textContent = running ? 'pause' : 'play_arrow';
  dial.setAttribute('aria-disabled', String(running));
  toggleButton.disabled = durationMs() === 0;
  dial.setAttribute('aria-valuemin', '0');
  dial.setAttribute('aria-valuenow', timeParts[selectedUnit]);
  dial.setAttribute('aria-valuemax', units[selectedUnit].max);
  dial.setAttribute('aria-valuetext', `${timeParts[selectedUnit]}${units[selectedUnit].label}`);
  dial.style.setProperty('--dial-angle', `${-135 + timeParts[selectedUnit] / units[selectedUnit].max * 270}deg`);
  durationInput.value = timeParts[selectedUnit];
  durationInput.max = units[selectedUnit].max;
  durationInput.disabled = running;
  durationInput.setAttribute('aria-label', units[selectedUnit].label + ' 설정');
  durationInput.removeAttribute('aria-invalid');
  document.getElementById('dial-unit').textContent = units[selectedUnit].label;
  document.querySelector('.control-deck').dataset.state = state;
  unitButtons.forEach((button) => {
    button.disabled = running;
    button.setAttribute('aria-pressed', String(button.dataset.unit === selectedUnit));
  });
  requestOrbFrame();
}

function completeSession() {
  if (state !== 'running') return;
  remaining = 0;
  sessions.unshift({
    id: crypto.randomUUID(),
    duration: durationMs(),
    startedAt: sessionStartedAt,
    completedAt: Date.now()
  });
  saveRecords();
  renderRecords();
  setState('completed');
  orb.finish();
  playCompletionSound();
  renderTimer();
  announce(`${timeParts.hours}시간 ${timeParts.minutes}분 ${timeParts.seconds}초 집중 완료.`, 'success');
}

function refreshTimer() {
  if (state !== 'running') return;
  remaining = Math.max(0, endsAt - Date.now());
  if (remaining === 0) completeSession();
  else renderTimer();
}

function configureDuration(amount) {
  resetOrb();
  timeParts[selectedUnit] = amount;
  remaining = durationMs();
  setState('idle');
  renderTimer();
  announce(`${units[selectedUnit].label} 설정값 ${amount}.`);
}

toggleButton.addEventListener('click', () => {
  if (durationMs() === 0) return;
  if (state === 'running') {
    refreshTimer();
    if (state !== 'running') return;
    setState('paused');
    announce('잠시 멈췄어요.');
    return;
  }
  if (state === 'completed') {
    remaining = durationMs();
    resetOrb();
  }
  if (state !== 'paused') sessionStartedAt = Date.now();
  prepareAudio();
  endsAt = Date.now() + remaining;
  setState('running');
  renderTimer();
  announce('집중 중이에요.');
});

document.getElementById('timer-reset').addEventListener('click', () => {
  resetOrb();
  remaining = durationMs();
  setState('idle');
  renderTimer();
  announce('타이머를 초기화했어요.');
});

unitButtons.forEach(button => button.addEventListener('click', () => {
  if (state === 'running' || selectedUnit === button.dataset.unit) return;
  selectedUnit = button.dataset.unit;
  setState(state);
}));

function setDialAmount(amount) {
  if (state === 'running' || !Number.isFinite(amount)) return;
  const next = Math.max(0, Math.min(units[selectedUnit].max, Math.round(amount)));
  if (next !== timeParts[selectedUnit]) configureDuration(next);
}

dial.addEventListener('pointerdown', event => {
  if (state === 'running' || event.button !== 0 || dialDrag) return;
  const rect = dial.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const deadzone = rect.width * .22;
  const vertical = Math.hypot(event.clientX - x, event.clientY - y) < deadzone;
  dialDrag = { id: event.pointerId, x, y, deadzone, vertical, lastY: event.clientY, angle: Math.atan2(event.clientX - x, y - event.clientY), value: timeParts[selectedUnit] };
  dial.setPointerCapture(event.pointerId);
  dial.classList.add('is-turning');
  dial.focus({ preventScroll: true });
});
dial.addEventListener('pointermove', event => {
  if (!dialDrag || event.pointerId !== dialDrag.id || state === 'running') return;
  if (dialDrag.vertical) {
    dialDrag.value = Math.max(0, Math.min(units[selectedUnit].max, dialDrag.value + (dialDrag.lastY - event.clientY) / 5));
    dialDrag.lastY = event.clientY;
    setDialAmount(dialDrag.value);
    return;
  }
  if (Math.hypot(event.clientX - dialDrag.x, event.clientY - dialDrag.y) < dialDrag.deadzone) {
    dialDrag.angle = null;
    return;
  }
  const angle = Math.atan2(event.clientX - dialDrag.x, -(event.clientY - dialDrag.y));
  if (dialDrag.angle !== null) {
    let change = angle - dialDrag.angle;
    if (change > Math.PI) change -= 2 * Math.PI;
    if (change < -Math.PI) change += 2 * Math.PI;
    if (Math.abs(change) < Math.PI / 2) {
      dialDrag.value = Math.max(0, Math.min(units[selectedUnit].max, dialDrag.value + change / (Math.PI * 1.5) * units[selectedUnit].max));
      setDialAmount(dialDrag.value);
    }
  }
  dialDrag.angle = angle;
});
function releaseDial(event) {
  if (!dialDrag || event.pointerId !== dialDrag.id) return;
  dialDrag = null;
  dial.classList.remove('is-turning');
  if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
}
dial.addEventListener('pointerup', releaseDial);
dial.addEventListener('pointercancel', releaseDial);
dial.addEventListener('lostpointercapture', releaseDial);
dial.addEventListener('keydown', event => {
  const increments = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };
  if (!(event.key in increments) && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  setDialAmount(event.key === 'Home' ? 0 : event.key === 'End' ? units[selectedUnit].max : timeParts[selectedUnit] + increments[event.key]);
});
dial.addEventListener('wheel', event => {
  if (state === 'running' || document.activeElement !== dial) return;
  event.preventDefault();
  setDialAmount(timeParts[selectedUnit] + (event.deltaY < 0 ? 1 : -1));
}, { passive: false });

document.querySelector('.theme-toggle').addEventListener('click', (event) => {
  applyTheme(settings.theme === 'dark' ? 'light' : 'dark');
  saveRecords();
});

durationInput.addEventListener('input', () => {
  if (!durationInput.value) {
    durationInput.setAttribute('aria-invalid', 'true');
    toggleButton.disabled = true;
    return;
  }
  setDialAmount(durationInput.valueAsNumber);
  setState(state);
});
durationInput.addEventListener('change', () => {
  if (durationInput.value) setDialAmount(durationInput.valueAsNumber);
  setState(state);
});

function selectTab(tab, focus = false) {
  activeTab = tab.id.replace('tab-', '');
  tabs.forEach(button => {
    const selected = button === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
  });
  orb.fragmentCanvas.hidden = activeTab !== 'timer';
  orb.last = 0;
  if (activeTab === 'timer') orb.resize();
  if (focus) tab.focus();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const offsets = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in offsets) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + offsets[event.key] + tabs.length) % tabs.length;
    selectTab(tabs[next], true);
  });
});

function applyTheme(theme) {
  settings.theme = theme;
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  themeSelect.value = theme;
  const button = document.querySelector('.theme-toggle');
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', dark ? '라이트 모드' : '다크 모드');
  requestOrbFrame();
}

themeSelect.addEventListener('change', () => {
  applyTheme(themeSelect.value);
  saveRecords();
});
soundSelect.addEventListener('change', () => {
  settings.sound = soundSelect.value;
  prepareAudio();
  saveRecords();
});

function prepareAudio() {
  if (settings.sound !== 'on') return;
  try {
    audioContext ??= new AudioContext();
    audioContext.resume().catch(() => {});
  } catch {
    audioContext = null;
  }
}

function playCompletionSound() {
  if (settings.sound !== 'on' || !audioContext || audioContext.state !== 'running') return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0, audioContext.currentTime);
  gain.gain.linearRampToValueAtTime(.08, audioContext.currentTime + .02);
  gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .45);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + .5);
}

setInterval(refreshTimer, 200);
document.addEventListener('visibilitychange', () => {
  refreshTimer();
  orb.last = 0;
  if (!document.hidden) requestOrbFrame();
});
renderTimer();
setState('idle');
renderRecords();
applyTheme(settings.theme);
soundSelect.value = settings.sound;
