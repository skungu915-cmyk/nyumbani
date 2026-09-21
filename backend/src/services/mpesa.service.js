const env = require('../config/env');
const logger = require('../lib/logger');
const { badRequest } = require('../utils/http-errors');

const BASE_URL = env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

let cachedToken = null; // { token, expiresAt }

// Daraja OAuth tokens are valid ~1hr; consumer key/secret NEVER leave this process — the frontend
// never sees them, unlike the mockup's admin UI which had text inputs for them.
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  if (!env.MPESA_CONSUMER_KEY || !env.MPESA_CONSUMER_SECRET) {
    throw badRequest('M-Pesa is not configured on this server yet. Set MPESA_CONSUMER_KEY/SECRET.');
  }
  const auth = Buffer.from(`${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error({ status: res.status, body }, 'M-Pesa OAuth token request failed');
    throw new Error('Failed to authenticate with M-Pesa');
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3500) * 1000 };
  return cachedToken.token;
}

function darajaTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

// Kenyan MSISDN normalization: Daraja requires 2547XXXXXXXX / 2541XXXXXXXX format.
function normalizeMsisdn(phone) {
  let p = String(phone).replace(/[^\d]/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  if (!/^254(7|1)\d{8}$/.test(p)) {
    throw badRequest('Enter a valid Safaricom number, e.g. 07XXXXXXXX or 2547XXXXXXXX');
  }
  return p;
}

async function stkPush({ phone, amountKes, accountReference, transactionDesc }) {
  const msisdn = normalizeMsisdn(phone);
  const token = await getAccessToken();
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString('base64');

  const payload = {
    BusinessShortCode: env.MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: Math.round(amountKes),
    PartyA: msisdn,
    PartyB: env.MPESA_SHORTCODE,
    PhoneNumber: msisdn,
    CallBackURL: env.MPESA_CALLBACK_URL,
    AccountReference: accountReference.slice(0, 12),
    TransactionDesc: transactionDesc.slice(0, 13),
  };

  const res = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errorCode) {
    logger.error({ status: res.status, data }, 'M-Pesa STK push failed');
    throw badRequest(data.errorMessage || 'Failed to initiate M-Pesa payment. Please try again.');
  }
  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    normalizedPhone: msisdn,
  };
}

module.exports = { getAccessToken, stkPush, normalizeMsisdn };
