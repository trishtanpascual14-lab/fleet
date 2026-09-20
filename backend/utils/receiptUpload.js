const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MAX_RECEIPT_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'receipts');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_SIZE, files: 1, fields: 30 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file.originalname || '')).toLowerCase();
    if (!ALLOWED[ext] || ALLOWED[ext] !== file.mimetype) {
      return cb(Object.assign(
        new Error('Only JPG, JPEG, PNG and WEBP receipt images are allowed (max 10 MB).'),
        { statusCode: 400 }
      ));
    }
    cb(null, true);
  },
});

// Reject executables / spoofed files by checking magic bytes (not just extension/MIME).
function hasValidMagic(buf, ext) {
  if (!buf || buf.length < 12) return false;
  if (ext === '.png') return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (ext === '.jpg' || ext === '.jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (ext === '.webp') return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function validationError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

// Validate + persist the uploaded receipt. Never uses the client filename as
// a storage path (random server-side name inside a fixed directory).
function saveReceiptFile(file) {
  if (!file || !file.buffer) throw validationError('Receipt file is missing.');
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  if (!ALLOWED[ext]) throw validationError('Only JPG, JPEG, PNG and WEBP receipt images are allowed (max 10 MB).');
  if (ALLOWED[ext] !== file.mimetype) throw validationError('Receipt MIME type does not match its file extension.');
  if (file.size > MAX_RECEIPT_SIZE) throw validationError('Receipt image must not exceed 10 MB.');
  if (!hasValidMagic(file.buffer, ext)) {
    throw validationError('Uploaded file is not a valid image. Executable files are not allowed.');
  }
  const safeName = `receipt-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const dest = path.join(UPLOAD_DIR, path.basename(safeName)); // basename: no path traversal
  fs.writeFileSync(dest, file.buffer);
  return {
    receipt_path: `receipts/${path.basename(safeName)}`,
    receipt_original_name: String(file.originalname || '').slice(0, 255),
    receipt_mime: file.mimetype,
    receipt_size: file.size,
  };
}

function deleteReceiptFile(receiptPath) {
  try {
    if (!receiptPath) return;
    const abs = path.join(UPLOAD_DIR, path.basename(String(receiptPath)));
    if (abs.startsWith(UPLOAD_DIR)) fs.unlinkSync(abs);
  } catch { /* already gone — ignore */ }
}

// Multer wrapper that converts upload errors into 400 validation responses.
function uploadReceiptSingle(req, res, next) {
  upload.single('receipt')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Receipt image must not exceed 10 MB.'
        : (err.message || 'Invalid receipt upload.');
      return res.status(400).json({ success: false, message: 'Validation failed', errors: { receipt: msg } });
    }
    next();
  });
}

module.exports = {
  UPLOAD_DIR,
  MAX_RECEIPT_SIZE,
  ALLOWED_RECEIPT_TYPES: ALLOWED,
  uploadReceiptSingle,
  saveReceiptFile,
  deleteReceiptFile,
  hasValidMagic,
};
