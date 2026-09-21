import { bootstrapSession, openLogin, openSignup, logout, handleLoginSubmit, handleSignupSubmit, renderAuthUI } from './auth.js';
import { state, hasRole } from './state.js';
import { openModal, closeModal, initModalDismiss } from './modal.js';
import { toast } from './toast.js';
import {
  loadFeatured,
  loadListings,
  loadStats,
  viewProperty,
  unlockProperty,
  setCatFilter,
  setQuickFilter,
  doSearch,
  openSelfList,
  pickGeo,
  handleSelfListSubmit,
  refreshCurrentPropertyView,
} from './properties.js';
import { sendStk, closeStk } from './payments.js';
import { openReviews, openReviewsForProperty, submitReview, setStars } from './reviews.js';
import { openReferral, copyRefCode } from './referrals.js';
import { handleContactSubmit } from './enquiries.js';
import {
  showLV,
  loadLandlordHome,
  handleAddTenantSubmit,
  logRentPayment,
  markOverdue,
  handleMaintSubmit,
  resolveMaint,
  handleNoticeSubmit,
} from './landlord.js';
import {
  showAV,
  searchListings,
  approveListing,
  suspendListing,
  activateListing,
  deleteListing,
  addAdminPhotos,
  removeAdminPhoto,
  handleAdminAddListing,
  searchTx,
  markTxPaid,
  searchUsers,
  suspendUser,
  activateUser,
  markEnquiryReplied,
  approveReview,
  rejectReview,
  saveAdminSettings,
} from './admin.js';

const actions = {
  switchPortal: (el) => switchPortal(el.dataset.portal),
  scrollTop: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  scrollTo: (el) => document.getElementById(el.dataset.target)?.scrollIntoView({ behavior: 'smooth' }),
  openModal: (el) => openModal(el.dataset.modal),
  closeModal: (el) => closeModal(el.dataset.modal),
  openLogin,
  openSignup,
  logout,
  doSearch,
  catFilter: (el) => setCatFilter(el.dataset.type),
  quickFilter: (el) => setQuickFilter(el.dataset.type),
  gotoPage: (el) => loadListings(Number(el.dataset.page)),
  viewProperty: (el) => viewProperty(el.dataset.id),
  unlockProperty: (el) => unlockProperty(el.dataset.id),
  openReviewsFor: (el) => openReviewsForProperty(el.dataset.id, el.dataset.title),
  openReviews,
  submitReview,
  openReferral,
  copyRefCode,
  openSelfList,
  pickGeo,
  sendStk,
  closeStk,
  showLV: (el) => showLV(el.dataset.view),
  showAV: (el) => showAV(el.dataset.view),
  logRentPayment: (el) => logRentPayment(el.dataset.id),
  markOverdue: (el) => markOverdue(el.dataset.id),
  resolveMaint: (el) => resolveMaint(el.dataset.id),
  approveListing: (el) => approveListing(el.dataset.id),
  suspendListing: (el) => suspendListing(el.dataset.id),
  activateListing: (el) => activateListing(el.dataset.id),
  deleteListing: (el) => deleteListing(el.dataset.id),
  removeAdminPhoto: (el) => removeAdminPhoto(el.dataset.idx),
  markTxPaid: (el) => markTxPaid(el.dataset.id),
  suspendUser: (el) => suspendUser(el.dataset.id),
  activateUser: (el) => activateUser(el.dataset.id),
  markEnquiryReplied: (el) => markEnquiryReplied(el.dataset.id),
  approveReview: (el) => approveReview(el.dataset.id),
  rejectReview: (el) => rejectReview(el.dataset.id),
  saveAdminSettings,
};

function switchPortal(portal) {
  if (portal === 'l' && !hasRole('LANDLORD', 'ADMIN')) {
    toast('🔒', 'Landlord login required', 'Log in with a landlord account to access this portal');
    if (!state.user) openLogin();
    return;
  }
  if (portal === 'a' && !hasRole('ADMIN')) {
    toast('🔒', 'Admin only', 'This portal is restricted to administrators');
    if (!state.user) openLogin();
    return;
  }
  document.querySelectorAll('.ptab').forEach((t) => t.classList.toggle('on', t.dataset.portal === portal));
  document.querySelectorAll('.portal').forEach((p) => p.classList.toggle('on', p.id === `portal-${portal}`));
  window.scrollTo({ top: 0 });
  if (portal === 'l') loadLandlordHome();
  if (portal === 'a') showAV('overview');
}

function wireDelegatedClicks() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });

  // Star rating picker (reviews modal).
  document.getElementById('starsRow')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.sstar');
    if (btn) setStars(Number(btn.dataset.star));
  });

  // Amenity toggle chips (self-list modal) — plain on/off, not part of the action registry.
  document.getElementById('slAmenities')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.amen-tog');
    if (btn) btn.classList.toggle('on');
  });
}

function wireForms() {
  const bind = (id, handler) => {
    const form = document.getElementById(id);
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handler(form);
    });
  };
  bind('loginForm', handleLoginSubmit);
  bind('signupForm', handleSignupSubmit);
  bind('selfListForm', handleSelfListSubmit);
  bind('contactForm', handleContactSubmit);
  bind('addTenantForm', handleAddTenantSubmit);
  bind('maintForm', handleMaintSubmit);
  bind('noticeForm', handleNoticeSubmit);
  bind('adAddForm', handleAdminAddListing);

  document.getElementById('adPhotoInput')?.addEventListener('change', (e) => addAdminPhotos(e.target.files));
  document.getElementById('adListSearch')?.addEventListener('input', (e) => searchListings(e.target.value));
  document.getElementById('adTxSearch')?.addEventListener('input', (e) => searchTx(e.target.value));
  document.getElementById('adUserSearch')?.addEventListener('input', (e) => searchUsers(e.target.value));

  // Account-type picker in signup modal (visual state only — the radio input carries the real value).
  document.querySelectorAll('#signupForm .acct-type').forEach((label) => {
    label.addEventListener('click', () => {
      document.querySelectorAll('#signupForm .acct-type').forEach((l) => l.classList.remove('on'));
      label.classList.add('on');
    });
  });
}

function wireGlobalEvents() {
  window.addEventListener('session:expired', () => {
    toast('🔒', 'Session expired', 'Please log in again');
    renderAuthUI();
    openLogin();
  });
  window.addEventListener('payment:unlocked', () => {
    refreshCurrentPropertyView();
    loadListings();
    loadFeatured();
  });
  window.addEventListener('property:created', () => {
    if (document.getElementById('portal-l').classList.contains('on')) loadLandlordHome();
  });
  window.addEventListener('nav:home', () => switchPortal('c'));
}

async function init() {
  document.getElementById('footYear').textContent = `© ${new Date().getFullYear()} LiveHere Homes Ltd. All rights reserved.`;
  initModalDismiss();
  wireDelegatedClicks();
  wireForms();
  wireGlobalEvents();
  await bootstrapSession();
  loadFeatured();
  loadListings();
  loadStats();
}

init();
