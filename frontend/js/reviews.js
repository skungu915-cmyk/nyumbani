import { api, ApiError } from './api.js';
import { qs, escapeHtml, fmtDate } from './utils.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { requireLoginOrPrompt } from './auth.js';

let activePropertyId = null;
let selectedStars = 0;

export function setStars(n) {
  selectedStars = n;
  document.querySelectorAll('#starsRow .sstar').forEach((btn) => {
    btn.classList.toggle('on', Number(btn.dataset.star) <= n);
  });
}

export function openReviewsForProperty(id, title) {
  activePropertyId = id || null;
  qs('reviewsTitle').textContent = title ? `Reviews — ${title}` : 'Platform Reviews';
  setStars(0);
  qs('reviewText').value = '';
  clearReviewErr();
  openModal('reviewsOvl');
  loadReviews();
}

function clearReviewErr() {
  const el = qs('reviewErr');
  el.textContent = '';
  el.classList.remove('show');
}

async function loadReviews() {
  const list = qs('reviewsList');
  list.innerHTML = '<div class="empty-state">Loading reviews…</div>';
  try {
    const params = new URLSearchParams();
    if (activePropertyId) params.set('propertyId', activePropertyId);
    const res = await api.get(`/api/reviews?${params.toString()}`);
    if (res.items.length === 0) {
      list.innerHTML = '<div class="empty-state">No reviews yet. Be the first!</div>';
      return;
    }
    list.innerHTML = res.items
      .map(
        (r) => `
      <div class="review-card">
        <div class="rc-top">
          <div><div class="rc-name">${escapeHtml(r.authorName)}</div><div class="rc-date">${fmtDate(r.createdAt)}</div></div>
          <div class="rc-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>
        </div>
        <div class="rc-txt">${escapeHtml(r.text)}</div>
      </div>`
      )
      .join('');
  } catch {
    list.innerHTML = '<div class="empty-state">Could not load reviews.</div>';
  }
}

export async function submitReview() {
  if (!requireLoginOrPrompt('leave a review')) return;
  clearReviewErr();
  if (selectedStars < 1) {
    const el = qs('reviewErr');
    el.textContent = 'Please select a star rating';
    el.classList.add('show');
    return;
  }
  const text = qs('reviewText').value.trim();
  try {
    await api.post('/api/reviews', { propertyId: activePropertyId || undefined, stars: selectedStars, text });
    toast('✅', 'Thanks!', 'Your review is pending moderation.');
    qs('reviewText').value = '';
    setStars(0);
  } catch (err) {
    const el = qs('reviewErr');
    el.textContent = err instanceof ApiError ? err.message : 'Could not submit review';
    el.classList.add('show');
  }
}

export function openReviews() {
  openReviewsForProperty(null, null);
}
