export function openModal(id) {
  document.querySelectorAll('.ovl.on').forEach((el) => el.classList.remove('on'));
  const el = document.getElementById(id);
  if (el) el.classList.add('on');
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('on');
}

export function closeAllModals() {
  document.querySelectorAll('.ovl.on').forEach((el) => el.classList.remove('on'));
}

// Click-outside-to-close + Escape key, wired once at startup.
export function initModalDismiss() {
  document.querySelectorAll('.ovl').forEach((ovl) => {
    ovl.addEventListener('click', (e) => {
      if (e.target === ovl) ovl.classList.remove('on');
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
}
