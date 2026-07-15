import { useEffect, useState } from "react";
import type { Application, AppStatus } from "./types";

/** LMS 제목 */
export const SMS_APPROVE_SUBJECT = "[김해린의 두번째 솔로파티] 승인 안내";
export const SMS_REJECT_SUBJECT = "[김해린의 두번째 솔로파티] 신청 결과";

/** @deprecated 승인 제목과 동일 — 새 코드는 getSmsSubject 사용 */
export const SMS_SUBJECT = SMS_APPROVE_SUBJECT;

export const SMS_APPROVE_TEXT = `안녕하세요, 김해린입니다.

저의 두번째 솔로파티에 신청해주셔서 감사합니다.

신청서를 꼼꼼히 검토한 결과, 최종 승인되어 안내드립니다.

[행사 안내]
• 일시: 8월 9일(일) 오후 5:00
(오후 4:50부터 입장 가능하며, 원활한 진행을 위해 오후 5시까지 입장 부탁드립니다.)

• 장소: 서울특별시 강남구 학동로2길 56 원창빌딩 3층 컴업살롱

[안내사항]
• 신분증 지참 필수 (본인 확인용)
• 다과, 음료, 주류 및 간단한 식사는 행사 2부에서 제공될 예정입니다. 식사를 먼저 하고 오시면 더욱 편하게 참여하실 수 있습니다.
• 주차는 지원되지 않습니다.

문의사항은 아래 오픈채팅으로 부탁드립니다.
(본 번호는 수신 전용으로 회신이 어렵습니다.)
https://open.kakao.com/o/s9r5ORCi

솔로파티 당일에 뵙겠습니다.
감사합니다! <3`;

export const SMS_REJECT_TEXT = `안녕하세요, 김해린입니다.

제2회 솔로파티에 신청해주셔서 감사합니다.

신청서를 꼼꼼히 검토한 결과, 이번에는 아쉽게도 모시지 못하게 되어 안내드립니다.

참가 여부는 외모, 직업, 학력 등 개별적인 조건만으로 결정되는 것이 아니라, 행사의 취지와 전체적인 참가자 구성 및 분위기를 종합적으로 고려하여 신중하게 선정하고 있습니다. 그 과정에서 이번에는 함께하지 못하게 된 점 너른 양해 부탁드립니다.

소중한 시간 내어 신청해주셔서 진심으로 감사드리며, 다음에 더 좋은 기회로 찾아뵐 수 있기를 바랍니다.

문의사항은 아래 오픈채팅으로 부탁드립니다.
(본 번호는 수신 전용으로 회신이 어렵습니다.)
https://open.kakao.com/o/s9r5ORCi

감사합니다.`;

export function getSmsBody(status: AppStatus): string {
  return status === "rejected" ? SMS_REJECT_TEXT : SMS_APPROVE_TEXT;
}

export function getSmsSubject(status: AppStatus): string {
  return status === "rejected" ? SMS_REJECT_SUBJECT : SMS_APPROVE_SUBJECT;
}

export function getSmsKindLabel(status: AppStatus): string {
  return status === "rejected" ? "거절" : "승인";
}

export function statusLabel(status: AppStatus): string {
  const map: Record<AppStatus, string> = {
    pending: "대기",
    approved: "승인",
    rejected: "거절·환불완료",
    refund_requested: "환불 요청",
    refunded: "환불 완료",
  };
  return map[status];
}

export function getProfilePhoto(app: Partial<Application>): string | null {
  return app.voteProfilePhoto || app.photos?.[0] || null;
}

export function useIsPC() {
  const [isPC, setIsPC] = useState(() => typeof window !== "undefined" && window.innerWidth >= 768);
  useEffect(() => {
    const h = () => setIsPC(window.innerWidth >= 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isPC;
}
