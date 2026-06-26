import type { APIRoute } from 'astro';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const POST: APIRoute = async ({ request }) => {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0 || (files.length === 1 && files[0].size === 0)) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Access variables with multiple fallbacks for different environments
    const r2AccountId = process.env.R2_ACCOUNT_ID || import.meta.env.R2_ACCOUNT_ID || '';
    const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID || import.meta.env.R2_ACCESS_KEY_ID || '';
    const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY || import.meta.env.R2_SECRET_ACCESS_KEY || '';
    const r2BucketName = process.env.R2_BUCKET_NAME || import.meta.env.R2_BUCKET_NAME || '';
    const r2PublicDomainRaw = process.env.R2_PUBLIC_DOMAIN || import.meta.env.R2_PUBLIC_DOMAIN || '';
    const r2PublicDomain = r2PublicDomainRaw.replace(/^https?:\/\//i, '').replace(/\/$/, '');

    if (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey || !r2BucketName || !r2PublicDomain) {
      console.warn('R2 credentials not set. Falling back to mock image URLs for testing.');
      const mockUrls: string[] = [];
      for (const file of files) {
        if (file.size === 0) continue;
        mockUrls.push(`https://picsum.photos/seed/${encodeURIComponent(file.name)}/300/200`);
      }
      return new Response(JSON.stringify(mockUrls), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    });

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const uploadedUrls: string[] = [];

    for (const file of files) {
      if (file.size === 0) continue; // Skip empty fields

      if (!allowedMimeTypes.includes(file.type)) {
        return new Response(
          JSON.stringify({ error: `Invalid file type: ${file.type}. Only JPEG, PNG, and WebP are allowed.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      let extension = 'bin';
      const lastDotIndex = file.name.lastIndexOf('.');
      if (lastDotIndex !== -1 && lastDotIndex < file.name.length - 1) {
        extension = file.name.slice(lastDotIndex + 1);
      } else if (file.type) {
        extension = file.type.split('/')[1] || 'bin';
      }
      
      // Standardize jpeg to jpg
      if (extension.toLowerCase() === 'jpeg') {
        extension = 'jpg';
      }

      const fileId = crypto.randomUUID();
      const uniqueFilename = `${fileId}.${extension}`;

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      await s3.send(new PutObjectCommand({
        Bucket: r2BucketName,
        Key: uniqueFilename,
        Body: buffer,
        ContentType: file.type,
      }));

      uploadedUrls.push(`https://${r2PublicDomain}/${uniqueFilename}`);
    }

    return new Response(JSON.stringify(uploadedUrls), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error: any) {
    console.error('File upload failed:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Upload failed' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
