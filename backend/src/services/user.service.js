// Strips every sensitive/internal field before a User row is ever sent to a client. Used
// EVERYWHERE a user object reaches an HTTP response — never send a raw Prisma User row.
function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    isEmailVerified: user.isEmailVerified,
    referralCode: user.referralCode,
    mpesaPayoutNumber: user.mpesaPayoutNumber || null,
    agencyName: user.agencyName || null,
    yearsExperience: user.yearsExperience || null,
    operatingAreas: user.operatingAreas || null,
    createdAt: user.createdAt,
  };
}

module.exports = { toPublicUser };
