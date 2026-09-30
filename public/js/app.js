// Comportamentos gerais (sem scripts inline, por causa da política de segurança de conteúdo)
document.addEventListener('click', (e) => {
  const abrir = e.target.closest('[data-abrir-menu]');
  const menu = document.getElementById('menu');
  if (abrir && menu) { menu.classList.toggle('aberta'); e.stopPropagation(); return; }
  if (menu && menu.classList.contains('aberta') && !e.target.closest('#menu')) menu.classList.remove('aberta');
  if (e.target.closest('[data-imprimir]')) window.print();
});

document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute('data-confirmar');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
