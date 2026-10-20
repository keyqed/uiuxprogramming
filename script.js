(() => {
  'use strict';
  if (window.llnkPreferences) return;
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let followsSystem = true;
  let theme = systemTheme.matches ? 'dark' : 'light';
  let language = 'ko';
  try {
    const savedTheme = localStorage.getItem('ringkl-midterm-theme');
    if (['light', 'dark'].includes(savedTheme)) { theme = savedTheme; followsSystem = false; }
    const savedLanguage = localStorage.getItem('ringkl-midterm-language');
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
      try { localStorage.setItem('ringkl-midterm-theme', theme); } catch (_) {}
    }
    emit('theme');
  }
  function setLanguage(value, persist = true) {
    if (!['ko', 'en'].includes(value)) return;
    language = value;
    if (persist) try { localStorage.setItem('ringkl-midterm-language', language); } catch (_) {}
    emit('language');
  }
  window.llnkPreferences = {get theme() { return theme; }, get language() { return language; }, setTheme, setLanguage, applyTheme: () => { document.documentElement.dataset.theme = theme; }};
  document.documentElement.dataset.theme = theme;
  systemTheme.addEventListener('change', event => { if (followsSystem) setTheme(event.matches ? 'dark' : 'light', false); });
  window.addEventListener('storage', event => {
    if (event.key === 'ringkl-midterm-theme') {
      followsSystem = !['light', 'dark'].includes(event.newValue);
      setTheme(followsSystem ? (systemTheme.matches ? 'dark' : 'light') : event.newValue, false);
    }
    if (event.key === 'ringkl-midterm-language') setLanguage(event.newValue, false);
  });
})();

(() => {
  'use strict';
  if (window.ringklDirectoryStore) return;
  const storageKey = 'ringkl-midterm-directory-v1';
  const day = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (_) {}
    return {};
  }
  async function request(payload, boot) {
    const state = read();
    state.votes ||= {}; state.visits ||= {}; state.reports ||= [];
    if (payload) {
      if (['vote', 'visit'].includes(payload.action)) {
        if (!boot.catalog.services.some(service => service.id === payload.id)) throw new Error('request_error');
        if (payload.action === 'vote') state.votes[payload.id] = {active: Boolean(payload.active), day: day()};
        else state.visits[payload.id] = day();
      } else if (payload.action === 'report') {
        let url;
        try {url = new URL(payload.url);} catch (_) {}
        if (!payload.name.trim() || !payload.note.trim() || !url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          const error = new Error('report_invalid'); error.code = 422; throw error;
        }
        if (!state.reports.some(report => report.request_id === payload.request_id)) state.reports.push({...payload, saved_at: new Date().toISOString()});
      } else throw new Error('request_error');
      try {localStorage.setItem(storageKey, JSON.stringify(state));} catch (_) {throw new Error('storage_unavailable');}
    }
    const metrics = {};
    for (const service of boot.catalog.services) {
      const vote = state.votes[service.id], active = Boolean(vote?.active && vote.day === day());
      metrics[service.id] = {flames: (boot.metrics[service.id]?.flames || 0) + Number(active), liked: active, weekly: Number(state.visits[service.id] === day())};
    }
    return {ok: true, metrics, day: day()};
  }
  window.ringklDirectoryStore = {request};
})();

(() => {
  'use strict';
  if (window.llnkNavigation) return;
  const homeUrl = new URL('./', document.currentScript.src), homePath = homeUrl.pathname, directoryPath = homePath + 'shortener/';
  const route = url => [homePath, homePath + 'index.html'].includes(url.pathname) ? 'home' : [directoryPath, directoryPath + 'index.html', directoryPath + 'en.html'].includes(url.pathname) ? 'directory' : null;
  const pages = new Map(), pending = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let current, busy = false, wheelTotal = 0, lastWheel = 0, touchStart = null, queuedPop = null, coffeeNodes = [];
  const attributes = element => [...element.attributes].map(({name,value}) => [name,value]);
  const key = (view,language=window.llnkPreferences.language) => view==='home' ? view : view + ':' + language;
  function capture(page) {
    page.head = [...document.head.childNodes];
    page.attributes = attributes(document.documentElement).filter(([name]) => name !== 'data-navigation-direction');
    page.url = location.href;
    page.scroll = window.scrollY;
  }
  function notify() { document.dispatchEvent(new CustomEvent('llnk:viewchange')); }
  function loadScript(source) {
    return new Promise((resolve,reject) => {
      const script = document.createElement('script');
      for (const attr of source.attributes) if (!['defer','async'].includes(attr.name)) script.setAttribute(attr.name,attr.value);
      script.onload = resolve; script.onerror = () => reject(new Error('Script unavailable'));
      source.replaceWith(script);
    });
  }
  async function prepare(url) {
    const view = route(url), cacheKey = key(view);
    if (pages.has(cacheKey)) return pages.get(cacheKey);
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    const task = (async () => {
      const requestUrl = new URL(url);
      requestUrl.pathname = view === 'directory' ? directoryPath + (window.llnkPreferences.language === 'en' ? 'en.html' : 'index.html') : homePath + 'index.html';
      const response = await fetch(requestUrl,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)});
      if (!response.ok || new URL(response.url).origin !== location.origin) throw new Error('Page unavailable');
      const parsed = new DOMParser().parseFromString(await response.text(),'text/html');
      for (const element of parsed.querySelectorAll('link[href], script[src], img[src], a[href]')) {
        const attr = element.hasAttribute('src') ? 'src' : 'href';
        element.setAttribute(attr, new URL(element.getAttribute(attr), requestUrl).href);
      }
      if (parsed.body.dataset.page !== view) throw new Error('Unexpected page');
      const preload = [...parsed.querySelectorAll('link[rel="stylesheet"]')].map(source => new Promise((resolve,reject) => {
        const link = source.cloneNode();link.media = 'not all';
        const timeout=setTimeout(() => finish(new Error('Styles unavailable')),12000);
        const finish = error => {clearTimeout(timeout);link.remove();error && new URL(link.href).origin===location.origin ? reject(error) : resolve();};
        link.onload = () => finish();link.onerror = () => finish(new Error('Styles unavailable'));
        document.head.append(link);
      }));
      await Promise.all(preload);
      const page = {view,body:parsed.body,head:[...parsed.head.childNodes],attributes:attributes(parsed.documentElement),url:url.href,scroll:0,initialized:false};
      pages.set(cacheKey,page);return page;
    })().finally(() => pending.delete(cacheKey));
    pending.set(cacheKey,task);return task;
  }
  async function show(page,url) {
    const coffee = document.getElementById('bmc-wbtn');
    if (coffee) coffeeNodes = [document.getElementById('bmc-iframe')?.parentElement,coffee].filter(Boolean);
    const stylesReady = page.head.filter(node => node.nodeType === 1 && node.matches('link[rel="stylesheet"]')).map(link => new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => finish(new Error('Styles unavailable')), 12000);
      const finish = error => {window.clearTimeout(timer); error ? reject(error) : resolve();};
      link.addEventListener('load', () => finish(), {once:true});
      link.addEventListener('error', () => finish(new Error('Styles unavailable')), {once:true});
    }));
    document.head.replaceChildren(...page.head);
    await Promise.all(stylesReady);
    for (const attr of [...document.documentElement.attributes]) document.documentElement.removeAttribute(attr.name);
    for (const [name,value] of page.attributes) document.documentElement.setAttribute(name,value);
    if (page.view === 'home') for (const node of coffeeNodes) page.body.append(node);
    document.body.replaceWith(page.body);
    window.llnkPreferences.applyTheme();
    if (!page.initialized) {
      const scripts = [...document.querySelectorAll('script[src]')].filter(script => {
        const src = new URL(script.src);
        return src.origin === location.origin && src.pathname === new URL('script.js', homeUrl).pathname;
      });
      for (const script of scripts) await loadScript(script);
      page.initialized = true;
    }
    window.scrollTo({top:page.view === 'home' ? 0 : page.scroll,behavior:'instant'});
    notify();
  }
  async function navigate(input,{pop=false,languageChange=false}={}) {
    const url = new URL(input,location.href), view = route(url);
    if(url.searchParams.has('lang'))url.searchParams.set('lang',window.llnkPreferences.language);
    if (busy) {if(pop)queuedPop=url.href;return;}
    if (url.origin !== location.origin || !view || (view === current.view && !languageChange)) return;
    busy = true;document.documentElement.setAttribute('aria-busy','true');
    const previous = current, direction = view === 'directory' ? 'down' : 'up';
    try {
      const next = await prepare(url);
      document.documentElement.removeAttribute('aria-busy');
      const previousUrl=previous.url;
      capture(previous);
      if (pop) previous.url=previousUrl;
      const update = async () => {
        if(languageChange)history.replaceState(history.state,'',url);
        else if (!pop) history.pushState({llnkView:view},'',view === 'directory' && next.initialized ? next.url : url);
        current=next;await show(next,url);
        document.documentElement.dataset.navigationDirection = direction;
      };
      document.documentElement.dataset.navigationDirection = direction;
      if (document.startViewTransition && !reducedMotion.matches && !languageChange) {
        const transition = document.startViewTransition(update);
        await transition.finished;
      } else {
        await update();
        if (!reducedMotion.matches && !languageChange) await document.body.animate([{transform:`translateY(${view === 'directory' ? 40 : -40}px)`,opacity:0},{transform:'none',opacity:1}],{duration:300,easing:'ease-out'}).finished;
      }
      const focus = document.querySelector('main');
      if (focus) {focus.tabIndex = -1;focus.focus({preventScroll:true});}
    } catch (_) {
      history.replaceState({llnkView:previous.view},'',previous.url);
      if (document.body !== previous.body) await show(previous,new URL(previous.url));
      current=previous;
      const message = document.createElement('p');message.className='navigation-error';message.role='status';
      message.textContent=document.documentElement.lang === 'ko' ? '화면을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' : 'Unable to load this page. Please try again.';
      document.body.append(message);setTimeout(() => message.remove(),5000);
    } finally {
      delete document.documentElement.dataset.navigationDirection;document.documentElement.removeAttribute('aria-busy');busy=false;wheelTotal=0;
      if(queuedPop){const destination=queuedPop;queuedPop=null;navigate(destination,{pop:true});}
    }
  }
  function available(target) {
    return !!current && !busy && !document.querySelector('dialog[open]') && !document.getElementById('submitButton')?.disabled
      && !(target instanceof Element && target.closest('input,textarea,select,[contenteditable],dialog'));
  }
  window.llnkNavigation = {navigate,remember:()=>{if(current)current.url=location.href;}};
  function start() {
    current={view:document.body.dataset.page,body:document.body,initialized:true};capture(current);pages.set(key(current.view,document.documentElement.lang),current);
    history.scrollRestoration='manual';history.replaceState({...history.state,llnkView:current.view},'',location.href);
    document.addEventListener('llnk:preferences',event=>{
      if(event.detail.changed!=='language' || current.view!=='directory')return;
      const url=new URL(location.href);url.searchParams.set('lang',event.detail.language);
      document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
      navigate(url,{languageChange:true});
    });
    document.addEventListener('click',event => {
      const link=event.target instanceof Element ? event.target.closest('[data-page-link]') : null;
      if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();navigate(link.href);
    });
    window.addEventListener('wheel',event => {
      if(busy){if(!event.ctrlKey)event.preventDefault();return;}
      if (!available(event.target) || event.ctrlKey || Math.abs(event.deltaX)>Math.abs(event.deltaY)) return;
      const forward=current.view==='home' && event.deltaY>0;
      const backward=current.view==='directory' && window.scrollY<=1 && event.deltaY<0;
      if (!forward && !backward) {wheelTotal=0;lastWheel=performance.now();return;}
      event.preventDefault();const now=performance.now();if (now-lastWheel>220) wheelTotal=0;
      lastWheel=now;wheelTotal+=Math.abs(event.deltaY)*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
      if (wheelTotal>=60) navigate(forward?directoryPath:homePath);
    },{passive:false});
    window.addEventListener('touchstart',event => {touchStart=available(event.target) && event.touches.length===1 ? {x:event.touches[0].clientX,y:event.touches[0].clientY,atTop:window.scrollY<=1} : null;},{passive:true});
    window.addEventListener('touchmove',event=>{
      if(!touchStart || !available(event.target) || !touchStart.atTop || current.view!=='directory')return;
      const touch=event.touches[0],dy=touch.clientY-touchStart.y;
      if(dy>8 && dy>Math.abs(touch.clientX-touchStart.x))event.preventDefault();
    },{passive:false});
    window.addEventListener('touchend',event => {
      if (!touchStart || !available(event.target)) return;
      const touch=event.changedTouches[0],dy=touchStart.y-touch.clientY,dx=touchStart.x-touch.clientX,atTop=touchStart.atTop;touchStart=null;
      if (current.view==='home' && dy>60 && dy>Math.abs(dx)) navigate(directoryPath);
      if (current.view==='directory' && atTop && window.scrollY<=1 && dy< -60 && -dy>Math.abs(dx)) navigate(homePath);
    },{passive:true});
    document.addEventListener('keydown',event => {
      if (!available(event.target) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('button,a')) return;
      if (current.view==='home' && ['ArrowDown','PageDown',' '].includes(event.key)) {event.preventDefault();navigate(directoryPath);}
      if (current.view==='directory' && window.scrollY<=1 && ['ArrowUp','PageUp'].includes(event.key)) {event.preventDefault();navigate(homePath);}
    });
    window.addEventListener('popstate',() => {const view=route(new URL(location.href));if (view && view!==current.view) navigate(location.href,{pop:true});});
    if (current.view === 'directory' && document.documentElement.lang !== window.llnkPreferences.language) navigate(location.href, {languageChange:true});
    const warm = () => prepare(new URL(current.view==='home'?directoryPath:homePath,location.href)).catch(() => {});
    if ('requestIdleCallback' in window) requestIdleCallback(warm,{timeout:1500});else setTimeout(warm,500);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();

(() => {
  if (document.body.dataset.page !== 'home') return;
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
  if (document.body.dataset.page !== 'home') return;
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
  function readPalette(){const style=getComputedStyle(document.documentElement);palette={orbit:style.getPropertyValue('--orbit-rgb').trim() || '191,255,0',muted:style.getPropertyValue('--orbit-muted-rgb').trim() || '97,99,110',star:style.getPropertyValue('--star-rgb').trim() || '251,251,251',accent:style.getPropertyValue('--brand').trim()};}
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

(async () => {
  'use strict';
  if (document.body.dataset.page !== 'directory') return;
  const pageBody=document.body;
  const activeListen=(target,type,handler,options)=>target.addEventListener(type,event=>{if(document.body===pageBody) handler(event);},options);
  const boot=JSON.parse(document.getElementById('directoryBoot').textContent);
  const text=boot.text,lang=boot.language,services=boot.catalog.services;
  const $=id=>pageBody.querySelector(`#${id}`);
  const t=key=>text[key] || key;
  const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<span class="icon" aria-hidden="true">${escape(name)}</span>`;
  const statusIcons=boot.statusIcons || {pricing:{free:'money_off',freemium:'price_change',paid:'payments'},login:{none:'person_off',optional:'account_circle',required:'login'},ads:{no:'close',yes:'check',plan:'help'},region:{global:'public',restricted:'public_off',selfhost:'dns'}};
  const featureIcons={api:'code',analytics:'monitoring',qr:'qr_code_2','custom-domain':'language',expiry:'timer',password:'lock',selfhost:'dns'};
  function indicator(glyph,caption,extra='') {
    return `<span class="fact-indicator ${extra}" role="img" tabindex="0" aria-label="${escape(caption)}" data-tip="${escape(caption)}">${icon(glyph)}</span>`;
  }
  function status(kind,value,label) {
    return statusIcons[kind]?.[value]?indicator(statusIcons[kind][value],t(label)+': '+t(kind+'_'+value)):'';
  }
  const defaults=()=>({pricing:'',login:'',siteAds:'',redirectAds:'',region:'',language:'',features:[]});
  const allowedFeatures=['api','analytics','qr','custom-domain','expiry','password','selfhost'];
  const factTooltip=document.createElement('div');
  factTooltip.id='factTooltip';factTooltip.className='fact-tooltip ringcl-box';factTooltip.role='tooltip';factTooltip.hidden=true;document.body.append(factTooltip);
  let activeFactTip=null;
  function hideFactTooltip() {
    if (activeFactTip) {activeFactTip.removeAttribute('aria-describedby');activeFactTip.classList.remove('tip-open');}
    activeFactTip=null;factTooltip.hidden=true;
  }
  function showFactTooltip(tip) {
    if (!tip.isConnected) return;
    if (activeFactTip!==tip) hideFactTooltip();
    activeFactTip=tip;factTooltip.textContent=tip.dataset.tip;factTooltip.hidden=false;tip.setAttribute('aria-describedby',factTooltip.id);
    const anchor=tip.getBoundingClientRect(),bubble=factTooltip.getBoundingClientRect();
    const floor=pageBody.querySelector('.directory-sticky').getBoundingClientRect().bottom+8;
    const maxTop=Math.max(12,window.innerHeight-bubble.height-12);
    let top=anchor.top-bubble.height-8;
    if (top<floor) top=anchor.bottom+8;
    if (top>maxTop) top=anchor.top-bubble.height-8;
    factTooltip.style.top=Math.min(Math.max(top,Math.min(floor,maxTop)),maxTop)+'px';
    factTooltip.style.left=Math.max(12,Math.min(anchor.left+(anchor.width-bubble.width)/2,window.innerWidth-bubble.width-12))+'px';
  }
  function toggleFactTooltip(tip) {if (tip.classList.toggle('tip-open')) showFactTooltip(tip);else hideFactTooltip();}
  const categories=['all','simple','manage','marketing','developer','earning'];
  const choiceIcons={sort:{flames:'local_fire_department',name:'sort_by_alpha'},category:{all:'apps',simple:'bolt',manage:'link',marketing:'monitoring',developer:'code',earning:'payments'}};
  const sortLabels={flames:'flames',name:'alphabetical'};
  const params=new URL(location.href).searchParams;
  const state={query:(params.get('q') || '').slice(0,80),category:categories.includes(params.get('category'))?params.get('category'):'all',sort:['flames','name'].includes(params.get('sort'))?params.get('sort'):'flames',filters:defaults(),visible:12};
  let visibleServices=[],loadFrame=0;
  for (const key of Object.keys(state.filters)) if (key!=='features') state.filters[key]=params.get(key)==='unknown'?'':params.get(key) || '';
  state.filters.features=(params.get('features') || '').split(',').filter(key=>allowedFeatures.includes(key));
  const restoredMetrics = await api();
  let metricDay=restoredMetrics.day,metrics=restoredMetrics.metrics,snapshot=JSON.parse(JSON.stringify(metrics)),toastTimer;
  const busy=new Set();
  const getService=id=>services.find(service=>service.id===id);
  const localized=value=>typeof value==='object'?(value[lang] || value.en || ''):value;
  const metric=id=>metrics[id] || {weekly:0,flames:0,liked:false};
  const savedMetric=id=>snapshot[id] || {weekly:0,flames:0};
  const filterLabels={pricing:'pricing',login:'login',siteAds:'siteAds',redirectAds:'redirectAds',region:'region',language:'languages'};
  const filterValue=(key,value)=>key==='language'?value:t((key==='pricing'?'pricing_':key==='login'?'login_':key==='region'?'region_':'ads_')+value);
  function toast(message) {
    clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;
    toastTimer=setTimeout(()=>$('toast').hidden=true,3500);
  }
  function updateUrl() {
    const url=new URL(location.href);
    for (const key of ['q','category','sort',...Object.keys(state.filters)]) url.searchParams.delete(key);
    if (state.query) url.searchParams.set('q',state.query);
    if (state.category!=='all') url.searchParams.set('category',state.category);
    if (state.sort!=='flames') url.searchParams.set('sort',state.sort);
    for (const [key,value] of Object.entries(state.filters)) if (Array.isArray(value)?value.length:value) url.searchParams.set(key,Array.isArray(value)?value.join(','):value);
    history.replaceState(history.state,'',url);window.llnkNavigation?.remember();
  }
  function rankMap() {
    const key='flames';
    const sorted=[...services].sort((a,b)=>savedMetric(b.id)[key]-savedMetric(a.id)[key] || a.name.localeCompare(b.name,'en'));
    const totals={};
    for (const service of sorted) {const count=savedMetric(service.id)[key];if (count>0) totals[count]=(totals[count] || 0)+1;}
    const ranks={};
    sorted.forEach((service,index)=>{const count=savedMetric(service.id)[key];if (count>0 && totals[count]===1) ranks[service.id]=index+1;});
    return ranks;
  }
  function matches(service,filters=state.filters) {
    const query=state.query.trim().toLocaleLowerCase();
    if (query && ![service.name,service.domain,localized(service.description),...service.features.map(key=>t('feature_'+key))].join(' ').toLocaleLowerCase().includes(query)) return false;
    if (state.category!=='all' && !service.categories.includes(state.category)) return false;
    const f=filters;
    if (f.pricing && f.pricing!==service.pricing) return false;
    if (f.login==='no-account'?!['none','optional'].includes(service.login):(f.login && f.login!==service.login)) return false;
    if (f.siteAds && f.siteAds!==service.site_ads) return false;
    if (f.redirectAds && f.redirectAds!==service.redirect_ads) return false;
    if (f.region && f.region!==service.region) return false;
    if (f.language && !service.languages.includes(f.language)) return false;
    return f.features.every(feature=>service.features.includes(feature));
  }
  function voteButton(service) {
    const count=metric(service.id);
    return `<button type="button" class="vote-button" data-vote="${escape(service.id)}" aria-pressed="${count.liked}" aria-label="${escape(service.name+' '+t(count.liked?'unrecommend':'recommend'))}">${icon('local_fire_department')}<span>${count.flames}</span></button>`;
  }
  function visitButton(service,showLabel=false) {
    return `<a class="button visit-button ${showLabel?'detail-visit':'icon-button'}" data-visit="${escape(service.id)}" href="${escape(service.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escape(service.name+' '+t('visit'))}"${showLabel?'':` title="${escape(t('visit'))}"`}>${icon('north_east')}${showLabel?`<span>${escape(t('visit'))}</span>`:''}</a>`;
  }
  function detailValue(glyph,label,extra='') {
    return `<span class="detail-value ${extra}">${glyph?icon(glyph):''}<span>${escape(label)}</span></span>`;
  }
  function card(service,ranks) {
    const rank=ranks[service.id];
    const fact=(key,label,base,cls)=>service[key]!=='unknown'?`<span class="row-fact ${cls}" data-label="${escape(t(label))}">${status(key==='redirect_ads'?'ads':key,service[key],label)}</span>`:`<span class="row-fact ${cls}" aria-hidden="true"></span>`;
    return `<li class="service-row" data-id="${escape(service.id)}"><div class="row-rank">${rank?`<span>${rank}</span>`:icon('link')}</div><div class="row-brand"><a class="service-name" data-details="${escape(service.id)}" href="?service=${escape(service.id)}">${escape(service.name)}</a><span class="service-domain">${escape(service.domain)}</span></div><div class="row-facts">${fact('pricing','pricing','pricing_','fact-pricing')}${fact('login','login','login_','fact-login')}${fact('redirect_ads','adsShort','ads_','fact-ads')}</div>${voteButton(service)}${visitButton(service)}</li>`;
  }
  function renderFilters() {
    const f=state.filters,entries=[];
    for (const [key,value] of Object.entries(f)) {
      if (key==='features') {for (const feature of value) entries.push({key,value:feature,label:t('feature_'+feature)});}
      else if (value) entries.push({key,value,label:t(filterLabels[key])+': '+filterValue(key,value)});
    }
    $('filterCount').textContent=entries.length;$('filterCount').hidden=!entries.length;$('filterToggle').classList.toggle('is-applied',!!entries.length);
    const represented=new Set();
    if (f.login==='no-account') represented.add('login');
    if (f.pricing==='free') represented.add('pricing');
    if (f.siteAds==='no' && f.redirectAds==='no') {represented.add('siteAds');represented.add('redirectAds');}
    const glyphs={pricing:'payments',login:'person',siteAds:'web',redirectAds:'ad_units',region:'public',language:'translate',features:'check'};
    const extra=entries.filter(entry=>!represented.has(entry.key));
    $('activeFilters').hidden=!entries.length;
    $('activeFilters').innerHTML=extra.map(entry=>`<button type="button" class="is-applied" data-remove-filter="${escape(entry.key)}" data-value="${escape(entry.value)}" title="${escape(entry.label)}" aria-label="${escape(entry.label+' '+t('unselect'))}">${icon(entry.key==='features'?featureIcons[entry.value]:glyphs[entry.key])}${escape(entry.key==='features'?entry.label:filterValue(entry.key,entry.value))}${icon('close')}</button>`).join('')+(entries.length?`<button type="button" class="icon-button reset-filters" data-reset-filters aria-label="${escape(t('reset'))}" title="${escape(t('reset'))}">${icon('filter_alt_off')}</button>`:'');
    for (const button of pageBody.querySelectorAll('[data-quick]')) button.setAttribute('aria-pressed',String(button.dataset.quick==='login'?f.login==='no-account':button.dataset.quick==='free'?f.pricing==='free':f.siteAds==='no' && f.redirectAds==='no'));
  }
  function render() {
    hideFactTooltip();
    const ranks=rankMap();let list=services.filter(service=>matches(service));
    list.sort((a,b)=>{
      if (state.sort==='flames') return savedMetric(b.id).flames-savedMetric(a.id).flames || a.name.localeCompare(b.name,'en');
      return a.name.localeCompare(b.name,'en');
    });
    visibleServices=list;
    $('serviceGrid').innerHTML=list.slice(0,state.visible).map(service=>card(service,ranks)).join('');
    $('emptyState').hidden=!!list.length;$('resultCount').textContent=list.length;
    $('resultsTitle').firstChild.textContent=t(state.query || state.category!=='all' || Object.entries(state.filters).some(([key,value])=>key==='features'?value.length:value)?'results':'allServices')+' ';
    updatePagination();
    $('clearSearch').hidden=!state.query;
    for (const button of pageBody.querySelectorAll('.category-tabs [data-category]')) button.setAttribute('aria-pressed',String(button.dataset.category===state.category));
    renderChoices();renderFilters();updateVotes();updateUrl();
    queueAutoLoad();
  }
  function updatePagination() {
    const total=visibleServices.length;
    $('loadSentinel').hidden=state.visible>=total;
    $('visibleCount').textContent=total?`${Math.min(state.visible,total)} / ${total}`:'';
  }
  function loadNextPage() {
    if(document.body!==pageBody || $('loadSentinel').hidden)return;
    const previous=$('serviceGrid').children.length;
    state.visible=Math.min(state.visible+12,visibleServices.length);
    const ranks=rankMap();
    $('serviceGrid').insertAdjacentHTML('beforeend',visibleServices.slice(previous,state.visible).map(service=>card(service,ranks)).join(''));
    updatePagination();updateVotes();
    queueAutoLoad();
  }
  function queueAutoLoad() {
    if(loadFrame)return;
    loadFrame=requestAnimationFrame(()=>{
      loadFrame=0;
      if(document.body!==pageBody || $('loadSentinel').hidden || pageBody.querySelector('dialog[open]') || document.documentElement.hasAttribute('data-navigation-direction'))return;
      const edge=$('loadSentinel').getBoundingClientRect();
      if(edge.top<=window.innerHeight+240 && edge.bottom>=0)loadNextPage();
    });
  }
  function choiceOptions(control) {return [...control.querySelectorAll('.choice-menu [role=option]')];}
  function renderChoices() {
    for (const control of pageBody.querySelectorAll('.choice-control[data-choice]')) {
      if (control.dataset.choice==='filter') continue;
      const kind=control.dataset.choice,value=state[kind];
      const label=t(kind==='sort'?sortLabels[value]:value),toggle=control.querySelector('[data-choice-toggle]');
      control.querySelector('[data-choice-label]').textContent=label;
      toggle.setAttribute('aria-label',t(kind==='sort'?'sort':'category')+': '+label);toggle.title=label;
      control.querySelector('.choice-symbol').textContent=choiceIcons[kind][value];
      for (const option of choiceOptions(control)) {
        const selected=option.dataset[kind]===value;
        option.setAttribute('aria-selected',String(selected));option.tabIndex=selected?0:-1;
      }
    }
  }
  function closeChoice(control,restoreFocus=false) {
    const menu=control.querySelector('.choice-menu');
    if (menu.hidePopover && menu.matches(':popover-open')) menu.hidePopover();
    menu.hidden=true;
    const toggle=control.querySelector('[data-choice-toggle]');toggle.setAttribute('aria-expanded','false');
    if (restoreFocus) toggle.focus({preventScroll:true});
  }
  function closeChoices(except=null) {
    for (const control of pageBody.querySelectorAll('.choice-control[data-choice]')) if (control!==except) closeChoice(control);
  }
  function focusChoice(control,index) {
    const options=choiceOptions(control);if (!options.length) return;
    const next=(index+options.length)%options.length;
    options.forEach((option,position)=>{option.tabIndex=position===next?0:-1;});
    options[next].focus({preventScroll:true});
    if (control.dataset.choice==='filter') {
      const menu=control.querySelector('.choice-menu'),edge=menu.getBoundingClientRect(),item=options[next].getBoundingClientRect();
      if (item.top<edge.top+10) menu.scrollTop-=edge.top+10-item.top;
      else if (item.bottom>edge.bottom-10) menu.scrollTop+=item.bottom-edge.bottom+10;
    }
  }
  function openChoice(control,index=null) {
    closeChoices(control);
    control.querySelector('.choice-menu').hidden=false;
    control.querySelector('[data-choice-toggle]').setAttribute('aria-expanded','true');
    if (control.dataset.choice==='filter') {
      const menu=control.querySelector('.choice-menu');
      if (menu.showPopover) menu.showPopover();
      positionFilterChoice(control);
    }
    const options=choiceOptions(control),selected=options.findIndex(option=>option.getAttribute('aria-selected')==='true');
    focusChoice(control,index===null?Math.max(0,selected):index);
  }
  function positionFilterChoice(control) {
    const menu=control.querySelector('.choice-menu'),anchor=control.querySelector('[data-choice-toggle]').getBoundingClientRect();
    const width=Math.min(anchor.width,window.innerWidth-24);
    menu.style.width=width+'px';menu.style.maxHeight='280px';
    const height=menu.getBoundingClientRect().height,below=window.innerHeight-anchor.bottom-22,above=anchor.top-22;
    const upward=below<Math.min(height,160) && above>below;
    menu.style.maxHeight=Math.max(60,Math.min(280,upward?above:below))+'px';
    menu.style.left=Math.max(12,Math.min(anchor.left,window.innerWidth-width-12))+'px';
    menu.style.top=(upward?Math.max(12,anchor.top-menu.getBoundingClientRect().height-10):anchor.bottom+10)+'px';
  }
  function enhanceFilterChoices() {
    for (const select of $('filterForm').querySelectorAll('select')) {
      const control=select.closest('.select-field'),label=control.closest('.filter-field').querySelector('label');
      const toggleId=select.id+'-toggle',menuId=select.id+'-menu';
      control.classList.add('choice-control','filter-choice');control.dataset.choice='filter';
      control.insertAdjacentHTML('beforeend',`<button type="button" id="${escape(toggleId)}" class="choice-trigger" data-choice-toggle aria-haspopup="listbox" aria-expanded="false" aria-controls="${escape(menuId)}"><span data-choice-label></span>${icon('expand_more')}</button><div id="${escape(menuId)}" class="choice-menu ringcl-box" role="listbox" aria-label="${escape(label.textContent)}" hidden>${[...select.options].map(option=>`<button type="button" role="option" data-filter-value="${escape(option.value)}" aria-selected="false" tabindex="-1"><span>${escape(option.textContent)}</span><span class="icon choice-check" aria-hidden="true">check</span></button>`).join('')}</div>`);
      const menu=control.querySelector('.choice-menu');
      if (menu.showPopover) menu.setAttribute('popover','manual');
      label.htmlFor=toggleId;select.hidden=true;
    }
  }
  function updateVotes() {
    for (const button of pageBody.querySelectorAll('[data-vote]')) {
      const service=getService(button.dataset.vote);if (!service) continue;
      const value=metric(service.id);button.setAttribute('aria-pressed',String(value.liked));
      button.setAttribute('aria-label',service.name+' '+t(value.liked?'unrecommend':'recommend'));
      button.querySelector('span:not(.icon)').textContent=value.flames;
      button.disabled=busy.has(service.id);
      button.querySelector('.icon').textContent=button.disabled?'progress_activity':'local_fire_department';
      button.classList.toggle('is-loading',button.disabled);
    }
  }
  function fillFilterForm(values) {
    const form=$('filterForm');
    for (const [key,value] of Object.entries(values)) {
      if (key==='features') {for (const input of form.querySelectorAll('[name=features]')) input.checked=value.includes(input.value);}
      else {form.elements.namedItem(key).value=value;}
    }
    updateFilterDraft();
  }
  function readFilterDraft() {
    const data=new FormData($('filterForm')),values=defaults();
    for (const key of Object.keys(values)) values[key]=key==='features'?data.getAll('features'):data.get(key) || '';
    return values;
  }
  function updateFilterDraft() {
    const values=readFilterDraft();
    $('filterApplyCount').textContent=services.filter(service=>matches(service,values)).length;
    for (const select of $('filterForm').querySelectorAll('select')) {
      const control=select.closest('.select-field'),toggle=control.querySelector('[data-choice-toggle]');
      control.classList.toggle('has-value',!!select.value);
      if (!toggle) continue;
      const label=select.selectedOptions[0]?.textContent || t('all');
      control.querySelector('[data-choice-label]').textContent=label;
      toggle.setAttribute('aria-label',t(filterLabels[select.name])+': '+label);
      toggle.classList.toggle('is-applied',!!select.value);
      for (const option of choiceOptions(control)) {
        const selected=option.dataset.filterValue===select.value;
        option.setAttribute('aria-selected',String(selected));option.tabIndex=selected?0:-1;
      }
    }
  }
  function syncModalState() {
    document.documentElement.classList.toggle('modal-open',!!pageBody.querySelector('dialog[open]'));
  }
  function openDialog(id) {
    const dialog=$(id);if (!dialog || dialog.open) return;
    closeChoices();
    if (id==='filterDialog') fillFilterForm(state.filters);
    dialog.showModal();syncModalState();
  }
  function openDetails(id) {
    const service=getService(id);if (!service) return;
    $('detailBrand').innerHTML=`<div><h2 id="detailTitle" tabindex="-1">${escape(service.name)}</h2><p>${escape(service.domain)}</p></div>`;
    const fields=[['pricing','pricing','payments'],['login','login','person'],['siteAds','site_ads','web'],['redirectAds','redirect_ads','ad_units'],['region','region','public']];
    const rows=fields.filter(([,key])=>service[key]!=='unknown').map(([label,key,glyph])=>{
      const kind=key==='pricing'?'pricing':key==='login'?'login':key==='region'?'region':'ads';
      return `<div><dt>${icon(glyph)}${escape(t(label))}</dt><dd>${detailValue(null,t(kind+'_'+service[key]))}</dd></div>`;
    });
    if (service.languages.length) rows.push(`<div><dt>${icon('translate')}${escape(t('languages'))}</dt><dd>${detailValue(null,service.languages.join(', '))}</dd></div>`);
    const features=service.features.length?`<div class="detail-feature-row"><span class="detail-label">${icon('extension')}${escape(t('features'))}</span><div class="detail-features">${service.features.map(key=>detailValue(featureIcons[key],t('feature_'+key),'detail-feature')).join('')}</div></div>`:'';
    $('detailBody').innerHTML=`<dl class="detail-table">${rows.join('')}</dl>${features}`;
    $('detailActions').innerHTML=voteButton(service)+visitButton(service,true);updateVotes();
    const url=new URL(location.href);url.searchParams.set('service',id);history.replaceState(history.state,'',url);window.llnkNavigation?.remember();openDialog('detailsDialog');$('detailTitle').focus({preventScroll:true});
  }
  async function api(payload) {
    return window.ringklDirectoryStore.request(payload, boot);
  }
  async function vote(id) {
    if (busy.has(id)) return;busy.add(id);updateVotes();
    try {
      const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
      if (metricDay!==today) {const current=await api();metrics=current.metrics;metricDay=current.day;}
      const active=!metric(id).liked;
      const data=await api({action:'vote',id,active});metrics=data.metrics;metricDay=data.day;toast(t(active?'voteSaved':'voteRemoved'));
    }
    catch (error) {toast(t(error.code===429?'rateError':'requestError'));}
    finally {busy.delete(id);updateVotes();}
  }
  function trackVisit(id) {api({action:'visit',id}).then(result=>{metrics=result.metrics;updateVotes();}).catch(()=>{});}
  function clearAll() {
    state.filters=defaults();state.query='';state.category='all';state.visible=12;$('serviceSearch').value='';render();
  }
  activeListen(document,'click',event=>{
    const target=event.target instanceof Element?event.target:null;if (!target) return;
    const choice=target.closest('.choice-control[data-choice]');closeChoices(choice);
    const choiceToggle=target.closest('[data-choice-toggle]');
    if (choiceToggle && choice) {if (choiceToggle.getAttribute('aria-expanded')==='true') closeChoice(choice,true);else openChoice(choice);return;}
    const filterOption=target.closest('[data-filter-value]');
    if (filterOption && choice?.dataset.choice==='filter') {
      choice.querySelector('select').value=filterOption.dataset.filterValue;
      updateFilterDraft();closeChoice(choice,true);return;
    }
    const tip=target.closest('[data-tip]');
    for (const openTip of pageBody.querySelectorAll('.tip-open')) if (openTip!==tip) openTip.classList.remove('tip-open');
    if (tip) {toggleFactTooltip(tip);return;}
    hideFactTooltip();
    if (target.closest('[data-reset-filters]')) {state.filters=defaults();state.visible=12;render();$('filterToggle').focus({preventScroll:true});return;}
    const visit=target.closest('[data-visit]');if (visit) {trackVisit(visit.dataset.visit);return;}
    const voteNode=target.closest('[data-vote]');if (voteNode) {vote(voteNode.dataset.vote);return;}
    const details=target.closest('[data-details]');if (details) {event.preventDefault();openDetails(details.dataset.details);return;}
    const dialog=target.closest('[data-dialog]');if (dialog) {openDialog(dialog.dataset.dialog);return;}
    if (target.closest('[data-close]')) {target.closest('dialog')?.close();return;}
    const sort=target.closest('[data-sort]');if (sort && choice) {state.sort=sort.dataset.sort;state.visible=12;render();closeChoice(choice,true);return;}
    const category=target.closest('[data-category]');if (category) {state.category=category.dataset.category;state.visible=12;render();if (choice) closeChoice(choice,true);return;}
    const quick=target.closest('[data-quick]');if (quick) {
      const f=state.filters;
      if (quick.dataset.quick==='login') f.login=f.login==='no-account'?'':'no-account';
      if (quick.dataset.quick==='free') f.pricing=f.pricing==='free'?'':'free';
      if (quick.dataset.quick==='ads') {const selected=f.siteAds==='no' && f.redirectAds==='no';f.siteAds=selected?'':'no';f.redirectAds=selected?'':'no';}
      state.visible=12;render();return;
    }
    const remove=target.closest('[data-remove-filter]');if (remove) {const key=remove.dataset.removeFilter;if (key==='features') state.filters.features=state.filters.features.filter(value=>value!==remove.dataset.value);else state.filters[key]='';state.visible=12;render();$('filterToggle').focus({preventScroll:true});return;}
    if (target.closest('[data-reset]')) {clearAll();$('filterToggle').focus({preventScroll:true});return;}
    const language=target.closest('[data-language]');if (language) {event.preventDefault();window.llnkPreferences.setLanguage(language.dataset.language);return;}
    const serviceCard=target.closest('.service-row');if (serviceCard && !target.closest('button,a,input,select')) openDetails(serviceCard.dataset.id);
  });
  activeListen(document,'auxclick',event=>{const link=event.target instanceof Element?event.target.closest('[data-visit]'):null;if (event.button===1 && link) trackVisit(link.dataset.visit);});
  for (const dialog of pageBody.querySelectorAll('dialog')) {
    dialog.addEventListener('click',event=>{if (event.target!==dialog) return;const r=dialog.getBoundingClientRect();if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) dialog.close();});
    dialog.addEventListener('close',()=>{closeChoices();syncModalState();if (dialog.id==='detailsDialog') {const url=new URL(location.href);url.searchParams.delete('service');history.replaceState(history.state,'',url);window.llnkNavigation?.remember();}});
  }
  $('serviceSearch').value=state.query;
  $('serviceSearch').addEventListener('input',event=>{state.query=event.target.value.slice(0,80);state.visible=12;render();});
  $('clearSearch').addEventListener('click',()=>{state.query='';$('serviceSearch').value='';state.visible=12;render();$('serviceSearch').focus({preventScroll:true});});
  activeListen(window,'scroll',queueAutoLoad,{passive:true});
  activeListen(window,'resize',queueAutoLoad,{passive:true});
  if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))queueAutoLoad();},{rootMargin:'240px 0px'});observer.observe($('loadSentinel'));}
  $('filterForm').addEventListener('change',updateFilterDraft);
  $('filterForm').addEventListener('submit',event=>{event.preventDefault();state.filters=readFilterDraft();state.visible=12;$('filterDialog').close();render();});
  $('resetDraft').addEventListener('click',()=>{closeChoices();fillFilterForm(defaults());});
  $('refreshStats').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;button.classList.add('is-loading');
    try {const data=await api();metrics=data.metrics;metricDay=data.day;snapshot=JSON.parse(JSON.stringify(metrics));render();}
    catch (_) {toast(t('requestError'));}
    finally {button.disabled=false;button.classList.remove('is-loading');}
  });
  activeListen(document,'keydown',event=>{
    const target=event.target instanceof Element?event.target:null;
    const choice=target?.closest('.choice-control[data-choice]');if (!choice) return;
    const menu=choice.querySelector('.choice-menu'),options=choiceOptions(choice),isOpen=!menu.hidden;
    if (event.key==='Escape' && isOpen) {event.preventDefault();closeChoice(choice,true);return;}
    if (event.key==='Tab') {if (isOpen) closeChoice(choice,true);return;}
    if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
    event.preventDefault();
    if (!isOpen) {openChoice(choice,event.key==='Home'?0:event.key==='End'?options.length-1:null);return;}
    const current=options.indexOf(document.activeElement);
    focusChoice(choice,event.key==='Home'?0:event.key==='End'?options.length-1:current+(event.key==='ArrowDown'?1:-1));
  });
  activeListen(document,'keydown',event=>{
    const tip=event.target instanceof Element?event.target.closest('[data-tip]'):null;
    if (tip && ['Enter',' '].includes(event.key)) {event.preventDefault();toggleFactTooltip(tip);}
    if (event.key==='Escape') hideFactTooltip();
  });
  activeListen(document,'pointerover',event=>{const tip=event.target instanceof Element?event.target.closest('[data-tip]'):null;if (tip && tip!==activeFactTip) showFactTooltip(tip);});
  activeListen(document,'pointerout',event=>{const tip=event.target instanceof Element?event.target.closest('[data-tip]'):null;if (tip && tip===activeFactTip && !tip.contains(event.relatedTarget) && !tip.classList.contains('tip-open')) hideFactTooltip();});
  activeListen(document,'focusin',event=>{const tip=event.target instanceof Element?event.target.closest('[data-tip]'):null;if (tip) showFactTooltip(tip);});
  activeListen(document,'focusout',event=>{if (activeFactTip && event.target===activeFactTip) hideFactTooltip();});
  activeListen(document,'scroll',hideFactTooltip,{passive:true,capture:true});
  activeListen(window,'resize',hideFactTooltip,{passive:true});
  activeListen(document,'scroll',()=>{for (const control of pageBody.querySelectorAll('.filter-choice')) if (control.querySelector('[data-choice-toggle]').getAttribute('aria-expanded')==='true') positionFilterChoice(control);},{passive:true,capture:true});
  activeListen(window,'resize',()=>{for (const control of pageBody.querySelectorAll('.filter-choice')) if (control.querySelector('[data-choice-toggle]').getAttribute('aria-expanded')==='true') positionFilterChoice(control);},{passive:true});
  activeListen(document,'keydown',event=>{if (event.key==='/' && !event.ctrlKey && !event.metaKey && !pageBody.querySelector('dialog[open]') && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {event.preventDefault();$('serviceSearch').focus();}});
  function paintTheme() {
    const dark=document.documentElement.dataset.theme==='dark';
    $('themeToggle').setAttribute('aria-pressed',String(dark));$('themeToggle').setAttribute('aria-label',t(dark?'lightMode':'darkMode'));$('themeToggle').title=t(dark?'lightMode':'darkMode');$('themeToggle').querySelector('.icon').textContent=dark?'light_mode':'dark_mode';
  }
  $('themeToggle').addEventListener('click',()=>window.llnkPreferences.setTheme(window.llnkPreferences.theme==='dark'?'light':'dark'));
  activeListen(document,'llnk:preferences',paintTheme);
  let reportBusy=false,reportAttempt=null;
  $('reportForm').addEventListener('input',()=>{if (!reportBusy) $('reportStatus').textContent='';});
  $('reportForm').addEventListener('submit',async event=>{
    event.preventDefault();if (reportBusy) return;
    const form=event.currentTarget,data=new FormData(form),button=$('reportSubmit');
    const fields={name:String(data.get('name') || '').trim(),url:String(data.get('url') || '').trim(),note:String(data.get('note') || '').trim()};
    const signature=JSON.stringify(fields);
    reportBusy=true;button.disabled=true;button.classList.add('is-loading');form.setAttribute('aria-busy','true');
    $('reportSubmitIcon').textContent='progress_activity';$('reportSubmitLabel').textContent=t('reportSending');$('reportStatus').textContent='';
    try {
      if (!reportAttempt || reportAttempt.signature!==signature) reportAttempt={signature,id:Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('')};
      await api({action:'report',request_id:reportAttempt.id,...fields});
      form.reset();reportAttempt=null;$('reportStatus').textContent=t('reportSent');
    } catch (error) {
      $('reportStatus').textContent=t(error.message==='report_daily_limit'?'reportDailyLimit':error.code===429?'reportCooldown':error.code===422||error.code===409?'reportInvalid':'reportFailed');
    } finally {
      reportBusy=false;button.disabled=false;button.classList.remove('is-loading');form.removeAttribute('aria-busy');
      $('reportSubmitIcon').textContent='send';$('reportSubmitLabel').textContent=t('sendReport');
    }
  });
  let synchronizing=false;
  activeListen(document,'visibilitychange',async()=>{
    if (document.visibilityState!=='visible' || synchronizing || busy.size) return;
    synchronizing=true;
    try {const data=await api();metrics=data.metrics;metricDay=data.day;updateVotes();}catch(_){}finally{synchronizing=false;}
  });
  const header=pageBody.querySelector('.site-header'),sticky=pageBody.querySelector('.directory-sticky');
  function updateChromeHeight() {
    if(document.body!==pageBody)return;
    const headerHeight=Math.ceil(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--directory-header-height',headerHeight+'px');
    document.documentElement.style.setProperty('--directory-chrome-height',headerHeight+Math.ceil(sticky.getBoundingClientRect().height)+'px');
  }
  if ('ResizeObserver' in window) {const observer=new ResizeObserver(updateChromeHeight);observer.observe(header);observer.observe(sticky);}
  else activeListen(window,'resize',updateChromeHeight);
  document.addEventListener('llnk:viewchange',()=>{
    if(document.body!==pageBody)return;
    const restored=new URL(location.href).searchParams;
    state.query=(restored.get('q') || '').slice(0,80);$('serviceSearch').value=state.query;
    state.category=categories.includes(restored.get('category'))?restored.get('category'):'all';
    state.sort=['flames','name'].includes(restored.get('sort'))?restored.get('sort'):'flames';
    for(const name of Object.keys(defaults()))if(name!=='features')state.filters[name]=restored.get(name) || '';
    state.filters.features=(restored.get('features') || '').split(',').filter(value=>allowedFeatures.includes(value));
    hideFactTooltip();paintTheme();render();updateChromeHeight();
  });
  enhanceFilterChoices();paintTheme();render();updateChromeHeight();if (params.get('service')) openDetails(params.get('service'));
})();
