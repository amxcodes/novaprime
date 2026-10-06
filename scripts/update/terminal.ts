import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

export function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("UPDATE_INTERACTIVE_TERMINAL_REQUIRED");
  }
}

export async function promptLine(label: string, defaultValue?: string): Promise<string> {
  requireInteractiveTerminal();
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultValue === undefined ? "" : ` [${defaultValue}]`;
    const answer = (await prompt.question(`${label}${suffix}: `)).trim();
    return answer || defaultValue || "";
  } finally {
    prompt.close();
  }
}

export async function confirm(label: string): Promise<boolean> {
  const answer = await promptLine(`${label} (y/N)`, "n");
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

/** Read a secret without echoing it. Raw mode is restored on success, cancel, or error. */
export async function promptSecret(label: string): Promise<string> {
  requireInteractiveTerminal();
  const input = process.stdin;
  if (typeof input.setRawMode !== "function") {
    throw new Error("UPDATE_HIDDEN_SECRET_INPUT_UNAVAILABLE");
  }

  const wasRaw = input.isRaw;
  emitKeypressEvents(input);
  process.stdout.write(`${label}: `);
  input.setRawMode(true);
  input.resume();

  let value = "";
  try {
    return await new Promise<string>((resolve, reject) => {
      const onKeypress = (chunk: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
        if (key.ctrl && key.name === "c") {
          cleanup();
          reject(new Error("UPDATE_CANCELLED"));
          return;
        }
        if (key.name === "return" || key.name === "enter" || chunk === "\r" || chunk === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (key.name === "backspace" || key.name === "delete") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          return;
        }
        if (key.ctrl || !chunk || chunk < " ") return;
        value += chunk;
        process.stdout.write("•");
      };

      const cleanup = () => input.off("keypress", onKeypress);
      input.on("keypress", onKeypress);
    });
  } finally {
    input.setRawMode(wasRaw);
    if (!wasRaw) input.pause();
  }
}
