import { Router } from "express";
import { verifyJWT, verifyAdmin, verifyStudent } from "../middlewares/auth.middleware.js";
import { uploadCertificateFile } from "../middlewares/certificateUpload.middleware.js";
import {
    uploadCertificate,
    getMyCertificates,
    getCertificateById,
    getCertificateFile,
    verifyCertificate,
    adoptOfficialDetails,
    updateCertificate,
    deleteCertificate,
    getAdminCertificates,
    reviewCertificate
} from "../controllers/certificate.controller.js";

const router = Router();

// Student Certificate Management Endpoints
router.route("/")
    .post(verifyJWT, verifyStudent, uploadCertificateFile.single("file"), uploadCertificate);

router.route("/my")
    .get(verifyJWT, verifyStudent, getMyCertificates);

router.route("/:id")
    .get(verifyJWT, getCertificateById)
    .patch(verifyJWT, verifyStudent, updateCertificate)
    .delete(verifyJWT, deleteCertificate);

router.route("/:id/file")
    .get(verifyJWT, getCertificateFile);

router.route("/:id/verify")
    .post(verifyJWT, verifyCertificate);

router.route("/:id/adopt-official")
    .post(verifyJWT, adoptOfficialDetails);

// Admin / Reviewer Dedicated Routes (can be accessed via /api/v1/certificates/admin/...)
router.route("/admin/all")
    .get(verifyJWT, verifyAdmin, getAdminCertificates);

router.route("/admin/:id/review")
    .patch(verifyJWT, verifyAdmin, reviewCertificate);

export default router;

// Dedicated Admin Router to mount on /api/v1/admin/certificates and /api/admin/certificates
const adminCertificateRouter = Router();

adminCertificateRouter.route("/")
    .get(verifyJWT, verifyAdmin, getAdminCertificates);

adminCertificateRouter.route("/:id/review")
    .patch(verifyJWT, verifyAdmin, reviewCertificate);

export { adminCertificateRouter };
