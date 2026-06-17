export const trainerTrainings = [
  {
    id: "T001",
    title: "Samsung Galaxy S25 Sales Mastery",
    status: "review",
    slides: 14,
    trainer: "Rohan Mehta",
    audience: "Retail Sales Teams",
    submittedOn: "31 Mar 2026",
  },
  {
    id: "T002",
    title: "Customer Objection Handling",
    status: "approved",
    slides: 9,
    trainer: "Priya Sharma",
    audience: "Store Managers",
    submittedOn: "28 Mar 2026",
  },
  {
    id: "T003",
    title: "AMOLED Display Deep Dive",
    status: "draft",
    slides: 11,
    trainer: "Anjali Verma",
    audience: "Product Specialists",
    submittedOn: "26 Mar 2026",
  },
];

export const trainerLoginUser = {
  email: "trainer@samsung.com",
  password: "trainer123",
  name: "Rohan Mehta",
  roleLabel: "Content Trainer",
};

export const reviewerQueue = [
  {
    id: "RQ001",
    title: "Galaxy S25 Sales Mastery",
    trainer: "Rohan Mehta",
    slides: 14,
    status: "awaiting_review",
    submittedOn: "31 Mar 2026",
    priority: "High",
  },
  {
    id: "RQ002",
    title: "Retail Floor Safety Protocol",
    trainer: "Priya Sharma",
    slides: 8,
    status: "changes_requested",
    submittedOn: "30 Mar 2026",
    priority: "Medium",
  },
  {
    id: "RQ003",
    title: "Trainup Care+ Attach Strategy",
    trainer: "Anjali Verma",
    slides: 10,
    status: "approved",
    submittedOn: "28 Mar 2026",
    priority: "Low",
  },
];

export const reviewerLoginUser = {
  email: "reviewer@samsung.com",
  password: "reviewer123",
  name: "Ankit Kumar",
  roleLabel: "Reviewer",
};

export const employeeSlides = [
  {
    id: "S1",
    title: "Galaxy S25 Launch Story",
    copy: "The Galaxy S25 lineup leads with AI-assisted retail demos, premium camera positioning, and faster customer qualification.",
  },
  {
    id: "S2",
    title: "Key Selling Points",
    copy: "Use the 200 MP camera story, AI zoom, battery efficiency, and ecosystem continuity to move the conversation from price to value.",
  },
  {
    id: "S3",
    title: "Handling Objections",
    copy: "When price objections come up, reframe around trade-in programs, Trainup Care+, and long-term ownership value.",
  },
];

export const employeeAssignedTraining = {
  id: "TRN-S25-SSO-2026",
  title: "Galaxy S25 - Sales Mastery",
  durationLabel: "~15 min",
  slideCount: employeeSlides.length,
  mandatoryLabel: "Mandatory",
  dueLabel: "Complete by 12 Apr 2026",
  audience: "Trainup Retail Sales Teams",
  accessUrl: "https://sso.samsung-internal.com/auth?redirect=samsung-lms%2Ftraining%2Fgalaxy-s25-sales-mastery",
  launchUrl: "https://jade-caramel-11e104.netlify.app/",
  checklist: ["SSO verification", "Assigned training access", "Slide-by-slide module playback"],
};

export const ssoUsers = {
  "SAM-1042": { name: "Rahul Sharma", dept: "Sales - South Zone", password: "Sam@1042" },
  "SAM-2318": { name: "Pooja Mehta", dept: "Sales - North Zone", password: "Sam@2318" },
  "SAM-0091": { name: "Arjun Kapoor", dept: "Sales - East Zone", password: "Sam@0091" },
};
