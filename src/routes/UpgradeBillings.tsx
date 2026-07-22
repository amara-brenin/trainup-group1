import { useCallback, useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { Modal } from "../component/common/Modal";
import type { AdminUser, BillingPlanCatalogItem, BillingSummary } from "../constant/interfaces";
import { PermissionKeys } from "../constant/permissions";
import AxiosHelper from "../helper/AxiosHelper";
import { updateAdmin } from "../redux/authSlice";

const planLabels: Record<string, string> = {
  FREE: "Free",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
};

const formatCurrency = (amount?: number | null, currency = "INR") => {
  const value = Math.max(0, Number(amount || 0));
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatDateLabel = (value?: string | null) => {
  if (!value) {
    return "Current cycle";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const getExpiryDateLabel = (value?: string | null, planCode?: string) => {
  if (!value) {
    return "Current cycle";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  if (String(planCode || "").toUpperCase() === "FREE") {
    parsed.setDate(parsed.getDate() + 30);
  } else {
    parsed.setMonth(parsed.getMonth() + 1);
  }

  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

// D2: DB-driven plan row from GET /billing/plans.
type BillingPlanRow = {
  code: string; name: string; monthlyPrice: number; yearlyPrice: number; credits: number; discountPercentage?: number;
  trainingLimit: number | null; sessionLimit: number | null; userLimit: number | null; features: string[];
};

// Task 3: credit audit log row.
type CreditAuditRow = {
  id: string; timestamp: string; actionType: string; entityType: string; entityId: string;
  creditChange: number; balanceBefore: number; balanceAfter: number; performedBy: string;
  reason: string; reference: string;
};

const getTransactionStatus = (type?: string) => {
  if (type === "credit_purchase" || type === "plan_assignment" || type === "plan_purchase") {
    return { label: "Paid", className: "text-bg-success" };
  }

  return { label: "Used", className: "text-bg-warning" };
};

const buildInvoiceModel = ({
  transaction,
  clientName,
  currency,
}: {
  transaction: BillingSummary["recentTransactions"][number];
  clientName: string;
  currency: string;
}) => {
  const invoiceId = transaction.invoiceId || transaction.orderId || "Sandbox invoice";
  const planCode = String(transaction.planCode || "").toUpperCase();
  const planName = planLabels[planCode] ?? transaction.planCode ?? "Plan";
  const purchaseDate = formatDateLabel(transaction.createdAt);
  const expiryDate = getExpiryDateLabel(transaction.createdAt, transaction.planCode);
  const status = getTransactionStatus(transaction.type).label;
  const credits = Number(transaction.credits ?? 0).toLocaleString();
  const amount = formatCurrency(transaction.amount, transaction.currency || currency);
  const description = transaction.note || transaction.reason || "Billing invoice entry";
  const supportingText = transaction.reason || "Plan purchase";

  return {
    invoiceId,
    planName,
    purchaseDate,
    expiryDate,
    status,
    credits,
    amount,
    description,
    supportingText,
    clientName: clientName || "Client Workspace",
    currency: transaction.currency || currency,
  };
};

const createInvoicePdfUrl = ({
  transaction,
  clientName,
  currency,
}: {
  transaction: BillingSummary["recentTransactions"][number];
  clientName: string;
  currency: string;
}) => {
  const pdf = new jsPDF({
    unit: "pt",
    format: "a4",
  });

  const invoice = buildInvoiceModel({ transaction, clientName, currency });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const rightColX = pageWidth - margin;
  let cursorY = margin;

  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect(margin, cursorY, contentWidth, 92, 18, 18, "F");
  pdf.setDrawColor(226, 232, 240);
  pdf.roundedRect(margin, cursorY, contentWidth, 92, 18, 18);
  pdf.setTextColor(53, 88, 223);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("Trainup", margin + 24, cursorY + 34);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(100, 116, 139);
  pdf.text("Billing workspace subscription", margin + 24, cursorY + 54);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.setTextColor(17, 24, 39);
  pdf.text("INVOICE", rightColX, cursorY + 34, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(100, 116, 139);
  pdf.text(invoice.invoiceId, rightColX, cursorY + 54, { align: "right" });
  pdf.text(`Status: ${invoice.status}`, rightColX, cursorY + 70, { align: "right" });

  cursorY += 118;
  pdf.setTextColor(55, 65, 81);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text("Billed To", margin, cursorY);
  pdf.text("Invoice Details", pageWidth / 2 + 20, cursorY);

  cursorY += 18;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(17, 24, 39);
  pdf.text(invoice.clientName, margin, cursorY);
  pdf.setFontSize(10);
  pdf.setTextColor(100, 116, 139);
  pdf.text("Billing workspace subscription", margin, cursorY + 16);

  const detailRows = [
    ["Plan", invoice.planName],
    ["Purchase Date", invoice.purchaseDate],
    ["Expiry Date", invoice.expiryDate],
    ["Credits", invoice.credits],
  ];

  let detailY = cursorY;
  detailRows.forEach(([label, value]) => {
    pdf.setTextColor(100, 116, 139);
    pdf.text(label, pageWidth / 2 + 20, detailY);
    pdf.setTextColor(31, 41, 55);
    pdf.text(value, rightColX, detailY, { align: "right" });
    detailY += 20;
  });

  cursorY = Math.max(cursorY + 58, detailY + 20);
  pdf.setDrawColor(226, 232, 240);
  pdf.line(margin, cursorY, pageWidth - margin, cursorY);
  cursorY += 24;

  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(margin, cursorY, contentWidth, 112, 14, 14, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(100, 116, 139);
  pdf.text("Description", margin + 20, cursorY + 22);
  pdf.text("Credits", pageWidth - 170, cursorY + 22, { align: "right" });
  pdf.text("Amount", rightColX - 16, cursorY + 22, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(17, 24, 39);
  const wrappedDescription = pdf.splitTextToSize(invoice.description, contentWidth - 220);
  pdf.text(wrappedDescription, margin + 20, cursorY + 46);
  pdf.setFontSize(10);
  pdf.setTextColor(100, 116, 139);
  pdf.text(invoice.supportingText, margin + 20, cursorY + 64 + Math.max(0, wrappedDescription.length - 1) * 14);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(17, 24, 39);
  pdf.text(invoice.credits, pageWidth - 170, cursorY + 46, { align: "right" });
  pdf.text(invoice.amount, rightColX - 16, cursorY + 46, { align: "right" });

  const summaryY = cursorY + 132;
  pdf.setDrawColor(226, 232, 240);
  pdf.line(pageWidth - 220, summaryY, pageWidth - margin, summaryY);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(100, 116, 139);
  pdf.text("Sub Total", pageWidth - 220, summaryY + 22);
  pdf.text(invoice.amount, rightColX, summaryY + 22, { align: "right" });
  pdf.text("Tax", pageWidth - 220, summaryY + 44);
  pdf.text(formatCurrency(0, invoice.currency), rightColX, summaryY + 44, { align: "right" });
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(31, 41, 55);
  pdf.text("Total", pageWidth - 220, summaryY + 72);
  pdf.text(invoice.amount, rightColX, summaryY + 72, { align: "right" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  pdf.text("This is a system-generated invoice for your billing record.", margin, pageHeight - 56);
  pdf.text("trainup.ai", rightColX, pageHeight - 56, { align: "right" });

  const blob = pdf.output("blob");
  return URL.createObjectURL(blob);
};

const UpgradeBillings = () => {
  const navigate = useNavigate();
  const { checkoutPlan = "" } = useParams();
  const dispatch = useAppDispatch();
  const admin = useAppSelector((state) => state.admin);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [creditHistory, setCreditHistory] = useState<CreditAuditRow[]>([]);
  const [dbPlans, setDbPlans] = useState<BillingPlanRow[]>([]);
  const [txnFilterFrom, setTxnFilterFrom] = useState("");
  const [txnFilterTo, setTxnFilterTo] = useState("");
  const [txnFilterType, setTxnFilterType] = useState("");
  const [txnFilterPlan, setTxnFilterPlan] = useState("");
  const [creditFilterFrom, setCreditFilterFrom] = useState("");
  const [creditFilterTo, setCreditFilterTo] = useState("");
  const [creditFilterAction, setCreditFilterAction] = useState("");
  const [creditFilterBy, setCreditFilterBy] = useState("");
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const [approxUsers, setApproxUsers] = useState("");
  const [approxTrainings, setApproxTrainings] = useState("");
  const [approxSessions, setApproxSessions] = useState("");
  const [approxBudget, setApproxBudget] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<BillingSummary["recentTransactions"][number] | null>(null);
  const [invoicePdfUrl, setInvoicePdfUrl] = useState<string>("");
  const [purchasing, setPurchasing] = useState(false);
  const [submittingSupport, setSubmittingSupport] = useState(false);
  const [payingOfferId, setPayingOfferId] = useState<string | null>(null);
  const canViewBilling = admin.permission.includes(PermissionKeys.billingView);
  const canManageBilling = admin.permission.includes(PermissionKeys.billingManage);

  const fetchBillingSummary = useCallback(async () => {
    const response = await AxiosHelper.getData<BillingSummary>("/billing/summary");

    if (response.data.status) {
      setBillingSummary(response.data.data);
    } else {
      toast.error(response.data.message);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const response = await AxiosHelper.getData<AdminUser>("/profile");

    if (response.data.status) {
      dispatch(updateAdmin(response.data.data));
    }
  }, [dispatch]);

  const fetchCreditHistory = useCallback(async (filters?: { dateFrom?: string; dateTo?: string; actionType?: string; performedBy?: string }) => {
    const params: Record<string, unknown> = { pageNo: 1, limit: 50 };
    if (filters?.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters?.dateTo) params.dateTo = filters.dateTo;
    if (filters?.actionType) params.actionType = filters.actionType;
    if (filters?.performedBy) params.performedBy = filters.performedBy;
    const response = await AxiosHelper.getData<{ record: CreditAuditRow[] }>("/billing/credit-history", params);
    if (response.data.status) {
      setCreditHistory(response.data.data.record || []);
    }
  }, []);

  const fetchPlans = useCallback(async () => {
    const response = await AxiosHelper.getData<{ record: BillingPlanRow[] }>("/billing/plans");
    if (response.data.status) {
      setDbPlans(response.data.data.record || []);
    }
  }, []);

  useEffect(() => {
    if (canViewBilling) {
      void fetchBillingSummary();
      void fetchCreditHistory();
      void fetchPlans();
    }
  }, [canViewBilling, fetchBillingSummary, fetchCreditHistory, fetchPlans]);

  useEffect(() => {
    if (!selectedInvoice) {
      setInvoicePdfUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return "";
      });
      return;
    }

    const nextUrl = createInvoicePdfUrl({
      transaction: selectedInvoice,
      clientName: admin.clientName || "Client Workspace",
      currency: billingSummary?.billingCurrency || "INR",
    });

    setInvoicePdfUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return nextUrl;
    });

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [admin.clientName, billingSummary?.billingCurrency, selectedInvoice]);

  const handlePlanCheckout = async () => {
    if (!selectedPlanCode) {
      return;
    }

    setPurchasing(true);
    const response = await AxiosHelper.postData<BillingSummary, { planCode: "FREE" | "PRO"; gateway: string }>(
      "/billing/purchase",
      {
        planCode: selectedPlanCode,
        gateway: "razorpay_test",
      },
    );

    if (response.data.status) {
      setBillingSummary(response.data.data);
      toast.success(response.data.message);
      await refreshProfile();
    } else {
      toast.error(response.data.message);
    }

    setPurchasing(false);
  };

  const handleSupportRequest = async () => {
    const message = supportMessage.trim();
    const users = approxUsers.trim();
    const trainings = approxTrainings.trim();
    const sessions = approxSessions.trim();
    const budget = approxBudget.trim();

    if (!message && !users && !trainings && !sessions && !budget) {
      toast.error("Share at least one approximate requirement or a message.");
      return;
    }

    setSubmittingSupport(true);
    const response = await AxiosHelper.postData<
      BillingSummary,
      { message: string; approxUsers?: number; approxTrainings?: number; approxSessions?: number; approxBudget?: number }
    >("/billing/enterprise-request", {
      message,
      ...(users ? { approxUsers: Number(users) } : {}),
      ...(trainings ? { approxTrainings: Number(trainings) } : {}),
      ...(sessions ? { approxSessions: Number(sessions) } : {}),
      ...(budget ? { approxBudget: Number(budget) } : {}),
    });

    if (response.data.status) {
      setBillingSummary(response.data.data);
      setSupportMessage("");
      setApproxUsers("");
      setApproxTrainings("");
      setApproxSessions("");
      setApproxBudget("");
      setSupportOpen(false);
      toast.success(response.data.message);
    } else {
      toast.error(response.data.message);
    }

    setSubmittingSupport(false);
  };

  // Finalizes a super-admin-sent custom Enterprise offer (see Queries tab in
  // the super-admin console). Sandbox/simulated, same as handlePlanCheckout —
  // there's no real payment gateway wired into this app yet.
  const handlePayEnterpriseOffer = async (requestId: string) => {
    setPayingOfferId(requestId);
    const response = await AxiosHelper.postData<BillingSummary, Record<string, never>>(
      `/billing/enterprise-request/${requestId}/pay`,
      {},
    );
    setPayingOfferId(null);

    if (response.data.status) {
      setBillingSummary(response.data.data);
      toast.success(response.data.message);
    } else {
      toast.error(response.data.message);
    }
  };

  const derived = useMemo(() => {
    if (!billingSummary) {
      return null;
    }

    const totalCredits = Math.max(Number(billingSummary.totalCredits ?? 0), 1);
    const usedPercent = Math.min(100, Math.round((Number(billingSummary.usedCredits ?? 0) / totalCredits) * 100));
    const startDate = billingSummary.startedOn ? new Date(billingSummary.startedOn) : new Date();
    const endDate = billingSummary.expiresOn ? new Date(billingSummary.expiresOn) : new Date(startDate);

    return {
      usedPercent,
      startDate: Number.isNaN(startDate.getTime()) ? new Date() : startDate,
      endDate: Number.isNaN(endDate.getTime()) ? new Date() : endDate,
    };
  }, [billingSummary]);

  const selectedPlanCode = useMemo<"FREE" | "PRO" | null>(() => {
    const normalized = String(checkoutPlan || "").trim().toUpperCase();
    return normalized === "FREE" || normalized === "PRO" ? normalized : null;
  }, [checkoutPlan]);

  const selectedPlan = useMemo(() => {
    if (!billingSummary || !selectedPlanCode) {
      return null;
    }

    // Try finding the DB plan first to respect dynamic discounts and pricing
    const dbPlan = dbPlans.find((plan) => plan.code === selectedPlanCode);
    if (dbPlan) {
      const discount = dbPlan.discountPercentage || 0;
      const discountedPrice = discount > 0 ? dbPlan.monthlyPrice * (1 - discount / 100) : dbPlan.monthlyPrice;
      return {
        ...dbPlan,
        monthlyPrice: discountedPrice,
        firstMonthPrice: discountedPrice,
        trialDays: 0, // DB plans don't specify trials currently
      };
    }

    return billingSummary.planCatalog.find((plan) => plan.code === selectedPlanCode) ?? null;
  }, [billingSummary, selectedPlanCode, dbPlans]);

  const selectedInvoiceModel = useMemo(
    () =>
      selectedInvoice
        ? buildInvoiceModel({
            transaction: selectedInvoice,
            clientName: admin.clientName || "Client Workspace",
            currency: billingSummary?.billingCurrency || "INR",
          })
        : null,
    [admin.clientName, billingSummary?.billingCurrency, selectedInvoice],
  );

  const orderSummary = useMemo(() => {
    if (!billingSummary || !selectedPlan) {
      return null;
    }

    const firstMonthPrice = Number(selectedPlan.firstMonthPrice ?? selectedPlan.monthlyPrice ?? 0);
    const renewalPrice = Number(selectedPlan.monthlyPrice ?? 0);
    const isFreePlan = selectedPlan.code === "FREE";
    const activeTrial = isFreePlan && Boolean(billingSummary.freeTrialActive);
    const total = activeTrial ? firstMonthPrice : renewalPrice;

    return {
      itemName: `${planLabels[selectedPlan.code] ?? selectedPlan.code} Plan`,
      total,
      tax: 0,
      subtitle: activeTrial
        ? `First ${selectedPlan.trialDays ?? 30} days are free. Renewal after trial: ${formatCurrency(renewalPrice, billingSummary.billingCurrency)}.`
        : selectedPlan.code === "FREE"
          ? `Renewal amount for the Free plan after the trial window.`
          : `Monthly subscription for the ${planLabels[selectedPlan.code] ?? selectedPlan.code} plan.`,
    };
  }, [billingSummary, selectedPlan]);

  // Every recorded transaction (purchases, assignments, add-ons, debits) — no
  // longer filtered down to just FREE/PRO plan events, so admins can actually
  // see the billing activity that happened on their account.
  const recentTransactions = billingSummary?.recentTransactions ?? [];

  if (!canViewBilling) {
    return (
      <div className="card">
        <div className="card-body p-4">
          <h1 className="h4 fw-semibold mb-2">Upgrade & Billings</h1>
          <p className="text-body-secondary mb-0">This section is not enabled for your role.</p>
        </div>
      </div>
    );
  }

  if (!billingSummary || !derived) {
    return (
      <div className="card app-loading-card">
        <div className="card-body p-4">
          <span className="ds-skeleton app-loading-line is-wide" />
          <span className="ds-skeleton app-loading-line is-mid" />
          <div className="app-loading-grid">
            <span className="ds-skeleton app-loading-block" />
            <span className="ds-skeleton app-loading-block" />
            <span className="ds-skeleton app-loading-block" />
          </div>
          <div className="app-loading-table-lines">
            <span className="ds-skeleton app-loading-line" />
            <span className="ds-skeleton app-loading-line" />
          </div>
        </div>
      </div>
    );
  }

  const isExpired = billingSummary.planStatus === "expired";
  const activePlanCode = String(billingSummary.currentPlan || "").toUpperCase();
  const activePlan = planLabels[activePlanCode] ?? billingSummary.currentPlan;

  const filteredTransactions = recentTransactions.filter((item) => {
    if (txnFilterFrom && (!item.createdAt || new Date(item.createdAt) < new Date(txnFilterFrom))) {
      return false;
    }

    if (txnFilterTo) {
      const to = new Date(txnFilterTo);
      to.setHours(23, 59, 59, 999);
      if (!item.createdAt || new Date(item.createdAt) > to) {
        return false;
      }
    }

    if (txnFilterType && item.type !== txnFilterType) {
      return false;
    }

    if (txnFilterPlan) {
      const isPlanEvent = item.type === "plan_purchase" || item.type === "plan_assignment";
      const transactionPlan = String(item.planCode || (isPlanEvent ? activePlanCode : "")).toUpperCase();
      if (transactionPlan !== txnFilterPlan) {
        return false;
      }
    }

    return true;
  });

  // D2: plan cards are DB-driven (GET /billing/plans). Fall back to the legacy
  // billingSummary.planCatalog when the DB list is empty.
  const dbPlanCards = dbPlans.map((plan) => {
    const discount = plan.discountPercentage || 0;
    const discountedPrice = discount > 0 ? plan.monthlyPrice * (1 - discount / 100) : plan.monthlyPrice;

    return {
      code: plan.code,
      monthlyPrice: discountedPrice,
      firstMonthPrice: discountedPrice,
      originalPrice: plan.monthlyPrice,
      discountPercentage: discount,
      title: plan.name || planLabels[plan.code] || plan.code,
      headlinePrice:
        plan.code === "ENTERPRISE" && !plan.monthlyPrice
          ? "Custom"
          : formatCurrency(discountedPrice, billingSummary.billingCurrency),
      recurringPrice:
        plan.code === "ENTERPRISE" && !plan.monthlyPrice
          ? "Custom after discussion"
          : formatCurrency(discountedPrice, billingSummary.billingCurrency),
    unitLabel: plan.code === "ENTERPRISE" ? "" : "/month",
    seatLabel: "Pure Credit Based",
    features: plan.features?.length
      ? plan.features
      : plan.code === "ENTERPRISE"
        ? [
            "Custom pricing and credit allocation",
            "Dedicated onboarding support",
            "Priority enterprise support",
            "Assigned manually by super admin after discussion"
          ]
        : [
            `Pay-as-you-go with credits`,
            `No artificial resource limits`,
            `${Number(plan.credits).toLocaleString()} credits / month`,
          ],
    };
  });

  const fallbackPlanCards = billingSummary.planCatalog.map((plan: BillingPlanCatalogItem) => ({
    ...plan,
    discountPercentage: 0,
    title: planLabels[plan.code] ?? plan.code,
    headlinePrice:
      plan.code === "ENTERPRISE" && !plan.monthlyPrice
        ? "Custom"
        : formatCurrency(plan.code === "FREE" ? plan.firstMonthPrice : plan.monthlyPrice, billingSummary.billingCurrency),
    recurringPrice:
      plan.code === "ENTERPRISE" && !plan.monthlyPrice
        ? "Custom after discussion"
        : formatCurrency(plan.monthlyPrice, billingSummary.billingCurrency),
    unitLabel: plan.code === "ENTERPRISE" ? "" : "/month",
    seatLabel:
      plan.code === "FREE"
        ? "3 Users"
        : plan.code === "PRO"
          ? "50 Users"
          : "Custom enterprise allocation",
    features:
      plan.code === "FREE"
        ? [
            "1 training included",
            "Up to 3 active users",
            "5 completed sessions",
            "First month free, then Rs. 1,999 / month",
          ]
        : plan.code === "PRO"
          ? [
              "10 trainings included",
              "Up to 50 active users",
              "250 completed sessions",
            ]
          : [
              "Custom pricing and credit allocation",
              "Dedicated onboarding support",
              "Priority enterprise support",
              "Assigned manually by super admin after discussion",
            ],
  }));

  const planCards = dbPlanCards.length ? dbPlanCards : fallbackPlanCards;

  return (
    <>
      <div className="admin-billing-page">
        {!selectedPlanCode ? (
          <div className="admin-billing-page-head">
            {/* <button
              className={`btn ${isExpired ? "btn-primary" : "btn-success"} admin-billing-upgrade-btn`}
              onClick={() => navigate(`/upgrade-billings/${activePlanCode === "PRO" ? "PRO" : "FREE"}`)}
              disabled={!canManageBilling || activePlanCode === "ENTERPRISE"}
            >
              <i className="ri-arrow-up-line me-1" />
              {activePlanCode === "ENTERPRISE" ? "Enterprise Managed" : "Open Order Summary"}
            </button> */}
          </div>
        ) : null}

        {/* The single "current plan" hero was removed — with multiple plans
            able to be active at once (stacked), there's no one plan to name
            here. See the "Current Subscription" table below for the per-plan
            breakdown instead. */}
        <div className="admin-billing-hero card">
          <div className="card-body">
            <div className="admin-billing-hero-head">
              <div>
                <p className="admin-billing-hero-kicker mb-2">{admin.clientName || "Client Workspace"}</p>
                <div className="d-flex gap-2 mt-2 flex-wrap">
                  {billingSummary.freeTrialActive ? <span className="badge text-bg-info">Free trial active</span> : null}
                  {billingSummary.pendingEnterpriseRequests ? (
                    <span className="badge text-bg-primary">
                      {billingSummary.pendingEnterpriseRequests} enterprise request pending
                    </span>
                  ) : null}
                </div>
              </div>
              {isExpired ? (
                <div className="admin-billing-hero-price">
                  <small className="badge text-bg-danger">Expired</small>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {orderSummary ? (
          <div className="card mb-3">
            <div className="card-body">
              <div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-4">
                <div>
                  <h2 className="h4 fw-semibold mb-1">Order Summary</h2>
                  <p className="text-body-secondary mb-0">{orderSummary.subtitle}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => navigate("/upgrade-billings")}
                >
                  Back
                </button>
              </div>

              <div className="table-responsive mb-4">
                <table className="table align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-end">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="fw-semibold">{orderSummary.itemName}</td>
                      <td className="text-end fw-semibold">{formatCurrency(orderSummary.total, billingSummary.billingCurrency)}</td>
                    </tr>
                    <tr>
                      <td className="fw-semibold">Sub Total :</td>
                      <td className="text-end">{formatCurrency(orderSummary.total, billingSummary.billingCurrency)}</td>
                    </tr>
                    <tr>
                      <td className="fw-semibold">Tax :</td>
                      <td className="text-end">{formatCurrency(orderSummary.tax, billingSummary.billingCurrency)}</td>
                    </tr>
                    <tr>
                      <td className="fw-semibold">Total :</td>
                      <td className="text-end fw-semibold">{formatCurrency(orderSummary.total, billingSummary.billingCurrency)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handlePlanCheckout()}
                disabled={purchasing || !canManageBilling}
              >
                {purchasing ? "Processing..." : "Pay Now"}
              </button>
            </div>
          </div>
        ) : null}

        {selectedPlanCode ? null : (
          <>

            {(billingSummary.enterpriseRequests || [])
              .filter((request) => request.status === "offer_sent")
              .map((request) => (
                <div key={request.id} className="alert alert-success d-flex align-items-center justify-content-between flex-wrap gap-3 mb-3">
                  <div>
                    <div className="fw-semibold">Your custom Enterprise plan is ready</div>
                    <div className="small">
                      {Number(request.offerCredits || 0).toLocaleString()} credits
                      {request.offerPrice ? ` for ${formatCurrency(request.offerPrice, billingSummary.billingCurrency)}` : ""}
                      {request.offerValidityDays ? ` · valid ${request.offerValidityDays} days` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-success"
                    disabled={payingOfferId === request.id || !canManageBilling}
                    onClick={() => void handlePayEnterpriseOffer(request.id)}
                  >
                    {payingOfferId === request.id ? "Processing..." : "Pay Now"}
                  </button>
                </div>
              ))}

            {/* Phase E / Task 1: Current Subscription — hidden once the plan
                has expired (the expired plan header + renew CTA stay above). */}
            {!isExpired ? (
            <div className="card mb-3">
              <div className="card-body">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-3 mb-3">
                  <h2 className="h4 fw-semibold mb-0">Current Subscription</h2>
                  <div className="d-flex gap-4">
                    <div className="text-end">
                      <div className="small text-body-secondary">Total Credits</div>
                      <div className="fw-semibold">{billingSummary.totalCredits.toLocaleString()}</div>
                    </div>
                    <div className="text-end">
                      <div className="small text-body-secondary">Available</div>
                      <div className="fw-semibold">{billingSummary.availableCredits.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
                {/* Every purchased/assigned plan stacks independently — each row
                    keeps its own credits and its own expiry date rather than the
                    newest purchase overwriting the rest. */}
                <div className="table-responsive mb-3">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Plan</th>
                        <th>Total Credits</th>
                        <th>Used</th>
                        <th>Available</th>
                        <th>Purchased On</th>
                        <th>Expires On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(billingSummary.activePlans && billingSummary.activePlans.length
                        ? billingSummary.activePlans
                        : [{
                            batchId: "current",
                            planCode: billingSummary.currentPlan,
                            label: activePlan,
                            monthlyCredits: billingSummary.monthlyCredits,
                            usedCredits: billingSummary.usedCredits,
                            purchasedAt: billingSummary.startedOn ?? "",
                            expiresAt: billingSummary.expiresOn ?? "",
                          }]
                      ).map((p) => (
                        <tr key={p.batchId}>
                          <td className="fw-semibold">{planLabels[p.planCode] ?? p.label}</td>
                          <td>{p.monthlyCredits.toLocaleString()}</td>
                          <td>{(p.usedCredits || 0).toLocaleString()}</td>
                          <td>{Math.max(0, p.monthlyCredits - (p.usedCredits || 0)).toLocaleString()}</td>
                          <td>{formatDateLabel(p.purchasedAt)}</td>
                          <td>{formatDateLabel(p.expiresAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row g-3">
                  <div className="col-12 col-md-4">
                    <div className="border rounded p-3 h-100 text-center">
                      <div className="small text-body-secondary mb-1">Per Training Created</div>
                      <div className="fs-5 fw-semibold">{billingSummary.costPerTraining} credits</div>
                    </div>
                  </div>
                  <div className="col-12 col-md-4">
                    <div className="border rounded p-3 h-100 text-center">
                      <div className="small text-body-secondary mb-1">Per Session Created</div>
                      <div className="fs-5 fw-semibold">{billingSummary.costPerSession} credits</div>
                    </div>
                  </div>
                  <div className="col-12 col-md-4">
                    <div className="border rounded p-3 h-100 text-center">
                      <div className="small text-body-secondary mb-1">Per User Added</div>
                      <div className="fs-5 fw-semibold">{billingSummary.costPerUser} credits</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            ) : null}


            <div className="admin-billing-plan-section">
              <div className="mb-3">
                <h2 className="h3 fw-semibold mb-1">Upgrade Plans</h2>
                <p className="text-body-secondary mb-0">
                  You are currently on the {activePlan} plan. Upgrade when you need higher training, user, or session capacity.
                </p>
              </div>

              <div className="admin-billing-plan-grid">
                {planCards.map((plan) => {
                  const isCurrent = plan.code === activePlanCode;

                  return (
                    <div key={plan.code} className={`card admin-billing-plan-card ${isCurrent ? "is-current" : ""}`}>
                      <div className="card-body">
                        <div className="admin-billing-plan-card-head">
                          <h3>{plan.title}</h3>
                        </div>

                        <div className="admin-billing-plan-price">
                          <strong>{plan.headlinePrice}</strong>
                          {plan.unitLabel ? <span>{plan.unitLabel}</span> : null}
                        </div>
                        {plan.discountPercentage ? (
                          <div className="small text-success mb-2">
                            {plan.discountPercentage}% off
                          </div>
                        ) : null}

                        <div className="admin-billing-plan-seat">{plan.seatLabel}</div>
                        {plan.code !== "ENTERPRISE" ? (
                          <div className="small text-body-secondary mb-3">Recurring: {plan.recurringPrice}</div>
                        ) : null}

                        <div className="admin-billing-feature-list">
                          {plan.features.map((feature) => (
                            <div key={feature} className="admin-billing-feature-item">
                              <i className="ri-checkbox-circle-fill" />
                              <span>{feature}</span>
                            </div>
                          ))}
                        </div>

                        <button
                          type="button"
                          className="btn btn-primary w-100 mt-auto admin-billing-plan-action"
                          onClick={() => {
                            if (plan.code === "ENTERPRISE") {
                              setSupportOpen(true);
                              return;
                            }

                            navigate(`/upgrade-billings/${plan.code}`);
                          }}
                          disabled={plan.code !== "ENTERPRISE" && !canManageBilling}
                        >
                          {plan.code === "ENTERPRISE"
                            ? "Contact Support"
                            : "Upgrade Plan"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card admin-billing-transactions-card">
              <div className="card-body">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                  <div>
                    <h2 className="h4 fw-semibold mb-1">Transactions</h2>
                    <p className="text-body-secondary mb-0">Every plan assignment, purchase, and credit deduction on this account.</p>
                  </div>
                </div>

                <div className="row g-2 mb-3">
                  <div className="col-auto">
                    <input type="date" className="form-control form-control-sm" value={txnFilterFrom} onChange={(e) => setTxnFilterFrom(e.target.value)} placeholder="From" />
                  </div>
                  <div className="col-auto">
                    <input type="date" className="form-control form-control-sm" value={txnFilterTo} onChange={(e) => setTxnFilterTo(e.target.value)} placeholder="To" />
                  </div>
                  <div className="col-auto">
                    <select className="form-select form-select-sm" value={txnFilterType} onChange={(e) => setTxnFilterType(e.target.value)}>
                      <option value="">All Types</option>
                      <option value="plan_purchase">Plan Purchase</option>
                      <option value="plan_assignment">Plan Assignment</option>
                      <option value="credit_purchase">Credit Purchase</option>
                      <option value="debit">Debit</option>
                    </select>
                  </div>
                  <div className="col-auto">
                    <select className="form-select form-select-sm" value={txnFilterPlan} onChange={(e) => setTxnFilterPlan(e.target.value)}>
                      <option value="">All Plans</option>
                      <option value="FREE">Free</option>
                      <option value="PRO">Pro</option>
                      <option value="ENTERPRISE">Enterprise</option>
                    </select>
                  </div>
                  <div className="col-auto">
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => {
                        setTxnFilterFrom("");
                        setTxnFilterTo("");
                        setTxnFilterType("");
                        setTxnFilterPlan("");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="table-responsive">
                  <table className="table align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Purchase ID</th>
                        <th>Transaction</th>
                        <th>Purchase Date</th>
                        <th>Expire Date</th>
                        <th>Plan</th>
                        <th>Credits</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.length ? (
                        filteredTransactions.map((item, index) => {
                          const status = getTransactionStatus(item.type);
                          const isPlanEvent = item.type === "plan_purchase" || item.type === "plan_assignment";
                          const transactionPlan = item.planCode || (isPlanEvent ? activePlanCode : "");
                          return (
                            <tr key={item.createdAt || `${item.note}-${index}`}>
                              <td className="fw-semibold text-primary">{item.invoiceId || item.orderId || `TXN${String(index + 1).padStart(6, "0")}`}</td>
                              <td>
                                <div className="fw-semibold">{item.note || item.reason || "Credit activity"}</div>
                                <div className="small text-body-secondary">{item.reason || item.note || "Billing ledger entry"}</div>
                              </td>
                              <td>{formatDateLabel(item.createdAt)}</td>
                              <td>{transactionPlan ? getExpiryDateLabel(item.createdAt, String(transactionPlan)) : "—"}</td>
                              <td>{transactionPlan ? (planLabels[String(transactionPlan).toUpperCase()] ?? transactionPlan) : "—"}</td>
                              <td>{Number(item.credits ?? 0).toLocaleString()}</td>
                              <td>
                                <span className={`badge ${status.className}`}>{status.label}</span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary"
                                  onClick={() => setSelectedInvoice(item)}
                                >
                                  Open Invoice
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={8} className="text-center text-body-secondary py-4">
                            No billing transactions match these filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Task 3 + Phase E / Task 6: credit audit trail with filters + export. */}
            <div className="card admin-billing-transactions-card">
              <div className="card-body">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                  <div>
                    <h2 className="h4 fw-semibold mb-1">Credit History</h2>
                    <p className="text-body-secondary mb-0">Every credit change with reason, balance and who performed it.</p>
                  </div>
                  <div className="d-flex gap-1">
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => {
                      const header = "Date,Change,Balance After,Action,Reason,Reference,By\n";
                      const rows = creditHistory.map((r) => `${r.timestamp},${r.creditChange},${r.balanceAfter},${r.actionType},"${(r.reason || "").replace(/"/g, '""')}",${r.reference || ""},${r.performedBy || "System"}`).join("\n");
                      const blob = new Blob([header + rows], { type: "text/csv" });
                      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "credit-history.csv"; a.click();
                    }}>CSV</button>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => {
                      const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
                      pdf.setFontSize(14); pdf.text("Credit History", 40, 40);
                      let y = 70;
                      pdf.setFontSize(8);
                      pdf.text("Date", 40, y); pdf.text("Change", 150, y); pdf.text("Balance", 220, y); pdf.text("Action", 290, y); pdf.text("Reason", 380, y); pdf.text("By", 620, y);
                      y += 16;
                      for (const r of creditHistory) {
                        if (y > 560) { pdf.addPage(); y = 40; }
                        pdf.text(formatDateLabel(r.timestamp), 40, y);
                        pdf.text(String(r.creditChange), 150, y);
                        pdf.text(String(r.balanceAfter ?? 0), 220, y);
                        pdf.text(r.actionType || "", 290, y);
                        pdf.text((r.reason || "").slice(0, 50), 380, y);
                        pdf.text(r.performedBy || "System", 620, y);
                        y += 14;
                      }
                      pdf.save("credit-history.pdf");
                    }}>PDF</button>
                  </div>
                </div>
                <div className="row g-2 mb-3">
                  <div className="col-auto"><input type="date" className="form-control form-control-sm" value={creditFilterFrom} onChange={(e) => setCreditFilterFrom(e.target.value)} placeholder="From" /></div>
                  <div className="col-auto"><input type="date" className="form-control form-control-sm" value={creditFilterTo} onChange={(e) => setCreditFilterTo(e.target.value)} placeholder="To" /></div>
                  <div className="col-auto">
                    <select className="form-select form-select-sm" value={creditFilterAction} onChange={(e) => setCreditFilterAction(e.target.value)}>
                      <option value="">All Actions</option>
                      <option value="debit">Debit</option>
                      <option value="credit_purchase">Credit Purchase</option>
                      <option value="addon_purchase">Add-On Purchase</option>
                    </select>
                  </div>
                  <div className="col-auto"><input className="form-control form-control-sm" placeholder="Performed by..." value={creditFilterBy} onChange={(e) => setCreditFilterBy(e.target.value)} /></div>
                  <div className="col-auto">
                    <button className="btn btn-sm btn-primary" onClick={() => void fetchCreditHistory({ dateFrom: creditFilterFrom, dateTo: creditFilterTo, actionType: creditFilterAction, performedBy: creditFilterBy })}>Filter</button>
                    <button className="btn btn-sm btn-outline-secondary ms-1" onClick={() => { setCreditFilterFrom(""); setCreditFilterTo(""); setCreditFilterAction(""); setCreditFilterBy(""); void fetchCreditHistory(); }}>Clear</button>
                  </div>
                </div>
                <div className="table-responsive">
                  <table className="table align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Credit Change</th>
                        <th>Balance After</th>
                        <th>Reason</th>
                        <th>Reference</th>
                        <th>Performed By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditHistory.length ? (
                        creditHistory.map((row) => (
                          <tr key={row.id}>
                            <td>{formatDateLabel(row.timestamp)}</td>
                            <td className={row.creditChange < 0 ? "text-danger fw-semibold" : "text-success fw-semibold"}>
                              {row.creditChange > 0 ? `+${row.creditChange.toLocaleString()}` : row.creditChange.toLocaleString()}
                            </td>
                            <td>{Number(row.balanceAfter ?? 0).toLocaleString()}</td>
                            <td>{row.reason || row.actionType || "—"}</td>
                            <td>{row.reference || row.entityId || "—"}</td>
                            <td>{row.performedBy || "System"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="text-center text-body-secondary py-4">
                            No credit history yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </>
        )}
      </div>

      <Modal show={supportOpen} onClose={() => setSupportOpen(false)} title="Support Query" size="lg" centered>
        <div className="admin-billing-stack">
          <div>
            <h3 className="h6 fw-semibold mb-1">Enterprise plan request</h3>
            <p className="text-body-secondary mb-0">
              Everything below is optional and approximate — fill in what you know, or skip straight to the message. Our team will follow up with custom pricing.
            </p>
          </div>

          <div className="row g-3">
            <div className="col-6 col-md-3">
              <label htmlFor="enterprise-approx-users" className="form-label small">Approx. users</label>
              <input
                id="enterprise-approx-users"
                type="number"
                min={0}
                className="form-control"
                value={approxUsers}
                onChange={(event) => setApproxUsers(event.target.value)}
                placeholder="e.g. 400"
              />
            </div>
            <div className="col-6 col-md-3">
              <label htmlFor="enterprise-approx-trainings" className="form-label small">Approx. trainings / month</label>
              <input
                id="enterprise-approx-trainings"
                type="number"
                min={0}
                className="form-control"
                value={approxTrainings}
                onChange={(event) => setApproxTrainings(event.target.value)}
                placeholder="e.g. 40"
              />
            </div>
            <div className="col-6 col-md-3">
              <label htmlFor="enterprise-approx-sessions" className="form-label small">Approx. sessions / month</label>
              <input
                id="enterprise-approx-sessions"
                type="number"
                min={0}
                className="form-control"
                value={approxSessions}
                onChange={(event) => setApproxSessions(event.target.value)}
                placeholder="e.g. 200"
              />
            </div>
            <div className="col-6 col-md-3">
              <label htmlFor="enterprise-approx-budget" className="form-label small">Approx. monthly budget</label>
              <input
                id="enterprise-approx-budget"
                type="number"
                min={0}
                className="form-control"
                value={approxBudget}
                onChange={(event) => setApproxBudget(event.target.value)}
                placeholder="e.g. 50000"
              />
            </div>
          </div>

          <div>
            <label htmlFor="enterprise-support-message" className="form-label">
              Message <span className="text-body-secondary fw-normal">(or just tell us directly if you'd rather skip the fields above)</span>
            </label>
            <textarea
              id="enterprise-support-message"
              className="form-control"
              rows={4}
              value={supportMessage}
              onChange={(event) => setSupportMessage(event.target.value)}
              placeholder="Example: We need an enterprise plan for 400 users, 40 trainings, and custom monthly credit allocation."
            />
          </div>

          <div className="d-flex justify-content-end gap-2">
            <button type="button" className="btn btn-outline-secondary" onClick={() => setSupportOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSupportRequest()}
              disabled={submittingSupport}
            >
              {submittingSupport ? "Submitting..." : "Submit Query"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        show={Boolean(selectedInvoice)}
        onClose={() => {
          setSelectedInvoice(null);
          setInvoicePdfUrl("");
        }}
        title="Invoice"
        size="xl"
        centered
        dialogClassName="admin-billing-invoice-dialog"
        contentClassName="admin-billing-invoice-modal"
        bodyClassName="admin-billing-invoice-modal-body"
        headerActions={
          <a
            href={invoicePdfUrl || undefined}
            target="_blank"
            rel="noreferrer"
            download={`${selectedInvoice?.invoiceId || selectedInvoice?.orderId || "invoice"}.pdf`}
            className={`btn btn-primary btn-sm admin-billing-invoice-download ${invoicePdfUrl ? "" : "disabled"}`}
          >
            <i className="ri-download-line" />
            <span>Invoice</span>
          </a>
        }
      >
        {selectedInvoice && selectedInvoiceModel ? (
          <div className="admin-billing-invoice-viewer">
            <div className="admin-billing-invoice-sheet">
              <div className="admin-billing-invoice-sheet-head">
                <div>
                  <div className="admin-billing-invoice-brand">Trainup</div>
                  <div className="admin-billing-invoice-meta">Billing workspace subscription</div>
                </div>
                <div className="text-end">
                  <div className="admin-billing-invoice-title">INVOICE</div>
                  <div className="admin-billing-invoice-meta">{selectedInvoiceModel.invoiceId}</div>
                </div>
              </div>

              <div className="admin-billing-invoice-grid">
                <div>
                  <div className="admin-billing-invoice-label">Billed To</div>
                  <div className="admin-billing-invoice-value">{selectedInvoiceModel.clientName}</div>
                  <div className="admin-billing-invoice-meta">Subscription billing account</div>
                </div>
                <div className="admin-billing-invoice-detail-list">
                  <div className="admin-billing-invoice-detail-row">
                    <span>Plan</span>
                    <strong>{selectedInvoiceModel.planName}</strong>
                  </div>
                  <div className="admin-billing-invoice-detail-row">
                    <span>Purchase Date</span>
                    <strong>{selectedInvoiceModel.purchaseDate}</strong>
                  </div>
                  <div className="admin-billing-invoice-detail-row">
                    <span>Expire Date</span>
                    <strong>{selectedInvoiceModel.expiryDate}</strong>
                  </div>
                  <div className="admin-billing-invoice-detail-row">
                    <span>Status</span>
                    <strong>{selectedInvoiceModel.status}</strong>
                  </div>
                </div>
              </div>

              <div className="admin-billing-invoice-table">
                <div className="admin-billing-invoice-table-head">
                  <span>Description</span>
                  <span>Credits</span>
                  <span>Amount</span>
                </div>
                <div className="admin-billing-invoice-table-row">
                  <div>
                    <div className="fw-semibold">{selectedInvoiceModel.description}</div>
                    <div className="admin-billing-invoice-meta">{selectedInvoiceModel.supportingText}</div>
                  </div>
                  <strong>{selectedInvoiceModel.credits}</strong>
                  <strong>{selectedInvoiceModel.amount}</strong>
                </div>
              </div>

              <div className="admin-billing-invoice-total">
                <div className="admin-billing-invoice-total-row">
                  <span>Sub Total</span>
                  <strong>{selectedInvoiceModel.amount}</strong>
                </div>
                <div className="admin-billing-invoice-total-row">
                  <span>Tax</span>
                  <strong>{formatCurrency(0, selectedInvoiceModel.currency)}</strong>
                </div>
                <div className="admin-billing-invoice-total-row is-grand">
                  <span>Total</span>
                  <strong>{selectedInvoiceModel.amount}</strong>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
};

export default UpgradeBillings;
