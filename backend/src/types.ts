export type JobSource = "greenhouse" | "lever" | "ashby" | "linkedin" | "indeed";

export interface NormalizedJob {
  source: JobSource;
  sourceJobId: string;
  url: string;
  company: string;
  title: string;
  location?: string;
  remote?: boolean;
  easyApply?: boolean;
  employmentType?: string;
  description: string;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  postedAt?: Date;
}

export interface ProfileData {
  name: string;
  email: string;
  phone?: string;
  location?: string;
  headline?: string;
  summary?: string;
  skills: string[];
  experience: Array<{
    company: string;
    title: string;
    start: string;
    end?: string;
    bullets: string[];
  }>;
  education: Array<{
    school: string;
    degree: string;
    field?: string;
    gpa?: string;
    start?: string;
    end?: string;
  }>;
  projects?: Array<{
    name: string;
    description?: string;
    url?: string;
    stack?: string[];
  }>;
  certifications?: Array<{
    name: string;
    issuer?: string;
    year?: string;
    url?: string;
  }>;
  languages?: Array<{ name: string; proficiency?: string }>;
  links?: {
    github?: string;
    linkedin?: string;
    portfolio?: string;
    twitter?: string;
    stackoverflow?: string;
    leetcode?: string;
    medium?: string;
  };
  preferences?: {
    targetRoles?: string[];
    locations?: string[];
    remoteOk?: boolean;
    onsiteOk?: boolean;
    hybridOk?: boolean;
    openToRelocate?: boolean;
    visaSponsorship?: boolean;
    yearsExperience?: number;
    seniorityTarget?: string;
    minSalary?: number;
    currency?: string;
    employmentTypes?: string[]; // full-time, contract, internship
    industries?: string[];
    avoidCompanies?: string[];
  };
  personal?: {
    firstName?: string;
    lastName?: string;
    preferredName?: string;
    pronouns?: string;
    dateOfBirth?: string;
    gender?: string;
    race?: string;
    veteranStatus?: string;
    disabilityStatus?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  workAuth?: {
    citizenOf?: string;
    authorizedToWorkIn?: string[];
    needsSponsorshipIn?: string[];
    visaStatus?: string;
    requiresRelocationAssistance?: boolean;
  };
  application?: {
    noticePeriodDays?: number;
    currentSalary?: number;
    currentSalaryCurrency?: string;
    expectedSalary?: number;
    expectedSalaryCurrency?: string;
    availabilityDate?: string;
    referredBy?: string;
    coverLetterSnippet?: string;
    whyThisCompany?: string;
    references?: Array<{ name: string; title?: string; email?: string; phone?: string; relationship?: string }>;
  };
  baseResume?: string;
  resumeFileUrl?: string;
}

export interface ScoreResult {
  score: number; // 0-100
  fitSummary: string;
  pros: string[];
  cons: string[];
}

export interface OutreachResult {
  subject: string;
  body: string;
  recruiter?: string;
}
