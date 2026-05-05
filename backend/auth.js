const crypto = require('crypto');

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash || '').split(':');
  if (!salt || !originalHash) return false;

  const derived = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  const originalBuffer = Buffer.from(originalHash, 'hex');
  const derivedBuffer = Buffer.from(derived, 'hex');

  if (originalBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(originalBuffer, derivedBuffer);
}

function publicUser(user) {
  if (!user) return null;

  return {
    id: Number(user.id),
    name: user.name || '',
    username: user.username || '',
    role: user.role || 'user',
    active: Boolean(user.active),
    approved: Boolean(user.approved),
    createdAt: user.createdAt || '',
    updatedAt: user.updatedAt || '',
  };
}

function validatePassword(password) {
  return String(password || '').trim().length >= 6;
}

module.exports = {
  hashPassword,
  normalizeUsername,
  publicUser,
  validatePassword,
  verifyPassword,
};
