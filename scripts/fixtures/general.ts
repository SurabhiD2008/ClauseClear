// Original text written for ClauseClear tests. Names and figures are fictional.
// A service contract that fits none of the four types, so it gets the general reading.
import { h, p, title, type DocumentSpec } from "./layout.js";

export const general: DocumentSpec = {
  title: "Website Design Services Agreement",
  header: "Website Design Services Agreement",
  pageNumbers: true,
  blocks: [
    title("WEBSITE DESIGN SERVICES AGREEMENT"),
    p(
      "This agreement is made on 3 August 2026 between Inkline Studio, a design firm at 12 Park Street, Kolkata (the Designer), and Green Basket Organics, a shop at 7 Lake Market, Kolkata (the Client).",
    ),
    h("1. SERVICES"),
    p(
      "1.1 The Designer will design and build a five-page website for the Client, including a home page, a product catalogue, an about page, a contact form and an order enquiry page, as described in the proposal dated 28 July 2026.",
    ),
    h("2. FEES AND PAYMENT"),
    p(
      "2.1 The Client shall pay a total fee of Rs. 1,20,000: 50 percent on signing, 30 percent on approval of the design, and 20 percent on launch.",
    ),
    p(
      "2.2 Invoices are payable within seven days. Late payments carry interest at 2 percent per week until paid in full.",
    ),
    h("3. CHANGES"),
    p(
      "3.1 The Designer may change the scope, timeline or fees of this agreement by email notice to the Client, and the changes shall bind the Client from the date of the email.",
    ),
    h("4. TERM AND RENEWAL"),
    p(
      "4.1 After launch, a hosting and maintenance plan at Rs. 4,000 per month begins and renews automatically every month unless the Client cancels in writing ninety days in advance.",
    ),
    h("5. TERMINATION"),
    p(
      "5.1 The Designer may end this agreement at any time by notice. If the Client ends this agreement for any reason, all fees for the whole project become payable at once as liquidated damages.",
    ),
    h("6. OWNERSHIP"),
    p(
      "6.1 The Designer keeps ownership of all designs, code and content until every invoice is paid, and may display the work in its portfolio at any time.",
    ),
    h("7. LIABILITY AND INDEMNITY"),
    p(
      "7.1 The Designer is not liable for any loss of business, data or profit, and its total liability shall not exceed the fees paid in the previous month. The Client shall indemnify the Designer against any claim relating to content supplied by the Client.",
    ),
    h("8. CONFIDENTIALITY AND NON-SOLICITATION"),
    p(
      "8.1 Each party will keep the other's business information confidential. For two years after this agreement ends, the Client shall not hire any employee or freelancer who worked on the project.",
    ),
    h("9. ASSIGNMENT"),
    p(
      "9.1 The Designer may subcontract or assign any part of the work without the Client's consent. The Client may not assign this agreement.",
    ),
    h("10. DISPUTES"),
    p(
      "10.1 Any dispute shall be settled by an arbitrator chosen by the Designer, sitting at Kolkata.",
    ),
    p("Signed for Inkline Studio: Debashish Sen. Signed for Green Basket Organics: Farah Khan."),
  ],
};
