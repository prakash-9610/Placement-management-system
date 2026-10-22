import { PDFParse } from "pdf-parse";
import Tesseract from "tesseract.js";
import sharp from "sharp";
import jsQR from "jsqr";

/**
 * Common accredited issuing organizations.
 */
const KNOWN_ISSUERS = [
    { name: "Coursera", regex: /\b(?:coursera|coursera\.org)\b/i },
    { name: "DeepLearning.AI", regex: /\bdeeplearning(?:\.|\s*)ai\b/i },
    { name: "Stanford Online", regex: /\bstanford(?:\s+online|\s+university)?\b/i },
    { name: "Udemy", regex: /\b(?:udemy|udemy\.com)\b/i },
    { name: "Google", regex: /\bgoogle(?:\s+cloud)?\b/i },
    { name: "Amazon Web Services (AWS)", regex: /\b(?:aws|amazon\s+web\s+services)\b/i },
    { name: "Microsoft", regex: /\bmicrosoft(?:\s+learn)?\b/i },
    { name: "edX", regex: /\b(?:edx|edx\.org)\b/i },
    { name: "Credly", regex: /\bcredly\b/i },
    { name: "HackerRank", regex: /\bhackerrank\b/i },
    { name: "freeCodeCamp", regex: /\bfreecodecamp\b/i },
    { name: "Cisco", regex: /\bcisco(?:\s+networking\s+academy)?\b/i },
    { name: "IBM", regex: /\bibm(?:\s+skillsbuild)?\b/i },
    { name: "Harvard Online", regex: /\bharvard(?:\s+online|\s+x)?\b/i },
    { name: "Meta", regex: /\bmeta\b/i },
    { name: "BSERC", regex: /\b(?:bserc|bharat\s+space(?:\s+education)?(?:\s+and)?(?:\s+research)?(?:\s+centre)?)\b/i }
];

/**
 * Words that must NEVER be extracted as certificate IDs.
 */
const FORBIDDEN_CERTIFICATE_IDS = new Set([
    "COURSERA",
    "UDEMY",
    "STANFORD",
    "GOOGLE",
    "DEEPLEARNING",
    "AMAZON",
    "MICROSOFT",
    "BSERC",
    "BHARAT",
    "SPACE",
    "CERTIFICATE",
    "COMPLETION",
    "SUCCESSFULLY",
    "SPECIALIZATION",
    "VERIFICATION",
    "CREDENTIAL",
    "ACHIEVEMENT",
    "EDUCATION"
]);

/**
 * Image preprocessing to maximize OCR accuracy and eliminate background noise.
 */
export async function preprocessImageForOcr(buffer) {
    try {
        const metadata = await sharp(buffer).metadata();
        const width = metadata.width || 1200;

        // Upscale image if small (upscaling to ~2400px width significantly improves character sharpness)
        const targetWidth = Math.min(2800, Math.max(1800, width * 2));

        const processed = await sharp(buffer)
            .resize({ width: targetWidth, withoutEnlargement: false })
            .gamma(1.1)
            .sharpen({ sigma: 1.2 })
            .toBuffer();

        return processed;
    } catch (err) {
        console.warn("[OCR Service] Preprocessing fallback to raw buffer:", err.message);
        return buffer;
    }
}

/**
 * Scans image for QR code data using multi-region scans.
 */
export async function scanQrCodeFromImage(buffer) {
    try {
        const { data, info } = await sharp(buffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        // 1. Full image scan
        const code = jsQR(new Uint8ClampedArray(data), info.width, info.height);
        if (code?.data) {
            return code.data.trim();
        }

        // 2. Crop bottom 40% (where certificates usually place QR codes)
        const w = info.width;
        const h = info.height;
        const bottomCrop = await sharp(buffer)
            .extract({ left: 0, top: Math.floor(h * 0.6), width: w, height: Math.floor(h * 0.4) })
            .resize(w * 2)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const codeBottom = jsQR(
            new Uint8ClampedArray(bottomCrop.data),
            bottomCrop.info.width,
            bottomCrop.info.height
        );
        if (codeBottom?.data) {
            return codeBottom.data.trim();
        }
    } catch (err) {
        console.warn("[OCR Service] QR scan notice:", err.message);
    }
    return null;
}

/**
 * Extracts text and metadata from image or PDF buffer.
 */
export async function extractTextFromBuffer(buffer, mimeType, options = {}) {
    const timeoutMs = options.timeoutMs || 25000;

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("OCR extraction timed out")), timeoutMs)
    );

    try {
        const extractionPromise = (async () => {
            // 1. PDF Native Text Layer First
            if (mimeType === "application/pdf") {
                try {
                    const parser = new PDFParse({ data: buffer });
                    const result = await parser.getText();
                    const text = (typeof result === "string" ? result : result?.text || "").trim();
                    if (text && text.length > 25) {
                        return {
                            success: true,
                            rawText: text,
                            confidence: 95,
                            provider: "pdf-parse",
                            qrCodeData: null
                        };
                    }
                } catch (pdfErr) {
                    console.warn("[OCR Service] PDF text layer fallback to OCR:", pdfErr.message);
                }
            }

            // 2. Image Preprocessing & QR Code Scan
            let imageBuffer = buffer;
            let qrCodeData = null;

            if (mimeType.startsWith("image/")) {
                imageBuffer = await preprocessImageForOcr(buffer);
                qrCodeData = await scanQrCodeFromImage(buffer);
            }

            // 3. Tesseract OCR Recognition
            try {
                const ocrResult = await Tesseract.recognize(imageBuffer, "eng", {
                    logger: () => {}
                });

                const rawText = (ocrResult?.data?.text || "").trim();
                const confidence = Math.round(ocrResult?.data?.confidence || 0);

                return {
                    success: rawText.length > 0,
                    rawText,
                    confidence,
                    provider: "tesseract.js",
                    qrCodeData
                };
            } catch (tessErr) {
                console.warn("[OCR Service] Tesseract recognition failed:", tessErr.message);
                return {
                    success: false,
                    rawText: "",
                    confidence: 0,
                    provider: "tesseract.js",
                    qrCodeData,
                    error: tessErr.message
                };
            }
        })();

        return await Promise.race([extractionPromise, timeoutPromise]);
    } catch (err) {
        console.warn("[OCR Service] Extraction error:", err.message);
        return {
            success: false,
            rawText: "",
            confidence: 0,
            provider: "fallback",
            qrCodeData: null,
            error: err.message
        };
    }
}

/**
 * Parses and maps certificate fields from OCR text, QR data, and student input hints.
 */
export function parseCertificateMetadata(rawText = "", hints = {}) {
    const cleanText = (rawText || "").replace(/\r\n/g, "\n");

    // 1. Extract Verification URL (from QR data, clean OCR, or fuzzy recovery)
    let verificationUrl = "";

    // A. Check QR code data first
    if (hints.qrCodeContent && /^https?:\/\//i.test(hints.qrCodeContent.trim())) {
        verificationUrl = hints.qrCodeContent.trim();
    }

    // B. Check exact HTTPS regex
    if (!verificationUrl) {
        const stdMatch = cleanText.match(
            /https?:\/\/[^\s"'<>]+(?:verify|certificate|credentials|accomplishments|badges)[^\s"'<>]*/i
        );
        if (stdMatch) {
            verificationUrl = stdMatch[0].replace(/[.,;:)]+$/, "");
        }
    }

    // C. Fuzzy Recovery for common OCR misreads (e.g. "httpsi//coursera,org/verify/GDMJEQWC98DO")
    if (!verificationUrl) {
        const fuzzyCoursera = cleanText.match(
            /(?:https?[;i:]\/\/|www\.)?(?:coursera)[.,\s](?:org|com)\/(?:verify|account\/accomplishments\/verify)\/([A-Za-z0-9_-]{8,32})/i
        );
        if (fuzzyCoursera && fuzzyCoursera[1]) {
            verificationUrl = `https://coursera.org/verify/${fuzzyCoursera[1].trim()}`;
        }
    }

    if (!verificationUrl) {
        const verifyAtMatch = cleanText.match(
            /Verify\s*at\s*[:\s]+(?:https?[;i:]\/\/)?(?:[^\/\n]+\/)+([A-Za-z0-9_-]{8,32})/i
        );
        if (verifyAtMatch && verifyAtMatch[1]) {
            verificationUrl = `https://coursera.org/verify/${verifyAtMatch[1].trim()}`;
        }
    }

    // Fall back to student-entered URL if OCR could not find one
    if (!verificationUrl && hints.verificationUrl && /^https?:\/\//i.test(hints.verificationUrl.trim())) {
        verificationUrl = hints.verificationUrl.trim();
    }

    // 2. Extract Certificate / Credential ID
    let certificateId = "";

    // Extract directly from verification URL if present
    if (verificationUrl) {
        const idFromUrl = verificationUrl.match(/\/(?:verify|certificate|credentials)\/([A-Za-z0-9_-]{6,32})/i);
        if (idFromUrl && idFromUrl[1]) {
            const cand = idFromUrl[1].trim();
            if (!FORBIDDEN_CERTIFICATE_IDS.has(cand.toUpperCase())) {
                certificateId = cand;
            }
        }
    }

    // BSERC and structured credential ID patterns (e.g. BSERC-DSI-2026-1908)
    const structuredIdMatch = cleanText.match(/\b([A-Z]{2,10}-[A-Z0-9]+-[0-9]{4}-[0-9]+)\b/i);
    if (structuredIdMatch && structuredIdMatch[1]) {
        certificateId = structuredIdMatch[1].trim();
    }

    // Text ID patterns
    if (!certificateId) {
        const idPatterns = [
            /(?:Certificate\s*ID|Credential\s*ID|Certificate\s*Number|Certificate\s*No\.?)\s*[:#\-]?\s*([A-Za-z0-9_-]{6,32})/i,
            /(?:Verify\s*at\s*[^:\n]+[:\s]+)([A-Za-z0-9_-]{8,32})/i
        ];
        for (const pattern of idPatterns) {
            const match = cleanText.match(pattern);
            if (match && match[1]) {
                const cand = match[1].trim();
                if (!FORBIDDEN_CERTIFICATE_IDS.has(cand.toUpperCase())) {
                    certificateId = cand;
                    break;
                }
            }
        }
    }

    // Reject hint certificateId if it matches an issuer name or forbidden word
    if (!certificateId && hints.certificateId) {
        const hintCand = hints.certificateId.trim();
        if (!FORBIDDEN_CERTIFICATE_IDS.has(hintCand.toUpperCase())) {
            certificateId = hintCand;
        }
    }

    // 3. Extract Issuing Organization
    let issuer = "";
    for (const known of KNOWN_ISSUERS) {
        if (known.regex.test(cleanText)) {
            issuer = known.name;
            break;
        }
    }
    // If OCR text didn't isolate issuer but hint was provided, check if hint matches known issuer fuzzily (e.g. "Cousera" -> "Coursera")
    if (!issuer && hints.issuer) {
        const hintNorm = hints.issuer.trim().toLowerCase();
        for (const known of KNOWN_ISSUERS) {
            if (
                known.name.toLowerCase().includes(hintNorm) ||
                hintNorm.includes(known.name.toLowerCase().slice(0, 4))
            ) {
                issuer = known.name;
                break;
            }
        }
        if (!issuer) {
            issuer = hints.issuer.trim();
        }
    }

    // 4. Extract Student / Recipient Name
    let studentName = "";

    // Coursera format: name line right before "has successfully completed"
    const nameBeforeCompleted = cleanText.match(
        /([A-Z][a-zA-Z\s.'-]{2,40})\n+[^\n]*has\s+successfully\s+completed/i
    );
    if (nameBeforeCompleted && nameBeforeCompleted[1]) {
        const lines = nameBeforeCompleted[1]
            .split("\n")
            .map((l) => l.replace(/[^A-Za-z\s.'-]/g, "").trim())
            .filter((l) => l.length >= 3);
        const lastCandidate = lines[lines.length - 1];
        if (
            lastCandidate &&
            !/^(course|certificate|online|stanford|deeplearning|may|june|july|august|september|october|november|december)$/i.test(
                lastCandidate
            )
        ) {
            studentName = lastCandidate;
        }
    }

    if (!studentName) {
        const certPatterns = [
            /(?:certifies\s+that|awarded\s+to|presented\s+to|this\s+is\s+to\s+certify\s+that)\s+([A-Za-z\s.'-]{2,40})/i,
            /Certificate\s+of\s+Completion\s*\n+([A-Za-z\s.'-]{2,40})/i
        ];
        for (const p of certPatterns) {
            const m = cleanText.match(p);
            if (m && m[1]) {
                const cand = m[1].trim();
                if (!/^(the|a|an|course|online|completion|student)$/i.test(cand)) {
                    studentName = cand;
                    break;
                }
            }
        }
    }

    // Hint check: if student account name is present in document text
    if (!studentName && hints.studentName) {
        const normalizedHint = hints.studentName.trim();
        const hintRegex = new RegExp(`\\b${escapeRegExp(normalizedHint)}\\b`, "i");
        if (hintRegex.test(cleanText)) {
            studentName = normalizedHint;
        }
    }

    // 5. Extract Certificate / Course Title
    let certificateTitle = "";

    // Coursera specific multi-line bounding: between "has successfully completed" and "an online course authorized by"
    const courseraBlockMatch = cleanText.match(
        /has\s+successfully\s+completed[\s\S]*?\n+([\s\S]*?)\n+[^\n]*an\s+online\s+course\s+authorized\s+by/i
    );
    if (courseraBlockMatch && courseraBlockMatch[1]) {
        // Strip watermark tokens and non-title symbols
        const cleanLines = courseraBlockMatch[1]
            .split("\n")
            .map((l) =>
                l
                    .replace(/[{}\[\]()|\\\/~*^<>_]+/g, " ")
                    .replace(/\b(Dy|qs|AR|IES|Ne|NON|AN|TOR|oe|PAS|CAV)\b/gi, "")
                    .replace(/\s+/g, " ")
                    .trim()
            )
            .filter((l) => l.length > 3 && /[A-Za-z]{3,}/.test(l));

        if (cleanLines.length > 0) {
            let combined = cleanLines.join(" ").replace(/\s+/g, " ").trim();
            // Remove stray trailing symbols or single numbers/letters like "z : Classification 3 5" -> "Classification"
            combined = combined.replace(/\s+[a-z0-9]\s*:\s*/gi, " ");
            combined = combined.replace(/(\s+[a-z0-9]{1,2})+\s*$/i, "").trim();
            certificateTitle = combined;
        }
    }

    // General pattern matching
    if (!certificateTitle) {
        const titlePatterns = [
            /(?:Course\s+Certificate\s+in|Specialization\s+in|Certificate\s+of\s+Completion\s+in)\s+([A-Za-z0-9\s:,-]{3,80})/i,
            /(?:successfully\s+completed\s+(?:the\s+online\s+course|an\s+online\s+course|the\s+course)?\s*[:"']?)([A-Za-z0-9\s:,-]{4,80})/i
        ];
        for (const p of titlePatterns) {
            const m = cleanText.match(p);
            if (m && m[1]) {
                const cand = m[1].trim();
                if (cand.length >= 4 && !/^(course|completion|certificate)$/i.test(cand)) {
                    certificateTitle = cand;
                    break;
                }
            }
        }
    }

    // Hint fallback
    if (!certificateTitle && hints.certificateTitle) {
        certificateTitle = hints.certificateTitle.trim();
    }

    // Ensure issuing organization name is not mistaken for certificate/programme title
    if (certificateTitle) {
        const normTitle = certificateTitle.trim().toLowerCase();
        for (const known of KNOWN_ISSUERS) {
            if (known.regex.test(normTitle) || normTitle === "bharat space education and research") {
                if (!issuer) issuer = known.name;
                certificateTitle = "";
                break;
            }
        }
    }

    // 6. Extract Issue Date
    let issueDate = "";
    // Detect duration range (e.g. "June 19 to August 9, 2026")
    const durationMatch = cleanText.match(/\b[A-Za-z]+\s+\d{1,2}\s+to\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})\b/i);
    const durationEndDate = durationMatch ? durationMatch[1].trim() : null;

    const datePatterns = [
        /(?:issued\s+on|completed\s+on|date\s*[:]?)\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
        /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i,
        /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/i,
        /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/,
        /\b(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/
    ];

    // Prefer standalone dates over duration end dates
    for (const p of datePatterns) {
        const matches = cleanText.matchAll(new RegExp(p.source, "gi"));
        for (const m of matches) {
            const cand = m[1]?.trim();
            if (cand && cand !== durationEndDate) {
                issueDate = cand;
                break;
            } else if (cand && !issueDate) {
                issueDate = cand;
            }
        }
        if (issueDate && issueDate !== durationEndDate) break;
    }

    if (!issueDate && hints.issueDate) {
        issueDate = hints.issueDate;
    }

    const parseSuccess = Boolean(
        studentName || (certificateTitle && certificateTitle.length > 3) || issuer || certificateId || verificationUrl
    );

    return {
        studentName: studentName || hints.studentName || "",
        certificateTitle: certificateTitle || hints.certificateTitle || "",
        issuer: issuer || hints.issuer || "",
        certificateId: certificateId || "",
        verificationUrl: verificationUrl || hints.verificationUrl || "",
        issueDate: issueDate || "",
        expirationDate: hints.expirationDate || "",
        qrCodeData: hints.qrCodeContent || "",
        parseSuccess
    };
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
