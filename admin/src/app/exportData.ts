import type { Application, AppStatus } from "./types";

const STATUS_LABEL: Record<AppStatus, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "거절·환불완료",
  refund_requested: "환불 요청",
  refunded: "환불 완료",
};

export const EXPORT_HEADERS = [
  "이름",
  "성별",
  "나이",
  "닉네임",
  "MBTI",
  "연락처",
  "직업",
  "직업 상세",
  "상태",
  "SMS 발송",
  "입금 확인",
  "제출 일시",
  "사진 1",
  "사진 2",
  "사진 3",
  "투표 프로필",
  "요즘 삶",
  "이루고 싶은 삶",
  "혼자 있을 때",
  "인스타그램",
  "끌리는 사람",
  "나의 장점",
  "닮은꼴",
  "환불 은행",
  "환불 계좌",
] as const;

/** 1-based column indices for IMAGE() preview in Google Sheets */
export const EXPORT_IMAGE_COLUMNS = [13, 14, 15, 16];

export function applicationToExportRow(app: Application): string[] {
  const photos = app.photos ?? [];
  return [
    app.name,
    app.gender,
    String(app.age),
    app.nickname,
    app.mbti,
    app.contact,
    app.job,
    app.jobDetail ?? "",
    STATUS_LABEL[app.status],
    app.smsSent ? "발송" : "-",
    app.depositConfirmed ? "확인" : "미확인",
    app.submittedAt ? new Date(app.submittedAt).toLocaleString("ko-KR") : "",
    photos[0] ?? "",
    photos[1] ?? "",
    photos[2] ?? "",
    app.voteProfilePhoto ?? "",
    app.currentWork,
    app.lifeGoal,
    app.hobbies,
    app.instagram ? `@${app.instagram.replace(/^@/, "")}` : "",
    app.idealType,
    app.charm,
    app.celebrity,
    app.refundBank,
    app.refundAccount,
  ];
}

export function applicationsToExportRows(apps: Application[]): string[][] {
  return apps.map(applicationToExportRow);
}
