// Original text written for ClauseClear tests. Names, addresses and figures are fictional.
// Every loan category in SPEC section 8 is present, and several are written to be flagged.
// No repayment schedule or key facts page is included on purpose (part of "Missing basics").
import { h, i, p, title, type DocumentSpec } from "./layout.js";

export const loan: DocumentSpec = {
  title: "Personal Loan Agreement",
  header: "Swiftcred Finance Limited - Personal Loan Agreement",
  pageNumbers: true,
  blocks: [
    title("PERSONAL LOAN AGREEMENT"),
    p(
      "This Personal Loan Agreement is made at Hyderabad on 20 September 2026 between Swiftcred Finance Limited, a non-banking finance company with its office at 5 Banjara Hills Road, Hyderabad (the Lender), and Ms. Lakshmi Reddy, residing at 23 Gandhi Nagar, Secunderabad (the Borrower), and Mr. Venkat Rao, residing at 8 Temple Street, Warangal (the Guarantor).",
    ),
    h("1. THE LOAN"),
    p(
      "1.1 The Lender agrees to lend the Borrower Rs. 4,00,000 (the Loan) for personal purposes, to be repaid in thirty-six monthly instalments.",
    ),
    p(
      "1.2 The Loan will be disbursed to the Borrower's bank account after deduction of the fees and charges set out in clause 4.",
    ),
    h("2. INTEREST"),
    p(
      "2.1 Interest shall be charged at the rate of 1.5 percent per month on the Loan, calculated on such basis as the Lender may adopt.",
    ),
    p(
      "2.2 The Lender may change the rate of interest at any time at its sole discretion, with or without notice to the Borrower, and the revised rate shall apply from the date the Lender decides.",
    ),
    h("3. REPAYMENT"),
    p(
      "3.1 The Borrower shall repay the Loan with interest in equated monthly instalments of the amount the Lender communicates, due on the 3rd day of each month.",
    ),
    p(
      "3.2 The Borrower may prepay the whole of the Loan only after twelve instalments have been paid, on payment of a foreclosure charge of 6 percent of the principal outstanding together with interest for the following three months. Part prepayment is not allowed.",
    ),
    h("4. FEES AND CHARGES"),
    p(
      "4.1 The Borrower shall pay a processing fee of 3 percent of the Loan, documentation charges, a convenience fee, and such other charges as the Lender may levy from time to time, all of which are non-refundable.",
    ),
    p(
      "4.2 A cheque or mandate bounce charge of Rs. 750 shall apply to each dishonoured instalment, in addition to any other charges.",
    ),
    h("5. LATE PAYMENT AND DEFAULT"),
    p(
      "5.1 If any instalment is not paid on its due date, the Borrower shall pay penal interest of 3 percent per month on the overdue amount, compounded monthly, in addition to the regular interest, together with a collection charge of Rs. 500 for every visit or call made to recover the dues.",
    ),
    p("5.2 Each of the following is an event of default:"),
    i("(a) the Borrower fails to pay any amount on its due date;"),
    i("(b) the Borrower changes her job, address or mobile number without informing the Lender;"),
    i(
      "(c) any other loan of the Borrower or the Guarantor with any lender is in default or is closed early;",
    ),
    i(
      "(d) in the opinion of the Lender, any event has occurred which may affect the Borrower's ability to repay.",
    ),
    h("6. ACCELERATION"),
    p(
      "6.1 On the occurrence of any event of default, or at any other time if the Lender so decides, the Lender may declare the entire Loan with interest and all charges immediately due and payable, and the Borrower shall pay it within seven days of demand.",
    ),
    h("7. SECURITY AND GUARANTEE"),
    p(
      "7.1 The Guarantor unconditionally guarantees the repayment of the Loan and of all other amounts that the Borrower owes or may come to owe the Lender under any agreement, now or in the future, and agrees that the Lender may proceed against the Guarantor without first proceeding against the Borrower.",
    ),
    p(
      "7.2 The Borrower agrees that the Lender may set off any amount due against any deposit, salary credit or other money of the Borrower held with the Lender or its group companies.",
    ),
    h("8. INSURANCE"),
    p(
      "8.1 The Borrower shall take a credit life insurance policy and a personal accident cover arranged by the Lender, and the premium for both shall be deducted from the Loan amount at disbursement. The Loan will not be disbursed without these policies.",
    ),
    h("9. AUTO-DEBIT MANDATE"),
    p(
      "9.1 The Borrower authorises the Lender to debit her bank account, by NACH mandate or otherwise, for any amount the Lender determines to be payable under this agreement, at any time and as many times as the Lender considers necessary, including amounts above the instalment.",
    ),
    h("10. CREDIT INFORMATION"),
    p(
      "10.1 The Borrower consents to the Lender sharing any information about the Borrower, the Loan and her repayment record with credit information companies, collection agencies, marketing partners, group companies and any other third party the Lender thinks fit.",
    ),
    h("11. COLLECTION"),
    p(
      "11.1 The Lender may appoint recovery agents to collect overdue amounts, and the Borrower shall bear all collection costs, including legal fees, on such scale as the Lender decides.",
    ),
    h("12. DISPUTE RESOLUTION"),
    p(
      "12.1 Any dispute arising under this agreement shall be referred to arbitration by a sole arbitrator nominated by the Lender. The arbitration shall be held at Mumbai and conducted in English, and the award shall be binding on all parties.",
    ),
    h("13. GENERAL"),
    p(
      "13.1 The Lender may assign or transfer this Loan to any person without notice to the Borrower. The Borrower may not assign her rights or obligations.",
    ),
    p(
      "13.2 The Borrower confirms that she has read and understood this agreement, that it has been explained to her in a language she understands, and that she signs it of her own free will.",
    ),
    p(
      "Signed for Swiftcred Finance Limited by its authorised signatory, Anil Varma. Signed by the Borrower, Lakshmi Reddy. Signed by the Guarantor, Venkat Rao.",
    ),
  ],
};
