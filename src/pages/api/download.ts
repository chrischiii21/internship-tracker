import type { APIRoute } from 'astro';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

export const GET: APIRoute = async ({ url: requestUrl }) => {
  try {
    const fileUrl = requestUrl.searchParams.get('url');
    if (!fileUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    // Access configurations with fallbacks
    const r2AccountId = process.env.R2_ACCOUNT_ID || import.meta.env.R2_ACCOUNT_ID || '';
    const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID || import.meta.env.R2_ACCESS_KEY_ID || '';
    const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY || import.meta.env.R2_SECRET_ACCESS_KEY || '';
    const r2BucketName = process.env.R2_BUCKET_NAME || import.meta.env.R2_BUCKET_NAME || '';
    const r2PublicDomain = process.env.R2_PUBLIC_DOMAIN || import.meta.env.R2_PUBLIC_DOMAIN || '';
    const cleanR2Domain = r2PublicDomain.replace(/^https?:\/\//i, '').replace(/\/$/, '');

    const parsedUrl = new URL(fileUrl);
    const cleanParsedDomain = parsedUrl.host;

    // Security Check: Restrict to R2 public domain or Picsum for local dev testing
    if (cleanParsedDomain !== cleanR2Domain && !fileUrl.includes('picsum.photos')) {
      return new Response('Unauthorized file source', { status: 403 });
    }

    const filename = fileUrl.split('/').pop() || 'proof-image';

    const getFilenameWithExtension = (name: string, type: string) => {
      const lowerName = name.toLowerCase();
      const knownExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.svg'];
      const hasExtension = knownExtensions.some(ext => lowerName.endsWith(ext));
      if (hasExtension) return name;

      const mimeToExt: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/svg+xml': '.svg',
        'application/pdf': '.pdf',
      };
      
      const cleanMime = type.toLowerCase().split(';')[0].trim();
      const ext = mimeToExt[cleanMime] || '';
      return `${name}${ext}`;
    };

    // If R2 credentials are set and it is our R2 domain, fetch directly from R2 bucket using S3 Client
    if (r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2BucketName && cleanParsedDomain === cleanR2Domain) {
      try {
        const s3 = new S3Client({
          region: 'auto',
          endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: r2AccessKeyId,
            secretAccessKey: r2SecretAccessKey,
          },
        });

        // The key is the URL path without the leading slash
        const key = parsedUrl.pathname.replace(/^\//, '');

        const getObjectResponse = await s3.send(
          new GetObjectCommand({
            Bucket: r2BucketName,
            Key: key,
          })
        );

        if (getObjectResponse.Body) {
          const contentType = getObjectResponse.ContentType || 'application/octet-stream';
          const byteArray = await getObjectResponse.Body.transformToByteArray();
          const finalFilename = getFilenameWithExtension(filename, contentType);

          return new Response(byteArray, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Content-Disposition': `attachment; filename="${finalFilename}"`,
              'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
              'Pragma': 'no-cache',
              'Expires': '0',
            },
          });
        }
      } catch (s3Error) {
        console.error('S3 GetObject failed, falling back to public HTTP fetch:', s3Error);
      }
    }

    // Fallback: fetch via standard HTTP request (e.g. for Picsum placeholder images or if S3 fails)
    const response = await fetch(fileUrl);
    if (!response.ok) {
      return new Response('Failed to retrieve file', { status: response.status });
    }

    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
    const blob = await response.blob();
    const finalFilename = getFilenameWithExtension(filename, contentType);

    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${finalFilename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error: any) {
    console.error('Download proxy failed:', error);
    return new Response('Download failed', { status: 500 });
  }
};
