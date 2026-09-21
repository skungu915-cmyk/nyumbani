const { badRequest } = require('../utils/http-errors');

// Validates req[part] against a zod schema and replaces it with the parsed (coerced/stripped) value.
// Using zod here means every route has an explicit, enforced shape for its input — the main defense
// against malformed/oversized/unexpected-type payloads reaching business logic or the ORM.
const validate = (schema, part = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[part]);
  if (!result.success) {
    return next(badRequest('Invalid input', result.error.flatten().fieldErrors));
  }
  req[part] = result.data;
  next();
};

module.exports = validate;
