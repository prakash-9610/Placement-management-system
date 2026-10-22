import assert from "node:assert/strict";
import { test } from "node:test";
import {
    validateFileMagicBytes,
    calculateFileHash
} from "../src/services/certificateStorage.service.js";
import { parseCertificateMetadata } from "../src/services/ocr.service.js";
import {
    compareNames,
    analyzeVerificationUrl,
    analyzeCertificateDocument
} from "../src/services/documentAnalysis.service.js";
import {
    isPrivateOrReservedIp,
    validateSafeIssuerUrl,
    extractCourseraCertificateId
} from "../src/services/issuerVerification.service.js";

// --- Step 1: Secure File Upload & Magic Bytes Validation Tests ---

test("1. File security: validates valid PDF, PNG, and JPEG magic byte headers", () => {
    // Valid PDF signature: %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
    const validPdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const pdfCheck = validateFileMagicBytes(validPdfBuffer, "application/pdf");
    assert.equal(pdfCheck.isValid, true);
    assert.equal(pdfCheck.detectedType, "application/pdf");

    // Valid PNG signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const pngCheck = validateFileMagicBytes(validPngBuffer, "image/png");
    assert.equal(pngCheck.isValid, true);
    assert.equal(pngCheck.detectedType, "image/png");

    // Valid JPEG signature: 0xFF 0xD8 0xFF
    const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const jpgCheck = validateFileMagicBytes(validJpgBuffer, "image/jpeg");
    assert.equal(jpgCheck.isValid, true);
    assert.equal(jpgCheck.detectedType, "image/jpeg");
});

test("2. File security: rejects renamed malicious files and mismatched MIME headers", () => {
    // Shell script / text disguised as PDF
    const fakePdfBuffer = Buffer.from("#!/bin/bash\necho malicious payload\n");
    const fakeCheck = validateFileMagicBytes(fakePdfBuffer, "application/pdf");
    assert.equal(fakeCheck.isValid, false);
    assert.match(fakeCheck.error, /Unsupported or invalid file signature/);

    // PNG file passed with image/jpeg header
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mismatchCheck = validateFileMagicBytes(pngBuffer, "image/jpeg");
    assert.equal(mismatchCheck.isValid, false);
    assert.match(mismatchCheck.error, /MIME type mismatch/);
});

test("3. File hashing: computes deterministic SHA-256 for duplicate and integrity checks", () => {
    const sampleBuffer1 = Buffer.from("Certificate of Machine Learning - Prakash Choyal");
    const sampleBuffer2 = Buffer.from("Certificate of Machine Learning - Prakash Choyal");
    const differentBuffer = Buffer.from("Certificate of Deep Learning - Different Student");

    const hash1 = calculateFileHash(sampleBuffer1);
    const hash2 = calculateFileHash(sampleBuffer2);
    const hash3 = calculateFileHash(differentBuffer);

    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hash3);
    assert.equal(hash1.length, 64);
});

// --- Step 2: OCR & Certificate Metadata Extraction Tests ---

test("4. OCR Parser: extracts student name, course title, issuer, credential ID, and URL", () => {
    const rawOcrSnippet = `
        Coursera
        This is to certify that
        Prakash Choyal
        has successfully completed
        Machine Learning Specialization
        an online non-credit course authorized by DeepLearning.AI and Stanford Online
        Issued on October 15, 2025
        Certificate ID: ML9482710492
        Verify at https://coursera.org/verify/ML9482710492
    `;

    const parsed = parseCertificateMetadata(rawOcrSnippet);
    assert.equal(parsed.parseSuccess, true);
    assert.equal(parsed.studentName, "Prakash Choyal");
    assert.equal(parsed.issuer, "Coursera");
    assert.equal(parsed.certificateId, "ML9482710492");
    assert.equal(parsed.verificationUrl, "https://coursera.org/verify/ML9482710492");
    assert.match(parsed.certificateTitle, /Machine Learning Specialization/);
    assert.match(parsed.issueDate, /October 15, 2025/);
});

test("5. OCR Parser: handles ambiguous or noisy OCR text gracefully without crashing", () => {
    const noisyText = "Unclear scanned marks @#$% !!! 12345";
    const parsed = parseCertificateMetadata(noisyText, {
        studentName: "Fallback Name",
        certificateTitle: "Python Bootcamp",
        issuer: "Udemy"
    });

    assert.equal(parsed.studentName, "Fallback Name");
    assert.equal(parsed.certificateTitle, "Python Bootcamp");
    assert.equal(parsed.issuer, "Udemy");
});

// --- Step 3: Document Inconsistency Analysis Tests ---

test("6. Name comparison: recognizes exact matches, middle names, and mismatches", () => {
    const match = compareNames("Prakash Choyal", "Prakash Choyal");
    assert.equal(match.status, "MATCH");
    assert.ok(match.score >= 80);

    const partial = compareNames("Prakash Choyal", "Mr. Prakash K. Choyal");
    assert.ok(partial.status === "MATCH" || partial.status === "PARTIAL_MATCH");
    assert.ok(partial.score >= 50);

    const mismatch = compareNames("Prakash Choyal", "Alexander Graham");
    assert.equal(mismatch.status, "MISMATCH");
    assert.ok(mismatch.score < 30);
});

test("7. Document analysis: flags name mismatch, missing IDs, and unapproved URLs", () => {
    const analysis = analyzeCertificateDocument({
        studentUser: { fullName: "Prakash Choyal" },
        submittedData: {
            title: "Advanced React",
            issuer: "External Site",
            certificateId: "",
            verificationUrl: "http://192.168.1.50/cert"
        },
        extractedData: {
            studentName: "John Doe",
            rawText: "This is awarded to John Doe for completing React"
        }
    });

    assert.equal(analysis.hasInconsistencies, true);
    assert.ok(analysis.inconsistencyScore > 30);
    assert.equal(analysis.nameMatchStatus, "MISMATCH");

    const flagCodes = analysis.flags.map((f) => f.code);
    assert.ok(flagCodes.includes("NAME_MISMATCH"));
    assert.ok(flagCodes.includes("SUSPICIOUS_IP_DESTINATION"));
    assert.ok(flagCodes.includes("INSECURE_PROTOCOL"));
});

test("8. Document analysis: flags duplicate submission from different student", () => {
    const analysis = analyzeCertificateDocument({
        studentUser: { fullName: "Prakash Choyal" },
        submittedData: { title: "Data Structures", issuer: "Coursera" },
        extractedData: { studentName: "Prakash Choyal", rawText: "Data Structures" },
        existingCertificateMatches: [{ _id: "cert_999", student: "other_user" }]
    });

    const duplicateFlag = analysis.flags.find((f) => f.code === "DUPLICATE_SUBMISSION");
    assert.ok(duplicateFlag);
    assert.equal(duplicateFlag.severity, "danger");
});

// --- Step 4: SSRF & IP Address Protection Tests ---

test("9. SSRF Protection: blocks private IP ranges, loopback, and cloud metadata addresses", () => {
    // IPv4 private ranges
    assert.equal(isPrivateOrReservedIp("127.0.0.1"), true);
    assert.equal(isPrivateOrReservedIp("10.0.0.1"), true);
    assert.equal(isPrivateOrReservedIp("192.168.1.1"), true);
    assert.equal(isPrivateOrReservedIp("172.16.0.1"), true);
    assert.equal(isPrivateOrReservedIp("172.31.255.255"), true);
    assert.equal(isPrivateOrReservedIp("169.254.169.254"), true); // AWS / Cloud metadata
    assert.equal(isPrivateOrReservedIp("0.0.0.0"), true);

    // IPv6
    assert.equal(isPrivateOrReservedIp("::1"), true);

    // Public IPs (should be allowed through private check)
    assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
    assert.equal(isPrivateOrReservedIp("1.1.1.1"), false);
});

test("10. Issuer URL Safety: enforces HTTPS, permitted domains, and blocks invalid hosts", async () => {
    // Insecure HTTP
    const httpCheck = await validateSafeIssuerUrl("http://coursera.org/verify/123");
    assert.equal(httpCheck.isSafe, false);
    assert.match(httpCheck.reason, /HTTPS/);

    // Unapproved domain
    const rogueCheck = await validateSafeIssuerUrl("https://fake-diploma-mill.xyz/verify/123");
    assert.equal(rogueCheck.isSafe, false);
    assert.match(rogueCheck.reason, /approved issuer registry/);

    // Valid Coursera domain
    const courseraCheck = await validateSafeIssuerUrl("https://coursera.org/verify/ABC123XYZ");
    assert.equal(courseraCheck.isSafe, true);
});

test("11. Coursera Verifier: accurately parses certificate ID from various URL patterns", () => {
    const id1 = extractCourseraCertificateId("https://www.coursera.org/verify/AB12CD34EF", "");
    assert.equal(id1, "AB12CD34EF");

    const id2 = extractCourseraCertificateId("https://coursera.org/account/accomplishments/verify/9988776655", "");
    assert.equal(id2, "9988776655");

    const id3 = extractCourseraCertificateId("", "XYZ12345678");
    assert.equal(id3, "XYZ12345678");
});

test("12. Candidate ID generator: recovers from OCR font confusion (I/J, 0/O, 8/B)", async () => {
    const { generateCourseraIdCandidates } = await import("../src/services/issuerVerification.service.js");
    const candidates = generateCourseraIdCandidates("GDMIEQWC98DO");
    assert.ok(candidates.includes("GDMIEQWC98DO"));
    assert.ok(candidates.includes("GDMJEQWC98DO")); // Resolved J from I
    assert.ok(candidates.includes("GDMIEQWC9BDO")); // Resolved B from 8
});

test("13. OCR Parser: recovers from optical URL misreads (httpsi// and comma)", () => {
    const garbledOcr = `
        Completed by Prakash Choyal
        Supervised Machine Learning
        Verify at httpsi//coursera,org/verify/GDMJEQWC98DO
    `;
    const parsed = parseCertificateMetadata(garbledOcr);
    assert.equal(parsed.verificationUrl, "https://coursera.org/verify/GDMJEQWC98DO");
    assert.equal(parsed.certificateId, "GDMJEQWC98DO");
});

test("14. OCR Parser: never extracts issuer name 'Coursera' or 'Stanford' as certificate ID", () => {
    const certText = `
        Coursera
        Stanford Online
        Certificate of Completion
        Verify at coursera
    `;
    const parsed = parseCertificateMetadata(certText);
    assert.notEqual(parsed.certificateId.toUpperCase(), "COURSERA");
    assert.notEqual(parsed.certificateId.toUpperCase(), "STANFORD");
});

test("15. Issuer Verification: unsupported issuer safely yields NEEDS_REVIEW without marking fake", async () => {
    const { verifyCertificateAuthenticity } = await import("../src/services/issuerVerification.service.js");
    const result = await verifyCertificateAuthenticity({
        issuer: "Local Engineering Academy",
        verificationUrl: "",
        certificateId: "LOCAL-999",
        studentUser: { fullName: "Prakash Choyal" },
        submittedTitle: "Web Development"
    });
    assert.equal(result.status, "NEEDS_REVIEW");
    assert.equal(result.verificationMethod, "NONE");
    assert.match(result.reason, /manual review/i);
});

test("16. Issuer Verification: name mismatch between verified credential and student fails verification", async () => {
    const { compareNames } = await import("../src/services/documentAnalysis.service.js");
    const comparison = compareNames("Prakash Choyal", "John Robert Smith");
    assert.equal(comparison.status, "MISMATCH");
    assert.ok(comparison.score < 20);
});

// --- Step 5: BSERC Certificate Verification Integration Tests ---

function createMockBsercHtml({
    verified = true,
    recipient = "prakash choyal",
    certId = "BSERC-DSI-2026-1908",
    programme = "Def- Space Summer Internship Certificate Destribution Final",
    issued = "06 Aug 2026, 05:14 pm",
    code = "_41fKMGnvDiw4AB8gCcwzLK4"
} = {}) {
    if (!verified) {
        return `
        <html>
            <body>
                <h1>Certificate Verification</h1>
                <h2>Not a valid certificate</h2>
                <p>This verification code is not linked to any certificate.</p>
            </body>
        </html>`;
    }
    return `
    <html>
        <body>
            <h2>Certificate verified</h2>
            <dl>
                <dt>Recipient</dt><dd>${recipient}</dd>
                <dt>Certificate ID</dt><dd><span>${certId}</span></dd>
                <dt>Programme</dt><dd>${programme}</dd>
                <dt>Issued</dt><dd>${issued}</dd>
                <dt>Verification code</dt><dd><span>${code}</span></dd>
            </dl>
        </body>
    </html>`;
}

test("17. BSERC Verifier: Successfully verifies certificate when all official fields match", async () => {
    const { verifyCertificateAuthenticity } = await import("../src/services/issuerVerification.service.js");

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => createMockBsercHtml()
    });

    const result = await verifyCertificateAuthenticity({
        issuer: "BSERC",
        verificationUrl: "https://bserc.org/verify/_41fKMGnvDiw4AB8gCcwzLK4",
        certificateId: "BSERC-DSI-2026-1908",
        studentUser: { fullName: "Prakash Choyal" },
        submittedTitle: "Def- Space Summer Internship Certificate Destribution Final",
        submittedDate: "2026-08-06",
        fetchFn: mockFetch
    });

    assert.equal(result.status, "VERIFIED");
    assert.equal(result.verificationMethod, "OFFICIAL_URL");
    assert.equal(result.evidence.provider, "BSERC");
    assert.equal(result.evidence.recipientName, "prakash choyal");
    assert.equal(result.evidence.credentialId, "BSERC-DSI-2026-1908");
    assert.equal(result.evidence.matchDetails.nameMatched, true);
    assert.equal(result.evidence.matchDetails.idMatched, true);
    assert.equal(result.evidence.matchDetails.courseMatched, true);
    assert.equal(result.evidence.matchDetails.dateMatched, true);
    assert.equal(result.evidence.discrepancies.length, 0);
    assert.ok(result.evidence.matchedFields.length >= 4);
});

test("18. BSERC Verifier: Detects August 9 vs August 6 date discrepancy and retains NEEDS_REVIEW", async () => {
    const { verifyCertificateAuthenticity } = await import("../src/services/issuerVerification.service.js");

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => createMockBsercHtml({ issued: "06 Aug 2026, 05:14 pm" })
    });

    const result = await verifyCertificateAuthenticity({
        issuer: "BSERC",
        verificationUrl: "https://bserc.org/verify/_41fKMGnvDiw4AB8gCcwzLK4",
        certificateId: "BSERC-DSI-2026-1908",
        studentUser: { fullName: "Prakash Choyal" },
        submittedTitle: "Def- Space Summer Internship Certificate Destribution Final",
        submittedDate: "August 9, 2026", // Internship end date extracted from PDF
        fetchFn: mockFetch
    });

    // Must NOT silently overwrite or mark fully verified without resolution
    assert.equal(result.status, "NEEDS_REVIEW");
    assert.equal(result.verificationMethod, "OFFICIAL_URL");
    assert.equal(result.evidence.matchDetails.nameMatched, true);
    assert.equal(result.evidence.matchDetails.idMatched, true);
    assert.equal(result.evidence.matchDetails.courseMatched, true);
    assert.equal(result.evidence.matchDetails.dateMatched, false);

    // Verifies the exact discrepancy explanation
    assert.ok(result.evidence.discrepancies.some((d) => d.includes("August 9, 2026") && d.includes("August 6, 2026")));
    assert.ok(result.evidence.comparison.issueDate.details.includes("internship program completion date"));
});

test("19. BSERC Verifier: Detects organization name entered as programme title and explains mismatch", async () => {
    const { verifyCertificateAuthenticity } = await import("../src/services/issuerVerification.service.js");

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => createMockBsercHtml()
    });

    const result = await verifyCertificateAuthenticity({
        issuer: "Bharat space education and research",
        verificationUrl: "https://bserc.org/verify/_41fKMGnvDiw4AB8gCcwzLK4",
        certificateId: "BSERC-DSI-2026-1908",
        studentUser: { fullName: "Prakash Choyal" },
        submittedTitle: "Bharat space education and research", // Organization name submitted as title
        submittedDate: "2026-08-06",
        fetchFn: mockFetch
    });

    assert.equal(result.status, "NEEDS_REVIEW");
    assert.equal(result.evidence.matchDetails.courseMatched, false);
    assert.ok(result.evidence.discrepancies.some((d) => d.includes("Organization name") && d.includes("programme title")));
});

test("20. BSERC Verifier: Rejects when official recipient does not match student account", async () => {
    const { verifyCertificateAuthenticity } = await import("../src/services/issuerVerification.service.js");

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => createMockBsercHtml({ recipient: "Deepak Sharma" })
    });

    const result = await verifyCertificateAuthenticity({
        issuer: "BSERC",
        verificationUrl: "https://bserc.org/verify/_41fKMGnvDiw4AB8gCcwzLK4",
        certificateId: "BSERC-DSI-2026-1908",
        studentUser: { fullName: "Prakash Choyal" },
        submittedTitle: "Def- Space Summer Internship Certificate Destribution Final",
        submittedDate: "2026-08-06",
        fetchFn: mockFetch
    });

    assert.equal(result.status, "VERIFICATION_FAILED");
    assert.match(result.reason, /Deepak Sharma/);
    assert.match(result.reason, /Prakash Choyal/);
});

test("21. BSERC Verifier: Fails verification when official page reports 'Not a valid certificate'", async () => {
    const { verifyCertificateAuthenticity } = await import("../src/services/issuerVerification.service.js");

    const mockFetch = async () => ({
        ok: true,
        status: 200,
        text: async () => createMockBsercHtml({ verified: false })
    });

    const result = await verifyCertificateAuthenticity({
        issuer: "BSERC",
        verificationUrl: "https://bserc.org/verify/_invalidCode123",
        certificateId: "BSERC-DSI-2026-9999",
        studentUser: { fullName: "Prakash Choyal" },
        submittedTitle: "Def- Space Summer Internship",
        fetchFn: mockFetch
    });

    assert.equal(result.status, "VERIFICATION_FAILED");
    assert.match(result.reason, /Not a valid certificate/);
});

test("22. BSERC Verifier: Handles network timeouts and server errors gracefully with NEEDS_REVIEW", async () => {
    const { verifyCertificateAuthenticity } = await import("../src/services/issuerVerification.service.js");

    const mockNetworkErrorFetch = async () => {
        throw new Error("ETIMEDOUT: Connection timed out to bserc.org");
    };

    const result = await verifyCertificateAuthenticity({
        issuer: "BSERC",
        verificationUrl: "https://bserc.org/verify/_41fKMGnvDiw4AB8gCcwzLK4",
        certificateId: "BSERC-DSI-2026-1908",
        studentUser: { fullName: "Prakash Choyal" },
        submittedTitle: "Def- Space Summer Internship Certificate Destribution Final",
        fetchFn: mockNetworkErrorFetch
    });

    // Never mark as fake or VERIFICATION_FAILED on connection errors
    assert.equal(result.status, "NEEDS_REVIEW");
    assert.match(result.reason, /network error or timeout/i);
});

test("23. BSERC URL Extraction & Allowed Domains: validates bserc.org and rejects rogue domains", async () => {
    const {
        validateSafeIssuerUrl,
        extractBsercVerificationCode,
        getAllowedIssuerDomains
    } = await import("../src/services/issuerVerification.service.js");

    // Allowed domains list contains bserc.org
    const domains = getAllowedIssuerDomains();
    assert.ok(domains.includes("bserc.org"));
    assert.ok(domains.includes("www.bserc.org"));

    // Code extraction
    const code = extractBsercVerificationCode("https://bserc.org/verify/_41fKMGnvDiw4AB8gCcwzLK4");
    assert.equal(code, "_41fKMGnvDiw4AB8gCcwzLK4");

    // Safe URL check
    const safeCheck = await validateSafeIssuerUrl("https://bserc.org/verify/_41fKMGnvDiw4AB8gCcwzLK4");
    assert.equal(safeCheck.isSafe, true);

    // Rogue unapproved domain is rejected
    const rogueCheck = await validateSafeIssuerUrl("https://unapproved-bserc-clone.com/verify/123");
    assert.equal(rogueCheck.isSafe, false);
    assert.match(rogueCheck.reason, /approved issuer registry/);
});


