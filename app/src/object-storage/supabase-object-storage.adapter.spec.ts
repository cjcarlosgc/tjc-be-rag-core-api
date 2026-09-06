import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadMock = vi.fn();
const downloadMock = vi.fn();
const removeMock = vi.fn();
const createSignedUrlMock = vi.fn();
const fromMock = vi.fn(() => ({
  upload: uploadMock,
  download: downloadMock,
  remove: removeMock,
  createSignedUrl: createSignedUrlMock,
}));
const getBucketMock = vi.fn();
const createBucketMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: fromMock,
      getBucket: getBucketMock,
      createBucket: createBucketMock,
    },
  })),
}));

const { SupabaseObjectStorageAdapter } = await import('./supabase-object-storage.adapter.js');

const CONFIG: Record<string, string> = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  OBJECT_STORAGE_BUCKET: 'rag-core',
};

function makeConfigService() {
  return { getOrThrow: (key: string) => CONFIG[key] } as never;
}

describe('SupabaseObjectStorageAdapter', () => {
  beforeEach(() => {
    uploadMock.mockReset().mockResolvedValue({ error: null });
    downloadMock.mockReset();
    removeMock.mockReset().mockResolvedValue({ error: null });
    createSignedUrlMock.mockReset();
    getBucketMock.mockReset().mockResolvedValue({ data: { name: 'rag-core' }, error: null });
    createBucketMock.mockReset();
    fromMock.mockClear();
  });

  it('does not create the bucket when it already exists, and only checks it once', async () => {
    const adapter = new SupabaseObjectStorageAdapter(makeConfigService());

    await adapter.put('a', Buffer.from('x'));
    await adapter.put('b', Buffer.from('y'));

    expect(getBucketMock).toHaveBeenCalledTimes(1);
    expect(createBucketMock).not.toHaveBeenCalled();
  });

  it('creates the bucket lazily, on first use, when it does not exist', async () => {
    getBucketMock.mockResolvedValue({ data: null, error: { message: 'not found' } });
    createBucketMock.mockResolvedValue({ error: null });
    const adapter = new SupabaseObjectStorageAdapter(makeConfigService());

    expect(createBucketMock).not.toHaveBeenCalled();

    await adapter.put('key', Buffer.from('x'));

    expect(createBucketMock).toHaveBeenCalledWith('rag-core', { public: false });
  });

  it('throws when bucket creation fails', async () => {
    getBucketMock.mockResolvedValue({ data: null, error: { message: 'not found' } });
    createBucketMock.mockResolvedValue({ error: { message: 'permission denied' } });
    const adapter = new SupabaseObjectStorageAdapter(makeConfigService());

    await expect(adapter.put('key', Buffer.from('x'))).rejects.toThrow('permission denied');
  });

  it('put() uploads the buffer with upsert and content type', async () => {
    const adapter = new SupabaseObjectStorageAdapter(makeConfigService());

    await adapter.put('some/key.zip', Buffer.from('data'), 'application/zip');

    expect(fromMock).toHaveBeenCalledWith('rag-core');
    expect(uploadMock).toHaveBeenCalledWith(
      'some/key.zip',
      Buffer.from('data'),
      expect.objectContaining({ contentType: 'application/zip', upsert: true }),
    );
  });

  it('put() throws a domain error when the upload fails', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'network error' } });
    const adapter = new SupabaseObjectStorageAdapter(makeConfigService());

    await expect(adapter.put('key', Buffer.from('x'))).rejects.toThrow('network error');
  });

  it('get() returns a Buffer built from the downloaded blob', async () => {
    downloadMock.mockResolvedValue({
      data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
      error: null,
    });
    const adapter = new SupabaseObjectStorageAdapter(makeConfigService());

    const result = await adapter.get('some/key.zip');

    expect(result).toEqual(Buffer.from([1, 2, 3]));
  });

  it('get() throws when the download fails', async () => {
    downloadMock.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const adapter = new SupabaseObjectStorageAdapter(makeConfigService());

    await expect(adapter.get('missing.zip')).rejects.toThrow('not found');
  });

  it('delete() removes the object by key', async () => {
    const adapter = new SupabaseObjectStorageAdapter(makeConfigService());

    await adapter.delete('some/key.zip');

    expect(removeMock).toHaveBeenCalledWith(['some/key.zip']);
  });

  it('presignGet() returns the signed URL', async () => {
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null });
    const adapter = new SupabaseObjectStorageAdapter(makeConfigService());

    const url = await adapter.presignGet('some/key.zip', 60);

    expect(createSignedUrlMock).toHaveBeenCalledWith('some/key.zip', 60);
    expect(url).toBe('https://signed');
  });
});
