"""S3 storage for dog media (thumbnail + annotated video).

Uploads artifacts to the bucket named in ``S3_BUCKET`` and returns presigned GET
URLs valid for 7 days (the maximum for SigV4 presigned URLs). The bucket is created
in us-west-2 if it does not exist.

Everything here degrades gracefully: if credentials or the bucket name are missing,
functions return None and the caller keeps going without media URLs.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from .settings import Settings, load_settings

BUCKET_REGION = "us-west-2"
PRESIGN_TTL = 7 * 24 * 3600  # 7 days (SigV4 max)


class S3Unavailable(RuntimeError):
    pass


def _client(settings: Settings):
    import boto3
    return boto3.client("s3", region_name=BUCKET_REGION)


def available(settings: Optional[Settings] = None) -> bool:
    """True if a bucket name is configured and boto3 has usable credentials."""
    settings = settings or load_settings()
    if not settings.s3_bucket:
        return False
    try:
        import boto3
        from botocore.exceptions import NoCredentialsError, ClientError
        sts = boto3.client("sts", region_name=BUCKET_REGION)
        sts.get_caller_identity()
        return True
    except Exception:
        return False


def ensure_bucket(settings: Optional[Settings] = None) -> str:
    """Ensure the configured bucket exists (create in us-west-2 if absent). Returns name."""
    settings = settings or load_settings()
    bucket = settings.s3_bucket
    if not bucket:
        raise S3Unavailable("S3_BUCKET is not set")
    from botocore.exceptions import ClientError
    s3 = _client(settings)
    try:
        s3.head_bucket(Bucket=bucket)
        return bucket
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code not in ("404", "NoSuchBucket", "403"):
            raise
    # Create it (us-west-2 needs an explicit LocationConstraint).
    s3.create_bucket(
        Bucket=bucket,
        CreateBucketConfiguration={"LocationConstraint": BUCKET_REGION},
    )
    return bucket


def upload_and_presign(
    local_path: str, key: str, *, content_type: str,
    settings: Optional[Settings] = None,
) -> Optional[str]:
    """Upload ``local_path`` to ``key`` and return a 7-day presigned GET URL."""
    settings = settings or load_settings()
    if not Path(local_path).exists():
        return None
    try:
        bucket = ensure_bucket(settings)
        s3 = _client(settings)
        s3.upload_file(local_path, bucket, key, ExtraArgs={"ContentType": content_type})
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=PRESIGN_TTL,
        )
    except Exception:
        return None


def presign_existing(key: str, *, settings: Optional[Settings] = None) -> Optional[str]:
    """Return a fresh 7-day presigned GET URL for an already-uploaded key."""
    settings = settings or load_settings()
    if not settings.s3_bucket:
        return None
    try:
        s3 = _client(settings)
        # Confirm the object exists before presigning.
        s3.head_object(Bucket=settings.s3_bucket, Key=key)
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": key},
            ExpiresIn=PRESIGN_TTL,
        )
    except Exception:
        return None


def thumbnail_key(dog_id: str) -> str:
    return f"thumbnails/{dog_id}.jpg"


def video_key(dog_id: str, day: int) -> str:
    return f"videos/{dog_id}_day{day}.mp4"
