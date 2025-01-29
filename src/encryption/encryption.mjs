import crypto from 'crypto';
import { config as dotenvConfig } from 'dotenv';

// Load environment variables from .env file
dotenvConfig();

const algorithm = 'aes-256-cbc';
const password = process.env.ENCRYPTION_PASSWORD;

if (!password) {
  throw new Error('ENCRYPTION_PASSWORD environment variable is not set.');
}

const key = crypto.scryptSync(password, 'salt', 32); // Use a password from environment variables
const iv = crypto.randomBytes(16); // Initialization vector

export function encryptPrivateKey(privateKey) {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decryptPrivateKey(encryptedPrivateKey) {
  const [ivHex, encrypted] = encryptedPrivateKey.split(':');
  const ivBuffer = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, ivBuffer);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
