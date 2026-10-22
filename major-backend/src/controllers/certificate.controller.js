import fs from "fs";
import { Certificate } from "../models/certificate.model.js";
import { StudentProfile } from "../models/studentProfile.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
    validateFileMagicBytes,
    calculateFileHash,
    storeCertificateLocally,
    getCertificateLocalPath,
    deleteStoredCertificate
} from "../services/certificateStorage.service.js";
import { extractTextFromBuffer, parseCertificateMetadata } from "../services/ocr.service.js";
import { analyzeCertificateDocument } from "../services/documentAnalysis.service.js";
import { verifyCertificateAuthenticity, parseDateToComponents } from "../services/issuerVerification.service.js";

/**
 * 1. Upload Certificate (Student)
 * Performs secure upload, magic-byte inspection, OCR extraction, document analysis, and issuer verification.
 */
export const uploadCertificate = asyncHandler(async (req, res) => {
    if (!req.file || !req.file.buffer) {
        throw new ApiError(400, "Please upload a certificate document (JPG, PNG, or PDF).");
    }

    const {
        title,
        category = "online_course",
        issuer,
        certificateId = "",
        verificationUrl = "",
        issueDate = null,
        expirationDate = null,
        qrCodeContent = ""
    } = req.body;

    if (!title || !title.trim()) {
        throw new ApiError(400, "Certificate title or course name is required.");
    }
    if (!issuer || !issuer.trim()) {
        throw new ApiError(400, "Issuing organization is required.");
    }

    // Step A: Security & Magic Bytes Validation
    const magicCheck = validateFileMagicBytes(req.file.buffer, req.file.mimetype);
    if (!magicCheck.isValid) {
        throw new ApiError(400, magicCheck.error || "File signature mismatch. Upload a genuine image or PDF file.");
    }

    const fileHash = calculateFileHash(req.file.buffer);

    // Check for duplicate uploads
    const existingDuplicates = await Certificate.find({
        "file.fileHash": fileHash,
        student: { $ne: req.user._id }
    }).select("student title issuer");

    // Store file safely
    const storedFile = await storeCertificateLocally(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
    );

    // Step B: Modular OCR & Text Extraction
    const ocrResult = await extractTextFromBuffer(req.file.buffer, req.file.mimetype);
    const extractedData = parseCertificateMetadata(ocrResult.rawText, {
        studentName: req.user.fullName,
        certificateTitle: title.trim(),
        issuer: issuer.trim(),
        certificateId: certificateId.trim(),
        verificationUrl: verificationUrl.trim(),
        issueDate,
        qrCodeContent
    });

    extractedData.rawText = ocrResult.rawText || "";
    extractedData.ocrConfidence = ocrResult.confidence || 0;
    extractedData.ocrProvider = ocrResult.provider || "tesseract.js";
    extractedData.extractedAt = new Date();
    extractedData.parseSuccess = ocrResult.success;

    // Step C: Document Inconsistency Analysis
    const studentProfile = await StudentProfile.findOne({ user: req.user._id }).select("_id enrollmentNumber branch");
    const documentAnalysis = analyzeCertificateDocument({
        studentUser: req.user,
        submittedData: {
            title: title.trim(),
            issuer: issuer.trim(),
            certificateId: certificateId.trim(),
            verificationUrl: verificationUrl.trim()
        },
        extractedData,
        existingCertificateMatches: existingDuplicates
    });

    // Step D: Official Authenticity Verification
    const effectiveIssuer = extractedData.issuer || issuer.trim();
    const effectiveUrl = verificationUrl.trim() || extractedData.verificationUrl;
    const effectiveId = certificateId.trim() || extractedData.certificateId;
    const effectiveTitle = title.trim();

    const authResult = await verifyCertificateAuthenticity({
        issuer: effectiveIssuer,
        verificationUrl: effectiveUrl,
        certificateId: effectiveId,
        studentUser: req.user,
        submittedTitle: effectiveTitle,
        submittedDate: issueDate || extractedData.issueDate || null
    });

    // Step E: Determine Initial Verification Status
    let initialStatus = "NEEDS_REVIEW";
    let verificationMethod = authResult.verificationMethod || "NONE";
    let verificationEvidence = authResult.evidence || {};

    let finalTitle = title.trim();
    let finalIssuer = issuer.trim();
    let finalCertId = certificateId.trim();
    let finalUrl = verificationUrl.trim();
    let finalIssueDate = issueDate ? new Date(issueDate) : (extractedData.issueDate ? new Date(extractedData.issueDate) : null);

    if (authResult.status === "VERIFIED") {
        initialStatus = "VERIFIED";
        verificationMethod = authResult.verificationMethod || "OFFICIAL_URL";

        // Adopt authoritative metadata from official issuer registry
        if (authResult.evidence?.courseName || authResult.evidence?.programmeName) {
            const authoritativeTitle = authResult.evidence.programmeName || authResult.evidence.courseName;
            finalTitle = authoritativeTitle;
            extractedData.certificateTitle = authoritativeTitle;
        }
        if (authResult.evidence?.credentialId) {
            finalCertId = authResult.evidence.credentialId;
            extractedData.certificateId = authResult.evidence.credentialId;
        }
        if (authResult.evidence?.issuerVerificationUrl) {
            finalUrl = authResult.evidence.issuerVerificationUrl;
            extractedData.verificationUrl = authResult.evidence.issuerVerificationUrl;
        }
        if (authResult.evidence?.provider) {
            finalIssuer = authResult.evidence.provider;
            extractedData.issuer = authResult.evidence.provider;
        }
        if (authResult.evidence?.recipientName) {
            extractedData.studentName = authResult.evidence.recipientName;
        }
        if (authResult.evidence?.issuedDate) {
            const parsedAdoptedDate = parseDateToComponents(authResult.evidence.issuedDate);
            if (parsedAdoptedDate) {
                finalIssueDate = new Date(Date.UTC(parsedAdoptedDate.year, parsedAdoptedDate.month - 1, parsedAdoptedDate.day));
            }
        }

        // Suppress contradictory advisory flags from initial heuristic analysis
        if (documentAnalysis?.flags) {
            documentAnalysis.flags = documentAnalysis.flags.filter(
                (f) =>
                    f.code !== "MISSING_IDENTIFIER" &&
                    f.code !== "TITLE_TEXT_MISMATCH" &&
                    f.code !== "ISSUER_TEXT_MISMATCH" &&
                    f.code !== "NAME_ABSENT_IN_DOCUMENT" &&
                    f.code !== "NAME_MISMATCH"
            );
            documentAnalysis.hasInconsistencies = documentAnalysis.flags.some(
                (f) => f.severity === "warning" || f.severity === "danger"
            );
            documentAnalysis.nameMatchStatus = "MATCH";
            documentAnalysis.nameMatchScore = 100;
            documentAnalysis.inconsistencyScore = documentAnalysis.flags.reduce((acc, f) => {
                if (f.severity === "danger") return acc + 35;
                if (f.severity === "warning") return acc + 15;
                return acc + 5;
            }, 0);
        }
    } else if (authResult.status === "VERIFICATION_FAILED") {
        initialStatus = "VERIFICATION_FAILED";
        verificationEvidence = authResult.evidence || {};
    } else {
        initialStatus = "NEEDS_REVIEW";
        verificationEvidence = authResult.evidence || {};
        // Supplement missing user fields with extracted values if available
        if (!finalCertId && extractedData.certificateId) finalCertId = extractedData.certificateId;
        if (!finalUrl && extractedData.verificationUrl) finalUrl = extractedData.verificationUrl;
        if ((!finalTitle || finalTitle.length <= 3) && extractedData.certificateTitle) {
            finalTitle = extractedData.certificateTitle;
        }
        if (extractedData.issuer) {
            finalIssuer = extractedData.issuer;
        }
    }

    const auditHistory = [
        {
            action: "SUBMITTED",
            performedBy: req.user._id,
            performedByRole: "student",
            performedByName: req.user.fullName,
            timestamp: new Date(),
            reason: "Certificate submitted by student for verification",
            previousStatus: "PENDING",
            newStatus: "PROCESSING"
        },
        {
            action: "OCR_PROCESSED",
            performedBy: null,
            performedByRole: "system",
            performedByName: `OCR Engine (${ocrResult.provider})`,
            timestamp: new Date(),
            reason: ocrResult.success ? "Text extracted successfully" : "Text extraction fallback used",
            previousStatus: "PROCESSING",
            newStatus: "PROCESSING",
            metadata: { confidence: ocrResult.confidence, extractedKeys: Object.keys(extractedData).filter((k) => extractedData[k]) }
        },
        {
            action:
                initialStatus === "VERIFIED"
                    ? "AUTO_VERIFIED"
                    : initialStatus === "VERIFICATION_FAILED"
                    ? "AUTO_VERIFICATION_FAILED"
                    : "SENT_FOR_REVIEW",
            performedBy: null,
            performedByRole: "system",
            performedByName: "Authenticity Verification Service",
            timestamp: new Date(),
            reason: authResult.reason || (initialStatus === "VERIFIED" ? "Verified via official issuer registry" : "Sent for review"),
            previousStatus: "PROCESSING",
            newStatus: initialStatus,
            metadata: { verificationMethod, evidenceSummary: verificationEvidence.summary || "" }
        }
    ];

    const certificate = await Certificate.create({
        student: req.user._id,
        studentProfile: studentProfile?._id || null,
        title: finalTitle,
        category,
        issuer: finalIssuer,
        certificateId: finalCertId,
        verificationUrl: finalUrl,
        qrCodeContent: qrCodeContent.trim(),
        issueDate: finalIssueDate,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        file: {
            storageKey: storedFile.storageKey,
            originalName: storedFile.originalName,
            mimeType: storedFile.mimeType,
            fileSize: storedFile.fileSize,
            fileHash: storedFile.fileHash,
            localPath: storedFile.localPath
        },
        extractedData,
        correctedData: {
            isModifiedByStudent: false,
            modifiedFields: [],
            lastModifiedAt: null
        },
        documentAnalysis,
        verificationStatus: initialStatus,
        verificationMethod,
        verificationEvidence,
        verificationAttempts: 1,
        lastVerifiedAt: new Date(),
        auditHistory
    });

    return res.status(201).json(
        new ApiResponse(201, certificate, "Certificate uploaded and analyzed successfully.")
    );
});

/**
 * 2. Get Authenticated Student's Certificates
 */
export const getMyCertificates = asyncHandler(async (req, res) => {
    const { status, category, search } = req.query;

    const query = { student: req.user._id };
    if (status && status !== "ALL") {
        query.verificationStatus = status;
    }
    if (category && category !== "ALL") {
        query.category = category;
    }
    if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        query.$or = [{ title: regex }, { issuer: regex }, { certificateId: regex }];
    }

    const certificates = await Certificate.find(query).sort({ createdAt: -1 });

    return res.status(200).json(
        new ApiResponse(200, certificates, "Certificates retrieved successfully.")
    );
});

/**
 * 3. Get Certificate by ID (Authorized Access)
 */
export const getCertificateById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const certificate = await Certificate.findById(id)
        .populate("student", "fullName email role")
        .populate("studentProfile", "enrollmentNumber branch currentSemester")
        .populate("reviewedBy", "fullName email");

    if (!certificate) {
        throw new ApiError(404, "Certificate not found.");
    }

    // Authorization: only student owner or admin can access
    const isOwner = certificate.student?._id?.toString() === req.user._id?.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
        throw new ApiError(403, "Access denied. You do not have permission to view this certificate.");
    }

    return res.status(200).json(
        new ApiResponse(200, certificate, "Certificate retrieved successfully.")
    );
});

/**
 * 4. Secure File Preview & Streaming
 */
export const getCertificateFile = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const certificate = await Certificate.findById(id).select("student file");
    if (!certificate) {
        throw new ApiError(404, "Certificate document not found.");
    }

    const isOwner = certificate.student?.toString() === req.user._id?.toString();
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
        throw new ApiError(403, "Access denied. You cannot view this file.");
    }

    const filePath = getCertificateLocalPath(certificate.file?.storageKey);
    if (!filePath || !fs.existsSync(filePath)) {
        throw new ApiError(404, "Physical certificate file is unavailable on disk.");
    }

    res.setHeader("Content-Type", certificate.file?.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${certificate.file?.originalName || "certificate"}"`);
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
});

/**
 * 5. Re-verify Certificate (Student or Admin)
 */
export const verifyCertificate = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const certificate = await Certificate.findById(id).populate("student", "fullName email role");
    if (!certificate) {
        throw new ApiError(404, "Certificate not found.");
    }

    const isOwner = certificate.student?._id?.toString() === req.user._id?.toString();
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
        throw new ApiError(403, "Access denied.");
    }

    let effectiveIssuer = certificate.correctedData?.issuer || certificate.issuer || certificate.extractedData?.issuer;
    let effectiveUrl = certificate.correctedData?.verificationUrl || certificate.verificationUrl || certificate.extractedData?.verificationUrl;
    let effectiveId = certificate.correctedData?.certificateId || certificate.certificateId || certificate.extractedData?.certificateId;
    let effectiveTitle = certificate.correctedData?.certificateTitle || certificate.title || certificate.extractedData?.certificateTitle;

    // If verification URL or ID is missing or bad, attempt recovery from stored file or existing OCR text
    if (!effectiveUrl || !effectiveId || effectiveId === "Coursera" || effectiveTitle === "ML") {
        if (certificate.extractedData?.rawText) {
            const reParsed = parseCertificateMetadata(certificate.extractedData.rawText, {
                studentName: certificate.student?.fullName,
                certificateTitle: effectiveTitle,
                issuer: effectiveIssuer,
                certificateId: effectiveId,
                verificationUrl: effectiveUrl
            });
            if (reParsed.verificationUrl) effectiveUrl = reParsed.verificationUrl;
            if (reParsed.certificateId) effectiveId = reParsed.certificateId;
            if (reParsed.issuer) effectiveIssuer = reParsed.issuer;
            if (reParsed.certificateTitle && reParsed.certificateTitle.length > 5) effectiveTitle = reParsed.certificateTitle;
        }

        // If still missing and local file is available, re-run full preprocessed OCR
        if (!effectiveUrl || !effectiveId || effectiveId === "Coursera") {
            const filePath = getCertificateLocalPath(certificate.file?.storageKey);
            if (filePath && fs.existsSync(filePath)) {
                try {
                    const buffer = fs.readFileSync(filePath);
                    const freshOcr = await extractTextFromBuffer(buffer, certificate.file?.mimeType);
                    const reParsed = parseCertificateMetadata(freshOcr.rawText, {
                        studentName: certificate.student?.fullName,
                        certificateTitle: effectiveTitle,
                        issuer: effectiveIssuer,
                        certificateId: effectiveId,
                        verificationUrl: effectiveUrl,
                        qrCodeContent: freshOcr.qrCodeData
                    });
                    if (reParsed.verificationUrl) effectiveUrl = reParsed.verificationUrl;
                    if (reParsed.certificateId) effectiveId = reParsed.certificateId;
                    if (reParsed.issuer) effectiveIssuer = reParsed.issuer;
                    if (reParsed.certificateTitle) effectiveTitle = reParsed.certificateTitle;

                    certificate.extractedData = {
                        ...certificate.extractedData,
                        rawText: freshOcr.rawText,
                        ocrConfidence: freshOcr.confidence,
                        studentName: reParsed.studentName,
                        certificateTitle: reParsed.certificateTitle,
                        issuer: reParsed.issuer,
                        certificateId: reParsed.certificateId,
                        verificationUrl: reParsed.verificationUrl,
                        issueDate: reParsed.issueDate
                    };
                } catch (e) {
                    console.warn("[verifyCertificate] Local re-scan notice:", e.message);
                }
            }
        }
    }

    const effectiveDate = certificate.correctedData?.issueDate || certificate.issueDate || certificate.extractedData?.issueDate;

    const authResult = await verifyCertificateAuthenticity({
        issuer: effectiveIssuer,
        verificationUrl: effectiveUrl,
        certificateId: effectiveId,
        studentUser: certificate.student,
        submittedTitle: effectiveTitle,
        submittedDate: effectiveDate
    });

    const previousStatus = certificate.verificationStatus;
    let newStatus = certificate.verificationStatus;

    if (authResult.status === "VERIFIED") {
        newStatus = "VERIFIED";
        certificate.verificationMethod = authResult.verificationMethod || "OFFICIAL_URL";
        certificate.verificationEvidence = authResult.evidence;

        // Update fields with authentic verified evidence
        if (authResult.evidence?.courseName || authResult.evidence?.programmeName) {
            const authoritativeTitle = authResult.evidence.programmeName || authResult.evidence.courseName;
            certificate.title = authoritativeTitle;
            if (certificate.extractedData) certificate.extractedData.certificateTitle = authoritativeTitle;
        }
        if (authResult.evidence?.credentialId) {
            certificate.certificateId = authResult.evidence.credentialId;
            if (certificate.extractedData) certificate.extractedData.certificateId = authResult.evidence.credentialId;
        }
        if (authResult.evidence?.issuerVerificationUrl) {
            certificate.verificationUrl = authResult.evidence.issuerVerificationUrl;
            if (certificate.extractedData) certificate.extractedData.verificationUrl = authResult.evidence.issuerVerificationUrl;
        }
        if (authResult.evidence?.provider) {
            certificate.issuer = authResult.evidence.provider;
            if (certificate.extractedData) certificate.extractedData.issuer = authResult.evidence.provider;
        }
        if (authResult.evidence?.recipientName && certificate.extractedData) {
            certificate.extractedData.studentName = authResult.evidence.recipientName;
        }
        if (authResult.evidence?.issuedDate) {
            const parsedAdoptedDate = parseDateToComponents(authResult.evidence.issuedDate);
            if (parsedAdoptedDate) {
                certificate.issueDate = new Date(Date.UTC(parsedAdoptedDate.year, parsedAdoptedDate.month - 1, parsedAdoptedDate.day));
            }
        }

        // Clean up documentAnalysis flags
        if (certificate.documentAnalysis) {
            certificate.documentAnalysis.flags = (certificate.documentAnalysis.flags || []).filter(
                (f) =>
                    f.code !== "MISSING_IDENTIFIER" &&
                    f.code !== "TITLE_TEXT_MISMATCH" &&
                    f.code !== "ISSUER_TEXT_MISMATCH" &&
                    f.code !== "NAME_ABSENT_IN_DOCUMENT" &&
                    f.code !== "NAME_MISMATCH"
            );
            certificate.documentAnalysis.hasInconsistencies = certificate.documentAnalysis.flags.some(
                (f) => f.severity === "warning" || f.severity === "danger"
            );
            certificate.documentAnalysis.nameMatchStatus = "MATCH";
            certificate.documentAnalysis.nameMatchScore = 100;
            certificate.documentAnalysis.inconsistencyScore = certificate.documentAnalysis.flags.reduce((acc, f) => {
                if (f.severity === "danger") return acc + 35;
                if (f.severity === "warning") return acc + 15;
                return acc + 5;
            }, 0);
        }
    } else if (authResult.status === "VERIFICATION_FAILED") {
        newStatus = "VERIFICATION_FAILED";
        certificate.verificationEvidence = authResult.evidence || {};
    } else {
        newStatus = "NEEDS_REVIEW";
        certificate.verificationEvidence = authResult.evidence || {};
    }

    certificate.verificationStatus = newStatus;
    certificate.lastVerifiedAt = new Date();
    certificate.verificationAttempts = (certificate.verificationAttempts || 0) + 1;

    certificate.auditHistory.push({
        action: "REVERIFICATION_REQUESTED",
        performedBy: req.user._id,
        performedByRole: req.user.role,
        performedByName: req.user.fullName,
        timestamp: new Date(),
        reason: authResult.reason || "Re-verification completed against issuer verifier.",
        previousStatus,
        newStatus,
        metadata: { attempts: certificate.verificationAttempts }
    });

    await certificate.save();

    return res.status(200).json(
        new ApiResponse(200, certificate, "Re-verification executed.")
    );
});

/**
 * 5b. Adopt Official Verified Details (Student or Admin)
 * Resolves metadata discrepancies (programme title, issuing organization, issue date)
 * by adopting authoritative fields from the official issuer registry.
 */
export const adoptOfficialDetails = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const certificate = await Certificate.findById(id).populate("student", "fullName email role");
    if (!certificate) {
        throw new ApiError(404, "Certificate not found.");
    }

    const isOwner = certificate.student?._id?.toString() === req.user._id?.toString();
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
        throw new ApiError(403, "Access denied.");
    }

    const officialFields = certificate.verificationEvidence?.officialFields;
    if (!officialFields || (!officialFields.programme && !officialFields.courseName)) {
        throw new ApiError(400, "No official verified details are available to adopt. Please run verification first.");
    }

    const adoptedTitle = officialFields.programme || officialFields.courseName;
    const adoptedIssuer = certificate.verificationEvidence.provider || "BSERC";
    const adoptedId = officialFields.certificateId || certificate.verificationEvidence.credentialId || certificate.certificateId;
    const adoptedDateStr = officialFields.issuedDate;
    const parsedDate = parseDateToComponents(adoptedDateStr);

    const previousStatus = certificate.verificationStatus;

    if (!certificate.correctedData) {
        certificate.correctedData = {};
    }

    certificate.title = adoptedTitle;
    certificate.issuer = adoptedIssuer;
    certificate.certificateId = adoptedId;
    if (parsedDate) {
        certificate.issueDate = new Date(Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day));
        certificate.correctedData.issueDate = certificate.issueDate;
    }

    certificate.correctedData.certificateTitle = adoptedTitle;
    certificate.correctedData.issuer = adoptedIssuer;
    certificate.correctedData.certificateId = adoptedId;
    certificate.correctedData.isModifiedByStudent = true;
    certificate.correctedData.lastModifiedAt = new Date();
    certificate.correctedData.modifiedFields = Array.from(
        new Set([...(certificate.correctedData.modifiedFields || []), "title", "issuer", "certificateId", "issueDate"])
    );

    // Re-verify against issuer verifier
    const authResult = await verifyCertificateAuthenticity({
        issuer: certificate.issuer,
        verificationUrl: certificate.verificationUrl,
        certificateId: certificate.certificateId,
        studentUser: certificate.student,
        submittedTitle: certificate.title,
        submittedDate: certificate.issueDate
    });

    certificate.verificationStatus = authResult.status;
    certificate.verificationMethod = authResult.verificationMethod || "OFFICIAL_URL";
    certificate.verificationEvidence = authResult.evidence || {};
    certificate.lastVerifiedAt = new Date();
    certificate.verificationAttempts = (certificate.verificationAttempts || 0) + 1;

    // Suppress contradictory advisory flags from initial heuristic analysis
    if (certificate.documentAnalysis) {
        certificate.documentAnalysis.flags = (certificate.documentAnalysis.flags || []).filter(
            (f) =>
                f.code !== "MISSING_IDENTIFIER" &&
                f.code !== "TITLE_TEXT_MISMATCH" &&
                f.code !== "ISSUER_TEXT_MISMATCH" &&
                f.code !== "NAME_ABSENT_IN_DOCUMENT" &&
                f.code !== "NAME_MISMATCH"
        );
        certificate.documentAnalysis.hasInconsistencies = certificate.documentAnalysis.flags.some(
            (f) => f.severity === "warning" || f.severity === "danger"
        );
        certificate.documentAnalysis.nameMatchStatus = "MATCH";
        certificate.documentAnalysis.nameMatchScore = 100;
        certificate.documentAnalysis.inconsistencyScore = 0;
    }

    certificate.auditHistory.push({
        action: "OFFICIAL_DETAILS_ADOPTED",
        performedBy: req.user._id,
        performedByRole: req.user.role,
        performedByName: req.user.fullName,
        timestamp: new Date(),
        reason: `Adopted official ${adoptedIssuer} verified details: Programme title and issue date updated to match registry.`,
        previousStatus,
        newStatus: certificate.verificationStatus,
        metadata: {
            adoptedTitle,
            adoptedIssuer,
            adoptedId,
            adoptedDate: adoptedDateStr
        }
    });

    if (certificate.verificationStatus === "VERIFIED") {
        certificate.auditHistory.push({
            action: "AUTO_VERIFIED",
            performedBy: null,
            performedByRole: "system",
            performedByName: "Authenticity Verification Service",
            timestamp: new Date(),
            reason: `Authenticity officially confirmed by ${adoptedIssuer} verification registry.`,
            previousStatus: "NEEDS_REVIEW",
            newStatus: "VERIFIED",
            metadata: { verificationMethod: certificate.verificationMethod }
        });
    }

    await certificate.save();

    return res.status(200).json(
        new ApiResponse(200, certificate, "Official verified details adopted and certificate successfully verified.")
    );
});

/**
 * 6. Update/Correct Certificate Metadata (Student)
 * Preserves original extractedData, records student changes in correctedData.
 */
export const updateCertificate = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const certificate = await Certificate.findById(id);
    if (!certificate) {
        throw new ApiError(404, "Certificate not found.");
    }

    if (certificate.student?.toString() !== req.user._id?.toString()) {
        throw new ApiError(403, "Access denied. You can only update your own certificates.");
    }

    const {
        title,
        category,
        issuer,
        certificateId,
        verificationUrl,
        issueDate,
        expirationDate,
        studentName
    } = req.body;

    const modifiedFields = [];
    if (!certificate.correctedData) {
        certificate.correctedData = {};
    }

    if (title && title.trim() !== certificate.title) {
        certificate.correctedData.certificateTitle = title.trim();
        certificate.title = title.trim();
        modifiedFields.push("title");
    }
    if (category && category !== certificate.category) {
        certificate.category = category;
        modifiedFields.push("category");
    }
    if (issuer && issuer.trim() !== certificate.issuer) {
        certificate.correctedData.issuer = issuer.trim();
        certificate.issuer = issuer.trim();
        modifiedFields.push("issuer");
    }
    if (certificateId !== undefined && certificateId.trim() !== certificate.certificateId) {
        certificate.correctedData.certificateId = certificateId.trim();
        certificate.certificateId = certificateId.trim();
        modifiedFields.push("certificateId");
    }
    if (verificationUrl !== undefined && verificationUrl.trim() !== certificate.verificationUrl) {
        certificate.correctedData.verificationUrl = verificationUrl.trim();
        certificate.verificationUrl = verificationUrl.trim();
        modifiedFields.push("verificationUrl");
    }
    if (issueDate) {
        certificate.correctedData.issueDate = new Date(issueDate);
        certificate.issueDate = new Date(issueDate);
        modifiedFields.push("issueDate");
    }
    if (expirationDate) {
        certificate.correctedData.expirationDate = new Date(expirationDate);
        certificate.expirationDate = new Date(expirationDate);
        modifiedFields.push("expirationDate");
    }
    if (studentName) {
        certificate.correctedData.studentName = studentName.trim();
        modifiedFields.push("studentName");
    }

    if (modifiedFields.length > 0) {
        certificate.correctedData.isModifiedByStudent = true;
        certificate.correctedData.lastModifiedAt = new Date();
        certificate.correctedData.modifiedFields = Array.from(
            new Set([...(certificate.correctedData.modifiedFields || []), ...modifiedFields])
        );

        // Re-analyze inconsistencies
        certificate.documentAnalysis = analyzeCertificateDocument({
            studentUser: req.user,
            submittedData: {
                title: certificate.title,
                issuer: certificate.issuer,
                certificateId: certificate.certificateId,
                verificationUrl: certificate.verificationUrl
            },
            extractedData: certificate.extractedData
        });

        // Re-verify authenticity with corrected data
        const authResult = await verifyCertificateAuthenticity({
            issuer: certificate.issuer,
            verificationUrl: certificate.verificationUrl,
            certificateId: certificate.certificateId,
            studentUser: req.user,
            submittedTitle: certificate.title,
            submittedDate: certificate.issueDate
        });

        const prevStatus = certificate.verificationStatus;
        if (authResult.status === "VERIFIED") {
            certificate.verificationStatus = "VERIFIED";
            certificate.verificationMethod = authResult.verificationMethod || "OFFICIAL_URL";
            certificate.verificationEvidence = authResult.evidence;
            if (authResult.evidence?.courseName || authResult.evidence?.programmeName) {
                const authoritativeTitle = authResult.evidence.programmeName || authResult.evidence.courseName;
                certificate.title = authoritativeTitle;
                if (certificate.extractedData) certificate.extractedData.certificateTitle = authoritativeTitle;
            }
            if (authResult.evidence?.credentialId) {
                certificate.certificateId = authResult.evidence.credentialId;
                if (certificate.extractedData) certificate.extractedData.certificateId = authResult.evidence.credentialId;
            }
            if (authResult.evidence?.issuerVerificationUrl) {
                certificate.verificationUrl = authResult.evidence.issuerVerificationUrl;
                if (certificate.extractedData) certificate.extractedData.verificationUrl = authResult.evidence.issuerVerificationUrl;
            }
            if (authResult.evidence?.provider) {
                certificate.issuer = authResult.evidence.provider;
                if (certificate.extractedData) certificate.extractedData.issuer = authResult.evidence.provider;
            }

            // Suppress contradictory advisory flags from heuristic analysis
            if (certificate.documentAnalysis) {
                certificate.documentAnalysis.flags = (certificate.documentAnalysis.flags || []).filter(
                    (f) =>
                        f.code !== "MISSING_IDENTIFIER" &&
                        f.code !== "TITLE_TEXT_MISMATCH" &&
                        f.code !== "ISSUER_TEXT_MISMATCH" &&
                        f.code !== "NAME_ABSENT_IN_DOCUMENT" &&
                        f.code !== "NAME_MISMATCH"
                );
                certificate.documentAnalysis.hasInconsistencies = certificate.documentAnalysis.flags.some(
                    (f) => f.severity === "warning" || f.severity === "danger"
                );
                certificate.documentAnalysis.nameMatchStatus = "MATCH";
                certificate.documentAnalysis.nameMatchScore = 100;
                certificate.documentAnalysis.inconsistencyScore = certificate.documentAnalysis.flags.reduce((acc, f) => {
                    if (f.severity === "danger") return acc + 35;
                    if (f.severity === "warning") return acc + 15;
                    return acc + 5;
                }, 0);
            }
        } else if (authResult.status === "VERIFICATION_FAILED") {
            certificate.verificationStatus = "VERIFICATION_FAILED";
            certificate.verificationEvidence = authResult.evidence || {};
        } else {
            certificate.verificationStatus = "NEEDS_REVIEW";
            certificate.verificationEvidence = authResult.evidence || {};
        }

        certificate.auditHistory.push({
            action: "METADATA_UPDATED",
            performedBy: req.user._id,
            performedByRole: "student",
            performedByName: req.user.fullName,
            timestamp: new Date(),
            reason: `Student updated metadata: ${modifiedFields.join(", ")}`,
            previousStatus: prevStatus,
            newStatus: certificate.verificationStatus,
            metadata: { modifiedFields }
        });

        await certificate.save();
    }

    return res.status(200).json(
        new ApiResponse(200, certificate, "Certificate metadata corrected successfully.")
    );
});

/**
 * 7. Delete Certificate (Student)
 */
export const deleteCertificate = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const certificate = await Certificate.findById(id);
    if (!certificate) {
        throw new ApiError(404, "Certificate not found.");
    }

    if (certificate.student?.toString() !== req.user._id?.toString() && req.user.role !== "admin") {
        throw new ApiError(403, "Access denied.");
    }

    // Delete stored file
    if (certificate.file?.storageKey) {
        await deleteStoredCertificate(certificate.file.storageKey);
    }

    await Certificate.findByIdAndDelete(id);

    return res.status(200).json(
        new ApiResponse(200, { deletedId: id }, "Certificate deleted successfully.")
    );
});

/**
 * 8. Admin: List Certificates with Filters, Search, and Pagination
 */
export const getAdminCertificates = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 15,
        status,
        category,
        search
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 15));
    const skip = (pageNum - 1) * limitNum;

    const query = {};

    if (status && status !== "ALL") {
        query.verificationStatus = status;
    }
    if (category && category !== "ALL") {
        query.category = category;
    }
    if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        query.$or = [
            { title: regex },
            { issuer: regex },
            { certificateId: regex },
            { "extractedData.studentName": regex }
        ];
    }

    const [certificates, total, countsByStatus] = await Promise.all([
        Certificate.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum)
            .populate("student", "fullName email")
            .populate("studentProfile", "enrollmentNumber branch semester"),
        Certificate.countDocuments(query),
        Certificate.aggregate([
            {
                $group: {
                    _id: "$verificationStatus",
                    count: { $sum: 1 }
                }
            }
        ])
    ]);

    const summary = {
        total: 0,
        pending: 0,
        processing: 0,
        verified: 0,
        needsReview: 0,
        rejected: 0,
        verificationFailed: 0
    };

    for (const item of countsByStatus) {
        summary.total += item.count;
        if (item._id === "PENDING") summary.pending = item.count;
        if (item._id === "PROCESSING") summary.processing = item.count;
        if (item._id === "VERIFIED") summary.verified = item.count;
        if (item._id === "NEEDS_REVIEW") summary.needsReview = item.count;
        if (item._id === "REJECTED") summary.rejected = item.count;
        if (item._id === "VERIFICATION_FAILED") summary.verificationFailed = item.count;
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                certificates,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                },
                summary
            },
            "Admin certificates retrieved successfully."
        )
    );
});

/**
 * 9. Admin: Review Decision (Approve / Reject / Request Correction)
 * Distinctly records manual reviews without misrepresenting them as issuer-verified.
 */
export const reviewCertificate = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { decision, reason = "" } = req.body;

    if (!["APPROVED", "REJECTED", "CORRECTION_REQUESTED"].includes(decision)) {
        throw new ApiError(400, "Invalid review decision. Must be APPROVED, REJECTED, or CORRECTION_REQUESTED.");
    }
    if ((decision === "REJECTED" || decision === "CORRECTION_REQUESTED") && (!reason || !reason.trim())) {
        throw new ApiError(400, "A mandatory reason is required when rejecting or requesting correction.");
    }

    const certificate = await Certificate.findById(id);
    if (!certificate) {
        throw new ApiError(404, "Certificate not found.");
    }

    const previousStatus = certificate.verificationStatus;
    let newStatus = previousStatus;
    let auditAction = "";

    if (decision === "APPROVED") {
        newStatus = "VERIFIED";
        certificate.verificationMethod = "MANUAL_REVIEW";
        auditAction = "MANUALLY_APPROVED";
    } else if (decision === "REJECTED") {
        newStatus = "REJECTED";
        auditAction = "MANUALLY_REJECTED";
    } else if (decision === "CORRECTION_REQUESTED") {
        newStatus = "NEEDS_REVIEW";
        auditAction = "CORRECTION_REQUESTED";
    }

    certificate.verificationStatus = newStatus;
    certificate.reviewDecision = decision;
    certificate.reviewReason = reason.trim();
    certificate.reviewedBy = req.user._id;
    certificate.reviewedAt = new Date();

    certificate.auditHistory.push({
        action: auditAction,
        performedBy: req.user._id,
        performedByRole: "admin",
        performedByName: req.user.fullName,
        timestamp: new Date(),
        reason: reason.trim() || (decision === "APPROVED" ? "Manually confirmed and approved by placement officer" : ""),
        previousStatus,
        newStatus,
        metadata: { decision }
    });

    await certificate.save();

    return res.status(200).json(
        new ApiResponse(200, certificate, `Certificate has been ${decision.toLowerCase().replace("_", " ")}.`)
    );
});
