import ollama from 'ollama';
import { get_encoding } from 'tiktoken';

interface GenerateOptions<TResult> {
  model: string;
  system: string;
  prompt: string;
  retries?: number;
  parser: (response: string) => TResult | Promise<TResult>;
}

const timeout = Symbol('timeout');

export async function generate<TResult>({
  retries = 3,
  ...options
}: GenerateOptions<TResult>): Promise<TResult> {
  const prompt = `${options.system}\n\n${options.prompt}\n\n`;

  const enc = get_encoding('gpt2');
  const approximateTokens = enc.encode(prompt).length;
  enc.free();

  if (approximateTokens > 3500) {
    throw new Error('Prompt may exceed context length.');
  }

  ollama.abort();

  const result = await Promise.race([
    new Promise<typeof timeout>((resolve) =>
      setTimeout(() => resolve(timeout), 30 * 1000),
    ),
    ollama.generate({
      model: options.model,
      prompt,
    }),
  ]);

  if (result === timeout) {
    if (retries > 0) {
      console.warn(`Model timed out. Retrying… (retries left: ${retries})`);
      return generate({ ...options, retries: retries - 1 });
    }

    throw new Error('Model timed out. Out of retries.');
  }

  try {
    return await options.parser(result.response);
  } catch (error) {
    if (retries) {
      return generate({ ...options, retries: retries - 1 });
    }

    throw new Error('Response failed to parse', {
      cause: error,
    });
  }
}

export async function generateWithConsensus<TResult>(
  options: GenerateOptions<TResult>,
) {
  const counts: Record<string, number> = {};

  while (Object.values(counts).every((value) => value < 2)) {
    const result = JSON.stringify(await generate(options));
    counts[result] = counts[result] + 1;
  }

  const consensus = Object.entries(counts).sort(
    ([_keyA, valueA], [_keyB, valueB]) => valueB - valueA,
  )[0][0];

  return JSON.parse(consensus) as TResult;
}
