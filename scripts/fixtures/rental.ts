// Original text written for ClauseClear tests. Names, addresses and figures are fictional.
// Every rental category in SPEC section 8 is present, and several are written to be flagged.
// Stamp duty and registration is left out on purpose (a "missing" category).
import { h, i, p, title, type DocumentSpec } from "./layout.js";

export const rental: DocumentSpec = {
  title: "Leave and License Agreement",
  header: "Leave and License Agreement - Flat 402, Neem Tower",
  pageNumbers: true,
  blocks: [
    title("LEAVE AND LICENSE AGREEMENT"),
    p(
      "This Leave and License Agreement is made at Pune on the 1st day of June 2026 between Mr. Arvind Kelkar, residing at 17 Lotus Lane, Kothrud, Pune, hereinafter called the Licensor, and Ms. Meera Joshi, residing at 9 Station Road, Nashik, hereinafter called the Licensee. The Licensor and the Licensee are together called the parties.",
    ),
    p(
      "WHEREAS the Licensor is the owner of Flat No. 402, fourth floor, Neem Tower, Baner, Pune (the premises), and the Licensee has asked to use the premises for residential purposes only, the parties agree as follows.",
    ),
    h("1. TERM"),
    p(
      "1.1 The license is granted for a period of eleven months starting on 1 July 2026 and ending on 31 May 2027, unless it is ended earlier under this agreement.",
    ),
    p(
      "1.2 The first six months of the term are a lock-in period. If the Licensee leaves the premises during the lock-in period for any reason, the entire security deposit shall stand forfeited, and the Licensee shall in addition pay the license fee for the full remaining term of the agreement.",
    ),
    h("2. LICENSE FEE"),
    p(
      "2.1 The Licensee shall pay a monthly license fee of Rs. 28,000 on or before the 5th day of each calendar month by bank transfer to the account named by the Licensor.",
    ),
    p(
      "2.2 The license fee shall increase automatically on the first day of every third month by such amount as the Licensor may decide and communicate to the Licensee.",
    ),
    p(
      "2.3 If any payment is late, the Licensee shall pay a late fee of Rs. 500 for every day of delay, and the unpaid late fee shall itself attract the same daily charge until the whole amount is cleared.",
    ),
    h("3. SECURITY DEPOSIT"),
    p(
      "3.1 The Licensee has paid an interest-free security deposit of Rs. 2,80,000, being ten months of license fee, which the Licensor acknowledges.",
    ),
    p(
      "3.2 The deposit shall be returned after the Licensee hands over vacant possession, after deducting any amounts the Licensor considers appropriate for damage, cleaning, painting, pending dues or any other reason. The Licensor shall return the balance, if any, within a reasonable time.",
    ),
    h("4. USE OF THE PREMISES"),
    p(
      "4.1 The Licensee shall use the premises only as a private residence for herself and her immediate family and for no commercial purpose.",
    ),
    p(
      "4.2 The Licensee shall not sublet, assign or part with the premises or any part of it. No guest may stay overnight at the premises without the prior written consent of the Licensor, and every breach of this condition shall attract a penalty of Rs. 5,000 per guest per night.",
    ),
    p(
      "4.3 The Licensee shall follow the rules of the Neem Tower Co-operative Housing Society and shall not keep any pet animal in the premises.",
    ),
    h("5. MAINTENANCE AND REPAIRS"),
    p(
      "5.1 The Licensee shall keep the premises clean and in good condition, fair wear and tear excepted.",
    ),
    p(
      "5.2 All repairs to the premises of whatever nature, including structural repairs, plumbing, electrical wiring, seepage, and the replacement of fittings and appliances supplied by the Licensor, shall be carried out by the Licensee at her own cost.",
    ),
    p(
      "5.3 The Licensee shall not make any alteration or addition to the premises without the written consent of the Licensor.",
    ),
    h("6. ENTRY AND INSPECTION"),
    p(
      "6.1 The Licensor or any person authorised by him may enter the premises at any time, with or without notice, to inspect the premises, show it to prospective buyers or licensees, or carry out any work he thinks fit.",
    ),
    h("7. UTILITIES AND CHARGES"),
    p(
      "7.1 Electricity charges as per the separate meter shall be paid by the Licensee directly to the supply company.",
    ),
    p(
      "7.2 Water charges, society maintenance, parking charges, property tax and any other outgoings shall be paid as may be agreed between the parties from time to time.",
    ),
    h("8. TERMINATION"),
    p(
      "8.1 The Licensee may end this agreement after the lock-in period by giving the Licensor three months notice in writing.",
    ),
    p(
      "8.2 The Licensor may end this agreement at any time by giving the Licensee seven days notice in writing, without giving any reason.",
    ),
    p(
      "8.3 On the expiry or termination of the license the Licensee shall hand over vacant and peaceful possession of the premises with all fittings listed in the Schedule.",
    ),
    p(
      "8.4 If the Licensee fails to hand over possession on the due date, she shall pay damages of Rs. 3,000 for each day of delay, without prejudice to the other rights of the Licensor.",
    ),
    h("9. RENEWAL"),
    p(
      "9.1 The agreement may be renewed for a further term on such terms as the Licensor may decide at the time. The Licensor is under no obligation to renew, and the Licensee shall accept the terms offered or vacate the premises.",
    ),
    h("10. NO TENANCY"),
    p(
      "10.1 The parties agree that this is a license only, and nothing in it creates a tenancy or any other interest in the premises in favour of the Licensee.",
    ),
    h("11. NOTICES"),
    p(
      "11.1 Any notice under this agreement shall be in writing and sent by registered post or email to the addresses given above, or to any other address a party notifies in writing.",
    ),
    h("12. DISPUTES"),
    p(
      "12.1 Any dispute between the parties about this agreement shall be subject to the courts at Pune only.",
    ),
    h("SCHEDULE OF FITTINGS"),
    i("(a) Two ceiling fans in each bedroom and one in the living room."),
    i("(b) One double-door refrigerator and one washing machine, both in working condition."),
    i("(c) Modular kitchen with a chimney and a two-burner hob."),
    i("(d) Wardrobes in both bedrooms with keys."),
    i("(e) Six tube lights and four LED bulbs with fittings."),
    p("IN WITNESS WHEREOF the parties have signed this agreement on the date first written above."),
    p("Signed by the Licensor: Arvind Kelkar. Signed by the Licensee: Meera Joshi."),
    p("Witness 1: Sunil Pawar, Baner, Pune. Witness 2: Kavita Rane, Aundh, Pune."),
  ],
};
