import { loadConfig } from "../app/config.js";

export type JsonSchema = Record<string, unknown>;
export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  thinking?: string;
};

export type LlmTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (args: Record<string, unknown>) => Promise<string>;
};

export type LlmStatus = {
  enabled: boolean;
  mode: "disabled" | "ollama" | "openai-compatible";
  provider: string;
  model: string;
  base_url: string;
  think: boolean;
  max_tool_rounds: number;
  timeout_ms: number;
  recommended_model: string;
};

export type ToolLoopResult = {
  messages: ChatMessage[];
  executed_calls: Array<{ name: string; args: Record<string, unknown> }>;
  rounds: number;
  final_text: string;
};

type ProviderReply = {
  content: string;
  thinking?: string;
  tool_calls: ToolCall[];
};

function parseToolArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function toToolCalls(input: unknown): ToolCall[] {
  if (!Array.isArray(input)) return [];
  return input.map((item, idx) => {
    const record = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const fn = (record.function && typeof record.function === "object" ? record.function : {}) as Record<string, unknown>;
    return {
      id: String(record.id ?? `call_${idx + 1}`),
      name: String(fn.name ?? record.name ?? "unknown_tool"),
      arguments: parseToolArgs(fn.arguments ?? record.arguments),
    };
  });
}

function serializeTools(tools: LlmTool[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function serializeMessagesForOllama(messages: ChatMessage[]): unknown[] {
  return messages.map((msg) => {
    const out: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };
    if (msg.role === "tool" && msg.tool_name) out.tool_name = msg.tool_name;
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      out.tool_calls = msg.tool_calls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      }));
    }
    if (msg.thinking) out.thinking = msg.thinking;
    return out;
  });
}

function serializeMessagesForOpenAi(messages: ChatMessage[]): unknown[] {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool",
        content: msg.content,
        tool_call_id: msg.tool_call_id,
      };
    }
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      return {
        role: "assistant",
        content: msg.content,
        tool_calls: msg.tool_calls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        })),
      };
    }
    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

async function postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<any> {
  const cfg = loadConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.llm.timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${response.statusText} :: ${text.slice(0, 500)}`);
  }
  return response.json();
}

async function chatOllama(messages: ChatMessage[], tools?: LlmTool[], format?: JsonSchema): Promise<ProviderReply> {
  const cfg = loadConfig();
  const body: Record<string, unknown> = {
    model: cfg.llm.model,
    messages: serializeMessagesForOllama(messages),
    stream: false,
    options: {
      temperature: cfg.llm.temperature,
    },
  };
  if (cfg.llm.think) body.think = true;
  if (tools?.length) body.tools = serializeTools(tools);
  if (format) body.format = format;

  const data = await postJson(`${cfg.llm.baseUrl}/api/chat`, body);
  return {
    content: String(data?.message?.content ?? ""),
    thinking: typeof data?.message?.thinking === "string" ? data.message.thinking : undefined,
    tool_calls: toToolCalls(data?.message?.tool_calls),
  };
}

async function chatOpenAiCompatible(messages: ChatMessage[], tools?: LlmTool[]): Promise<ProviderReply> {
  const cfg = loadConfig();
  const headers: Record<string, string> = {};
  if (cfg.llm.apiKey) headers.Authorization = `Bearer ${cfg.llm.apiKey}`;

  const body: Record<string, unknown> = {
    model: cfg.llm.model,
    messages: serializeMessagesForOpenAi(messages),
    temperature: cfg.llm.temperature,
  };
  if (tools?.length) {
    body.tools = serializeTools(tools);
    body.tool_choice = "auto";
    body.parallel_tool_calls = false;
  }

  const data = await postJson(`${cfg.llm.baseUrl.replace(/\/$/, "")}/chat/completions`, body, headers);
  const message = data?.choices?.[0]?.message ?? {};
  return {
    content: String(message?.content ?? ""),
    tool_calls: toToolCalls(message?.tool_calls),
  };
}

async function chatProvider(messages: ChatMessage[], tools?: LlmTool[], format?: JsonSchema): Promise<ProviderReply> {
  const cfg = loadConfig();
  if (cfg.llm.mode === "ollama") return chatOllama(messages, tools, format);
  if (cfg.llm.mode === "openai-compatible") return chatOpenAiCompatible(messages, tools);
  throw new Error("LLM is disabled");
}

export function getLlmStatus(): LlmStatus {
  const cfg = loadConfig();
  const provider = cfg.llm.mode === "ollama" ? "Ollama" : cfg.llm.mode === "openai-compatible" ? "OpenAI-compatible" : "disabled";
  return {
    enabled: cfg.llm.mode !== "disabled",
    mode: cfg.llm.mode,
    provider,
    model: cfg.llm.model,
    base_url: cfg.llm.baseUrl,
    think: cfg.llm.think,
    max_tool_rounds: cfg.llm.maxToolRounds,
    timeout_ms: cfg.llm.timeoutMs,
    recommended_model: cfg.llm.mode === "ollama" ? "qwen3:30b" : "Qwen/Qwen3-30B-A3B-Instruct-2507",
  };
}

export async function runToolLoop(messages: ChatMessage[], tools: LlmTool[]): Promise<ToolLoopResult> {
  const cfg = loadConfig();
  const workingMessages = [...messages];
  const executed_calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let final_text = "";

  for (let round = 1; round <= cfg.llm.maxToolRounds; round++) {
    const reply = await chatProvider(workingMessages, tools);
    workingMessages.push({
      role: "assistant",
      content: reply.content,
      tool_calls: reply.tool_calls,
      thinking: reply.thinking,
    });

    if (!reply.tool_calls.length) {
      final_text = reply.content.trim();
      return { messages: workingMessages, executed_calls, rounds: round, final_text };
    }

    for (const call of reply.tool_calls) {
      const tool = tools.find((item) => item.name === call.name);
      const result = tool ? await tool.execute(call.arguments) : JSON.stringify({ error: `unknown tool: ${call.name}` });
      executed_calls.push({ name: call.name, args: call.arguments });
      workingMessages.push({
        role: "tool",
        tool_name: call.name,
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return {
    messages: workingMessages,
    executed_calls,
    rounds: cfg.llm.maxToolRounds,
    final_text,
  };
}

export async function requestStructuredJson<T>(messages: ChatMessage[], schema: JsonSchema): Promise<T> {
  const cfg = loadConfig();
  if (cfg.llm.mode === "disabled") throw new Error("LLM is disabled");

  if (cfg.llm.mode === "ollama") {
    const reply = await chatProvider(messages, undefined, schema);
    return JSON.parse(reply.content) as T;
  }

  const reply = await chatProvider(
    [
      ...messages,
      {
        role: "user",
        content: `Return JSON only. It must satisfy this schema exactly:\n${JSON.stringify(schema, null, 2)}`,
      },
    ],
    undefined
  );
  return JSON.parse(reply.content) as T;
}
