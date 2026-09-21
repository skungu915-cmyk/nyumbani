import { api } from './api.js';
import { qs, fmtKes } from './utils.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { isLoggedIn } from './state.js';

export async function openReferral() {
  openModal('referralOvl');
  if (!isLoggedIn()) {
    qs('refCode').textContent = '—';
    qs('refCount').textContent = '0';
    qs('refPending').textContent = 'KES 0';
    qs('refEarned').textContent = 'KES 0';
    qs('refLoginHint').classList.remove('hidden');
    return;
  }
  qs('refLoginHint').classList.add('hidden');
  try {
    const res = await api.get('/api/referrals/me');
    qs('refCode').textContent = res.code;
    qs('refCount').textContent = res.count;
    qs('refPending').textContent = fmtKes(res.pendingKes);
    qs('refEarned').textContent = fmtKes(res.earnedKes);
  } catch {
    qs('refCode').textContent = '—';
  }
}

export function copyRefCode() {
  const code = qs('refCode').textContent;
  if (!code || code === '—') return;
  navigator.clipboard?.writeText(code).then(
    () => toast('📋', 'Copied', `${code} copied to clipboard`),
    () => toast('❌', 'Error', 'Could not copy code', true)
  );
}
