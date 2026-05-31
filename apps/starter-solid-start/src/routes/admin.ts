import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

const ADMIN_HTML = decapAdminHtml({
  decapConfig: minimalBlogConfig(),
  title: 'Admin · LaikaCMS SolidStart starter',
});

export function GET() {
  return new Response(ADMIN_HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
