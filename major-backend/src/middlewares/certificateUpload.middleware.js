import multer from "multer";
import { ApiError } from "../utils/ApiError.js";

// Store in memory buffer so we can compute hash and validate magic bytes before committing to disk
const storage = multer.memoryStorage();

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const fileFilter = (req, file, cb) => {
    const ext = (file.originalname || "").toLowerCase().slice((file.originalname || "").lastIndexOf("."));
    const mime = (file.mimetype || "").toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(ext) || !ALLOWED_MIME_TYPES.includes(mime)) {
        return cb(
            new ApiError(
                400,
                "Unsupported file type. Please upload a certificate as JPG, JPEG, PNG, or PDF (up to 10MB)."
            ),
            false
        );
    }

    cb(null, true);
};

export const uploadCertificateFile = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: 1
    },
    fileFilter
});
