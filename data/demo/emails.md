# Live demo: emails to send

During the demo, a friend sends an RFQ from their own email account and RFQR answers it.

## Before you send

- Send to **william.ragnarsson+rfq@gmail.com**, with the `+rfq` part. RFQR only reads mail sent to that exact address.
  - Mail to the plain address (william.ragnarsson@gmail.com) goes to William's personal inbox. RFQR ignores it on purpose.
- Attach the PDF named in the scenario. William sends you the three PDFs beforehand (they are in `data/demo/pdfs/` in the repo).
- Paste the body exactly as written, including the company line in the signature. RFQR reads the customer's company from the email and the PDF.
- Turn off your email signature for these emails. A second company name in the email can make RFQR ask which company the order is for.
- Send each email only after `npm run watch` is running. RFQR ignores mail that arrived before it started.
- The reply goes to your address and starts with "Hi" plus the first name on your email account. If your account has no display name, it starts with "Hi there".
- If nothing happens within a minute, William checks his **Spam** folder. RFQR never reads Spam, so a message there has to be marked "Not spam" and sent again.

## 1. Complete order, in stock

- **Subject:** `RFQ - 304 stainless sheets`
- **Attach:** `ridgeway-spec-RF-MS-0412.pdf`
- **Body:**

```
Hi Thomas,

We'd like to order 40 sheets of 304 stainless. The full material specification is in the attached PDF.

Could you confirm availability and price?

Kind regards,
Laura Chen
Purchasing, Ridgeway Fabrication
```

**Expected:** the order form fills completely (10 of 10 fields) and 120 sheets are in stock. The reply is an **order confirmation**: 40 x 182.40 = **7,296.00 USD**. It acknowledges the requested delivery date of 2026-10-30 and does not promise it.

## 2. Missing information

- **Subject:** `RFQ - 304 sheet`
- **Attach:** `davies-spec-DMW-118.pdf`
- **Body:**

```
Hello,

Please quote 25 sheets of 304 sheet per the attached spec.

Thanks,
Mark Davies
Davies Marine Works
```

**Expected:** 8 of 10 fields are filled. **Thickness** is missing because the spec only says "Per drawing D-2231", and **Finish** is missing too. The stock check is skipped, and the reply is a **clarifying question** asking for those two values.

## 3. Not enough stock

- **Subject:** `RFQ - 316L sheets for new line`
- **Attach:** `coastal-spec-CFE-2026-07.pdf`
- **Body:**

```
Hi Thomas,

We need 200 sheets of 316L for a new food-processing line. Spec attached. Delivery within two weeks if possible.

Best,
Priya Nair
Head of Procurement, Coastal Food Equipment
```

**Expected:** the order form fills completely, but only **35 of the 200** sheets are in stock. The reply says **we can't fulfil the full order** and offers the 35 we have: 35 x 899.00 = **31,465.00 USD**.

## Running it (William)

1. `npm run gmail:check`: checks that the Gmail token works and shows the RFQ address.
2. `npm run watch`: start it before your friend sends anything. Each new RFQ prints the run step by step, then the order form, the stock check and the reply draft.
3. At `Send this reply to …? [y/N]`, type `y` and press Enter to send. Anything else, including just Enter, means nothing is sent.
4. Press Ctrl+C to stop. To rehearse without sending anything, run `npm run watch -- --dry-run`.
