export type Gender = "남성" | "여성";
export type AppStatus = "pending" | "approved" | "rejected" | "refund_requested" | "refunded";
export type GenderFilter = "전체" | "남성" | "여성";
export type StatusFilter = "전체" | "pending" | "approved" | "rejected" | "refund_requested" | "refunded";
export type AdminTab = "apps" | "vote" | "matching" | "refunds";
export type PCSection = "applications" | "vote-management" | "matching" | "refunds";
export type RefundFilter = "요청" | "완료";

export interface Application {
  id: string;
  name: string;
  gender: Gender;
  age: string;
  nickname: string;
  mbti: string;
  contact: string;
  job: string;
  jobDetail?: string;
  currentWork: string;
  lifeGoal: string;
  hobbies: string;
  instagram: string;
  idealType: string;
  charm: string;
  celebrity: string;
  photos: string[];
  voteProfilePhoto?: string;
  refundBank: string;
  refundAccount: string;
  status: AppStatus;
  smsSent?: boolean;
  feeConfirmed?: boolean;
  depositConfirmed?: boolean;
  submittedAt: string;
}
