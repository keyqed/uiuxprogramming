// HTML은 내용, CSS는 표현, JavaScript는 사용자 행동에 대한 반응을 담당합니다.
const topics = {
  html: {
    file: 'INDEX.HTML',
    title: '화면의 뼈대를 만들어요.',
    description: 'HTML은 제목, 문단, 링크, 버튼처럼 페이지에 들어갈 내용을 정리합니다. 지금 보고 있는 제목과 버튼도 HTML로 만들었습니다.',
    code: '<h1>나의 첫 웹페이지</h1>',
    label: 'HTML · 구조'
  },
  css: {
    file: 'STYLE.CSS',
    title: '내용에 모양을 더해요.',
    description: 'CSS는 색상, 글자 크기, 여백과 배치를 정합니다. 이 페이지의 초록색 버튼과 넉넉한 간격도 CSS로 표현했습니다.',
    code: 'h1 { color: #235b47; }',
    label: 'CSS · 시각적 표현'
  },
  js: {
    file: 'SCRIPT.JS',
    title: '사용자의 행동에 반응해요.',
    description: 'JavaScript는 클릭이나 입력에 따라 화면을 바꿉니다. 방금 버튼을 누르자 설명과 선택 표시가 바뀐 것이 상호작용입니다.',
    code: "button.addEventListener('click', showTopic);",
    label: 'JavaScript · 상호작용'
  }
};

const buttons = document.querySelectorAll('[data-topic]');
function showTopic(event) {
  const selectedButton = event.currentTarget;
  const topic = topics[selectedButton.dataset.topic];
  buttons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button === selectedButton));
  });
  document.getElementById('file-name').textContent = topic.file;
  document.getElementById('topic-title').textContent = topic.title;
  document.getElementById('topic-description').textContent = topic.description;
  document.getElementById('code-example').textContent = topic.code;
  document.getElementById('feedback').textContent = '현재 선택: ' + topic.label;
}
buttons.forEach((button) => button.addEventListener('click', showTopic));
