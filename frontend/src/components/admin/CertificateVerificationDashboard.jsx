import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  Award,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  RefreshCw,
  Eye,
  ShieldCheck,
  ShieldAlert,
  FileText,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  User,
  Sparkles,
  Building2,
  Calendar,
  X,
  Check,
  RotateCcw
} from "lucide-react";
import {
  getAdminCertificates,
  reviewCertificate,
  verifyCertificate,
  adoptOfficialCertificateDetails,
  fetchCertificateBlob
} from "../../services/certificateService";

const STATUS_FILTERS = [
  { id: "ALL", label: "All Statuses" },
  { id: "NEEDS_REVIEW", label: "Needs Review" },
  { id: "VERIFIED", label: "Verified" },
  { id: "VERIFICATION_FAILED", label: "Verification Failed" },
  { id: "REJECTED", label: "Rejected" },
  { id: "PENDING", label: "Pending OCR" }
];

const CATEGORIES = [
  { id: "ALL", label: "All Categories" },
  { id: "online_course", label: "Online Course" },
  { id: "internship", label: "Internship" },
  { id: "academic", label: "Academic" },
  { id: "technical", label: "Technical" },
  { id: "other", label: "Other" }
];

export default function CertificateVerificationDashboard({ adminUser }) {
  // Data States
  const [certificates, setCertificates] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    verified: 0,
    needsReview: 0,
    rejected: 0,
    pending: 0,
    verificationFailed: 0
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 15,
    totalPages: 1,
    total: 0
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter States
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Review & Detail Modal State
  const [activeReviewCert, setActiveReviewCert] = useState(null);
  const [reviewDecision, setReviewDecision] = useState("APPROVED");
  const [reviewReason, setReviewReason] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  // Document Blob Preview State
  const [documentBlobUrl, setDocumentBlobUrl] = useState(null);
  const [loadingDocument, setLoadingDocument] = useState(false);

  // Automated Re-verification State
  const [verifyingId, setVerifyingId] = useState(null);

  // Fetch certificates from API
  const fetchDashboardData = useCallback(
    async (page = 1, isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const res = await getAdminCertificates({
          page,
          limit: 15,
          status: statusFilter,
          category: categoryFilter,
          search: searchQuery
        });

        if (res?.data) {
          setCertificates(res.data.certificates || []);
          if (res.data.summary) setSummary(res.data.summary);
          if (res.data.pagination) setPagination(res.data.pagination);
        }
      } catch (err) {
        console.error("Failed to load admin certificates:", err);
        toast.error(err.response?.data?.message || "Failed to load certificates.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [statusFilter, categoryFilter, searchQuery]
  );

  useEffect(() => {
    fetchDashboardData(1);
  }, [fetchDashboardData]);

  // Handle opening review modal
  const handleOpenReview = async (cert) => {
    setActiveReviewCert(cert);
    setReviewDecision(cert.verificationStatus === "REJECTED" ? "REJECTED" : "APPROVED");
    setReviewReason("");

    if (documentBlobUrl) {
      URL.revokeObjectURL(documentBlobUrl);
      setDocumentBlobUrl(null);
    }

    setLoadingDocument(true);
    try {
      const { blob } = await fetchCertificateBlob(cert._id);
      const url = URL.createObjectURL(blob);
      setDocumentBlobUrl(url);
    } catch (err) {
      console.warn("Could not load preview blob:", err.message);
    } finally {
      setLoadingDocument(false);
    }
  };

  const handleCloseReview = () => {
    if (documentBlobUrl) {
      URL.revokeObjectURL(documentBlobUrl);
      setDocumentBlobUrl(null);
    }
    setActiveReviewCert(null);
  };

  // Submit Review Decision
  const handleSubmitReview = async (e) => {
    e.preventDefault();
    if (!activeReviewCert) return;

    if (
      (reviewDecision === "REJECTED" || reviewDecision === "CORRECTION_REQUESTED") &&
      !reviewReason.trim()
    ) {
      toast.error("A mandatory reason is required when rejecting or requesting correction.");
      return;
    }

    setSubmittingReview(true);
    try {
      const res = await reviewCertificate(activeReviewCert._id, {
        decision: reviewDecision,
        reason: reviewReason.trim()
      });

      toast.success(res?.message || "Review decision recorded successfully.");
      const updated = res?.data;

      // Update in local state
      if (updated) {
        setCertificates((prev) => prev.map((c) => (c._id === updated._id ? updated : c)));
      }
      handleCloseReview();
      fetchDashboardData(pagination.page, true);
    } catch (err) {
      console.error("Review error:", err);
      toast.error(err.response?.data?.message || "Failed to record review decision.");
    } finally {
      setSubmittingReview(false);
    }
  };

  // Trigger automated verification
  const handleTriggerVerification = async (certId) => {
    setVerifyingId(certId);
    try {
      const res = await verifyCertificate(certId);
      toast.success("Automated verification test completed!");
      const updated = res?.data;
      if (updated) {
        setCertificates((prev) => prev.map((c) => (c._id === certId ? updated : c)));
        if (activeReviewCert?._id === certId) {
          setActiveReviewCert(updated);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Verification request failed.");
    } finally {
      setVerifyingId(null);
    }
  };

  // Adopt official verified details (admin action)
  const [adoptingId, setAdoptingId] = useState(null);

  const handleAdoptOfficialAdmin = async (certId) => {
    setAdoptingId(certId);
    try {
      const res = await adoptOfficialCertificateDetails(certId);
      toast.success("Adopted official registry details! Certificate marked as verified.");
      const updated = res?.data;
      if (updated) {
        setCertificates((prev) => prev.map((c) => (c._id === certId ? updated : c)));
        if (activeReviewCert?._id === certId) {
          setActiveReviewCert(updated);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to adopt official verified details.");
    } finally {
      setAdoptingId(null);
    }
  };

  // Render Status Badge
  const renderStatusBadge = (status, method) => {
    switch (status) {
      case "VERIFIED":
        return (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold border ${
              method === "MANUAL_REVIEW"
                ? "bg-purple-50 text-purple-700 border-purple-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200"
            }`}
          >
            <CheckCircle2
              className={`h-3.5 w-3.5 ${
                method === "MANUAL_REVIEW" ? "text-purple-600" : "text-emerald-600"
              }`}
            />
            <span>{method === "MANUAL_REVIEW" ? "Approved by TPO (Manual)" : "Issuer Verified (Official)"}</span>
          </span>
        );
      case "NEEDS_REVIEW":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 border border-amber-200">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <span>Needs Review</span>
          </span>
        );
      case "VERIFICATION_FAILED":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 border border-rose-200">
            <XCircle className="h-3.5 w-3.5 text-rose-600" />
            <span>Verification Failed</span>
          </span>
        );
      case "REJECTED":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 border border-rose-200">
            <XCircle className="h-3.5 w-3.5 text-rose-600" />
            <span>Rejected</span>
          </span>
        );
      case "PROCESSING":
      case "PENDING":
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 border border-blue-200">
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600" />
            <span>Pending OCR</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-500/20">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
              Certificate Verification Console
            </h2>
            <p className="text-xs text-slate-500">
              Review and audit student credentials, evaluate OCR extraction intelligence, and inspect evidence-based authenticity.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => fetchDashboardData(pagination.page, true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${refreshing ? "animate-spin" : ""}`} />
            <span>Sync Live Submissions</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Uploads</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{summary.total}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 shadow-2xs">
          <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Review Required</p>
          <p className="text-2xl font-black text-amber-800 mt-1">{summary.needsReview}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-2xs">
          <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Verified Authenticity</p>
          <p className="text-2xl font-black text-emerald-800 mt-1">{summary.verified}</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 shadow-2xs">
          <p className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Definitive Failed</p>
          <p className="text-2xl font-black text-rose-800 mt-1">{summary.verificationFailed}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-2xs">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Officer Rejected</p>
          <p className="text-2xl font-black text-slate-700 mt-1">{summary.rejected}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search student, USN, course title, issuer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-indigo-500 focus:bg-white transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-bold hidden sm:inline">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-bold hidden sm:inline">Category:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-500 focus:bg-white cursor-pointer"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-3xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 space-y-3">
            <RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
            <p className="text-xs font-bold text-slate-500">Retrieving certificate registry...</p>
          </div>
        ) : certificates.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-16 text-center space-y-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Award className="h-6 w-6" />
            </div>
            <p className="text-sm font-bold text-slate-700">No certificates match the selected filters</p>
            <p className="text-xs text-slate-400 max-w-sm">
              Adjust your search keywords or clear status filters to view student submissions.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-3.5">Student / Candidate</th>
                  <th className="px-5 py-3.5">Certificate & Issuer</th>
                  <th className="px-5 py-3.5">Category</th>
                  <th className="px-5 py-3.5">Verification Status</th>
                  <th className="px-5 py-3.5">Inconsistency Signals</th>
                  <th className="px-5 py-3.5">Submitted</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {certificates.map((cert) => {
                  const studentName = cert.student?.fullName || cert.extractedData?.studentName || "Student";
                  const usn = cert.studentProfile?.enrollmentNumber || "USN not set";
                  const branch = cert.studentProfile?.branch || "";
                  const hasFlags = cert.documentAnalysis?.hasInconsistencies;
                  const flagsCount = cert.documentAnalysis?.flags?.length || 0;
                  const isVerifying = verifyingId === cert._id;

                  return (
                    <tr key={cert._id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Student Info */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 font-bold text-xs shrink-0">
                            {studentName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 truncate max-w-[160px]">{studentName}</p>
                            <p className="text-[11px] font-mono text-slate-400">{usn} {branch ? `• ${branch}` : ""}</p>
                          </div>
                        </div>
                      </td>

                      {/* Title & Issuer */}
                      <td className="px-5 py-4 max-w-xs">
                        <p className="font-bold text-slate-800 line-clamp-1">{cert.title}</p>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          <span>{cert.issuer}</span>
                          {cert.certificateId && (
                            <span className="font-mono text-slate-400">• ID: {cert.certificateId}</span>
                          )}
                        </p>
                      </td>

                      {/* Category */}
                      <td className="px-5 py-4">
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                          {cert.category?.replace("_", " ")}
                        </span>
                      </td>

                      {/* Verification Status */}
                      <td className="px-5 py-4">
                        {renderStatusBadge(cert.verificationStatus, cert.verificationMethod)}
                      </td>

                      {/* Inconsistency Signals */}
                      <td className="px-5 py-4">
                        {hasFlags ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
                            <AlertTriangle className="h-3 w-3 text-amber-600" />
                            <span>{flagsCount} Warning{flagsCount > 1 ? "s" : ""}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-medium">None detected</span>
                        )}
                      </td>

                      {/* Submitted Date */}
                      <td className="px-5 py-4 text-slate-500 font-mono text-[11px]">
                        {new Date(cert.createdAt).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          year: "numeric"
                        })}
                      </td>

                      {/* Action Buttons */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            title="Re-verify against official issuer API"
                            onClick={() => handleTriggerVerification(cert._id)}
                            disabled={isVerifying}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${isVerifying ? "animate-spin text-indigo-600" : ""}`} />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenReview(cert)}
                            className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-xs font-bold shadow-xs transition"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>Review</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs bg-slate-50/50">
            <span className="text-slate-500 font-medium">
              Page <strong>{pagination.page}</strong> of <strong>{pagination.totalPages}</strong> (
              {pagination.total} total)
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fetchDashboardData(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => fetchDashboardData(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ================= MODAL: OFFICER REVIEW & DECISION WORKBENCH ================= */}
      {activeReviewCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-5xl rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[94vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/60">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xs">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Certificate Review Workbench</h3>
                  <p className="text-xs text-slate-500">
                    Candidate: <strong>{activeReviewCert.student?.fullName || "Student"}</strong> ({activeReviewCert.studentProfile?.enrollmentNumber || "USN not set"})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseReview}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body: Split Pane */}
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Pane: Document Viewer (5 cols) */}
              <div className="lg:col-span-5 flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Document Preview</span>
                  {documentBlobUrl && (
                    <a
                      href={documentBlobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:underline"
                    >
                      <span>Open Full Window</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden min-h-[340px] max-h-[480px] flex items-center justify-center relative">
                  {loadingDocument ? (
                    <div className="flex flex-col items-center gap-2 text-slate-400 p-8">
                      <RefreshCw className="h-6 w-6 animate-spin text-indigo-600" />
                      <span className="text-xs font-semibold">Loading secure document...</span>
                    </div>
                  ) : documentBlobUrl ? (
                    activeReviewCert.file?.mimeType === "application/pdf" ? (
                      <iframe
                        src={`${documentBlobUrl}#toolbar=0`}
                        title={activeReviewCert.title}
                        className="w-full h-[420px] border-0"
                      />
                    ) : (
                      <img
                        src={documentBlobUrl}
                        alt={activeReviewCert.title}
                        className="w-full h-full object-contain p-2"
                      />
                    )
                  ) : (
                    <div className="text-center p-6 text-slate-400">
                      <FileText className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                      <p className="text-xs font-semibold">Preview unavailable</p>
                    </div>
                  )}
                </div>

                {/* File Details */}
                <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-500 border border-slate-100 space-y-1">
                  <p className="truncate font-mono">Original: {activeReviewCert.file?.originalName}</p>
                  <p className="truncate font-mono">SHA-256: {activeReviewCert.file?.fileHash}</p>
                </div>
              </div>

              {/* Right Pane: Verification Intelligence & Decision Form (7 cols) */}
              <div className="lg:col-span-7 space-y-5">
                {/* 1. Official Issuer Verification Evidence */}
                <div
                  className={`rounded-2xl p-4 border space-y-3 ${
                    activeReviewCert.verificationStatus === "VERIFIED"
                      ? "bg-emerald-50/80 border-emerald-200"
                      : activeReviewCert.verificationStatus === "VERIFICATION_FAILED"
                      ? "bg-rose-50/80 border-rose-200"
                      : "bg-amber-50/70 border-amber-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-indigo-600" />
                      <span>Official Authenticity Verification</span>
                    </h5>
                    {renderStatusBadge(activeReviewCert.verificationStatus, activeReviewCert.verificationMethod)}
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed font-medium">
                    {activeReviewCert.verificationEvidence?.summary ||
                      activeReviewCert.auditHistory?.slice(-1)[0]?.reason ||
                      "Verification check recorded against issuer registry."}
                  </p>

                  {/* If Verified: display matched fields breakdown */}
                  {activeReviewCert.verificationStatus === "VERIFIED" && activeReviewCert.verificationEvidence && (
                    <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-emerald-200/60">
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Verified Recipient</span>
                        <p className="font-bold text-slate-800">{activeReviewCert.verificationEvidence.recipientName || "—"}</p>
                      </div>
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Credential ID</span>
                        <p className="font-bold font-mono text-slate-800">{activeReviewCert.verificationEvidence.credentialId || activeReviewCert.certificateId || "—"}</p>
                      </div>
                      <div className="col-span-2 bg-white/80 p-2 rounded-lg border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Verified Programme / Title</span>
                        <p className="font-bold text-slate-800">
                          {activeReviewCert.verificationEvidence.programmeName || activeReviewCert.verificationEvidence.courseName || activeReviewCert.title}
                        </p>
                      </div>
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Issuing Organization</span>
                        <p className="font-bold text-slate-800">{activeReviewCert.verificationEvidence.provider || activeReviewCert.issuer}</p>
                      </div>
                      <div className="bg-white/80 p-2 rounded-lg border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Official Issue Date</span>
                        <p className="font-bold text-slate-800">
                          {activeReviewCert.verificationEvidence.issuedDate ||
                            (activeReviewCert.issueDate ? new Date(activeReviewCert.issueDate).toLocaleDateString() : "—")}
                        </p>
                      </div>
                      {activeReviewCert.verificationEvidence.verificationCode && (
                        <div className="bg-white/80 p-2 rounded-lg border border-emerald-100 col-span-2">
                          <span className="text-[10px] font-bold text-emerald-700 uppercase">Verification Code</span>
                          <p className="font-mono text-xs text-slate-850 break-all">{activeReviewCert.verificationEvidence.verificationCode}</p>
                        </div>
                      )}
                      <div className="col-span-2 pt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-emerald-800">
                        <span>Matched Fields:</span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5">Recipient ✓</span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5">Credential ID ✓</span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5">Programme ✓</span>
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5">Issue Date ✓</span>
                      </div>
                    </div>
                  )}

                  {/* If Needs Review with Comparison: display authoritative comparison table */}
                  {activeReviewCert.verificationStatus === "NEEDS_REVIEW" && activeReviewCert.verificationEvidence?.comparison && (
                    <div className="space-y-2 pt-2 border-t border-amber-200/70">
                      <p className="text-[10px] font-bold text-amber-950 uppercase tracking-wider">
                        Official Registry Comparison & Discrepancies
                      </p>
                      <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-amber-100/60 text-[10px] font-bold text-amber-900 uppercase border-b border-amber-200">
                              <th className="p-2">Field</th>
                              <th className="p-2">Submitted Data</th>
                              <th className="p-2">Official Registry</th>
                              <th className="p-2">Comparison Result</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-amber-100 text-[11px]">
                            {/* Recipient */}
                            <tr>
                              <td className="p-2 font-bold text-slate-700">Recipient</td>
                              <td className="p-2 text-slate-800">{activeReviewCert.verificationEvidence.comparison.recipient?.submitted || "—"}</td>
                              <td className="p-2 font-bold text-slate-900">{activeReviewCert.verificationEvidence.comparison.recipient?.official || "—"}</td>
                              <td className="p-2">
                                {activeReviewCert.verificationEvidence.comparison.recipient?.match ? (
                                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Matched
                                  </span>
                                ) : (
                                  <span className="font-bold text-rose-700">Mismatch</span>
                                )}
                              </td>
                            </tr>
                            {/* Certificate ID */}
                            <tr>
                              <td className="p-2 font-bold text-slate-700">Certificate ID</td>
                              <td className="p-2 font-mono text-slate-800">{activeReviewCert.verificationEvidence.comparison.certificateId?.submitted || "—"}</td>
                              <td className="p-2 font-mono font-bold text-slate-900">{activeReviewCert.verificationEvidence.comparison.certificateId?.official || "—"}</td>
                              <td className="p-2">
                                {activeReviewCert.verificationEvidence.comparison.certificateId?.match ? (
                                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Matched
                                  </span>
                                ) : (
                                  <span className="font-bold text-rose-700">Mismatch</span>
                                )}
                              </td>
                            </tr>
                            {/* Programme / Title */}
                            <tr>
                              <td className="p-2 font-bold text-slate-700">Programme Title</td>
                              <td className="p-2 text-slate-800">{activeReviewCert.verificationEvidence.comparison.programme?.submitted || "—"}</td>
                              <td className="p-2 font-bold text-slate-900">{activeReviewCert.verificationEvidence.comparison.programme?.official || "—"}</td>
                              <td className="p-2">
                                {activeReviewCert.verificationEvidence.comparison.programme?.match ? (
                                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Matched
                                  </span>
                                ) : (
                                  <span className="inline-flex flex-col text-amber-800 font-semibold text-[10px]">
                                    <span className="font-bold text-amber-900">Discrepancy</span>
                                    <span>{activeReviewCert.verificationEvidence.comparison.programme?.details}</span>
                                  </span>
                                )}
                              </td>
                            </tr>
                            {/* Issue Date */}
                            <tr>
                              <td className="p-2 font-bold text-slate-700">Issue Date</td>
                              <td className="p-2 text-slate-800">{activeReviewCert.verificationEvidence.comparison.issueDate?.submitted || "—"}</td>
                              <td className="p-2 font-bold text-slate-900">{activeReviewCert.verificationEvidence.comparison.issueDate?.official || "—"}</td>
                              <td className="p-2">
                                {activeReviewCert.verificationEvidence.comparison.issueDate?.match ? (
                                  <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Matched
                                  </span>
                                ) : (
                                  <span className="inline-flex flex-col text-amber-800 font-semibold text-[10px]">
                                    <span className="font-bold text-amber-900">Discrepancy</span>
                                    <span>{activeReviewCert.verificationEvidence.comparison.issueDate?.details}</span>
                                  </span>
                                )}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Adopt Button for Officer */}
                      {activeReviewCert.verificationEvidence?.officialFields && (
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={() => handleAdoptOfficialAdmin(activeReviewCert._id)}
                            disabled={adoptingId === activeReviewCert._id}
                            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-700 hover:to-indigo-700 text-white font-bold py-2 px-3.5 text-xs shadow-xs transition active:scale-95 disabled:opacity-50"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            <span>{adoptingId === activeReviewCert._id ? "Adopting..." : "Adopt Official Registry Details & Verify"}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Clickable Verification URL */}
                  {(activeReviewCert.verificationEvidence?.issuerVerificationUrl || activeReviewCert.verificationUrl) && (
                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-medium">Official Registry:</span>
                      <a
                        href={activeReviewCert.verificationEvidence?.issuerVerificationUrl || activeReviewCert.verificationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-bold text-indigo-600 hover:text-indigo-700 hover:underline text-[11px]"
                      >
                        <span>Inspect official verification page</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>

                {/* 2. Document Analysis Inconsistency Signals */}
                {activeReviewCert.documentAnalysis?.flags?.length > 0 && (
                  <div className="rounded-2xl bg-amber-50/80 border border-amber-200 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span>Document Analysis Signals ({activeReviewCert.documentAnalysis.flags.length})</span>
                    </div>
                    <ul className="space-y-1.5">
                      {activeReviewCert.documentAnalysis.flags.map((flag, idx) => (
                        <li key={idx} className="text-[11px] text-amber-800 flex items-start gap-1.5">
                          <span className="text-amber-500 font-bold">•</span>
                          <span>{flag.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 3. OCR Text Extraction Comparison */}
                <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                      <span>Extracted OCR Data vs Submitted Values</span>
                    </h5>
                    {activeReviewCert.extractedData?.ocrConfidence > 0 && (
                      <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
                        Confidence: {activeReviewCert.extractedData.ocrConfidence}%
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Candidate Name</span>
                      <p className="font-bold text-slate-900 mt-0.5">
                        {activeReviewCert.extractedData?.studentName || "—"}
                      </p>
                      <p className="text-[10px] text-slate-400">Profile: {activeReviewCert.student?.fullName}</p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Course / Title</span>
                      <p className="font-bold text-slate-900 mt-0.5">
                        {activeReviewCert.extractedData?.certificateTitle || "—"}
                      </p>
                      <p className="text-[10px] text-slate-400">Entered: {activeReviewCert.title}</p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Issuer</span>
                      <p className="font-bold text-slate-900 mt-0.5">
                        {activeReviewCert.extractedData?.issuer || "—"}
                      </p>
                      <p className="text-[10px] text-slate-400">Entered: {activeReviewCert.issuer}</p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Credential ID</span>
                      <p className="font-bold font-mono text-slate-900 mt-0.5">
                        {activeReviewCert.extractedData?.certificateId || "—"}
                      </p>
                      <p className="text-[10px] font-mono text-slate-400">Entered: {activeReviewCert.certificateId || "None"}</p>
                    </div>
                  </div>
                </div>

                {/* 4. Placement Officer Decision Form */}
                <form onSubmit={handleSubmitReview} className="rounded-2xl border border-indigo-200 bg-indigo-50/20 p-4 space-y-4">
                  <h5 className="text-xs font-bold text-indigo-950 uppercase tracking-wider">
                    Record Officer Decision
                  </h5>

                  {/* Decision Selector */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setReviewDecision("APPROVED")}
                      className={`rounded-xl border p-2.5 text-xs font-bold text-center transition ${
                        reviewDecision === "APPROVED"
                          ? "border-emerald-500 bg-emerald-50 text-emerald-800 shadow-xs"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <Check className="h-4 w-4 mx-auto mb-1 text-emerald-600" />
                      <span>Approve (Manual)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setReviewDecision("REJECTED")}
                      className={`rounded-xl border p-2.5 text-xs font-bold text-center transition ${
                        reviewDecision === "REJECTED"
                          ? "border-rose-500 bg-rose-50 text-rose-800 shadow-xs"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <XCircle className="h-4 w-4 mx-auto mb-1 text-rose-600" />
                      <span>Reject Certificate</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setReviewDecision("CORRECTION_REQUESTED")}
                      className={`rounded-xl border p-2.5 text-xs font-bold text-center transition ${
                        reviewDecision === "CORRECTION_REQUESTED"
                          ? "border-amber-500 bg-amber-50 text-amber-800 shadow-xs"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <RotateCcw className="h-4 w-4 mx-auto mb-1 text-amber-600" />
                      <span>Request Fix</span>
                    </button>
                  </div>

                  {/* Mandatory Reason when Rejecting or Requesting Fix */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Review Reason / Auditor Remarks{" "}
                      {reviewDecision !== "APPROVED" && <span className="text-rose-500">* (Mandatory)</span>}
                    </label>
                    <textarea
                      rows={2}
                      required={reviewDecision !== "APPROVED"}
                      placeholder={
                        reviewDecision === "APPROVED"
                          ? "Optional audit remark: Document reviewed and confirmed genuine..."
                          : "Specify the exact reason for rejection or correction required by the student..."
                      }
                      value={reviewReason}
                      onChange={(e) => setReviewReason(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-indigo-500 transition"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCloseReview}
                      className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submittingReview}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 text-xs font-bold shadow-md shadow-indigo-500/20 transition disabled:opacity-50"
                    >
                      {submittingReview ? "Recording Decision..." : "Confirm & Save Decision"}
                    </button>
                  </div>
                </form>

                {/* 5. Complete Audit History Log */}
                <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                  <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>Audit History</span>
                  </h5>
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {activeReviewCert.auditHistory?.map((log, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs pb-1.5 border-b border-slate-100 last:border-0">
                        <div className="mt-1 h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-slate-800">{log.action}</span>
                            <span className="text-slate-400 font-mono">
                              {new Date(log.timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">{log.reason || "Action performed"}</p>
                          <span className="text-[10px] text-slate-400">By: {log.performedByName || log.performedByRole}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
