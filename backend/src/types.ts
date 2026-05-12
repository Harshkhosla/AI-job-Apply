export type JobSource = "greenhouse" | "lever" | "ashby" | "linkedin" | "indeed";

export interface NormalizedJob {
  source: JobSource;
  sourceJobId: string;
  url: string;
  company: string;
  title: string;
  location?: string;
  remote?: boolean;
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
    start?: string;
    end?: string;
  }>;
  links?: { github?: string; linkedin?: string; portfolio?: string };
  preferences?: {
    targetRoles?: string[];
    locations?: string[];
    remoteOk?: boolean;
    minSalary?: number;
    currency?: string;
  };
  baseResume?: string;
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
