const greetings = [
  { lang: 'en', text: 'hello' },
  { lang: 'ko', text: '안녕하세요', compact: true },
  { lang: 'ja', text: 'こんにちは', compact: true },
  { lang: 'fr', text: 'bonjour', compact: true },
  { lang: 'es', text: 'hola' },
  { lang: 'de', text: 'hallo' },
  { lang: 'it', text: 'ciao' },
  { lang: 'pt', text: 'olá' },
  { lang: 'zh', text: '你好' },
  { lang: 'hi', text: 'नमस्ते', compact: true }
];
const heading = document.querySelector('h1');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let index = 0;
let currentAnimation;

setInterval(() => {
  if (document.hidden) return;
  index = (index + 1) % greetings.length;
  const next = greetings[index];
  heading.lang = next.lang;
  heading.dataset.language = next.lang;
  heading.classList.toggle('compact', Boolean(next.compact));
  document.getElementById('hello').textContent = next.text;
  if (!reducedMotion.matches && typeof heading.animate === 'function') {
    currentAnimation?.cancel();
    currentAnimation = heading.animate(
      [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 450, easing: 'cubic-bezier(.2,.7,.2,1)' }
    );
  }
}, 3000);

document.querySelector('.theme-toggle').addEventListener('click', (event) => {
  const isDark = document.body.classList.toggle('dark');
  event.currentTarget.setAttribute('aria-pressed', String(isDark));
});
