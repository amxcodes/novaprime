import { sendEmail } from "../server/src/email-delivery.js";

export default {
  async fetch(): Promise<Response> {
    const previousRuntime = process.env.NOVA_EMAIL_RUNTIME;
    const realFetch = globalThis.fetch;
    process.env.NOVA_EMAIL_RUNTIME = "https";

    let accessTokenForm: URLSearchParams | undefined;
    let gmailRequest: { headers: Headers; raw: string } | undefined;
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        accessTokenForm = new URLSearchParams(String(init?.body ?? ""));
        return Response.json({ access_token: "synthetic-worker-access-token" });
      }
      if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
        const body = JSON.parse(String(init?.body ?? "")) as { raw?: unknown };
        gmailRequest = {
          headers: new Headers(init?.headers),
          raw: typeof body.raw === "string" ? body.raw : "",
        };
        return Response.json({ id: "synthetic-worker-message-id" });
      }
      return new Response(null, { status: 502 });
    };

    try {
      const result = await sendEmail(
        {
          credentials: {
            clientId: "synthetic-worker-client-id",
            clientSecret: "synthetic-worker-client-secret",
            refreshToken: "synthetic-worker-refresh-token",
          },
          id: "worker-email-smoke",
          provider: "gmail_oauth2",
          replyToEmail: "support@example.test",
          senderEmail: "noreply@example.test",
        },
        {
          html: "<p>worker-local-gmail-mime</p>",
          messageId: "<nova-worker-smoke@example.test>",
          subject: "NOVA Worker MIME smoke",
          text: "worker-local-gmail-mime",
          to: "person@example.test",
        },
      );

      const decodedMessage = gmailRequest?.raw
        ? Buffer.from(
          gmailRequest.raw.replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        ).toString("utf8")
        : "";
      const checks = {
        usesHttpsOnly: calls.length === 2 && calls.every((url) => url.startsWith("https://")),
        refreshesOAuthToken: calls[0] === "https://oauth2.googleapis.com/token"
          && accessTokenForm?.get("grant_type") === "refresh_token"
          && accessTokenForm.get("client_secret") === "synthetic-worker-client-secret"
          && accessTokenForm.get("refresh_token") === "synthetic-worker-refresh-token",
        sendsWithBearer: calls[1] === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
          && gmailRequest?.headers.get("authorization") === "Bearer synthetic-worker-access-token",
        composesMIMEWithNodeStreams: decodedMessage.includes("<nova-worker-smoke@example.test>")
          && decodedMessage.includes("noreply@example.test")
          && decodedMessage.includes("support@example.test")
          && decodedMessage.includes("NOVA Worker MIME smoke")
          && decodedMessage.includes("worker-local-gmail-mime"),
        receivesProviderMessageId: result === "synthetic-worker-message-id",
      };

      return Response.json({ ok: Object.values(checks).every(Boolean), checks }, {
        status: Object.values(checks).every(Boolean) ? 200 : 500,
      });
    } catch (error) {
      return Response.json({
        ok: false,
        error: error instanceof Error ? error.message : "WORKER_EMAIL_SMOKE_FAILED",
      }, { status: 500 });
    } finally {
      globalThis.fetch = realFetch;
      if (previousRuntime === undefined) delete process.env.NOVA_EMAIL_RUNTIME;
      else process.env.NOVA_EMAIL_RUNTIME = previousRuntime;
    }
  },
};
