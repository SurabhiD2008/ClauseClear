// Original text written for ClauseClear tests. The service and company are fictional.
// Every terms-of-service category in SPEC section 8 is present, and several are written
// to be flagged. No data deletion route or complaint contact is given (part of "Missing basics").
import { h, p, title, type DocumentSpec } from "./layout.js";

export const terms: DocumentSpec = {
  title: "Pixelnest Terms of Service",
  header: "Pixelnest Terms of Service - Last updated 1 August 2026",
  pageNumbers: true,
  blocks: [
    title("PIXELNEST TERMS OF SERVICE"),
    p(
      "These Terms of Service (the Terms) govern your use of the Pixelnest mobile application, website and related services (the Service), provided by Pixelnest Media Private Limited (Pixelnest, we or us). By creating an account, clicking I agree, or using the Service in any way, you accept these Terms. If you do not agree, do not use the Service.",
    ),
    h("1. ELIGIBILITY AND ACCOUNTS"),
    p(
      "1.1 You must be at least 18 years old to use the Service. You are responsible for everything that happens under your account, and you must keep your password secret.",
    ),
    h("2. SUBSCRIPTIONS AND AUTO-RENEWAL"),
    p(
      "2.1 Pixelnest Plus is offered as a monthly or annual subscription. Your subscription renews automatically at the end of each period at the then current price, and we will charge your saved payment method without further notice.",
    ),
    p(
      "2.2 To cancel, you must send a written request by registered post to our office at least thirty days before the renewal date. Cancellation through the app, email or customer chat is not accepted.",
    ),
    h("3. FEES AND REFUNDS"),
    p(
      "3.1 All fees are non-refundable, including for partial periods, unused features, accidental purchases, or if your account is suspended or terminated.",
    ),
    h("4. YOUR CONTENT"),
    p(
      "4.1 You keep ownership of the photos, videos, comments and other material you upload (Your Content). However, by uploading Your Content you grant Pixelnest a worldwide, perpetual, irrevocable, royalty-free, transferable and sublicensable licence to use, copy, modify, publish, sell and create derivative works from Your Content in any media, for any purpose, including advertising, without any payment or notice to you.",
    ),
    p("4.2 This licence continues even after you delete Your Content or close your account."),
    h("5. PRIVACY AND DATA"),
    p(
      "5.1 We collect information you give us and information collected automatically, including your contacts, precise location, device identifiers, browsing activity inside and outside the Service, photos and microphone input when the app is open.",
    ),
    p(
      "5.2 We may share any of this information with our affiliates, advertisers, analytics providers and other third parties for any business purpose, including targeted advertising and the sale of aggregated or individual data.",
    ),
    h("6. ACCEPTABLE USE"),
    p(
      "6.1 You will not use the Service to post unlawful, harmful or misleading material, to harass others, to infringe anyone's rights, or to interfere with the Service or its security.",
    ),
    h("7. ACCOUNT SUSPENSION AND TERMINATION"),
    p(
      "7.1 We may suspend or terminate your account, or remove any of Your Content, at any time, for any reason or no reason, without notice and without any refund of fees paid.",
    ),
    h("8. CHANGES TO THESE TERMS"),
    p(
      "8.1 We may change these Terms at any time by posting a revised version on our website. Changes take effect immediately, and your continued use of the Service means you accept them. We are not required to notify you of any change.",
    ),
    h("9. DISCLAIMERS"),
    p(
      "9.1 The Service is provided as is and as available, without any warranty of any kind. We do not promise that the Service will be uninterrupted, secure or free of errors, or that Your Content will not be lost.",
    ),
    h("10. LIMITATION OF LIABILITY"),
    p(
      "10.1 To the fullest extent permitted, Pixelnest shall not be liable for any loss or damage of any kind arising from your use of the Service, including loss of data, loss of income, or personal injury. In any case our total liability to you shall not exceed Rs. 100.",
    ),
    h("11. INDEMNITY"),
    p(
      "11.1 You agree to indemnify and hold harmless Pixelnest, its directors, employees and partners from any claim, loss, liability, penalty or expense, including legal fees, arising from or connected with your use of the Service, Your Content, or any breach of these Terms, whether or not caused by you.",
    ),
    h("12. ARBITRATION AND CLASS ACTION WAIVER"),
    p(
      "12.1 Any dispute between you and Pixelnest shall be resolved only by binding individual arbitration, and you give up your right to go to court or to have a jury decide your claim. You also waive any right to bring or join a class action or representative proceeding against Pixelnest.",
    ),
    h("13. GOVERNING LAW AND FORUM"),
    p(
      "13.1 These Terms are governed by the laws of Singapore. The arbitration shall be seated in Singapore, and you agree to travel there for any hearing at your own cost.",
    ),
    h("14. GENERAL"),
    p(
      "14.1 We may assign these Terms to any other company without your consent. If any part of these Terms is found unenforceable, the rest remains in effect. These Terms are the entire agreement between you and Pixelnest about the Service.",
    ),
    p("14.2 Our failure to enforce any right under these Terms is not a waiver of that right."),
    p("Thank you for using Pixelnest."),
  ],
};
