// Original text written for ClauseClear tests. Names, addresses and figures are fictional.
// Every employment category in SPEC section 8 is present, and several are written to be flagged.
// The leave policy is left out on purpose (part of "Missing basics").
import { h, i, p, title, type DocumentSpec } from "./layout.js";

export const employment: DocumentSpec = {
  title: "Offer of Employment",
  header: "Brightwave Analytics Private Limited - Confidential",
  pageNumbers: true,
  blocks: [
    title("OFFER OF EMPLOYMENT"),
    p("Date: 12 October 2026"),
    p("To: Mr. Rohan Iyer, 44 Lake View Apartments, Indiranagar, Bengaluru"),
    p(
      "Dear Rohan, Brightwave Analytics Private Limited (the Company) is pleased to offer you the position of Associate Data Engineer on the terms below. This letter, together with its annexure, forms your contract of employment.",
    ),
    h("1. APPOINTMENT AND PLACE OF WORK"),
    p(
      "1.1 You will join on or before 1 December 2026 and will initially be based at our Bengaluru office.",
    ),
    p(
      "1.2 The Company may transfer you to any office, client site, group company or location in India or abroad at any time and with immediate effect, and you shall report at the new location on the date stated by the Company. No relocation allowance is payable unless the Company decides otherwise.",
    ),
    h("2. PROBATION"),
    p(
      "2.1 You will be on probation for an initial period, which the Company may extend from time to time at its sole discretion. Your employment will be confirmed only by a written letter of confirmation.",
    ),
    p("2.2 During probation your employment may be ended by either party with seven days notice."),
    h("3. COMPENSATION"),
    p(
      "3.1 Your fixed annual compensation will be Rs. 9,60,000, paid monthly in arrears after statutory deductions. The break-up is given in Annexure A.",
    ),
    p(
      "3.2 You will also be eligible for an annual performance bonus of up to 15 percent of fixed pay. The amount of any bonus, and whether it is paid at all, is at the sole discretion of the Company, and the Company may recover any bonus already paid if you resign within twelve months of receiving it.",
    ),
    p(
      "3.3 A joining bonus of Rs. 75,000 will be paid with your first salary. If you leave the Company for any reason within eighteen months of joining, you shall repay the full joining bonus.",
    ),
    h("4. TRAINING BOND"),
    p(
      "4.1 The Company will invest in your training during the first six months. In consideration of this, you agree to serve the Company for a minimum period of two years from your date of joining.",
    ),
    p(
      "4.2 If you resign or are terminated for cause before the end of this two-year period, you shall pay the Company Rs. 3,00,000 as liquidated damages towards training costs, which the Company may recover from any amount due to you.",
    ),
    h("5. WORKING HOURS"),
    p(
      "5.1 Your normal working hours will be as required by the business. You may be required to work late evenings, weekends and public holidays to meet project needs, and no overtime or additional compensation will be payable for such work.",
    ),
    h("6. NOTICE PERIOD AND RECOVERY"),
    p(
      "6.1 After confirmation, either party may end this employment by giving ninety days notice in writing. The Company may at its option accept pay in lieu of notice from you, calculated on your gross monthly compensation, and may relieve you earlier or later than the notice date as business needs require.",
    ),
    p(
      "6.2 The Company may deduct from your final settlement any amounts it believes you owe, including notice pay, training costs, joining bonus, equipment, and any loss caused to the Company, as determined by the Company.",
    ),
    h("7. TERMINATION"),
    p(
      "7.1 The Company may terminate your employment immediately and without notice or pay in lieu for cause. Cause includes, without limitation, any conduct which in the opinion of the Company is not in its interest.",
    ),
    h("8. CONFIDENTIALITY"),
    p(
      "8.1 You shall keep confidential all information you receive about the Company, its clients, employees and business, whether or not it is marked confidential. This obligation continues during your employment and at all times after it ends, without any time limit.",
    ),
    h("9. INTELLECTUAL PROPERTY"),
    p(
      "9.1 All inventions, software, writings, designs and other works created by you during the period of your employment, whether or not during working hours, whether or not using Company equipment, and whether or not related to the business of the Company, shall belong to the Company absolutely. You hereby assign all rights in them to the Company.",
    ),
    h("10. NON-COMPETE AND NON-SOLICITATION"),
    p(
      "10.1 For a period of twenty-four months after your employment ends for any reason, you shall not, anywhere in India, join, advise or start any business that competes with the Company or with any of its clients.",
    ),
    p(
      "10.2 For the same period you shall not approach, hire or try to hire any employee of the Company, or deal with any person who was a client of the Company during your employment.",
    ),
    h("11. CODE OF CONDUCT"),
    p(
      "11.1 You shall follow the Company's policies as amended from time to time, including the code of conduct, the information security policy and the anti-harassment policy.",
    ),
    p(
      "11.2 You shall not take up any other employment, paid or unpaid, while employed by the Company.",
    ),
    h("12. GOVERNING LAW AND DISPUTES"),
    p(
      "12.1 This contract is governed by the laws of India. Any dispute shall be referred to a sole arbitrator appointed by the Company, and the seat of arbitration shall be Gurugram. The decision of the arbitrator shall be final and binding.",
    ),
    h("13. ACCEPTANCE"),
    p(
      "13.1 Please sign and return a copy of this letter within three days as a token of your acceptance. This offer will lapse if it is not accepted within that time.",
    ),
    p("Yours sincerely, Priya Nair, Head of People, Brightwave Analytics Private Limited."),
    h("ANNEXURE A: COMPENSATION BREAK-UP"),
    i("(a) Basic salary: Rs. 4,80,000 per year."),
    i("(b) House rent allowance: Rs. 1,92,000 per year."),
    i("(c) Special allowance: Rs. 2,30,400 per year."),
    i("(d) Employer contribution to provident fund: Rs. 57,600 per year."),
    i("(e) Annual performance bonus: variable, as described in clause 3.2."),
    p(
      "I have read and understood the terms above and accept them. Signed: Rohan Iyer. Date: ____________",
    ),
  ],
};
