import api from "./api";
import { API_BASE_URL } from "./apiConfig";

/**
 * Upload a new certificate (Student)
 * @param {FormData} formData
 */
export async function uploadCertificate(formData) {
    const res = await api.post("/certificates", formData, {
        headers: {
            "Content-Type": "multipart/form-data"
        }
    });
    return res.data;
}

/**
 * Fetch authenticated student's certificates
 * @param {Object} params - { status, category, search }
 */
export async function getMyCertificates(params = {}) {
    const res = await api.get("/certificates/my", { params });
    return res.data;
}

/**
 * Get detailed certificate record by ID
 * @param {string} id
 */
export async function getCertificateById(id) {
    const res = await api.get(`/certificates/${id}`);
    return res.data;
}

/**
 * Build secure download/preview URL for certificate file
 * @param {string} id
 */
export function getCertificateDocumentUrl(id) {
    return `${API_BASE_URL}/certificates/${id}/file`;
}

/**
 * Fetch the binary file blob with authorization header for secure in-browser preview
 * @param {string} id
 */
export async function fetchCertificateBlob(id) {
    const res = await api.get(`/certificates/${id}/file`, {
        responseType: "blob"
    });
    return {
        blob: res.data,
        contentType: res.headers["content-type"] || "application/octet-stream"
    };
}

/**
 * Trigger or retry automated verification for certificate
 * @param {string} id
 */
export async function verifyCertificate(id) {
    const res = await api.post(`/certificates/${id}/verify`);
    return res.data;
}

/**
 * Student correction of certificate metadata
 * @param {string} id
 * @param {Object} data
 */
export async function updateCertificate(id, data) {
    const res = await api.patch(`/certificates/${id}`, data);
    return res.data;
}

/**
 * Delete a student certificate
 * @param {string} id
 */
export async function deleteCertificate(id) {
    const res = await api.delete(`/certificates/${id}`);
    return res.data;
}

/**
 * Admin: List all certificates with filters, pagination, and KPI counts
 * @param {Object} params - { page, limit, status, category, search }
 */
export async function getAdminCertificates(params = {}) {
    const res = await api.get("/admin/certificates", { params });
    return res.data;
}

/**
 * Admin: Review certificate (Approve, Reject, Request Correction)
 * @param {string} id
 * @param {Object} payload - { decision: "APPROVED"|"REJECTED"|"CORRECTION_REQUESTED", reason: string }
 */
export async function reviewCertificate(id, payload) {
    const res = await api.patch(`/admin/certificates/${id}/review`, payload);
    return res.data;
}

/**
 * Adopt official verified details from issuer registry to resolve discrepancies
 * @param {string} id
 */
export async function adoptOfficialCertificateDetails(id) {
    const res = await api.post(`/certificates/${id}/adopt-official`);
    return res.data;
}

