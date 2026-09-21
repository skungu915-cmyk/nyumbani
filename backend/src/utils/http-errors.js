class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg || 'Bad request', details);
const unauthorized = (msg) => new HttpError(401, msg || 'Unauthorized');
const forbidden = (msg) => new HttpError(403, msg || 'Forbidden');
const notFound = (msg) => new HttpError(404, msg || 'Not found');
const conflict = (msg) => new HttpError(409, msg || 'Conflict');
const tooMany = (msg) => new HttpError(429, msg || 'Too many requests');

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, tooMany };
