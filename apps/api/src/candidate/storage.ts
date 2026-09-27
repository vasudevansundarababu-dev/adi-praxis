import { Storage } from '@google-cloud/storage';

/** Private object storage for candidate evidence (SPEC: Cloud Storage; the emulator locally). No public access. */
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class GcsStorage implements ObjectStorage {
  private readonly bucket;
  constructor(bucketName: string, opts: { apiEndpoint?: string; projectId?: string } = {}) {
    this.bucket = new Storage(opts).bucket(bucketName);
  }
  async ensureBucket() {
    const [exists] = await this.bucket.exists();
    if (!exists) await this.bucket.create();
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.bucket.file(key).save(data, { contentType, resumable: false, private: true });
  }
  async get(key: string) {
    const [buf] = await this.bucket.file(key).download();
    return buf;
  }
  async delete(key: string) {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
}

/** In-memory storage for tests. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { data: Buffer; contentType: string }>();
  async put(key: string, data: Buffer, contentType: string) {
    this.objects.set(key, { data, contentType });
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) throw new Error('Not found');
    return o.data;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

export type ScanStatus = 'CLEAN' | 'INFECTED' | 'PENDING';

/**
 * Malware scanning for uploads (decided 26 Sep 2026). A named interface; v1 ships a stub that marks files CLEAN and
 * must be replaced with a real scanner before real candidates upload files.
 */
export interface MalwareScanner {
  scan(data: Buffer): Promise<ScanStatus>;
}

export const stubScanner: MalwareScanner = {
  async scan() {
    return 'CLEAN';
  },
};
