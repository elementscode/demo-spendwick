import { test, equal } from "@elements/app";
import { ExportRow, toCsv } from "#app/shared/services/finance";

test("csv export", () => {
  test("quotes commas and quotes, and defuses formulas", () => {
    let row: ExportRow = {
      number: 1001,
      createdAt: new Date("2026-10-01T12:00:00Z"),
      submittedAt: new Date("2026-10-02T12:00:00Z"),
      requesterName: "Ada",
      requesterEmail: "ada@x.example",
      departmentName: "Engineering",
      category: "Software",
      item: "Licenses, \"pro\" tier",
      vendor: "=HYPERLINK(\"x\")",
      amountCents: 123450,
      status: "approved",
      headApprover: "Grace",
      financeApprover: null,
      reason: "",
    };

    let lines = toCsv([row]).split("\r\n");
    equal(lines[1], "PR-1001,2026-10-02,Ada,ada@x.example,Engineering,Software,\"Licenses, \"\"pro\"\" tier\",\"'=HYPERLINK(\"\"x\"\")\",1234.50,approved,Grace,,");
  });
});
