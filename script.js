(() => {
  'use strict';
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let followsSystem = true;
  let theme = systemTheme.matches ? 'dark' : 'light';
  let language = 'ko';
  try {
    const savedTheme = localStorage.getItem('ringkl-week7-theme');
    if (['light', 'dark'].includes(savedTheme)) { theme = savedTheme; followsSystem = false; }
    const savedLanguage = localStorage.getItem('ringkl-week7-language');
    if (['ko', 'en'].includes(savedLanguage)) language = savedLanguage;
  } catch (_) {}
  const requested = new URLSearchParams(location.search).get('lang');
  if (['ko', 'en'].includes(requested)) language = requested;
  const emit = changed => document.dispatchEvent(new CustomEvent('llnk:preferences', {detail: {changed, theme, language}}));
  function setTheme(value, persist = true) {
    if (!['light', 'dark'].includes(value)) return;
    theme = value;
    document.documentElement.dataset.theme = theme;
    if (persist) {
      followsSystem = false;
      try { localStorage.setItem('ringkl-week7-theme', theme); } catch (_) {}
    }
    emit('theme');
  }
  function setLanguage(value, persist = true) {
    if (!['ko', 'en'].includes(value)) return;
    language = value;
    if (persist) try { localStorage.setItem('ringkl-week7-language', language); } catch (_) {}
    emit('language');
  }
  window.llnkPreferences = {get theme() { return theme; }, get language() { return language; }, setTheme, setLanguage};
  document.documentElement.dataset.theme = theme;
  systemTheme.addEventListener('change', event => { if (followsSystem) setTheme(event.matches ? 'dark' : 'light', false); });
  window.addEventListener('storage', event => {
    if (event.key === 'ringkl-week7-theme') {
      followsSystem = !['light', 'dark'].includes(event.newValue);
      setTheme(followsSystem ? (systemTheme.matches ? 'dark' : 'light') : event.newValue, false);
    }
    if (event.key === 'ringkl-week7-language') setLanguage(event.newValue, false);
  });
})();

(() => {
  const pageBody=document.body;
  const messages = JSON.parse(document.getElementById('homeMessages').textContent);
  let language = document.documentElement.lang === 'ko' ? 'ko' : 'en';
  const t = key => messages[language][key] || key;
  let lastMessage = {value: '', isError: false};
  const form = document.getElementById('shortenForm');
  const input = document.getElementById('targetUrl');
  const submit = document.getElementById('submitButton');
  const result = document.getElementById('result');
  const link = document.getElementById('shortUrl');
  const copy = document.getElementById('copyButton');
  const copyIcon = copy.querySelector('.material-symbols-outlined');
  const message = document.getElementById('message');
  let copyResetTimer = 0;
  let retryUntil = 0;
  let retryTimer = 0;
  const settingsButton = document.getElementById('linkSettingsButton');
  const settingsDialog = document.getElementById('linkSettingsDialog');
  const optionGroups = [...settingsDialog.querySelectorAll('[data-setting]')];
  let linkOptions = {expires_in: 0, max_uses: 0};
  let draftOptions = {...linkOptions};
  const reviewDialog = document.getElementById('linkReviewDialog');
  const confirmButton = document.getElementById('confirmLink');
  const restartButton = document.getElementById('restartLink');
  const scene = document.getElementById('homeScene');
  let reviewSnapshot = null;
  let requestVersion = 0;
  let activeRequest = null;
  let flowState = 'editing';
  function setFlowState(value) {
    flowState = value;
    scene.dataset.flowState = value;
  }
  function setBusy(value) {
    submit.disabled = value;
    settingsButton.disabled = value;
    confirmButton.disabled = value;
    if (value) submit.setAttribute('aria-busy', 'true');
    else submit.removeAttribute('aria-busy');
  }
  function paintReview() {
    if (!reviewSnapshot) return;
    document.getElementById('reviewUrl').textContent = reviewSnapshot.url;
    for (const [setting, id] of [['expires_in', 'reviewExpiry'], ['max_uses', 'reviewMaxUses']]) {
      const group = optionGroups.find(element => element.dataset.setting === setting);
      document.getElementById(id).textContent = group.querySelector('[data-value="' + reviewSnapshot.options[setting] + '"]').textContent;
    }
  }
  function invalidateResult() {
    requestVersion += 1;
    if (activeRequest) activeRequest.abort();
    activeRequest = null;
    reviewSnapshot = null;
    if (reviewDialog.open) reviewDialog.close('edit');
    for (const id of ['reviewUrl', 'reviewExpiry', 'reviewMaxUses']) document.getElementById(id).textContent = '';
    window.clearTimeout(copyResetTimer);
    copyIcon.textContent = 'content_copy';
    copy.setAttribute('aria-label', t('copy'));
    copy.title = t('copy');
    result.classList.remove('show');
    link.removeAttribute('href');
    link.textContent = '';
    setBusy(false);
    setFlowState('editing');
    setMessage('');
    restartButton.hidden = !(input.value || linkOptions.expires_in || linkOptions.max_uses);
  }
  restartButton.addEventListener('click', () => {
    input.value = '';
    linkOptions = {expires_in: 0, max_uses: 0};
    draftOptions = {...linkOptions};
    invalidateResult();
    paintOptions();
    settingsButton.classList.remove('is-configured');
    updateSettingsLabel();
    restartButton.hidden = true;
    input.focus();
  });
  function finishReview() {
    reviewSnapshot = null;
    setFlowState('editing');
    if (document.body === pageBody) input.focus();
  }
  const returnToInput = () => { reviewDialog.close('edit'); finishReview(); };
  reviewDialog.addEventListener('cancel', finishReview);
  document.getElementById('closeLinkReview').addEventListener('click', returnToInput);
  document.getElementById('editLink').addEventListener('click', returnToInput);
  reviewDialog.addEventListener('close', () => {
    if (flowState !== 'review' || reviewDialog.open) return;
    reviewSnapshot = null;
    setFlowState('editing');
    if (document.body === pageBody) input.focus();
  });
  setFlowState('editing');
  function paintOptions() {
    optionGroups.forEach(group => group.querySelectorAll('[data-value]').forEach(button => {
      const selected = Number(button.dataset.value) === draftOptions[group.dataset.setting];
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }));
  }
  optionGroups.forEach(group => {
    const buttons = [...group.querySelectorAll('[data-value]')];
    buttons.forEach((button, index) => {
      button.addEventListener('click', () => {
        draftOptions[group.dataset.setting] = Number(button.dataset.value);
        paintOptions();
      });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (['ArrowRight','ArrowDown'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].click(); buttons[next].focus();
      });
    });
  });
  settingsButton.addEventListener('click', () => {
    draftOptions = {...linkOptions};
    paintOptions();
    settingsDialog.showModal();
  });
  document.getElementById('closeLinkSettings').addEventListener('click', () => settingsDialog.close());
  document.getElementById('applyLinkSettings').addEventListener('click', () => {
    const changed = Object.keys(linkOptions).some(key => linkOptions[key] !== draftOptions[key]);
    linkOptions = {...draftOptions};
    if (changed) invalidateResult();
    settingsButton.classList.toggle('is-configured', Boolean(linkOptions.expires_in || linkOptions.max_uses));
    updateSettingsLabel();
    settingsDialog.close();
  });
  settingsDialog.addEventListener('close', () => settingsButton.focus());
function updateSettingsLabel() {
    const configured = Boolean(linkOptions.expires_in || linkOptions.max_uses);
    const labels = optionGroups.map(group => group.querySelector('[data-value="' + linkOptions[group.dataset.setting] + '"]').textContent);
    settingsButton.title = t('settings') + (configured ? ': ' + labels.join(', ') : '');
    settingsButton.setAttribute('aria-label', settingsButton.title);
  }
  function translatedMessage(value) {
    if (!value) return '';
    if (messages[language][value]) return t(value);
    for (const key of Object.keys(messages.ko)) {
      if (messages.ko[key] === value || messages.en[key] === value) return t(key);
    }
    if (language === 'en') return messages.errors[value] || value;
    const original = Object.keys(messages.errors).find(key => messages.errors[key] === value);
    return original || value;
  }
  function setMessage(value, isError = false) {
    lastMessage = {value, isError};
    message.textContent = value === 'retryAfter' ? t(value).replace('{seconds}', String(Math.max(1, Math.ceil((retryUntil - Date.now()) / 1000)))) : translatedMessage(value);
    input.setAttribute('aria-invalid', String(Boolean(value) && isError && ['errorEmpty', 'errorUrl', 'errorScheme', 'errorLength', 'errorCredentials'].includes(value)));
    message.classList.toggle('is-error', Boolean(value) && isError);
  }
  function paintLanguage() {
    document.documentElement.lang = language;
    const pageUrl=new URL(location.href);
    if(pageUrl.searchParams.has('lang') && pageUrl.searchParams.get('lang')!==language){
      pageUrl.searchParams.set('lang',language);history.replaceState(history.state,'',pageUrl);
    }
    document.title = t('pageTitle');
    document.querySelector('meta[name="description"]').content = t('description');
    document.querySelector('meta[property="og:title"]').content = t('pageTitle');
    document.querySelector('meta[property="og:description"]').content = t('description');
    pageBody.querySelectorAll('[data-i18n]').forEach(element => {element.textContent = t(element.dataset.i18n);});
    for (const [name, attribute] of [['aria','aria-label'], ['title','title'], ['alt','alt']]) {
      pageBody.querySelectorAll('[data-i18n-' + name + ']').forEach(element => element.setAttribute(attribute, t(element.getAttribute('data-i18n-' + name))));
    }
    pageBody.querySelectorAll('[data-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
    updateSettingsLabel();
    paintReview();
    const copyLabel = t(copyIcon.textContent === 'check' ? 'copiedLabel' : 'copy');
    copy.setAttribute('aria-label', copyLabel); copy.title = copyLabel;
    setMessage(lastMessage.value, lastMessage.isError);
  }
  function paintTheme() {
    const dark=window.llnkPreferences.theme==='dark',button=pageBody.querySelector('#homeThemeToggle');
    button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',t(dark?'lightMode':'darkMode'));button.title=t(dark?'lightMode':'darkMode');
    button.querySelector('span').textContent=dark?'light_mode':'dark_mode';
  }
  pageBody.querySelector('#homeThemeToggle').addEventListener('click',()=>window.llnkPreferences.setTheme(window.llnkPreferences.theme==='dark'?'light':'dark'));
  pageBody.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>window.llnkPreferences.setLanguage(button.dataset.language)));
  function syncPreferences(){
    if(document.body!==pageBody){
      if(reviewDialog.open)reviewDialog.close('edit');
      if(settingsDialog.open)settingsDialog.close();
      return;
    }
    language=window.llnkPreferences.language;paintLanguage();paintTheme();
  }
  document.addEventListener('llnk:preferences',syncPreferences);
  document.addEventListener('llnk:viewchange',syncPreferences);
  syncPreferences();
  if (new URLSearchParams(location.search).has('unavailable')) setMessage('errorUnavailable', true);

  function validatedUrl() {
    const value = input.value.trim();
    if (!value) throw new Error('errorEmpty');
    if (new TextEncoder().encode(value).length > 2048) throw new Error('errorLength');
    let parsed;
    try {
      parsed = new URL(value);
    } catch (_) {
      throw new Error('errorUrl');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('errorScheme');
    }
    if (parsed.username || parsed.password) throw new Error('errorCredentials');
    return parsed.href;
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      let timeout;
      try {
        await Promise.race([
          navigator.clipboard.writeText(text),
          new Promise((_, reject) => { timeout = window.setTimeout(() => reject(new Error('errorCopy')), 1500); })
        ]);
      } finally {
        window.clearTimeout(timeout);
      }
      return;
    }
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand('copy');
    helper.remove();
    if (!copied) throw new Error('errorCopy');
  }

  function showCopiedState() {
    window.clearTimeout(copyResetTimer);
    copyIcon.textContent = 'check';
    copy.setAttribute('aria-label', t('copiedLabel'));
    copy.title = t('copiedLabel');
    copyResetTimer = window.setTimeout(() => {
      copyIcon.textContent = 'content_copy';
      copy.setAttribute('aria-label', t('copy'));
      copy.title = t('copy');
    }, 1200);
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (submit.disabled || reviewDialog.open) return;
    invalidateResult();
    restartButton.hidden = false;
    if (Date.now() < retryUntil) { setMessage('retryAfter', true); return; }
    let targetUrl;
    try {
      targetUrl = validatedUrl();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'errorUrl', true);
      input.focus();
      return;
    }
    reviewSnapshot = {url: targetUrl, options: {...linkOptions}, version: requestVersion};
    paintReview();
    setFlowState('review');
    reviewDialog.showModal();
  });

  confirmButton.addEventListener('click', async () => {
    if (flowState !== 'review' || !reviewDialog.open || !reviewSnapshot || confirmButton.disabled) return;
    const snapshot = reviewSnapshot;
    let currentUrl;
    try { currentUrl = validatedUrl(); } catch (_) {}
    if (snapshot.version !== requestVersion || snapshot.url !== currentUrl || Object.keys(linkOptions).some(key => linkOptions[key] !== snapshot.options[key])) {
      invalidateResult();
      setMessage('reviewChanged', true);
      return;
    }
    if (Date.now() < retryUntil) { setMessage('retryAfter', true); reviewDialog.close('edit'); return; }
    setFlowState('creating');
    setBusy(true);
    reviewDialog.close('confirm');
    reviewSnapshot = null;
    setMessage('processing');
    const version = requestVersion;
    const controller = new AbortController();
    activeRequest = controller;
    const requestTimeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('https://llnk.kr/api/v1/shorten.php', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({url: snapshot.url, ...snapshot.options}),
        credentials: 'omit',
        signal: controller.signal,
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (version !== requestVersion) return;
      if (response.status === 429) {
        const delay = Number(payload.retry_after || response.headers.get('Retry-After')) || 60;
        retryUntil = Date.now() + Math.min(86400, Math.max(1, delay)) * 1000;
        clearInterval(retryTimer);
        retryTimer = window.setInterval(() => {
          if (Date.now() >= retryUntil) { clearInterval(retryTimer); if (lastMessage.value === 'retryAfter') setMessage(''); }
          else if (lastMessage.value === 'retryAfter') setMessage('retryAfter', true);
        }, 1000);
        throw new Error('retryAfter');
      }
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'errorCreate');
      const shortUrl = payload.shortUrl || payload.link?.short_url;
      let parsedResult;
      try { parsedResult = new URL(shortUrl); } catch (_) { throw new Error('errorResponse'); }
      if (parsedResult.protocol !== 'https:' || parsedResult.hostname !== 'llnk.kr' || !/^\/[A-Za-z0-9]+$/.test(parsedResult.pathname)) throw new Error('errorResponse');
      link.href = parsedResult.href;
      link.textContent = parsedResult.href;
      result.classList.add('show');
      setFlowState('complete');
      setMessage('created');
      try {
        await copyText(parsedResult.href);
        if (version !== requestVersion) return;
        showCopiedState();
        setMessage('copied');
      } catch (_) {}
    } catch (error) {
      if (version !== requestVersion) return;
      setFlowState('editing');
      setMessage(error?.name === 'AbortError' ? 'errorTimeout' : error instanceof TypeError ? 'errorRequest' : error instanceof Error ? error.message : 'errorRequest', true);
    } finally {
      window.clearTimeout(requestTimeout);
      if (version === requestVersion) {
        activeRequest = null;
        setBusy(false);
      }
    }
  });

  input.addEventListener('input', invalidateResult);

  copy.addEventListener('click', async () => {
    const text = link.textContent;
    const version = requestVersion;
    if (!text || !result.classList.contains('show')) return;
    try {
      await copyText(text);
      if (version !== requestVersion) return;
      showCopiedState();
      setMessage('copied');
    } catch (_) {
      if (version === requestVersion) setMessage('errorCopy', true);
    }
  });

})();

(() => {
  'use strict';
  const pageBody=document.body;
  if (document.getElementById('llnk-atmosphere')) return;
  const layer = document.createElement('div');
  layer.id = 'llnk-atmosphere';
  layer.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  layer.appendChild(canvas);
  document.body.prepend(layer);
  const context = canvas.getContext('2d', {alpha: true});
  if (!context) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(pointer: fine)');
  let width = 0;
  let height = 0;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let pointerX = 0;
  let pointerY = 0;
  let offsetX = 0;
  let offsetY = 0;
  let resizeTimer = 0;
  let palette={};
  function readPalette(){const style=getComputedStyle(document.documentElement);palette={orbit:style.getPropertyValue('--orbit-rgb').trim(),muted:style.getPropertyValue('--orbit-muted-rgb').trim(),star:style.getPropertyValue('--star-rgb').trim(),accent:style.getPropertyValue('--brand').trim()};}
  let seed = 73129;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars = Array.from({length: 95}, () => ({
    x: random(), y: random(), radius: .35 + random() * .8,
    opacity: .12 + random() * .4, phase: random() * Math.PI * 2
  }));
  const rings = Array.from({length: 10}, (_, index) => ({
    scale: .76 + index * .038,
    phase: index * .62,
    opacity: index === 2 || index === 7 ? .38 : .045 + random() * .05
  }));
  const particles = Array.from({length: 16}, (_, index) => ({
    ring: index % rings.length, phase: random() * Math.PI * 2,
    speed: .018 + random() * .016, radius: index % 4 === 0 ? 1.7 : .8
  }));

  function point(angle, ring, time) {
    const radiusX = Math.max(width * .51, Math.min(width * .85, height * .68));
    const radiusY = height * (width < 620 ? .34 : .36);
    const wave = Math.sin(angle * 3 + ring.phase + time * .07) * .012;
    const x = Math.cos(angle) * radiusX * (ring.scale + wave);
    const y = Math.sin(angle) * radiusY * (ring.scale + wave);
    const tilt = -.29 + Math.sin(time * .025) * .025;
    return {
      x: width * .5 + x * Math.cos(tilt) - y * Math.sin(tilt) + offsetX,
      y: height * .54 + x * Math.sin(tilt) + y * Math.cos(tilt) + offsetY
    };
  }

  function draw(time) {
    context.clearRect(0, 0, width, height);
    for (const star of stars) {
      const shimmer = .8 + Math.sin(time * .25 + star.phase) * .2;
      context.fillStyle = `rgba(${palette.star},${star.opacity * shimmer})`;
      context.beginPath();
      context.arc(star.x * width + offsetX * .3, star.y * height + offsetY * .3, star.radius, 0, Math.PI * 2);
      context.fill();
    }

    for (const ring of rings) {
      const gradient = context.createLinearGradient(width * .1, height, width * .9, 0);
      gradient.addColorStop(0, `rgba(${palette.orbit},${ring.opacity * .22})`);
      gradient.addColorStop(.24, `rgba(${palette.orbit},${ring.opacity})`);
      gradient.addColorStop(.48, `rgba(${palette.muted},${ring.opacity * .2})`);
      gradient.addColorStop(.78, `rgba(${palette.muted},${ring.opacity * .65})`);
      gradient.addColorStop(1, `rgba(${palette.orbit},0)`);
      context.strokeStyle = gradient;
      context.lineWidth = .8;
      context.beginPath();
      for (let i = 0; i <= 180; i++) {
        const p = point(i / 180 * Math.PI * 2, ring, time);
        if (i === 0) context.moveTo(p.x, p.y);
        else context.lineTo(p.x, p.y);
      }
      context.stroke();
    }

    for (const particle of particles) {
      const ring = rings[particle.ring];
      const angle = particle.phase + time * particle.speed;
      const p = point(angle, ring, time);
      if (particle.radius > 1) {
        const glow = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, 10);
        glow.addColorStop(0, `rgba(${palette.orbit},.12)`);
        glow.addColorStop(1, `rgba(${palette.orbit},0)`);
        context.fillStyle = glow;
        context.fillRect(p.x - 10, p.y - 10, 20, 20);
        for (let i = 0; i < 18; i++) {
          const a = point(angle - i * .009, ring, time);
          const b = point(angle - (i + 1) * .009, ring, time);
          context.strokeStyle = `rgba(${palette.orbit},${.38 * (1 - i / 18)})`;
          context.lineWidth = 1;
          context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
        }
      }
      context.fillStyle = particle.radius > 1 ? palette.accent : `rgba(${palette.orbit},.5)`;
      context.beginPath();context.arc(p.x, p.y, particle.radius, 0, Math.PI * 2);context.fill();
    }
  }

  function tick(now) {
    frame = 0;
    if (document.body!==pageBody || document.hidden || reducedMotion.matches) return;
    if (!lastTime) lastTime = now;
    const delta = now - lastTime;
    if (delta >= 32) {
      elapsed += Math.min(delta, 80) / 1000;
      lastTime = now;
      offsetX += (pointerX - offsetX) * .055;
      offsetY += (pointerY - offsetY) * .055;
      draw(elapsed);
    }
    frame = requestAnimationFrame(tick);
  }

  function resume() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    if (document.body!==pageBody || document.hidden) return;
    if (reducedMotion.matches) { offsetX = 0; offsetY = 0; draw(0); }
    else frame = requestAnimationFrame(tick);
  }

  function resize() {
    if(document.body!==pageBody)return;
    readPalette();
    width = innerWidth;
    height = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, width < 620 ? 1.5 : 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(reducedMotion.matches ? 0 : elapsed);
  }

  window.addEventListener('pointermove', event => {
    if (document.body!==pageBody || !finePointer.matches || reducedMotion.matches || event.pointerType === 'touch') return;
    pointerX = (event.clientX / width - .5) * 20;
    pointerY = (event.clientY / height - .5) * 14;
  }, {passive: true});
  document.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }, {passive: true});
  document.addEventListener('visibilitychange', resume);
  reducedMotion.addEventListener('change', resume);
  document.addEventListener('llnk:preferences',()=>{if(document.body===pageBody){readPalette();draw(elapsed);}});
  document.addEventListener('llnk:viewchange',()=>{if(document.body===pageBody)resize();resume();});
  resize();
  resume();
})();
