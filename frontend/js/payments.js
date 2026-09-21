import { api, ApiError } from './api.js';
import { qs, fmtKes, escapeHtml } from './utils.js';
import { toast } from './toast.js';

let activeProperty = null;
let pollTimer = null;
let pollDeadline = 0;

function setStatus(cls, text) {
  const el = qs('stkStatus');
  el.className = `stk-status show ${cls}`;
  el.textContent = text;
}
function clearStatus() {
  const el = qs('stkStatus');
  el.className = 'stk-status';
  el.textContent = '';
}

export function openStkForProperty(property) {
  activeProperty = property;
  clearStatus();
  qs('stkPropTitle').textContent = property.title;
  qs('stkAmount').textContent = fmtKes(property.viewingFeeKes);
  qs('stkPhone').value = '';
  qs('stkSendBtn').disabled = false;
  document.getElementById('stkOvl').classList.add('on');
}

export function closeStk() {
  document.getElementById('stkOvl').classList.remove('on');
  stopPolling();
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

async function pollPaymentStatus(paymentId, onDone) {
  if (Date.now() > pollDeadline) {
    setStatus('err', '⏱️ Taking longer than expected. Check your phone, or try again.');
    qs('stkSendBtn').disabled = false;
    return;
  }
  try {
    const res = await api.get(`/api/payments/${paymentId}/status`);
    if (res.payment.status === 'SUCCESS') {
      setStatus('ok', `✅ Payment confirmed — M-Pesa receipt ${escapeHtml(res.payment.mpesaReceiptNumber || '')}`);
      toast('✅', 'Payment confirmed', 'Property details unlocked!');
      onDone(true);
      return;
    }
    if (res.payment.status === 'FAILED' || res.payment.status === 'CANCELLED') {
      setStatus('err', '❌ Payment was not completed. You can try again.');
      qs('stkSendBtn').disabled = false;
      onDone(false);
      return;
    }
    setStatus('wait', '⏳ Waiting for you to enter your M-Pesa PIN on your phone…');
    pollTimer = setTimeout(() => pollPaymentStatus(paymentId, onDone), 3000);
  } catch {
    pollTimer = setTimeout(() => pollPaymentStatus(paymentId, onDone), 4000);
  }
}

export async function sendStk() {
  if (!activeProperty) return;
  const phone = qs('stkPhone').value.trim();
  if (phone.replace(/[^\d]/g, '').length < 9) {
    setStatus('err', 'Enter a valid Safaricom number, e.g. 07XXXXXXXX');
    return;
  }
  qs('stkSendBtn').disabled = true;
  setStatus('wait', '📲 Sending STK push to your phone…');

  try {
    const res = await api.post('/api/payments/unlock', { propertyId: activeProperty.id, phoneNumber: phone });
    setStatus('wait', '⏳ Check your phone and enter your M-Pesa PIN…');
    pollDeadline = Date.now() + 90 * 1000;
    pollPaymentStatus(res.paymentId, (success) => {
      if (success) {
        stopPolling();
        setTimeout(() => {
          closeStk();
          window.dispatchEvent(new CustomEvent('payment:unlocked', { detail: { propertyId: activeProperty.id } }));
        }, 1400);
      }
    });
  } catch (err) {
    qs('stkSendBtn').disabled = false;
    setStatus('err', err instanceof ApiError ? err.message : 'Could not start payment. Please try again.');
  }
}
