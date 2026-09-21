const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const env = require('../config/env');
const { badRequest } = require('../utils/http-errors');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', env.UPLOAD_DIR);
const PROPERTIES_DIR = path.join(UPLOAD_ROOT, 'properties');

async function ensureDirs() {
  await fs.mkdir(PROPERTIES_DIR, { recursive: true });
}
ensureDirs().catch(() => {});

// Files are received into memory (never written to disk under a user-controlled name), validated
// by CONTENT (magic bytes), not by the client-supplied filename/mimetype which are trivially
// spoofable, then re-encoded and written out under a fresh server-generated random filename.
// Separate limiters per media type so a photo upload can't buffer up to the (much larger) video
// size limit in memory — bounds the worst-case memory footprint of concurrent uploads.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_PHOTO_MB * 1024 * 1024, files: env.MAX_PHOTOS_PER_PROPERTY },
});

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_VIDEO_MB * 1024 * 1024, files: 1 },
});

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

function randomName(ext) {
  return `${Date.now()}-${crypto.randomBytes(16).toString('hex')}.${ext}`;
}

// `file-type` ships as an ESM-only package; this codebase is CommonJS, so it's loaded via a
// cached dynamic import rather than `require()` (which cannot resolve ESM-only packages).
let fileTypeModulePromise;
function loadFileType() {
  if (!fileTypeModulePromise) fileTypeModulePromise = import('file-type');
  return fileTypeModulePromise;
}
async function detectFileType(buffer) {
  const { fileTypeFromBuffer } = await loadFileType();
  return fileTypeFromBuffer(buffer);
}

// Validates a single uploaded photo, strips EXIF/GPS metadata (a real privacy leak — phone photos
// often embed the exact GPS coordinates where they were taken, which would defeat the whole
// "address hidden until paid" model), downsizes to a sane max resolution, and writes it as JPEG.
async function processPhoto(buffer) {
  if (buffer.length > env.MAX_PHOTO_MB * 1024 * 1024) {
    throw badRequest(`Each photo must be under ${env.MAX_PHOTO_MB}MB`);
  }
  const detected = await detectFileType(buffer);
  if (!detected || !ALLOWED_IMAGE_TYPES.has(detected.mime)) {
    throw badRequest('Only JPEG, PNG or WEBP images are allowed');
  }

  const filename = randomName('jpg');
  const outPath = path.join(PROPERTIES_DIR, filename);
  await sharp(buffer)
    .rotate() // apply EXIF orientation before stripping EXIF
    .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(outPath); // sharp does not copy EXIF/GPS metadata by default — it is dropped here

  return filename;
}

// Video is validated by magic bytes and size only (no re-encode — that needs ffmpeg, out of scope
// for this build) and written under a random filename; a virus/malware scan hook should sit here
// in front of any real production deployment (e.g. ClamAV) before the file is served publicly.
async function processVideo(buffer) {
  if (buffer.length > env.MAX_VIDEO_MB * 1024 * 1024) {
    throw badRequest(`Video must be under ${env.MAX_VIDEO_MB}MB`);
  }
  const detected = await detectFileType(buffer);
  if (!detected || !ALLOWED_VIDEO_TYPES.has(detected.mime)) {
    throw badRequest('Only MP4, MOV or WEBM videos are allowed');
  }
  const ext = detected.ext;
  const filename = randomName(ext);
  await fs.writeFile(path.join(PROPERTIES_DIR, filename), buffer);
  return filename;
}

module.exports = { photoUpload, videoUpload, processPhoto, processVideo };
