export interface EmbeddingProvider {
  embedMany(texts: string[]): Promise<number[][]>;
}
