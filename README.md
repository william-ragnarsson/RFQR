# RFQR

RFQ email in, reply draft out: a demo that reads a steel buyer's request for
quote (the email and its PDF spec sheet), fills an order form, checks stock and
drafts a reply that a person approves before it is sent.

The canvas UI runs on `npm run dev` at [http://localhost:3000](http://localhost:3000).

## Running the real pipeline (Phase 2)

1. Copy `.env.example` to `.env.local` and fill it in. Never commit `.env.local`.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN`: an OAuth client and a refresh token for the demo inbox, with the `gmail.modify` scope.
   - `NICRRON_API_KEY`: the LLM gateway key.
   - `RFQ_ADDRESS`: the only address RFQR reads mail for (e.g. `you+rfq@gmail.com`).
2. `npm run demo:local`: runs the three demo scenarios with the real AI readers on local files. No Gmail involved.
3. `npm run gmail:check`: read-only. Checks the Gmail token and lists the RFQ emails of the last 7 days.
4. `npm run watch`: watches `RFQ_ADDRESS` and runs every new RFQ. Each reply is sent only after you type `y` at the prompt.
   - `npm run watch -- --dry-run` never sends anything.
   - `npm run watch -- --since 30` also picks up RFQs from the last 30 minutes.

`data/demo/emails.md` has the emails to send during the live demo.
