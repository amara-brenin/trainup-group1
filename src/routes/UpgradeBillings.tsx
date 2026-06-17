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

// Phase D: add-on marketplace quantity options per resource.
const ADDON_OPTIONS: Record<"training" | "session" | "user", number[]> = {
  training: [5, 10, 25],
  session: [50, 100, 250],
  user: [100, 500, 1000],
};
const ADDON_LABEL: Record<"training" | "session" | "user", string> = {
  training: "Trainings", session: "Sessions", user: "Users",
};

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
  code: string; name: string; monthlyPrice: number; yearlyPrice: number; credits: number;
  trainingLimit: number | null; sessionLimit: number | null; userLimit: number | null; features: string[];
};

// Phase D: add-on usage + history.
type ResourceUsage = { limit: number | null; used: number; remaining: number | null; unlimited: boolean; purchased: number };
type AddonUsage = { training: ResourceUsage; session: ResourceUsage; user: ResourceUsage };
type AddonHistoryRow = {
  id: string; type: string; quantity: number; purchaseMethod: string;
  unitCost: number; totalCost: number; currency: string; status: string; performedBy: string; createdAt: string;
};
type AddonPricing = { creditUnit: Record<string, number>; moneyUnit: Record<string, number> };

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
  const [addonUsage, setAddonUsage] = useState<AddonUsage | null>(null);
  const [addonHistory, setAddonHistory] = useState<AddonHistoryRow[]>([]);
  const [addonPricing, setAddonPricing] = useState<AddonPricing | null>(null);
  const [razorpayConfigured, setRazorpayConfigured] = useState(false);
  const [addonBusy, setAddonBusy] = useState(false);
  const [creditFilterFrom, setCreditFilterFrom] = useState("");
  const [creditFilterTo, setCreditFilterTo] = useState("");
  const [creditFilterAction, setCreditFilterAction] = useState("");
  const [creditFilterBy, setCreditFilterBy] = useState("");
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<BillingSummary["recentTransactions"][number] | null>(null);
  const [invoicePdfUrl, setInvoicePdfUrl] = useState<string>("");
  const [purchasing, setPurchasing] = useState(false);
  const [submittingSupport, setSubmittingSupport] = useState(false);
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

  const fetchAddons = useCallback(async () => {
    const response = await AxiosHelper.getData<{ record: AddonHistoryRow[]; usage: AddonUsage; pricing: AddonPricing; razorpayConfigured: boolean }>("/billing/addons/history");
    if (response.data.status) {
      setAddonHistory(response.data.data.record || []);
      setAddonUsage(response.data.data.usage || null);
      setAddonPricing(response.data.data.pricing || null);
      setRazorpayConfigured(Boolean(response.data.data.razorpayConfigured));
    }
  }, []);

  useEffect(() => {
    if (canViewBilling) {
      void fetchBillingSummary();
      void fetchCreditHistory();
      void fetchPlans();
      void fetchAddons();
    }
  }, [canViewBilling, fetchBillingSummary, fetchCreditHistory, fetchPlans, fetchAddons]);

  const loadRazorpayScript = () => new Promise<boolean>((resolve) => {
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });

  const buyAddonWithCredits = async (type: "training" | "session" | "user", quantity: number) => {
    setAddonBusy(true);
    const idempotencyKey = crypto.randomUUID();
    const res = await AxiosHelper.postData<{ usage: AddonUsage }, { type: string; quantity: number; purchaseMethod: string; idempotencyKey: string }>(
      "/billing/addons/purchase", { type, quantity, purchaseMethod: "credits", idempotencyKey });
    setAddonBusy(false);
    if (res.data.status) {
      toast.success(`Added +${quantity} ${type} capacity.`);
      if (res.data.data.usage) setAddonUsage(res.data.data.usage);
      void fetchAddons();
      void fetchBillingSummary(); // credits changed
      void fetchCreditHistory();
    } else {
      toast.error(res.data.message);
    }
  };

  const buyAddonWithRazorpay = async (type: "training" | "session" | "user", quantity: number) => {
    setAddonBusy(true);
    const orderRes = await AxiosHelper.postData<{ razorpayConfigured?: boolean; order?: { id: string; amount: number; currency: string; keyId: string } }, Record<string, unknown>>(
      "/billing/addons/purchase", { type, quantity, purchaseMethod: "razorpay", action: "create-order" });
    if (!orderRes.data.status) { setAddonBusy(false); toast.error(orderRes.data.message); return; }
    if (orderRes.data.data.razorpayConfigured === false || !orderRes.data.data.order) {
      setAddonBusy(false); toast.info("Razorpay is not configured for this account."); return;
    }
    const order = orderRes.data.data.order;
    const loaded = await loadRazorpayScript();
    setAddonBusy(false);
    if (!loaded) { toast.error("Could not load Razorpay checkout."); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rzp = new (window as any).Razorpay({
      key: order.keyId, amount: order.amount, currency: order.currency, order_id: order.id,
      name: "Capacity add-on", description: `+${quantity} ${type}`,
      handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        const verify = await AxiosHelper.postData<{ usage: AddonUsage }, Record<string, unknown>>(
          "/billing/addons/purchase",
          { type, quantity, purchaseMethod: "razorpay", action: "verify", ...resp });
        if (verify.data.status) {
          toast.success(`Added +${quantity} ${type} capacity via Razorpay.`);
          if (verify.data.data.usage) setAddonUsage(verify.data.data.usage);
          void fetchAddons();
        } else {
          toast.error(verify.data.message);
        }
      },
    });
    rzp.open();
  };

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

    if (!message) {
      toast.error("Support query is required.");
      return;
    }

    setSubmittingSupport(true);
    const response = await AxiosHelper.postData<BillingSummary, { message: string }>(
      "/billing/enterprise-request",
      { message },
    );

    if (response.data.status) {
      setBillingSummary(response.data.data);
      setSupportMessage("");
      setSupportOpen(false);
      toast.success(response.data.message);
    } else {
      toast.error(response.data.message);
    }

    setSubmittingSupport(false);
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

    return billingSummary.planCatalog.find((plan) => plan.code === selectedPlanCode) ?? null;
  }, [billingSummary, selectedPlanCode]);

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

  const planTransactions = useMemo(
    () =>
      (billingSummary?.recentTransactions ?? [])
        .filter((item) => {
          const planCode = String(item.planCode || "").toUpperCase();
          return (item.type === "plan_purchase" || item.type === "plan_assignment") && (planCode === "FREE" || planCode === "PRO");
        })
        .slice(0, 2),
    [billingSummary?.recentTransactions],
  );

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
  const activePlanPrice =
    activePlanCode === "ENTERPRISE" && !billingSummary.enterpriseMonthlyPrice
      ? "Custom"
      : formatCurrency(billingSummary.planPrice, billingSummary.billingCurrency);

  // D2: plan cards are DB-driven (GET /billing/plans). Fall back to the legacy
  // billingSummary.planCatalog when the DB list is empty.
  const limitLabel = (n: number | null) => (n === null || n === undefined ? "Unlimited" : Number(n).toLocaleString());
  const dbPlanCards = dbPlans.map((plan) => ({
    code: plan.code,
    monthlyPrice: plan.monthlyPrice,
    firstMonthPrice: plan.monthlyPrice,
    title: plan.name || planLabels[plan.code] || plan.code,
    headlinePrice:
      plan.code === "ENTERPRISE" && !plan.monthlyPrice
        ? "Custom"
        : formatCurrency(plan.monthlyPrice, billingSummary.billingCurrency),
    recurringPrice:
      plan.code === "ENTERPRISE" && !plan.monthlyPrice
        ? "Custom after discussion"
        : formatCurrency(plan.monthlyPrice, billingSummary.billingCurrency),
    unitLabel: plan.code === "ENTERPRISE" ? "" : "/month",
    seatLabel: plan.userLimit === null ? "Custom enterprise allocation" : `${Number(plan.userLimit).toLocaleString()} Users`,
    features: plan.features?.length
      ? plan.features
      : [
          `${limitLabel(plan.trainingLimit)} trainings`,
          `Up to ${limitLabel(plan.userLimit)} active users`,
          `${limitLabel(plan.sessionLimit)} sessions`,
          `${Number(plan.credits).toLocaleString()} credits / month`,
        ],
  }));

  const fallbackPlanCards = billingSummary.planCatalog.map((plan: BillingPlanCatalogItem) => ({
    ...plan,
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

        <div className="admin-billing-hero card">
          <div className="card-body">
            <div className="admin-billing-hero-head">
              <div>
                <p className="admin-billing-hero-kicker mb-2">{admin.clientName || "Client Workspace"}</p>
                <h1 className="admin-billing-hero-title mb-2">{activePlan}</h1>
                <p className="text-body-secondary mb-0">Your current subscription plan</p>
                <div className="d-flex gap-2 mt-2 flex-wrap">
                  {/* <span className={`badge ${sandboxMode ? "text-bg-warning" : "text-bg-success"}`}>
                    {sandboxMode ? "Razorpay Test Mode" : "Live Billing"}
                  </span> */}
                  {billingSummary.freeTrialActive ? <span className="badge text-bg-info">Free trial active</span> : null}
                  {billingSummary.pendingEnterpriseRequests ? (
                    <span className="badge text-bg-primary">
                      {billingSummary.pendingEnterpriseRequests} enterprise request pending
                    </span>
                  ) : null}
                  {/* {billingSummary.gatewayReady ? <span className="badge text-bg-light border">Gateway configured</span> : <span className="badge text-bg-light border">Gateway keys pending</span>} */}
                </div>
              </div>
              <div className="admin-billing-hero-price">
                <strong>{activePlanPrice}</strong>
                <span>{activePlanCode === "ENTERPRISE" ? "" : "/month"}</span>
                <small className={`badge ${isExpired ? "text-bg-danger" : "text-bg-primary"}`}>
                  {isExpired ? "Expired" : "Monthly Plan"}
                </small>
              </div>
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

            {/* Phase E / Task 4: capacity alert banners */}
            {addonUsage ? (() => {
              const alerts: string[] = [];
              for (const [k, label] of [["training", "training"], ["session", "session"], ["user", "user"]] as const) {
                const u = addonUsage[k];
                if (!u.unlimited && u.limit && u.remaining !== null && u.remaining / u.limit < 0.2) {
                  alerts.push(u.remaining <= 0
                    ? `${label.charAt(0).toUpperCase() + label.slice(1)} capacity is exhausted.`
                    : `You have only ${u.remaining.toLocaleString()} ${label} slot${u.remaining === 1 ? "" : "s"} remaining.`);
                }
              }
              return alerts.length ? (
                <div className="mb-3">
                  {alerts.map((msg) => (
                    <div key={msg} className="alert alert-warning d-flex align-items-center py-2 mb-2">
                      <i className="ri-error-warning-line me-2 fs-5" />{msg}
                    </div>
                  ))}
                </div>
              ) : null;
            })() : null}

            {/* Phase E / Task 1: Current Subscription */}
            <div className="card mb-3">
              <div className="card-body">
                <h2 className="h4 fw-semibold mb-3">Current Subscription</h2>
                <div className="row g-2 mb-3">
                  <div className="col-6 col-md-4 col-lg-2"><div className="small text-body-secondary">Plan</div><div className="fw-semibold">{activePlan}</div></div>
                  <div className="col-6 col-md-4 col-lg-2"><div className="small text-body-secondary">Start Date</div><div className="fw-semibold">{formatDateLabel(billingSummary.startedOn)}</div></div>
                  <div className="col-6 col-md-4 col-lg-2"><div className="small text-body-secondary">Expiry Date</div><div className="fw-semibold">{formatDateLabel(billingSummary.expiresOn)}</div></div>
                  <div className="col-6 col-md-4 col-lg-2"><div className="small text-body-secondary">Monthly Credits</div><div className="fw-semibold">{billingSummary.monthlyCredits.toLocaleString()}</div></div>
                  <div className="col-6 col-md-4 col-lg-2"><div className="small text-body-secondary">Total Credits</div><div className="fw-semibold">{billingSummary.totalCredits.toLocaleString()}</div></div>
                  <div className="col-6 col-md-4 col-lg-2"><div className="small text-body-secondary">Available</div><div className="fw-semibold">{billingSummary.availableCredits.toLocaleString()}</div></div>
                </div>
                {addonUsage ? (
                  <div className="row g-3">
                    {(["training", "session", "user"] as const).map((k) => {
                      const u = addonUsage[k];
                      const pct = u.unlimited || !u.limit ? 0 : Math.min(100, Math.round((u.used / u.limit) * 100));
                      const tone = u.unlimited ? "success" : (u.limit && u.remaining !== null ? (u.remaining / u.limit > 0.5 ? "success" : u.remaining / u.limit > 0.2 ? "warning" : "danger") : "success");
                      return (
                        <div key={k} className="col-12 col-md-4">
                          <div className="border rounded p-3 h-100">
                            <div className="fw-semibold mb-1">{ADDON_LABEL[k]} Usage</div>
                            <div className="d-flex justify-content-between small mb-1">
                              <span>Used <strong>{u.used.toLocaleString()}</strong> / {u.unlimited ? <span className="badge text-bg-info">Unlimited</span> : (u.limit ?? 0).toLocaleString()}</span>
                              <span>Remaining: <strong>{u.unlimited ? "∞" : (u.remaining ?? 0).toLocaleString()}</strong></span>
                            </div>
                            {!u.unlimited ? (
                              <div className="progress" style={{ height: 6 }}>
                                <div className={`progress-bar bg-${tone}`} style={{ width: `${pct}%` }} />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Phase E / Task 2: Purchased Capacity (add-ons only) */}
            {addonUsage && (addonUsage.training.purchased > 0 || addonUsage.session.purchased > 0 || addonUsage.user.purchased > 0) ? (
              <div className="card mb-3">
                <div className="card-body">
                  <h2 className="h5 fw-semibold mb-3">Purchased Capacity (Add-Ons)</h2>
                  <div className="row g-3">
                    {(["training", "session", "user"] as const).map((k) => (
                      <div key={k} className="col-12 col-md-4">
                        <div className="border rounded p-3 text-center">
                          <div className="small text-body-secondary mb-1">Additional {ADDON_LABEL[k]}</div>
                          <div className="fs-4 fw-semibold">{addonUsage[k].purchased > 0 ? `+${addonUsage[k].purchased.toLocaleString()}` : "—"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="admin-billing-support card">
              <div className="card-body">
                <div className="admin-billing-support-copy">
                  <span className="admin-billing-support-icon">
                    <i className="ri-customer-service-2-line" />
                  </span>
                  <div>
                    <h2 className="h5 fw-semibold mb-1">Need Help?</h2>
                    <p className="text-body-secondary mb-1">Contact our support team for any questions about your plan.</p>
                    <a href="mailto:support@samsung.com">support@samsung.com</a>
                  </div>
                </div>
                <button type="button" className="btn btn-outline-primary" onClick={() => setSupportOpen(true)}>
                  Contact Support
                </button>
              </div>
            </div>

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
                    <h2 className="h4 fw-semibold mb-1">Recent Transactions</h2>
                    <p className="text-body-secondary mb-0">Latest plan assignments, purchases, and credit deductions.</p>
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
                      {planTransactions.length ? (
                        planTransactions.map((item, index) => {
                          const status = getTransactionStatus(item.type);
                          const transactionPlan = item.planCode || activePlanCode;
                          return (
                            <tr key={item.createdAt || `${item.note}-${index}`}>
                              <td className="fw-semibold text-primary">{item.invoiceId || item.orderId || `PLAN${String(index + 1).padStart(6, "0")}`}</td>
                              <td>
                                <div className="fw-semibold">{item.note || item.reason || "Credit activity"}</div>
                                <div className="small text-body-secondary">{item.reason || item.note || "Billing ledger entry"}</div>
                              </td>
                              <td>{formatDateLabel(item.createdAt)}</td>
                              <td>{getExpiryDateLabel(item.createdAt, String(transactionPlan))}</td>
                              <td>{planLabels[String(transactionPlan).toUpperCase()] ?? transactionPlan}</td>
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
                            No billing transactions yet.
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

            {/* Capacity Usage is now shown in the Current Subscription section above (Task 1). */}

            {/* Phase D: add-on marketplace. */}
            <div className="card admin-billing-transactions-card">
              <div className="card-body">
                <div className="mb-3">
                  <h2 className="h4 fw-semibold mb-1">Add-On Marketplace</h2>
                  <p className="text-body-secondary mb-0">Buy extra capacity without changing your plan. Add-ons never expire and stack.</p>
                </div>
                <div className="row g-3">
                  {(["training", "session", "user"] as const).map((type) => (
                    <div key={type} className="col-12 col-lg-4">
                      <div className="border rounded p-3 h-100">
                        <div className="fw-semibold mb-2">{ADDON_LABEL[type]} capacity</div>
                        {ADDON_OPTIONS[type].map((qty) => (
                          <div key={qty} className="d-flex align-items-center justify-content-between mb-2">
                            <span>+{qty.toLocaleString()} {ADDON_LABEL[type]}</span>
                            <span className="d-flex gap-1">
                              <button
                                className="btn btn-sm btn-outline-primary"
                                disabled={addonBusy || !canManageBilling}
                                title={addonPricing ? `${(addonPricing.creditUnit[type] * qty).toLocaleString()} credits` : ""}
                                onClick={() => void buyAddonWithCredits(type, qty)}
                              >
                                Credits{addonPricing ? ` (${(addonPricing.creditUnit[type] * qty).toLocaleString()})` : ""}
                              </button>
                              <button
                                className="btn btn-sm btn-outline-secondary"
                                disabled={addonBusy || !canManageBilling || !razorpayConfigured}
                                title={razorpayConfigured ? "Pay with Razorpay" : "Razorpay not configured"}
                                onClick={() => void buyAddonWithRazorpay(type, qty)}
                              >
                                Pay
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {!razorpayConfigured ? (
                  <div className="small text-body-secondary mt-2"><i className="bi bi-info-circle me-1" />Razorpay not configured — payment purchases are disabled. Use credits, or configure Razorpay keys.</div>
                ) : null}
              </div>
            </div>

            {/* Phase D + Phase E / Task 6: add-on purchase history with export. */}
            <div className="card admin-billing-transactions-card">
              <div className="card-body">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
                  <h2 className="h4 fw-semibold mb-0">Add-On Purchase History</h2>
                  <div className="d-flex gap-1">
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => {
                      const header = "Date,Resource,Quantity,Method,Cost,Currency,Status,By\n";
                      const rows = addonHistory.map((r) => `${r.createdAt},${r.type},${r.quantity},${r.purchaseMethod},${r.totalCost},${r.currency},${r.status},${r.performedBy || ""}`).join("\n");
                      const blob = new Blob([header + rows], { type: "text/csv" });
                      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "addon-history.csv"; a.click();
                    }}>CSV</button>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => {
                      const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
                      pdf.setFontSize(14); pdf.text("Add-On Purchase History", 40, 40);
                      let y = 70; pdf.setFontSize(8);
                      pdf.text("Date", 40, y); pdf.text("Resource", 150, y); pdf.text("Qty", 230, y); pdf.text("Method", 280, y); pdf.text("Cost", 370, y); pdf.text("Status", 450, y); pdf.text("By", 530, y);
                      y += 16;
                      for (const r of addonHistory) {
                        if (y > 560) { pdf.addPage(); y = 40; }
                        pdf.text(formatDateLabel(r.createdAt), 40, y); pdf.text(r.type, 150, y); pdf.text(`+${r.quantity}`, 230, y);
                        pdf.text(r.purchaseMethod, 280, y); pdf.text(`${r.totalCost} ${r.currency}`, 370, y); pdf.text(r.status, 450, y); pdf.text(r.performedBy || "", 530, y);
                        y += 14;
                      }
                      pdf.save("addon-history.pdf");
                    }}>PDF</button>
                  </div>
                </div>
                <div className="table-responsive">
                  <table className="table align-middle mb-0">
                    <thead>
                      <tr><th>Date</th><th>Resource</th><th>Quantity</th><th>Method</th><th>Cost</th><th>Status</th><th>By</th></tr>
                    </thead>
                    <tbody>
                      {addonHistory.length ? (
                        addonHistory.map((row) => (
                          <tr key={row.id}>
                            <td>{formatDateLabel(row.createdAt)}</td>
                            <td className="text-capitalize">{row.type}</td>
                            <td>+{row.quantity.toLocaleString()}</td>
                            <td className="text-capitalize">{row.purchaseMethod}</td>
                            <td>{row.totalCost.toLocaleString()} {row.currency === "credits" ? "credits" : row.currency}</td>
                            <td><span className="badge text-bg-success text-capitalize">{row.status}</span></td>
                            <td>{row.performedBy || "—"}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={7} className="text-center text-body-secondary py-4">No add-on purchases yet.</td></tr>
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
              Share your pricing, user scale, or credit requirement. This request will be visible to the super admin for manual enterprise assignment.
            </p>
          </div>

          <div>
            <label htmlFor="enterprise-support-message" className="form-label">Query</label>
            <textarea
              id="enterprise-support-message"
              className="form-control"
              rows={5}
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
