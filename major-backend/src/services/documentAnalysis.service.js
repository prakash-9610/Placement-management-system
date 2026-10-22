/**
 * Document Analysis Service
 * Evaluates certificate documents for suspicious visual, textual, and domain inconsistencies.
 * Note: Warning signals are advisory heuristics and never definitive proof of fraud.
 */

const APPROVED_ISSUER_DOMAINS = [
    "coursera.org",
    "www.coursera.org",
    "verify.coursera.org",
    "udemy.com",
    "www.udemy.com",
    "credly.com",
    "www.credly.com",
    "edx.org",
    "www.edx.org",
    "freecodecamp.org",
    "www.freecodecamp.org",
    "hackerrank.com",
    "www.hackerrank.com",
    "linkedin.com",
    "www.linkedin.com",
    "google.com",
    "cloud.google.com",
    "aws.amazon.com",
    "learn.microsoft.com",
    "bserc.org",
    "www.bserc.org"
];

/**
 * Normalizes a human name string into canonical comparison tokens.
 */
function normalizeNameTokens(name) {
    if (!name || typeof name !== "string") return [];
    return name
        .toLowerCase()
        .replace(/^(?:mr\.|ms\.|mrs\.|dr\.|prof\.)\s+/i, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1);
}

/**
 * Computes name similarity score (0 to 100) and match classification.
 */
export function compareNames(expectedName, candidateName) {
    const expectedTokens = normalizeNameTokens(expectedName);
    const candidateTokens = normalizeNameTokens(candidateName);

    if (expectedTokens.length === 0 || candidateTokens.length === 0) {
        return { status: "UNAVAILABLE", score: 0 };
    }

    let matchCount = 0;
    for (const token of expectedTokens) {
        if (candidateTokens.includes(token)) {
            matchCount++;
        }
    }

    const coverage = (matchCount / expectedTokens.length) * 100;
    const reverseCoverage = (matchCount / candidateTokens.length) * 100;
    const score = Math.round((coverage + reverseCoverage) / 2);

    if (score >= 80 || matchCount >= 2) {
        return { status: "MATCH", score: Math.max(score, 85) };
    } else if (score >= 40 || matchCount >= 1) {
        return { status: "PARTIAL_MATCH", score };
    } else {
        return { status: "MISMATCH", score };
    }
}

/**
 * Analyzes verification URL security and domain legitimacy.
 */
export function analyzeVerificationUrl(urlStr) {
    if (!urlStr || typeof urlStr !== "string") {
        return { status: "NO_URL", domain: "", isApproved: false, flags: [] };
    }

    const flags = [];
    try {
        const parsed = new URL(urlStr.trim());

        // 1. Check protocol
        if (parsed.protocol !== "https:") {
            flags.push({
                code: "INSECURE_PROTOCOL",
                severity: "warning",
                message: "Verification URL does not use HTTPS encryption."
            });
        }

        // 2. Check for private/loopback IP address or suspicious ports
        const host = parsed.hostname.toLowerCase();
        const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":") || host === "localhost";
        if (isIp) {
            flags.push({
                code: "SUSPICIOUS_IP_DESTINATION",
                severity: "danger",
                message: "Verification URL points to an IP address or localhost instead of an accredited issuer domain."
            });
            return { status: "SUSPICIOUS_DOMAIN", domain: host, isApproved: false, flags };
        }

        if (parsed.port && parsed.port !== "443" && parsed.port !== "80") {
            flags.push({
                code: "SUSPICIOUS_PORT",
                severity: "warning",
                message: `Verification URL specifies an unconventional network port (:${parsed.port}).`
            });
        }

        // 3. Domain whitelist check
        const envDomains = (process.env.ALLOWED_ISSUER_DOMAINS || "")
            .split(",")
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean);
        const combinedList = Array.from(new Set([...APPROVED_ISSUER_DOMAINS, ...envDomains]));

        const isApproved = combinedList.some(
            (domain) => host === domain || host.endsWith("." + domain)
        );

        if (isApproved) {
            return { status: "APPROVED_DOMAIN", domain: host, isApproved: true, flags };
        } else {
            flags.push({
                code: "UNAPPROVED_DOMAIN",
                severity: "warning",
                message: `Domain '${host}' is not on the institution's verified issuer registry.`
            });
            return { status: "UNAPPROVED_DOMAIN", domain: host, isApproved: false, flags };
        }
    } catch {
        flags.push({
            code: "MALFORMED_URL",
            severity: "warning",
            message: "Submitted verification URL is malformed or invalid."
        });
        return { status: "SUSPICIOUS_DOMAIN", domain: "", isApproved: false, flags };
    }
}

/**
 * Runs comprehensive inconsistency analysis on certificate submission.
 */
export function analyzeCertificateDocument({
    studentUser,
    submittedData = {},
    extractedData = {},
    existingCertificateMatches = []
}) {
    const flags = [];
    const expectedStudentName = studentUser?.fullName || "";
    const extractedStudentName = extractedData.studentName || "";
    const rawText = (extractedData.rawText || "").toLowerCase();

    // 1. Name consistency check
    let nameMatch = { status: "UNAVAILABLE", score: 0 };
    if (expectedStudentName && extractedStudentName) {
        nameMatch = compareNames(expectedStudentName, extractedStudentName);
        if (nameMatch.status === "MISMATCH") {
            flags.push({
                code: "NAME_MISMATCH",
                severity: "warning",
                message: `Extracted certificate recipient ('${extractedStudentName}') does not match registered student profile ('${expectedStudentName}').`,
                details: { expected: expectedStudentName, extracted: extractedStudentName, score: nameMatch.score }
            });
        } else if (nameMatch.status === "PARTIAL_MATCH") {
            flags.push({
                code: "NAME_PARTIAL_MATCH",
                severity: "info",
                message: `Extracted name ('${extractedStudentName}') partially matches profile ('${expectedStudentName}'). Manual inspection recommended.`,
                details: { expected: expectedStudentName, extracted: extractedStudentName, score: nameMatch.score }
            });
        }
    } else if (expectedStudentName && rawText) {
        // If specific studentName wasn't isolated by regex, check if expected name tokens exist in raw text
        const nameTokens = normalizeNameTokens(expectedStudentName);
        const presentTokens = nameTokens.filter((t) => rawText.includes(t));
        const score = Math.round((presentTokens.length / (nameTokens.length || 1)) * 100);
        if (score < 50) {
            flags.push({
                code: "NAME_ABSENT_IN_DOCUMENT",
                severity: "warning",
                message: "Student's registered name was not detected in the extracted certificate document text.",
                details: { expected: expectedStudentName, score }
            });
            nameMatch = { status: "MISMATCH", score };
        } else {
            nameMatch = { status: "PARTIAL_MATCH", score };
        }
    }

    // 2. Missing Identifiers check
    const certificateId = submittedData.certificateId || extractedData.certificateId || "";
    const verificationUrl = submittedData.verificationUrl || extractedData.verificationUrl || "";
    if (!certificateId && !verificationUrl) {
        flags.push({
            code: "MISSING_IDENTIFIER",
            severity: "warning",
            message: "Document does not include an official credential ID or a verification URL for automated confirmation."
        });
    }

    // 3. Domain & URL verification check
    const effectiveUrl = verificationUrl || "";
    const urlAnalysis = analyzeVerificationUrl(effectiveUrl);
    flags.push(...urlAnalysis.flags);

    // 4. Course Title & Issuer Cross-Check
    const submittedTitle = (submittedData.title || "").trim().toLowerCase();
    const extractedTitle = (extractedData.certificateTitle || "").trim().toLowerCase();
    if (submittedTitle && rawText && !rawText.includes(submittedTitle)) {
        // Check partial overlap
        const titleTokens = submittedTitle.split(/\s+/).filter((t) => t.length > 2);
        const matched = titleTokens.filter((t) => rawText.includes(t));
        if (matched.length / (titleTokens.length || 1) < 0.4) {
            flags.push({
                code: "TITLE_TEXT_MISMATCH",
                severity: "warning",
                message: "Submitted certificate title was not found or has low keyword correlation with the document text."
            });
        }
    }

    const submittedIssuer = (submittedData.issuer || "").trim().toLowerCase();
    if (submittedIssuer && rawText && !rawText.includes(submittedIssuer)) {
        flags.push({
            code: "ISSUER_TEXT_MISMATCH",
            severity: "info",
            message: "Submitted issuing organization is not explicitly mentioned in the extracted certificate text."
        });
    }

    // 5. Duplicate Submission Check
    if (existingCertificateMatches && existingCertificateMatches.length > 0) {
        flags.push({
            code: "DUPLICATE_SUBMISSION",
            severity: "danger",
            message: "An identical certificate file or credential ID is already registered under another account."
        });
    }

    // Calculate Inconsistency Score (0 - 100)
    let score = 0;
    for (const flag of flags) {
        if (flag.severity === "danger") score += 35;
        else if (flag.severity === "warning") score += 15;
        else score += 5;
    }
    const finalScore = Math.min(100, score);

    return {
        analyzedAt: new Date(),
        hasInconsistencies: flags.some((f) => f.severity === "warning" || f.severity === "danger"),
        inconsistencyScore: finalScore,
        nameMatchStatus: nameMatch.status,
        nameMatchScore: nameMatch.score,
        issuerDomainStatus: urlAnalysis.status,
        flags
    };
}
