import { argv, env, exit } from "process";

interface PromptBlock {
  type: "text" | "image";
  text?: string;
  mimeType?: string;
  data?: string;
}

interface InputPayload {
  systemPrompt: string;
  prompt: PromptBlock[];
  authType?: string;
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

async function readStdin(): Promise<string> {
  return (await Bun.stdin.text()).trim();
}

async function main(): Promise<void> {
  const raw = await readStdin();
  if (!raw) {
    throw new Error("Missing ACP input payload");
  }

  const payload = JSON.parse(raw) as InputPayload;
  const proc = Bun.spawn(
    [
      env.QWEN_CLI_BIN || "qwen",
      "--acp",
      "--auth-type",
      payload.authType || env.QWEN_CLI_AUTH_TYPE || "qwen-oauth",
      "--system-prompt",
      payload.systemPrompt,
    ],
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    }
  );

  const decoder = new TextDecoder();
  let nextId = 1;
  let stdoutBuffer = "";
  let stderrText = "";
  let agentText = "";
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  const send = (message: Record<string, unknown>) => {
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };

  const request = <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    const id = nextId++;
    send({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const handleIncoming = (message: Record<string, any>) => {
    if (typeof message.id !== "undefined" && ("result" in message || "error" in message)) {
      const key = Number(message.id);
      const entry = pending.get(key);
      if (!entry) return;
      pending.delete(key);
      if (message.error) {
        entry.reject(new Error(message.error.message ?? "ACP request failed"));
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    if (typeof message.method !== "string") return;

    if (message.method === "session/update") {
      const update = message.params?.update;
      if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
        agentText += update.content.text ?? "";
      }
      return;
    }

    if (message.method === "session/request_permission") {
      send({
        id: message.id,
        result: {
          outcome: {
            outcome: "cancelled",
          },
        },
      });
      return;
    }

    send({
      id: message.id,
      error: {
        code: -32601,
        message: `Unsupported client method: ${message.method}`,
      },
    });
  };

  const stdoutLoop = (async () => {
    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stdoutBuffer += decoder.decode(value, { stream: true });
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          handleIncoming(JSON.parse(trimmed));
        }
      }
    } finally {
      reader.releaseLock();
    }
  })();

  const stderrLoop = (async () => {
    const reader = proc.stderr.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stderrText += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  })();

  const withTimeout = <T>(promise: Promise<T>, label: string) =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Qwen ACP timeout during ${label}`)), 45000)
      ),
    ]);

  const shutdown = async () => {
    try {
      proc.kill();
    } catch {
      // ignore cleanup errors
    }
    await Promise.race([
      proc.exited.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  };

  try {
    await withTimeout(
      request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: "droidclaw",
          version: "1.0.0",
        },
      }),
      "initialize"
    );

    const newSession = await withTimeout<{ sessionId: string }>(
      request("session/new", {
        cwd: argv[2] || process.cwd(),
        mcpServers: [],
      }),
      "session/new"
    );

    await withTimeout(
      request("session/prompt", {
        sessionId: newSession.sessionId,
        prompt: payload.prompt,
      }),
      "session/prompt"
    );

    if (!agentText.trim()) {
      throw new Error(stderrText.trim() || "Qwen ACP returned no assistant text");
    }

    console.log(stripMarkdownFences(agentText));
    await shutdown();
    exit(0);
  } catch (error) {
    await shutdown();
    console.error(
      error instanceof Error
        ? stderrText.trim()
          ? `${error.message}\n${stderrText.trim()}`
          : error.message
        : String(error)
    );
    exit(1);
  }
}

await main();
