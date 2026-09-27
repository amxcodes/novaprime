import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { createEmailConnectionInput } from "./commands/email-connections.js";
import { EmailDeliveryError, sendEmail, supportedEmailProviders } from "./email-delivery.js";
import { decryptSecret, encryptSecret, isSecretsEncryptionKeyValid } from "./secrets.js";

const environment = {
  NOVA_SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
};

test("encrypts provider credentials without retaining plaintext", () => {
  const encrypted = encryptSecret('{"apiKey":"secret"}', environment);

  expect(encrypted.toString("utf8")).not.toContain("secret");
  expect(decryptSecret(encrypted, environment)).toBe('{"apiKey":"secret"}');
  expect(() => decryptSecret(encrypted, {
    NOVA_SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64url"),
  })).toThrow("SECRETS_CIPHERTEXT_INVALID");
});

test("accepts only a 32-byte base64url secret-encryption key", () => {
  expect(isSecretsEncryptionKeyValid(environment)).toBe(true);
  expect(isSecretsEncryptionKeyValid({
    NOVA_SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("hex"),
  })).toBe(false);
  expect(isSecretsEncryptionKeyValid({ NOVA_SECRETS_ENCRYPTION_KEY: "short" })).toBe(false);
});

test("accepts configured SMTP and rejects credentials on the console sink", () => {
  expect(createEmailConnectionInput({
    credentials: {
      host: "smtp.example.test",
      password: "provider-password",
      port: 587,
      secure: false,
      username: "mailer@example.test",
    },
    name: "Company SMTP",
    provider: "smtp",
    senderEmail: "noreply@example.test",
  })).toMatchObject({ provider: "smtp", senderEmail: "noreply@example.test" });

  expect(createEmailConnectionInput({
    credentials: { apiKey: "must-not-be-accepted" },
    name: "Local output",
    provider: "console",
    senderEmail: "noreply@example.test",
  })).toBeUndefined();
});

test("reports only providers supported by the active email runtime", () => {
  expect(supportedEmailProviders("node")).toEqual(["console", "smtp", "gmail_oauth2", "resend"]);
  expect(supportedEmailProviders("https")).toEqual(["gmail_oauth2", "resend"]);
});

test("sends Gmail through the HTTPS API with a send-only OAuth token", async () => {
  const previousFetch = globalThis.fetch;
  const previousRuntime = process.env.NOVA_EMAIL_RUNTIME;
  process.env.NOVA_EMAIL_RUNTIME = "https";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "test-access-token", expires_in: 3600 });
    }
    return Response.json({ id: "gmail-message-1", threadId: "gmail-thread-1" });
  }) as typeof fetch;

  try {
    const result = await sendEmail(
      {
        credentials: {
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          refreshToken: "test-refresh-token",
        },
        id: "gmail-connection-1",
        provider: "gmail_oauth2",
        replyToEmail: "support@example.test",
        senderEmail: "noreply@example.test",
      },
      {
        html: "<p>Héllo</p>",
        messageId: "<nova-test-1@example.test>",
        subject: "Café notice",
        text: "Héllo",
        to: "person@example.test",
      },
    );

    expect(result).toBe("gmail-message-1");
    expect(calls.map(({ url }) => url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    ]);
    const refreshForm = new URLSearchParams(String(calls[0]?.init?.body));
    expect(Object.fromEntries(refreshForm)).toEqual({
      client_id: "test-client-id",
      client_secret: "test-client-secret",
      grant_type: "refresh_token",
      refresh_token: "test-refresh-token",
    });
    const gmailHeaders = new Headers(calls[1]?.init?.headers);
    expect(gmailHeaders.get("authorization")).toBe("Bearer test-access-token");
    expect(gmailHeaders.get("content-type")).toBe("application/json");
    const raw = JSON.parse(String(calls[1]?.init?.body)).raw;
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("<nova-test-1@example.test>");
    expect(decoded).toContain("noreply@example.test");
    expect(decoded).toContain("support@example.test");
    expect(decoded).toContain("Caf=C3=A9_notice");
    expect(decoded).toContain("H=C3=A9llo");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRuntime === undefined) delete process.env.NOVA_EMAIL_RUNTIME;
    else process.env.NOVA_EMAIL_RUNTIME = previousRuntime;
  }
});

test("sanitizes Gmail OAuth and API failures", async () => {
  const previousFetch = globalThis.fetch;
  const previousRuntime = process.env.NOVA_EMAIL_RUNTIME;
  process.env.NOVA_EMAIL_RUNTIME = "https";
  const connection = {
    credentials: {
      clientId: "test-client-id",
      clientSecret: "never-expose-client-secret",
      refreshToken: "never-expose-refresh-token",
    },
    id: "gmail-connection-1",
    provider: "gmail_oauth2" as const,
    senderEmail: "noreply@example.test",
  };
  const message = { subject: "Test", text: "Body", to: "person@example.test" };

  try {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return Response.json({ error: "invalid_grant", error_description: "never-expose-refresh-token" }, { status: 400 });
    }) as unknown as typeof fetch;
    let tokenError: unknown;
    try { await sendEmail(connection, message); } catch (error) { tokenError = error; }
    expect(tokenError).toMatchObject({
      code: "EMAIL_PROVIDER_DELIVERY_FAILED",
      message: "EMAIL_PROVIDER_DELIVERY_FAILED",
    });
    expect(JSON.stringify(tokenError)).not.toContain("never-expose");
    expect(calls).toBe(1);

    calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls += 1;
      return String(input) === "https://oauth2.googleapis.com/token"
        ? Response.json({ access_token: "temporary-access-token" })
        : Response.json({ error: { message: "never-expose-provider-response" } }, { status: 403 });
    }) as unknown as typeof fetch;
    let apiError: unknown;
    try { await sendEmail(connection, message); } catch (error) { apiError = error; }
    expect(apiError).toMatchObject({
      code: "EMAIL_PROVIDER_DELIVERY_FAILED",
      message: "EMAIL_PROVIDER_DELIVERY_FAILED",
    });
    expect(JSON.stringify(apiError)).not.toContain("never-expose");
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRuntime === undefined) delete process.env.NOVA_EMAIL_RUNTIME;
    else process.env.NOVA_EMAIL_RUNTIME = previousRuntime;
  }
});

test("refuses SMTP password authentication when the server does not offer STARTTLS", async () => {
  const commands: string[] = [];
  const server = createServer((socket) => {
    let buffered = "";
    socket.write("220 nova-test ESMTP\r\n");
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      while (buffered.includes("\r\n")) {
        const separator = buffered.indexOf("\r\n");
        const line = buffered.slice(0, separator);
        buffered = buffered.slice(separator + 2);
        commands.push(line);
        if (/^EHLO\s/i.test(line)) {
          socket.write("250-nova-test\r\n250-SIZE 1048576\r\n250 HELP\r\n");
        } else if (line === "STARTTLS") {
          socket.write("454 TLS not available in this test sink\r\n");
        } else if (line === "QUIT") {
          socket.end("221 bye\r\n");
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SMTP_TEST_SERVER_ADDRESS_MISSING");

  try {
    await expect(sendEmail(
      {
        credentials: {
          host: "127.0.0.1",
          password: "never-send-this-over-cleartext",
          port: address.port,
          secure: false,
          username: "mailer@example.test",
        },
        id: "smtp-test-connection",
        provider: "smtp",
        senderEmail: "noreply@example.test",
      },
      { subject: "Local SMTP test", text: "Test body", to: "person@example.test" },
    )).rejects.toMatchObject({ code: "EMAIL_PROVIDER_DELIVERY_FAILED" });

    expect(commands.some((command) => /^AUTH\b/i.test(command))).toBe(false);
    expect(commands.some((command) => /^MAIL FROM:/i.test(command))).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("uses Resend idempotency and rejects a malformed success response", async () => {
  const previousFetch = globalThis.fetch;
  const seenHeaders: Headers[] = [];
  globalThis.fetch = (async (_input, init) => {
    seenHeaders.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ id: "resend-message-1" }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await sendEmail(
      {
        credentials: { apiKey: "re_test" },
        id: "connection-1",
        provider: "resend",
        senderEmail: "noreply@example.test",
      },
      {
        messageId: "<nova-outbox-1@local>",
        subject: "Test",
        text: "Body",
        to: "person@example.test",
      },
    );

    expect(result).toBe("resend-message-1");
    expect(seenHeaders[0]?.get("idempotency-key")).toBe("<nova-outbox-1@local>");
  } finally {
    globalThis.fetch = previousFetch;
  }

  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  try {
    await expect(sendEmail(
      {
        credentials: { apiKey: "re_test" },
        id: "connection-1",
        provider: "resend",
        senderEmail: "noreply@example.test",
      },
      { subject: "Test", text: "Body", to: "person@example.test" },
    )).rejects.toBeInstanceOf(EmailDeliveryError);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("blocks SMTP on the HTTPS-only runtime before attempting a connection", async () => {
  const previousRuntime = process.env.NOVA_EMAIL_RUNTIME;
  process.env.NOVA_EMAIL_RUNTIME = "https";
  try {
    await expect(sendEmail(
      {
        credentials: {
          host: "127.0.0.1",
          password: "never-use",
          port: 25,
          secure: false,
          username: "user",
        },
        id: "connection-1",
        provider: "smtp",
        senderEmail: "noreply@example.test",
      },
      { subject: "Test", text: "Body", to: "person@example.test" },
    )).rejects.toMatchObject({ code: "EMAIL_PROVIDER_UNSUPPORTED_IN_RUNTIME" });
  } finally {
    if (previousRuntime === undefined) delete process.env.NOVA_EMAIL_RUNTIME;
    else process.env.NOVA_EMAIL_RUNTIME = previousRuntime;
  }
});
