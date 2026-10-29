import config from '../config/env.js';

// Cloudinary REST upload — no SDK needed. Files are uploaded server-side so
// the API secret never reaches the browser.
export async function uploadImage(buffer, folder, filename = 'document') {
  if (!config.cloudinary.cloudName || !config.cloudinary.apiKey) {
    throw new Error('Cloudinary is not configured');
  }

  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('folder', folder);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/image/upload`,
    {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${config.cloudinary.apiKey}:${config.cloudinary.apiSecret}`).toString('base64'),
      },
      body: form,
      signal: AbortSignal.timeout(30000),
    }
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.secure_url) {
    throw new Error(json.error?.message || `Cloudinary upload failed (${res.status})`);
  }
  return json.secure_url;
}
