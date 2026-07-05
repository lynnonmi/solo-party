/**
 * 솔로파티 관리자 → 구글 시트 연동
 *
 * 설정 방법:
 * 1. Google Sheets 새로 만들기
 * 2. 확장 프로그램 → Apps Script
 * 3. 이 파일 내용 전체 붙여넣기 → 저장
 * 4. 배포 → 새 배포 → 유형: 웹 앱
 *    - 실행 주체: 나
 *    - 액세스: 모든 사용자
 * 5. 생성된 웹 앱 URL을 관리자 페이지 「시트 연결」에 붙여넣기
 */

const SHEET_NAME = "신청자";

function doGet() {
  return json({ ok: true, message: "connected" });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json({ ok: false, error: "empty request body" });
    }
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

    if (data.replace) {
      sheet.clear();
    }

    const headers = data.headers || [];
    const rows = data.rows || [];
    const imageColumns = (data.imageColumns || []).map(Number);

    if (headers.length && (data.replace || sheet.getLastRow() === 0)) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight("bold")
        .setBackground("#f0a8be")
        .setFontColor("#080808");
      sheet.setFrozenRows(1);
    }

    if (!rows.length) {
      return json({ ok: true, message: "no rows" });
    }

    const startRow = sheet.getLastRow() + 1;
    const numCols = Math.max(headers.length, ...rows.map((r) => r.length));

    rows.forEach((row, i) => {
      const rowNum = startRow + i;
      const padded = [];
      for (let c = 0; c < numCols; c++) {
        padded.push(row[c] ?? "");
      }

      for (let c = 0; c < numCols; c++) {
        const col = c + 1;
        const val = padded[c];
        const cell = sheet.getRange(rowNum, col);

        if (imageColumns.includes(col) && val && String(val).startsWith("http")) {
          cell.setFormula('=IMAGE("' + String(val).replace(/"/g, '""') + '")');
        } else {
          cell.setValue(val);
        }
      }
    });

    // 사진 열 너비·행 높이 (미리보기용)
    imageColumns.forEach((col) => {
      sheet.setColumnWidth(col, 120);
    });
    if (imageColumns.length) {
      sheet.setRowHeights(startRow, rows.length, 100);
    }

    return json({ ok: true, rows: rows.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
