// Escapes user-controlled text before it is ever inserted into innerHTML. This is the PRIMARY
// XSS defense on the frontend — every place a review, description, name, or other user-supplied
// string is rendered goes through this first. Never build HTML by concatenating raw user input.
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtKes(n) {
  if (n === null || n === undefined) return '—';
  return 'KES ' + Number(n).toLocaleString('en-KE');
}

export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function propertyTypeLabel(type) {
  return (
    {
      BEDSITTER: 'Bedsitter',
      STUDIO: 'Studio',
      ONE_BED: '1 Bedroom',
      TWO_BED: '2 Bedroom',
      THREE_BED: '3 Bedroom',
      BNB: 'BnB / Short Stay',
    }[type] || type
  );
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function qs(id) {
  return document.getElementById(id);
}
