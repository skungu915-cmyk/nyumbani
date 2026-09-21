import { escapeHtml, qs } from './utils.js';

export function toast(icon, title, msg, isError = false) {
  const container = qs('toasts');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.innerHTML = `<span>${escapeHtml(icon)}</span><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(msg)}</span></div>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
