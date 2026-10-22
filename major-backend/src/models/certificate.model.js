import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true,
            enum: [
                "SUBMITTED",
                "OCR_PROCESSED",
                "AUTO_VERIFIED",
                "AUTO_VERIFICATION_FAILED",
                "SENT_FOR_REVIEW",
                "METADATA_UPDATED",
                "OFFICIAL_DETAILS_ADOPTED",
                "REVERIFICATION_REQUESTED",
                "MANUALLY_APPROVED",
                "MANUALLY_REJECTED",
                "CORRECTION_REQUESTED",
                "DELETED"
            ]
        },
        performedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: false,
            default: null
        },
        performedByRole: {
            type: String,
            enum: ["student", "admin", "system"],
            default: "system"
        },
        performedByName: {
            type: String,
            default: ""
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        reason: {
            type: String,
            default: ""
        },
        previousStatus: {
            type: String,
            default: ""
        },
        newStatus: {
            type: String,
            default: ""
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { _id: true }
);

const analysisFlagSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true
        },
        severity: {
            type: String,
            enum: ["info", "warning", "danger"],
            default: "warning"
        },
        message: {
            type: String,
            required: true
        },
        details: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { _id: true }
);

const certificateSchema = new mongoose.Schema(
    {
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Student reference is required"],
            index: true
        },
        studentProfile: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "StudentProfile",
            index: true
        },
        title: {
            type: String,
            required: [true, "Certificate title or course name is required"],
            trim: true,
            maxlength: [200, "Title cannot exceed 200 characters"]
        },
        category: {
            type: String,
            required: [true, "Category is required"],
            enum: {
                values: ["online_course", "internship", "academic", "technical", "other"],
                message: "Category must be online_course, internship, academic, technical, or other"
            },
            default: "online_course",
            index: true
        },
        issuer: {
            type: String,
            required: [true, "Issuing organization is required"],
            trim: true,
            maxlength: [150, "Issuer cannot exceed 150 characters"],
            index: true
        },
        certificateId: {
            type: String,
            trim: true,
            default: "",
            maxlength: [120, "Certificate ID cannot exceed 120 characters"],
            index: true
        },
        verificationUrl: {
            type: String,
            trim: true,
            default: "",
            maxlength: [1000, "Verification URL cannot exceed 1000 characters"]
        },
        qrCodeContent: {
            type: String,
            trim: true,
            default: ""
        },
        issueDate: {
            type: Date,
            default: null
        },
        expirationDate: {
            type: Date,
            default: null
        },
        // Secure file storage metadata
        file: {
            storageKey: {
                type: String,
                required: true,
                trim: true
            },
            originalName: {
                type: String,
                required: true,
                trim: true
            },
            mimeType: {
                type: String,
                required: true,
                enum: ["image/jpeg", "image/png", "image/jpg", "application/pdf"]
            },
            fileSize: {
                type: Number,
                required: true
            },
            fileHash: {
                type: String,
                required: true,
                index: true
            },
            localPath: {
                type: String,
                default: ""
            },
            cloudinaryUrl: {
                type: String,
                default: ""
            },
            cloudinaryPublicId: {
                type: String,
                default: ""
            }
        },
        // OCR text extraction and parser results (preserved unchanged)
        extractedData: {
            rawText: {
                type: String,
                default: ""
            },
            studentName: {
                type: String,
                default: ""
            },
            certificateTitle: {
                type: String,
                default: ""
            },
            issuer: {
                type: String,
                default: ""
            },
            issueDate: {
                type: String,
                default: ""
            },
            expirationDate: {
                type: String,
                default: ""
            },
            certificateId: {
                type: String,
                default: ""
            },
            verificationUrl: {
                type: String,
                default: ""
            },
            qrCodeData: {
                type: String,
                default: ""
            },
            ocrConfidence: {
                type: Number,
                default: 0
            },
            ocrProvider: {
                type: String,
                default: "tesseract.js"
            },
            extractedAt: {
                type: Date,
                default: null
            },
            parseSuccess: {
                type: Boolean,
                default: false
            }
        },
        // Student-corrected metadata (preserves original extracted values)
        correctedData: {
            isModifiedByStudent: {
                type: Boolean,
                default: false
            },
            modifiedFields: [
                {
                    type: String
                }
            ],
            lastModifiedAt: {
                type: Date,
                default: null
            },
            studentName: {
                type: String,
                default: ""
            },
            certificateTitle: {
                type: String,
                default: ""
            },
            issuer: {
                type: String,
                default: ""
            },
            certificateId: {
                type: String,
                default: ""
            },
            verificationUrl: {
                type: String,
                default: ""
            },
            issueDate: {
                type: Date,
                default: null
            },
            expirationDate: {
                type: Date,
                default: null
            }
        },
        // Document analysis (heuristic checks, inconsistency signals, warnings)
        documentAnalysis: {
            analyzedAt: {
                type: Date,
                default: null
            },
            hasInconsistencies: {
                type: Boolean,
                default: false
            },
            inconsistencyScore: {
                type: Number,
                default: 0,
                min: 0,
                max: 100
            },
            nameMatchStatus: {
                type: String,
                enum: ["MATCH", "PARTIAL_MATCH", "MISMATCH", "UNAVAILABLE"],
                default: "UNAVAILABLE"
            },
            nameMatchScore: {
                type: Number,
                default: 0,
                min: 0,
                max: 100
            },
            issuerDomainStatus: {
                type: String,
                enum: ["APPROVED_DOMAIN", "UNAPPROVED_DOMAIN", "SUSPICIOUS_DOMAIN", "NO_URL"],
                default: "NO_URL"
            },
            flags: [analysisFlagSchema]
        },
        // Authentic verification status lifecycle
        verificationStatus: {
            type: String,
            required: true,
            enum: {
                values: [
                    "PENDING",
                    "PROCESSING",
                    "VERIFIED",
                    "NEEDS_REVIEW",
                    "REJECTED",
                    "VERIFICATION_FAILED"
                ],
                message: "Invalid verification status"
            },
            default: "PENDING",
            index: true
        },
        verificationMethod: {
            type: String,
            enum: ["OFFICIAL_API", "OFFICIAL_URL", "MANUAL_REVIEW", "NONE"],
            default: "NONE"
        },
        // Verifiable evidence obtained from official issuer checks
        verificationEvidence: {
            provider: {
                type: String,
                default: ""
            },
            verificationTimestamp: {
                type: Date,
                default: null
            },
            issuerVerificationUrl: {
                type: String,
                default: ""
            },
            credentialId: {
                type: String,
                default: ""
            },
            recipientName: {
                type: String,
                default: ""
            },
            courseName: {
                type: String,
                default: ""
            },
            completionDate: {
                type: String,
                default: ""
            },
            matchDetails: {
                nameMatched: { type: Boolean, default: false },
                courseMatched: { type: Boolean, default: false },
                idMatched: { type: Boolean, default: false },
                dateMatched: { type: Boolean, default: false }
            },
            summary: {
                type: String,
                default: ""
            },
            rawResponseSnippet: {
                type: String,
                default: ""
            },
            programmeName: {
                type: String,
                default: ""
            },
            issuedDate: {
                type: String,
                default: ""
            },
            verificationCode: {
                type: String,
                default: ""
            },
            officialStatusText: {
                type: String,
                default: ""
            },
            officialFields: {
                type: mongoose.Schema.Types.Mixed,
                default: {}
            },
            comparison: {
                type: mongoose.Schema.Types.Mixed,
                default: {}
            },
            discrepancies: [
                {
                    type: String
                }
            ],
            matchedFields: [
                {
                    type: String
                }
            ]
        },
        verificationAttempts: {
            type: Number,
            default: 0
        },
        lastVerifiedAt: {
            type: Date,
            default: null
        },
        // Manual review details (placement officers / admins)
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        reviewedAt: {
            type: Date,
            default: null
        },
        reviewDecision: {
            type: String,
            enum: ["APPROVED", "REJECTED", "CORRECTION_REQUESTED", "NONE"],
            default: "NONE"
        },
        reviewReason: {
            type: String,
            trim: true,
            default: ""
        },
        // Complete immutable audit log
        auditHistory: [auditLogSchema]
    },
    {
        timestamps: true
    }
);

// Compound indexes for efficient student and admin queries
certificateSchema.index({ student: 1, createdAt: -1 });
certificateSchema.index({ verificationStatus: 1, createdAt: -1 });
certificateSchema.index({ category: 1, verificationStatus: 1 });

export const Certificate = mongoose.model("Certificate", certificateSchema);
