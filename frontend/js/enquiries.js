import { api, ApiError } from './api.js';
import { toast } from './toast.js';
import { closeModal } from './modal.js';

export async function handleContactSubmit(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await api.post('/api/enquiries', data);
    closeModal('contactOvl');
    form.reset();
    toast('✅', 'Message sent', "We'll get back to you shortly.");
  } catch (err) {
    toast('❌', 'Error', err instanceof ApiError ? err.message : 'Could not send message', true);
  }
}
