import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
    sendApplicationStatusEmail,
    setMockTransporter,
    resetTransporter,
    isSmtpConfigured,
    getSenderAddress
} from "../src/utils/mailService.js";

describe("SMTP Workflow Integration Suite", () => {
    let mockSentEmails = [];

    const mockTransporter = {
        sendMail: async (mailOptions) => {
            mockSentEmails.push(mailOptions);
            return { messageId: `<mock-${Date.now()}@placement.local>` };
        }
    };

    beforeEach(() => {
        mockSentEmails = [];
    });

    afterEach(() => {
        resetTransporter();
    });

    test("1. Verify sender address formatting", () => {
        const sender = getSenderAddress();
        assert.ok(typeof sender === "string" && sender.includes("Campus Placement Cell"));
    });

    test("2. Mock transporter enables isSmtpConfigured", () => {
        assert.equal(isSmtpConfigured(), false);
        setMockTransporter(mockTransporter);
        assert.equal(isSmtpConfigured(), true);
    });

    test("3. Dispatch application status email via mock SMTP transporter", async () => {
        setMockTransporter(mockTransporter);

        const result = await sendApplicationStatusEmail({
            studentEmail: "test.student@placement.edu",
            studentName: "Prakash Choyal",
            companyName: "Google Cloud",
            jobTitle: "Software Engineer",
            status: "shortlisted",
            remarks: "Congratulations! You have been shortlisted for technical interviews.",
            interviewDate: new Date("2026-11-01T10:00:00Z").toISOString(),
            interviewRound: "Round 1 - Technical",
            interviewLocation: "Virtual Google Meet",
            offeredPackage: 24
        });

        assert.equal(result, true, "Email dispatch should succeed");
        assert.equal(mockSentEmails.length, 1, "Exactly one email should have been sent");

        const sent = mockSentEmails[0];
        assert.equal(sent.to, "test.student@placement.edu");
        assert.ok(sent.subject.includes("Google Cloud"));
        assert.ok(sent.subject.includes("Shortlisted"));
        assert.ok(sent.html.includes("Prakash Choyal"));
        assert.ok(sent.html.includes("Round 1 - Technical"));
        assert.ok(sent.html.includes("24 LPA"));
    });

    test("4. Graceful handling of missing student email", async () => {
        setMockTransporter(mockTransporter);

        const result = await sendApplicationStatusEmail({
            studentEmail: "",
            studentName: "Anonymous",
            companyName: "Google Cloud",
            status: "applied"
        });

        assert.equal(result, false, "Should return false when recipient is missing");
        assert.equal(mockSentEmails.length, 0, "No email should be dispatched");
    });

    test("5. Fallback simulation mode when SMTP credentials are unconfigured", async () => {
        resetTransporter();

        const result = await sendApplicationStatusEmail({
            studentEmail: "simulated.student@placement.edu",
            studentName: "Student Simulation",
            companyName: "Microsoft",
            status: "interview",
            remarks: "Interview scheduled."
        });

        assert.equal(result, true, "Simulation mode returns true gracefully without throwing");
    });
});
