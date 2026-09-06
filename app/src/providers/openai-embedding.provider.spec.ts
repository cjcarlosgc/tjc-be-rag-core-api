import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    embeddings = { create: createMock };
  },
}));

const { OpenAiEmbeddingProvider } = await import('./openai-embedding.provider.js');

function makeConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    OPENAI_API_KEY: 'sk-test',
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_DIMENSIONS: 1536,
    ...overrides,
  };
  return { get: (key: string, defaultValue?: unknown) => values[key] ?? defaultValue } as never;
}

describe('OpenAiEmbeddingProvider', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('requests embeddings for every input and preserves order', async () => {
    createMock.mockResolvedValue({
      data: [
        { index: 1, embedding: [0.2] },
        { index: 0, embedding: [0.1] },
      ],
    });

    const provider = new OpenAiEmbeddingProvider(makeConfigService());
    const result = await provider.embedMany(['a', 'b']);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'text-embedding-3-small', input: ['a', 'b'], dimensions: 1536 }),
    );
    expect(result).toEqual([[0.1], [0.2]]);
  });

  it('batches requests larger than the batch size', async () => {
    createMock.mockImplementation(async ({ input }: { input: string[] }) => ({
      data: input.map((_, index) => ({ index, embedding: [index] })),
    }));

    const provider = new OpenAiEmbeddingProvider(makeConfigService());
    const texts = Array.from({ length: 150 }, (_, i) => `text-${i}`);

    const result = await provider.embedMany(texts);

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(150);
  });
});
