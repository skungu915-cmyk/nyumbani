// Defense-in-depth for free-text user input (reviews, messages, property descriptions).
// The PRIMARY XSS defense is output encoding on the frontend (see frontend/js/utils.js escapeHtml,
// used everywhere user content is inserted into the DOM) — this is a secondary layer that strips
// control characters and caps length so nothing pathological ever reaches storage.
function cleanText(input, maxLen = 2000) {
  if (typeof input !== 'string') return '';
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, maxLen);
}

module.exports = { cleanText };
