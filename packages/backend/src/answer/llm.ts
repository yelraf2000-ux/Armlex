/**
 * THE GENERATION SEAM.
 *
 * The spec asks for generation to sit behind an `LLM` interface; until now
 * `chat.ts` called Anthropic directly, so every model experiment was a code
 * change and a revert. Model choice is now a config value, which is what makes
 * A/B testing cheap enough to actually do.
 *
 * Streaming is the only mode. One code path, not two: the quote gate runs on
 * the stream, and a batch path would leave the guarantee that matters most as
 * the one with the least coverage.
 *
 * Set GENERATION_MODEL to switch. Measured on 3 questions, same prompt and
 * articles (see eval/compare-generators.ts):
 *
 *   claude-sonnet-5         48.7s   0 bad quotes   0 language errors
 *   gemini-3.5-flash-lite    3.0s   2 bad quotes   1 language error
 *
 * Flash-Lite's failures were act titles wrapped in « », not fabricated law —
 * a prompt-adherence gap rather than a grounding one. Judge with the golden
 * set and a native reader before switching the default.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface GenerateOptions {
  system: string;
  /** Prior turns, oldest first. */
  history: { role: 'user' | 'assistant'; content: string }[];
  user: string;
  onText: (delta: string) => void;
}

export interface GenerateResult {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export const DEFAULT_MODEL = process.env['GENERATION_MODEL'] ?? 'claude-sonnet-5';

const isGemini = (model: string): boolean => model.startsWith('gemini');

async function generateAnthropic(model: string, o: GenerateOptions): Promise<GenerateResult> {
  const client = new Anthropic();

  // Prompt caching is a PREFIX match, so layout is what makes it work: the
  // stable system prompt and append-only history are cached, and only this
  // turn's message and freshly retrieved chunks sit in the volatile tail.
  const history: Anthropic.MessageParam[] = o.history.map((t, i) => ({
    role: t.role,
    content: [
      {
        type: 'text' as const,
        text: t.content,
        ...(i === o.history.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
      },
    ],
  }));

  const stream = client.messages.stream({
    model,
    max_tokens: 16000,
    system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium' },
    messages: [...history, { role: 'user' as const, content: o.user }],
  });

  stream.on('text', o.onText);
  const res = await stream.finalMessage();

  return {
    model: res.model,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: res.usage.cache_creation_input_tokens ?? 0,
  };
}

async function generateGemini(model: string, o: GenerateOptions): Promise<GenerateResult> {
  const key = process.env['GEMINI_API_KEY'];
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const contents = [
    ...o.history.map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }],
    })),
    { role: 'user', parts: [{ text: o.user }] },
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: o.system }] },
        contents,
        // Generous, because Gemini 3.x spends part of this budget reasoning
        // before it writes. Set too low, the answer arrives truncated
        // mid-sentence — observed at 4000, which produced 300-character
        // fragments and no COVERAGE line.
        generationConfig: { maxOutputTokens: 16000 },
      }),
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  let usage = { promptTokenCount: 0, candidatesTokenCount: 0 };
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(part, { stream: true });
    // Gemini separates SSE frames with CRLFCRLF, not LFLF. Splitting on '\n\n'
    // silently never matches: the buffer grows forever and not one token is
    // emitted — observed as a completely empty answer with HTTP 200.
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split(/\r?\n/).find((l) => l.startsWith('data: '));
      if (!line) continue;
      const json = JSON.parse(line.slice(6)) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      for (const p of json.candidates?.[0]?.content?.parts ?? []) {
        if (p.text) o.onText(p.text);
      }
      if (json.usageMetadata) {
        usage = {
          promptTokenCount: json.usageMetadata.promptTokenCount ?? usage.promptTokenCount,
          candidatesTokenCount:
            json.usageMetadata.candidatesTokenCount ?? usage.candidatesTokenCount,
        };
      }
    }
  }

  return {
    model,
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    // Gemini caching is explicit and not used here; reporting 0 rather than
    // omitting keeps the shape identical across providers.
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

export async function generate(o: GenerateOptions, model = DEFAULT_MODEL): Promise<GenerateResult> {
  return isGemini(model) ? generateGemini(model, o) : generateAnthropic(model, o);
}
