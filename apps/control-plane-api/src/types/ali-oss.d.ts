declare module "ali-oss" {
  type OssClientOptions = {
    region?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    bucket?: string;
    endpoint?: string;
  };

  type OssRequestOptions = {
    headers?: Record<string, string>;
  };

  export default class OSS {
    constructor(options: OssClientOptions);
    put(key: string, body: Buffer, options?: OssRequestOptions): Promise<unknown>;
    get(key: string): Promise<{ content: Buffer | string }>;
    delete(key: string): Promise<unknown>;
    getBucketInfo(bucket: string): Promise<unknown>;
    putBucket(bucket: string): Promise<unknown>;
    signatureUrl(key: string, options?: { expires?: number; method?: string }): string;
  }
}
