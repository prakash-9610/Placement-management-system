import fs from "fs";
import path from "path";
import crypto from "crypto";

const CERTIFICATES_DIR = path.resolve(process.env.CERTIFICATE_UPLOAD_DIR || "./uploads/certificates");

// Ensure directory exists
if (!fs.existsSync(CERTIFICATES_DIR)) {
    fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
}

/**
 * Validates actual file content signature (magic bytes) against declared MIME type.
 * Protects against renamed malicious files or polyglot payloads.
 */
export function validateFileMagicBytes(buffer, mimeType) {
    if (!buffer || buffer.length < 8) {
        return { isValid: false, detectedType: "unknown", error: "File buffer is too small or empty" };
    }

    // PDF magic bytes: %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
    if (
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46 &&
        buffer[4] === 0x2D
    ) {
        return {
            isValid: mimeType === "application/pdf",
            detectedType: "application/pdf",
            error: mimeType === "application/pdf" ? null : `MIME type mismatch: declared '${mimeType}' but file is PDF`
        };
    }

    // PNG magic bytes: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0D &&
        buffer[5] === 0x0A &&
        buffer[6] === 0x1A &&
        buffer[7] === 0x0A
    ) {
        return {
            isValid: mimeType === "image/png",
            detectedType: "image/png",
            error: mimeType === "image/png" ? null : `MIME type mismatch: declared '${mimeType}' but file is PNG`
        };
    }

    // JPEG magic bytes: 0xFF 0xD8 0xFF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return {
            isValid: mimeType === "image/jpeg" || mimeType === "image/jpg",
            detectedType: "image/jpeg",
            error:
                mimeType === "image/jpeg" || mimeType === "image/jpg"
                    ? null
                    : `MIME type mismatch: declared '${mimeType}' but file is JPEG`
        };
    }

    return {
        isValid: false,
        detectedType: "unknown",
        error: "Unsupported or invalid file signature. Expected valid JPG, PNG, or PDF file content."
    };
}

/**
 * Calculates cryptographic SHA-256 hash of a file buffer or stream.
 */
export function calculateFileHash(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Stores uploaded certificate privately on local disk.
 */
export async function storeCertificateLocally(buffer, originalName, mimeType) {
    if (!fs.existsSync(CERTIFICATES_DIR)) {
        fs.mkdirSync(CERTIFICATES_DIR, { recursive: true });
    }

    const fileHash = calculateFileHash(buffer);
    const sanitizedBase = path
        .basename(originalName)
        .replace(/[^a-zA-Z0-9.-]/g, "_")
        .substring(0, 80);
    const ext = path.extname(sanitizedBase).toLowerCase() || (mimeType === "application/pdf" ? ".pdf" : ".jpg");
    const storageKey = `cert_${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
    const destinationPath = path.join(CERTIFICATES_DIR, storageKey);

    await fs.promises.writeFile(destinationPath, buffer);

    return {
        storageKey,
        localPath: destinationPath,
        fileHash,
        fileSize: buffer.length,
        originalName,
        mimeType
    };
}

/**
 * Retrieves certificate file path safely, ensuring no path traversal.
 */
export function getCertificateLocalPath(storageKey) {
    if (!storageKey || typeof storageKey !== "string") return null;

    // Sanitize to prevent path traversal
    const safeKey = path.basename(storageKey);
    const filePath = path.join(CERTIFICATES_DIR, safeKey);

    if (fs.existsSync(filePath)) {
        return filePath;
    }
    return null;
}

/**
 * Safely removes a stored certificate file from disk.
 */
export async function deleteStoredCertificate(storageKey) {
    try {
        const filePath = getCertificateLocalPath(storageKey);
        if (filePath && fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            return true;
        }
    } catch (err) {
        console.warn(`[Certificate Storage] Failed to delete file ${storageKey}:`, err.message);
    }
    return false;
}
