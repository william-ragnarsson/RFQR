// Server only: the Gmail API client for the demo inbox.
//
// Authorised with the refresh token in .env.local (OAuth app in Testing mode,
// gmail.modify scope). The inbox is a PERSONAL one: callers must only ever look
// at mail addressed to rfqAddress() (see inbox.ts).
//
// Only the Gmail module of googleapis is imported: it loads in ~40 ms instead of
// ~700 ms for the whole package, and a bundler does not pull in ~400 other APIs.
//
// Errors from googleapis carry the request config, which for a token refresh
// includes the client secret and the refresh token. Every API call therefore
// goes through gmailCall(), which rethrows a GmailError with a safe message and
// no `cause`, so printing an error can never leak a secret.

import { auth, gmail, type gmail_v1 } from "googleapis/build/src/apis/gmail";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

/** The address RFQs are sent to (RFQ_ADDRESS), lowercase. Only mail to it is processed. */
export function rfqAddress(): string {
  const address = requireEnv("RFQ_ADDRESS").toLowerCase();
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/.test(address)) {
    throw new Error("RFQ_ADDRESS is not a plain email address (e.g. you+rfq@gmail.com)");
  }
  return address;
}

let client: gmail_v1.Gmail | null = null;

export function getGmail(): gmail_v1.Gmail {
  if (client) return client;
  const oauth = new auth.OAuth2({
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
  });
  oauth.setCredentials({ refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN") });
  client = gmail({ version: "v1", auth: oauth });
  return client;
}

let accountEmail: Promise<string> | null = null;

/** The address of the authorised account (the "From" of replies), lowercase. */
export function getAccountEmail(): Promise<string> {
  accountEmail ??= gmailCall(() => getGmail().users.getProfile({ userId: "me" }))
    .then((res) => {
      const email = res.data.emailAddress?.toLowerCase();
      if (!email) throw new GmailError("Gmail profile has no email address", null, false);
      return email;
    })
    .catch((err) => {
      accountEmail = null; // allow a retry
      throw err;
    });
  return accountEmail;
}

/** A Gmail failure with a message that is safe to print (no secrets, no request data). */
export class GmailError extends Error {
  constructor(
    message: string,
    /** HTTP status, when the API answered. */
    readonly status: number | null,
    /** true when the credentials themselves were rejected (retrying will not help). */
    readonly authFailed: boolean,
  ) {
    super(message);
    this.name = "GmailError";
  }
}

/** Runs one Gmail API call and turns any failure into a GmailError. */
export async function gmailCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toGmailError(err);
  }
}

function toGmailError(err: unknown): GmailError {
  if (err instanceof GmailError) return err;
  const e = (err ?? {}) as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown; data?: unknown };
  };
  const rawStatus = e.status ?? e.response?.status;
  const status = typeof rawStatus === "number" ? rawStatus : null;
  const data = e.response?.data as { error?: unknown } | undefined;
  const oauthError = typeof data?.error === "string" ? data.error : typeof e.message === "string" ? e.message : "";

  if (oauthError === "invalid_grant" || oauthError.includes('"invalid_grant"')) {
    return new GmailError(
      "Gmail refresh token expired or revoked: create a new one (GOOGLE_REFRESH_TOKEN in .env.local)",
      status,
      true,
    );
  }
  if (oauthError === "invalid_client" || oauthError === "unauthorized_client") {
    return new GmailError(
      `Gmail OAuth client rejected (${oauthError}): check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET`,
      status,
      true,
    );
  }
  if (err instanceof Error && err.message.startsWith("Missing environment variable")) {
    return new GmailError(err.message, null, true);
  }

  const message = redact(typeof e.message === "string" && e.message ? e.message : String(err));
  const code = typeof e.code === "string" ? ` [${e.code}]` : "";
  const label = `Gmail API error${status ? ` ${status}` : ""}${code}`;
  return new GmailError(`${label}: ${message.slice(0, 300)}`, status, status === 401);
}

/** Belt and braces: never let a credential value through in a message. */
function redact(text: string): string {
  let out = text;
  for (const name of ["GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) {
    const secret = process.env[name]?.trim();
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/ya29\.[\w.-]+/g, "[redacted]"); // Google access tokens
}
