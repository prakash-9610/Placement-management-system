import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  Award,
  Upload,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ExternalLink,
  RefreshCw,
  Eye,
  Edit3,
  Trash2,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Search,
  Plus,
  X,
  Sparkles,
  Building2
} from "lucide-react";
import {
  getMyCertificates,
  uploadCertificate,
  updateCertificate,
  deleteCertificate,
  verifyCertificate,
  adoptOfficialCertificateDetails,
  fetchCertificateBlob
} from "../../services/certificateService";

const CATEGORIES = [
  { id: "online_course", label: "Online Course" },
  { id: "internship", label: "Internship Certificate" },
  { id: "academic", label: "Academic / University" },
  { id: "technical", label: "Technical Certification" },
  { id: "other", label: "Other" }
];

const ISSUER_SUGGESTIONS = [
  "Coursera",
  "Udemy",
  "edX",
  "Google",
  "Amazon Web Services (AWS)",
  "Microsoft Learn",
  "DeepLearning.AI",
  "Credly",
  "HackerRank",
  "freeCodeCamp",
  "Cisco Networking Academy",
  "IBM SkillsBuild"
];

export default function CertificateManagement({ _studentUser, onProfileSync }) {
  // Main Data States
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterCategory, setFilterCategory] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Upload Modal State
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [formValues, setFormValues] = useState({
    title: "",
    category: "online_course",
    issuer: "",
    certificateId: "",
    verificationUrl: "",
    issueDate: "",
    expirationDate: "",
    qrCodeContent: ""
  });

  // Selected Certificate Detail Modal
  const [selectedCert, setSelectedCert] = useState(null);
  const [documentBlobUrl, setDocumentBlobUrl] = useState(null);
  const [loadingDocument, setLoadingDocument] = useState(false);

  // Edit / Correct Details Modal
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editValues, setEditValues] = useState({});
  const [updating, setUpdating] = useState(false);

  // Re-verification in-progress tracking
  const [verifyingId, setVerifyingId] = useState(null);

  const fileInputRef = useRef(null);

  // Load certificates from API
  const fetchCertificates = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await getMyCertificates();
      if (Array.isArray(res?.data)) {
        setCertificates(res.data);
      }
    } catch (err) {
      console.error("Failed to load certificates:", err);
      toast.error(err.response?.data?.message || "Failed to load certificates.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchCertificates();
  }, [fetchCertificates]);

  // Handle local file selection and preview
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
    if (!allowedTypes.includes(file.mimetype || file.type)) {
      toast.error("Invalid file type. Please upload a JPG, JPEG, PNG, or PDF.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size exceeds 10MB limit.");
      return;
    }

    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setFilePreviewUrl(objectUrl);
  };

  // Quick select an issuer pill
  const handleSelectIssuer = (issuerName) => {
    setFormValues((prev) => ({
      ...prev,
      issuer: issuerName
    }));
  };

  // Submit upload form
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      toast.error("Please select a certificate file.");
      return;
    }
    if (!formValues.title.trim()) {
      toast.error("Certificate title is required.");
      return;
    }
    if (!formValues.issuer.trim()) {
      toast.error("Issuing organization is required.");
      return;
    }

    const data = new FormData();
    data.append("file", selectedFile);
    data.append("title", formValues.title.trim());
    data.append("category", formValues.category);
    data.append("issuer", formValues.issuer.trim());
    data.append("certificateId", formValues.certificateId.trim());
    data.append("verificationUrl", formValues.verificationUrl.trim());
    if (formValues.issueDate) data.append("issueDate", formValues.issueDate);
    if (formValues.expirationDate) data.append("expirationDate", formValues.expirationDate);
    if (formValues.qrCodeContent) data.append("qrCodeContent", formValues.qrCodeContent.trim());

    setUploading(true);
    try {
      const res = await uploadCertificate(data);
      const newCert = res?.data;
      toast.success("Certificate submitted and analyzed successfully!");
      setIsUploadOpen(false);
      resetUploadForm();
      await fetchCertificates(true);

      // Open detail modal directly to inspect extracted details and status
      if (newCert) {
        setSelectedCert(newCert);
      }
      if (onProfileSync) onProfileSync();
    } catch (err) {
      console.error("Upload error:", err);
      toast.error(err.response?.data?.message || "Failed to upload certificate.");
    } finally {
      setUploading(false);
    }
  };

  const resetUploadForm = () => {
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setFormValues({
      title: "",
      category: "online_course",
      issuer: "",
      certificateId: "",
      verificationUrl: "",
      issueDate: "",
      expirationDate: "",
      qrCodeContent: ""
    });
  };

  // Fetch private document blob for safe in-app preview
  const handleOpenDetailModal = async (cert) => {
    setSelectedCert(cert);
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

  const handleCloseDetailModal = () => {
    if (documentBlobUrl) {
      URL.revokeObjectURL(documentBlobUrl);
      setDocumentBlobUrl(null);
    }
    setSelectedCert(null);
  };

  // Re-verify a certificate
  const handleVerify = async (certId) => {
    setVerifyingId(certId);
    try {
      const res = await verifyCertificate(certId);
      toast.success("Verification check completed!");
      const updated = res?.data;
      if (updated) {
        setCertificates((prev) => prev.map((c) => (c._id === certId ? updated : c)));
        if (selectedCert?._id === certId) {
          setSelectedCert(updated);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Verification request failed.");
    } finally {
      setVerifyingId(null);
    }
  };

  // Adopt official verified details (resolve discrepancies)
  const [adoptingId, setAdoptingId] = useState(null);

  const handleAdoptOfficial = async (certId) => {
    setAdoptingId(certId);
    try {
      const res = await adoptOfficialCertificateDetails(certId);
      toast.success("Adopted official registry details! Certificate verified.");
      const updated = res?.data;
      if (updated) {
        setCertificates((prev) => prev.map((c) => (c._id === certId ? updated : c)));
        if (selectedCert?._id === certId) {
          setSelectedCert(updated);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to adopt official verified details.");
    } finally {
      setAdoptingId(null);
    }
  };

  // Open edit / correct modal
  const handleOpenEdit = (cert) => {
    setSelectedCert(cert);
    setEditValues({
      title: cert.correctedData?.certificateTitle || cert.title || "",
      category: cert.category || "online_course",
      issuer: cert.correctedData?.issuer || cert.issuer || "",
      certificateId: cert.correctedData?.certificateId || cert.certificateId || "",
      verificationUrl: cert.correctedData?.verificationUrl || cert.verificationUrl || "",
      issueDate: cert.issueDate ? new Date(cert.issueDate).toISOString().split("T")[0] : "",
      expirationDate: cert.expirationDate ? new Date(cert.expirationDate).toISOString().split("T")[0] : ""
    });
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCert) return;

    setUpdating(true);
    try {
      const res = await updateCertificate(selectedCert._id, editValues);
      toast.success("Certificate details updated and re-verified!");
      const updated = res?.data;
      if (updated) {
        setCertificates((prev) => prev.map((c) => (c._id === selectedCert._id ? updated : c)));
        setSelectedCert(updated);
      }
      setIsEditOpen(false);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update certificate.");
    } finally {
      setUpdating(false);
    }
  };

  // Delete certificate
  const handleDelete = async (certId) => {
    if (!window.confirm("Are you sure you want to remove this certificate submission?")) return;

    try {
      await deleteCertificate(certId);
      toast.success("Certificate deleted.");
      setCertificates((prev) => prev.filter((c) => c._id !== certId));
      if (selectedCert?._id === certId) {
        handleCloseDetailModal();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete certificate.");
    }
  };

  // Filtered certificates list
  const filteredCertificates = certificates.filter((cert) => {
    if (filterStatus !== "ALL" && cert.verificationStatus !== filterStatus) return false;
    if (filterCategory !== "ALL" && cert.category !== filterCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = cert.title?.toLowerCase().includes(q);
      const matchIssuer = cert.issuer?.toLowerCase().includes(q);
      const matchId = cert.certificateId?.toLowerCase().includes(q);
      return matchTitle || matchIssuer || matchId;
    }
    return true;
  });

  // Calculate Summary Metrics
  const summaryMetrics = {
    total: certificates.length,
    verified: certificates.filter((c) => c.verificationStatus === "VERIFIED").length,
    needsReview: certificates.filter((c) => c.verificationStatus === "NEEDS_REVIEW").length,
    rejected: certificates.filter((c) => c.verificationStatus === "REJECTED" || c.verificationStatus === "VERIFICATION_FAILED").length
  };

  // Helper for status badge presentation
  const renderStatusBadge = (status, method) => {
    switch (status) {
      case "VERIFIED":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            <span>{method === "MANUAL_REVIEW" ? "Verified (TPO Review)" : "Verified (Issuer Confirmed)"}</span>
          </span>
        );
      case "NEEDS_REVIEW":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 border border-amber-200">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <span>Needs Manual Review</span>
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
            <span>Rejected by Officer</span>
          </span>
        );
      case "PROCESSING":
      case "PENDING":
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 border border-blue-200">
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600" />
            <span>Processing OCR</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/20">
              <Award className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Certificate Verification Center
              </h2>
              <p className="text-xs text-slate-500">
                Upload your course, internship, and technical certificates for automated OCR extraction and evidence-backed authenticity verification.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <button
            type="button"
            onClick={() => fetchCertificates(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${refreshing ? "animate-spin" : ""}`} />
            <span>Sync</span>
          </button>

          <button
            type="button"
            onClick={() => {
              resetUploadForm();
              setIsUploadOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-2 text-xs font-bold shadow-md shadow-blue-500/20 transition active:scale-95"
          >
            <Plus className="h-4 w-4" />
            <span>Upload Certificate</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Submissions</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{summaryMetrics.total}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-4 shadow-2xs">
          <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Authentic & Verified</p>
          <p className="text-2xl font-black text-emerald-700 mt-1">{summaryMetrics.verified}</p>
        </div>
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 shadow-2xs">
          <p className="text-xs font-bold text-amber-600 uppercase tracking-wider">Manual Review Needed</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{summaryMetrics.needsReview}</p>
        </div>
        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/40 p-4 shadow-2xs">
          <p className="text-xs font-bold text-rose-600 uppercase tracking-wider">Unverified / Rejected</p>
          <p className="text-2xl font-black text-rose-700 mt-1">{summaryMetrics.rejected}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by title, issuer, credential ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3.5 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-bold hidden sm:inline">Status:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-white cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="VERIFIED">Verified</option>
              <option value="NEEDS_REVIEW">Needs Review</option>
              <option value="VERIFICATION_FAILED">Verification Failed</option>
              <option value="REJECTED">Rejected</option>
              <option value="PROCESSING">Processing</option>
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-400 font-bold hidden sm:inline">Category:</span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 focus:bg-white cursor-pointer"
            >
              <option value="ALL">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Certificates Listing Cards */}
      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 rounded-3xl border border-slate-200/80 bg-white shadow-2xs space-y-3">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-xs font-bold text-slate-500">Loading certificate records...</p>
        </div>
      ) : filteredCertificates.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-3xl border border-dashed border-slate-300 bg-slate-50/50 space-y-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 border border-blue-100">
            <Award className="h-7 w-7" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-800">No certificates found</h3>
            <p className="text-xs text-slate-500 max-w-sm mt-1">
              {searchQuery || filterStatus !== "ALL" || filterCategory !== "ALL"
                ? "No uploaded certificates match your filter criteria. Try resetting the filters."
                : "You haven't uploaded any certificates yet. Add your certifications to highlight your credentials for placement drives."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              resetUploadForm();
              setIsUploadOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-bold shadow-xs transition"
          >
            <Plus className="h-4 w-4" />
            <span>Upload Your First Certificate</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredCertificates.map((cert) => {
            const hasFlags = cert.documentAnalysis?.hasInconsistencies;
            const flagsCount = cert.documentAnalysis?.flags?.length || 0;
            const isVerifying = verifyingId === cert._id;

            return (
              <div
                key={cert._id}
                className="group relative flex flex-col justify-between rounded-3xl border border-slate-200/90 bg-white p-5 shadow-2xs hover:shadow-md hover:border-slate-300 transition-all"
              >
                <div>
                  {/* Top Header: Category and Status Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      {CATEGORIES.find((c) => c.id === cert.category)?.label || cert.category}
                    </span>
                    {renderStatusBadge(cert.verificationStatus, cert.verificationMethod)}
                  </div>

                  {/* Title & Issuer */}
                  <div className="mt-3.5">
                    <h4 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                      {cert.title}
                    </h4>
                    <p className="text-xs font-semibold text-slate-500 mt-1 flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-slate-400" />
                      <span>{cert.issuer}</span>
                    </p>
                  </div>

                  {/* Verification & Metadata Summary */}
                  <div className="mt-4 rounded-2xl bg-slate-50/70 p-3.5 border border-slate-100 space-y-2.5 text-[11px]">
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="text-slate-400 font-sans">Certificate ID:</span>
                      <span className="font-bold font-mono text-slate-800 truncate max-w-[170px]">
                        {cert.certificateId || cert.verificationEvidence?.credentialId || (
                          <span className="text-slate-400 italic font-sans">Pending</span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-slate-600">
                      <span className="text-slate-400">Verification Method:</span>
                      <span className="font-semibold text-slate-700">
                        {cert.verificationMethod === "OFFICIAL_URL"
                          ? "Official URL Registry"
                          : cert.verificationMethod === "OFFICIAL_API"
                          ? "Official Issuer API"
                          : cert.verificationMethod === "MANUAL_REVIEW"
                          ? "Placement Officer Audit"
                          : "Awaiting Verification"}
                      </span>
                    </div>

                    {cert.issueDate && (
                      <div className="flex items-center justify-between text-slate-600">
                        <span className="text-slate-400">Issued:</span>
                        <span className="font-medium">
                          {new Date(cert.issueDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric"
                          })}
                        </span>
                      </div>
                    )}

                    {/* Clickable Official Verification URL */}
                    {(cert.verificationUrl || cert.verificationEvidence?.issuerVerificationUrl) ? (
                      <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60">
                        <span className="text-slate-400">Official Link:</span>
                        <a
                          href={cert.verificationEvidence?.issuerVerificationUrl || cert.verificationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          <span>Verify with Issuer</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/60 text-slate-400">
                        <span>Official Link:</span>
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(cert)}
                          className="text-blue-600 font-bold hover:underline"
                        >
                          + Add URL
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Official Evidence Result for Verified Certificates */}
                  {cert.verificationStatus === "VERIFIED" && (
                    <div className="mt-3 rounded-2xl bg-emerald-50/90 border border-emerald-200 p-3 text-xs text-emerald-900 space-y-1.5">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-800 text-[11px]">
                        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span>Official Verification: Authentic & Confirmed</span>
                      </div>
                      <div className="flex flex-wrap gap-1 text-[10px] text-emerald-700">
                        <span className="rounded bg-emerald-100/70 px-1.5 py-0.5 font-semibold">✓ Name Matched</span>
                        <span className="rounded bg-emerald-100/70 px-1.5 py-0.5 font-semibold">✓ Course Matched</span>
                        <span className="rounded bg-emerald-100/70 px-1.5 py-0.5 font-semibold">✓ ID Validated</span>
                      </div>
                    </div>
                  )}

                  {/* Reason for Needs Review & Discrepancies Notice */}
                  {cert.verificationStatus === "NEEDS_REVIEW" && (
                    <div className="mt-3 rounded-2xl bg-amber-50/90 border border-amber-200 p-3 text-xs text-amber-900 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-bold text-amber-800 text-[11px]">
                          <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                          <span>Needs Manual Review</span>
                        </div>
                        {cert.verificationEvidence?.provider && (
                          <span className="text-[10px] font-bold bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full border border-amber-300">
                            {cert.verificationEvidence.provider} Verified
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-amber-800 leading-snug">
                        {cert.auditHistory?.slice(-1)[0]?.reason || cert.verificationEvidence?.summary || "Official verification evidence pending officer confirmation."}
                      </p>

                      {/* Discrepancies Breakdown Notice */}
                      {cert.verificationEvidence?.discrepancies?.length > 0 && (
                        <div className="pt-2 border-t border-amber-200/80 space-y-1.5">
                          <p className="text-[10px] font-bold text-amber-950 uppercase tracking-wider">
                            Official Registry Discrepancies ({cert.verificationEvidence.discrepancies.length})
                          </p>
                          <ul className="space-y-1 text-[11px] text-amber-850">
                            {cert.verificationEvidence.discrepancies.map((disc, dIdx) => (
                              <li key={dIdx} className="flex items-start gap-1.5">
                                <span className="text-amber-600 font-bold">•</span>
                                <span className="leading-tight">{disc}</span>
                              </li>
                            ))}
                          </ul>

                          {cert.verificationEvidence?.officialFields && (
                            <button
                              type="button"
                              onClick={() => handleAdoptOfficial(cert._id)}
                              disabled={adoptingId === cert._id}
                              className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold py-1.5 px-3 text-xs shadow-xs transition active:scale-95 disabled:opacity-50"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>{adoptingId === cert._id ? "Adopting..." : "Adopt Official Verified Details"}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Inconsistency or Failure Warning Signal */}
                  {cert.verificationStatus === "VERIFICATION_FAILED" && (
                    <div className="mt-3 rounded-2xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex items-start gap-2">
                      <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-rose-600" />
                      <div>
                        <p className="font-bold text-[11px] text-rose-900">Verification Failed</p>
                        <p className="text-[11px] text-rose-700 leading-snug">
                          {cert.auditHistory?.slice(-1)[0]?.reason || "Issuer registry reported this certificate ID is invalid or mismatched."}
                        </p>
                      </div>
                    </div>
                  )}

                  {cert.verificationStatus === "REJECTED" && (
                    <div className="mt-3 rounded-2xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800">
                      <p className="font-bold text-[11px] text-rose-900">Rejected by Placement Officer</p>
                      <p className="text-[11px] text-rose-700 mt-0.5">{cert.reviewReason || "Requirements not met."}</p>
                    </div>
                  )}

                  {/* OCR Quality Notice (Cleanly separated from authenticity) */}
                  {cert.extractedData?.ocrConfidence > 0 && (
                    <div className="mt-2.5 flex items-center justify-between text-[10px] text-slate-400 px-1">
                      <span>OCR Extraction Fidelity:</span>
                      <span className="font-semibold text-slate-500">{cert.extractedData.ocrConfidence}%</span>
                    </div>
                  )}
                </div>

                {/* Bottom Actions Card */}
                <div className="mt-5 pt-3.5 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenDetailModal(cert)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 px-3 py-1.5 text-xs font-bold transition"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>View & Inspect</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    {/* Re-verify Button */}
                    <button
                      type="button"
                      title="Run automated issuer verification"
                      onClick={() => handleVerify(cert._id)}
                      disabled={isVerifying}
                      className="p-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition"
                    >
                      <RefreshCw className={`h-4 w-4 ${isVerifying ? "animate-spin text-blue-600" : ""}`} />
                    </button>

                    {/* Edit Details */}
                    {cert.verificationStatus !== "VERIFIED" && (
                      <button
                        type="button"
                        title="Correct details"
                        onClick={() => handleOpenEdit(cert)}
                        className="p-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    )}

                    {/* Delete */}
                    {cert.verificationStatus !== "VERIFIED" && (
                      <button
                        type="button"
                        title="Delete certificate"
                        onClick={() => handleDelete(cert._id)}
                        className="p-1.5 rounded-xl border border-slate-200 text-rose-500 hover:bg-rose-50 hover:border-rose-200 transition"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================= MODAL 1: UPLOAD CERTIFICATE WIZARD ================= */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-2xl rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
                  <Upload className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Upload Certificate</h3>
                  <p className="text-[11px] text-slate-400">PDF, JPG, or PNG up to 10MB</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsUploadOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleUploadSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* File Dropzone */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Certificate Document <span className="text-rose-500">*</span>
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition ${
                    selectedFile
                      ? "border-blue-500 bg-blue-50/30"
                      : "border-slate-200 hover:border-blue-400 hover:bg-slate-50/70"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  {selectedFile ? (
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
                        <FileText className="h-6 w-6" />
                      </div>
                      <div className="text-left">
                        <p className="text-xs font-bold text-slate-900 truncate max-w-xs">{selectedFile.name}</p>
                        <p className="text-[11px] text-slate-500">
                          {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {selectedFile.type || "Document"}
                        </p>
                        <span className="text-[10px] font-bold text-blue-600 underline">Click to change file</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 group-hover:scale-105 transition-transform mb-2">
                        <Upload className="h-6 w-6" />
                      </div>
                      <p className="text-xs font-bold text-slate-800">
                        Click to upload or drag & drop certificate
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        High-resolution images or vector PDFs produce the best OCR accuracy
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Category Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Certificate Category <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setFormValues((p) => ({ ...p, category: cat.id }))}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold text-left transition ${
                        formValues.category === cat.id
                          ? "border-blue-600 bg-blue-50/70 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Certificate Title */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Course or Certificate Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Machine Learning Specialization, AWS Solutions Architect..."
                  value={formValues.title}
                  onChange={(e) => setFormValues((p) => ({ ...p, title: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition"
                />
              </div>

              {/* Issuing Organization with Quick Preset Pills */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Issuing Organization <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Coursera, DeepLearning.AI, Stanford University..."
                  value={formValues.issuer}
                  onChange={(e) => setFormValues((p) => ({ ...p, issuer: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition"
                />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400">Popular:</span>
                  {ISSUER_SUGGESTIONS.slice(0, 6).map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => handleSelectIssuer(sug)}
                      className="rounded-lg bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600 transition"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              {/* Verification URL & Certificate ID */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Official Verification URL <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="url"
                    placeholder="https://coursera.org/verify/..."
                    value={formValues.verificationUrl}
                    onChange={(e) => setFormValues((p) => ({ ...p, verificationUrl: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Enables instant automated verification for supported issuers</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Certificate / Credential ID <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ML9482710492"
                    value={formValues.certificateId}
                    onChange={(e) => setFormValues((p) => ({ ...p, certificateId: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition"
                  />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Issue Date <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="date"
                    value={formValues.issueDate}
                    onChange={(e) => setFormValues((p) => ({ ...p, issueDate: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Expiration Date <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <input
                    type="date"
                    value={formValues.expirationDate}
                    onChange={(e) => setFormValues((p) => ({ ...p, expirationDate: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white transition"
                  />
                </div>
              </div>

              {/* Bottom Actions */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  disabled={uploading}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-xs font-bold shadow-md shadow-blue-500/20 transition disabled:opacity-50"
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Extracting OCR & Verifying...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      <span>Submit for Verification</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL 2: INSPECT DETAILS, EVIDENCE & AUDIT TRAIL ================= */}
      {selectedCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-4xl rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-xs">
                  <Award className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-snug">{selectedCert.title}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-semibold text-slate-500">{selectedCert.issuer}</span>
                    <span className="text-slate-300">•</span>
                    {renderStatusBadge(selectedCert.verificationStatus, selectedCert.verificationMethod)}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseDetailModal}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body: Split Pane */}
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Document Preview (5 cols) */}
              <div className="lg:col-span-5 flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Document Preview</span>
                  {documentBlobUrl && (
                    <a
                      href={documentBlobUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:underline"
                    >
                      <span>Open Tab</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-100 overflow-hidden min-h-[320px] max-h-[460px] flex items-center justify-center relative">
                  {loadingDocument ? (
                    <div className="flex flex-col items-center gap-2 text-slate-400 p-8">
                      <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
                      <span className="text-xs font-semibold">Loading secure document...</span>
                    </div>
                  ) : documentBlobUrl ? (
                    selectedCert.file?.mimeType === "application/pdf" ? (
                      <iframe
                        src={`${documentBlobUrl}#toolbar=0`}
                        title={selectedCert.title}
                        className="w-full h-[400px] border-0"
                      />
                    ) : (
                      <img
                        src={documentBlobUrl}
                        alt={selectedCert.title}
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

                {/* File Metadata Chip */}
                <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-500 border border-slate-100 space-y-1">
                  <p className="truncate font-mono">File: {selectedCert.file?.originalName}</p>
                  <p className="truncate font-mono">Hash: {selectedCert.file?.fileHash?.slice(0, 20)}...</p>
                </div>
              </div>

              {/* Right Column: OCR Extraction, Analysis & Audit (7 cols) */}
              <div className="lg:col-span-7 space-y-5">
                {/* 1. Official Verification Evidence Banner (When Verified) */}
                {selectedCert.verificationStatus === "VERIFIED" && selectedCert.verificationEvidence && (
                  <div className="rounded-2xl bg-emerald-50/90 border border-emerald-200 p-4 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-emerald-850 font-bold text-xs">
                        <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" />
                        <span className="text-sm font-black text-emerald-900">
                          {selectedCert.verificationEvidence.officialStatusText || "Certificate verified"}
                        </span>
                      </div>
                      <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[10px] font-bold border border-emerald-300">
                        {selectedCert.verificationEvidence.provider || "Official Issuer"} Confirmed
                      </span>
                    </div>

                    <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                      {selectedCert.verificationEvidence.summary || "Authenticity confirmed by official issuer verification records."}
                    </p>

                    {/* Verified Details Grid */}
                    <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-emerald-200/70 text-xs">
                      <div className="bg-white/80 rounded-xl p-2.5 border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Verified Recipient</span>
                        <p className="font-bold text-slate-900 mt-0.5">
                          {selectedCert.verificationEvidence.recipientName || "—"}
                        </p>
                      </div>

                      <div className="bg-white/80 rounded-xl p-2.5 border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Credential ID</span>
                        <p className="font-bold font-mono text-slate-900 mt-0.5">
                          {selectedCert.verificationEvidence.credentialId || selectedCert.certificateId || "—"}
                        </p>
                      </div>

                      <div className="bg-white/80 rounded-xl p-2.5 border border-emerald-100 col-span-2">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Verified Programme / Course</span>
                        <p className="font-bold text-slate-900 mt-0.5">
                          {selectedCert.verificationEvidence.programmeName || selectedCert.verificationEvidence.courseName || selectedCert.title}
                        </p>
                      </div>

                      <div className="bg-white/80 rounded-xl p-2.5 border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Issuing Organization</span>
                        <p className="font-bold text-slate-900 mt-0.5">
                          {selectedCert.verificationEvidence.provider || selectedCert.issuer}
                        </p>
                      </div>

                      <div className="bg-white/80 rounded-xl p-2.5 border border-emerald-100">
                        <span className="text-[10px] font-bold text-emerald-700 uppercase">Official Issue Date</span>
                        <p className="font-bold text-slate-900 mt-0.5">
                          {selectedCert.verificationEvidence.issuedDate ||
                            (selectedCert.issueDate ? new Date(selectedCert.issueDate).toLocaleDateString() : "—")}
                        </p>
                      </div>

                      {selectedCert.verificationEvidence.verificationCode && (
                        <div className="bg-white/80 rounded-xl p-2.5 border border-emerald-100 col-span-2">
                          <span className="text-[10px] font-bold text-emerald-700 uppercase">Verification Code</span>
                          <p className="font-mono text-xs text-slate-800 break-all mt-0.5">
                            {selectedCert.verificationEvidence.verificationCode}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Matched Fields & External Official URL */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-emerald-200/70 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                        <span>Matched Fields:</span>
                        <span className="rounded bg-emerald-200/60 px-1.5 py-0.5 text-[10px]">Recipient ✓</span>
                        <span className="rounded bg-emerald-200/60 px-1.5 py-0.5 text-[10px]">Credential ID ✓</span>
                        <span className="rounded bg-emerald-200/60 px-1.5 py-0.5 text-[10px]">Programme ✓</span>
                        <span className="rounded bg-emerald-200/60 px-1.5 py-0.5 text-[10px]">Issue Date ✓</span>
                      </div>

                      {(selectedCert.verificationEvidence.issuerVerificationUrl || selectedCert.verificationUrl) && (
                        <a
                          href={selectedCert.verificationEvidence.issuerVerificationUrl || selectedCert.verificationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-blue-700 hover:text-blue-800 hover:underline text-[11px]"
                        >
                          <span>Open Official Verification Page</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* 2. Official Registry Review Banner (When Needs Review) */}
                {selectedCert.verificationStatus === "NEEDS_REVIEW" && (
                  <div className="rounded-2xl bg-amber-50/90 border border-amber-200 p-4 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                        <Clock className="h-4.5 w-4.5 text-amber-600" />
                        <span className="text-sm font-black">Needs Manual Review</span>
                      </div>
                      {selectedCert.verificationEvidence?.provider && (
                        <span className="rounded-full bg-amber-100 text-amber-900 px-2.5 py-0.5 text-[10px] font-bold border border-amber-300">
                          {selectedCert.verificationEvidence.provider} Registry Responded
                        </span>
                      )}
                    </div>

                    <div className="bg-white/80 rounded-xl p-3 border border-amber-200/80 text-xs space-y-1">
                      <p className="font-bold text-amber-950">Review Reason:</p>
                      <p className="text-amber-850 leading-relaxed text-[11px]">
                        {selectedCert.auditHistory?.slice(-1)[0]?.reason ||
                          selectedCert.verificationEvidence?.summary ||
                          "Official verification records require manual officer confirmation."}
                      </p>
                    </div>

                    {/* Authoritative Field-by-Field Comparison Table */}
                    {selectedCert.verificationEvidence?.comparison && (
                      <div className="space-y-2 pt-2 border-t border-amber-200/80">
                        <p className="text-[11px] font-bold text-amber-950 uppercase tracking-wider">
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
                                <td className="p-2 text-slate-800">{selectedCert.verificationEvidence.comparison.recipient?.submitted || "—"}</td>
                                <td className="p-2 font-bold text-slate-900">{selectedCert.verificationEvidence.comparison.recipient?.official || "—"}</td>
                                <td className="p-2">
                                  {selectedCert.verificationEvidence.comparison.recipient?.match ? (
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
                                <td className="p-2 font-mono text-slate-800">{selectedCert.verificationEvidence.comparison.certificateId?.submitted || "—"}</td>
                                <td className="p-2 font-mono font-bold text-slate-900">{selectedCert.verificationEvidence.comparison.certificateId?.official || "—"}</td>
                                <td className="p-2">
                                  {selectedCert.verificationEvidence.comparison.certificateId?.match ? (
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
                                <td className="p-2 text-slate-800">{selectedCert.verificationEvidence.comparison.programme?.submitted || "—"}</td>
                                <td className="p-2 font-bold text-slate-900">{selectedCert.verificationEvidence.comparison.programme?.official || "—"}</td>
                                <td className="p-2">
                                  {selectedCert.verificationEvidence.comparison.programme?.match ? (
                                    <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Matched
                                    </span>
                                  ) : (
                                    <span className="inline-flex flex-col text-amber-800 font-semibold text-[10px]">
                                      <span className="font-bold text-amber-900">Discrepancy</span>
                                      <span>{selectedCert.verificationEvidence.comparison.programme?.details}</span>
                                    </span>
                                  )}
                                </td>
                              </tr>
                              {/* Issue Date */}
                              <tr>
                                <td className="p-2 font-bold text-slate-700">Issue Date</td>
                                <td className="p-2 text-slate-800">{selectedCert.verificationEvidence.comparison.issueDate?.submitted || "—"}</td>
                                <td className="p-2 font-bold text-slate-900">{selectedCert.verificationEvidence.comparison.issueDate?.official || "—"}</td>
                                <td className="p-2">
                                  {selectedCert.verificationEvidence.comparison.issueDate?.match ? (
                                    <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                                      <CheckCircle2 className="h-3.5 w-3.5" /> Matched
                                    </span>
                                  ) : (
                                    <span className="inline-flex flex-col text-amber-800 font-semibold text-[10px]">
                                      <span className="font-bold text-amber-900">Discrepancy</span>
                                      <span>{selectedCert.verificationEvidence.comparison.issueDate?.details}</span>
                                    </span>
                                  )}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>

                        {/* Adopt Official Details Action Button */}
                        {selectedCert.verificationEvidence?.officialFields && (
                          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => handleAdoptOfficial(selectedCert._id)}
                              disabled={adoptingId === selectedCert._id}
                              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-700 hover:to-indigo-700 text-white font-bold py-2 px-4 text-xs shadow-md shadow-amber-500/20 transition active:scale-95 disabled:opacity-50"
                            >
                              <Sparkles className="h-4 w-4" />
                              <span>{adoptingId === selectedCert._id ? "Adopting Details..." : "Adopt Official Verified Details & Mark Verified"}</span>
                            </button>
                            <span className="text-[11px] text-slate-500 italic">
                              Adopts official programme title and issue date.
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Official verification link & manual edit */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs pt-1 border-t border-amber-200/60">
                      {(selectedCert.verificationEvidence?.issuerVerificationUrl || selectedCert.verificationUrl) ? (
                        <a
                          href={selectedCert.verificationEvidence?.issuerVerificationUrl || selectedCert.verificationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:underline"
                        >
                          <span>Official Registry Link: {selectedCert.verificationEvidence?.issuerVerificationUrl || selectedCert.verificationUrl}</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-amber-700 italic">No verification URL attached.</span>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          handleCloseDetailModal();
                          handleOpenEdit(selectedCert);
                        }}
                        className="rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 px-2.5 py-1 text-[11px] font-bold transition self-start sm:self-auto"
                      >
                        Manually Edit Details
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. Verification Failed Banner */}
                {selectedCert.verificationStatus === "VERIFICATION_FAILED" && (
                  <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 space-y-2 shadow-2xs">
                    <div className="flex items-center gap-2 text-rose-900 font-bold text-xs">
                      <ShieldAlert className="h-4.5 w-4.5 text-rose-600" />
                      <span className="text-sm font-black">Official Verification Rejected</span>
                    </div>
                    <p className="text-xs text-rose-700 leading-relaxed">
                      {selectedCert.auditHistory?.slice(-1)[0]?.reason ||
                        "Official issuer registry responded that the certificate ID is non-existent or issued to another person."}
                    </p>
                  </div>
                )}

                {/* 4. Document Analysis Inconsistency Signals (Advisory Only) */}
                {selectedCert.documentAnalysis?.flags?.length > 0 && selectedCert.verificationStatus !== "VERIFIED" && (
                  <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-3.5 space-y-2">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span>Document Inconsistency Signals ({selectedCert.documentAnalysis.flags.length})</span>
                    </div>
                    <ul className="space-y-1.5">
                      {selectedCert.documentAnalysis.flags.map((flag, idx) => (
                        <li key={idx} className="text-[11px] text-amber-800 flex items-start gap-1.5">
                          <span className="text-amber-500 font-bold">•</span>
                          <span>{flag.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 3. OCR Extracted Fields vs Submitted Values Comparison */}
                <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                      <span>OCR Extraction & Comparison</span>
                    </h5>
                    {selectedCert.extractedData?.ocrConfidence > 0 && (
                      <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                        OCR Confidence: {selectedCert.extractedData.ocrConfidence}%
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Extracted Recipient</span>
                      <p className="font-bold text-slate-800 truncate mt-0.5">
                        {selectedCert.extractedData?.studentName || "—"}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Extracted Title</span>
                      <p className="font-bold text-slate-800 truncate mt-0.5">
                        {selectedCert.extractedData?.certificateTitle || "—"}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Extracted ID</span>
                      <p className="font-bold font-mono text-slate-800 truncate mt-0.5">
                        {selectedCert.extractedData?.certificateId || "—"}
                      </p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Extracted Date</span>
                      <p className="font-bold text-slate-800 truncate mt-0.5">
                        {selectedCert.extractedData?.issueDate || "—"}
                      </p>
                    </div>
                  </div>

                  {selectedCert.correctedData?.isModifiedByStudent && (
                    <div className="rounded-xl bg-blue-50/50 p-2 text-[11px] text-blue-700 border border-blue-100">
                      Student updated metadata on{" "}
                      {new Date(selectedCert.correctedData.lastModifiedAt).toLocaleDateString()} (fields:{" "}
                      {selectedCert.correctedData.modifiedFields?.join(", ")})
                    </div>
                  )}
                </div>

                {/* 4. Complete Audit Trail */}
                <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                  <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                    <span>Audit Trail Log</span>
                  </h5>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {selectedCert.auditHistory?.map((log, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 text-xs pb-2 border-b border-slate-100 last:border-0">
                        <div className="mt-1 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-bold text-slate-800">{log.action}</span>
                            <span className="text-slate-400 font-mono">
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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

            {/* Modal Actions Footer */}
            <div className="border-t border-slate-100 px-6 py-3 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedCert.verificationStatus !== "VERIFIED" && (
                  <button
                    type="button"
                    onClick={() => {
                      handleCloseDetailModal();
                      handleOpenEdit(selectedCert);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>Correct Details</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleVerify(selectedCert._id)}
                  disabled={verifyingId === selectedCert._id}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${verifyingId === selectedCert._id ? "animate-spin" : ""}`} />
                  <span>Retry Verification</span>
                </button>
                <button
                  type="button"
                  onClick={handleCloseDetailModal}
                  className="rounded-xl px-4 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200/60 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL 3: EDIT / CORRECT DETAILS ================= */}
      {isEditOpen && selectedCert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900">Correct Certificate Metadata</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Course / Certificate Title</label>
                <input
                  type="text"
                  required
                  value={editValues.title}
                  onChange={(e) => setEditValues((p) => ({ ...p, title: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Issuing Organization</label>
                <input
                  type="text"
                  required
                  value={editValues.issuer}
                  onChange={(e) => setEditValues((p) => ({ ...p, issuer: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Official Verification URL</label>
                <input
                  type="url"
                  placeholder="https://coursera.org/verify/..."
                  value={editValues.verificationUrl}
                  onChange={(e) => setEditValues((p) => ({ ...p, verificationUrl: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Certificate / Credential ID</label>
                <input
                  type="text"
                  value={editValues.certificateId}
                  onChange={(e) => setEditValues((p) => ({ ...p, certificateId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono font-medium text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updating}
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition"
                >
                  {updating ? "Saving & Re-verifying..." : "Save & Re-verify"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
