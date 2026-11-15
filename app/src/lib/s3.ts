import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Amplify reserves AWS_* console variables, so the app's S3 credentials use S3_* names.
export function s3Config() {
  const { S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return { bucket: S3_BUCKET, region: S3_REGION || "us-west-2", keyId: S3_ACCESS_KEY_ID, secret: S3_SECRET_ACCESS_KEY };
}

const g = globalThis as unknown as { _s3?: S3Client };

function client() {
  const cfg = s3Config();
  if (!cfg) throw new Error("S3 is not configured (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).");
  // Regional endpoint so the presigned URL needs no redirect (a redirect would break the signature).
  g._s3 ??= new S3Client({ region: cfg.region, credentials: { accessKeyId: cfg.keyId, secretAccessKey: cfg.secret } });
  return { s3: g._s3, bucket: cfg.bucket };
}

/** Presigned PUT the browser uploads to directly. ContentType is signed, so the browser must send the same header. */
export async function presignPut(key: string, contentType: string, expiresIn = 900) {
  const { s3, bucket } = client();
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn });
  return { url, bucket, key };
}

export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const { s3, bucket } = client();
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return res.Body!.transformToByteArray();
}

export async function deleteObject(key: string) {
  const { s3, bucket } = client();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
