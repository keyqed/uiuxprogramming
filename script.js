const greetings = {
  en: 'hello',
  ko: '안녕하세요',
  ja: 'こんにちは'
};
const heading = document.querySelector('h1');
const greeting = document.querySelector('.greeting');
const buttons = document.querySelectorAll('button[data-language]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let currentAnimation;

buttons.forEach((button) => {
  button.addEventListener('click', () => {
    const language = button.dataset.language;
    if (heading.dataset.language === language) return;
    buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    heading.dataset.language = language;
    heading.lang = language;
    document.getElementById('hello').textContent = greetings[language];
    if (!reducedMotion.matches && typeof greeting.animate === 'function') {
      currentAnimation?.cancel();
      currentAnimation = greeting.animate(
        [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 400, easing: 'cubic-bezier(.2,.7,.2,1)' }
      );
    }
  });
});

document.querySelector('.theme-toggle').addEventListener('click', (event) => {
  const isDark = document.body.classList.toggle('dark');
  event.currentTarget.setAttribute('aria-pressed', String(isDark));
});
