from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import aioboto3
from botocore.client import Config

from app.core.config import get_settings


def _client_kwargs() -> dict:
    settings = get_settings()
    if not settings.s3_bucket:
        raise RuntimeError("S3_BUCKET is not configured.")

    kwargs: dict = {
        "region_name": settings.s3_region,
        "config": Config(signature_version="s3v4"),
    }
    if settings.s3_endpoint_url:
        kwargs["endpoint_url"] = settings.s3_endpoint_url
    if settings.aws_access_key_id:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
    if settings.aws_secret_access_key:
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return kwargs


@asynccontextmanager
async def s3_client() -> AsyncIterator[object]:
    session = aioboto3.Session()
    async with session.client("s3", **_client_kwargs()) as client:
        yield client


async def generate_presigned_put(*, key: str, content_type: str, max_bytes: int) -> dict:
    settings = get_settings()
    async with s3_client() as client:
        url = await client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": settings.s3_bucket,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=settings.upload_url_expires_seconds,
            HttpMethod="PUT",
        )
    return {
        "upload_url": url,
        "key": key,
        "expires_in": settings.upload_url_expires_seconds,
        "required_headers": {"Content-Type": content_type},
        "max_bytes": max_bytes,
    }


async def generate_presigned_get(
    *,
    key: str,
    expires_in: int,
    filename: str | None = None,
    content_type: str | None = None,
) -> str:
    settings = get_settings()
    params: dict = {"Bucket": settings.s3_bucket, "Key": key}
    if filename:
        safe = filename.replace('"', "")
        params["ResponseContentDisposition"] = f'inline; filename="{safe}"'
    if content_type:
        # Browsers fall back to a legacy charset for text/* responses with no
        # explicit charset, which mangles UTF-8 markdown/plaintext into mojibake.
        if content_type.startswith("text/") and "charset=" not in content_type.lower():
            params["ResponseContentType"] = f"{content_type}; charset=utf-8"
        else:
            params["ResponseContentType"] = content_type
    async with s3_client() as client:
        return await client.generate_presigned_url(
            ClientMethod="get_object",
            Params=params,
            ExpiresIn=expires_in,
            HttpMethod="GET",
        )


async def head_object(*, key: str) -> dict | None:
    settings = get_settings()
    async with s3_client() as client:
        try:
            return await client.head_object(Bucket=settings.s3_bucket, Key=key)
        except client.exceptions.ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise


async def download_to_file(*, key: str, destination: str) -> None:
    settings = get_settings()
    async with s3_client() as client:
        await client.download_file(settings.s3_bucket, key, destination)


async def delete_object(*, key: str) -> None:
    settings = get_settings()
    async with s3_client() as client:
        await client.delete_object(Bucket=settings.s3_bucket, Key=key)


async def delete_objects_with_prefix(*, prefix: str) -> None:
    settings = get_settings()
    async with s3_client() as client:
        paginator = client.get_paginator("list_objects_v2")
        async for page in paginator.paginate(Bucket=settings.s3_bucket, Prefix=prefix):
            objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if not objects:
                continue
            await client.delete_objects(
                Bucket=settings.s3_bucket,
                Delete={"Objects": objects, "Quiet": True},
            )
